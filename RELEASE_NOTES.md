# Release Notes — WebGPU Plant Simulator

Reverse chronological. Each version corresponds to a milestone in the implementation plan. Entries are added when a version ships.

---

## Unreleased

_v0.5.0 opens the fidelity milestone with a global seasonal cycle. Next: fake-SSS leaves or real sun shadow map._

## v0.5.0 — Seasons (2026-05-12)

First feature toward milestone v0.5 (fidelity). The field now cycles through spring → summer → autumn → winter on a 480-second loop (about 2 min per season at 1× speed, ~12 s per season at 10×).

### Implementation

`computeSeason(t, period)` in `main.js` produces `season ∈ [0, 1)`. It's packed into the spare slot of the frame uniform's `viewport` vec4 and read by `leaf.wgsl` as `frame.viewport.z`. No new bind groups; no new buffers.

Two leaf-shader functions handle the visuals:

- `seasonLeafScale(s)` — leaves bud during `[0.0, 0.10]`, full size through `[0.10, 0.85]`, drop during `[0.85, 0.97]`, bare in `[0.97, 1.0]`. The vertex shader bails (clip behind near plane) when scale < 0.02, so winter is a literal no-render.
- `seasonLeafTint(s, summerColor, fallColor)` — summer green through `[0.0, 0.55]`, blends into the species' fall colour through `[0.55, 0.82]`, then to a dead-brown through `[0.82, 0.95]`.

Per-species fall palette (keyed off `genome.leafShape`):

| Shape  | Fall colour          |
|--------|----------------------|
| oval   | amber  `(0.85, 0.55, 0.15)` |
| round  | yellow `(0.92, 0.78, 0.18)` |
| lance  | drab   `(0.55, 0.45, 0.20)` |
| lobed  | red-orange `(0.85, 0.30, 0.12)` |
| heart  | deep red `(0.72, 0.18, 0.18)` |

Per-leaf phase jitter (±2 %) keeps individual leaves from budding or dropping in perfect lockstep — gives the canopy a more organic transition.

### UI

A new HUD pill shows the current season name and percent-of-year. The debug-dump text adds the same line.

### Notes

- Flowers (`plantType == 3`) skip the seasonal tint — their petal palette is already driven by `genome.flowerHue`. They do still bud / drop per `seasonLeafScale`, so flowers bloom in spring/summer and disappear in winter.
- Grass already had no leaves; it's unaffected by seasons.
- Energy / fitness math is unchanged. Plants still photosynthesise the same amount year-round (a winter slowdown would be plausible but risks mass starvation cycles; left for a future version if desired).

All 17 tests pass.

## v0.4.13 — Visible turnover (aging + leaf-tied capture) (2026-05-12)

User: "Plants don't die off nor reproduce to compete with other plants for light."

### Two bugs in v0.4.12

1. **light.wgsl counted depth-2 sticks as fully photosynthetic.** The capture kernel had `if (s.depth < 2.0) return;` and treated every other segment as a 100 % leaf. So a leafless single-chain plant with a depth-2 segment captured the same per-segment light as a leafy plant — they all stayed alive.
2. **Leafy plants in full sun banked infinite energy.** Gain was unbounded; cost was a flat 0.6/tick. Once a plant got established it never died, so the population froze in place after the first generation.

### Fix 1: leaf-tied capture weighting

`light.wgsl` now multiplies captured light by `clamp((s.depth - 1.5) / 1.5, 0, 1)`:

| depth | weight |
|-------|--------|
| 2     | 0.33   |
| 3     | 1.00   |
| 4+    | 1.00   |

A stick that only reached depth 2 captures a third of what a leaf-bearing depth-3+ canopy captures. Combined with the new aging cost, sticks starve.

### Fix 2: energy cap + aging cost

`ENERGY_CONFIG` rebalanced:

| Field            | v0.4.12 → v0.4.13 |
|------------------|-------------------|
| SEED_ENERGY      | 100 → 100         |
| MAX_ENERGY       | (none) → 140      |
| GRACE_TICKS      | 10 → 8            |
| MAINTENANCE_COST | 0.6 → 1.0         |
| AGE_COST         | (none) → 0.012    |

`MAX_ENERGY = 140` caps the ledger so no parent can bank infinite reserves. `AGE_COST = 0.012 * age` means cost scales with age — even a leafy plant in full sun dies around tick 250–350 (test measured 278). Stumps die in ~75 ticks (vs ~167 in v0.4.12).

### Operational changes

- Light readback interval `1000 ms → 250 ms` so the energy ledger reflects current shading rather than 1-second-stale data.
- `REPLACE_CAP` raised `12 → 32` per tick so a wave of starvation deaths gets re-seeded the same tick instead of bottlenecking.

### New tests

`tests/energy.test.mjs` extended:
- **senescence** — confirms even abundant-light plants die of old age (measured: tick 157 with 5000 light)
- **full-sun survival** — leafy plants outlive stumps by ≥3× (measured: 278 vs 75 ticks, 3.7×)
- **energy cap** — flooding light for 100 ticks doesn't push energy above MAX_ENERGY
- **turnover** — well-lit 100-plant steady-state population sees 800 deaths over 1500 ticks (every plant turns over ~8×)

17 tests across both files pass.

## v0.4.12 — Energy ledger, leafless plants starve (2026-05-12)

User question: "How do plants survive without leaves?" — they shouldn't, and now they don't.

### Background

Until v0.4.11 the evolution loop was age-based: every plant retired after 25 ticks regardless of how successful it was, and a fixed `perTick: 3` plants were replaced each sim step. Fitness only influenced *which* parent's genome got passed on. So a stumpy 2-segment plant lived just as long as a leafy 30-segment plant, and the population could carry stumps indefinitely.

### Energy model

Every plant has a `cpuPlantEnergy[p]` field (CPU float, starts at 100). Each evolve tick:

```
gain = measuredLight[p] / LIGHT_PER_ENERGY  (canopy sun captured this tick)
cost = MAINTENANCE_COST                      (only after 10-tick grace period)
energy[p] += gain - cost
```

Tunables (all in `ENERGY_CONFIG` in `main.js` and mirrored in `tests/energy.test.mjs`):
- `SEED_ENERGY = 100`
- `GRACE_TICKS = 10`
- `LIGHT_PER_ENERGY = 4000`
- `MAINTENANCE_COST = 0.6`

A leafless plant captures 0 canopy light (the existing `light.wgsl` capture kernel only counts segments with `depth >= 2`), gains 0/tick, loses 0.6/tick after grace, and dies in ~167 ticks. A leafy plant in full sun gains ~1.5/tick, accumulates energy, and stays alive indefinitely.

### Death-based replacement

`evolveStep` no longer rotates `perTick: 3` plants on a fixed schedule. Instead it replaces every plant whose energy hit 0 (capped at 12 per tick to avoid frame stalls) with a mutated child of a parent picked weighted by current energy. Healthy plants reproduce more; stumps die without descendants.

### Inspect overlay

Tap-to-inspect now shows `energy: X.X / 100` for the selected plant.

### HUD additions

`deaths(last tick)` and `avgEnergy: N.N / 100` lines added to the debug dump.

### New tests

`tests/energy.test.mjs` — 6 tests:
- **grace period** — leafless plants lose no energy in their first 10 ticks
- **starvation** — leafless plants past grace die in 100–200 ticks (verified ~167)
- **survival** — well-lit plants accumulate energy over 5000 ticks
- **break-even** — at the calibrated light level, energy holds flat exactly
- **population evolution** — starts at 50 % stumpy, evolves to 100 % leafy in 800 ticks (128 deaths, 128 births)
- **mass-death stress** — a 100 % leafless population dies completely in <250 ticks (verified 176)

All 15 tests across both files pass.

## v0.4.11 — Smaller plants + long-sim ecosystem test (2026-05-12)

User reported plants still growing far too big and asked for unit tests "that operate over long simulation times". Two fixes.

### Fix: tighter typeBounds, smaller plants

The v0.4.9 bounds gave tree a 7.7 m mathematical max — on a 16 m × 16 m field this reads as a single skyscraper dominating the scene. v0.4.11 trims every type:

| Type   | Field      | v0.4.10 → v0.4.11      | New math max |
|--------|------------|------------------------|--------------|
| tree   | lenScale   | 0.72…0.85 → 0.72…0.82  |              |
| tree   | maxDepth   | 5…7 → 5…6              |              |
| tree   | seedLength | 0.50…1.20 → 0.50…1.10  | 5.74 m       |
| bush   | lenScale   | 0.50…0.68 → 0.50…0.62  |              |
| bush   | maxDepth   | 4…6 → 4…5              |              |
| bush   | seedLength | 0.20…0.55 → 0.18…0.45  | 1.27 m       |
| grass  | lenScale   | 0.55…0.72 → 0.55…0.68  |              |
| grass  | maxDepth   | 3…5 → 3…4              |              |
| grass  | seedLength | 0.08…0.22 → 0.08…0.18  | 0.55 m       |
| flower | lenScale   | 0.50…0.68 → 0.48…0.62  |              |
| flower | seedLength | 0.12…0.32 → 0.12…0.28  | 0.75 m       |

Runtime height cap in `growth.wgsl` lowered 12 m → 8 m. Per-child length clamp 2.5 m → 1.5 m. Render-side `lenBad` cap 4 m → 2 m, `posBad` y-abs 20 m → 10 m. Defense in depth.

### Fix: long-running ecosystem unit tests

The old tests checked single plants and short mutation chains. They didn't capture what the live sim actually does: 256 plants growing in parallel, dying, dropping mutated seeds, getting replaced by their children over thousands of life cycles. Two new tests:

- **`long-running ecosystem: 256 plants × 50 life cycles`** — 12 800 plant-lifecycles total. Each lifecycle: simulate the plant to full depth, replace it with a mutated child (30 % chance of cross-pollination from a random parent). Asserts no plant ever exceeds its ceiling. Tallest observed: 5.03 m tree.
- **`long-running stress: 100 plants × 100 generations with upward-biased jitter`** — every plant starts at the upper bound of its type's genome, and `Math.random` is replaced with a `sqrt`-biased version that pushes mutations upward. This simulates pathological selection pressure that always favors bigger plants. Asserts the ceiling still holds. Tallest observed: 5.21 m tree.

Together: 9 tests, all passing.

## v0.4.10 — Thicker twigs, leaves scale to twig (2026-05-12)

User screenshot showed leaves appearing to float in midair, supported by twigs so thin they were barely visible. Cause: leaf size was a fixed 8.5–13.5 cm regardless of the twig holding it. Terminal twigs hit the 5 mm radius floor, giving a 26× leaf-to-twig ratio that reads as disconnected.

### Fix: per-type minimum twig radius

`growth.wgsl` now floors the child segment radius based on plant type: tree 12 mm, bush 9 mm, flower 8 mm, grass 3 mm (grass has no leaves, blades stay thin). This ensures leaf-bearing terminal twigs are always visually substantial.

### Fix: gentler per-segment taper

`branch.wgsl` mixed `s.radius` to `s.radius * 0.88` along the segment, pinching twigs to a needle right where the leaves attach. Changed to `0.94` — a more natural, gradual narrowing.

### Fix: leaf size scales with twig radius

`leaf.wgsl` now computes `size = clamp(s.radius * 8.0, 0.04, 0.16) * (0.85..1.15 jitter)`. A 5 mm twig gets a 4 cm leaf (8× ratio); a 2 cm twig gets a 13–18 cm leaf. Same per-leaf jitter range, but tied to the supporting branch.

### Notes

- Genome typeBounds and unit tests unchanged — this is purely a render-side proportion fix. All 7 tests still pass.
- Grass intentionally retains hair-thin blades; it has no leaves so the floor doesn't affect its silhouette.

## v0.4.9 — Tighter typeBounds, no giant sticks (2026-05-12)

v0.4.8 hardened the runtime cap but didn't fix the root cause: user screenshot still showed giant sticks. The cause was the genome bounds themselves.

### Root cause

Tree `lenScale` upper bound was `0.93`. The growth kernel multiplies each child's length by `parent.len * lenScale * (0.9 + r * 0.2)`. With `lenScale = 0.93` the worst-case per-segment ratio is `0.93 × 1.10 = 1.023` — **greater than one**, so branches grow slightly each tier instead of shrinking. Over 8 levels of depth that compounds to a 14 m mathematical ceiling, and the test correctly accepted it. But "14 m" trees on a 100 m² field look like sticks because the silhouette becomes a single trunk that overshadows everything around it.

### Fix: tighten every type's bounds

| Type   | Field      | v0.4.8 → v0.4.9       |
|--------|------------|-----------------------|
| tree   | lenScale   | 0.72…0.93 → 0.72…0.85 |
| tree   | maxDepth   | 5…8 → 5…7             |
| tree   | seedLength | 0.60…1.40 → 0.50…1.20 |
| bush   | lenScale   | 0.50…0.72 → 0.50…0.68 |
| bush   | seedLength | 0.25…0.80 → 0.20…0.55 |
| grass  | lenScale   | 0.65…0.82 → 0.55…0.72 |
| grass  | seedLength | 0.10…0.28 → 0.08…0.22 |
| flower | lenScale   | 0.50…0.72 → 0.50…0.68 |
| flower | seedLength | 0.15…0.45 → 0.12…0.32 |

New mathematical ceilings: tree 7.7 m, bush 1.9 m, grass 0.8 m, flower 1.0 m. The runtime cap in `growth.wgsl` drops 20 m → 12 m to match.

### Fix: per-child length clamp

`growth.wgsl` now `clamp(rawLen, 0.01, 2.5)` on every child. Even if jitter or NaN somehow produced a 50 m length, the buffer would store ≤ 2.5 m. Belt-and-braces.

### Test: tick-by-tick growth simulator

`tests/genome.test.mjs` now includes a JS mirror of `growth.wgsl` that ticks plants forward in worst-case upright mode. Three new tests:
- 1000 random spawns: simulated height stays under ceiling.
- 200-generation mutation chain × 4 trials: never exceeds ceiling.
- Extreme-value genome at every type's upper bound: still under ceiling.

Tallest observed across the 1000-spawn run: 7.62 m tree (under the 8.0 m ceiling). All 7 tests pass.

## v0.4.8 — Height cap + NaN guards (2026-05-11)

User screenshot at speed 10× showed a forest of thin near-infinite vertical streaks coming up out of the field. Two things fixed and one harden-up.

### Fix: jitter compounds across the chain
`growth.wgsl` sets `child.len = parent.len * lenScale * (0.9 + r * 0.2)`. Each child gets an independent ±10 % jitter. The earlier unit-test estimator multiplied the *whole geometric sum* by 1.10 once at the end — missing that the +10 % stacks per segment. With `lenScale × 1.10`, a tree at `lenScale = 0.93` has an effective ratio of **1.023 > 1**, so the worst-case chain grows slightly each segment. Actual worst-case heights:

- tree   — 14.06 m (was thought to be 10.6 m)
- bush   —  3.09 m
- grass  —  1.32 m
- flower —  1.49 m

Test ceilings updated to match. The test now correctly rejects mutations that would exceed those mathematically-derived bounds.

### Fix: runtime cap
`growth.wgsl` now bails any tip whose `tipPos.y > 20.0` or is `NaN`. 20 m is comfortably above the legitimate tree max (~14 m); anything taller is a sign of garbage state. Cheap check, prevents runaway.

### Fix: NaN / Inf safety in render
`branch.wgsl` and `leaf.wgsl` vertex shaders now also bail on:
- `s.len <= 0 || s.len > 30` (impossible lengths)
- `s.len != s.len` (NaN)
- `abs(s.pos.y) > 100` or any `pos.{x,y,z} != itself` (NaN / Inf position)

A single corrupted segment can no longer rasterize as a 50 m vertical streak — bad data is silently collapsed to a degenerate triangle.

### Why those streaks happened
Most likely cause: a rare NaN propagating through `quatFromUp(normalize(...))` when phototropism `mix` happens to pull a near-vertical-down direction back through zero. Even if the user-visible runtime never repeats it, the defensive guard above stops one bad segment from corrupting a frame.

## v0.4.7 — Perpetual daylight (2026-05-11)

User asked to drop the night cycle.

### Changed
- **`computeSky(t)` simplified.** Previously the sun's phase went 0 → π (day) → 2π (night). Now phase = `cyclePos * π` for the whole cycle: the sun rises east, climbs to zenith, sets west, and wraps back to dawn. No underground phase.
- **Cycle length 300 s → 240 s.** The night portion was 22% of the previous loop; removing it leaves a 4-minute day cycle which matches roughly the same "perceived day" duration.
- **Elevation floored at 0.02** rather than clamping the negative half. Ensures the colour-by-elevation math still has a tiny dawn/dusk warm-amber colour at the seam where the sun teleports from west horizon back to east horizon.
- Ambient lights re-balanced — they previously had a deliberate "cool blue at night" lean which is now wasted.

### Notes
- The sky shader's `nightW` palette weight is still in the WGSL — it just rarely fires now because `sunY` only briefly dips toward 0 at sunrise/sunset and never goes negative. The seam at `cyclePos == 1` produces a sub-frame "blink" as `cosP` flips from west to east, but the sun's near-horizon brightness is dim enough that it isn't visually jarring.

## v0.4.6 — Type-aware bounds + visible slider (2026-05-11)

Two user-reported issues from v0.4.5.

### Fixed: mutations drifted outside type
v0.4.5 had separate bounds for initial spawn (`rollByType`) and mutation (loose `clamp(... 0.05, 1.70)` etc.). A grass parent could mutate into a 1.7 m-trunk + 0.97-lenScale + maxDepth-9 grass, growing to 10 m. Now `typeBounds(t)` is the single source of truth; both spawn and mutation use it. After many generations a grass is still grass-sized.

Tighter per-type bounds across the board:
- **tree** — `seedLength` ≤ 1.40, `lenScale` ≤ 0.93, `maxDepth` ≤ 8 → ceiling ~8 m.
- **bush** — `seedLength` ≤ 0.80, `lenScale` ≤ 0.72, `maxDepth` ≤ 6 → ceiling ~2.5 m.
- **grass** — `seedLength` ≤ 0.28, `lenScale` ≤ 0.82, `maxDepth` ≤ 5 → ceiling ~1.2 m.
- **flower** — `seedLength` ≤ 0.45, `lenScale` ≤ 0.72, `maxDepth` ≤ 4 → ceiling ~1.1 m.

### Fixed: speed slider invisible
The slider's track was `#2a3a32` (dark green) on a `rgba(13, 20, 16, 0.85)` background — almost the same value, so the slider blended into the HUD panel and looked missing. The HTML and JS were intact; just the styling was off. Track lightened to `#3f6452` with a `#4e8c69` border, thumb bumped 16 px → 20 px with a dark outer ring and a soft shadow. Should be obvious now.

## v0.4.5 — Trees, bushes, grass, flowers (2026-05-11)

Every plant now has a `plantType` field. Four kinds, each with its own genome ranges and rendering path.

### Added
- **`Genome` grows 32 B → 48 B** (12 f32). New fields: `plantType` (slot 8) and `flowerHue` (slot 9), plus 2 pads. Struct declared in all three shaders (`growth.wgsl`, `branch.wgsl`, `leaf.wgsl`) so they stay in lockstep.
- **`PLANT_TYPE_NAMES = ['tree', 'bush', 'grass', 'flower']`** with `PLANT_TYPE_WEIGHTS = [0.30, 0.25, 0.35, 0.10]` for initial population.
- **`rollByType(plantType, rand)`** picks per-type parameter ranges:
  - **Tree** — branchAngle 0.30–1.00 rad, lenScale 0.75–0.95, maxDepth 5–8, seedLength 0.7–1.5 m.
  - **Bush** — wide branching angle (0.7–1.3), high `branchProb` (0.85+), shorter and chunkier (maxDepth 4–6, seedLength 0.3–0.75).
  - **Grass** — near-vertical (branchAngle 0.04–0.16), zero-ish branching, slender (seedRadius ~0.02 m, lenScale ~0.85–0.95), shoots straight up.
  - **Flower** — short stem (maxDepth 3–4, seedLength 0.18–0.53), sparse branching, strong phototropism so the bud reaches up.
- **`pickPlantType(rand)`** does the weighted draw.
- **`mutateGenome`** has a 4 % chance per generation to jump to a different plant type; when it does, the whole shape is re-rolled with the new type's ranges but `leafShape`, `barkHue`, and `flowerHue` are inherited so the lineage stays visually related.

### Shader changes
- **`branch.wgsl`** FS branches on `plantType`:
  - `plantType == 2` (grass): albedo is a green dark→light gradient by depth.
  - `plantType == 3` (flower): albedo is a slender green stem colour.
  - otherwise: the v0.3.4 bark gradient tinted by `barkHue`.
  - `plantType` passes VS→FS as `@interpolate(flat) u32` at `@location(4)`.
- **`leaf.wgsl`** VS skips rendering entirely for grass instances (collapses every leaf quad to a degenerate triangle). FS overrides the green leaf albedo with an HSV→RGB petal colour when `plantType == 3`, driven by the per-plant `flowerHue`.

### UI
- Inspect panel title now reads `Plant #N — type / leafShape`. New `type` and `flowerHue` rows in the body.

### Notes
- Grass and flower silhouettes are still cylinder-based; they're recognisable by size + colour but don't have authentic blade or petal geometry. Could refine in a future pass.
- Per-type counts: roughly 76 trees, 64 bushes, 90 grass blades, 26 flowers per 256-plant field.

## v0.4.4 — Tap to inspect (2026-05-11)

The first M6 interaction shipped early. Tap any plant in the field to read out its genome.

### Added
- **Tap detection** on the canvas. Per-pointer tracking of `(x, y, t, moved)`. A tap is a `pointerup` with `moved < 8 px` and `dt < 350 ms` — anything else is a camera gesture and is left to the camera handlers (which capture the same pointer events independently).
- **`pickPlantAt(clientX, clientY)`** — reconstructs the camera ray from the tap NDC via the cached `invViewProj`, then runs ray-vs-sphere against every plant's bounding sphere (radius 5 m, centred 4 m above the seed position). Closest hit wins.
- **`#inspect` panel.** Bottom-centre floating card. Title shows `Plant #N — species`. Body lists `pos`, `age` in ticks, current `light` reading, plus the full genome: `branchAngle`, `branchProb`, `lenScale`, `radScale`, `maxDepth`, `growthBias`, `barkHue`, `seedLen`, `seedRad`. Dismissable with the `×` close button.
- **`applyMat4Vec4(m, x, y, z, w)`** math helper for the picking math.

### Notes
- Bounding sphere is fixed-radius rather than computed from each plant's actual canopy extent. Tall trees may be tappable slightly off-canopy and short bushes may be over-generous, but the picking is stable for normal interaction.
- No GPU readback in the picking path — the CPU mirrors (`cpuPlantPositions`, `cpuGenomes`, `cpuPlantBirthTick`, `measuredLight`) provide everything the panel shows.
- Doesn't visually highlight the picked plant yet. A small uniform + branch/leaf FS tweak is a v0.4.5 candidate.

## v0.4.3 — Plant self-shadowing (2026-05-11)

The ray-march that v0.4.2 added to the ground is now in `branch.wgsl` and `leaf.wgsl` too, so plant geometry actually visually responds to neighbour canopies — short plants under tall ones look correspondingly dim.

### Added
- **`shadowCast(worldPos, sunDir)`** function in both `branch.wgsl` and `leaf.wgsl`, sharing the v0.4.2 implementation: 8 steps × 0.85 m up the sun ray, sampling `lightGrid`, feather by `smoothstep` of how deeply the canopy crosses.
- **`lightGrid` storage binding** added at `@binding(4)` of both branch and leaf bind-group layouts (FRAGMENT-only visibility). `createBranchRenderer` and `createLeafRenderer` take a new `lightGridBuffer` parameter.
- **FS update.** Both shaders now multiply their `sun-Lambert` term by the shadow factor: `frame.sunColor.rgb * lambert * shadow + ambient.rgb`. Ambient is unaffected so shadowed plants still pick up sky bounce.

### Tuning
- Branches: shadow strength factor 0.65 (max 65% darkening in deep shade).
- Leaves: 0.55 (softer — leaves are physically more translucent).

### Cost
Branches contribute ~200 k fragments and leaves ~200 k (roughly). Each runs 8 storage-buffer reads. Total ~3 M extra reads/frame on top of the ground march; iPhone 15 Pro Max handles it without dropping below 60 fps in testing on similar workloads.

### What you'll see
The visible result tracks the GPU-measured fitness directly: plants that capture less sun also look dimmer. Mid-canopy and lower-canopy foliage of any tree is shaded by foliage above it, so trees gain a proper light gradient from sunlit crown to shaded interior.

## v0.4.2 — Sun-direction shadows (2026-05-11)

Replaced the straight-up "is a tall thing directly above me?" shadow lookup with a real ray-march across the canopy-height grid toward the sun.

### How it works
For each ground fragment, march 8 steps of 0.85 m up the world-space sun direction. At each step, project (x, z) into the height grid and compare the cell's max canopy height to the ray's own height. If the canopy crosses the ray, the ground point is in shadow — feathered by `smoothstep` of how deeply the canopy intrudes. Hard cap on shadow strength so shaded ground still picks up a hint of sun + full ambient.

### What you'll see
- **Noon**: shadows directly under canopies — tight pools at the base of each plant.
- **Mid-morning / mid-afternoon**: shadows stretched east / west along the sun azimuth.
- **Sunset / sunrise**: long raking shadows.
- **Night**: shadows skipped entirely (sun below horizon → early-out).

Costs ~8 storage-buffer reads per ground fragment. iPhone 15 Pro Max handles this easily.

### Not yet
Branches and leaves don't sample this; only the ground does. Self-shadowing of plant geometry would need the same march in `branch.wgsl` and `leaf.wgsl` — possible v0.5 work along with proper fake-SSS leaf shading.

## v0.4.1 — Shorter night + breeding fix (2026-05-11)

Two user-reported issues.

### Fixed: day/night ratio
The sun's elevation was a straight `sin(phase)` — half the cycle was below horizon. Reshaped the wave so 78% of the cycle is day, 22% is night. The function now maps `cyclePos ∈ [0, 0.78)` to `phase ∈ [0, π]` (sunrise → sunset) and `cyclePos ∈ [0.78, 1)` to `phase ∈ [π, 2π]` (night). Sun still arcs east → zenith → west during the day and dips below the horizon for night, just briefly.

### Fixed: evolution wasn't using mature plants
`evolveStep` had inverted logic. It assigned `scores[i] = 0` to plants with `age >= retireAge` (the mature ones) and the genome-proxy / measuredLight score only to plants *younger* than `retireAge`. Targets came from the mature pool, but parents came from the immature pool — so a plant's slot got replaced by an offspring of some random newborn, and surviving mature genomes never propagated. This made evolution essentially genetic drift in the wrong direction, and crucially meant v0.4.0's GPU-measured fitness was never actually consulted (mature plants had score 0).

Now: only mature plants enter the pool. They're both eligible parents (weighted by fitness — measured-light if available, genome proxy as fallback) and eligible replacement targets (uniform random). Newborns sit out until they age in.

### Tuned
- `EV.perTick: 1 → 3`. Three replacements per sim tick → visible churn at 1× speed within seconds of the first generation maturing.

### Expected behavior
At 1× speed, ~12 s after sim start, the first generation matures. Replacement kicks in at 3/0.5 s = 6/sec. After 1–2 minutes the field's mean genome has shifted toward sun-catching shapes. Crank the speed slider to 5–10× to compress this.

## v0.4.0 — Plants compete for sun (2026-05-11)

The M4 milestone hits. Evolution is no longer driven by a CPU genome heuristic — plants that physically caught more sun out-compete plants that didn't.

### Added
- **`capture` compute kernel in `light.wgsl`.** One thread per segment slot. For each alive non-trunk segment it computes its tip's (x, y, z), reads the cell's max height off `lightGrid` (the v0.3.9 atomicMax grid), takes the `max(0, maxH − own_y)` gap, exponentially decays it (`exp(-gap × 1.2)`), and `atomicAdd`s the result × 1000 into `plantLight[plantIdx]`. Tip above everyone else = full sun = +1000 per frame. Tip 1 m below = +300. Tip 2 m below = +90. The exponential makes height advantage decisive.
- **`plantLight` storage buffer.** `maxPlants × 4 B` of `atomic<u32>`. Zeroed on the CPU each frame via `queue.writeBuffer` (cheaper than a GPU clear kernel for this small buffer) then filled by `capture`.
- **Three light passes per frame instead of one combined.** WebGPU guarantees inter-pass memory visibility, so `clear → splat → capture` each gets its own `beginComputePass`/`end`. Splat reads have to be visible to capture before it loads from `lightGrid`.
- **`readPlantLight()` async readback.** Mirrors the existing counter-readback pattern: `copyBufferToBuffer` into a 1 KB staging buffer with `MAP_READ`, `mapAsync`, copy out into `sim.measuredLight[]`. Fires every ~1 s.
- **`fitnessScore(plantIdx)`** now prefers the GPU-measured value (when `measured > 200`) and falls back to the v0.3.5 genome proxy for plants too young to have data yet.
- **`totalLight`** appears in the Copy-debug dump so you can verify the readback is actually arriving.

### How to tell it's working
After ~30 s the field should start visibly stratifying: plants that grew up under tall neighbours get replaced more often than those that punched through to the canopy top. Over a couple of minutes, tall genomes (high `seedLength`, high `lenScale`, high `maxDepth`) dominate. Tap **Copy debug** and watch `totalLight` climb as more plants reach the canopy.

### Notes
- Shadow gap is measured straight up — sun direction is *not* yet baked into the cell lookup. v0.4.1 or later can offset the lookup by the sun azimuth to simulate "shadow follows the sun".
- The per-plant accumulator is reset every frame, so `measuredLight` reflects the latest frame, not a moving average. For a noisier-but-broader signal, the CPU side could smooth it.

## v0.3.9 — Longer day + height-based shadow grid (2026-05-11)

### Changed
- **Day cycle 90 s → 300 s.** The cycle still wraps but a single day takes 5 real-time minutes at speed 1×. At 10× speed it's 30 s — long enough to actually watch the sun arc and short enough to see multiple cycles.
- **Light grid encoding flipped.** Previously each cell `atomicAdd`'d a depth-weighted *count* of canopy splats; now each cell holds the *height* of the tallest splat that landed there, encoded as `u32(y_world × 100)` so we can use `atomicMax`. This is the data structure v0.4 needs to ask "is anyone taller than me at my (x, z)?".
- **`ground.wgsl` shadow uses the height.** 3×3 max-pool of canopy height read off the grid; ground darkens as `1 − height × 0.10`, clamped to `[0.25, 1]`. Taller trees now cast visibly darker shadows than bushes. The previous count-based shadow over-darkened dense canopies of low brush.

### Why this is just half the work
"Plants compete for sun" needs (a) the height grid we just shipped *and* (b) per-leaf shadow tests that aggregate into per-plant captured-sun scores. (b) is v0.4.0 — a new `capture` compute kernel, a per-plant `atomic<u32>` accumulator buffer, an async readback, and an evolution fitness function that uses the readback instead of the v0.3.5 CPU heuristic.

## v0.3.8 — Sim speed slider (2026-05-11)

### Added
- **HUD speed slider** (0×–10× in 0.5 steps). Lives below the counter rows and above the leaf-shape / Copy-debug buttons. Touch-friendly thumb sized for fingertip use; label to the right shows `paused` at 0× or `N.N×` otherwise.
- **`timeScale` plumbed through the sim clocks.** A new `simTime` accumulator advances by `dt * timeScale` each frame, feeding `computeSky(simTime)` — so the sun arc speeds up alongside growth. The sim-tick accumulator also multiplies dt by `timeScale`, clamped to a 4-tick backlog so dragging the slider to 10× doesn't queue 80 ticks of catch-up work.
- **Pausing** (slider at 0) cleanly disables the sim-tick accumulator AND the day cycle while leaving rendering at 60 fps. Camera input, debug HUD, and counter readback all continue normally.
- `timeScale` shows up in the Copy-debug dump.

### Notes
- At max speed (10×), with simHz=2, you get roughly one tick every 3 frames at 60 fps — about 20 sim ticks per real-time second. Evolution `births` should climb visibly.
- Slider only scales the *sim* dt; wind animation in the branch/leaf vertex shaders still uses real `frame.cameraPosTime.w`, so wind doesn't go double-time. Easy to change if it should.

## v0.3.7 — Canopy light grid (2026-05-11)

The first piece of the M4 infrastructure: a top-down splat grid that records where every canopy segment's tip lives in world space. Ground darkens under it now; in v0.4 it will also tell each plant how much sun it's getting.

### Added
- **`light.wgsl`** with two compute entry points:
  - `clear` — one thread per cell zeroes the grid (256 cells per workgroup × 1024 workgroups).
  - `splat` — one thread per segment slot. If the segment is alive and `depth ≥ 2`, it projects its tip XZ into the grid and `atomicAdd`s a depth-weighted count into that cell.
- **256×256 `atomic<u32>` storage buffer** `lightGridBuffer` (256 KB). `STORAGE | COPY_DST`.
- **`createLightPipelines(device, module, grid, segments, simBuffer)`** builds both compute pipelines off a shared bind-group layout.
- **`createGroundRenderer`** (replaces the generic `createFullscreenRenderer` for ground) — adds a `read-only-storage` binding for the grid.
- **`ground.wgsl` `canopyShadow(worldPos)`** does a 3×3 smoothing read off the grid and folds it directly into the sun-lambert term, so canopy shadows ride along with the day-night sun colour.

### Per-frame order
Inside one command encoder: `growth` (if sim tick fires) → `light.clear` → `light.splat` → render. WebGPU handles inter-pass sync automatically.

### Notes
- Grid covers world XZ ∈ [-40, +40] at 256 cells = 31.25 cm per cell. Fits the 16×16 plant field plus the new-plant jitter from v0.3.5.
- Depth weighting (1..8) so canopy tips contribute much more than mid-trunks. Roll your eyes back if the shadow looks too dark — first lever is the `0.06` coefficient in `canopyShadow`.

## v0.3.6 — Day-night cycle (2026-05-11)

### Added
- **`computeSky(t)`** on CPU. The sun traces a tilted east-west arc with a slight north-south wobble, dipping below the horizon for night. Cycle is 90 s long. Returns `sunDir`, `sunColor` (warmer at low elevation, brighter at zenith, zero below horizon), and `ambient` (cooler/dim at night, warmer/bright at day).
- The render loop calls `computeSky(now/1000)` every frame and feeds the result into the existing frame uniform — no new bindings or buffers.
- **Sky shader rewrite.** Three palette presets (night / sunset / day) interpolated by sun elevation using `smoothstep` weights, plus a warm low-sun bloom around `dot(viewDir, sunDir)` that fades out as the sun climbs. Sun disc + glow fade with the elevation factor so they disappear cleanly at night.
- Below-horizon ground tint follows the time of day so the unseen "below" is brighter during the day.

### Notes
- Branches, leaves, ground all consume `sunColor` and `ambient` from the frame uniform, so they already lit themselves correctly — no shader changes there.
- Day length is hardcoded at 90 s; lift to a config knob if it should be configurable.

## v0.3.5 — CPU-driven evolution (2026-05-11)

First taste of the M4 milestone. Implemented entirely on CPU — fast enough at 256 plants without needing GPU readback. v0.4 will move the fitness function to a real GPU light grid.

### Added
- **`mutateGenome(parent)`**: produces a child genome by jittering each gene by a small amount, with bounds. Leaf shape only jumps every ~12 mutations to keep visual lineage recognisable.
- **`createSimResources` now exposes `cpuPlantPositions`, `cpuPlantBirthTick`** alongside `cpuGenomes` so the evolution loop can track who's old enough to retire and where their parent lived.
- **`evolveStep(simTick)`**: starts firing at `simTick >= 20` (after the initial growth has settled). Each tick it:
  1. Scores every plant via `fitnessScore` — a crude `seedLength * 1.8 + maxDepth + max(0, growthBias) * 0.8 + lenScale * 1.5` proxy.
  2. Picks a target plant uniformly from the retirable set (age ≥ 25 ticks since birth/rebirth).
  3. Picks a parent via roulette-wheel on the score array.
  4. Calls `replacePlant(target, parent, tick)`.
- **`replacePlant(target, parent, tick)`**: queues four `queue.writeBuffer` calls — new genome at the target's slot, zeroed segment range, fresh seed segment at slot 0, and counter[target]=1 — so the GPU sees the slot reset by next sim tick. New seed lands near the parent's world position with jitter.
- **`births` counter** on the debug HUD.

### Notes
- Crude fitness; the next milestone replaces it with a real light competition.
- 1 replacement per sim tick at 2 Hz → field fully turns over in ~2 minutes. Tune `EV.perTick` if too slow.
- Replacement is CPU-driven so it costs nothing on the GPU compute pass — just four small writes per replacement.

## v0.3.4 — Per-plant bark color (2026-05-11)

### Added
- **`Genome.barkHue`** replaces the unused `_pad1` slot at offset 28 (struct stays 32 B). `makeGenome()` rolls a uniform `[0, 1)` value per plant.
- **Branch shader gains a genome + sim binding.** `branch.wgsl` was the only renderer still ignoring the genome; now it has the same `genomes` storage and `SimParams` uniform bindings as `leaf.wgsl`, so it can compute `plantIdx = ii / sim.segsPerPlant` and read `g.barkHue`.
- **`tintBark(base, hue)` function in the fragment shader** maps `barkHue ∈ [0, 1]` along a three-stop ramp: 0 = warm cherry/red, 0.5 = neutral oak, 1 = cool silver-birch. Trunk and twig albedo are multiplied by the tint.
- The bark hue interpolates `@interpolate(flat)` between VS and FS so the entire cylinder of one segment is one colour (no rainbow within a single trunk).

### Notes
- The leaf-shape cycle button still works — `writeGenome` now stamps `barkHue` into slot 7 instead of zero, so colour persists through any override pass.
- Branches and leaves now both bind 4 entries (frame, segments storage, genomes storage, sim uniform). Identical bind-group shape across renderers will simplify future LOD work.

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
