# Release Notes — WebGPU Plant Simulator

Reverse chronological. Each version corresponds to a milestone in the implementation plan. Entries are added when a version ships.

---

## Unreleased

_v0.3.3 scales to 256 plants. v0.3.4 will add GPU frustum culling + indirect draws so the per-frame cost stops scaling with `maxSegs`._

## v0.3.3 — 256-plant field (2026-05-11)

Scale up the field to actually feel like a forest.

### Changed
- `CONFIG.sim.maxPlants: 64 → 256` (16×16 grid).
- `gridSpacing: 4.0 → 3.5`, `gridJitter: 1.1 → 1.2` to keep the field a manageable ~56 m wide while filling in densely.
- Camera defaults: `initialDistance: 24 → 55`, `initialPitch: 0.35 → 0.45`, `target.y: 2.0 → 2.5`, `maxDistance: 120 → 220`.
- `CONFIG.farPlane: 200 → 350` so the back of the field doesn't clip when zoomed out.

### Notes
- Segments: 256 × 128 = 32,768. Counter buffer: 16 B header + 1024 B per-plant atomics. Genomes: 256 × 32 = 8 KB.
- Per-frame vertex invocations: branches ~1.57 M, leaves ~590 K. Empty slots still run their VS (early-out before any matrix math), but skip rasterisation.
- No frustum culling yet: every plant is drawn regardless of camera. Visible at this scale is fine; when we hit 500+ plants we'll add GPU cull + indirect draws.

## v0.3.2 — Wider per-plant variation (2026-05-11)

User feedback: "They all grow at the same rate and approximately the same shape and size. I want more variation."

Three things were limiting variation in v0.3.1 — all fixed here.

### Fixed
- **The growth kernel was hardcoding length/radius scales.** It used `0.85, 0.78` for continuation and `0.70, 0.60` for lateral, ignoring the `lenScale`/`radScale` fields on each plant's genome. Now the continuation uses `g.lenScale` directly; lateral branches are `g.lenScale * 0.82` and `g.radScale * 0.77`. A plant with `g.lenScale = 0.65` and `g.radScale = 0.55` rapidly shrinks (chunky shrub), while `0.95 / 0.85` grows tall and thick.
- **All seeds were identical.** Every plant's seed had the same `length: 0.85, radius: 0.16`. Now each plant pulls `seedLength` and `seedRadius` from its genome — CPU-only fields generated alongside the GPU-side ones in `makeGenome`.
- **Phototropism was barely visible.** `growthBias * 0.08` is too small to droop. Bumped to `0.20` so the new negative-bias range actually pulls tips downward.

### Widened (all in `makeGenome`)
- `branchAngle`: 0.30–1.00 rad (was 0.40–0.80)
- `branchProb`: 0.30–0.95 (was 0.55–0.90)
- `lenScale`: 0.65–0.95 (was 0.80–0.90)
- `radScale`: 0.55–0.87 (was 0.72–0.82)
- `maxDepth`: 4–8 (was 5–7) — bushes vs. trees
- `growthBias`: -0.40 to 1.45 (was 0.40–1.40) — negative = droopy
- `seedLength`: 0.55–1.45 m (new)
- `seedRadius`: 0.10–0.28 m (new)

You should now see clear silhouette variation: short bushy plants, tall narrow saplings, broad-canopy specimens, and a few that droop downward.

## v0.3.1 — Per-plant genomes (2026-05-11)

### Changed
- **`genomeBuffer` is now a storage buffer of `array<Genome>`** sized to `maxPlants * 32 B`. Bind type changes from `uniform` to `read-only-storage` in both the growth-compute and leaf-render bind groups.
- **`growth.wgsl`** reads `let g = genomes[plantIdx];` and uses `g.branchAngle`, `g.branchProb`, `g.maxDepth`, `g.growthBias` for its decisions. Each plant now branches and terminates by its own rules.
- **`leaf.wgsl`** gains a 4th binding for `SimParams` so it can compute `plantIdx = segIdx / sim.segsPerPlant`, then reads `g.leafShape` per plant. Each plant shows its own species silhouette + colour.
- **`makeGenome(seedBase, plantIdx)`** generates per-plant random values: branchAngle 0.40–0.80 rad, branchProb 0.55–0.90, lenScale 0.80–0.90, radScale 0.72–0.82, maxDepth 5–7, growthBias 0.40–1.40, leafShape one of {oval, round, lance, lobed, heart}. CPU keeps a mirror in `sim.cpuGenomes` so the leaf-cycle button can rebuild the buffer.
- **Leaf-shape cycle button** now has 6 states: `varied` (each plant uses its own genome.leafShape) and the 5 named overrides (`oval`, `round`, `lance`, `lobed`, `heart`) that rewrite every plant's slot to the same shape — useful for picking one species out of the field.

### Notes
- Branches still all look the same colour because trunk colour is hardcoded in `branch.wgsl`. Per-genome bark colour is a v0.5 (fidelity) item.
- The growing rules now genuinely diverge between plants, so the field will show some short bushy plants next to tall slender ones once growth converges (~10 sim ticks).

## v0.3.0 — Many plants on a grid (2026-05-11)

First chunk of M3. Replace the single-plant simulation with an 8×8 grid of plants, all sharing one genome for now so we can verify the per-plant-slot architecture before adding per-plant genomes.

### Changed
- **`CONFIG.sim` extended:** `maxPlants: 64`, `segsPerPlant: 128`. `maxSegs` becomes a getter that derives `64 × 128 = 8192` total slots. Grid spacing + jitter exposed too.
- **`SimParams` gains `segsPerPlant`** in the 4th `u32` slot (replaces `_pad`). The growth kernel reads it to compute `plantIdx = i / segsPerPlant`.
- **`Counters` storage struct restructured.** The single global `next` is gone; its slot is reused as `totalSegs` (aggregate count for the HUD). Tail of the struct is now a runtime-sized `array<atomic<u32>>` of per-plant next-free counters. CPU initialises each one to `1` (the seed). 16-byte header keeps the existing readback layout intact.
- **`createSimResources` initialises N seeds** at offsets `p × segsPerPlant`, one per plant, with grid + deterministic-jitter world positions.
- **Growth kernel:** per-tip atomic now bumps `counters.plantNext[plantIdx]` instead of the global counter. Plants saturate independently — running out of slots on one plant doesn't stop others. `counters.totalSegs` gets the aggregate.
- **Camera defaults pulled back:** `initialDistance: 24`, `target.y: 2`, `maxDistance: 120` so the field is visible on first load.

### Notes
- All 64 plants share one genome (same leaf shape, same branching). Visually they vary because the growth RNG keys off segment index, so each plant's tips draw different jitter — they're not identical clones. v0.3.1 will give each plant its own genome.
- No frustum culling / LOD yet — every segment runs through the vertex stage. 8192 cylinder instances at ~48 verts each is well within mobile budget.

## v0.2.9 — Species-shaped leaves (2026-05-11)

User wanted leaves to look like leaves, not rectangles — and to vary by species.

### Added
- **`leafShape` field on the genome uniform** (replaced the unused `_pad0` slot at offset 24 — so the struct size is unchanged at 32 B). Values:
  - `0` — oval / lanceolate (default)
  - `1` — round / orbicular (birch-ish)
  - `2` — lance / willowy (narrow, pointed both ends)
  - `3` — lobed / maple-ish (5-lobed via polar `cos(5θ)` modulation)
  - `4` — heart / cordate (cardioid curve)
- **Silhouette in the fragment shader.** Each leaf instance is still a quad; the fragment shader runs `leafMask(uv, shape)` and `discard`s pixels outside the shape. UV is forwarded from VS as `(q.x, q.y)` ∈ [-0.5, 0.5] × [0, 1] (already what the billboard math uses, no extra work).
- **Per-species color bias.** Oval = classic green, birch = yellower, willow = cooler/teal, maple = punchier saturation, heart = red-tinged. Sun + back-light still applied on top.
- **Tighter quad bounds for narrow species.** The `lance` shape scales the quad's horizontal extent to 55 % so we don't pay for the alpha-test discard on huge swathes of empty quad.
- **Leaf bind-group gained a genome uniform binding** (`@group(0) @binding(2)`) — same buffer the growth compute already uses, so no new resources.
- **Hub button: "Leaf: oval ›".** Tapping cycles to the next species and `queue.writeBuffer`s only the 4-byte `leafShape` slot of the genome uniform. The change is visible on next frame.

### Notes
- Trunk/branch shape isn't species-aware yet — only the leaves change. v0.4 will let the GA mutate every genome field, including `leafShape`, so each evolved lineage will inherit and drift its species traits.

## v0.2.8 — Leaves sway with wind (2026-05-11)

User report: "The leaves don't sway with the tree." Branches use `windOffset(worldPos, time)` in their vertex shader to add a position-keyed sum-of-sines, but the leaf shader didn't.

### Fixed
Copied the same `windOffset` function into `leaf.wgsl` and applied it to the leaf's anchor position (the point on the parent segment) before computing the billboard. Because the wind is purely a function of world position + time, a leaf at the same world point as a branch vertex gets the same offset, so the two move in lock-step.

## v0.2.7 — Leaves (2026-05-11)

User confirmed v0.2.6: "The tree grows. No leaves." Adding the leaf renderer that was deferred from v0.2.

### Added
- **`shaders/leaf.wgsl`** — new vertex+fragment pair. Indexed as `instance_index = segIdx * LEAVES_PER_SEG + leafIdx`, so each segment with `depth ≥ 2.5` sprouts 3 instanced quads.
- **Camera-billboard quads.** The view matrix's first two rows give world-space right/up, so each leaf always faces the camera. The world-space anchor is a point along the parent segment (parametric `t ≈ 0.32, 0.64, 0.96` with hash-driven jitter), offset radially by a per-leaf twist.
- **Per-leaf variation.** A `hash32(segIdx * 17 + leafIdx + 7)` drives leaf size (0.085–0.135 m), twist offset, and a 0–1 shade value that mixes between dark and light green.
- **Shading.** Sun-driven Lambert plus a softer back-light term (so leaves seen from below still catch some sun), tinted by the per-leaf shade. A fake normal that leans toward world-up keeps top-down lighting bright.
- **Renderer.** `createLeafRenderer` mirrors `createBranchRenderer`; same bind-group layout (frame uniform + segments storage). `2048 segs × 3 leaves = 6144 instances × 6 verts = ~37 k vertex invocations`, ~half what branches cost. Drawn after branches with `depthCompare: 'less'`, `depthWriteEnabled: true`, no blending.

### Notes
- Leaves are solid quads for v0.2.7 — no alpha cutout / texture. They'll get prettier (proper leaf shape, fake SSS) in v0.5.
- Threshold is fixed in the shader (`DEPTH_THRESHOLD = 2.5`) — will become a genome parameter in v0.4.

## v0.2.6 — Growth bug fix: reserved word `ref` (2026-05-11)

### Found
After v0.2.5 fixed the bitwise-precedence error, the diagnostic dump surfaced a *second* Safari WGSL rejection:

```
shaderMessages.growth:
  error: Expected a Identifier, but got a ReservedWord @ 138:7
```

Line 138 was:

```wgsl
let ref = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), absY > 0.9);
```

`ref` is in the WGSL reserved-words list (reserved for a future reference-type modifier). Naga/Chrome doesn't enforce it; Safari does.

### Fixed
Renamed `ref` → `refAxis` in `growth.wgsl` (the only place it appeared).

### Lesson
The other shaders also use `in` and `out` as identifiers and compile fine, so Safari's reserved-word check isn't applied to every token in the spec's reserved list — but `ref` is definitely enforced.

## v0.2.5 — Growth bug fix: WGSL bitwise parens (2026-05-11)

### Found
v0.2.4's diagnostic dump pinpointed the bug:

```
shaderMessages:
  growth:
    create: 1 error generated while compiling the shader:
    116:2: Expected a ;, but got a ^
gpuScopeErrors:
  [growth-pipeline] createComputePipeline failed
  [first-tick-frame] encoder state is not valid
```

The line was:

```wgsl
let seedBase = i * 73856093u ^ sim.tick * 19349663u ^ sim.rngSeed;
```

WGSL's grammar requires bitwise operators (`^`, `&`, `|`) to take **unary** expressions as operands — not arbitrary expressions. `i * 73856093u` is a multiplicative expression, so the `^` after it is a parse error. Naga (Chrome/Edge) is lenient about this; Safari's WGSL compiler enforces the spec strictly. The growth shader silently failed to compile, the compute pipeline was invalid, and every dispatch was a no-op — which is exactly why `dispatched` stayed 0.

### Fixed
Parenthesised the multiplicative terms in `growth.wgsl`:

```wgsl
let seedBase = ((i * 73856093u) ^ (sim.tick * 19349663u)) ^ sim.rngSeed;
```

### Kept
All diagnostic instrumentation from v0.2.1 → v0.2.4 is retained so we can verify the fix on device and have the same diagnostics ready if anything else breaks.

## v0.2.4 — Compile info + validation scopes (2026-05-11)

### Reason
v0.2.3 readout: `simTick: 27`, `dispatched: 0`, all kernel probes 0, `errors: (none)`. The compute kernel never runs but nothing is reporting an error. Most likely something in pipeline creation, bind-group creation, or the dispatch itself is being rejected without firing the `uncapturederror` event on this Safari build.

### Added
- **`compileShader(device, code, label)` helper.** Creates each shader module inside its own `validation` error scope, then immediately calls `module.getCompilationInfo()` and stashes every message into `debugState.shaderMessages[label]`. The Copy debug dump now prints all four shader's compilation messages.
- **`withScope(device, label, fn)` helper.** Wraps any sync GPU-creation call in a `pushErrorScope('validation')` / `popErrorScope()` pair. Used around `createGrowthPipeline`, the growth bind-group, and the three render-pipeline create functions. Anything WebGPU silently rejects now lands in `debugState.gpuScopeErrors`.
- **First-tick frame is wrapped in a validation scope** that pops asynchronously after submit. Catches any per-dispatch / per-pass validation error.
- Refactored `createGrowthPipeline`, `createBranchRenderer`, `createFullscreenRenderer` to accept a pre-compiled module instead of source code, so the validated module is the same one that ends up in the pipeline.

### How to read v0.2.4
After ~5 seconds:
- If `shaderMessages.growth` contains lines starting with `error:` → WGSL compilation failure. The error message will tell us what to fix.
- If `gpuScopeErrors` has a `[growth-pipeline]` entry → pipeline creation rejected. The message will say why.
- If `gpuScopeErrors` has a `[growth-bindgroup]` entry → bind-group entries don't match the layout.
- If `gpuScopeErrors` has a `[first-tick-frame]` entry → the dispatch itself was rejected (rare).
- If all of the above are empty but `dispatched` still 0 → device-level bug, escalate.

## v0.2.3 — Kernel probe counters (2026-05-11)

### Reason
v0.2.2 debug dump showed `simTick: 11`, `segs: 1`, and `errors: (none)` on iPhone 15 Pro Max — so the CPU sim scheduler is firing but no GPU thread is reaching `atomicAdd` on the segment counter. This build splits that one counter into four so we can tell whether the dispatch even ran, whether the seed read back correctly, and whether the uniform buffer is being delivered to the kernel.

### Added
- **`Counters` storage struct** (16 B) replaces the bare `atomic<u32>` binding:
  - `next` — same as before, atomic append index for new segments.
  - `dispatched` — thread 0 unconditionally bumps this. If it stays 0 the compute pipeline isn't dispatching at all.
  - `liveTips` — bumped after the alive+tip+age gate passes. If `dispatched` grows but this stays 0, the seed's flags are being read as something other than `TIP | ALIVE`.
  - `maxIdx` — `atomicMax` of the observed `sim.tick`. If this stays 0 while CPU `simTick` climbs, the sim-params uniform isn't actually reaching the kernel.
- HUD gets a third row: `disp · live`. The Copy debug dump labels each counter inline so the readout is self-describing.

### How to read v0.2.3
After ~10 seconds of running, ideal readout would be:
- `simTick: 11` (CPU side)
- `dispatched: 11` (kernel ran every tick)
- `liveTips: ~10+` (seeds and growing tips made it through the gate)
- `next: > 1` (segments getting appended)

The diagnostic decision tree:
- `dispatched == 0` → compute pipeline isn't dispatching. Bind-group or pipeline-creation issue.
- `dispatched > 0, maxIdx == 0` → uniform buffer not landing in the kernel.
- `dispatched > 0, liveTips == 0` → seed's `flags` field isn't being read as 3 (storage-buffer layout mismatch).
- `liveTips > 0, next == 1` → kernel passes the gate but never reaches `atomicAdd(&counters.next, ...)`. Probably the maxDepth check failing.
- All four grow → kernel works, render path is the culprit.

## v0.2.2 — Copyable debug + non-overlapping HUD (2026-05-11)

### Fixed
- HUD on iPhone was being clipped/overlapped by the help text block at the top of the screen. Both panels now live in their own corners with explicit `max-width` caps and `env(safe-area-inset-top)` respected, so they never grow into each other.
- Help text was desktop-shaped (long lines); rewritten as a compact 4-line list and shrunk for mobile.

### Added
- **Copy debug button** inside the HUD. Tapping it writes a multi-line dump to the clipboard:
  - version, elapsed time, userAgent, viewport size + DPR
  - WebGPU availability, init error (if any)
  - canvas size, swapchain format
  - adapter info (vendor / architecture / device / description)
  - feature list and a hand-picked set of limits (buffer sizes, alignments, compute workgroup caps)
  - device-lost reason + message if applicable
  - live fps, simTick, segs counter
  - error log captured from `window.onerror` + `unhandledrejection` + init failures
- **Fallback overlay**: if the browser blocks `navigator.clipboard.writeText` (some in-app webviews do), the dump is shown in a pre-selected textarea so the user can long-press → Copy.
- `device.addEventListener('uncapturederror', ...)` so silent GPU validation errors land in the console.

### Notes
- Built on top of v0.2.1; behavior is identical otherwise. Use this to capture diagnostics for the v0.2 growth issue.

## v0.2.1 — GPU growth diagnostic build (2026-05-11)

### Reason
User reports that the v0.2 plant does not grow on iPhone. Without a way to run a debugger on device, this build adds visibility into the GPU sim state so we can tell which subsystem is failing.

### Added
- **Live HUD line** showing the current sim `tick` (CPU-driven) and the GPU `segs` count (read back from the atomic counter every ~500 ms via `copyBufferToBuffer` → `mapAsync`).
- Counter buffer now has `COPY_SRC` usage so the staging copy works.
- A dedicated 16-byte staging buffer with `COPY_DST | MAP_READ` for the async readback.

### Changed
- Renamed the Segment `length` field to `len` in both `branch.wgsl` and `growth.wgsl`. `length` isn't a reserved WGSL word but it shadows the built-in vector-length function and some implementations have been buggy about that — defensive rename.

### How to read the HUD
- `tick` stays at 0 → the JS sim scheduler isn't firing.
- `tick` grows but `segs` stays at 1 → compute is dispatching but the kernel isn't appending children (kernel bug).
- `tick` and `segs` both grow → compute is appending, but the render isn't showing the new instances (render-side bug or sync issue).
- `segs` reads `err` → counter readback failed; likely a device-lost from a compute validation error.

## v0.2 — GPU growth (2026-05-11)

### Added
- **Segments live on the GPU.** Replaced the CPU-built vertex buffer with a `storage` buffer of 2048 segment slots (48 B each). The branch vertex shader reads from it indexed by `@builtin(instance_index)` and skips slots where the `ALIVE_BIT` is unset.
- **Atomic append counter.** A second storage buffer holds an `atomic<u32>` "next free slot" counter, started at 1 (seed is at index 0).
- **Genome uniform** (32 B): branch angle, branch probability, length & radius scales, max depth, growth bias. Hardcoded for v0.2 — these will be mutated per-plant in v0.4.
- **Growth compute kernel** (`shaders/growth.wgsl`): one workgroup per 64 segment slots. For each alive tip created on an earlier sim tick, decides between 1 (continuation only) or 2 (continuation + lateral) children, allocates slots atomically, writes children with golden-angle phyllotaxy + phototropism, and clears the parent's tip bit. Saturates gracefully at `maxSegs`.
- **Fixed-step sim scheduler** (~2 Hz): an accumulator decoupled from the render loop dispatches one growth pass per sim tick, after a 0.6 s pause so the seed is visible before sprouting.
- **Wind animation** in the branch vertex shader: world-position-driven sum-of-sines, amplitude scales with world Y so trunks barely sway and tips sway most. Position-keyed (not segment-local) so neighboring segments stay joined at their seams.
- **Combined compute + render encoder**: one `commandEncoder` per frame holds the optional growth pass followed by the render pass, leaning on WebGPU's automatic inter-pass synchronization for the segment buffer read-after-write.

### Changed
- The CPU no longer authors the plant. Initial state = a single seed segment written into the segments buffer at creation via `mappedAtCreation`.
- `branch.wgsl` no longer takes vertex-buffer instance attributes; it reads everything from the segment storage buffer.

### Notes
- ~5 sim ticks @ 2 Hz fills out the plant, so the user can watch it grow over ~3 seconds before it stabilizes.
- All pipelines still use `cullMode: 'none'` (carried from v0.1). Back-face culling will come once verified on device.
- No leaves yet — those are v0.2.1.

## v0.1.1 — Camera traversal (2026-05-11)

### Added
- **Pan**: drag the focal point along the view plane.
  - Touch: two-finger drag (pinch is now composable with pan — both gestures apply simultaneously).
  - Desktop: right-drag, middle-drag, or `Shift`+left-drag.
  - Math: world translation per pixel is `2 · distance · tan(fovY/2) / canvasHeightPx`, applied along the view matrix's first two rows so the drag tracks the cursor in the focal plane.
- **WASD keyboard traversal**: W/S move forward/back along the camera's ground-projected forward axis; A/D strafe along the right axis; Q/E lower/raise the focal point. Speed scales with current zoom distance so it feels right whether you're zoomed in on one branch or pulled back over the field.
- Right-click context menu suppressed on the canvas.

### Notes
- Pan/zoom on touch are now combined into a single two-finger gesture. The centroid delta drives pan; the spread delta drives zoom. This matches Maps-style feel.

## v0.1 — Hello plant (2026-05-11)

### Added
- WebGPU context with adapter/device init, swapchain configuration, DPR cap at 2, depth buffer, and ResizeObserver-driven reconfigure.
- Orbit camera with mouse drag + wheel zoom + touch drag + two-finger pinch (Pointer Events; no `gesturechange` reliance).
- Frame uniform block (336 B): view, proj, viewProj, invViewProj, camera position + time, sun direction/color, ambient, viewport.
- Analytic sky shader: fullscreen triangle, world-ray reconstructed via `invViewProj`, gradient zenith→horizon, soft below-horizon tint, sun disc + glow.
- Procedural ground shader: 80 m² quad, 3-octave value-noise blend of soil and grass, radial vignette to fake distance fade.
- Procedural static plant ("hello plant"): recursive L-system that emits ~50–150 segments with phyllotaxy, phototropism bias, and per-branch tilt/twist. CPU mirror; uploaded as an instance vertex buffer.
- Branch renderer: each segment is one instance of an 8-sided cylinder reconstructed in the vertex shader from `(basePos, length, oriQuat, radius)`. Lambert + ambient shading; bark color interpolates with branch depth.
- FPS HUD in the corner.

### Notes
- **Vite/TypeScript scaffold deferred.** The dev sandbox has no npm registry access (403 on every package), so v0.1 ships as plain ES modules + `fetch()`-loaded WGSL with no build step. Source = artifact, lives directly in `/checkpoints/v0.1/`. The Vite/TS layout will return when registry access is available.
- All pipelines use `cullMode: 'none'` for v0.1 to sidestep front-face winding bugs until proven correct in-browser. Back-face culling will be turned on in v0.2 once verified on device.
- 60 fps verification on iPhone 15 Pro Max is pending — needs the GitHub Pages deployment to be enabled (see the deploy instructions earlier in the session).

## v0.0 — Hub & versioning infra (2026-05-11)

### Added
- Static landing page at `/index.html` listing every planned and shipped checkpoint, with launch buttons and WebGPU-support detection banner.
- Shared `/checkpoints/back-to-hub.js` snippet that injects a fixed `← Hub` button into each checkpoint build.
- `TODO.md` checklist with per-version checkpoints (M1–M7 → v0.1–v0.7), plus a post-v1.0 backlog.
- This release notes file.

### Notes
- The active Vite dev project will live under `/app/` so it does not conflict with the hub's `/index.html`. Builds for each shipped version are snapshotted into `/checkpoints/vX.Y/`.

---

<!--
Template for future entries:

## vX.Y — Title (YYYY-MM-DD)

### Added
-

### Changed
-

### Fixed
-

### Performance
-

### Known issues
-
-->
