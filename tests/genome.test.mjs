// Regression test: no plant — initial spawn or mutated descendant — should
// be able to grow to an absurd height for its species. Mirrors the genome
// logic in /checkpoints/v0.4.6/main.js. Run with:
//
//     node --test tests/
//
// If you change typeBounds / rollByType / mutateGenome in main.js, update
// the mirrored copies below to match, then re-run the test.

import { test } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Mirror of main.js as of v0.4.6
// ---------------------------------------------------------------------------

const PLANT_TYPE_NAMES = ['tree', 'bush', 'grass', 'flower'];
const PLANT_TYPE_WEIGHTS = [0.30, 0.25, 0.35, 0.10];

function typeBounds(t) {
  if (t === 1) {
    return {
      branchAngle: [0.55, 1.30],
      branchProb:  [0.70, 0.97],
      lenScale:    [0.50, 0.72],
      radScale:    [0.45, 0.72],
      maxDepth:    [4, 6],
      growthBias:  [-0.20, 1.00],
      seedLength:  [0.25, 0.80],
      seedRadius:  [0.06, 0.16],
    };
  }
  if (t === 2) {
    return {
      branchAngle: [0.02, 0.18],
      branchProb:  [0.00, 0.08],
      lenScale:    [0.65, 0.82],
      radScale:    [0.40, 0.65],
      maxDepth:    [3, 5],
      growthBias:  [0.50, 1.50],
      seedLength:  [0.10, 0.28],
      seedRadius:  [0.010, 0.028],
    };
  }
  if (t === 3) {
    return {
      branchAngle: [0.20, 0.55],
      branchProb:  [0.10, 0.45],
      lenScale:    [0.50, 0.72],
      radScale:    [0.40, 0.65],
      maxDepth:    [3, 4],
      growthBias:  [0.50, 1.55],
      seedLength:  [0.15, 0.45],
      seedRadius:  [0.025, 0.070],
    };
  }
  return {
    branchAngle: [0.25, 1.05],
    branchProb:  [0.50, 0.95],
    lenScale:    [0.72, 0.93],
    radScale:    [0.55, 0.86],
    maxDepth:    [5, 8],
    growthBias:  [-0.20, 1.40],
    seedLength:  [0.60, 1.40],
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

// Ceilings derived from the typeBounds() maxima plugged into the corrected
// estimator + a small buffer:
//   tree  : 1.40 * Σ_{i=0..8}(1.023^i)   = 14.06 m → ceiling 14.5
//   bush  : 0.80 * Σ_{i=0..6}(0.792^i)   =  3.09 m → ceiling 3.3
//   grass : 0.28 * Σ_{i=0..5}(0.902^i)   =  1.32 m → ceiling 1.4
//   flower: 0.45 * Σ_{i=0..4}(0.792^i)   =  1.49 m → ceiling 1.6
// 20 m runtime cap in growth.wgsl catches anything that escapes this.
const TYPE_CEILING = {
  0: 14.5,  // tree
  1:  3.3,  // bush
  2:  1.4,  // grass
  3:  1.6,  // flower
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
