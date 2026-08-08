# Engineering audit & implementation report

_CoInk and StudyInk are sibling projects that share a canvas engine. This document covers both._

Both apps are AI tutors on a shared handwriting canvas. A full review found 40 issues
grouped under three reported symptoms — imprecise scribble placement, an awkward voice
experience, and missing UI — plus security and deployment gaps. Everything below marked
**Fixed** is implemented and verified.

Finding IDs: `C-*` = CoInk, `S-*` = StudyInk, `X-*` = shared deployment.

---

## The five root causes

1. **Blind aiming.** Both apps asked a vision model to emit raw pixel coordinates from a
   downscaled screenshot with no aids — no grid, no inventory of where the student's ink
   actually was, no correction of the result. Vision models are reliably 5–15% off at this
   task, which is why annotations landed in empty space.

2. **CoInk had a split brain.** Speech came from the realtime model; ink came from a
   *separate* vision call fired after each transcript, seeing only that text. The tutor
   promised marks it never made, and ink arrived seconds late.

3. **The apps interrupted themselves.** StudyInk cancelled the tutor's speech on every
   pen-down, so taking notes while listening cut the tutor off mid-sentence.

4. **StudyInk was not tablet-ready.** No palm rejection (a resting palm drew ink under an
   Apple Pencil), no pan/zoom, and "handwriting" was a system font rather than real strokes.

5. **No authentication.** Both servers exposed voice-session and vision endpoints to anyone
   who could reach them, spending the operator's OpenAI credits.

---

## Placement accuracy

| ID | Issue | Status |
|---|---|---|
| C-A1, S-A4 | Model aimed blind — no localization aids | **Fixed** — labeled 0–1000 coordinate grid burned into every model-bound snapshot |
| C-A1, S-A4 | No way to reference existing ink | **Fixed** — snapshots ship a **CANVAS INK MAP**: visible strokes are clustered into labeled regions (`s1`, `s2`, …) with boxes and author. Actions take `anchor_id` + `anchor_position` and resolve against live geometry instead of guessed coordinates |
| C-A2 | Coordinates resolved against the live viewport, not the captured one | **Fixed** — the view transform is pinned at capture time and plans resolve through it, so panning or zooming mid-request no longer displaces ink |
| C-A3 | Circle schema (top-left + `w`/`h`) fought the model's intuition | **Fixed** — circles are now center-based (`cx`, `cy`, `rx`, `ry`); the legacy form still parses |
| C-A4 | Anisotropic 0–1000 mapping on a non-square canvas | **Fixed** — aspect ratio is disclosed to the model in both prompt and ink map |
| C-A5 | Nothing stopped AI ink covering student work | **Fixed** — planned handwriting is laid out client-side, tested against student stroke bounds, and nudged through candidate offsets until it sits in free space |
| C-A6 | Voice model saw the canvas at `detail:'low'`, 850px | **Fixed** — high-detail snapshot on speech start and on explicit questions; low-detail for ambient updates |
| C-A7 | Planner got no conversation context | **Fixed** — request carries source, transcript, ink map, and aspect |

### The reasoning-order bug

Found while testing, and invisible from the outside. With strict structured outputs, fields
are generated **in schema declaration order**. Both plan schemas listed `intervene` first, so
the model committed to a yes/no *before* doing any arithmetic. In one test it emitted
`intervene: false` and then reasoned, inside a later field, "Wait, 12/5 equals 2.4, so the
final decimal is incorrect" — the error was found and silently discarded.

Both schemas now place a `derivation` field **first**, forcing the model to work every visible
step before it decides. This measurably changed the outcome on the regression case.

---

## Voice experience

| ID | Issue | Status |
|---|---|---|
| C-B1 | Voice model couldn't draw; drawer couldn't hear | **Fixed** — the realtime model now has a `canvas_action` tool and draws while it speaks. One brain for speech and ink |
| C-B2 | Every utterance triggered a full vision call | **Fixed** — transcript-triggered planning removed; the planner is now only the silent auto-tutor and the no-voice fallback |
| C-B3 | Injected "[TUTOR CONTROLLER] Say the following…" re-reads sounded stilted | **Fixed** — removed. Hint/Check send a normal user turn and the tutor answers in its own voice |
| C-B4 | `suppressVoiceTranscriptInk` was a race condition | **Fixed** — replaced with response-ID bookkeeping; `response.create` queues while a response is active |
| C-B5, S-B2 | VAD tuning | **Fixed** — `semantic_vad` with configurable `VAD_EAGERNESS` (default `auto`) |
| C-B6, S-B4 | No reconnect; a blip killed the session | **Fixed** — auto-reconnect with 1s/2s/4s backoff, context re-sent on recovery |
| C-B7 | No listening feedback | **Fixed** — live mic level meter plus listening / thinking / speaking state |
| C-B8 | `max_output_tokens: 900` truncated explanations | **Fixed** — raised to 2400 |
| S-B1 | **Pen-down cancelled the tutor's speech** | **Fixed** — pen-down cancels only the ink animation; speech is interrupted only by the student's voice |
| S-B3 | `response.create` collided with an active response | **Fixed** — same queueing as C-B4 |
| — | Image tokens grew every turn | **Fixed** — stale canvas context items are deleted as new ones arrive |

---

## Canvas & input

| ID | Issue | Status |
|---|---|---|
| S-A1 | **No palm rejection** — a resting palm drew ink | **Fixed** — pen and mouse draw; touch pans; two fingers pinch-zoom |
| S-A2 | Handwriting was `fillText` in a system font | **Fixed** — replaced with the Hershey vector stroke engine: real pen trajectories, animatable, erasable, identical across platforms, with mathematical glyphs (√ π θ ∫ Δ Σ ∇ α β γ λ μ σ φ ∞ ≤ ≥ →) |
| S-A3 | No pan or zoom; raw pixel coordinates | **Fixed** — full world/view transform with pan, pinch, and wheel zoom |
| S-A5 | Voice model drew against stale snapshots | **Fixed** — snapshot refresh on speech start |
| S-C2, S-C3 | No PNG export; no AI-specific undo | **Fixed** — both added, plus localStorage persistence across reloads |

---

## UI

Both apps gained: text-chat fallback, scrollable transcript history, pen colours, busy
states on Hint/Check, a persistent error banner with retry, a new-page switcher, tutor
volume control, PWA manifest + icon + `apple-mobile-web-app` tags, `env(safe-area-inset-*)`
padding, a full dark theme, visible focus states, and `prefers-reduced-motion` support.

---

## Security & operations

| ID | Issue | Status |
|---|---|---|
| C-D1, S-D1 | No auth on any endpoint | **Fixed** — access code → HttpOnly, SameSite cookie; auth attempts rate-limited per IP (10 per 10 min) |
| C-D2 | No rate limiting | **Fixed** — per-IP token bucket on the expensive endpoints |
| C-D3 | Key lived only in the process environment | **Fixed** — `.env` (git-ignored) loaded at boot |
| C-D4, S-D4 | Per-event synchronous log writes | **Fixed** — batched async flush every 2s |
| S-D2 | Upstream fetches had no timeout | **Fixed** — `AbortSignal.timeout` on all upstream calls |
| S-D3 | Plan JSON extracted by regex from free text | **Fixed** — strict `json_schema` structured outputs |
| S-D5 | Reasoning tokens ate the output budget | **Fixed** — budget raised, effort configurable |
| — | No cost ceiling | **Fixed** — `DAILY_CALL_CAP` refuses upstream calls past a daily limit |

### Known remaining risks

- **X-1** Servers and tunnels are foreground processes; they do not survive a reboot.
  Use a process manager (`pm2`) or a container for anything long-lived.
- **X-2** Cloudflare *quick* tunnels mint a new random URL on every restart and carry no
  uptime guarantee. A named tunnel (free Cloudflare account) gives stable URLs.
- Access-code auth is a shared-secret gate suitable for small trusted groups and study
  participants. It is not user accounts, and it does not isolate one participant's data
  from another's.

---

## Verification

| Check | Result |
|---|---|
| Syntax, all source files | pass |
| DOM id references vs markup (74 refs across both apps) | 0 missing |
| Handwriting engine: placement, wrapping, determinism, math glyphs | pass |
| Auth: no code 401 · wrong code 401 · correct code 302 + cookie · API 401 unauthenticated | pass, both apps |
| Realtime endpoint reaches OpenAI with a tool-equipped session | pass, both apps |
| Static assets over HTTPS | 200, both apps |

**Placement regression test.** A synthetic canvas reproducing a real failure
(`5a + 3 = 15` → `5a = 12` → `a = 12/5 = 2.2`, where 12 ÷ 5 is actually 2.4) is rendered with
the real stroke engine and sent through both AI endpoints. Both catch the division error and
target the correct line by anchor ID; rendering the returned plan through the anchoring math
places the circle exactly around the wrong line, with the correction in free space below.
Previously this produced an empty ellipse in the canvas corner and no mention of the error.
