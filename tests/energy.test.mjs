// Unit tests for the plant energy/metabolism system. Mirrors the logic in
// /checkpoints/v0.4.12/main.js (ENERGY_CONFIG + tickPlantEnergy +
// evolveStep). Run with:
//
//     node --test tests/
//
// The hypothesis under test: a plant that captures no sunlight (no leaves,
// or completely shaded) loses energy every tick once past its grace
// period, and dies. A plant that captures enough sunlight stays alive
// indefinitely. Stumpy/leafless plants therefore can't survive selection.

import { test } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Mirror of main.js as of v0.4.12
// ---------------------------------------------------------------------------

const ENERGY_CONFIG = {
  SEED_ENERGY:       100,
  GRACE_TICKS:        10,
  LIGHT_PER_ENERGY: 4000,
  MAINTENANCE_COST:  0.6,
  SIZE_COST:         0.0,
};

function tickPlantEnergy(prevEnergy, measuredLight, age, cfg) {
  const gain = measuredLight / cfg.LIGHT_PER_ENERGY;
  const cost = age >= cfg.GRACE_TICKS ? cfg.MAINTENANCE_COST : 0;
  return prevEnergy + gain - cost;
}

// ---------------------------------------------------------------------------
// Pure energy-tick tests
// ---------------------------------------------------------------------------

test('grace period: leafless seedling loses no energy before GRACE_TICKS', () => {
  let e = ENERGY_CONFIG.SEED_ENERGY;
  for (let age = 0; age < ENERGY_CONFIG.GRACE_TICKS; age++) {
    e = tickPlantEnergy(e, /*light=*/ 0, age, ENERGY_CONFIG);
  }
  assert.strictEqual(e, ENERGY_CONFIG.SEED_ENERGY,
    'pre-grace plant should not lose energy');
});

test('starvation: leafless plant past grace period dies in finite ticks', () => {
  let e = ENERGY_CONFIG.SEED_ENERGY;
  let tickOfDeath = -1;
  for (let age = 0; age < 1000; age++) {
    e = tickPlantEnergy(e, /*light=*/ 0, age, ENERGY_CONFIG);
    if (e <= 0) { tickOfDeath = age; break; }
  }
  assert.ok(tickOfDeath > 0, 'leafless plant must eventually die');
  assert.ok(tickOfDeath < 1000, 'death must happen within reasonable bound');
  // Expected: 100 / 0.6 ≈ 167 ticks past grace.
  assert.ok(tickOfDeath > ENERGY_CONFIG.GRACE_TICKS + 100,
    `death too quick: ${tickOfDeath} ticks (expected > ${ENERGY_CONFIG.GRACE_TICKS + 100})`);
  assert.ok(tickOfDeath < ENERGY_CONFIG.GRACE_TICKS + 200,
    `death too slow: ${tickOfDeath} ticks (expected < ${ENERGY_CONFIG.GRACE_TICKS + 200})`);
});

test('survival: plant in full sun stays alive indefinitely', () => {
  // measuredLight ≈ 5000 → gain 1.25/tick > cost 0.6/tick → grows over time.
  let e = ENERGY_CONFIG.SEED_ENERGY;
  for (let age = 0; age < 5000; age++) {
    e = tickPlantEnergy(e, /*light=*/ 5000, age, ENERGY_CONFIG);
  }
  assert.ok(e > ENERGY_CONFIG.SEED_ENERGY,
    `well-lit plant should accumulate energy: got ${e.toFixed(1)}`);
});

test('break-even: at LIGHT_PER_ENERGY × MAINTENANCE_COST plants stay flat', () => {
  // gain == cost when light = LIGHT_PER_ENERGY * MAINTENANCE_COST.
  const breakEvenLight = ENERGY_CONFIG.LIGHT_PER_ENERGY * ENERGY_CONFIG.MAINTENANCE_COST;
  let e = ENERGY_CONFIG.SEED_ENERGY;
  for (let age = ENERGY_CONFIG.GRACE_TICKS; age < 1000; age++) {
    e = tickPlantEnergy(e, breakEvenLight, age, ENERGY_CONFIG);
  }
  // Should be exactly SEED_ENERGY (no jitter in the model).
  assert.ok(Math.abs(e - ENERGY_CONFIG.SEED_ENERGY) < 0.01,
    `break-even plant should hold steady: got ${e.toFixed(2)}`);
});

// ---------------------------------------------------------------------------
// Population-level: simulate an ecosystem where each plant captures light
// proportional to its "leafiness". Leafless plants must die out and be
// replaced by descendants of leafy plants.
// ---------------------------------------------------------------------------

// Cheap leafiness model: a plant has a "leaf score" in [0, 1] determined by
// genome (lenScale, branchProb, maxDepth — i.e., a plant likely to actually
// reach leaf-bearing depth). Captured light per tick = leafScore * 6000
// minus a random shading factor.
function leafScore(g) {
  // Plants that can't reach depth 3 (leaf threshold) score 0.
  if (g.maxDepth < 3) return 0;
  // Tiny branchProb + low lenScale = stumpy, low canopy → low score.
  const reach = Math.min(1, (g.maxDepth - 2) / 4);
  const breadth = Math.min(1, g.branchProb / 0.5);
  return reach * 0.5 + breadth * 0.5;
}

function syntheticGenome(rand) {
  return {
    branchProb: rand(),
    lenScale:   0.5 + rand() * 0.3,
    maxDepth:   2 + Math.floor(rand() * 5),  // 2..6
  };
}

test('population: starts mostly leafless, evolves to leafy', () => {
  const N = 256;
  let mrand = 0xBADF00D >>> 0;
  const rng = () => {
    mrand = (mrand + 0x6D2B79F5) >>> 0;
    let t = mrand;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };

  // Start with 50% intentionally-stumpy plants (maxDepth 2 → no leaves).
  const plants = [];
  const energy = new Float32Array(N);
  const birthTick = new Int32Array(N);
  for (let p = 0; p < N; p++) {
    if (p < N / 2) {
      // Stump: maxDepth 2 → can never reach leaf threshold (depth >= 3).
      plants.push({ branchProb: rng() * 0.3, lenScale: 0.5 + rng() * 0.2, maxDepth: 2 });
    } else {
      // Healthy: can reach depth >= 3.
      plants.push({ branchProb: 0.5 + rng() * 0.5, lenScale: 0.6 + rng() * 0.2, maxDepth: 4 + Math.floor(rng() * 3) });
    }
    energy[p] = ENERGY_CONFIG.SEED_ENERGY;
    birthTick[p] = 0;
  }

  function startingLeafyShare() {
    let n = 0;
    for (const g of plants) if (leafScore(g) > 0.3) n++;
    return n / N;
  }
  const initialLeafyShare = startingLeafyShare();
  assert.ok(initialLeafyShare < 0.6, `setup: should start ~50% leafy, got ${(initialLeafyShare * 100).toFixed(0)}%`);

  // Mutation that biases offspring to be similar to parent but with small drift.
  function mutate(g) {
    return {
      branchProb: Math.max(0, Math.min(1, g.branchProb + (rng() - 0.5) * 0.1)),
      lenScale:   Math.max(0.4, Math.min(0.9, g.lenScale + (rng() - 0.5) * 0.05)),
      maxDepth:   Math.max(2, Math.min(7, g.maxDepth + (rng() < 0.2 ? (rng() < 0.5 ? -1 : 1) : 0))),
    };
  }

  let totalDeaths = 0;
  let totalBirths = 0;
  const TICKS = 800;
  for (let tick = 1; tick < TICKS; tick++) {
    // Tick energy.
    const dead = [];
    const scores = new Float32Array(N);
    let viableCount = 0;
    for (let p = 0; p < N; p++) {
      const age = tick - birthTick[p];
      // Each plant sees light proportional to its leafScore plus a small
      // noise term (shading).
      const noise = 0.85 + 0.3 * rng();
      const light = leafScore(plants[p]) * 6000 * noise;
      energy[p] = tickPlantEnergy(energy[p], light, age, ENERGY_CONFIG);
      if (age >= ENERGY_CONFIG.GRACE_TICKS && energy[p] <= 0) {
        dead.push(p);
      } else if (age >= ENERGY_CONFIG.GRACE_TICKS) {
        scores[p] = Math.max(1, energy[p]);
        viableCount++;
      }
    }
    // After grace period, the population should never collapse below 2
    // viable parents — otherwise we can't repopulate.
    if (tick > ENERGY_CONFIG.GRACE_TICKS + 50 && viableCount < 2) {
      assert.fail(`population crash at tick ${tick}; alive=${viableCount}, dead=${dead.length}`);
    }
    // Skip replacement until we have at least one viable parent.
    if (viableCount === 0) continue;

    // Pick a parent weighted by current energy.
    let total = 0;
    for (let p = 0; p < N; p++) total += scores[p];
    function pickParent() {
      let pick = rng() * total;
      for (let p = 0; p < N; p++) {
        pick -= scores[p];
        if (pick <= 0) return p;
      }
      return N - 1;
    }
    for (const tgt of dead) {
      const par = pickParent();
      plants[tgt] = mutate(plants[par]);
      energy[tgt] = ENERGY_CONFIG.SEED_ENERGY;
      birthTick[tgt] = tick;
      totalDeaths++;
      totalBirths++;
    }
  }

  // After 800 ticks of selection, the leafy share should be much higher.
  const finalLeafyShare = startingLeafyShare();
  assert.ok(finalLeafyShare > 0.85,
    `selection failed: leafy share went ${(initialLeafyShare * 100).toFixed(0)}% → ${(finalLeafyShare * 100).toFixed(0)}% (expected > 85%)`);
  console.log(`    leafy share: ${(initialLeafyShare * 100).toFixed(0)}% → ${(finalLeafyShare * 100).toFixed(0)}% over ${TICKS} ticks`);
  console.log(`    total deaths: ${totalDeaths}, total births: ${totalBirths}`);
});

test('stress: 100 % leafless population dies completely within finite ticks', () => {
  // If every plant is a stump, every plant must die. Checks the ledger
  // doesn't have a leak that lets stumps live forever.
  const N = 64;
  const energy = new Float32Array(N);
  energy.fill(ENERGY_CONFIG.SEED_ENERGY);
  let allDeadTick = -1;
  for (let tick = 1; tick < 500; tick++) {
    let livingCount = 0;
    for (let p = 0; p < N; p++) {
      energy[p] = tickPlantEnergy(energy[p], /*light=*/ 0, tick, ENERGY_CONFIG);
      if (energy[p] > 0) livingCount++;
    }
    if (livingCount === 0) { allDeadTick = tick; break; }
  }
  assert.ok(allDeadTick > 0, 'all-leafless population must eventually all die');
  assert.ok(allDeadTick < 250, `all-leafless population dies too slowly: ${allDeadTick} ticks`);
  console.log(`    leafless mass-death tick: ${allDeadTick}`);
});
