"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

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
  assert.match(runtime, /queueVoiceCanvasCommands[\s\S]*?validate\(raw[\s\S]*?animate\(command/);
  assert.match(runtime, /fetch\("\/api\/math\/verify"/);
  assert.match(transport, /credentials:'same-origin'/);
  assert.match(server, /url\.pathname === "\/api\/realtime\/call"/);
  assert.match(server, /browserRequestError\(req\)/);
});

test("voice tutor configuration uses the current documented Realtime model", () => {
  const realtime = require("../src/server/realtime.js"), session = realtime.realtimeSession({ model:realtime.DEFAULT_REALTIME_MODEL, voice:"marin", eagerness:"auto" });
  assert.equal(realtime.DEFAULT_REALTIME_MODEL, "gpt-realtime-2.1");
  assert.deepEqual(session.tools.map(tool => tool.name), ["canvas_commands", "verify_math"]);
  assert.match(session.instructions, /never claim to be human/i);
});
