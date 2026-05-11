# Release Notes — WebGPU Plant Simulator

Reverse chronological. Each version corresponds to a milestone in the implementation plan. Entries are added when a version ships.

---

## Unreleased

_v0.2.5 should be the first working GPU-growth build. If it grows on device, v0.3 (many plants + LOD + cull) is next._

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
