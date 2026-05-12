// One tick of plant growth. For each alive tip segment created on a previous
// tick, decide whether to extend, branch, or terminate; append children
// atomically to the segment buffer.

struct Segment {
  pos: vec3<f32>,
  len: f32,
  oriQuat: vec4<f32>,
  radius: f32,
  depth: f32,
  flags: u32,
  age: u32,
};

struct SimParams {
  tick: u32,
  maxSegs: u32,
  rngSeed: u32,
  segsPerPlant: u32,   // segment-slot range size per plant
};

struct Genome {
  branchAngle: f32,
  branchProb: f32,
  lenScale: f32,
  radScale: f32,
  maxDepth: f32,
  growthBias: f32,
  leafShape: f32,   // consumed by leaf.wgsl
  barkHue: f32,     // consumed by branch.wgsl
  plantType: f32,   // 0=tree 1=bush 2=grass 3=flower
  flowerHue: f32,   // consumed by leaf.wgsl when plantType == flower
  _pad0: f32,
  _pad1: f32,
};

// Counters layout, 16 B header + runtime-sized per-plant array:
//   totalSegs    u32  aggregate count across every plant (for HUD)
//   dispatched   u32  thread 0 bumps once per dispatch
//   liveTips     u32  bumped per thread that passes alive+tip+age
//   maxIdx       u32  atomicMax of sim.tick seen
//   plantNext[N] u32  per-plant next-free slot inside that plant's range
struct Counters {
  totalSegs: atomic<u32>,
  dispatched: atomic<u32>,
  liveTips: atomic<u32>,
  maxIdx: atomic<u32>,
  plantNext: array<atomic<u32>>,
};

@group(0) @binding(0) var<storage, read_write> segments: array<Segment>;
@group(0) @binding(1) var<storage, read_write> counters: Counters;
@group(0) @binding(2) var<uniform> sim: SimParams;
@group(0) @binding(3) var<storage, read> genomes: array<Genome>;

const TIP_BIT: u32 = 1u;
const ALIVE_BIT: u32 = 2u;

fn hash32(x: u32) -> u32 {
  var h = x;
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}

fn rand01(seed: u32) -> f32 {
  return f32(hash32(seed) & 0xFFFFFFu) / f32(0x1000000u);
}

fn rotateByQuat(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn quatFromUp(up: vec3<f32>) -> vec4<f32> {
  let u = normalize(up);
  let d = u.y;
  if (d > 0.9999) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  if (d < -0.9999) { return vec4<f32>(1.0, 0.0, 0.0, 0.0); }
  // axis = cross(+Y, u) = (u.z, 0, -u.x)
  let s = sqrt((1.0 + d) * 2.0);
  let inv = 1.0 / s;
  return vec4<f32>(u.z * inv, 0.0, -u.x * inv, s * 0.5);
}

@compute @workgroup_size(64)
fn grow(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;

  // DEBUG: thread 0 bumps `dispatched` unconditionally. Also stamp the
  // observed sim.tick into maxIdx so we can tell whether the uniform is
  // actually being read by the kernel.
  if (i == 0u) {
    atomicAdd(&counters.dispatched, 1u);
    atomicMax(&counters.maxIdx, sim.tick);
  }

  if (i >= sim.maxSegs) { return; }
  let plantIdx = i / sim.segsPerPlant;
  let s = segments[i];
  if ((s.flags & (TIP_BIT | ALIVE_BIT)) != (TIP_BIT | ALIVE_BIT)) { return; }
  // Only grow segments created on an earlier tick.
  if (s.age >= sim.tick) { return; }

  // DEBUG: this thread passed the alive+tip+age gate — bump liveTips.
  atomicAdd(&counters.liveTips, 1u);

  // This plant's genome.
  let g = genomes[plantIdx];

  // Dying / decaying plants don't grow. _pad0 holds decay progress (0 alive,
  // (0,1] dying). Just clear the tip bit so this branch stops appending.
  if (g._pad0 > 0.0) {
    segments[i].flags = s.flags & ~TIP_BIT;
    return;
  }

  // Stop at max depth: keep the tip in place but clear the tip flag so it
  // won't grow again (leaves can later be attached to non-tip terminals).
  if (s.depth + 1.0 > g.maxDepth) {
    segments[i].flags = s.flags & ~TIP_BIT;
    return;
  }

  // Bail if the *parent itself* is already corrupt: huge/NaN length,
  // huge/NaN position. Without this, a single drifted segment would seed
  // a runaway tower of children.
  if (s.len <= 0.0 || s.len > 2.0 || s.len != s.len) {
    segments[i].flags = s.flags & ~TIP_BIT;
    return;
  }
  if (s.pos.y != s.pos.y || abs(s.pos.y) > 10.0) {
    segments[i].flags = s.flags & ~TIP_BIT;
    return;
  }

  // Parent direction from its quaternion (local +Y axis).
  let parentDir = normalize(rotateByQuat(s.oriQuat, vec3<f32>(0.0, 1.0, 0.0)));
  let tipPos = s.pos + parentDir * s.len;

  // Defensive height cap. Worst-case math with v0.4.11 typeBounds allows
  // ~5.7 m trees; 8 m is comfortably above legitimate and below "stick"
  // territory. Terminate cleanly so render never sees runaway segments.
  if (tipPos.y > 8.0 || tipPos.y != tipPos.y) {
    segments[i].flags = s.flags & ~TIP_BIT;
    return;
  }

  // RNG. WGSL requires unary operands on bitwise operators, so each
  // multiplicative term has to be parenthesised. Safari's WGSL compiler
  // enforces this strictly; Naga/Chrome don't. Without parens this fails
  // to parse with "Expected a ;, but got a ^".
  let seedBase = ((i * 73856093u) ^ (sim.tick * 19349663u)) ^ sim.rngSeed;
  let r1 = rand01(seedBase);
  let r2 = rand01(seedBase + 1u);
  let r3 = rand01(seedBase + 2u);
  let r4 = rand01(seedBase + 3u);

  // Decide branching.
  let canBranch = s.depth >= 1.0 && s.depth + 1.0 < g.maxDepth;
  let nChildren = select(1u, 2u, canBranch && r1 < g.branchProb);

  // Allocate inside *this plant's* slot range so plants stay independent.
  let plantLocal = atomicAdd(&counters.plantNext[plantIdx], nChildren);
  if (plantLocal + nChildren > sim.segsPerPlant) {
    // This plant has filled its slot range. Stop growing this tip.
    segments[i].flags = s.flags & ~TIP_BIT;
    return;
  }
  let base = (plantIdx * sim.segsPerPlant) + plantLocal;
  atomicAdd(&counters.totalSegs, nChildren);

  // Orthonormal basis around parentDir.
  let absY = abs(parentDir.y);
  // `ref` is a WGSL reserved word (future reference type), so call this `refAxis`.
  let refAxis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), absY > 0.9);
  let right = normalize(cross(refAxis, parentDir));
  let fwd = cross(parentDir, right);

  let baseTwist = r2 * 6.2831853;

  for (var j: u32 = 0u; j < nChildren; j = j + 1u) {
    let isContinuation = j == 0u;
    let twist = baseTwist + f32(j) * 2.39996;  // golden angle
    let tilt = select(g.branchAngle + r3 * 0.25, (r4 - 0.5) * 0.18, isContinuation);
    let cosT = cos(tilt);
    let sinT = sin(tilt);
    let cw = cos(twist);
    let sw = sin(twist);
    var newDir = parentDir * cosT + (right * cw + fwd * sw) * sinT;
    // Phototropism.
    // Phototropism. Larger multiplier so negative growthBias actually droops.
    newDir = normalize(mix(newDir, vec3<f32>(0.0, 1.0, 0.0), g.growthBias * 0.20));

    // Real per-plant size variation. Continuation uses the genome's
    // lenScale/radScale directly; lateral branches are smaller by a fixed
    // ratio of that base value so the silhouette stays plausible.
    let lenScale = select(g.lenScale * 0.82, g.lenScale, isContinuation);
    let radScale = select(g.radScale * 0.77, g.radScale, isContinuation);

    var child: Segment;
    child.pos = tipPos;
    // Hard per-segment cap. Legitimate max for any plant is < 1.2 m; 1.5
    // gives a small buffer but blocks any compounded-jitter / NaN runaway.
    let rawLen = s.len * lenScale * (0.9 + r3 * 0.2);
    child.len = clamp(rawLen, 0.01, 1.5);
    child.oriQuat = quatFromUp(newDir);
    // Per-type minimum twig radius. Leaf-bearing types (tree/bush/flower)
    // need substantial terminal twigs or leaves look like they're floating
    // off thin air. Grass has no leaves so its blades stay hair-thin.
    let pt = u32(g.plantType + 0.5);
    var minRad: f32 = 0.012;        // tree
    if (pt == 1u) { minRad = 0.009; }   // bush
    if (pt == 2u) { minRad = 0.003; }   // grass
    if (pt == 3u) { minRad = 0.008; }   // flower
    child.radius = max(s.radius * radScale, minRad);
    child.depth = s.depth + 1.0;
    child.flags = TIP_BIT | ALIVE_BIT;
    child.age = sim.tick;
    segments[base + j] = child;
  }

  // Clear parent tip bit so it doesn't regrow.
  segments[i].flags = s.flags & ~TIP_BIT;
}
