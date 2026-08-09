"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const body = source.indexOf("{", start);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};

test("voice tutor control is accessible and bundled before client initialization", () => {
  const html = read("public/index.html"), css = read("public/style.css"), build = read("scripts/build-client.js"), bootstrap = read("src/client/app/ui-bootstrap.js");
  assert.match(html, /id="voiceTutorBtn"[^>]*aria-pressed="false"[^>]*data-i18n-aria="voiceTutor"/);
  assert.match(html, /id="voiceTutorAudio"[^>]*hidden/);
  assert.match(css, /\.voice-tutor-trigger\.connected/);
  assert.ok(build.indexOf("voice-runtime.js") < build.indexOf("ui-bootstrap.js"));
  assert.match(bootstrap, /applyLanguage\(\);\s*initializeVoiceTutor\(\);/);
});

test("voice tutor sends authenticated WebRTC, canvas, and exact-math tool traffic", () => {
  const runtime = read("src/client/app/voice-runtime.js"), transport = read("public/realtime.js"), server = read("src/server/main.js");
  assert.match(runtime, /import\("\/realtime\.js"\)/);
  assert.match(runtime, /requestHeaders:headers => aiRequestHeaders\(headers\)/);
  assert.match(runtime, /buildViewportImage\(\[\], visible, true\)/);
  assert.match(runtime, /async function queueVoiceCanvasCommands[\s\S]*?voiceHandwritingCommand[\s\S]*?validate\(normalized[\s\S]*?preparePendingItem[\s\S]*?resolvePendingItemOverlaps[\s\S]*?startPendingBatch/);
  assert.match(runtime, /name === "write_on_canvas"[\s\S]*?queueVoiceCanvasCommands/);
  assert.match(runtime, /fetch\("\/api\/math\/verify"/);
  assert.match(transport, /credentials:'same-origin'/);
  assert.match(server, /url\.pathname === "\/api\/realtime\/call"/);
  assert.match(server, /browserRequestError\(req\)/);
});

test("voice tutor configuration uses the current documented Realtime model", () => {
  const realtime = require("../src/server/realtime.js"), session = realtime.realtimeSession({ model:realtime.DEFAULT_REALTIME_MODEL, voice:"marin", eagerness:"auto" });
  assert.equal(realtime.DEFAULT_REALTIME_MODEL, "gpt-realtime-2.1");
  assert.deepEqual(session.tools.map(tool => tool.name), ["write_on_canvas", "canvas_commands", "verify_math"]);
  assert.match(session.instructions, /never claim to be human/i);
});

test("voice handwriting supplies safe visible defaults when Realtime omits geometry", () => {
  const runtime = read("src/client/app/voice-runtime.js"),
    normalize = vm.runInNewContext(`(${functionSource(runtime, "voiceHandwritingCommand")})`),
    visible = { x:1000, y:2000, w:1600, h:1000 },
    occupied = { x:1100, y:2100, w:700, h:220 },
    command = normalize({ text:"Try factoring first" }, visible, occupied, 0);
  assert.equal(command.tool, "handwrite_text");
  assert.equal(command.text, "Try factoring first");
  assert.ok(command.x >= visible.x && command.x < visible.x + visible.w);
  assert.ok(command.y > occupied.y + occupied.h);
  assert.ok(command.maxWidth >= command.fontSize);
  assert.ok(command.x + command.maxWidth <= visible.x + visible.w);
});

test("voice handwriting preserves usable model geometry and fills only missing fields", () => {
  const runtime = read("src/client/app/voice-runtime.js"),
    normalize = vm.runInNewContext(`(${functionSource(runtime, "voiceHandwritingCommand")})`),
    visible = { x:0, y:0, w:1800, h:1200 },
    command = normalize({ text:"x = 4", x:900, y:500, fontSize:88 }, visible, null, 0);
  assert.equal(command.x, 900);
  assert.equal(command.y, 500);
  assert.equal(command.fontSize, 88);
  assert.ok(Number.isFinite(command.maxWidth));
});

test("voice handwriting stays readable at the success-demo overview zoom", () => {
  const runtime = read("src/client/app/voice-runtime.js"),
    normalize = vm.runInNewContext(`(${functionSource(runtime, "voiceHandwritingCommand")})`),
    visible = { x:1000, y:2000, w:19000, h:9000 },
    command = normalize({ text:"First subtract 3 from both sides" }, visible, null, 0, .1);
  assert.ok(command.fontSize * .1 >= 40, `screen font was ${command.fontSize * .1}px`);
  assert.ok(command.maxWidth * .1 >= 360, `screen line was ${command.maxWidth * .1}px`);
  assert.ok(command.x + command.maxWidth <= visible.x + visible.w);
});

test("voice handwriting follows a model-selected target relationship", () => {
  const runtime = read("src/client/app/voice-runtime.js"),
    normalize = vm.runInNewContext(`(${functionSource(runtime, "voiceHandwritingCommand")})`),
    visible = { x:0, y:0, w:12000, h:8000 },
    target = { x:2800, y:1900, w:4200, h:900 },
    command = normalize({ text:"Check this sign", target, placement:"below" }, visible, null, 0, .2);
  assert.ok(command.y > target.y + target.h);
  assert.ok(command.x >= visible.x && command.x + command.maxWidth <= visible.x + visible.w);
});

test("draft overlap resolution treats settled canvas content as an obstacle", () => {
  const source = read("src/client/app/ai-runtime.js"),
    resolve = vm.runInNewContext(`(${functionSource(source, "resolvePendingItemOverlaps")})`, {
      state:{ scale:.1 }, SIZE:20000, viewportRect:() => ({ x:0, y:0, w:18000, h:9000 }), debug() {},
    }),
    obstacle = { x:1000, y:1000, w:7000, h:1200 },
    items = Array.from({ length:3 }, (_, index) => ({
      command:{ tool:"handwrite_text", text:`hint ${index}` }, x:1200, y:1200,
      image:{ logicalWidth:4200, logicalHeight:900 }, layoutWidth:4200, layoutHeight:900,
    }));
  resolve(items, { requestId:"voice-test" }, [obstacle]);
  const boxes = items.map(item => ({ x:item.x, y:item.y, w:item.image.logicalWidth, h:item.image.logicalHeight }));
  const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x)
    && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
  assert.ok(boxes.every(box => !overlaps(box, obstacle)), "a hint covered student work");
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.equal(overlaps(boxes[i], boxes[j]), false);
});
