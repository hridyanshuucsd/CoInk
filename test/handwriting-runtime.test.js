"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

async function handwritingModule() {
  const glyphs = moduleUrl(read("public/hershey-glyphs.js"));
  return import(moduleUrl(read("public/handwriting.js").replace("'./hershey-glyphs.js'", JSON.stringify(glyphs))));
}

test("Hershey handwriting produces deterministic vector strokes", async () => {
  const { layoutHandwriting } = await handwritingModule(), options = { x:10, y:20, fontSize:42, maxWidth:420, seed:"lesson-1" },
    first = layoutHandwriting("Check x² + 2x", options), second = layoutHandwriting("Check x² + 2x", options);
  assert.ok(first.strokes.length > 10);
  assert.ok(first.bounds.maxX > first.bounds.minX);
  assert.deepEqual(first.strokes.map(stroke => stroke.points), second.strokes.map(stroke => stroke.points));
  assert.ok(first.strokes.every(stroke => stroke.author === "ai" && stroke.points.length >= 2));
});

test("handwriting wraps every glyph of words wider than the requested line", async () => {
  const { layoutHandwriting } = await handwritingModule(),
    maxWidth = 220,
    result = layoutHandwriting("electromagnetism", { x:20, y:20, fontSize:86, maxWidth, seed:"long-word" });
  assert.ok(result.strokes.length > 20);
  assert.ok(result.bounds.maxX <= 20 + maxWidth + 1, `word escaped line width: ${result.bounds.maxX}`);
  assert.ok(result.height > 86, "the oversized word should continue on another line");
});

test("a single wide mathematical symbol remains renderable at the minimum line width", async () => {
  const { layoutHandwriting } = await handwritingModule(), result = layoutHandwriting("→", {
    x:10, y:10, fontSize:80, maxWidth:80, seed:"wide-symbol",
  });
  assert.ok(result.strokes.length > 0);
  assert.ok(Number.isFinite(result.bounds.maxX));
});

test("success-scenario teaching phrases remain complete inside narrow handwriting lines", async () => {
  const { layoutHandwriting } = await handwritingModule(), phrases = [
    "minus a negative",
    "same V, not same I",
    "generation does not equal delivery",
    "arrow tail means electrons",
    "acceleration still downward",
  ];
  for (const text of phrases) {
    const maxWidth = 300, result = layoutHandwriting(text, { x:18, y:18, fontSize:72, maxWidth, seed:text });
    assert.ok(result.strokes.length > 0, `missing strokes for ${text}`);
    assert.ok(result.bounds.maxX <= 18 + maxWidth + 1, `${text} escaped its line width`);
  }
});

test("canvas AI validates and rasterizes handwriting as a movable draft", () => {
  const source = read("src/client/app/ai-runtime.js");
  assert.match(source, /acceptedTools = \["write_text", "handwrite_text"/);
  assert.match(source, /import\("\/handwriting\.js"\)/);
  assert.match(source, /c\.tool === "handwrite_text"[\s\S]*?await handwritingImage/);
  assert.match(source, /\["write_text", "handwrite_text"\]\.includes\(command\?\.tool\)/);
  assert.doesNotMatch(source, /Math\.min\(maxWidth, \(bounds\?\.maxX/);
});
