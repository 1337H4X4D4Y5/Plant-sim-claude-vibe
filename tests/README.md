# Tests

CPU-side regression tests for the genome system. Run with:

```sh
node --test tests/genome.test.mjs
```

## What's tested

- `typeBounds(t)` returns valid (lo ≤ hi) ranges for every plant type.
- **10 000 initial spawns** stay within their type's height ceiling — catches the case where `rollByType` would let a grass come out trunk-sized.
- **1 000-generation mutation chain × 5 trials** stays within the *current* plant type's ceiling at every step. Catches mutation drift, including across plant-type jumps.
- **Per-type stress** — for each starting type, force 500 mutations from a `rollByType`-rolled parent and assert each generation. Catches type-specific drift that the random-seed chain might miss.

Ceilings are computed from the `typeBounds()` maxima:

```
seedLength_max * Σ_{i=0..maxDepth_max} (lenScale_max ^ i) * 1.10
```

with a small buffer rounded up. They reflect what the bounds *allow*, not what we *want*. If a future change tightens `typeBounds` we can tighten the ceilings; if a change loosens `typeBounds` past the ceiling, the test fails and we either bump the ceiling or revert.

## Keeping in sync

The genome functions are duplicated at the top of `genome.test.mjs` so the test runs without a build step or import from the browser-only `main.js`. **When you change `typeBounds`, `rollByType`, or `mutateGenome` in `main.js`, copy the new versions into the test file** and re-run.
