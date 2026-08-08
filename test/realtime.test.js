"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  REALTIME_CALL_URL,
  createRealtimeCall,
  realtimeConfiguration,
  realtimeSession,
  validSdp,
} = require("../src/server/realtime.js");

test("Realtime voice uses an official selected OpenAI connection without exposing its key", () => {
  const configuration = realtimeConfiguration({
    provider:"api",
    api:{ format:"openai" },
    apiUrl:"https://api.openai.com/v1/chat/completions",
    apiKey:"sk-private",
  }, {});
  assert.equal(configuration.available, true);
  assert.equal(configuration.model, "gpt-realtime-2");
  const session = realtimeSession(configuration);
  assert.deepEqual(session.output_modalities, ["audio"]);
  assert.deepEqual(session.tools.map(tool => tool.name), ["canvas_commands", "verify_math"]);
  assert.doesNotMatch(JSON.stringify(session), /sk-private/);
});

test("Realtime voice can use a dedicated key and validates configuration", () => {
  assert.equal(realtimeConfiguration(null, { COINK_REALTIME_API_KEY:"dedicated" }).available, true);
  assert.match(realtimeConfiguration(null, {}).error, /Configure an official OpenAI API connection/);
  assert.match(realtimeConfiguration(null, { COINK_REALTIME_API_KEY:"key", OPENAI_REALTIME_VAD_EAGERNESS:"instant" }).error, /EAGERNESS/);
});

test("Realtime WebRTC exchange posts SDP and session metadata server-side", async () => {
  const calls = [], answer = "v=0\r\no=answer\r\n";
  const result = await createRealtimeCall("v=0\r\no=offer\r\n", {
    available:true, apiKey:"secret", model:"gpt-realtime-2", voice:"marin", eagerness:"auto",
  }, {
    fetchImpl:async (url, options) => {
      calls.push({ url, options });
      return new Response(answer, { status:201, headers:{ "Content-Type":"application/sdp" } });
    },
  });
  assert.equal(result, answer);
  assert.equal(calls[0].url, REALTIME_CALL_URL);
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  assert.equal(calls[0].options.body.get("sdp"), "v=0\r\no=offer\r\n");
  assert.equal(JSON.parse(calls[0].options.body.get("session")).model, "gpt-realtime-2");
});

test("Realtime WebRTC rejects malformed offers and answers", async () => {
  assert.equal(validSdp("v=0\n"), true);
  assert.equal(validSdp("offer"), false);
  await assert.rejects(createRealtimeCall("offer", { available:true }), /valid WebRTC/);
  await assert.rejects(createRealtimeCall("v=0\n", { available:false, error:"missing" }), /missing/);
});
