// Top-down light/canopy grid. Cleared and splatted every frame:
//   clear: zero every cell.
//   splat: each alive non-trunk segment increments the cell its tip lands in.
//
// Read by ground.wgsl to darken ground under canopies. In v0.4 this same
// grid drives plant fitness for evolution.

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
  segsPerPlant: u32,
};

const GRID_SIZE: u32 = 256u;
const GRID_CELLS: u32 = 65536u;     // 256 * 256
const SCENE_EXTENT: f32 = 40.0;     // grid covers [-40, +40] m on x and z
const CELL_SIZE: f32 = 0.3125;       // 80 / 256

const ALIVE_BIT: u32 = 2u;
// Encode segment tip height in centimetres so we can use atomicMax on a u32.
// Max representable: ~42 km. Plants are < 30 m, fine.
const HEIGHT_SCALE: f32 = 100.0;

@group(0) @binding(0) var<storage, read_write> lightGrid: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read> segments: array<Segment>;
@group(0) @binding(2) var<uniform> sim: SimParams;

fn rotateByQuat(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= GRID_CELLS) { return; }
  atomicStore(&lightGrid[i], 0u);
}

@compute @workgroup_size(64)
fn splat(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= sim.maxSegs) { return; }
  let s = segments[i];
  if ((s.flags & ALIVE_BIT) == 0u) { return; }
  if (s.len <= 0.0) { return; }
  // Skip the trunk so the shadow follows the canopy, not the ground line.
  if (s.depth < 2.0) { return; }

  // Tip of the segment in world space.
  let parentDir = normalize(rotateByQuat(s.oriQuat, vec3<f32>(0.0, 1.0, 0.0)));
  let tipPos = s.pos + parentDir * s.len;

  // Project XZ into grid cell. Bail if outside.
  let cell = vec2<f32>(
    (tipPos.x + SCENE_EXTENT) / CELL_SIZE,
    (tipPos.z + SCENE_EXTENT) / CELL_SIZE,
  );
  if (cell.x < 0.0 || cell.x >= f32(GRID_SIZE)) { return; }
  if (cell.y < 0.0 || cell.y >= f32(GRID_SIZE)) { return; }
  let gx = u32(cell.x);
  let gz = u32(cell.y);

  // Record the *height* of the tallest canopy segment in this cell. We
  // can then tell who's shadowed by whom: a leaf below the cell's max is
  // under another plant's canopy and v0.4 uses that for fitness.
  let encoded = u32(clamp(tipPos.y * HEIGHT_SCALE, 0.0, 4000000.0));
  atomicMax(&lightGrid[gz * GRID_SIZE + gx], encoded);
}
