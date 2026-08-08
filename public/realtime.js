export class RealtimeTutor extends EventTarget {
  constructor(audioEl){
    super();
    this.audioEl=audioEl;
    this.pc=null; this.dc=null; this.stream=null;
    this.connected=false; this.assistantTranscript='';
    this.pending=[];
    this.activeResponseId=null;
    this._wantResponse=false;
    this._ctxSeq=0; this._ctxIds=[];
    this._intentionalClose=false;
    this._reconnectAttempt=0;
    this._reconnectTimer=null;
    this._muted=false;
    this._analyser=null;
  }

  async connect(){
    if(this.connected)return;
    this._intentionalClose=false;
    this.dispatch('status',{state:'connecting'});
    const pc=new RTCPeerConnection(); this.pc=pc;
    pc.onconnectionstatechange=()=>{
      const st=pc.connectionState;
      this.dispatch('status',{state:st});
      if(st==='connected'){this.connected=true;this._reconnectAttempt=0;}
      if(['closed','failed','disconnected'].includes(st)){
        const wasConnected=this.connected; this.connected=false;
        if(!this._intentionalClose && wasConnected) this._scheduleReconnect();
      }
    };
    pc.ontrack=e=>{
      this.audioEl.srcObject=e.streams[0];
      this.audioEl.autoplay=true;
      this.audioEl.play?.().catch(()=>{});
    };
    const dc=pc.createDataChannel('oai-events'); this.dc=dc;
    dc.onopen=()=>{
      this.connected=true; this.dispatch('status',{state:'connected'});
      for(const evt of this.pending.splice(0))this.send(evt);
    };
    dc.onclose=()=>{
      const wasConnected=this.connected; this.connected=false;
      this.dispatch('status',{state:'closed'});
      if(!this._intentionalClose && wasConnected) this._scheduleReconnect();
    };
    dc.onerror=e=>this.dispatch('error',{message:'Realtime data channel error',raw:String(e)});
    dc.onmessage=e=>this.onEvent(e.data);

    this.stream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}, video:false
    });
    for(const track of this.stream.getAudioTracks()){track.enabled=!this._muted;pc.addTrack(track,this.stream);}
    this._setupMeter();

    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res=await fetch('/api/realtime/call',{
      method:'POST',headers:{'Content-Type':'application/sdp'},body:offer.sdp
    });
    if(!res.ok){
      const msg=await res.text(); this.close(); throw new Error(msg||`Realtime failed (${res.status})`);
    }
    const answerSdp=await res.text();
    await pc.setRemoteDescription({type:'answer',sdp:answerSdp});
  }

  _scheduleReconnect(){
    if(this._reconnectTimer)return;
    if(this._reconnectAttempt>=3){this.dispatch('status',{state:'failed'});return;}
    const delay=1000*Math.pow(2,this._reconnectAttempt++);
    this.dispatch('status',{state:'reconnecting',attempt:this._reconnectAttempt});
    this._reconnectTimer=setTimeout(async()=>{
      this._reconnectTimer=null;
      this._teardown();
      try{ await this.connect(); this.dispatch('reconnected',{}); }
      catch(e){ this._scheduleReconnect(); }
    },delay);
  }

  _setupMeter(){
    try{
      const ac=new (window.AudioContext||window.webkitAudioContext)();
      const src=ac.createMediaStreamSource(this.stream);
      const an=ac.createAnalyser(); an.fftSize=256; src.connect(an);
      this._analyser=an; this._audioCtx=ac;
      const buf=new Uint8Array(an.frequencyBinCount);
      const tick=()=>{
        if(!this._analyser)return;
        an.getByteFrequencyData(buf);
        let sum=0; for(const v of buf)sum+=v;
        this.dispatch('miclevel',{level:Math.min(1,(sum/buf.length)/90)});
        this._meterRaf=requestAnimationFrame(tick);
      };
      tick();
    }catch{}
  }

  onEvent(raw){
    let e; try{e=JSON.parse(raw);}catch{return;}
    this.dispatch('event',e);
    const t=e.type;
    if(t==='input_audio_buffer.speech_started')this.dispatch('user-speech-start',e);
    if(t==='input_audio_buffer.speech_stopped')this.dispatch('user-speech-stop',e);
    if(t==='conversation.item.input_audio_transcription.completed'){
      this.dispatch('user-transcript',{transcript:e.transcript||'',itemId:e.item_id});
    }
    if(t==='response.created'){
      this.activeResponseId=e.response?.id||'r';
      this.dispatch('assistant-turn-start',e);
    }
    if(t==='response.output_audio_transcript.delta'||t==='response.audio_transcript.delta'){
      this.assistantTranscript+=(e.delta||'');
      this.dispatch('assistant-transcript-delta',{delta:e.delta||'',transcript:this.assistantTranscript});
    }
    if(t==='response.output_audio_transcript.done'||t==='response.audio_transcript.done'){
      const transcript=e.transcript||this.assistantTranscript;
      this.assistantTranscript='';
      this.dispatch('assistant-transcript',{transcript,responseId:e.response_id});
    }
    if(t==='response.function_call_arguments.done'){
      let args={}; try{args=JSON.parse(e.arguments||'{}');}catch{}
      this.dispatch('canvas-action',{name:e.name,callId:e.call_id,args});
    }
    if(t==='response.done'){
      this.activeResponseId=null;
      this.dispatch('response-done',e);
      if(this._wantResponse){this._wantResponse=false;this.send({type:'response.create'});}
    }
    if(t==='error')this.dispatch('error',{message:e.error?.message||'Realtime API error',raw:e});
  }

  dispatch(name,detail){this.dispatchEvent(new CustomEvent(name,{detail}));}

  send(obj){
    if(this.dc?.readyState==='open')this.dc.send(JSON.stringify(obj));
    else this.pending.push(obj);
  }

  /** Create a response, deferring if one is already active (avoids "active response" errors). */
  createResponse(){
    if(this.activeResponseId)this._wantResponse=true;
    else this.send({type:'response.create'});
  }

  sendFunctionOutput(callId,output='{"ok":true}'){
    this.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:callId,output}});
  }

  /**
   * Push a canvas snapshot + ink map into the conversation. Older context items
   * are deleted so image tokens don't accumulate turn over turn.
   */
  sendCanvasContext(imageUrl, note='Latest student canvas', {detail='low', inkMap=''}={}){
    if(!imageUrl)return;
    const id=`ctx_${String(++this._ctxSeq).padStart(4,'0')}`;
    this.send({
      type:'conversation.item.create',
      item:{
        id, type:'message',role:'user',
        content:[
          {type:'input_text',text:`[SILENT CANVAS CONTEXT — do not respond to this item alone.] ${note}. Black/dark ink is the student. Blue ink is your own visual tutoring.${inkMap?`\n${inkMap}`:''}`},
          {type:'input_image',image_url:imageUrl,detail}
        ]
      }
    });
    this._ctxIds.push(id);
    while(this._ctxIds.length>2){
      const old=this._ctxIds.shift();
      this.send({type:'conversation.item.delete',item_id:old});
    }
  }

  sendUserText(text){
    const cleaned=String(text||'').trim(); if(!cleaned)return;
    this.send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:cleaned}]}});
    this.createResponse();
  }

  mute(muted=true){
    this._muted=muted;
    for(const t of this.stream?.getAudioTracks?.()||[])t.enabled=!muted;
    this.dispatch('mute',{muted});
  }

  setVolume(v){ if(this.audioEl)this.audioEl.volume=Math.max(0,Math.min(1,Number(v))); }

  _teardown(){
    try{this.dc?.close();}catch{}
    try{this.pc?.close();}catch{}
    for(const t of this.stream?.getTracks?.()||[])t.stop();
    if(this._meterRaf)cancelAnimationFrame(this._meterRaf);
    try{this._audioCtx?.close();}catch{}
    this._analyser=null;
    this.dc=null; this.pc=null; this.stream=null; this.connected=false;
    this.activeResponseId=null; this._wantResponse=false;
    if(this.audioEl)this.audioEl.srcObject=null;
  }

  close(){
    this._intentionalClose=true;
    clearTimeout(this._reconnectTimer); this._reconnectTimer=null; this._reconnectAttempt=0;
    this._teardown();
    this.dispatch('status',{state:'closed'});
  }
}
