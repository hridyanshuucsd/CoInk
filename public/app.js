import { CanvasBoard, AIInkAnimator } from './canvas.js';
import { RealtimeTutor } from './realtime.js';

const $ = id => document.getElementById(id);
const qsa = s => [...document.querySelectorAll(s)];

const params = new URLSearchParams(location.search);
const sessionId = sanitize(params.get('participant') || params.get('session') || localStorage.getItem('coink:lastSession') || `P-${Math.random().toString(36).slice(2,8).toUpperCase()}`);
window.__COINK_SESSION_ID__ = sessionId;
localStorage.setItem('coink:lastSession', sessionId);
$('participantLabel').textContent = `Session ${sessionId}`;

const board = new CanvasBoard($('canvas'), $('overlay'));
const animator = new AIInkAnimator(board);
const realtime = new RealtimeTutor($('remoteAudio'));
board.loadLocal(sessionId);

let health = {keyConfigured:false,autoAiDelayMs:1100};
let autoTimer = null;
let voiceContextTimer = null;
let plannerSeq = 0;
let plannerBusy = false;
let muted = false;
let toastTimer = null;
let aiUndoTimer = null;
let lastVoiceCapture = null;   // capture the voice model last saw — plans resolve against it
let lastSpeechContextAt = 0;

init();

async function init(){
  wireUI();
  try{
    health = await fetch('/api/health').then(r=>r.json());
    if(!health.keyConfigured){
      setStatus('Canvas ready — add OPENAI_API_KEY for tutor/voice','error');
      showBanner('AI is not configured on the server (missing OPENAI_API_KEY).');
    } else {
      setStatus(`Ready · ${health.tutorModel}`);
    }
  }catch(e){setStatus('Server connection error','error');showBanner('Cannot reach the CoInk server.',()=>location.reload());}
  log('session_start',{userAgent:navigator.userAgent,screen:[innerWidth,innerHeight],sessionId});
}

function wireUI(){
  qsa('[data-tool]').forEach(btn=>btn.addEventListener('click',()=>selectTool(btn.dataset.tool)));
  qsa('[data-color]').forEach(btn=>btn.addEventListener('click',()=>{
    board.setPenColor(btn.dataset.color);
    qsa('[data-color]').forEach(b=>b.classList.toggle('active',b===btn));
    selectTool('pen');
  }));
  $('penWidth').addEventListener('input',e=>board.setPenWidth(e.target.value));
  $('undoBtn').addEventListener('click',()=>board.undo());
  $('undoAiBtn').addEventListener('click',()=>board.undoLastAI());
  $('toastUndoAi').addEventListener('click',()=>{board.undoLastAI();hideAiUndo();});
  $('clearBtn').addEventListener('click',()=>{if(confirm('Clear this canvas?'))board.clear();});
  $('exportBtn').addEventListener('click',exportCanvas);
  $('newPageBtn').addEventListener('click',()=>{
    const next=`P-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    location.search=`?session=${next}`;
  });
  $('hintBtn').addEventListener('click',()=>askTutor('manual_hint','Please give me a small hint about the work on the canvas — the smallest useful next step, not the answer.'));
  $('checkBtn').addEventListener('click',()=>askTutor('manual_check','Please check all the visible work on the canvas carefully, step by step, and point at anything wrong.'));
  $('voiceBtn').addEventListener('click',toggleVoice);
  $('muteBtn').addEventListener('click',toggleMute);
  $('volume').addEventListener('input',e=>realtime.setVolume(e.target.value));
  $('transcriptToggle').addEventListener('click',()=>$('transcript').classList.toggle('collapsed'));
  $('startBtn').addEventListener('click',()=>{ $('welcome').classList.add('hidden'); if(!realtime.connected)toggleVoice(); });
  $('bannerClose').addEventListener('click',hideBanner);

  $('chatForm').addEventListener('submit',e=>{
    e.preventDefault();
    const text=$('chatInput').value.trim(); if(!text)return;
    $('chatInput').value='';
    appendTranscript('student',text);
    log('user_text',{text});
    if(realtime.connected){
      sendVoiceCanvasContext('The student typed a message about this canvas.','high');
      realtime.sendUserText(text);
    } else {
      requestPlan('manual_check',text,{quiet:false});
    }
  });

  window.addEventListener('keydown',e=>{
    if(e.target?.matches?.('input,textarea'))return;
    if(e.key.toLowerCase()==='p')selectTool('pen');
    if(e.key.toLowerCase()==='e')selectTool('eraser');
    if(e.key.toLowerCase()==='h')selectTool('pan');
  });

  board.addEventListener('humaninputstart',()=>{
    plannerSeq++; clearTimeout(autoTimer);
    // pen-down interrupts the tutor's INK animation only — never its speech
    if(animator.running){ animator.cancel('student_wrote'); log('ai_ink_interrupted',{reason:'student_wrote'}); }
  });
  board.addEventListener('strokeend',e=>{
    const s=e.detail.stroke;
    log('stroke',{id:s.id,author:s.author,width:s.width,points:s.points});
    if($('autoAI').checked) scheduleAutoTutor();
    scheduleVoiceCanvasContext('Student added handwriting.');
  });
  board.addEventListener('erase',()=>{log('erase',{});scheduleVoiceCanvasContext('Student erased part of the canvas.');});
  board.addEventListener('undo',()=>log('undo',{}));
  board.addEventListener('undoai',e=>log('undo_ai',e.detail));
  board.addEventListener('clear',()=>log('clear',{}));

  animator.addEventListener('start',e=>{setStatus('CoInk is writing…','busy');log('ai_ink_start',e.detail);});
  animator.addEventListener('progress',e=>moveAiPen(e.detail.point));
  animator.addEventListener('done',e=>{
    hideAiPen(); setStatus(realtime.connected?'Voice connected':'Ready'); showAiUndo();
    log('ai_ink_done',e.detail); scheduleVoiceCanvasContext('Tutor added blue handwriting to the canvas.');
  });
  animator.addEventListener('cancel',e=>{hideAiPen();setStatus(realtime.connected?'Voice connected':'Ready');log('ai_ink_cancel',e.detail);});

  realtime.addEventListener('status',e=>setVoiceState(e.detail.state));
  realtime.addEventListener('reconnected',()=>{
    sendVoiceCanvasContext('Reconnected — this is the current canvas state.','high');
    showToast('Voice reconnected.');
  });
  realtime.addEventListener('miclevel',e=>{
    $('voiceBtn').style.setProperty('--lvl',e.detail.level.toFixed(2));
  });
  realtime.addEventListener('user-speech-start',()=>{
    if(animator.running){animator.cancel('student_spoke');log('ai_ink_interrupted',{reason:'student_spoke'});}
    // fresh eyes: give the model the current page right as the student starts talking
    const now=Date.now();
    if(now-lastSpeechContextAt>2500){ lastSpeechContextAt=now; sendVoiceCanvasContext('The student is speaking about this canvas right now.','high'); }
    setVoiceActivity('listening');
  });
  realtime.addEventListener('user-speech-stop',()=>setVoiceActivity('thinking'));
  realtime.addEventListener('assistant-turn-start',()=>setVoiceActivity('speaking'));
  realtime.addEventListener('response-done',()=>setVoiceActivity('idle'));
  realtime.addEventListener('user-transcript',e=>{
    const t=e.detail.transcript.trim(); if(!t)return;
    appendTranscript('student',t);
    log('voice_user_transcript',{text:t});
  });
  realtime.addEventListener('assistant-transcript-delta',e=>{
    $('liveLine').textContent=e.detail.transcript||'…';
  });
  realtime.addEventListener('assistant-transcript',e=>{
    const t=e.detail.transcript.trim(); if(!t)return;
    $('liveLine').textContent='';
    appendTranscript('coink',t);
    log('voice_ai_transcript',{text:t});
  });
  // the voice model draws through its canvas_action tool — one brain for speech and ink
  realtime.addEventListener('canvas-action',async e=>{
    const {callId,args}=e.detail;
    log('voice_canvas_action',{actions:(args.actions||[]).map(a=>a.type)});
    try{
      const cap=lastVoiceCapture||board.captureForModel(900);
      await board.applyPlan({actions:args.actions||[]},animator,cap);
      realtime.sendFunctionOutput(callId,'{"ok":true,"note":"ink rendered on canvas"}');
    }catch(err){
      console.warn(err);
      realtime.sendFunctionOutput(callId,`{"ok":false,"error":${JSON.stringify(String(err.message||err))}}`);
    }
    realtime.createResponse();
  });
  realtime.addEventListener('error',e=>{showToast(e.detail.message||'Voice error');log('voice_error',e.detail);});
}

function selectTool(tool){
  board.setTool(tool); qsa('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
}

function scheduleAutoTutor(){
  clearTimeout(autoTimer);
  const seq=++plannerSeq;
  autoTimer=setTimeout(()=>{if(seq===plannerSeq)requestPlan('auto','',{quiet:true});},health.autoAiDelayMs||1100);
}

function scheduleVoiceCanvasContext(note){
  clearTimeout(voiceContextTimer);
  if(!realtime.connected)return;
  voiceContextTimer=setTimeout(()=>sendVoiceCanvasContext(note,'low'),900);
}

function sendVoiceCanvasContext(note='Latest canvas state', detail='low'){
  if(!realtime.connected)return;
  try{
    const cap=board.captureForModel(detail==='high'?1200:900);
    lastVoiceCapture=cap;
    realtime.sendCanvasContext(cap.image,note,{detail,inkMap:board.inventoryText(cap.inventory)});
    log('voice_canvas_context',{note,detail});
  }catch(e){console.warn(e);}
}

/** Hint/Check: with voice connected the tutor answers and draws itself; otherwise fall back to the silent planner. */
function askTutor(source, spokenRequest){
  if(realtime.connected){
    sendVoiceCanvasContext('The student pressed a help button about this canvas.','high');
    realtime.sendUserText(spokenRequest);
    log('tutor_ask_voice',{source});
  } else {
    requestPlan(source,'',{quiet:false});
  }
}

async function requestPlan(source, transcript='', opts={}){
  if(!health.keyConfigured){showToast('Add OPENAI_API_KEY to .env, then restart the server.');return;}
  const mySeq=++plannerSeq;
  plannerBusy=true; setBusyButtons(true);
  if(!opts.quiet)setStatus(source==='auto'?'CoInk is looking…':'Thinking…','busy');
  const started=performance.now();
  try{
    const cap=board.captureForModel(1050);
    const r=await fetch('/api/tutor',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sessionId,source,transcript,image:cap.image,inkMap:board.inventoryText(cap.inventory),aspect:cap.aspect,width:board.cssWidth,height:board.cssHeight})
    });
    const data=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
    if(!r.ok)throw new Error(data.error||`Tutor request failed (${r.status})`);
    if(mySeq!==plannerSeq)return;
    log('tutor_plan',{source,latencyMs:Math.round(performance.now()-started),plan:data});
    if(!data.intervene || !data.actions?.length){
      if(source!=='auto'&&!opts.quiet)showToast('Your current work looks fine to continue.');
      return;
    }
    const result=await board.applyPlan(data,animator,cap);
    if(data.speech && !realtime.connected) appendTranscript('coink',data.speech);
    return result;
  }catch(e){
    console.error(e); if(!opts.quiet)showToast(e.message); setStatus('Tutor request failed','error'); log('tutor_error',{source,message:e.message});
  }finally{
    plannerBusy=false; setBusyButtons(false);
    if(!animator.running)setStatus(realtime.connected?'Voice connected':'Ready');
  }
}

function setBusyButtons(busy){
  $('hintBtn').disabled=busy; $('checkBtn').disabled=busy;
}

async function toggleVoice(){
  if(realtime.connected){realtime.close();return;}
  if(!health.keyConfigured){showToast('Add OPENAI_API_KEY to .env, then restart the server.');return;}
  if(!window.isSecureContext && location.hostname!=='localhost' && location.hostname!=='127.0.0.1'){
    showToast('Microphone access requires HTTPS on iPad/remote devices. Use the HTTPS link.');return;
  }
  try{
    setVoiceState('connecting');
    await realtime.connect();
    realtime.setVolume($('volume').value);
    sendVoiceCanvasContext('Initial canvas state at the start of this voice session.','high');
    log('voice_connected',{});
  }catch(e){showToast(e.message);setVoiceState('failed');log('voice_connect_error',{message:e.message});}
}

function toggleMute(){
  muted=!muted; realtime.mute(muted); $('muteBtn').textContent=muted?'Mic off':'Mic on'; $('muteBtn').classList.toggle('muted',muted); log('voice_mute',{muted});
}

function setVoiceState(state){
  const b=$('voiceBtn'),label=$('voiceLabel');
  b.classList.remove('connected','connecting');
  if(state==='connected'){
    b.classList.add('connected');label.textContent='Voice live';$('muteBtn').disabled=false;setStatus('Voice connected');hideBanner();
  }else if(state==='connecting'||state==='new'){
    b.classList.add('connecting');label.textContent='Connecting…';$('muteBtn').disabled=true;setStatus('Connecting voice…','busy');
  }else if(state==='reconnecting'){
    b.classList.add('connecting');label.textContent='Reconnecting…';setStatus('Voice dropped — reconnecting…','busy');
  }else if(state==='failed'){
    label.textContent='Start voice';$('muteBtn').disabled=true;
    showBanner('Voice connection lost and could not reconnect.',()=>toggleVoice());
    setStatus('Voice failed','error');
  }else{
    label.textContent='Start voice';$('muteBtn').disabled=true;muted=false;$('muteBtn').textContent='Mic on';
    if(!plannerBusy&&!animator.running)setStatus('Ready');
  }
}

function setVoiceActivity(kind){
  const el=$('voiceActivity');
  el.dataset.kind=kind;
  el.textContent = kind==='listening'?'Listening…' : kind==='thinking'?'Thinking…' : kind==='speaking'?'Speaking' : '';
}

function appendTranscript(who,text){
  const logEl=$('voiceLog');
  const div=document.createElement('div');
  div.className=`turn ${who==='coink'?'ai':'student'}`;
  div.innerHTML=`<b>${who==='coink'?'CoInk':'You'}</b><span></span>`;
  div.querySelector('span').textContent=text;
  logEl.appendChild(div);
  while(logEl.children.length>60)logEl.removeChild(logEl.firstChild);
  logEl.scrollTop=logEl.scrollHeight;
  $('transcript').classList.remove('collapsed');
}

function setStatus(text,kind='ok'){
  $('statusText').textContent=text; const d=$('statusDot'); d.classList.remove('busy','error'); if(kind==='busy')d.classList.add('busy');if(kind==='error')d.classList.add('error');
}

function showToast(text,ms=3800){
  clearTimeout(toastTimer); const t=$('toast');t.textContent=text;t.classList.remove('hidden');toastTimer=setTimeout(()=>t.classList.add('hidden'),ms);
}
function showBanner(text,retry){
  $('bannerText').textContent=text;
  $('bannerRetry').classList.toggle('hidden',!retry);
  $('bannerRetry').onclick=retry||null;
  $('banner').classList.remove('hidden');
}
function hideBanner(){$('banner').classList.add('hidden');}
function showAiUndo(){
  clearTimeout(aiUndoTimer);$('aiUndoToast').classList.remove('hidden');aiUndoTimer=setTimeout(hideAiUndo,5000);
}
function hideAiUndo(){$('aiUndoToast').classList.add('hidden');}

function moveAiPen(worldPoint){
  if(!worldPoint)return;const s=board.worldToScreen(worldPoint.x,worldPoint.y);const el=$('aiPen');el.style.left=`${s.x}px`;el.style.top=`${s.y}px`;el.classList.remove('hidden');
}
function hideAiPen(){$('aiPen').classList.add('hidden');}

function exportCanvas(){
  const a=document.createElement('a');a.href=board.captureViewport(2200);a.download=`coink-${sessionId}-${new Date().toISOString().replace(/[:.]/g,'-')}.png`;document.body.appendChild(a);a.click();a.remove();log('export',{});
}

function log(event,payload){
  fetch('/api/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,event,payload}),keepalive:true}).catch(()=>{});
}

function sanitize(v){return String(v||'').replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80)||'anonymous';}
