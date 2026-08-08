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

test("canvas AI validates and rasterizes handwriting as a movable draft", () => {
  const source = read("src/client/app/ai-runtime.js");
  assert.match(source, /acceptedTools = \["write_text", "handwrite_text"/);
  assert.match(source, /import\("\/handwriting\.js"\)/);
  assert.match(source, /c\.tool === "handwrite_text"[\s\S]*?await handwritingImage/);
  assert.match(source, /\["write_text", "handwrite_text"\]\.includes\(command\?\.tool\)/);
});
