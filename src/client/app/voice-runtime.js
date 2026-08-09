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
    if (!connected && voiceLevel) runtimeElementStyle(voiceLevel, "voice-level")?.setProperty("--voice-level", ".18");
  }

  function voiceHandwritingCommand(input, visible, occupied = null, index = 0) {
    if (!input || typeof input.text !== "string" || !input.text.trim() || !visible) return null;
    const left = visible.x,
      top = visible.y,
      right = visible.x + visible.w,
      bottom = visible.y + visible.h,
      requestedFontSize = Number(input.fontSize),
      fontSize = Number.isFinite(requestedFontSize)
        ? Math.max(36, Math.min(220, requestedFontSize))
        : Math.max(48, Math.min(120, visible.h / 12)),
      gap = Math.max(24, fontSize * .6),
      lineOffset = index * fontSize * 1.6,
      requestedX = Number(input.x),
      requestedY = Number(input.y),
      usableX = Number.isFinite(requestedX) && requestedX >= left && requestedX <= right - fontSize,
      usableY = Number.isFinite(requestedY) && requestedY >= top && requestedY <= bottom - fontSize * 1.3;
    let x = usableX ? requestedX : left + gap,
      y = usableY ? requestedY : top + gap + lineOffset;
    if (!usableX && !usableY && occupied) {
      const below = occupied.y + occupied.h + gap + lineOffset,
        beside = occupied.x + occupied.w + gap;
      if (below <= bottom - fontSize * 1.3) {
        x = Math.max(left + gap, Math.min(right - fontSize - gap, occupied.x));
        y = below;
      } else if (beside <= right - fontSize * 3) {
        x = beside;
        y = Math.max(top + gap, Math.min(bottom - fontSize * 1.3, occupied.y + lineOffset));
      }
    }
    if (right - x - gap < fontSize) x = Math.max(left, right - fontSize - gap);
    const availableWidth = Math.max(fontSize, right - x - gap),
      requestedMaxWidth = Number(input.maxWidth),
      maxWidth = Number.isFinite(requestedMaxWidth)
        ? Math.max(fontSize, Math.min(availableWidth, requestedMaxWidth))
        : Math.min(1000, availableWidth);
    return {
      ...input,
      tool:"handwrite_text",
      text:input.text.trim(),
      x,
      y,
      fontSize,
      maxWidth,
      lineHeight:Math.max(1, Math.min(2.2, Number(input.lineHeight) || 1.3)),
    };
  }

  function queueVoiceCanvasCommands(input) {
    if (state.busy) return { ok:false, error:"The canvas model is busy. Speak the hint without drawing for this turn." };
    const raw = Array.isArray(input?.commands) ? input.commands.slice(0, 6) : [],
      visible = viewportRect(),
      occupied = visible ? visibleInkBounds(visible) : null,
      normalized = raw
        .map((command, index) => command?.tool === "handwrite_text" ? voiceHandwritingCommand(command, visible, occupied, index) : command)
        .filter(Boolean),
      commands = validate(normalized, state.aiColor, null, visible),
      revision = state.userRevision,
      meta = { requestId:`voice-${Date.now()}` };
    if (!commands.length) return { ok:false, error:"No valid canvas command was supplied." };
    void Promise.allSettled(commands.map(command => animate(command, revision, meta, null)));
    return { ok:true, accepted:commands.length, status:"drafted", message:"The canvas draft is visible and ready for the student to accept." };
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
      const output = name === "write_on_canvas"
        ? queueVoiceCanvasCommands({ commands:[{ ...args, tool:"handwrite_text" }] })
        : name === "canvas_commands"
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
      runtimeElementStyle(voiceLevel, "voice-level")?.setProperty("--voice-level", String(level));
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
