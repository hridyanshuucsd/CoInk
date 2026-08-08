"use strict";

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const IMAGE_GENERATION_URL = "https://api.openai.com/v1/images/generations";
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

function selectedOpenAiKey(provider) {
  if (provider?.provider !== "api" || provider?.api?.format !== "openai" || !provider.apiKey) return "";
  try {
    return new URL(provider.apiUrl).hostname.toLowerCase() === "api.openai.com" ? String(provider.apiKey) : "";
  } catch { return ""; }
}

function imageGenerationConfiguration(provider, env = process.env) {
  const apiKey = String(env.COINK_IMAGE_API_KEY || env.OPENAI_IMAGE_API_KEY || selectedOpenAiKey(provider) || "").trim(),
    model = String(env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL).trim();
  if (!apiKey) return { available:false, error:"Configure an official OpenAI API connection or COINK_IMAGE_API_KEY to generate images." };
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(model)) return { available:false, error:"OPENAI_IMAGE_MODEL is invalid." };
  return { available:true, apiKey, model };
}

function imageSize(width, height) {
  const ratio = Number(width) / Number(height);
  if (ratio >= 1.2) return "1536x1024";
  if (ratio <= 1 / 1.2) return "1024x1536";
  return "1024x1024";
}

function validPngBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length > 8 && bytes.length <= MAX_IMAGE_BYTES && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

async function generateImage(input, configuration, options = {}) {
  if (!configuration?.available) throw Object.assign(new Error(configuration?.error || "Image generation is unavailable."), { status:503 });
  const prompt = String(input?.prompt || "").trim(), width = Number(input?.width), height = Number(input?.height);
  if (!prompt || prompt.length > 2000) throw Object.assign(new Error("An image prompt from 1 to 2000 characters is required."), { status:400 });
  if (![width, height].every(value => Number.isFinite(value) && value >= 256 && value <= 6000)) throw Object.assign(new Error("Generated image dimensions must be between 256 and 6000 canvas units."), { status:400 });
  const response = await (options.fetchImpl || globalThis.fetch)(IMAGE_GENERATION_URL, {
    method:"POST",
    headers:{ Authorization:`Bearer ${configuration.apiKey}`, "Content-Type":"application/json" },
    body:JSON.stringify({
      model:configuration.model,
      prompt,
      n:1,
      size:imageSize(width, height),
      quality:"medium",
      background:"transparent",
      output_format:"png",
    }),
    signal:options.signal || AbortSignal.timeout(120000),
  });
  const raw = await response.text();
  if (!response.ok) throw Object.assign(new Error(`OpenAI image generation returned HTTP ${response.status}: ${raw.slice(0, 600)}`), { status:502, upstreamStatus:response.status });
  let body;
  try { body = JSON.parse(raw); } catch { throw Object.assign(new Error("OpenAI image generation returned invalid JSON."), { status:502 }); }
  const data = body?.data?.[0]?.b64_json;
  if (!validPngBase64(data)) throw Object.assign(new Error("OpenAI image generation returned an invalid PNG."), { status:502 });
  return { dataUrl:`data:image/png;base64,${data}`, revisedPrompt:String(body?.data?.[0]?.revised_prompt || "").slice(0, 2000), model:configuration.model };
}

module.exports = {
  DEFAULT_IMAGE_MODEL,
  IMAGE_GENERATION_URL,
  generateImage,
  imageGenerationConfiguration,
  imageSize,
  validPngBase64,
};
