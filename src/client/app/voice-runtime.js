  const voiceTutorButton = document.querySelector("#voiceTutorBtn"),
    voiceTutorAudio = document.querySelector("#voiceTutorAudio"),
    voiceLevel = document.querySelector("#voiceLevel");
  let voiceTutor = null,
    voiceTutorConnecting = false,
    realtimeTutorModule = null;

  function voiceCanvasContext(reason = "current viewport") {
    try {
      const visible = viewportRect();
      if (!visible) return null;
      const packed = buildViewportImage([], visible, true);
      if (!packed?.atlasImage) return null;
      const source = packed.sourceRect;
      return {
        image:packed.atlasImage,
        note:`${reason}. The attached image maps to global logical rectangle x=${Math.round(source.x)}, y=${Math.round(source.y)}, width=${Math.round(source.w)}, height=${Math.round(source.h)} on a ${SIZE} by ${SIZE} canvas. Use those global coordinates for canvas_commands.`,
      };
    } catch (error) {
      debug("voice-context-error", { error:String(error?.message || error).slice(0, 240) });
      return null;
    }
  }

  function sendVoiceCanvasContext(reason) {
    const context = voiceTutor && voiceCanvasContext(reason);
    if (!context) return false;
    voiceTutor.sendCanvasContext(context.image, context.note, { detail:"high" });
    return true;
  }

  function updateVoiceTutorButton(stateName = "closed") {
    if (!voiceTutorButton) return;
    const connected = stateName === "connected",
      connecting = ["connecting", "reconnecting"].includes(stateName);
    voiceTutorButton.classList.toggle("connected", connected);
    voiceTutorButton.classList.toggle("connecting", connecting);
    voiceTutorButton.setAttribute("aria-pressed", String(connected));
    voiceTutorButton.disabled = connecting && !voiceTutor;
    voiceTutorButton.setAttribute("aria-label", t(connected ? "voiceStop" : "voiceTutor"));
    voiceTutorButton.title = t(connected ? "voiceStop" : "voiceTutor");
    if (!connected && voiceLevel) voiceLevel.style.setProperty("--voice-level", ".18");
  }

  function queueVoiceCanvasCommands(input) {
    if (state.busy) return { ok:false, error:"The canvas model is busy. Speak the hint without drawing for this turn." };
    const raw = Array.isArray(input?.commands) ? input.commands.slice(0, 6) : [],
      visible = viewportRect(),
      commands = validate(raw, state.aiColor, null, visible),
      revision = state.userRevision,
      meta = { requestId:`voice-${Date.now()}` };
    if (!commands.length) return { ok:false, error:"No valid canvas command was supplied." };
    void Promise.allSettled(commands.map(command => animate(command, revision, meta, null)));
    return { ok:true, accepted:commands.length };
  }

  function mathVerificationInput(args) {
    if (args?.mode === "statement") return { statement:String(args.statement || "") };
    if (args?.mode === "expressions") return { left:String(args.left || ""), right:String(args.right || "") };
    if (args?.mode === "transformation") return { from:String(args.from || ""), to:String(args.to || "") };
    return {};
  }

  async function verifyVoiceMath(args) {
    const response = await fetch("/api/math/verify", {
      method:"POST",
      credentials:"same-origin",
      headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
      body:JSON.stringify(mathVerificationInput(args)),
    });
    const result = await response.json().catch(() => ({ valid:false, relation:"invalid", error:`HTTP ${response.status}` }));
    return response.ok ? result : { valid:false, relation:"invalid", error:result.error || `HTTP ${response.status}` };
  }

  async function handleVoiceTool(event) {
    if (!voiceTutor) return;
    const { name, callId, args } = event.detail || {};
    try {
      const output = name === "canvas_commands"
        ? queueVoiceCanvasCommands(args)
        : name === "verify_math"
          ? await verifyVoiceMath(args)
          : { ok:false, error:"Unknown tutor tool." };
      voiceTutor.sendFunctionOutput(callId, output);
    } catch (error) {
      voiceTutor.sendFunctionOutput(callId, { ok:false, error:String(error?.message || error).slice(0, 300) });
    }
    voiceTutor.createResponse();
  }

  function attachVoiceTutor(tutor) {
    tutor.addEventListener("status", event => {
      const stateName = event.detail?.state || "closed";
      updateVoiceTutorButton(stateName);
      if (stateName === "connected") {
        setStatusKey("voiceConnected");
        sendVoiceCanvasContext("Canvas at voice connection");
      } else if (stateName === "connecting" || stateName === "reconnecting") setStatusKey("voiceConnecting");
      else if (stateName === "failed") setStatusKey("voiceUnavailable");
    });
    tutor.addEventListener("miclevel", event => {
      const level = Math.max(.18, Math.min(1, Number(event.detail?.level) || 0));
      voiceLevel?.style.setProperty("--voice-level", String(level));
    });
    tutor.addEventListener("user-speech-start", () => sendVoiceCanvasContext("Canvas when the student began speaking"));
    tutor.addEventListener("canvas-action", handleVoiceTool);
    tutor.addEventListener("error", event => {
      debug("voice-error", { error:String(event.detail?.message || "Realtime voice error").slice(0, 300) });
      setStatusKey("voiceError");
    });
  }

  async function toggleVoiceTutor() {
    if (voiceTutor) {
      voiceTutor.close();
      voiceTutor = null;
      updateVoiceTutorButton("closed");
      setStatusKey("voiceStopped");
      return;
    }
    if (voiceTutorConnecting) return;
    voiceTutorConnecting = true;
    updateVoiceTutorButton("connecting");
    setStatusKey("voiceConnecting");
    try {
      realtimeTutorModule ||= import("/realtime.js");
      const { RealtimeTutor } = await realtimeTutorModule,
        tutor = new RealtimeTutor(voiceTutorAudio, { requestHeaders:headers => aiRequestHeaders(headers) });
      voiceTutor = tutor;
      attachVoiceTutor(tutor);
      await tutor.connect();
    } catch (error) {
      debug("voice-connect-error", { error:String(error?.message || error).slice(0, 300) });
      voiceTutor?.close();
      voiceTutor = null;
      updateVoiceTutorButton("failed");
      setStatusKey("voiceError");
    } finally {
      voiceTutorConnecting = false;
      if (!voiceTutor) updateVoiceTutorButton("closed");
    }
  }

  function initializeVoiceTutor() {
    if (!voiceTutorButton || !voiceTutorAudio) return;
    updateVoiceTutorButton("closed");
    voiceTutorButton.addEventListener("click", toggleVoiceTutor);
    window.addEventListener("pagehide", () => voiceTutor?.close(), { once:true });
  }
