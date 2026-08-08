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

## Integration sequence

1. Import the sparse PenEcho canvas, selection, draft, persistence, plugin, image, diagram,
   desktop, and test foundations without its brand assets.
2. Rebrand the user-facing product and storage/configuration surface as CoInk.
3. Add the existing CoInk WebRTC Realtime client and server call setup.
4. Add `handwrite_text` as a first-class validated draft command backed by the existing
   Hershey trajectory renderer.
5. Expose the same command protocol to the Realtime model through one tool.
6. Add a deterministic math service for exact arithmetic, polynomial equivalence, and
   equation-step equivalence; feed its evidence into tutor corrections.
7. Add focused regression tests for voice/tool state, handwriting determinism, diagram
   validation, media safety, and symbolic math.

## Non-goals for the first integrated release

- Claiming that the tutor is human.
- Executing arbitrary model-generated JavaScript outside the existing sandbox boundary.
- Treating model reasoning as mathematical proof without symbolic evidence.
- Shipping PenEcho trademarks or relying on undocumented terms of the reuse declaration.

