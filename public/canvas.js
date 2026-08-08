import { layoutHandwriting, makeCheckStroke, strokeLength, getStrokeBounds, AI_HAND_DEFAULTS } from './handwriting.js';

const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const now = () => performance.now();
// Storage namespace + session id are set by the host app so both CoInk and
// StudyInk can share this engine file verbatim.
const NS = () => globalThis.__INK_NS__ || 'coink';
const SID = () => globalThis.__INK_SESSION_ID__ || globalThis.__COINK_SESSION_ID__;

export class CanvasBoard extends EventTarget {
  constructor(canvas, overlay) {
    super();
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = canvas.getContext('2d', { alpha:false });
    this.octx = overlay.getContext('2d');
    this.dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    this.view = { x: -80, y: -40, scale: 1 };
    this.strokes = [];
    this.current = null;
    this.transientAi = null;
    this.tool = 'pen';
    this.penWidth = 3.0;
    this.humanColor = '#17191d';
    this.aiColor = AI_HAND_DEFAULTS.ink;
    this.pointerMap = new Map();
    this.panState = null;
    this.pinchState = null;
    this.history = [];
    this.maxHistory = 40;
    this.lastAiGroupId = null;
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement);
    this.bind();
    this.resize();
  }

  bind() {
    this.canvas.style.touchAction = 'none';
    this.overlay.style.pointerEvents = 'none';
    this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', e => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', e => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', e => this.onPointerUp(e));
    this.canvas.addEventListener('wheel', e => this.onWheel(e), {passive:false});
    window.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='z') { e.preventDefault(); this.undo(); }
    });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(320, rect.width), h = Math.max(320, rect.height);
    for (const c of [this.canvas, this.overlay]) {
      c.style.width = `${w}px`; c.style.height = `${h}px`;
      c.width = Math.round(w*this.dpr); c.height = Math.round(h*this.dpr);
    }
    this.cssWidth=w; this.cssHeight=h;
    this.render();
  }

  setTool(tool) { this.tool = tool; this.dispatchEvent(new CustomEvent('toolchange',{detail:{tool}})); }
  setPenWidth(w) { this.penWidth = clamp(Number(w)||3, 1, 12); }
  setPenColor(c) { this.humanColor = c; }

  screenToWorld(sx,sy){ return {x:this.view.x+sx/this.view.scale,y:this.view.y+sy/this.view.scale}; }
  worldToScreen(x,y){ return {x:(x-this.view.x)*this.view.scale,y:(y-this.view.y)*this.view.scale}; }

  eventPoint(e) {
    const r=this.canvas.getBoundingClientRect();
    return {x:e.clientX-r.left,y:e.clientY-r.top};
  }

  snapshotHistory() {
    this.history.push(JSON.stringify(this.strokes));
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  onPointerDown(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    const sp=this.eventPoint(e);
    this.pointerMap.set(e.pointerId,{...sp,type:e.pointerType});
    this.dispatchEvent(new CustomEvent('humaninputstart',{detail:{pointerType:e.pointerType}}));

    // Apple Pencil/pen draws; touch pans even while Pen is selected.
    const shouldPan = this.tool==='pan' || (e.pointerType==='touch' && this.tool!=='eraser');
    if (shouldPan) {
      if (e.pointerType==='touch' && this.touchPointers().length>=2) this.beginPinch();
      else this.panState={pointerId:e.pointerId,start:sp,origin:{x:this.view.x,y:this.view.y}};
      return;
    }
    if (this.tool==='eraser') { this.snapshotHistory(); this.eraseAt(sp); return; }

    this.snapshotHistory();
    const wp=this.screenToWorld(sp.x,sp.y);
    this.current={
      id:crypto.randomUUID(), author:'human', groupId:null, color:this.humanColor, width:this.penWidth,
      points:[{x:wp.x,y:wp.y,p:this.normalizedPressure(e),t:now()}]
    };
    this.render();
  }

  onPointerMove(e) {
    const sp=this.eventPoint(e);
    if (this.pointerMap.has(e.pointerId)) this.pointerMap.set(e.pointerId,{...sp,type:e.pointerType});

    if (this.pinchState && e.pointerType==='touch') { this.updatePinch(); return; }
    if (this.panState?.pointerId===e.pointerId) {
      const dx=(sp.x-this.panState.start.x)/this.view.scale;
      const dy=(sp.y-this.panState.start.y)/this.view.scale;
      this.view.x=this.panState.origin.x-dx; this.view.y=this.panState.origin.y-dy;
      this.render(); return;
    }
    if (this.tool==='eraser' && e.buttons) { this.eraseAt(sp); return; }
    if (!this.current || !e.buttons) return;
    const wp=this.screenToWorld(sp.x,sp.y);
    const last=this.current.points[this.current.points.length-1];
    if (Math.hypot(wp.x-last.x,wp.y-last.y) < 0.65/this.view.scale) return;
    this.current.points.push({x:wp.x,y:wp.y,p:this.normalizedPressure(e),t:now()});
    this.render();
  }

  onPointerUp(e) {
    this.pointerMap.delete(e.pointerId);
    if (this.pinchState && this.touchPointers().length<2) this.pinchState=null;
    if (this.panState?.pointerId===e.pointerId) this.panState=null;
    if (this.current) {
      const stroke=this.current; this.current=null;
      if (stroke.points.length===1) {
        const p=stroke.points[0]; stroke.points.push({...p,x:p.x+0.01});
      }
      this.strokes.push(stroke);
      this.render();
      this.dispatchEvent(new CustomEvent('strokeend',{detail:{stroke}}));
      this.saveLocal();
    }
  }

  normalizedPressure(e) {
    if (e.pointerType==='pen') return clamp(e.pressure || .45,.08,1);
    return .5;
  }

  touchPointers(){ return [...this.pointerMap.entries()].filter(([,p])=>p.type==='touch'); }
  beginPinch(){
    const pts=this.touchPointers().slice(0,2).map(([,p])=>p);
    if(pts.length<2)return;
    const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
    const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
    this.pinchState={dist,scale:this.view.scale,world:this.screenToWorld(mid.x,mid.y),mid}; this.panState=null;
  }
  updatePinch(){
    const pts=this.touchPointers().slice(0,2).map(([,p])=>p); if(pts.length<2)return;
    const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
    const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
    const ns=clamp(this.pinchState.scale*(dist/Math.max(1,this.pinchState.dist)),.25,4.5);
    this.view.scale=ns;
    this.view.x=this.pinchState.world.x-mid.x/ns;
    this.view.y=this.pinchState.world.y-mid.y/ns;
    this.render();
  }

  onWheel(e){
    e.preventDefault(); const sp=this.eventPoint(e); const before=this.screenToWorld(sp.x,sp.y);
    const factor=Math.exp(-e.deltaY*0.0012); const ns=clamp(this.view.scale*factor,.25,4.5);
    this.view.scale=ns; this.view.x=before.x-sp.x/ns; this.view.y=before.y-sp.y/ns; this.render();
  }

  eraseAt(sp){
    const wp=this.screenToWorld(sp.x,sp.y), radius=18/this.view.scale;
    const before=this.strokes.length;
    this.strokes=this.strokes.filter(s=>!s.points.some(p=>Math.hypot(p.x-wp.x,p.y-wp.y)<radius));
    if(this.strokes.length!==before){this.render();this.saveLocal();this.dispatchEvent(new CustomEvent('erase'));}
  }

  undo(){
    if(!this.history.length)return;
    this.strokes=JSON.parse(this.history.pop()); this.render(); this.saveLocal();
    this.dispatchEvent(new CustomEvent('undo'));
  }
  undoLastAI(){
    if(!this.lastAiGroupId)return;
    this.snapshotHistory();
    const g=this.lastAiGroupId; this.strokes=this.strokes.filter(s=>s.groupId!==g); this.lastAiGroupId=null;
    this.render(); this.saveLocal(); this.dispatchEvent(new CustomEvent('undoai',{detail:{groupId:g}}));
  }
  clear(){ this.snapshotHistory(); this.strokes=[]; this.current=null; this.transientAi=null; this.render(); this.saveLocal(); this.dispatchEvent(new CustomEvent('clear')); }

  addAIStroke(stroke){ this.strokes.push(stroke); this.lastAiGroupId=stroke.groupId || this.lastAiGroupId; this.render(); }
  setTransientAI(stroke){ this.transientAi=stroke; this.render(); }
  clearTransientAI(){ this.transientAi=null; this.render(); }

  render(){
    const ctx=this.ctx, d=this.dpr;
    ctx.setTransform(d,0,0,d,0,0);
    ctx.fillStyle='#fbfbfa'; ctx.fillRect(0,0,this.cssWidth,this.cssHeight);
    this.drawGrid(ctx);
    const all=[...this.strokes]; if(this.current)all.push(this.current);
    for(const s of all)this.drawStroke(ctx,s);

    const o=this.octx; o.setTransform(d,0,0,d,0,0); o.clearRect(0,0,this.cssWidth,this.cssHeight);
    if(this.transientAi)this.drawStroke(o,this.transientAi);
  }

  drawGrid(ctx){
    const spacing=36*this.view.scale;
    if(spacing<10)return;
    const ox=(-this.view.x*this.view.scale)%spacing, oy=(-this.view.y*this.view.scale)%spacing;
    ctx.save(); ctx.strokeStyle='#e9ecef'; ctx.lineWidth=1;
    ctx.beginPath();
    for(let x=ox;x<this.cssWidth;x+=spacing){ctx.moveTo(x,0);ctx.lineTo(x,this.cssHeight);}
    for(let y=oy;y<this.cssHeight;y+=spacing){ctx.moveTo(0,y);ctx.lineTo(this.cssWidth,y);}
    ctx.stroke(); ctx.restore();
  }

  drawStroke(ctx,s,viewOverride){
    const view=viewOverride||this.view;
    const w2s=(x,y)=>({x:(x-view.x)*view.scale,y:(y-view.y)*view.scale});
    const pts=s.points||[]; if(pts.length<2)return;
    ctx.save(); ctx.strokeStyle=s.color||this.humanColor; ctx.lineCap='round'; ctx.lineJoin='round';
    for(let i=1;i<pts.length;i++){
      const a=w2s(pts[i-1].x,pts[i-1].y), b=w2s(pts[i].x,pts[i].y);
      const p=((pts[i-1].p??.5)+(pts[i].p??.5))/2;
      ctx.lineWidth=Math.max(.8,(s.width||3)*(0.58+p*.84)*view.scale);
      ctx.beginPath(); ctx.moveTo(a.x,a.y);
      const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
      if(i>1)ctx.quadraticCurveTo(a.x,a.y,mx,my); else ctx.lineTo(b.x,b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Plain screenshot of what the participant sees (for export). */
  captureViewport(maxWidth=1100){
    const source=document.createElement('canvas'); source.width=this.canvas.width; source.height=this.canvas.height;
    const sctx=source.getContext('2d'); sctx.drawImage(this.canvas,0,0);
    const target=document.createElement('canvas');
    const ratio=Math.min(1,maxWidth/(this.cssWidth*this.dpr));
    target.width=Math.max(1,Math.round(source.width*ratio)); target.height=Math.max(1,Math.round(source.height*ratio));
    target.getContext('2d').drawImage(source,0,0,target.width,target.height);
    return target.toDataURL('image/png');
  }

  /** Cluster visible strokes into labeled ink regions the model can target by ID. */
  computeInventory(){
    const W=this.cssWidth, H=this.cssHeight;
    const inflate=25;
    const items=[];
    this.strokes.forEach((s,idx)=>{
      const b=getStrokeBounds([s]); if(!b)return;
      // skip strokes fully outside the visible viewport
      const tl=this.worldToScreen(b.minX,b.minY), br=this.worldToScreen(b.maxX,b.maxY);
      if(br.x<-40||br.y<-40||tl.x>W+40||tl.y>H+40)return;
      items.push({box:{minX:b.minX-inflate,minY:b.minY-inflate,maxX:b.maxX+inflate,maxY:b.maxY+inflate},
        author:s.author==='ai'?'tutor':'student', order:idx, count:1});
    });
    // merge overlapping boxes of the same author until stable
    let merged=true;
    while(merged){
      merged=false;
      outer: for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
        const a=items[i],b=items[j];
        if(a.author!==b.author)continue;
        if(a.box.minX<=b.box.maxX&&b.box.minX<=a.box.maxX&&a.box.minY<=b.box.maxY&&b.box.minY<=a.box.maxY){
          a.box={minX:Math.min(a.box.minX,b.box.minX),minY:Math.min(a.box.minY,b.box.minY),
                 maxX:Math.max(a.box.maxX,b.box.maxX),maxY:Math.max(a.box.maxY,b.box.maxY)};
          a.order=Math.max(a.order,b.order); a.count+=b.count;
          items.splice(j,1); merged=true; break outer;
        }
      }
    }
    items.sort((a,b)=>a.order-b.order);
    const toNorm=(x,y)=>{const s=this.worldToScreen(x,y);return [Math.round(s.x/W*1000),Math.round(s.y/H*1000)];};
    return items.slice(-14).map((it,i)=>{
      const d=inflate*0.6; // report the tight-ish box, keep the inflated one for anchoring
      const [x1,y1]=toNorm(it.box.minX+d,it.box.minY+d), [x2,y2]=toNorm(it.box.maxX-d,it.box.maxY-d);
      return { id:`s${i+1}`, author:it.author, strokes:it.count,
        norm:[clamp(x1,0,1000),clamp(y1,0,1000),clamp(x2,0,1000),clamp(y2,0,1000)],
        worldBox:{minX:it.box.minX+d,minY:it.box.minY+d,maxX:it.box.maxX-d,maxY:it.box.maxY-d} };
    });
  }

  /**
   * Snapshot for the model: clean re-render + burned-in coordinate grid, plus the
   * ink inventory and the view transform pinned at capture time so later plans
   * resolve against THIS view even if the student pans/zooms meanwhile.
   */
  captureForModel(maxWidth=1050){
    const W=this.cssWidth,H=this.cssHeight;
    const ratio=Math.min(1,maxWidth/W);
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(W*ratio)); c.height=Math.max(1,Math.round(H*ratio));
    const q=c.getContext('2d');
    q.fillStyle='#ffffff'; q.fillRect(0,0,c.width,c.height);
    q.save(); q.scale(ratio,ratio);
    for(const s of this.strokes)this.drawStroke(q,s);
    if(this.current)this.drawStroke(q,this.current);
    q.restore();
    // burn a labeled 0-1000 coordinate grid so the model can localize precisely
    q.save();
    q.strokeStyle='rgba(70,110,180,0.16)'; q.lineWidth=1;
    q.fillStyle='rgba(70,110,180,0.55)'; q.font='9px ui-monospace,monospace';
    for(let n=100;n<1000;n+=100){
      const gx=(n/1000)*c.width, gy=(n/1000)*c.height;
      q.beginPath(); q.moveTo(gx,0); q.lineTo(gx,c.height); q.stroke();
      q.beginPath(); q.moveTo(0,gy); q.lineTo(c.width,gy); q.stroke();
      q.fillText(String(n),gx+2,9); q.fillText(String(n),2,gy-2);
    }
    q.restore();
    const inventory=this.computeInventory();
    return {
      image:c.toDataURL('image/png'),
      view:{...this.view}, cssWidth:W, cssHeight:H,
      inventory, aspect:+(W/H).toFixed(3)
    };
  }

  inventoryText(inventory){
    if(!inventory?.length)return 'CANVAS INK MAP: (canvas is empty)';
    return 'CANVAS INK MAP — target these IDs with anchor_id for precise placement. Format id:[x1,y1,x2,y2] (0-1000 coords of the snapshot), author:\n'
      + inventory.map(e=>`${e.id}: [${e.norm.join(',')}] ${e.author}`).join('\n')
      + `\nSnapshot aspect ratio (w/h): ${ (this.cssWidth/this.cssHeight).toFixed(2) }`;
  }

  normalizedToWorld(x,y){ return this.screenToWorld((x/1000)*this.cssWidth,(y/1000)*this.cssHeight); }

  /** Bounding boxes of student ink, for collision avoidance. */
  studentInkBoxes(){
    return this.strokes.filter(s=>s.author!=='ai').map(s=>getStrokeBounds([s])).filter(Boolean);
  }

  makeActionStrokes(action, groupId, cap) {
    cap = cap || { view:{...this.view}, cssWidth:this.cssWidth, cssHeight:this.cssHeight, inventory:[] };
    const view=cap.view, scale=view.scale;
    const color=this.aiColor;
    const point=(nx,ny)=>({x:view.x+(nx/1000)*cap.cssWidth/scale, y:view.y+(ny/1000)*cap.cssHeight/scale});
    const normLen=(n,axis)=> (n/1000)*(axis==='x'?cap.cssWidth:cap.cssHeight)/scale;
    const simple=(pts,width=2.2)=>[{id:crypto.randomUUID(),author:'ai',groupId,color,width:width/scale,points:pts.map(p=>({x:p.x,y:p.y,p:.58,t:0}))}];
    const anchor = action.anchor_id ? cap.inventory?.find(e=>e.id===action.anchor_id) : null;
    const pad=14/scale;

    if(action.type==='circle'){
      let cx,cy,rx,ry;
      if(anchor){
        const b=anchor.worldBox;
        cx=(b.minX+b.maxX)/2; cy=(b.minY+b.maxY)/2;
        rx=Math.max(22/scale,(b.maxX-b.minX)/2+pad*1.6); ry=Math.max(16/scale,(b.maxY-b.minY)/2+pad*1.6);
      } else if(action.cx||action.cy){
        const c0=point(action.cx,action.cy); cx=c0.x; cy=c0.y;
        rx=Math.max(20/scale,normLen(action.rx||60,'x')); ry=Math.max(14/scale,normLen(action.ry||40,'y'));
      } else { // legacy top-left + w/h form
        const c0=point((action.x||0)+(action.w||120)/2,(action.y||0)+(action.h||70)/2);
        cx=c0.x; cy=c0.y; rx=Math.max(20/scale,normLen((action.w||120)/2,'x')); ry=Math.max(14/scale,normLen((action.h||70)/2,'y'));
      }
      const pts=[]; for(let i=0;i<=40;i++){const a=(i/40)*Math.PI*2 - 0.4;pts.push({x:cx+Math.cos(a)*rx,y:cy+Math.sin(a)*ry});}
      return simple(pts,2.15);
    }
    if(action.type==='underline'){
      if(anchor){const b=anchor.worldBox;return simple([{x:b.minX-pad*0.5,y:b.maxY+pad*0.7},{x:b.maxX+pad*0.5,y:b.maxY+pad*0.9}],2.3);}
      const a=point(action.x1,action.y1),b2=point(action.x2,action.y2);
      return simple([a,b2],2.3);
    }
    if(action.type==='arrow'){
      let from,to;
      if(anchor){
        const b=anchor.worldBox; to={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};
        const side=action.anchor_position||'left';
        const off=110/scale;
        from = side==='above'?{x:to.x,y:b.minY-off}: side==='below'?{x:to.x,y:b.maxY+off}
             : side==='right'?{x:b.maxX+off,y:to.y}:{x:b.minX-off,y:to.y};
        if(action.x1||action.y1){const f=point(action.x1,action.y1); from=f;}
      }else{ from=point(action.x1,action.y1); to=point(action.x2,action.y2); }
      const ang=Math.atan2(to.y-from.y,to.x-from.x),L=16/scale;
      return simple([from,to],2.2)
        .concat(simple([to,{x:to.x-Math.cos(ang-.55)*L,y:to.y-Math.sin(ang-.55)*L}],2.2))
        .concat(simple([to,{x:to.x-Math.cos(ang+.55)*L,y:to.y-Math.sin(ang+.55)*L}],2.2));
    }
    if(action.type==='check'||action.type==='cross'){
      let p;
      if(anchor){const b=anchor.worldBox;p={x:b.maxX+pad*1.6,y:(b.minY+b.maxY)/2-((action.size||34)/scale)/2};}
      else p=point(action.x,action.y);
      const sz=(action.size||34)/scale;
      if(action.type==='check')return makeCheckStroke(p.x,p.y,sz,{groupId,color,width:2.3/scale});
      return simple([{x:p.x,y:p.y},{x:p.x+sz,y:p.y+sz}],2.3).concat(simple([{x:p.x+sz,y:p.y},{x:p.x,y:p.y+sz}],2.3));
    }
    if(action.type==='handwrite'||action.type==='write'){
      const fontPx=clamp(action.size||34,20,52);
      const fontWorld=fontPx/scale;
      const maxW=Math.max(90,(action.max_width||420)/scale);
      const text=String(action.text||'').slice(0,120);
      let p;
      if(anchor){
        const b=anchor.worldBox, pos=action.anchor_position||'below';
        const estH=fontWorld*1.7, estW=Math.min(maxW,text.length*fontWorld*0.52);
        p = pos==='above'?{x:b.minX,y:b.minY-estH-pad}
          : pos==='right'?{x:b.maxX+pad*1.4,y:(b.minY+b.maxY)/2-fontWorld*0.6}
          : pos==='left' ?{x:b.minX-estW-pad*1.4,y:(b.minY+b.maxY)/2-fontWorld*0.6}
          : pos==='on'   ?{x:(b.minX+b.maxX)/2-estW/2,y:(b.minY+b.maxY)/2-fontWorld*0.6}
          : {x:b.minX,y:b.maxY+pad};
      } else p=point(action.x,action.y);
      // collision nudge: shift into free space if the layout overlaps student ink
      const layoutAt=(x,y)=>layoutHandwriting(text,{x,y,fontSize:fontWorld,maxWidth:maxW,groupId,color,width:2.15/scale,seed:`coink-ai-hand-v1|${groupId}`});
      const boxes=this.studentInkBoxes();
      const collides=b=>b&&boxes.some(sb=>b.minX<=sb.maxX+6&&sb.minX<=b.maxX+6&&b.minY<=sb.maxY+6&&sb.minY<=b.maxY+6);
      const step=fontWorld*1.35;
      const offsets=[[0,0],[0,step],[0,-step*1.4],[step*2,0],[0,step*2],[-step*2,0],[step*2,step],[0,step*3]];
      let chosen=null;
      for(const [dx,dy] of offsets){
        const L=layoutAt(p.x+dx,p.y+dy);
        if(!collides(L.bounds)){chosen=L;break;}
        if(!chosen)chosen=L;
      }
      return chosen.strokes;
    }
    return [];
  }

  applyPlan(plan, animator, cap){
    const groupId=`ai-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const strokes=(plan.actions||[]).flatMap(a=>{try{return this.makeActionStrokes(a,groupId,cap);}catch(e){console.warn('action failed',a,e);return [];}});
    this.lastAiGroupId=groupId;
    return animator.play(strokes,groupId);
  }

  saveLocal(sessionId=SID()){
    if(!sessionId)return;
    try{localStorage.setItem(`${NS()}:${sessionId}`,JSON.stringify({strokes:this.strokes,view:this.view,savedAt:Date.now()}));}catch{}
  }
  loadLocal(sessionId=SID()){
    if(!sessionId)return false;
    try{const raw=localStorage.getItem(`${NS()}:${sessionId}`);if(!raw)return false;const v=JSON.parse(raw);this.strokes=Array.isArray(v.strokes)?v.strokes:[];if(v.view)this.view=v.view;this.render();return true;}catch{return false;}
  }
}

export class AIInkAnimator extends EventTarget {
  constructor(board){ super(); this.board=board; this.token=0; this.running=false; }
  cancel(reason='interrupted'){
    if(!this.running)return;
    this.token++; this.running=false; this.board.clearTransientAI();
    this.dispatchEvent(new CustomEvent('cancel',{detail:{reason}}));
  }
  async play(strokes,groupId){
    if(!strokes?.length)return {completed:true,strokes:0};
    this.cancel('superseded');
    const token=++this.token; this.running=true;
    this.dispatchEvent(new CustomEvent('start',{detail:{groupId,count:strokes.length}}));
    let completed=0;
    for(const stroke of strokes){
      if(token!==this.token)return {completed:false,strokes:completed};
      const pts=stroke.points||[]; if(pts.length<2)continue;
      const len=Math.max(1,strokeLength(stroke));
      const speedWorld=AI_HAND_DEFAULTS.speedPxPerSec/this.board.view.scale;
      const duration=Math.max(70,Math.min(1800,(len/speedWorld)*1000));
      const start=performance.now();
      while(true){
        if(token!==this.token)return {completed:false,strokes:completed};
        const p=Math.min(1,(performance.now()-start)/duration);
        const count=Math.max(2,Math.ceil(p*(pts.length-1))+1);
        const partial = pts.slice(0,count);
        this.board.setTransientAI({...stroke,points:partial});
        this.dispatchEvent(new CustomEvent('progress',{detail:{point:partial[partial.length-1],groupId}}));
        if(p>=1)break;
        await new Promise(r=>requestAnimationFrame(r));
      }
      this.board.clearTransientAI(); this.board.addAIStroke(stroke); completed++;
    }
    if(token===this.token){this.running=false;this.board.saveLocal();this.dispatchEvent(new CustomEvent('done',{detail:{groupId,count:completed}}));}
    return {completed:true,strokes:completed};
  }
}
