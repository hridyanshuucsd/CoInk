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

test("the visible world rectangle is not clipped to a finite page", () => {
  const source = read("src/client/app/ai-runtime.js"),
    viewportRect = vm.runInNewContext(`(${functionSource(source, "viewportRect")})`, {
      view:{ getBoundingClientRect:() => ({ width:1200, height:800 }) },
      state:{ panX:600, panY:400, scale:.1 },
    });
  assert.deepEqual({ ...viewportRect() }, { x:-6000, y:-4000, w:12000, h:8000 });
});

test("the canvas renders paper and grid without a page border", () => {
  const source = read("src/client/app/canvas-runtime.js"),
    render = functionSource(source, "render"),
    tiles = functionSource(source, "forTiles"),
    valid = functionSource(source, "valid");
  assert.doesNotMatch(render, /strokeRect\(0,\s*0,\s*SIZE,\s*SIZE\)/);
  assert.doesNotMatch(render, /rect\(0,\s*0,\s*SIZE,\s*SIZE\)/);
  assert.doesNotMatch(tiles, /Math\.max\(0|Math\.min\(Math\.ceil\(SIZE/);
  assert.match(valid, /WORLD_COORDINATE_LIMIT/);
});

test("server snapshots accept signed sparse tile coordinates", () => {
  const source = read("src/server/main.js");
  assert.match(source, /SIGNED_TILE_KEY_PATTERN/);
  assert.match(source, /WORLD_COORDINATE_LIMIT/);
});
