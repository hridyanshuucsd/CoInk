# CoInk Tutor: next architecture

## Decision

CoInk is the product and repository foundation. Its strongest differentiators are the
single-brain Realtime voice loop, animated vector handwriting, tablet input, research
logging, deployment path, and existing ownership under the CoInk repository.

The next canvas runtime is based on PenEcho 0.9.0 at upstream commit
`3a2d4fbffbe56ec26a97a8de2dee6827a9e7e655`. The project owner has stated that a signed
declaration authorizes reuse of the PenEcho code for this product. PenEcho names, logos,
and other brand assets are not part of the product identity and must not ship in the
CoInk user interface.

StudyInk remains a useful sibling reference. It shares the same input, handwriting, and
Realtime modules, but CoInk is the better merge target because it already includes the
more complete deployment and research-operations surface.

## Product contract

CoInk should feel like a private human tutor sitting beside the learner:

1. It listens and speaks continuously with natural interruption.
2. It sees the current page and spatial relationships, not only a transcript.
3. It writes explanations in an identifiable animated hand.
4. It creates editable images, plots, flowcharts, and professional diagrams.
5. It checks mathematical steps with deterministic symbolic verification before
   presenting corrections.
6. It keeps all AI output provisional until the learner accepts it.

## Runtime shape

```text
student pen + typed input + voice
                |
                v
       sparse shared canvas
        |              |
        |              +--> Realtime voice model --> canvas command tool
        |
        +--> focused visual atlas --> reasoning model --> validated draft commands
                                                        |
                                                        +--> symbolic math verifier
                                                        +--> local diagram renderers
                                                        +--> vector hand renderer
                                                        +--> image workflow
```

The browser owns geometry, rendering, draft interaction, and persistence. The server owns
credentials, access control, model orchestration, command validation, symbolic checking,
and bounded external media access. Realtime speech and visual planning share the same
canvas command vocabulary so the tutor never promises a mark that a second disconnected
agent must create.

## Implemented integration

1. The sparse PenEcho canvas, selection, draft, persistence, plugin, image, diagram,
   desktop, mobile, and test foundations are imported without its logo artwork.
2. The user-facing package, executable, UI, icons, updater, repository links, and fresh
   configuration path are CoInk-branded. Legacy identifiers remain readable where required
   to migrate saved data or preserve internal IPC compatibility.
3. WebRTC Realtime call setup is server-side and same-origin protected. The browser sends a
   current canvas snapshot and exact source rectangle to the voice tutor.
4. `handwrite_text` is a first-class validated draft command backed by deterministic
   Hershey trajectories.
5. The Realtime model can call `canvas_commands` for handwriting/simple marks and
   `verify_math` for deterministic evidence while speaking.
6. The symbolic service verifies exact rational arithmetic, polynomial equivalence, and
   proportional equation transformations.
7. `generate_image` routes explicit raster requests through a server-side GPT Image
   gateway and returns a normal movable, resizable, confirmable canvas draft.
8. Focused regression tests cover voice/tool state, handwriting determinism, generated
   image validation, diagram rendering, media safety, and symbolic math.

## Privileged tutor endpoints

| Endpoint | Input | Boundary |
|---|---|---|
| `POST /api/realtime/call` | Bounded `application/sdp` offer | Same-origin access context; OpenAI key stays server-side |
| `POST /api/images/generate` | JSON prompt and logical dimensions | Same-origin access context; one validated image command per planner response |
| `POST /api/math/verify` | Bounded JSON statement or expression pair | Same-origin access context; local deterministic computation only |

The image and Realtime gateways reuse the selected key only when the selected connection is
the official OpenAI host. A dedicated CoInk key can be configured when the visual planner
uses a local, Anthropic, or other compatible provider.

## Non-goals for the first integrated release

- Claiming that the tutor is human.
- Executing arbitrary model-generated JavaScript outside the existing sandbox boundary.
- Treating model reasoning as mathematical proof without symbolic evidence.
- Shipping PenEcho trademarks or relying on undocumented terms of the reuse declaration.
