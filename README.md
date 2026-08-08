# CoInk Tutor

A shared handwriting canvas where a student writes with an Apple Pencil or stylus while an
AI tutor **sees the page, talks with them continuously, and writes back in its own animated
vector handwriting**.

The tutor is one brain, not two: the realtime voice model draws on the canvas *while it
speaks*, through a tool call. When it says "let me circle that", the circle appears.

No build step, no database, no frontend framework. Node 20.3+ is enough.

> Sibling project: **StudyInk** — same canvas engine, a different tutoring surface.

---

## What it does

**Canvas**
- Pressure-sensitive stylus input via Pointer Events; palm rejection (pen draws, touch pans)
- Two-finger pinch zoom, finger pan, mouse wheel zoom
- Pen with four ink colours, eraser, undo, AI-only undo, clear, PNG export
- Local autosave per session; reload restores the page
- Infinite world canvas with a pan/zoom view transform

**The tutor**
- Realtime speech-to-speech voice over WebRTC — the mic stays on, no push-to-talk
- The voice model writes and draws through a `canvas_action` tool while speaking
- Handwriting is rendered from **real vector stroke trajectories** (Hershey), animated
  stroke by stroke with a visible pen cursor — not `fillText`, not a bitmap font
- Circles, arrows, underlines, check marks and crosses
- Silent auto-tutoring after a pen pause, plus explicit **Hint** and **Check**
- Text chat fallback when voice isn't wanted
- Student writing or speaking instantly interrupts the tutor's unfinished ink;
  speaking interrupts its speech

**Accurate placement.** Rather than asking a vision model to guess pixel coordinates —
which is reliably 5–15% off — every snapshot carries a **CANVAS INK MAP**: visible ink is
clustered into labeled regions (`s1`, `s2`, …) with boxes. The tutor targets `anchor_id: "s3"`
and the client resolves that against live geometry. Snapshots also carry a burned-in labeled
coordinate grid, coordinates are pinned to the view at capture time, and planned handwriting
is nudged into free space if it would cover the student's work.

**Operations**
- Access-code gate (HttpOnly cookie), rate-limited auth attempts
- Per-IP rate limiting and a daily upstream-call cap as a cost guard
- Batched async JSONL session logging under `data/sessions/`
- PWA manifest, dark mode, safe-area insets — installable to an iPad home screen
- The OpenAI API key never reaches browser JavaScript

---

## Quick start

```bash
cp .env.example .env      # then set OPENAI_API_KEY and ACCESS_CODE
npm start
```

Open <http://localhost:3888>. If `ACCESS_CODE` is set you'll be asked for it once
(or open `/?code=NNNNNN` directly).

Requirements: Node.js 20.3+, an OpenAI API key with Realtime and Responses access,
and a Chromium/Safari browser with microphone permission.

### Using it on an iPad

Browsers only grant microphone access over HTTPS (`localhost` also counts as secure).
For a tablet, put the server behind an HTTPS tunnel:

```bash
cloudflared tunnel --url http://localhost:3888
```

Then open the `https://…` URL it prints. Note that *quick* tunnels mint a new random URL
each restart; a named tunnel (free Cloudflare account) gives you a stable one. The included
`Dockerfile` covers a real deployment.

---

## Configuration

All settings live in `.env` — see [`.env.example`](.env.example) for the annotated list.
The ones worth knowing:

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Required |
| `ACCESS_CODE` | empty | Gates every page and API call. Empty disables the gate — only safe on a trusted network |
| `VAD_EAGERNESS` | `auto` | Turn-taking sensitivity: `low` is patient with thinking pauses, `high` replies fast |
| `OPENAI_TUTOR_REASONING` | `medium` | Effort for the silent visual planner |
| `DAILY_CALL_CAP` | `1500` | Hard ceiling on upstream calls per day |
| `AUTO_AI_DELAY_MS` | `1100` | Pen-pause delay before silent auto-tutoring |

---

## How it fits together

```text
   Student stylus ──────────────┐
                                ▼
                         Shared canvas  ──── snapshot + ink map ────┐
                                ▲                                   │
                                │                                   ▼
   Microphone ──── WebRTC ──────┴──── realtime model ──── canvas_action tool
                                              │
                                              └──── speech (audio out)

   Pen pause ──── silent planner (Responses API, structured outputs) ──── ink plan
```

The browser holds the canvas and all geometry. The server holds the API key, gates access,
and proxies two things: the WebRTC SDP handshake that opens a realtime session, and the
silent planner call used for auto-tutoring and the no-voice fallback.

### Source map

| Path | Role |
|---|---|
| `server.mjs` | HTTP server, auth gate, rate limits, realtime session setup, silent planner |
| `public/canvas.js` | Canvas engine: view transform, input routing, ink map, anchor resolution, animation |
| `public/handwriting.js` | Hershey vector handwriting layout with a deterministic "hand" |
| `public/realtime.js` | WebRTC realtime client: tool calls, response queueing, reconnect, mic meter |
| `public/app.js` | Wiring, UI state, transcript, snapshot scheduling |
| `docs/AUDIT-AND-IMPLEMENTATION.md` | Full engineering audit and what was fixed |

---

## Research logging

Session events (strokes, tutor plans, transcripts, timings) append to
`data/sessions/<id>.jsonl`, batched every two seconds. Participant IDs come from the URL —
`?participant=P014`. Disable with `LOG_SESSIONS=0`, or drop stroke point arrays with
`LOG_STROKE_POINTS=0`. Session logs are git-ignored.

## Security notes

The access code is a shared-secret gate appropriate for small trusted groups and study
participants. It is not user accounts, and it does not isolate participants' data from each
other. Never commit `.env`; it is git-ignored.

## Licence

MIT — see [LICENSE](LICENSE). The vector handwriting derives from the Hershey fonts;
see [NOTICE-HERSHEY.md](NOTICE-HERSHEY.md).
