"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compareExpressions, verifyEquation, verifyMath, verifyTransformation } = require("../src/server/symbolic-math.js");

test("symbolic math expands polynomials with exact rational arithmetic", () => {
  assert.equal(compareExpressions("(x + 1)^2", "x^2 + 2x + 1").valid, true);
  assert.equal(compareExpressions("0.1 + 0.2", "3/10").valid, true);
  assert.equal(compareExpressions("2(x + y)", "2x + 2y").valid, true);
  assert.equal(compareExpressions("x^2", "2x").valid, false);
});

test("symbolic math verifies written equalities", () => {
  assert.equal(verifyEquation("3(x - 2) = 3x - 6").valid, true);
  assert.equal(verifyEquation("3(x - 2) = 3x - 5").valid, false);
});

test("symbolic math recognizes equivalent equation transformations", () => {
  assert.equal(verifyTransformation("x + 1 = 3", "2x + 2 = 6").valid, true);
  assert.equal(verifyTransformation("x + 1 = 3", "x = 3").valid, false);
  assert.equal(verifyTransformation("x + 1", "1 + x").valid, true);
});

test("symbolic math rejects unsupported or malformed requests safely", () => {
  assert.match(verifyMath({ statement:"x / y = 1" }).error, /nonzero constant/);
  assert.match(verifyMath({ statement:"x =" }).error, /equals sign/);
  assert.equal(verifyMath({}).relation, "invalid");
});
