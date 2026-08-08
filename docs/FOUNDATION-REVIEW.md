# Foundation review and selection

Review date: 2026-08-09.

## Decision

Use **CoInk** as the product repository and **PenEcho 0.9.0** as its next-generation
canvas foundation. StudyInk is not the merge target.

The decision is not based on a superficial feature count. CoInk and StudyInk began as
close siblings with the same core tutor idea, Realtime voice loop, Hershey handwriting,
and pointer canvas. CoInk already carried the better product-operating context: container
deployment, a documented research workflow, session logging, and the repository/product
identity the owner wants to keep. StudyInk's convenience launch scripts are useful, but
they do not outweigh CoInk's deployment and study-operation surface.

## CoInk versus StudyInk

Audited baselines:

- CoInk `main`: `da90a01a4959b2b406fed0d48a6701742868afce`
- StudyInk `main`: `48adf046e646250cde8f04631e5d06df03f7c481`

| Area | CoInk baseline | StudyInk baseline | Decision impact |
|---|---|---|---|
| Core tutor | Realtime voice, vector handwriting, visual planner | Substantially the same tutor core | Tie |
| Canvas/input | Stylus, palm-aware navigation, autosave, ink mapping | Substantially the same canvas family | Tie |
| Research operations | Participant-oriented JSONL session logging and documented deployment | Session logging, but a smaller operating surface | CoInk advantage |
| Deployment | Dockerfile and Docker ignore policy | Windows and macOS/Linux launch helpers | CoInk advantage for a hosted study/product |
| Repository identity | Already the desired CoInk product | Sibling StudyInk identity | CoInk advantage |
| Next-canvas fit | Clean place to replace the prototype canvas while retaining tutor IP | Would require the same replacement plus a product rename | CoInk advantage |

Both baseline syntax checks passed during the review. Neither baseline had a substantive
automated test suite, so passing `node --check` was not treated as strong evidence of
runtime correctness. The integrated branch adds the upstream test system and focused tests
for the new tutor capabilities.

## PenEcho investigation

The audited upstream revision is
`3a2d4fbffbe56ec26a97a8de2dee6827a9e7e655`, whose package version is 0.9.0. At review
time the repository's latest tagged GitHub release was 0.8.1, so the imported foundation
tracks an audited commit rather than assuming the latest release archive contains the same
code.

### Architecture

PenEcho is a Node server plus a framework-free browser runtime. Its defining architectural
choice is a sparse document instead of a single giant bitmap:

- a 20,000 × 20,000 logical coordinate space;
- confirmed raster content allocated in 512 × 512 tiles;
- declarative object layers for animations and widgets;
- a viewport renderer that composites only visible material;
- IndexedDB snapshots whose metadata and tile blobs live separately;
- compact visual atlases around current input rather than whole-canvas screenshots;
- structured model commands validated at both the server and browser boundaries; and
- provisional AI drafts that remain editable until explicit confirmation.

That shape is a much better base for a spatial tutor than either sibling's original world
canvas. It scales document state, retains spatial relationships for vision, and gives the
learner control over every AI insertion.

### Major capabilities found

| Capability family | Audited PenEcho behavior |
|---|---|
| Input and editing | Pressure ink, eraser, pan/zoom, text boxes, photos, lasso transforms, object selection, undo/redo |
| AI attention | Dirty regions, hotspot trails, focused visual atlas, source rectangles, selection-only requests |
| AI output | Text, TeX, plots, native mixed drawings, erase operations, animations, widgets, image-oriented plugins |
| Professional diagrams | Mermaid, Graphviz DOT, BPMN, Vega-Lite, GeoJSON, SMILES, and Cytoscape source/rendering paths |
| Extensibility | Built-in and private capability documents, general sandboxed HTML/SVG, bounded public fetch proxy, widget refinement by validated unified diff |
| Persistence | Local history, snapshot tiles, canvas/project bundles, PNG export, desktop update state |
| Packaging | Browser server, Electron desktop, Capacitor mobile, release artifact collection |
| Provider surface | OpenAI- and Anthropic-compatible APIs plus isolated Codex, Claude, and Kimi CLI adapters |
| Security | Same-origin checks for privileged browser paths, local-network rules for CLI launch, CSP, sandboxed widgets, SSRF and payload bounds |

The detailed imported architecture is retained in [PENECHO-ARCHITECTURE.md](PENECHO-ARCHITECTURE.md).

### What PenEcho did not supply

PenEcho was a strong visual workspace, not yet the requested private tutor. The audit found
no integrated speech-to-speech tutoring loop, no first-class AI handwriting command, and no
deterministic symbolic mathematics service. Its image-search/plugin capabilities also did
not constitute a direct, server-controlled generative-image draft workflow. Those gaps are
why importing PenEcho alone would not execute the product vision.

### Risks and mitigations

| Risk | Treatment in CoInk |
|---|---|
| Upstream trademark/product confusion | CoInk UI, package metadata, icons, repository links, executable, and fresh config path are CoInk-branded |
| Existing saved state uses upstream keys | Legacy storage, selected environment names, and IPC identifiers remain readable where changing them would strand users |
| AI-generated HTML | Sandboxed runtime, no cookie/storage/form access, CSP, resource and network validation |
| Model emits unsafe or huge geometry | Server metadata projection plus client command, dimension, count, and area bounds |
| Visual model hallucinates algebra correctness | Exact local verifier evidence is available to voice and server endpoints; unsupported forms are explicit |
| Model keys leak to browser | Realtime SDP and image generation are negotiated by same-origin server gateways |
| Generated images replace precise diagrams | Prompt routing reserves raster generation for explicit artistic/photorealistic requests |
| Dependency drift | Exact production dependency versions and checked-in lockfiles; root production audit is run during release review |

## Integrated product result

The selected branch combines the strongest parts of all three codebases:

1. PenEcho's sparse canvas, focused vision, drafts, plugins, persistence, packaging, and
   professional diagram renderers.
2. CoInk's private-tutor identity and operational/research direction.
3. The sibling tutor work's natural Realtime voice and deterministic Hershey handwriting.
4. A new exact rational-polynomial verifier shared with the voice tutor.
5. A new server-side GPT Image gateway whose output follows the normal confirmable draft
   path.

Voice and visual planning deliberately converge at the canvas command boundary. The
Realtime model can see a current canvas snapshot, write a short handwritten note, draw a
simple mark, and request an exact math check while speaking. The visual planner handles
longer text, formulae, plots, professional diagrams, widgets, and explicit raster-image
requests. Both paths produce learner-controlled output rather than silently mutating the
page.

## Honest capability boundary

“Neurosymbolic math” currently means model pedagogy backed by deterministic evidence for
exact rational polynomial algebra. It does not yet mean a general theorem prover or full
computer algebra system. A future math kernel should add typed expression trees, domain and
assumption tracking, inequalities, units, calculus, geometry predicates, proof-step
certificates, and a broader CAS adapter without weakening the current exact/unsupported
distinction.

## Licensing note

The owner states that a signed declaration from the PenEcho creator authorizes this reuse.
The declaration itself is not committed. The repository records the source revision and
provenance in [NOTICE](../NOTICE), retains its own MIT license, and does not ship PenEcho
logos as CoInk identity. This engineering record is not a substitute for legal review of
the signed declaration or third-party dependency terms.
