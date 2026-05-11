# Release Notes — WebGPU Plant Simulator

Reverse chronological. Each version corresponds to a milestone in the implementation plan. Entries are added when a version ships.

---

## Unreleased

_v0.2 (GPU growth) is next. See `TODO.md`._

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
