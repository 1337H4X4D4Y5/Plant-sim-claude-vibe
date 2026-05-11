// Leaves. 3 instances per segment; segment-index = floor(ii / 3),
// leaf-index = ii % 3. Each is a small camera-billboarded quad attached
// to a point along its parent segment. The quad is uniformly sized; the
// actual leaf silhouette is carved out in the fragment shader via
// `discard`, with the shape chosen by `genome.leafShape`.

struct Frame {
  view: mat4x4<f32>,
  proj: mat4x4<f32>,
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  cameraPosTime: vec4<f32>,
  sunDir: vec4<f32>,
  sunColor: vec4<f32>,
  ambient: vec4<f32>,
  viewport: vec4<f32>,
};

struct Segment {
  pos: vec3<f32>,
  len: f32,
  oriQuat: vec4<f32>,
  radius: f32,
  depth: f32,
  flags: u32,
  age: u32,
};

struct Genome {
  branchAngle: f32,
  branchProb: f32,
  lenScale: f32,
  radScale: f32,
  maxDepth: f32,
  growthBias: f32,
  leafShape: f32,   // 0=oval, 1=round, 2=lance, 3=lobed, 4=heart
  barkHue: f32,     // consumed by branch.wgsl
};

struct SimParams {
  tick: u32,
  maxSegs: u32,
  rngSeed: u32,
  segsPerPlant: u32,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> segments: array<Segment>;
@group(0) @binding(2) var<storage, read> genomes: array<Genome>;
@group(0) @binding(3) var<uniform> sim: SimParams;

const ALIVE_BIT: u32 = 2u;
const LEAVES_PER_SEG: u32 = 3u;
const DEPTH_THRESHOLD: f32 = 2.5;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) shade: f32,
  @location(3) uv: vec2<f32>,
  @location(4) @interpolate(flat) shapeId: u32,
};

fn rotateByQuat(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn hash32(x: u32) -> u32 {
  var h = x;
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}

// Quad as 2 triangles. Returns (u, v) where u in [-0.5, 0.5], v in [0, 1].
fn quadVert(vi: u32) -> vec2<f32> {
  switch (vi) {
    case 0u: { return vec2<f32>(-0.5, 0.0); }
    case 1u: { return vec2<f32>( 0.5, 0.0); }
    case 2u: { return vec2<f32>(-0.5, 1.0); }
    case 3u: { return vec2<f32>(-0.5, 1.0); }
    case 4u: { return vec2<f32>( 0.5, 0.0); }
    default: { return vec2<f32>( 0.5, 1.0); }
  }
}

// Same world-position-keyed wind that branch.wgsl uses.
fn windOffset(p: vec3<f32>, t: f32) -> vec3<f32> {
  let h = max(p.y, 0.0);
  let amp = clamp(h * 0.05, 0.0, 0.4);
  return vec3<f32>(
    sin(t * 1.7 + p.x * 0.35 + p.z * 0.21) * amp,
    sin(t * 2.6 + p.x * 0.5)               * amp * 0.05,
    sin(t * 2.1 + p.z * 0.40 + p.x * 0.15) * amp * 0.7,
  );
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let segIdx = ii / LEAVES_PER_SEG;
  let leafIdx = ii % LEAVES_PER_SEG;
  let plantIdx = segIdx / sim.segsPerPlant;
  let s = segments[segIdx];
  let g = genomes[plantIdx];

  var out: VSOut;

  let alive = (s.flags & ALIVE_BIT) != 0u;
  if (!alive || s.depth < DEPTH_THRESHOLD || s.len <= 0.0) {
    out.clip = vec4<f32>(0.0, 0.0, -1.0, 1.0);
    out.worldPos = vec3<f32>(0.0);
    out.worldNormal = vec3<f32>(0.0, 1.0, 0.0);
    out.shade = 0.0;
    out.uv = vec2<f32>(0.0);
    out.shapeId = 0u;
    return out;
  }

  let h = hash32((segIdx * 17u) + leafIdx + 7u);
  let t = 0.32 + f32(leafIdx) * 0.32 + (f32(h & 0xFFu) / 255.0) * 0.06;
  let twist = (f32(leafIdx) * 2.094) + ((f32((h >> 8u) & 0xFFu) / 255.0) * 0.5);
  let size = 0.085 + ((f32((h >> 16u) & 0x7Fu) / 127.0) * 0.05);

  // Anchor + wind.
  let parentDir = normalize(rotateByQuat(s.oriQuat, vec3<f32>(0.0, 1.0, 0.0)));
  var basePos = s.pos + (parentDir * (s.len * t));
  basePos = basePos + windOffset(basePos, frame.cameraPosTime.w);

  // Radial offset.
  let absY = abs(parentDir.y);
  let refAxis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), absY > 0.9);
  let rightAxis = normalize(cross(refAxis, parentDir));
  let fwdAxis = cross(parentDir, rightAxis);
  let stem = (cos(twist) * rightAxis) + (sin(twist) * fwdAxis);
  let leafCenter = basePos + (stem * (size * 1.4));

  let camRight = vec3<f32>(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let camUp    = vec3<f32>(frame.view[0][1], frame.view[1][1], frame.view[2][1]);

  // Narrow species use a tighter horizontal quad so less overdraw.
  let shape = u32(g.leafShape + 0.5);
  let widthScale = select(1.0, 0.55, shape == 2u);

  let q = quadVert(vi);
  let worldPos = leafCenter
    + (camRight * (q.x * size * widthScale))
    + (camUp    * ((q.y - 0.3) * size * 1.4));

  let leafNormal = normalize(mix(camUp, vec3<f32>(0.0, 1.0, 0.0), 0.65));

  out.clip = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.worldNormal = leafNormal;
  out.shade = f32((h >> 24u) & 0xFFu) / 255.0;
  out.uv = vec2<f32>(q.x, q.y);   // u in [-0.5, 0.5], v in [0, 1]
  out.shapeId = shape;
  return out;
}

// Returns 1.0 if the (u, v) point is inside the chosen leaf silhouette.
// u in [-0.5, 0.5] (cross-leaf), v in [0, 1] (base -> tip).
fn leafMask(uv: vec2<f32>, shape: u32) -> f32 {
  let cu = uv.x;
  let cv = uv.y - 0.5;

  // Oval (default lanceolate-ish): classic leaf.
  if (shape == 0u) {
    let d = ((cu / 0.42) * (cu / 0.42)) + ((cv / 0.50) * (cv / 0.50));
    return select(0.0, 1.0, d < 1.0);
  }
  // Round (orbicular): like a poplar.
  if (shape == 1u) {
    let d = ((cu / 0.45) * (cu / 0.45)) + ((cv / 0.45) * (cv / 0.45));
    return select(0.0, 1.0, d < 1.0);
  }
  // Lance (willow): tall + narrow, pointed both ends.
  if (shape == 2u) {
    let d = ((cu / 0.22) * (cu / 0.22)) + ((cv / 0.50) * (cv / 0.50));
    return select(0.0, 1.0, d < 1.0);
  }
  // Lobed (maple-ish): 5 lobes via polar modulation.
  if (shape == 3u) {
    let angle = atan2(cv, cu);
    let radius = sqrt((cu * cu) + (cv * cv));
    let limit = 0.30 + 0.18 * cos(5.0 * angle - 1.5708);
    return select(0.0, 1.0, radius < limit);
  }
  // Heart (cordate): cardioid-ish curve.
  let hx = cu * 1.5;
  let hy = -cv * 1.3;
  let term = (hx * hx) + (hy * hy) - 0.35;
  let val = (term * term * term) - ((hx * hx) * (hy * hy * hy));
  return select(0.0, 1.0, val < 0.0);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let mask = leafMask(in.uv, in.shapeId);
  if (mask < 0.5) { discard; }

  let N = normalize(in.worldNormal);
  let L = normalize(frame.sunDir.xyz);
  let lambert = max(dot(N, L), 0.0);
  let back = max(-dot(N, L), 0.0);

  // Per-species color bias so the silhouette isn't the only cue.
  var darkGreen = vec3<f32>(0.10, 0.26, 0.08);
  var lightGreen = vec3<f32>(0.36, 0.58, 0.22);
  if (in.shapeId == 1u) {        // round / birch — yellower
    darkGreen = vec3<f32>(0.18, 0.30, 0.10);
    lightGreen = vec3<f32>(0.55, 0.66, 0.22);
  } else if (in.shapeId == 2u) { // willow — cooler
    darkGreen = vec3<f32>(0.08, 0.26, 0.16);
    lightGreen = vec3<f32>(0.32, 0.55, 0.30);
  } else if (in.shapeId == 3u) { // maple — punchier
    darkGreen = vec3<f32>(0.10, 0.30, 0.08);
    lightGreen = vec3<f32>(0.40, 0.66, 0.18);
  } else if (in.shapeId == 4u) { // heart — red-tinged
    darkGreen = vec3<f32>(0.22, 0.30, 0.10);
    lightGreen = vec3<f32>(0.58, 0.55, 0.20);
  }
  let albedo = mix(darkGreen, lightGreen, in.shade);

  let lit = albedo * ((frame.sunColor.rgb * (lambert + back * 0.4)) + (frame.ambient.rgb * 1.6));
  return vec4<f32>(lit, 1.0);
}
