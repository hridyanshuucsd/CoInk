import { HERSHEY_GLYPHS } from './hershey-glyphs.js';

const SPECIAL = {
  '∫': { a: 470, s: [[[330,760],[280,720],[250,660],[235,560],[245,420],[220,270],[190,120],[150,20],[120,-70],[100,-135],[75,-175]]] },
  '√': { a: 720, s: [[[70,240],[165,120],[235,430],[680,430]]] },
  'π': { a: 650, s: [[[100,430],[560,430]],[[190,430],[165,265],[150,110]],[[465,430],[430,270],[420,115]]] },
  'θ': { a: 560, s: [[[310,510],[245,500],[190,455],[155,390],[145,295],[165,205],[210,150],[275,125],[350,135],[415,180],[455,250],[465,340],[445,425],[395,480],[330,510]],[[160,315],[445,315]]] },
  '∞': { a: 780, s: [[[90,300],[150,380],[230,390],[320,320],[390,245],[470,175],[555,185],[635,265],[645,340],[605,405],[535,420],[450,365],[370,290],[285,210],[205,185],[135,220],[90,300]]] },
  '≤': { a: 760, s: [[[625,490],[165,300],[625,115]],[[165,40],[625,40]]] },
  '≥': { a: 760, s: [[[165,490],[625,300],[165,115]],[[165,40],[625,40]]] },
  '→': { a: 820, s: [[[120,270],[690,270]],[[555,395],[690,270],[555,145]]] },
  'Σ': { a: 650, s: [[[545,520],[150,520],[355,280],[150,45],[555,45]]] },
  'Δ': { a: 650, s: [[[320,530],[95,35],[560,35],[320,530]]] },
  '∂': { a: 580, s: [[[300,530],[385,500],[430,425],[425,315],[385,225],[325,165],[245,150],[185,180],[150,240],[150,315],[180,370],[235,400],[305,395],[365,350],[405,290]]] },
  '∇': { a: 650, s: [[[85,500],[320,40],[555,500],[85,500]]] },
  'α': { a: 600, s: [[[430,365],[385,415],[315,430],[240,410],[185,355],[165,285],[185,215],[235,175],[300,170],[365,205],[405,260],[430,365]],[[430,365],[455,250],[475,175]]] },
  'β': { a: 560, s: [[[190,-130],[220,20],[250,175],[285,330],[320,445],[365,505],[415,500],[445,455],[440,395],[400,345],[335,315],[265,315]],[[335,315],[415,300],[455,255],[455,205],[425,160],[370,140],[300,150],[245,185]]] },
  'γ': { a: 560, s: [[[135,420],[235,190],[315,145],[390,165],[455,260]],[[455,420],[415,260],[370,90],[330,-65],[280,-150]]] },
  'λ': { a: 520, s: [[[120,460],[205,425],[270,310],[330,170],[390,35]],[[270,310],[350,380],[435,420]]] },
  'μ': { a: 620, s: [[[145,410],[145,205],[175,160],[225,155],[275,195],[315,305],[315,410]],[[315,410],[315,205],[345,165],[395,165],[450,205],[490,330],[505,410]],[[145,205],[135,-125]]] },
  'σ': { a: 600, s: [[[490,405],[385,420],[285,410],[215,365],[180,300],[190,235],[235,185],[300,165],[365,175],[420,215],[450,280],[440,345],[395,395]]] },
  'φ': { a: 620, s: [[[325,525],[295,430],[270,330],[255,235],[260,125],[285,20],[305,-90]],[[305,410],[235,395],[185,345],[160,280],[170,215],[215,170],[280,150],[350,160],[410,205],[445,270],[435,335],[395,385],[335,410]]] }
};

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
}

function glyphFor(ch) {
  return HERSHEY_GLYPHS[ch] || SPECIAL[ch] || HERSHEY_GLYPHS['?'];
}

export const AI_HAND_DEFAULTS = {
  ink: '#2f6fed',
  baseWidth: 2.15,
  slant: -0.035,
  letterSpacing: 0.025,
  wordSpacing: 0.18,
  baselineJitter: 0.018,
  glyphScaleJitter: 0.022,
  pointJitter: 0.007,
  speedPxPerSec: 430,
  seed: 'coink-ai-hand-v1'
};

/**
 * Layout text as true vector pen strokes.
 * Coordinates are returned in the same units as x/y/fontSize.
 */
export function layoutHandwriting(text, {
  x = 0,
  y = 0,
  fontSize = 34,
  maxWidth = 500,
  lineHeight = 1.26,
  seed = AI_HAND_DEFAULTS.seed,
  slant = AI_HAND_DEFAULTS.slant,
  letterSpacing = AI_HAND_DEFAULTS.letterSpacing,
  wordSpacing = AI_HAND_DEFAULTS.wordSpacing,
  baselineJitter = AI_HAND_DEFAULTS.baselineJitter,
  glyphScaleJitter = AI_HAND_DEFAULTS.glyphScaleJitter,
  pointJitter = AI_HAND_DEFAULTS.pointJitter,
  author = 'ai',
  groupId = `ai-${Date.now()}`,
  color = AI_HAND_DEFAULTS.ink,
  width = AI_HAND_DEFAULTS.baseWidth
} = {}) {
  const unitsToPx = fontSize / 700;
  const baseLineOffset = fontSize * 0.92;
  const lines = [];
  let cursorX = x;
  let cursorY = y;
  let currentLine = [];
  const globalRand = rng(hashString(`${seed}|${text}`));

  const newline = () => {
    lines.push(currentLine);
    currentLine = [];
    cursorX = x;
    cursorY += fontSize * lineHeight;
  };

  const words = String(text ?? '').split(/(\s+)/);
  for (const token of words) {
    if (token.includes('\n')) {
      const pieces = token.split('\n');
      pieces.forEach((piece, idx) => {
        if (piece) placeToken(piece);
        if (idx < pieces.length - 1) newline();
      });
      continue;
    }
    placeToken(token);
  }
  if (currentLine.length || !lines.length) lines.push(currentLine);

  function tokenWidth(token) {
    let w = 0;
    for (const ch of token) {
      const g = glyphFor(ch);
      w += (g?.a || 378) * unitsToPx;
      w += fontSize * letterSpacing;
      if (ch === ' ') w += fontSize * wordSpacing;
    }
    return w;
  }

  function placeToken(token) {
    if (!token) return;
    const isWhitespace = /^\s+$/.test(token);
    const estimated = tokenWidth(token);
    if (!isWhitespace && cursorX > x && cursorX + estimated > x + maxWidth) newline();
    for (const ch of token) {
      if (ch === '\n') { newline(); continue; }
      const g = glyphFor(ch);
      if (!g) continue;
      const charIndex = currentLine.length + lines.reduce((n, l) => n + l.length, 0);
      const r = rng(hashString(`${seed}|${charIndex}|${ch}|${Math.floor(globalRand()*1e9)}`));
      const scaleMul = 1 + (r() - 0.5) * 2 * glyphScaleJitter;
      const baseline = cursorY + baseLineOffset + (r() - 0.5) * 2 * baselineJitter * fontSize;
      const localStrokes = [];
      for (const sourceStroke of g.s || []) {
        if (sourceStroke.length < 2) continue;
        const pts = sourceStroke.map(([gx, gy], pi) => {
          const px = gx * unitsToPx * scaleMul;
          const py = -gy * unitsToPx * scaleMul;
          const slantedX = px + (-py) * slant;
          const j = fontSize * pointJitter;
          return {
            x: cursorX + slantedX + (r() - 0.5) * 2 * j,
            y: baseline + py + (r() - 0.5) * 2 * j,
            p: 0.58 + (r() - 0.5) * 0.08,
            t: pi
          };
        });
        localStrokes.push({
          id: crypto.randomUUID?.() || `${groupId}-${Math.random().toString(36).slice(2)}`,
          author,
          groupId,
          color,
          width,
          points: pts
        });
      }
      currentLine.push(...localStrokes);
      cursorX += (g.a || 378) * unitsToPx * scaleMul + fontSize * letterSpacing;
      if (ch === ' ') cursorX += fontSize * wordSpacing;
    }
  }

  const strokes = lines.flat();
  const bounds = getStrokeBounds(strokes);
  return {
    strokes,
    width: bounds ? bounds.maxX - bounds.minX : 0,
    height: bounds ? bounds.maxY - bounds.minY : fontSize,
    bounds
  };
}

export function getStrokeBounds(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  for (const stroke of strokes || []) {
    for (const p of stroke.points || []) {
      found = true;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  return found ? { minX, minY, maxX, maxY } : null;
}

export function strokeLength(stroke) {
  let d = 0;
  const pts = stroke?.points || [];
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  return d;
}

export function makeCheckStroke(x, y, size = 36, opts = {}) {
  return [{
    id: crypto.randomUUID?.() || `check-${Date.now()}`,
    author: 'ai', groupId: opts.groupId || `ai-${Date.now()}`,
    color: opts.color || AI_HAND_DEFAULTS.ink, width: opts.width || 2.3,
    points: [
      {x:x, y:y+size*0.48, p:.58},
      {x:x+size*0.28, y:y+size*0.78, p:.63},
      {x:x+size, y:y, p:.56}
    ]
  }];
}
