# Release Notes — WebGPU Plant Simulator

Reverse chronological. Each version corresponds to a milestone in the implementation plan. Entries are added when a version ships.

---

## Unreleased

_v0.2.1 (leaves) is the likely next step._

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
