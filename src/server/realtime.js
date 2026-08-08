"use strict";

const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_REALTIME_VOICE = "marin";
const REALTIME_CALL_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_SDP_BYTES = 256 * 1024;

const CANVAS_COMMANDS_TOOL = Object.freeze({
  type:"function",
  name:"canvas_commands",
  description:"Place a short handwritten note or simple visual mark on the shared canvas while you speak. Coordinates are global logical CoInk coordinates described in the latest silent canvas context.",
  parameters:{
    type:"object",
    properties:{
      commands:{
        type:"array",
        maxItems:6,
        items:{
          type:"object",
          properties:{
            tool:{ type:"string", enum:["handwrite_text", "draw"] },
            x:{ type:"number" }, y:{ type:"number" },
            text:{ type:"string", description:"For handwrite_text: a short note, usually 2–12 words." },
            fontSize:{ type:"number" }, maxWidth:{ type:"number" }, lineHeight:{ type:"number" },
            origin:{ type:"array", items:{ type:"integer" }, minItems:2, maxItems:2 },
            types:{ type:"array", items:{ type:"string", enum:["line", "smooth", "rect", "ellipse", "circle", "arc"] } },
            items:{ type:"array", items:{ type:"array", items:{ type:"integer" } } },
            width:{ type:"integer" }, tension:{ type:"integer" },
            closed:{ type:"array", items:{ type:"integer" } }, fill:{ type:"array", items:{ type:"integer" } }, arrows:{ type:"array", items:{ type:"integer" } },
          },
          required:["tool"],
        },
      },
    },
    required:["commands"],
  },
});

const VERIFY_MATH_TOOL = Object.freeze({
  type:"function",
  name:"verify_math",
  description:"Use the exact local algebra engine before judging arithmetic, polynomial identities, equations, or a student's transformation. It does not call another model.",
  parameters:{
    type:"object",
    properties:{
      mode:{ type:"string", enum:["statement", "expressions", "transformation"] },
      statement:{ type:"string", description:"For statement mode, one equality such as 2(x+1)=2x+2." },
      left:{ type:"string" }, right:{ type:"string" },
      from:{ type:"string", description:"For transformation mode, the original expression or equation." },
      to:{ type:"string", description:"For transformation mode, the proposed next expression or equation." },
    },
    required:["mode"],
  },
});

const REALTIME_INSTRUCTIONS = `You are CoInk, a private live tutor sharing a visual canvas with one student. Speak naturally, warmly, and concisely, like a thoughtful tutor sitting beside them, but never claim to be human. Use short conversational turns, ask targeted questions, and prefer Socratic hints over immediately giving the full answer.

Silent canvas-context messages contain a current canvas image plus its exact global logical rectangle. Absorb them without responding to the context item alone. Dark ink is usually the student's work; blue ink is usually yours. Use canvas_commands when a short handwritten hint, label, arrow, circle, underline, check, or correction communicates better than speech alone. Never say you wrote or marked something unless you actually call the tool, never cover the student's work, and keep handwritten notes short.

Before asserting that arithmetic, an algebraic identity, an equation, or a transformation is correct or incorrect, call verify_math. Treat its exact result as evidence and explain it at the student's level. The verifier supports exact rational polynomial algebra; if it reports an unsupported form, say that you need to reason about that form separately rather than pretending it was verified.

Yield immediately when interrupted. Let productive silence happen. Keep most spoken turns under 15 seconds unless the student asks for a fuller explanation.`;

function selectedOpenAiKey(provider) {
  if (provider?.provider !== "api" || provider?.api?.format !== "openai" || !provider.apiKey) return "";
  try {
    return new URL(provider.apiUrl).hostname.toLowerCase() === "api.openai.com" ? String(provider.apiKey) : "";
  } catch { return ""; }
}

function realtimeConfiguration(provider, env = process.env) {
  const apiKey = String(env.COINK_REALTIME_API_KEY || env.OPENAI_REALTIME_API_KEY || selectedOpenAiKey(provider) || "").trim(),
    model = String(env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL).trim(),
    voice = String(env.OPENAI_REALTIME_VOICE || DEFAULT_REALTIME_VOICE).trim(),
    eagerness = String(env.OPENAI_REALTIME_VAD_EAGERNESS || "auto").trim().toLowerCase();
  if (!apiKey) return { available:false, error:"Configure an official OpenAI API connection or COINK_REALTIME_API_KEY to use voice." };
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(model)) return { available:false, error:"OPENAI_REALTIME_MODEL is invalid." };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(voice)) return { available:false, error:"OPENAI_REALTIME_VOICE is invalid." };
  if (!["auto", "low", "medium", "high"].includes(eagerness)) return { available:false, error:"OPENAI_REALTIME_VAD_EAGERNESS must be auto, low, medium, or high." };
  return { available:true, apiKey, model, voice, eagerness };
}

function realtimeSession(configuration) {
  return {
    type:"realtime",
    model:configuration.model,
    output_modalities:["audio"],
    instructions:REALTIME_INSTRUCTIONS,
    max_output_tokens:2400,
    tools:[CANVAS_COMMANDS_TOOL, VERIFY_MATH_TOOL],
    tool_choice:"auto",
    audio:{
      input:{
        noise_reduction:{ type:"near_field" },
        transcription:{ model:"gpt-4o-transcribe", prompt:"The speaker may discuss mathematics, science, diagrams, code, and handwritten notation." },
        turn_detection:{ type:"semantic_vad", eagerness:configuration.eagerness, create_response:true, interrupt_response:true },
      },
      output:{ voice:configuration.voice, speed:1 },
    },
  };
}

function validSdp(value) {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= MAX_SDP_BYTES && /^v=0(?:\r?\n|$)/.test(value);
}

async function createRealtimeCall(sdp, configuration, options = {}) {
  if (!configuration?.available) throw Object.assign(new Error(configuration?.error || "Realtime voice is unavailable."), { status:503 });
  if (!validSdp(sdp)) throw Object.assign(new Error("A valid WebRTC session description is required."), { status:400 });
  const form = new FormData();
  form.append("sdp", sdp);
  form.append("session", JSON.stringify(realtimeSession(configuration)));
  const response = await (options.fetchImpl || globalThis.fetch)(REALTIME_CALL_URL, {
    method:"POST",
    headers:{ Authorization:`Bearer ${configuration.apiKey}` },
    body:form,
    signal:options.signal || AbortSignal.timeout(25000),
  });
  const answer = await response.text();
  if (!response.ok) throw Object.assign(new Error(`OpenAI Realtime returned HTTP ${response.status}: ${answer.slice(0, 600)}`), { status:502, upstreamStatus:response.status });
  if (!validSdp(answer)) throw Object.assign(new Error("OpenAI Realtime returned an invalid WebRTC session description."), { status:502 });
  return answer;
}

module.exports = {
  CANVAS_COMMANDS_TOOL,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
  REALTIME_CALL_URL,
  REALTIME_INSTRUCTIONS,
  VERIFY_MATH_TOOL,
  createRealtimeCall,
  realtimeConfiguration,
  realtimeSession,
  validSdp,
};
