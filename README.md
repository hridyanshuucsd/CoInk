# CoInk Tutor

CoInk is a private AI tutor that shares a large spatial canvas with the learner. It can
see handwriting, talk naturally, write back in vector handwriting, create images and
professional diagrams, plot functions, and verify supported algebra exactly before it
judges a step.

The canvas foundation is derived from PenEcho 0.9.0 and is combined with CoInk's voice,
handwriting, and tutoring work. See [NOTICE](NOTICE) for provenance and
[docs/FOUNDATION-REVIEW.md](docs/FOUNDATION-REVIEW.md) for the engineering decision.

## What works

- A sparse 20,000 × 20,000 logical canvas with tiled persistence, pan/zoom, pen, eraser,
  text, photos, lasso editing, undo/redo, snapshots, and project import/export.
- Vision tutoring over a focused canvas atlas, with automatic help after a pen pause and
  explicit hint, explain, answer, plot, correct, erase, and typeset actions.
- Speech-to-speech tutoring over WebRTC with interruption, semantic voice activity
  detection, canvas vision, and tool calls that write or mark the same page while speaking.
- Deterministic Hershey vector handwriting for short hints, labels, and corrections.
- Movable, resizable, confirm/reject drafts for all AI additions, including generated
  images. Nothing becomes part of the page until the learner accepts it.
- Native function plots and lightweight sketches, plus professional Mermaid, Graphviz
  DOT, BPMN, Vega-Lite, GeoJSON, SMILES, and Cytoscape rendering through local plugins.
- General sandboxed HTML/SVG widgets for simulations, richer explanations, and custom
  visualizations.
- Exact rational arithmetic and polynomial normalization for supported equality and
  transformation checks. Unsupported functions are reported as unsupported rather than
  presented as machine-verified proof.
- Browser, Electron desktop, and Capacitor mobile packaging paths.

## Quick start

Requirements: Node.js 20.3 or newer and one supported visual-planner source.

```bash
npm install
node cli.js configure
npm start
```

Open <http://localhost:3888>. On first local setup, CoInk asks you to create a six-digit
access code. That gate protects the browser and AI endpoints; it is not a multi-user
account system.

The configuration center supports:

- an OpenAI- or Anthropic-compatible HTTP API;
- an authenticated Codex CLI;
- an authenticated Claude CLI; or
- an authenticated Kimi Code CLI.

Fresh configuration is stored under `~/.coink/config.env`. An existing
`~/.penecho/config.env` is recognized for migration compatibility. For unattended setup,
start from [`.env.example`](.env.example) or pass `--config FILE`.

## Voice and generated images

Voice and raster generation use official OpenAI endpoints. If the selected planner is an
official OpenAI API connection, CoInk reuses its server-side key. Otherwise set dedicated
`COINK_REALTIME_API_KEY` and `COINK_IMAGE_API_KEY` values in the configuration file.
The browser never receives either key.

The current defaults are:

| Capability | Default |
|---|---|
| Visual planner | `gpt-5.6-terra` in the API setup flow |
| Realtime voice | `gpt-realtime-2.1` with the `marin` voice |
| Raster images | `gpt-image-2`, medium-quality transparent PNG |

Microphone capture requires a secure browser context. `localhost` works directly; an
iPad or another device needs HTTPS, such as a named reverse proxy or tunnel terminating
in front of port 3888.

Image generation is intentionally reserved for an explicit request for raster art,
illustration, or a photorealistic visual. Flowcharts, scientific diagrams, plots, and
mathematical constructions stay deterministic and editable.

## Tutor interaction model

```text
pen + text + images ──> focused visual atlas ──> planner ──> validated draft
                                                             ├─ handwriting
                                                             ├─ plot / diagram / widget
                                                             ├─ generated raster image
                                                             └─ symbolic check

microphone ──> OpenAI Realtime ──> speech
                     │
                     ├─ canvas_commands ──> the same validated draft path
                     └─ verify_math ──────> exact local algebra evidence
```

The browser owns canvas geometry, rendering, draft interaction, and local persistence.
The server owns credentials, access control, provider calls, symbolic verification, and
bounded external-resource access. The voice model and visual planner share the canvas
command vocabulary so spoken references and drawn marks stay connected.

## Canvas and file capabilities

- AI output can be moved and resized before confirmation.
- Markdown and TeX text boxes remain editable.
- Diagrams retain reusable professional source where the renderer supports it.
- Live widgets can be refined, refreshed, resized, and safely sandboxed.
- PNG export crops to content; canvas snapshots and project bundles preserve working
  state; local history is device-scoped.
- Desktop and mobile builds reuse the same browser canvas runtime.

## Development

```bash
npm run build:client
npm test
npm run check
```

`public/app.js` is a checked-in bundle built from the ordered sources in
`src/client/app/`. Always run `npm run build:client` after editing those source files.

Useful entry points:

| Path | Role |
|---|---|
| `cli.js` | CoInk command-line entry point and configuration center |
| `server.js` | Loads the integrated server runtime |
| `src/server/main.js` | HTTP security boundary, AI orchestration, plugins, and persistence |
| `src/server/realtime.js` | Realtime session and voice tool contract |
| `src/server/image-generation.js` | Server-side GPT Image gateway and validation |
| `src/server/symbolic-math.js` | Exact rational polynomial verifier |
| `src/client/app/voice-runtime.js` | Browser WebRTC, canvas context, and tool dispatch |
| `src/client/app/ai-runtime.js` | AI command validation and confirmable drafts |
| `public/handwriting.js` | Deterministic Hershey vector trajectories |
| `public/plugins/` | Diagram, data, and general HTML capability contracts |
| `docs/PENECHO-ARCHITECTURE.md` | Audited upstream architecture reference |
| `docs/ARCHITECTURE-NEXT.md` | Integrated product architecture and boundaries |

For desktop development:

```bash
npm run desktop:deps
npm run desktop
```

Mobile scaffolding is under `tools/mobile`; use `npm run mobile:deps` before the platform
build commands.

## Security and privacy

- Model keys remain server-side and browser API calls require the same-origin access
  context.
- Realtime SDP and generated-image payloads are size- and type-bounded.
- Public widget fetches reject local/private destinations and apply response limits.
- Generated widget code runs in a sandbox without cookies, storage, forms, or secrets.
- Saved canvas state and history are local to the device unless the user explicitly uses
  a shared server snapshot or exports a project.

Before exposing CoInk beyond a trusted group, put it behind HTTPS and a production-grade
identity layer. The built-in six-digit code is a local collaboration gate, not tenant
isolation.

## Scope of symbolic verification

The verifier handles exact integers, decimals converted to rationals, rational arithmetic,
implicit multiplication, polynomial expansion/normalization, polynomial equality, and
equivalent proportional equations. It is not yet a full CAS: calculus, trigonometric
identities, inequalities, domains, units, geometry proofs, and theorem-prover certificates
still require model reasoning and should not be labeled exact verification.

## License and provenance

CoInk's repository license is MIT. Portions of the canvas runtime derive from PenEcho at
upstream commit `3a2d4fbffbe56ec26a97a8de2dee6827a9e7e655`; the project owner states that a
separate signed declaration from the PenEcho creator authorizes this use. That declaration
is held by the owner and is not included in the repository. PenEcho logos and trademarks
are not used as CoInk product identity. See [NOTICE](NOTICE) and
[NOTICE-HERSHEY.md](NOTICE-HERSHEY.md).
