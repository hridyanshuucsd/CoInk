"use strict";

const MAX_EXPONENT = 32;
const MAX_TERMS = 2048;

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

class Rational {
  constructor(numerator, denominator = 1n) {
    let n = BigInt(numerator), d = BigInt(denominator);
    if (!d) throw new Error("Division by zero is not defined.");
    if (d < 0n) { n = -n; d = -d; }
    const divisor = gcd(n, d);
    this.n = n / divisor;
    this.d = d / divisor;
  }
  add(other) { return new Rational(this.n * other.d + other.n * this.d, this.d * other.d); }
  sub(other) { return new Rational(this.n * other.d - other.n * this.d, this.d * other.d); }
  mul(other) { return new Rational(this.n * other.n, this.d * other.d); }
  div(other) { return new Rational(this.n * other.d, this.d * other.n); }
  neg() { return new Rational(-this.n, this.d); }
  equals(other) { return this.n === other.n && this.d === other.d; }
  get zero() { return this.n === 0n; }
  toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
}

const ZERO = new Rational(0n);
const ONE = new Rational(1n);

function decimalRational(value) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`Invalid number: ${value}`);
  const [whole, fraction = ""] = normalized.split(".");
  return new Rational(BigInt(`${whole}${fraction}`), 10n ** BigInt(fraction.length));
}

function tokenize(source) {
  const raw = [], input = String(source || "").replace(/[−–]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/");
  for (let index = 0; index < input.length;) {
    const rest = input.slice(index), whitespace = rest.match(/^\s+/), number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/), identifier = rest.match(/^[A-Za-z][A-Za-z0-9_]*/);
    if (whitespace) { index += whitespace[0].length; continue; }
    if (number) { raw.push({ type:"number", value:number[0].startsWith(".") ? `0${number[0]}` : number[0] }); index += number[0].length; continue; }
    if (identifier) { raw.push({ type:"identifier", value:identifier[0] }); index += identifier[0].length; continue; }
    const value = rest[0];
    if (!"+-*/^()".includes(value)) throw new Error(`Unsupported symbol: ${value}`);
    raw.push({ type:value, value });
    index++;
  }
  const result = [];
  const endsAtom = token => token && ["number", "identifier", ")"].includes(token.type);
  const startsAtom = token => token && ["number", "identifier", "("].includes(token.type);
  for (const token of raw) {
    if (endsAtom(result.at(-1)) && startsAtom(token)) result.push({ type:"*", value:"*", implicit:true });
    result.push(token);
  }
  result.push({ type:"eof", value:"" });
  return result;
}

function monomialKey(powers) {
  return [...powers.entries()].filter(([, exponent]) => exponent).sort(([a], [b]) => a.localeCompare(b)).map(([name, exponent]) => `${name}^${exponent}`).join("*");
}

function monomialPowers(key) {
  const powers = new Map();
  if (!key) return powers;
  for (const factor of key.split("*")) {
    const [name, exponent] = factor.split("^");
    powers.set(name, Number(exponent));
  }
  return powers;
}

function polynomial(terms = []) {
  const result = new Map();
  for (const [key, coefficient] of terms) {
    const next = (result.get(key) || ZERO).add(coefficient);
    if (next.zero) result.delete(key); else result.set(key, next);
  }
  if (result.size > MAX_TERMS) throw new Error("Expression expands to too many terms.");
  return result;
}

const constant = value => polynomial([["", value]]);
const variable = name => polynomial([[monomialKey(new Map([[name, 1]])), ONE]]);
const add = (left, right) => polynomial([...left, ...right]);
const negate = value => polynomial([...value].map(([key, coefficient]) => [key, coefficient.neg()]));
const subtract = (left, right) => add(left, negate(right));

function multiply(left, right) {
  const terms = [];
  for (const [leftKey, leftCoefficient] of left) for (const [rightKey, rightCoefficient] of right) {
    const powers = monomialPowers(leftKey);
    for (const [name, exponent] of monomialPowers(rightKey)) powers.set(name, (powers.get(name) || 0) + exponent);
    terms.push([monomialKey(powers), leftCoefficient.mul(rightCoefficient)]);
    if (terms.length > MAX_TERMS * 4) throw new Error("Expression expands to too many terms.");
  }
  return polynomial(terms);
}

function constantValue(value) {
  if (!value.size) return ZERO;
  if (value.size === 1 && value.has("")) return value.get("");
  return null;
}

function divide(left, right) {
  const divisor = constantValue(right);
  if (!divisor || divisor.zero) throw new Error("Only division by a nonzero constant is supported.");
  return polynomial([...left].map(([key, coefficient]) => [key, coefficient.div(divisor)]));
}

function power(base, exponentValue) {
  const exact = constantValue(exponentValue);
  if (!exact || exact.d !== 1n || exact.n < 0n || exact.n > BigInt(MAX_EXPONENT)) throw new Error(`Exponents must be integers from 0 to ${MAX_EXPONENT}.`);
  let exponent = Number(exact.n), result = constant(ONE), factor = base;
  while (exponent) {
    if (exponent % 2) result = multiply(result, factor);
    exponent = Math.floor(exponent / 2);
    if (exponent) factor = multiply(factor, factor);
  }
  return result;
}

function parseExpression(source) {
  const tokens = tokenize(source);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = type => {
    const token = peek();
    if (token.type !== type) throw new Error(`Expected ${type}, found ${token.value || "end of expression"}.`);
    cursor++;
    return token;
  };
  function primary() {
    if (peek().type === "+") { take("+"); return primary(); }
    if (peek().type === "-") { take("-"); return negate(primary()); }
    if (peek().type === "number") return constant(decimalRational(take("number").value));
    if (peek().type === "identifier") return variable(take("identifier").value);
    if (peek().type === "(") { take("("); const value = expression(0); take(")"); return value; }
    throw new Error(`Expected a number, variable, or parenthesized expression near ${peek().value || "the end"}.`);
  }
  function expression(minimumPrecedence) {
    let left = primary();
    while (true) {
      const operator = peek().type, precedence = { "+":1, "-":1, "*":2, "/":2, "^":3 }[operator] || 0;
      if (precedence < minimumPrecedence || !precedence) break;
      take(operator);
      const right = expression(operator === "^" ? precedence : precedence + 1);
      left = operator === "+" ? add(left, right) : operator === "-" ? subtract(left, right) : operator === "*" ? multiply(left, right) : operator === "/" ? divide(left, right) : power(left, right);
    }
    return left;
  }
  const result = expression(1);
  if (peek().type !== "eof") throw new Error(`Unexpected symbol: ${peek().value}`);
  return result;
}

function splitEquation(source) {
  const parts = String(source || "").split("=");
  if (parts.length !== 2 || parts.some(part => !part.trim())) throw new Error("An equation must contain exactly one equals sign.");
  return parts;
}

function parseRelation(source) {
  const [left, right] = splitEquation(source);
  return subtract(parseExpression(left), parseExpression(right));
}

function equalPolynomials(left, right) {
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys].every(key => (left.get(key) || ZERO).equals(right.get(key) || ZERO));
}

function proportionalPolynomials(left, right) {
  if (!left.size || !right.size) return left.size === right.size;
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const pivot = keys.find(key => !(left.get(key) || ZERO).zero && !(right.get(key) || ZERO).zero);
  if (pivot === undefined) return false;
  const ratio = left.get(pivot).div(right.get(pivot));
  return keys.every(key => (left.get(key) || ZERO).equals((right.get(key) || ZERO).mul(ratio)));
}

function normalizedPolynomial(value) {
  if (!value.size) return "0";
  return [...value.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, coefficient]) => `${coefficient}:${key || "1"}`).join(" + ");
}

function compareExpressions(left, right) {
  const leftValue = parseExpression(left), rightValue = parseExpression(right);
  return { valid:equalPolynomials(leftValue, rightValue), relation:"equal", left:normalizedPolynomial(leftValue), right:normalizedPolynomial(rightValue) };
}

function verifyEquation(statement) {
  const value = parseRelation(statement);
  return { valid:!value.size, relation:"equality", normalized:normalizedPolynomial(value) };
}

function verifyTransformation(from, to) {
  const fromEquation = String(from).includes("="), toEquation = String(to).includes("=");
  if (fromEquation !== toEquation) return { valid:false, relation:"equivalent", reason:"Both steps must be expressions or both must be equations." };
  if (!fromEquation) return { ...compareExpressions(from, to), relation:"equivalent" };
  const left = parseRelation(from), right = parseRelation(to);
  return { valid:proportionalPolynomials(left, right), relation:"equivalent", from:normalizedPolynomial(left), to:normalizedPolynomial(right) };
}

function verifyMath(input) {
  try {
    if (typeof input?.statement === "string") return verifyEquation(input.statement);
    if (typeof input?.left === "string" && typeof input?.right === "string") return compareExpressions(input.left, input.right);
    if (typeof input?.from === "string" && typeof input?.to === "string") return verifyTransformation(input.from, input.to);
    return { valid:false, relation:"invalid", error:"Provide statement, left and right, or from and to." };
  } catch (error) {
    return { valid:false, relation:"invalid", error:String(error?.message || error).slice(0, 300) };
  }
}

module.exports = { Rational, compareExpressions, parseExpression, verifyEquation, verifyMath, verifyTransformation };
