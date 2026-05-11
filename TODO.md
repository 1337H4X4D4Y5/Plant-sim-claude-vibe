# TODO — WebGPU Plant Simulator

Checkboxes show the version in which an item was implemented. Empty `[ ]` = not started. `[x v0.X]` = shipped in version v0.X.

Version mapping: each milestone in the plan corresponds to a minor version (M1 → v0.1, M2 → v0.2, ..., M7 → v0.7). v1.0 is the first release with all milestones complete.

Each shipped version is snapshotted into `/checkpoints/vX.Y/` as a standalone build. The hub at `/index.html` links to all checkpoints. Every checkpoint embeds `back-to-hub.js` for navigation back to the hub.

---

## v0.0 — Hub & versioning infra

- [x v0.0] Hub landing page at `/index.html` listing all versions with launch buttons
- [x v0.0] Shared back-to-hub button snippet at `/checkpoints/back-to-hub.js`
- [x v0.0] `TODO.md` + `RELEASE_NOTES.md` tracking files

## v0.1 — Hello plant (M1)

- [~] Vite + TypeScript scaffold — **deferred**: npm registry is blocked in the dev sandbox; shipped v0.1 as plain ES modules + `?fetch` WGSL instead. Will reintroduce when registry is available.
- [x v0.1] WebGPU adapter/device bootstrap with feature/limits negotiation
- [x v0.1] Swapchain + canvas resize handling, DPR cap
- [x v0.1] RAF loop + frame timing HUD
- [x v0.1] Orbit camera (mouse drag + wheel zoom, touch drag + pinch)
- [x v0.1] Skydome with gradient + sun disc (fullscreen tri + invViewProj ray reconstruction)
- [x v0.1] Ground quad (procedural value-noise mix of soil/grass)
- [x v0.1] Hand-authored static plant: CPU-built segment buffer, instanced cylinder draw
- [x v0.1] Branch vertex + fragment shaders (tube reconstructed from per-instance quat + length + radius, Lambert + ambient)
- [ ] 60 fps verified on desktop Chrome (user verification needed; sandbox cannot run a browser)
- [x v0.1] Snapshot build into `/checkpoints/v0.1/` referencing `../back-to-hub.js`
- [x v0.1] Flip v0.1 card on hub to `status: 'shipped'`

## v0.2 — GPU growth (M2)

- [x v0.2] Segment storage buffer (48 B × 2048 slots) + atomic append counter
- [x v0.2] Genome uniform layout (32 B, 6 active fields)
- [x v0.2] Fixed-step sim scheduler with accumulator (2 Hz, 0.6 s startup delay)
- [x v0.2] `growth.wgsl` compute kernel: tip extension, lateral branching, depth termination, saturation handling
- [x v0.2] Single plant grows from a seed via L-system-like rules driven by genome
- [x v0.2.7] Instanced leaf quads (3 per segment past depth threshold, billboarded, two-tone green, sun + back-light)
- [x v0.2] Vertex-shader wind animation (world-position sum-of-sines)
- [x v0.2] Snapshot build into `/checkpoints/v0.2/`; flip v0.2 card on hub to shipped

## v0.3 — Many plants + LOD + cull (M3)

- [ ] Spawn 500 plants on a grid with random genomes (`src/sim/seeding.ts`)
- [ ] `cull.wgsl` compute: frustum + LOD bucketing + indirect draw args
- [ ] Indexed instanced indirect draws for branches and leaves
- [ ] 3-bucket LOD: near (full), mid (stride-2), far (impostor)
- [ ] Per-genome impostor atlas with LRU slot eviction (`src/render/impostors.ts`, `impostor_bake.wgsl`)
- [ ] 60 fps verified with 500 plants on desktop
- [ ] Snapshot build into `/checkpoints/v0.3/`; flip v0.3 card on hub to shipped

## v0.4 — Light + evolution (M4)

- [ ] Light grid R16F texture + `light.wgsl` (clear, splat, sample)
- [ ] Fitness accumulation into PlantHeader
- [ ] `evolve.wgsl`: seed drop with mutated genome
- [ ] Seed germination kernel
- [ ] Field self-populates over time (5-min observation gate)
- [ ] Snapshot build into `/checkpoints/v0.4/`; flip v0.4 card on hub to shipped

## v0.5 — Shadows + fidelity (M5)

- [ ] Single 1024² sun shadow map, frustum-fit (`src/render/shadow.ts`, `shadow.wgsl`)
- [ ] Fake-SSS leaf shading (wrap-diffuse + back-light)
- [ ] Analytic sky upgrade (Hosek-cheap)
- [ ] ACES tonemap + gamma post (`post.wgsl`)
- [ ] Height-blended ground detail texture
- [ ] Snapshot build into `/checkpoints/v0.5/`; flip v0.5 card on hub to shipped

## v0.6 — Interactions + UI (M6)

- [ ] Touch pinch-to-zoom + drag-to-orbit (Pointer Events)
- [ ] CPU ray-vs-AABB → ray-vs-segment picking (`src/sim/picking.ts`)
- [ ] Tap-to-plant (drops a seed at hit point)
- [ ] Tap-to-prune (removes hit plant)
- [ ] Tap-to-inspect (genome overlay with stats)
- [ ] Time controls: pause, 1×, 2×, 4×, 8× scrub UI (`src/render/ui.ts`)
- [ ] Snapshot build into `/checkpoints/v0.6/`; flip v0.6 card on hub to shipped

## v0.7 — Mobile polish (M7)

- [ ] Profile on iPhone 15 Pro Max via Safari Web Inspector
- [ ] Storage buffer cap detection + `maxSegments` auto-scaling
- [ ] Texture format fallback chain (`depth24plus` → `depth16unorm`, etc.)
- [ ] `shader-f16` feature detect + opt-in paths
- [ ] Impostor bake throttling (N per frame cap)
- [ ] Memory stays under 150 MB during stress
- [ ] 60 fps locked for 60 s with 500 plants + active sim on device
- [ ] Snapshot build into `/checkpoints/v0.7/`; flip v0.7 card on hub to shipped

## v1.0 — Public release

- [ ] All v0.1–v0.7 items checked
- [ ] README with screenshots and controls
- [ ] Deploy build to static host
- [ ] Cross-browser smoke test (Chrome, Edge, Safari 17+)

---

## Backlog (post-v1.0, unscheduled)

- [ ] Flowers + seasonal color shifts
- [ ] Multiple biomes (desert, tundra) with different genome priors
- [ ] Save/load ecosystem state to localStorage / file
- [ ] Genome-graph view of evolutionary lineage
- [ ] Pollinators / herbivores
- [ ] Weather (rain affects light grid, wind variability)
- [ ] Day/night cycle with light grid reset
