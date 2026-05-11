# Release Notes — WebGPU Plant Simulator

Reverse chronological. Each version corresponds to a milestone in the implementation plan. Entries are added when a version ships.

---

## Unreleased

_v0.1 work in flight. See `TODO.md`._

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
