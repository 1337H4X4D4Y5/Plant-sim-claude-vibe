// Regression test: no plant — initial spawn or mutated descendant — should
// be able to grow to an absurd height for its species. Mirrors the genome
// logic in /checkpoints/v0.4.9/main.js. Run with:
//
//     node --test tests/
//
// If you change typeBounds / rollByType / mutateGenome in main.js, update
// the mirrored copies below to match, then re-run the test.

import { test } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Mirror of main.js as of v0.4.9
// ---------------------------------------------------------------------------

const PLANT_TYPE_NAMES = ['tree', 'bush', 'grass', 'flower'];
const PLANT_TYPE_WEIGHTS = [0.30, 0.25, 0.35, 0.10];

function typeBounds(t) {
  if (t === 1) {
    return {
      branchAngle: [0.55, 1.30],
      branchProb:  [0.70, 0.97],
      lenScale:    [0.50, 0.68],
      radScale:    [0.45, 0.72],
      maxDepth:    [4, 6],
      growthBias:  [-0.20, 1.00],
      seedLength:  [0.20, 0.55],
      seedRadius:  [0.06, 0.16],
    };
  }
  if (t === 2) {
    return {
      branchAngle: [0.02, 0.18],
      branchProb:  [0.00, 0.08],
      lenScale:    [0.55, 0.72],
      radScale:    [0.40, 0.65],
      maxDepth:    [3, 5],
      growthBias:  [0.50, 1.50],
      seedLength:  [0.08, 0.22],
      seedRadius:  [0.010, 0.028],
    };
  }
  if (t === 3) {
    return {
      branchAngle: [0.20, 0.55],
      branchProb:  [0.10, 0.45],
      lenScale:    [0.50, 0.68],
      radScale:    [0.40, 0.65],
      maxDepth:    [3, 4],
      growthBias:  [0.50, 1.55],
      seedLength:  [0.12, 0.32],
      seedRadius:  [0.025, 0.070],
    };
  }
  return {
    branchAngle: [0.25, 1.05],
    branchProb:  [0.50, 0.95],
    lenScale:    [0.72, 0.85],
    radScale:    [0.55, 0.86],
    maxDepth:    [5, 7],
    growthBias:  [-0.20, 1.40],
    seedLength:  [0.50, 1.20],
    seedRadius:  [0.10, 0.26],
  };
}

function rollByType(plantType, rand) {
  const b = typeBounds(plantType);
  const span = (r) => r[0] + rand() * (r[1] - r[0]);
  return {
    branchAngle: span(b.branchAngle),
    branchProb:  span(b.branchProb),
    lenScale:    span(b.lenScale),
    radScale:    span(b.radScale),
    maxDepth:    b.maxDepth[0] + Math.floor(rand() * (b.maxDepth[1] - b.maxDepth[0] + 1)),
    growthBias:  span(b.growthBias),
    seedLength:  span(b.seedLength),
    seedRadius:  span(b.seedRadius),
  };
}

function pickPlantType(rand) {
  let r = rand();
  for (let i = 0; i < PLANT_TYPE_WEIGHTS.length; i++) {
    r -= PLANT_TYPE_WEIGHTS[i];
    if (r <= 0) return i;
  }
  return PLANT_TYPE_WEIGHTS.length - 1;
}

function makeGenome(seedBase, plantIdx) {
  let s = ((seedBase ^ (plantIdx * 0x9E3779B1)) >>> 0) || 1;
  const rand = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
  const plantType = pickPlantType(rand);
  const p = rollByType(plantType, rand);
  return {
    ...p,
    leafShape: Math.floor(rand() * 5),
    barkHue:   rand(),
    plantType,
    flowerHue: rand(),
  };
}

function mutateGenome(parent) {
  const clampRange = (v, r) => Math.max(r[0], Math.min(r[1], v));
  const jitter = (val, amp) => val + (Math.random() - 0.5) * amp;
  const stepInt = () => (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0);

  let plantType = parent.plantType;
  if (Math.random() < 0.04) plantType = (parent.plantType + 1 + Math.floor(Math.random() * 3)) % 4;

  if (plantType !== parent.plantType) {
    const p = rollByType(plantType, Math.random);
    return {
      ...p,
      leafShape: parent.leafShape,
      barkHue:   parent.barkHue,
      plantType,
      flowerHue: parent.flowerHue,
    };
  }

  const b = typeBounds(plantType);
  return {
    branchAngle: clampRange(jitter(parent.branchAngle, 0.12), b.branchAngle),
    branchProb:  clampRange(jitter(parent.branchProb,  0.08), b.branchProb),
    lenScale:    clampRange(jitter(parent.lenScale,    0.05), b.lenScale),
    radScale:    clampRange(jitter(parent.radScale,    0.05), b.radScale),
    maxDepth:    clampRange(parent.maxDepth + stepInt(), b.maxDepth),
    growthBias:  clampRange(jitter(parent.growthBias,  0.25), b.growthBias),
    leafShape:   Math.random() < 0.08
                   ? Math.floor(Math.random() * 5)
                   : parent.leafShape,
    barkHue:     clampRange(jitter(parent.barkHue,     0.06), [0, 1]),
    plantType,
    flowerHue:   clampRange(jitter(parent.flowerHue,   0.08), [0, 1]),
    seedLength:  clampRange(jitter(parent.seedLength,  0.07), b.seedLength),
    seedRadius:  clampRange(jitter(parent.seedRadius,  0.015), b.seedRadius),
  };
}

// ---------------------------------------------------------------------------
// Height estimator + per-type ceilings
// ---------------------------------------------------------------------------

// Worst case in growth.wgsl: each segment's length is `parent.len * lenScale
// * jitter` where jitter ∈ [0.9, 1.1]. The +10% jitter *compounds* across
// segments: chain N levels deep can reach
//
//   seedLength * Σ_{i=0..maxDepth} (lenScale * 1.10)^i
//
// For tree with lenScale = 0.93 the effective ratio is 0.93 × 1.10 = 1.023,
// which is *greater than 1* — the worst-case chain grows slightly each
// segment. The earlier estimator that applied the 1.10 only once at the
// end (rather than per segment) under-estimated this by ~35 %.
function estimateMaxHeight(g) {
  const r = g.lenScale * 1.10;
  if (r >= 1.0 - 1e-6) return g.seedLength * (g.maxDepth + 1) * Math.max(r, 1.0);
  let sum = 0;
  for (let i = 0; i <= g.maxDepth; i++) sum += Math.pow(r, i);
  return g.seedLength * sum;
}

// Ceilings derived from the v0.4.9 typeBounds() maxima plugged into the
// corrected compounding-jitter estimator + a small buffer:
//   tree  : 1.20 * Σ_{i=0..7}(0.935^i)   = 7.69 m → ceiling 8.0
//   bush  : 0.55 * Σ_{i=0..6}(0.748^i)   = 1.90 m → ceiling 2.0
//   grass : 0.22 * Σ_{i=0..5}(0.792^i)   = 0.80 m → ceiling 0.9
//   flower: 0.32 * Σ_{i=0..4}(0.748^i)   = 0.97 m → ceiling 1.1
// 12 m runtime cap in growth.wgsl catches anything that escapes this.
const TYPE_CEILING = {
  0: 8.0,  // tree
  1: 2.0,  // bush
  2: 0.9,  // grass
  3: 1.1,  // flower
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('typeBounds returns valid ranges for every type', () => {
  for (let t = 0; t < 4; t++) {
    const b = typeBounds(t);
    for (const [field, [lo, hi]] of Object.entries(b)) {
      assert.ok(
        lo <= hi,
        `${PLANT_TYPE_NAMES[t]}.${field} has inverted range [${lo}, ${hi}]`,
      );
    }
  }
});

test('makeGenome: 10000 initial spawns stay within their type ceiling', () => {
  let tallest = { type: -1, h: 0 };
  for (let i = 0; i < 10000; i++) {
    const g = makeGenome(0xC0FFEE, i);
    const h = estimateMaxHeight(g);
    const ceiling = TYPE_CEILING[g.plantType];
    if (h > tallest.h) tallest = { type: g.plantType, h };
    assert.ok(
      h <= ceiling,
      `spawn ${i} (${PLANT_TYPE_NAMES[g.plantType]}): estimated ${h.toFixed(2)} m > ceiling ${ceiling} m`,
    );
  }
  console.log(`    tallest spawn: ${PLANT_TYPE_NAMES[tallest.type]} ${tallest.h.toFixed(2)} m`);
});

test('mutateGenome: 1000-generation chain never exceeds current-type ceiling', () => {
  // Seed Math.random deterministically so the test is reproducible.
  let s = 0xA5A5A5A5 >>> 0;
  const origRandom = Math.random;
  Math.random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
  try {
    for (let trial = 0; trial < 5; trial++) {
      let g = makeGenome(0xC0FFEE * (trial + 1), 0);
      for (let gen = 0; gen < 1000; gen++) {
        g = mutateGenome(g);
        const h = estimateMaxHeight(g);
        const ceiling = TYPE_CEILING[g.plantType];
        assert.ok(
          h <= ceiling,
          `trial ${trial} gen ${gen} (${PLANT_TYPE_NAMES[g.plantType]}): estimated ${h.toFixed(2)} m > ceiling ${ceiling} m`,
        );
      }
    }
  } finally {
    Math.random = origRandom;
  }
});

test('every-type stress: force 500 mutations starting from each plant type', () => {
  for (let startType = 0; startType < 4; startType++) {
    let g = rollByType(startType, Math.random);
    g.leafShape = 0;
    g.barkHue = 0.5;
    g.plantType = startType;
    g.flowerHue = 0.5;
    for (let gen = 0; gen < 500; gen++) {
      g = mutateGenome(g);
      const h = estimateMaxHeight(g);
      const ceiling = TYPE_CEILING[g.plantType];
      assert.ok(
        h <= ceiling,
        `from ${PLANT_TYPE_NAMES[startType]} gen ${gen}, now ${PLANT_TYPE_NAMES[g.plantType]}: estimated ${h.toFixed(2)} m > ceiling ${ceiling} m`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Tick-by-tick growth simulation that mirrors shaders/growth.wgsl. Catches
// runaway compounding, clamp failures, and the "giant stick" bug where a
// single bad parent spawns a tower of children. We simulate with the *worst-
// case* assumption that every child grows straight up (tilt = 0), so any
// height bound we hit here is an over-approximation — tilted growth in the
// real shader can only be shorter.
// ---------------------------------------------------------------------------

function simulatePlantHeight(g, rand) {
  // Segment: { y, len, depth, alive, tip, age }. y is the base of the
  // segment; the tip is at y + len because everything points straight up.
  const segs = [{
    y: 0,
    len: g.seedLength,
    depth: 0,
    alive: true,
    tip: true,
    age: 0,
  }];
  let maxY = g.seedLength;  // initial tip height
  const TICK_LIMIT = 60;    // far more than any maxDepth

  for (let tick = 1; tick < TICK_LIMIT; tick++) {
    const newSegs = [];
    let anyGrew = false;
    for (const s of segs) {
      if (!s.alive || !s.tip) continue;
      if (s.age >= tick) continue;

      // Mirror parent-corrupt bail + depth gate + runtime height cap.
      if (s.depth + 1 > g.maxDepth) { s.tip = false; continue; }
      if (s.len <= 0 || s.len > 4 || Number.isNaN(s.len)) { s.tip = false; continue; }
      if (Number.isNaN(s.y) || Math.abs(s.y) > 20) { s.tip = false; continue; }
      const tipY = s.y + s.len;
      if (tipY > 12 || Number.isNaN(tipY)) { s.tip = false; continue; }

      const canBranch = s.depth >= 1 && s.depth + 1 < g.maxDepth;
      const r1 = rand();
      const r2 = rand(); void r2;
      const r3 = rand();
      const r4 = rand(); void r4;
      const nChildren = (canBranch && r1 < g.branchProb) ? 2 : 1;

      for (let j = 0; j < nChildren; j++) {
        const isCont = j === 0;
        const lenScale = isCont ? g.lenScale : g.lenScale * 0.82;
        // Worst-case jitter for upper bound: use the upper +10 % factor.
        const rawLen = s.len * lenScale * 1.10;
        const newLen = Math.max(0.01, Math.min(2.5, rawLen));
        newSegs.push({
          y: tipY,
          len: newLen,
          depth: s.depth + 1,
          alive: true,
          tip: true,
          age: tick,
        });
        if (tipY + newLen > maxY) maxY = tipY + newLen;
        anyGrew = true;
      }
      s.tip = false;
    }
    for (const ns of newSegs) segs.push(ns);
    if (!anyGrew) break;
  }
  return maxY;
}

test('tick-by-tick growth: 1000 spawned plants stay under their ceiling', () => {
  let rng = 0xCAFEBABE >>> 0;
  const rand = () => {
    rng = (rng + 0x6D2B79F5) >>> 0;
    let t = rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
  let tallest = { type: -1, h: 0 };
  for (let p = 0; p < 1000; p++) {
    const g = makeGenome(0xBADC0DE, p);
    const h = simulatePlantHeight(g, rand);
    const ceiling = TYPE_CEILING[g.plantType];
    if (h > tallest.h) tallest = { type: g.plantType, h };
    assert.ok(
      h <= ceiling,
      `plant ${p} (${PLANT_TYPE_NAMES[g.plantType]}): simulated tip ${h.toFixed(2)} m > ceiling ${ceiling} m`,
    );
  }
  console.log(`    tallest simulated: ${PLANT_TYPE_NAMES[tallest.type]} ${tallest.h.toFixed(2)} m`);
});

test('tick-by-tick growth: 200-generation mutation chain stays under ceiling', () => {
  // Seed Math.random deterministically so mutateGenome is reproducible.
  let s = 0x5F3759DF >>> 0;
  const origRandom = Math.random;
  const rng = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
  Math.random = rng;
  try {
    for (let trial = 0; trial < 4; trial++) {
      let g = makeGenome(0xDECAFBAD * (trial + 1), 0);
      for (let gen = 0; gen < 200; gen++) {
        g = mutateGenome(g);
        const h = simulatePlantHeight(g, rng);
        const ceiling = TYPE_CEILING[g.plantType];
        assert.ok(
          h <= ceiling,
          `trial ${trial} gen ${gen} (${PLANT_TYPE_NAMES[g.plantType]}): simulated ${h.toFixed(2)} m > ceiling ${ceiling} m`,
        );
      }
    }
  } finally {
    Math.random = origRandom;
  }
});

test('tick-by-tick growth: extreme-value genome at every type bound still under ceiling', () => {
  // Build a worst-case genome per type by setting every relevant gene to
  // its upper bound. This is what the growth kernel sees after a long
  // mutation chain converges to the bound.
  for (let t = 0; t < 4; t++) {
    const b = typeBounds(t);
    const g = {
      branchAngle: b.branchAngle[1],
      branchProb:  b.branchProb[1],
      lenScale:    b.lenScale[1],
      radScale:    b.radScale[1],
      maxDepth:    b.maxDepth[1],
      growthBias:  b.growthBias[1],
      seedLength:  b.seedLength[1],
      seedRadius:  b.seedRadius[1],
      leafShape:   0,
      barkHue:     0.5,
      plantType:   t,
      flowerHue:   0.5,
    };
    // Deterministic rand that always returns 0 → ensures every branch
    // decision triggers (r1 < branchProb is always true) and length
    // jitter takes its minimum, but the simulator uses 1.10 worst-case
    // jitter regardless, so this is an honest upper-bound stress.
    const rand = () => 0;
    const h = simulatePlantHeight(g, rand);
    const ceiling = TYPE_CEILING[t];
    assert.ok(
      h <= ceiling,
      `extreme ${PLANT_TYPE_NAMES[t]}: simulated tip ${h.toFixed(3)} m > ceiling ${ceiling} m`,
    );
  }
});
