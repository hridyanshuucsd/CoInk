  const voiceTutorButton = document.querySelector("#voiceTutorBtn"),
    voiceTutorAudio = document.querySelector("#voiceTutorAudio"),
    voiceLevel = document.querySelector("#voiceLevel");
  let voiceTutor = null,
    voiceTutorConnecting = false,
    realtimeTutorModule = null,
    voiceCanvasTurn = 0,
    voiceCanvasDraftedTurn = -1,
    voiceCanvasDraftPreparing = false;

  function voiceCanvasContext(reason = "current viewport") {
    try {
      const visible = viewportRect();
      if (!visible) return null;
      const packed = buildViewportImage([], visible, true);
      if (!packed?.atlasImage) return null;
      const source = packed.sourceRect;
      return {
        image:packed.atlasImage,
        note:`${reason}. The attached image maps to global logical rectangle x=${Math.round(source.x)}, y=${Math.round(source.y)}, width=${Math.round(source.w)}, height=${Math.round(source.h)} on an edgeless canvas. Coordinates may be positive or negative. Use those global coordinates for canvas_commands.`,
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

  function voiceHandwritingCommand(input, visible, occupied = null, index = 0, scale = 1) {
    if (!input || typeof input.text !== "string" || !input.text.trim() || !visible) return null;
    const left = visible.x,
      top = visible.y,
      right = visible.x + visible.w,
      bottom = visible.y + visible.h,
      safeScale = Math.max(.03, Math.min(2, Number(scale) || 1)),
      text = input.text.trim(),
      requestedFontSize = Number(input.fontSize),
      fontSize = Number.isFinite(requestedFontSize)
        ? Math.max(36, Math.min(650, Math.max(requestedFontSize, 42 / safeScale)))
        : Math.max(48, Math.min(650, Math.max(180, 42 / safeScale))),
      lineHeight = Math.max(1, Math.min(2.2, Number(input.lineHeight) || 1.3)),
      screenPadding = 20 / safeScale,
      gap = Math.max(24 / safeScale, fontSize * .55),
      lineOffset = index * fontSize * lineHeight * 1.35,
      words = text.match(/\S+/g) || [],
      longestWord = Math.max(1, ...words.map((word) => Array.from(word).length)),
      longestLine = Math.max(1, ...text.split(/\r?\n/).map((line) => Array.from(line).length)),
      longestWordWidth = longestWord * fontSize * .72 + fontSize * .5,
      naturalLineWidth = longestLine * fontSize * .58 + fontSize,
      longPhrase = words.length > 3 || Array.from(text).length > 24,
      visibleScreenWidth = visible.w * safeScale,
      readableScreenWidth = longPhrase
        ? Math.max(360, Math.min(680, visibleScreenWidth * .38))
        : Math.max(140, Math.min(360, visibleScreenWidth * .28)),
      requestedMaxWidth = Number(input.maxWidth),
      requestedWidth = Number.isFinite(requestedMaxWidth) ? requestedMaxWidth : 0,
      idealWidth = Math.max(longestWordWidth, readableScreenWidth / safeScale, Math.min(naturalLineWidth, 680 / safeScale)),
      maximumWidth = Math.max(fontSize, visible.w - screenPadding * 2),
      maxWidth = Math.max(fontSize, Math.min(maximumWidth, Math.max(requestedWidth, idealWidth))),
      estimatedLines = Math.max(1, Math.ceil(naturalLineWidth / Math.max(fontSize, maxWidth))),
      estimatedHeight = fontSize * lineHeight * estimatedLines + screenPadding,
      target = input.target && [input.target.x, input.target.y, input.target.w, input.target.h].every(Number.isFinite)
        ? input.target : null,
      placement = ["above", "below", "left", "right", "inside", "auto"].includes(input.placement) ? input.placement : "auto",
      requestedX = Number(input.x),
      requestedY = Number(input.y),
      usableX = Number.isFinite(requestedX) && requestedX >= left && requestedX <= right - fontSize,
      usableY = Number.isFinite(requestedY) && requestedY >= top && requestedY <= bottom - fontSize * lineHeight;
    let x = usableX ? requestedX : left + screenPadding,
      y = usableY ? requestedY : top + screenPadding + lineOffset;
    if ((!usableX || !usableY) && target) {
      const chosen = placement === "auto"
        ? target.y + target.h + gap + estimatedHeight <= bottom ? "below" : target.x + target.w + gap + maxWidth <= right ? "right" : "above"
        : placement;
      if (chosen === "below") { x = target.x; y = target.y + target.h + gap + lineOffset; }
      else if (chosen === "above") { x = target.x; y = target.y - estimatedHeight - gap - lineOffset; }
      else if (chosen === "right") { x = target.x + target.w + gap; y = target.y + lineOffset; }
      else if (chosen === "left") { x = target.x - maxWidth - gap; y = target.y + lineOffset; }
      else { x = target.x + gap; y = target.y + gap + lineOffset; }
    } else if (!usableX && !usableY && occupied) {
      const below = occupied.y + occupied.h + gap + lineOffset,
        beside = occupied.x + occupied.w + gap;
      if (below <= bottom - estimatedHeight) {
        x = Math.max(left + gap, Math.min(right - fontSize - gap, occupied.x));
        y = below;
      } else if (beside <= right - fontSize * 3) {
        x = beside;
        y = Math.max(top + gap, Math.min(bottom - estimatedHeight, occupied.y + lineOffset));
      }
    }
    x = Math.max(left + screenPadding, Math.min(right - maxWidth - screenPadding, x));
    y = Math.max(top + screenPadding, Math.min(bottom - estimatedHeight - screenPadding, y));
    return {
      ...input,
      tool:"handwrite_text",
      text,
      x,
      y,
      fontSize,
      maxWidth,
      lineHeight,
    };
  }

  function voiceMathOperation(value) {
    const source = String(value || "").trim().replace(/\s+/g, " ");
    if (!source) return "";
    const compact = source.replace(/\s+/g, ""),
      subtract = /^(?:subtract|minus)\s+(.+)$/i.exec(source),
      add = /^(?:add|plus)\s+(.+)$/i.exec(source),
      divide = /^(?:divide\s+by|divided\s+by)\s+(.+)$/i.exec(source),
      multiply = /^(?:multiply\s+by|times)\s+(.+)$/i.exec(source);
    if (subtract) return `\u2212${subtract[1].trim()}`;
    if (add) return `+${add[1].trim()}`;
    if (divide) return `\u00f7${divide[1].trim()}`;
    if (multiply) return `\u00d7${multiply[1].trim()}`;
    if (/^[-\u2212]/.test(compact)) return `\u2212${compact.slice(1)}`;
    if (/^(?:\/|\u00f7)/.test(compact)) return `\u00f7${compact.slice(1)}`;
    if (/^(?:\*|\u00d7)/.test(compact)) return `\u00d7${compact.slice(1)}`;
    return compact;
  }

  function voiceMathWorkCommand(input, visible, scale = 1) {
    if (!input || !visible || !Array.isArray(input.steps)) return null;
    const steps = input.steps.slice(0, 8).map((step) => {
      const equation = String(step?.equation || "").trim().replace(/\s*=\s*/g, " = ").replace(/\s+/g, " "),
        operation = voiceMathOperation(step?.operation);
      return equation && equation.split("=").length === 2 ? { equation, ...(operation ? { operation } : {}) } : null;
    }).filter(Boolean);
    if (!steps.length) return null;
    const safeScale = Math.max(.03, Math.min(2, Number(scale) || 1)),
      fontSize = Math.max(48, Math.min(650, Math.max(Number(input.fontSize) || 180, 42 / safeScale))),
      padding = 24 / safeScale,
      gap = Math.max(28 / safeScale, fontSize * .65),
      longestEquation = Math.max(...steps.map((step) => Array.from(step.equation).length)),
      estimatedWidth = Math.min(visible.w - padding * 2, Math.max(fontSize * 5, longestEquation * fontSize * .62)),
      estimatedHeight = steps.reduce((height, step) => height + fontSize * (step.operation ? 2.05 : 1.2), padding * 2),
      target = input.target && [input.target.x, input.target.y, input.target.w, input.target.h].every(Number.isFinite) ? input.target : null,
      placement = ["above", "below", "left", "right", "inside", "auto"].includes(input.placement) ? input.placement : "auto",
      requestedX = Number(input.x),
      requestedY = Number(input.y);
    let x = Number.isFinite(requestedX) ? requestedX : visible.x + padding,
      y = Number.isFinite(requestedY) ? requestedY : visible.y + padding;
    if ((!Number.isFinite(requestedX) || !Number.isFinite(requestedY)) && target) {
      const chosen = placement === "auto"
        ? target.y + target.h + gap + estimatedHeight <= visible.y + visible.h ? "below" : "right"
        : placement;
      if (chosen === "below") { x = target.x; y = target.y + target.h + gap; }
      else if (chosen === "above") { x = target.x; y = target.y - estimatedHeight - gap; }
      else if (chosen === "right") { x = target.x + target.w + gap; y = target.y; }
      else if (chosen === "left") { x = target.x - estimatedWidth - gap; y = target.y; }
      else { x = target.x + gap; y = target.y + gap; }
    }
    return {
      ...input,
      tool:"math_work",
      steps,
      x:Math.max(visible.x + padding, Math.min(visible.x + visible.w - estimatedWidth - padding, x)),
      y:Math.max(visible.y + padding, Math.min(visible.y + visible.h - estimatedHeight - padding, y)),
      fontSize,
      lineHeight:Math.max(1, Math.min(2.2, Number(input.lineHeight) || 1.25)),
    };
  }

  function voiceCanvasObstacleBoxes(visible) {
    const boxes = [visibleInkBounds(visible), imageBounds(visible), textBoxBounds(visible), animationBounds(visible)].filter(Boolean);
    for (const widget of state.widgets || []) {
      const box = intersection(visible, { x:widget.x, y:widget.y, w:widget.w, h:widget.h });
      if (box) boxes.push(box);
    }
    if (state.pending?.items) boxes.push(...state.pending.items.map((item) => pendingItemBounds(item)));
    else if (state.pending) boxes.push(pendingItemBounds(pendingSingleItem(state.pending)));
    return boxes;
  }

  function voiceCommandKey(command) {
    if (command?.tool === "handwrite_text") return `text:${String(command.text || "").trim().toLowerCase()}`;
    if (command?.tool === "math_work") return `math:${JSON.stringify(command.steps || []).toLowerCase()}`;
    return "";
  }

  function pendingVoiceTexts() {
    const pending = state.pending?.items || (state.pending ? [pendingSingleItem(state.pending)] : []);
    return new Set(pending
      .map((item) => voiceCommandKey(item.command))
      .filter(Boolean));
  }

  async function queueVoiceCanvasCommands(input) {
    if (state.busy) return { ok:false, error:"The canvas model is busy. Speak the hint without drawing for this turn." };
    if (voiceCanvasDraftPreparing) return { ok:false, retryable:false, error:"A canvas draft is already being prepared. Do not retry this turn." };
    if (voiceCanvasDraftedTurn === voiceCanvasTurn) return { ok:true, accepted:0, status:"already_drafted", message:"The requested canvas draft is already visible. Do not call another canvas tool this turn." };
    const raw = Array.isArray(input?.commands) ? input.commands.slice(0, 6) : [],
      visible = viewportRect(),
      occupied = visible ? visibleInkBounds(visible) : null,
      normalized = raw
        .map((command, index) => command?.tool === "handwrite_text"
          ? voiceHandwritingCommand(command, visible, occupied, index, state.scale)
          : command?.tool === "math_work"
            ? voiceMathWorkCommand(command, visible, state.scale)
            : command)
        .filter(Boolean),
      duplicateTexts = pendingVoiceTexts(),
      commands = validate(normalized, state.aiColor, null, visible)
        .filter((command) => !duplicateTexts.has(voiceCommandKey(command))),
      revision = state.userRevision,
      meta = { requestId:`voice-${Date.now()}` };
    if (!commands.length) return duplicateTexts.size
      ? { ok:true, accepted:0, status:"already_drafted", message:"That handwriting is already visible. Do not repeat it." }
      : { ok:false, error:"No valid canvas command was supplied." };
    voiceCanvasDraftPreparing = true;
    try {
      const items = [];
      for (const command of commands) {
        const item = await preparePendingItem(command, revision, meta, null);
        if (item) items.push(item);
      }
      if (!items.length) return { ok:false, error:"The canvas draft could not be prepared." };
      resolvePendingItemOverlaps(items, meta, voiceCanvasObstacleBoxes(visible));
      void startPendingBatch(items, revision, meta);
      voiceCanvasDraftedTurn = voiceCanvasTurn;
      return { ok:true, accepted:items.length, status:"drafted", message:"One complete non-overlapping canvas draft is visible and ready for the student to accept." };
    } finally {
      voiceCanvasDraftPreparing = false;
    }
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
        ? await queueVoiceCanvasCommands({ commands:[{ ...args, tool:"handwrite_text" }] })
        : name === "canvas_commands"
          ? await queueVoiceCanvasCommands(args)
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
    tutor.addEventListener("user-speech-start", () => {
      voiceCanvasTurn++;
      sendVoiceCanvasContext("Canvas when the student began speaking");
    });
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
