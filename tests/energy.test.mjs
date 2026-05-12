// Unit tests for the plant energy/metabolism system. Mirrors the logic in
// /checkpoints/v0.4.13/main.js (ENERGY_CONFIG + tickPlantEnergy +
// evolveStep). Run with:
//
//     node --test tests/
//
// The hypotheses under test:
//   1. A plant that captures no sunlight (no leaves, fully shaded) loses
//      energy every tick once past its grace period, and dies.
//   2. A plant in full sun lives much longer but eventually dies of old
//      age (AGE_COST scales with age) — population always turns over.
//   3. Energy is capped at MAX_ENERGY so a long-lived parent can't bank
//      infinite reserves and dominate the gene pool forever.

import { test } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Mirror of main.js as of v0.4.13
// ---------------------------------------------------------------------------

const ENERGY_CONFIG = {
  SEED_ENERGY:       100,
  MAX_ENERGY:        140,
  GRACE_TICKS:         8,
  LIGHT_PER_ENERGY: 4000,
  MAINTENANCE_COST:  1.0,
  AGE_COST:        0.012,
};

function tickPlantEnergy(prevEnergy, measuredLight, age, cfg) {
  const gain = measuredLight / cfg.LIGHT_PER_ENERGY;
  const cost = age >= cfg.GRACE_TICKS
    ? cfg.MAINTENANCE_COST + cfg.AGE_COST * age
    : 0;
  return Math.min(cfg.MAX_ENERGY, prevEnergy + gain - cost);
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
  // With MAINTENANCE_COST=1.0 + AGE_COST=0.012, death is faster than v0.4.12
  // (the age cost compounds). Expected: ~70 ticks past grace.
  assert.ok(tickOfDeath > ENERGY_CONFIG.GRACE_TICKS + 30,
    `death too quick: ${tickOfDeath} ticks (expected > ${ENERGY_CONFIG.GRACE_TICKS + 30})`);
  assert.ok(tickOfDeath < ENERGY_CONFIG.GRACE_TICKS + 120,
    `death too slow: ${tickOfDeath} ticks (expected < ${ENERGY_CONFIG.GRACE_TICKS + 120})`);
});

test('senescence: leafy plant in full sun eventually dies of old age', () => {
  // Even constant abundant light isn't enough — AGE_COST eventually exceeds
  // gain. This is the mechanism that forces population turnover.
  let e = ENERGY_CONFIG.SEED_ENERGY;
  let deathAge = -1;
  for (let age = 0; age < 5000; age++) {
    e = tickPlantEnergy(e, /*light=*/ 5000, age, ENERGY_CONFIG);
    if (e <= 0) { deathAge = age; break; }
  }
  assert.ok(deathAge > 0, `leafy plant must die of old age, but lived past tick 5000`);
  // 5000 light → gain 1.25/tick. Cost at age A is 1.0 + 0.012*A. Net negative
  // once A > (1.25 - 1.0) / 0.012 ≈ 21. So energy starts falling at age ~21
  // and dies somewhere around age ~250–350.
  assert.ok(deathAge > 100, `well-lit plant dies too fast: ${deathAge}`);
  assert.ok(deathAge < 600, `well-lit plant lives too long: ${deathAge}`);
  console.log(`    leafy senescence at age ${deathAge}`);
});

test('full-sun survival: plant in extreme light lives much longer than stump', () => {
  let leafy = ENERGY_CONFIG.SEED_ENERGY;
  let leafyDeath = -1;
  for (let age = 0; age < 10000; age++) {
    leafy = tickPlantEnergy(leafy, /*light=*/ 10000, age, ENERGY_CONFIG);
    if (leafy <= 0) { leafyDeath = age; break; }
  }
  let stump = ENERGY_CONFIG.SEED_ENERGY;
  let stumpDeath = -1;
  for (let age = 0; age < 10000; age++) {
    stump = tickPlantEnergy(stump, /*light=*/ 0, age, ENERGY_CONFIG);
    if (stump <= 0) { stumpDeath = age; break; }
  }
  // Aging cost compounds for both, so the ratio isn't huge — but a leafy
  // plant should still outlast a stump by at least 3×.
  assert.ok(leafyDeath > stumpDeath * 3,
    `leafy plant (${leafyDeath} ticks) should outlive stump (${stumpDeath} ticks) by at least 3×`);
  console.log(`    longevity ratio: leafy ${leafyDeath} / stump ${stumpDeath} = ${(leafyDeath/stumpDeath).toFixed(1)}×`);
});

test('energy cap: parents cannot bank more than MAX_ENERGY', () => {
  let e = ENERGY_CONFIG.SEED_ENERGY;
  // Flood with light for 100 ticks. Without the cap energy would skyrocket.
  for (let age = 0; age < 100; age++) {
    e = tickPlantEnergy(e, /*light=*/ 100000, age, ENERGY_CONFIG);
  }
  assert.ok(e <= ENERGY_CONFIG.MAX_ENERGY + 1e-6,
    `energy must be capped: got ${e.toFixed(2)} (cap ${ENERGY_CONFIG.MAX_ENERGY})`);
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
    // After grace period the population should never collapse below 2
    // viable parents — otherwise we can't repopulate. With aging cost
    // turned on, transient dips happen as cohorts die together, so allow
    // some leeway by checking against a moving threshold.
    if (tick > ENERGY_CONFIG.GRACE_TICKS + 50 && viableCount < 2) {
      assert.fail(`population crash at tick ${tick}; alive=${viableCount}, dead=${dead.length}`);
    }
    // Skip replacement until we have at least one viable parent.
    if (viableCount === 0) continue;
    // Skip if no parent has positive total weight (numerical edge case).
    let weightSum = 0;
    for (let p = 0; p < N; p++) weightSum += scores[p];
    if (weightSum <= 0) continue;

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
  assert.ok(allDeadTick < 150, `all-leafless population dies too slowly: ${allDeadTick} ticks`);
  console.log(`    leafless mass-death tick: ${allDeadTick}`);
});

test('turnover: even an all-leafy steady-state population sees regular death', () => {
  // The whole point of AGE_COST is that no individual lives forever. Run a
  // population of healthy, well-lit plants with replacement-on-death and
  // count how many lifecycles complete.
  const N = 100;
  const energy = new Float32Array(N);
  const birthTick = new Int32Array(N);
  energy.fill(ENERGY_CONFIG.SEED_ENERGY);
  let totalDeaths = 0;
  const TICKS = 1500;
  for (let tick = 1; tick < TICKS; tick++) {
    for (let p = 0; p < N; p++) {
      const age = tick - birthTick[p];
      energy[p] = tickPlantEnergy(energy[p], /*light=*/ 6000, age, ENERGY_CONFIG);
      if (age >= ENERGY_CONFIG.GRACE_TICKS && energy[p] <= 0) {
        // Replace with a fresh seed.
        energy[p] = ENERGY_CONFIG.SEED_ENERGY;
        birthTick[p] = tick;
        totalDeaths++;
      }
    }
  }
  // Expect each plant to have died at least once over 1500 ticks.
  assert.ok(totalDeaths > N,
    `population should turn over: only ${totalDeaths} deaths across ${N} plants × ${TICKS} ticks`);
  console.log(`    well-lit turnover: ${totalDeaths} deaths in ${TICKS} ticks (${N} plants)`);
});
