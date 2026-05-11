# TODO — WebGPU Plant Simulator

Checkboxes show the version in which an item was implemented. Empty `[ ]` = not started. `[x v0.X]` = shipped in version v0.X.

Version mapping: each milestone in the plan corresponds to a minor version (M1 → v0.1, M2 → v0.2, ..., M7 → v0.7). v1.0 is the first release with all milestones complete.

---

## v0.1 — Hello plant (M1)

- [ ] Vite + TypeScript scaffold (`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`)
- [ ] WebGPU adapter/device bootstrap with feature/limits negotiation (`src/gpu/context.ts`)
- [ ] Swapchain + canvas resize handling, DPR cap
- [ ] RAF loop + frame timing HUD
- [ ] Orbit camera (mouse drag + wheel zoom) (`src/render/camera.ts`)
- [ ] Skydome with gradient + sun disc (`src/render/sky.ts`)
- [ ] Ground quad (`src/render/ground.ts`)
- [ ] Hand-authored static plant: CPU-built segment buffer, instanced cylinder draw (`src/render/branches.ts`)
- [ ] Branch vertex + fragment shaders (`src/shaders/branch.vs.wgsl`, `branch.fs.wgsl`)
- [ ] 60 fps verified on desktop Chrome

## v0.2 — GPU growth (M2)

- [ ] Segment SSBO layout + buffer allocation (`src/gpu/buffers.ts`)
- [ ] Genome layout + CPU mirror (`src/sim/genome.ts`)
- [ ] Fixed-step sim scheduler with accumulator (`src/sim/scheduler.ts`)
- [ ] `growth.wgsl` compute kernel: tip extension, branch, leaf, die
- [ ] Single plant grows from a seed via L-system rules
- [ ] Instanced leaf quads with basic shading (`src/render/leaves.ts`, `leaf.vs.wgsl`, `leaf.fs.wgsl`)
- [ ] Vertex-shader wind animation (sum-of-sines)

## v0.3 — Many plants + LOD + cull (M3)

- [ ] Spawn 500 plants on a grid with random genomes (`src/sim/seeding.ts`)
- [ ] `cull.wgsl` compute: frustum + LOD bucketing + indirect draw args
- [ ] Indexed instanced indirect draws for branches and leaves
- [ ] 3-bucket LOD: near (full), mid (stride-2), far (impostor)
- [ ] Per-genome impostor atlas with LRU slot eviction (`src/render/impostors.ts`, `impostor_bake.wgsl`)
- [ ] 60 fps verified with 500 plants on desktop

## v0.4 — Light + evolution (M4)

- [ ] Light grid R16F texture + `light.wgsl` (clear, splat, sample)
- [ ] Fitness accumulation into PlantHeader
- [ ] `evolve.wgsl`: seed drop with mutated genome
- [ ] Seed germination kernel
- [ ] Field self-populates over time (5-min observation gate)

## v0.5 — Shadows + fidelity (M5)

- [ ] Single 1024² sun shadow map, frustum-fit (`src/render/shadow.ts`, `shadow.wgsl`)
- [ ] Fake-SSS leaf shading (wrap-diffuse + back-light)
- [ ] Analytic sky upgrade (Hosek-cheap)
- [ ] ACES tonemap + gamma post (`post.wgsl`)
- [ ] Height-blended ground detail texture

## v0.6 — Interactions + UI (M6)

- [ ] Touch pinch-to-zoom + drag-to-orbit (Pointer Events)
- [ ] CPU ray-vs-AABB → ray-vs-segment picking (`src/sim/picking.ts`)
- [ ] Tap-to-plant (drops a seed at hit point)
- [ ] Tap-to-prune (removes hit plant)
- [ ] Tap-to-inspect (genome overlay with stats)
- [ ] Time controls: pause, 1×, 2×, 4×, 8× scrub UI (`src/render/ui.ts`)

## v0.7 — Mobile polish (M7)

- [ ] Profile on iPhone 15 Pro Max via Safari Web Inspector
- [ ] Storage buffer cap detection + `maxSegments` auto-scaling
- [ ] Texture format fallback chain (`depth24plus` → `depth16unorm`, etc.)
- [ ] `shader-f16` feature detect + opt-in paths
- [ ] Impostor bake throttling (N per frame cap)
- [ ] Memory stays under 150 MB during stress
- [ ] 60 fps locked for 60 s with 500 plants + active sim on device

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
