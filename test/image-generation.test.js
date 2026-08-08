"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  IMAGE_GENERATION_URL,
  generateImage,
  imageGenerationConfiguration,
  imageSize,
  validPngBase64,
} = require("../src/server/image-generation.js");

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("image generation selects a documented GPT Image size", () => {
  assert.equal(imageSize(1000, 1000), "1024x1024");
  assert.equal(imageSize(1600, 900), "1536x1024");
  assert.equal(imageSize(900, 1600), "1024x1536");
});

test("image generation uses an official selected OpenAI key or a dedicated key", () => {
  const selected = imageGenerationConfiguration({ provider:"api", api:{ format:"openai" }, apiUrl:"https://api.openai.com/v1", apiKey:"secret" }, {});
  assert.equal(selected.available, true);
  assert.equal(selected.model, "gpt-image-2");
  assert.equal(imageGenerationConfiguration(null, { COINK_IMAGE_API_KEY:"dedicated" }).available, true);
  assert.equal(imageGenerationConfiguration(null, {}).available, false);
});

test("image generation validates and returns base64 PNG data", async () => {
  const calls = [];
  const result = await generateImage({ prompt:"A clean free-body diagram", width:1600, height:900 }, { available:true, apiKey:"secret", model:"gpt-image-2" }, {
    fetchImpl:async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ data:[{ b64_json:PNG, revised_prompt:"A precise free-body diagram" }] }), { status:200 });
    },
  });
  assert.equal(calls[0].url, IMAGE_GENERATION_URL);
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model:"gpt-image-2",
    prompt:"A clean free-body diagram",
    n:1,
    size:"1536x1024",
    quality:"medium",
    background:"transparent",
    output_format:"png",
  });
  assert.equal(result.dataUrl, `data:image/png;base64,${PNG}`);
  assert.equal(validPngBase64(PNG), true);
  assert.equal(validPngBase64(Buffer.from("not png").toString("base64")), false);
});

test("image generation rejects invalid prompts before making a request", async () => {
  await assert.rejects(generateImage({ prompt:"", width:1000, height:1000 }, { available:true }), /prompt/);
  await assert.rejects(generateImage({ prompt:"valid", width:12, height:1000 }, { available:true }), /dimensions/);
});

test("generated images use the authenticated draft-and-confirm canvas path", () => {
  const client = fs.readFileSync(path.join(__dirname, "..", "src", "client", "app", "ai-runtime.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server", "main.js"), "utf8");
  assert.match(client, /c\.tool === "generate_image"[\s\S]*?generatedImageSlots--/);
  assert.match(client, /fetch\("\/api\/images\/generate", \{[\s\S]*?credentials:"same-origin"[\s\S]*?headers:aiRequestHeaders/);
  assert.match(client, /generatedImageDraft\(c\)[\s\S]*?startPending/);
  assert.match(server, /url\.pathname === "\/api\/images\/generate"[\s\S]*?browserRequestError\(req\)[\s\S]*?imageGenerationConfiguration/);
});
