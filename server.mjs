import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(__dirname, '.env'));

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3888);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();
const TUTOR_MODEL = process.env.OPENAI_TUTOR_MODEL || 'gpt-5.6-terra';
const TUTOR_REASONING = process.env.OPENAI_TUTOR_REASONING || 'medium';
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'marin';
const VAD_EAGERNESS = process.env.VAD_EAGERNESS || 'auto';
const AUTO_AI_DELAY_MS = Number(process.env.AUTO_AI_DELAY_MS || 1100);
const DAILY_CALL_CAP = Number(process.env.DAILY_CALL_CAP || 1500);
const LOG_SESSIONS = process.env.LOG_SESSIONS !== '0';
const LOG_STROKE_POINTS = process.env.LOG_STROKE_POINTS !== '0';
const publicDir = path.join(__dirname, 'public');
const sessionDir = path.join(__dirname, 'data', 'sessions');
fs.mkdirSync(sessionDir, { recursive: true });

// ---------- auth (PenEcho-style access code -> HttpOnly cookie) ----------
const SESSION_SIG = ACCESS_CODE ? crypto.createHash('sha256').update(`coink-auth|${ACCESS_CODE}`).digest('hex').slice(0,40) : '';
const authAttempts = new Map(); // ip -> {n, resetAt}
function clientIp(req){ return String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown'); }
function cookies(req){
  const out={}; for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('='); if(i>0) out[part.slice(0,i).trim()]=part.slice(i+1).trim();
  } return out;
}
function attemptAllowed(ip){
  const now=Date.now(); const rec=authAttempts.get(ip);
  if(!rec || now>rec.resetAt){ authAttempts.set(ip,{n:0,resetAt:now+10*60_000}); return true; }
  return rec.n<10;
}
function recordAttempt(ip){ const rec=authAttempts.get(ip); if(rec)rec.n++; }
function isAuthed(req){
  if(!ACCESS_CODE) return true;
  if(cookies(req).coink_sid===SESSION_SIG) return true;
  const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  return bearer===ACCESS_CODE;
}
function loginPage(res, msg=''){
  const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CoInk — enter code</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f7f7f5;font-family:-apple-system,system-ui,sans-serif">
<form style="background:#fff;border:1px solid #dfe3e8;border-radius:18px;padding:32px;box-shadow:0 20px 60px rgba(16,24,40,.12);text-align:center;max-width:320px">
<div style="width:44px;height:44px;border-radius:12px;background:#2f6fed;color:#fff;display:grid;place-items:center;font-size:24px;margin:0 auto 14px">✎</div>
<h1 style="font-size:19px;margin:0 0 6px">CoInk Tutor</h1>
<p style="color:#6c737f;font-size:13px;margin:0 0 16px">Enter the access code to open the canvas.</p>
${msg?`<p style="color:#b42318;font-size:12px;margin:0 0 10px">${msg}</p>`:''}
<input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" style="width:100%;box-sizing:border-box;font-size:20px;letter-spacing:.3em;text-align:center;padding:10px;border:1px solid #dfe3e8;border-radius:10px" autofocus>
<button style="margin-top:12px;width:100%;padding:10px;border:0;border-radius:10px;background:#2f6fed;color:#fff;font-size:14px;font-weight:600;cursor:pointer">Open canvas</button>
</form></body>`;
  res.writeHead(401,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(html);
}

// ---------- rate limiting + daily cost cap ----------
const buckets = new Map(); // ip -> {tokens, ts}
function rateOk(ip, cost=1){
  const now=Date.now(); let b=buckets.get(ip);
  if(!b){ b={tokens:30,ts:now}; buckets.set(ip,b); }
  b.tokens=Math.min(30, b.tokens + (now-b.ts)/60000*10); b.ts=now;
  if(b.tokens<cost) return false;
  b.tokens-=cost; return true;
}
let costDay='', costCalls=0;
function costOk(){
  const today=new Date().toISOString().slice(0,10);
  if(today!==costDay){ costDay=today; costCalls=0; }
  if(costCalls>=DAILY_CALL_CAP) return false;
  costCalls++; return true;
}

// ---------- realtime session ----------
const CANVAS_TOOL = {
  type:'function', name:'canvas_action',
  description:'Write or draw on the shared canvas in your own blue handwriting, at the same time as you speak. Coordinates are 0-1000 over the snapshot you last received (top-left 0,0). STRONGLY prefer anchor_id from the CANVAS INK MAP over raw coordinates — anchored actions land exactly on the ink they reference.',
  parameters:{
    type:'object',
    properties:{
      actions:{
        type:'array', maxItems:6,
        items:{
          type:'object',
          properties:{
            type:{type:'string',enum:['handwrite','circle','arrow','underline','check','cross']},
            text:{type:'string',description:'handwrite only; 2-8 words, max 45 chars'},
            anchor_id:{type:'string',description:'An id from the CANVAS INK MAP (e.g. "s3"). Positions the action on/near that ink cluster.'},
            anchor_position:{type:'string',enum:['above','below','left','right','on'],description:'Where to place relative to the anchor (handwrite/arrow). Default below.'},
            x:{type:'number'},y:{type:'number'},
            x1:{type:'number'},y1:{type:'number'},x2:{type:'number'},y2:{type:'number'},
            cx:{type:'number',description:'circle center x'},cy:{type:'number',description:'circle center y'},
            rx:{type:'number',description:'circle x-radius (0-1000 units)'},ry:{type:'number'},
            size:{type:'number'},max_width:{type:'number'}
          },
          required:['type']
        }
      }
    },
    required:['actions']
  }
};

const REALTIME_INSTRUCTIONS = `You are CoInk, a live study tutor sharing a handwritten canvas with a student. The mic is always on and you are in a continuous, natural spoken conversation — like sitting beside the student, not a push-to-talk assistant. Talk like a real conversation partner: short, warm, responsive turns, casual acknowledgements ("mm-hm", "got it", "okay so..."), and genuine back-and-forth. Ask quick follow-up questions when it helps you understand where the student is stuck. Never claim to be human.

You can also WRITE on the shared canvas by calling canvas_action — your handwriting appears in blue ink beside the student's work. Use it whenever a visual mark communicates better than words: circle a specific error, underline the key term, write a short hint (2-8 words), draw an arrow, add a check mark. Speak and draw together naturally — say "let me circle that" only if you are actually calling canvas_action to do it. Never announce ink you don't produce.

Canvas snapshots arrive as silent context items with a CANVAS INK MAP listing ink clusters by id with their positions. When you draw, prefer anchor_id targeting from that map — it places your ink exactly on the referenced cluster. Only use raw 0-1000 coordinates when no listed cluster fits. Never cover the student's ink; place notes in nearby empty space.

Silently re-derive every visible arithmetic/algebraic step before commenting — a mistake may be several lines back, not in the newest line. Prefer Socratic guidance over giving the complete answer. If the student is working productively, let them think — brief silence is fine. When correcting an error, identify the exact local issue and give the smallest useful next step. Keep most spoken turns under 15 seconds unless a fuller explanation is requested. Dark/black ink is the student's writing; blue ink is yours. If a silent canvas-context message arrives, absorb it and do not respond to it alone. If the student trails off, interrupts, or talks over you, yield immediately.`;

async function createRealtimeCall(sdp) {
  if (!OPENAI_API_KEY) throw Object.assign(new Error('OPENAI_API_KEY is not configured on the server.'),{status:503});
  const session = {
    type:'realtime', model:REALTIME_MODEL, output_modalities:['audio'], instructions:REALTIME_INSTRUCTIONS,
    max_output_tokens:2400,
    tools:[CANVAS_TOOL], tool_choice:'auto',
    audio:{
      input:{
        noise_reduction:{type:'near_field'},
        transcription:{model:'gpt-4o-transcribe',language:'en',prompt:'The speaker may discuss mathematics, calculus, algebra, physics, diagrams, and handwritten notation.'},
        turn_detection:{type:'semantic_vad',eagerness:VAD_EAGERNESS,create_response:true,interrupt_response:true}
      },
      output:{voice:REALTIME_VOICE,speed:1.0}
    }
  };
  const form = new FormData();
  form.append('sdp', sdp);
  form.append('session', JSON.stringify(session));
  const r = await fetch('https://api.openai.com/v1/realtime/calls', {
    method:'POST', headers:{'Authorization':`Bearer ${OPENAI_API_KEY}`}, body:form, signal:AbortSignal.timeout(25_000)
  });
  const answer = await r.text();
  if (!r.ok) throw Object.assign(new Error(`OpenAI Realtime call failed (${r.status}): ${answer.slice(0,1000)}`),{status:502});
  return answer;
}

// ---------- silent auto-tutor planner ----------
const ACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['handwrite','circle','arrow','underline','check','cross'] },
    text: { type: 'string' },
    anchor_id: { type: 'string' },
    anchor_position: { type: 'string', enum: ['above','below','left','right','on',''] },
    x: { type: 'number', minimum: 0, maximum: 1000 },
    y: { type: 'number', minimum: 0, maximum: 1000 },
    x1: { type: 'number', minimum: 0, maximum: 1000 },
    y1: { type: 'number', minimum: 0, maximum: 1000 },
    x2: { type: 'number', minimum: 0, maximum: 1000 },
    y2: { type: 'number', minimum: 0, maximum: 1000 },
    cx: { type: 'number', minimum: 0, maximum: 1000 },
    cy: { type: 'number', minimum: 0, maximum: 1000 },
    rx: { type: 'number', minimum: 0, maximum: 1000 },
    ry: { type: 'number', minimum: 0, maximum: 1000 },
    size: { type: 'number', minimum: 18, maximum: 54 },
    max_width: { type: 'number', minimum: 80, maximum: 700 }
  },
  required: ['type','text','anchor_id','anchor_position','x','y','x1','y1','x2','y2','cx','cy','rx','ry','size','max_width']
};

// Field order matters: strict structured outputs are generated in schema order, so
// `derivation` must come BEFORE `intervene` — it forces the model to actually work
// the arithmetic out before it commits to a yes/no. With the boolean first the model
// answers, then reasons, and silently misses errors it would otherwise have caught.
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    derivation: { type: 'string', description: 'Work every visible step yourself here first, top to bottom, and state whether each matches the student\'s written result.' },
    canvas_summary: { type: 'string' },
    intervene: { type: 'boolean' },
    speech: { type: 'string' },
    actions: { type: 'array', maxItems: 3, items: ACTION_SCHEMA }
  },
  required: ['derivation','canvas_summary','intervene','speech','actions']
};

const TUTOR_SYSTEM = `You control the handwriting and visual gestures of a realtime tutor on a student's shared canvas. The image is exactly the visible canvas with a faint labeled 0-1000 coordinate grid burned in for your reference. Dark/black ink belongs to the student. Blue ink is the tutor's previous writing.

Your job is not to make a chat response. Decide whether a small on-canvas intervention would genuinely help. Prefer silence. Never react to every stroke. Never cover important student work. Keep handwriting short: usually 2-8 words, at most 45 characters per handwrite action. Use circles/arrows/underlines/checkmarks when spatial reference is clearer than prose. Never solve more than one conceptual step ahead unless the user explicitly asked for the answer. If the student is correct and progressing, intervene=false is often best.

Before deciding, silently re-derive every arithmetic/algebraic step visible on the canvas yourself, left to right, top to bottom — do not just skim the most recent line. A student can make a mistake several steps back even if a later step's transcription looks fine. If any step's result does not match your own computation, that is the one to flag.

TARGETING — you will receive a CANVAS INK MAP listing ink clusters by id and box. STRONGLY prefer setting anchor_id to a map id: anchored actions land exactly on that ink. anchor_position controls placement for handwrite ('below' default) and arrow origin side. When no cluster fits, use raw coordinates: circle takes CENTER cx,cy with radii rx,ry; underline/arrow take x1,y1 -> x2,y2; handwrite/check/cross take x,y as anchor point. Set unused fields to 0 or ''.`;

async function callTutor(payload) {
  if (!OPENAI_API_KEY) throw Object.assign(new Error('OPENAI_API_KEY is not configured on the server.'),{status:503});
  const image = String(payload.image || '');
  if (!image.startsWith('data:image/')) throw Object.assign(new Error('Canvas image is missing.'),{status:400});
  const source = ['auto','manual_hint','manual_check'].includes(payload.source) ? payload.source : 'auto';
  const transcript = String(payload.transcript || '').slice(0,2500);
  const inkMap = String(payload.inkMap || '').slice(0,2000);
  const requestText = `Source: ${source}\n${transcript ? `Relevant spoken transcript: ${transcript}\n` : ''}${inkMap?`${inkMap}\n`:''}Canvas aspect ratio (w/h): ${Number(payload.aspect)||'unknown'}.\nReturn the minimal tutor ink plan.`;
  const body = {
    model: TUTOR_MODEL,
    reasoning: { effort: TUTOR_REASONING },
    safety_identifier: safetyId(payload.sessionId),
    max_output_tokens: 2400,
    input: [{ role:'user', content:[
      { type:'input_text', text:`${TUTOR_SYSTEM}\n\n${requestText}` },
      { type:'input_image', image_url:image, detail:'high' }
    ]}],
    text: { format: { type:'json_schema', name:'coink_tutor_plan', strict:true, schema:PLAN_SCHEMA } }
  };
  const r = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{'Authorization':`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify(body), signal:AbortSignal.timeout(55_000)
  });
  const raw = await r.text();
  if (!r.ok) throw Object.assign(new Error(`OpenAI tutor request failed (${r.status}): ${raw.slice(0,900)}`),{status:502});
  let response; try{response=JSON.parse(raw);}catch{throw Object.assign(new Error('OpenAI returned invalid JSON.'),{status:502});}
  const text = extractResponseText(response);
  let plan; try{plan=JSON.parse(text);}catch{throw Object.assign(new Error(`Could not parse tutor plan: ${text.slice(0,700)}`),{status:502});}
  return normalizePlan(plan);
}

function extractResponseText(response) {
  if (typeof response.output_text === 'string' && response.output_text) return response.output_text;
  const pieces=[];
  for (const item of response.output || []) {
    for (const c of item.content || []) if (typeof c.text === 'string') pieces.push(c.text);
  }
  if (!pieces.length) throw Object.assign(new Error('Tutor model returned no text output.'),{status:502});
  return pieces.join('');
}
function normalizePlan(plan){
  const actions = Array.isArray(plan.actions) ? plan.actions.slice(0,3).map(a=>({
    type:a.type,text:String(a.text||'').slice(0,120),
    anchor_id:String(a.anchor_id||'').slice(0,12), anchor_position:String(a.anchor_position||'')||undefined,
    x:num(a.x),y:num(a.y),x1:num(a.x1),y1:num(a.y1),x2:num(a.x2),y2:num(a.y2),
    cx:num(a.cx),cy:num(a.cy),rx:num(a.rx),ry:num(a.ry),
    size:Math.max(18,Math.min(54,Number(a.size)||34)), max_width:Math.max(80,Math.min(700,Number(a.max_width)||420))
  })) : [];
  return {intervene:Boolean(plan.intervene)&&actions.length>0,canvas_summary:String(plan.canvas_summary||'').slice(0,1200),derivation:String(plan.derivation||'').slice(0,900),speech:String(plan.speech||'').slice(0,700),actions};
}
function num(v){return Math.max(0,Math.min(1000,Number(v)||0));}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1] in process.env) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
    process.env[m[1]] = v;
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});
  res.end(body);
}
function sendText(res, status, text, type='text/plain; charset=utf-8') {
  res.writeHead(status, {'Content-Type':type,'Content-Length':Buffer.byteLength(text),'Cache-Control':'no-store'}); res.end(text);
}
function readBody(req, maxBytes=8_000_000) {
  return new Promise((resolve,reject)=>{
    const chunks=[]; let n=0;
    req.on('data',c=>{n+=c.length;if(n>maxBytes){reject(Object.assign(new Error('Request too large'),{status:413}));req.destroy();return;}chunks.push(c);});
    req.on('end',()=>resolve(Buffer.concat(chunks)));
    req.on('error',reject);
  });
}
function safeSessionId(v) { return String(v||'anonymous').replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80) || 'anonymous'; }
function safetyId(sessionId){return crypto.createHash('sha256').update(`coink:${safeSessionId(sessionId)}`).digest('hex').slice(0,32);}

// ---------- batched async session logging ----------
const logQueue = new Map(); // sessionId -> lines[]
function logEvent(payload) {
  if(!LOG_SESSIONS)return;
  const sessionId=safeSessionId(payload.sessionId);
  const record={ts:new Date().toISOString(),event:String(payload.event||'unknown'),payload:payload.payload??null};
  if(!LOG_STROKE_POINTS && record.event==='stroke' && record.payload?.points) record.payload={...record.payload,points:`${record.payload.points.length} points omitted`};
  if(!logQueue.has(sessionId))logQueue.set(sessionId,[]);
  logQueue.get(sessionId).push(JSON.stringify(record));
}
setInterval(()=>{
  for(const [sid,lines] of logQueue){
    if(!lines.length)continue;
    const chunk=lines.splice(0).join('\n')+'\n';
    fs.promises.appendFile(path.join(sessionDir,`${sid}.jsonl`),chunk,'utf8').catch(e=>console.error('log flush',e.message));
  }
},2000).unref();

const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
function serveStatic(req,res,urlPath){
  const rel = urlPath==='/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full=path.resolve(publicDir,rel);
  if(!full.startsWith(path.resolve(publicDir)))return sendText(res,403,'Forbidden');
  fs.readFile(full,(err,data)=>{
    if(err){if(err.code==='ENOENT')return sendText(res,404,'Not found');return sendText(res,500,'Read error');}
    res.writeHead(200,{'Content-Type':mime[path.extname(full)]||'application/octet-stream','Content-Length':data.length,'Cache-Control':process.env.NODE_ENV==='production'?'public, max-age=300':'no-store'});res.end(data);
  });
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    const ip=clientIp(req);

    // --- auth gate ---
    if(ACCESS_CODE){
      const supplied=u.searchParams.get('code');
      if(supplied!==null && !isAuthed(req)){
        if(!attemptAllowed(ip)) return sendText(res,429,'Too many attempts. Try again in a few minutes.');
        if(supplied===ACCESS_CODE){
          res.writeHead(302,{'Set-Cookie':`coink_sid=${SESSION_SIG}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30*24*3600}`,'Location':u.pathname});
          return res.end();
        }
        recordAttempt(ip);
        return loginPage(res,'That code is not right.');
      }
      if(!isAuthed(req)){
        if(u.pathname.startsWith('/api/')) return sendJson(res,401,{error:'Access code required.'});
        return loginPage(res);
      }
    }

    if(req.method==='GET'&&u.pathname==='/api/health') return sendJson(res,200,{ok:true,keyConfigured:Boolean(OPENAI_API_KEY),tutorModel:TUTOR_MODEL,realtimeModel:REALTIME_MODEL,realtimeVoice:REALTIME_VOICE,autoAiDelayMs:AUTO_AI_DELAY_MS,logging:LOG_SESSIONS,dailyCallsUsed:costCalls,dailyCallCap:DAILY_CALL_CAP});
    if(req.method==='POST'&&u.pathname==='/api/tutor'){
      if(!rateOk(ip,2)) return sendJson(res,429,{error:'Slow down a moment — too many tutor requests.'});
      if(!costOk()) return sendJson(res,429,{error:'Daily AI call budget reached for this server.'});
      const buf=await readBody(req,8_500_000); let payload; try{payload=JSON.parse(buf.toString('utf8'));}catch{return sendJson(res,400,{error:'Invalid JSON'});}
      const plan=await callTutor(payload); return sendJson(res,200,plan);
    }
    if(req.method==='POST'&&u.pathname==='/api/realtime/call'){
      if(!rateOk(ip,5)) return sendText(res,429,'Too many session starts; wait a minute.');
      if(!costOk()) return sendText(res,429,'Daily AI call budget reached for this server.');
      const sdp=(await readBody(req,250_000)).toString('utf8'); if(!sdp.includes('v=0'))return sendText(res,400,'Invalid SDP offer.');
      const answer=await createRealtimeCall(sdp); return sendText(res,201,answer,'application/sdp');
    }
    if(req.method==='POST'&&u.pathname==='/api/log'){
      const buf=await readBody(req,2_500_000);let payload;try{payload=JSON.parse(buf.toString('utf8'));}catch{return sendJson(res,400,{error:'Invalid JSON'});}
      logEvent(payload);return sendJson(res,200,{ok:true});
    }
    if(req.method==='GET'||req.method==='HEAD')return serveStatic(req,res,u.pathname);
    sendText(res,405,'Method not allowed');
  }catch(err){
    const status=err.status||500; console.error(`[${new Date().toISOString()}]`,err);
    sendJson(res,status,{error:err.message||'Internal server error'});
  }
});

server.listen(PORT,HOST,()=>{
  console.log(`CoInk Tutor running on http://localhost:${PORT}`);
  console.log(`Tutor model: ${TUTOR_MODEL} | Realtime: ${REALTIME_MODEL} (${REALTIME_VOICE}) | VAD: ${VAD_EAGERNESS}`);
  console.log(ACCESS_CODE?`Access code protection: ON`:`Access code protection: OFF (set ACCESS_CODE in .env)`);
  if(!OPENAI_API_KEY)console.log('WARNING: OPENAI_API_KEY is not configured; canvas works but AI/voice calls will be disabled.');
});
