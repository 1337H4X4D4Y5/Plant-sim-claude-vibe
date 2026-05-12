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
  leafShape: f32,
  barkHue: f32,
  plantType: f32,
  flowerHue: f32,
  _pad0: f32,
  _pad1: f32,
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
@group(0) @binding(4) var<storage, read> lightGrid: array<u32>;

// Mirrors the ground shader: 8-step ray-march toward the sun across the
// canopy-height grid. Plants with taller neighbours overhead shade
// themselves automatically.
const HEIGHT_SCALE: f32 = 100.0;
const GRID_SIZE: u32 = 256u;
const SCENE_EXTENT: f32 = 40.0;
const CELL_SIZE: f32 = 0.3125;

fn shadowCast(worldPos: vec3<f32>, sunDir: vec3<f32>) -> f32 {
  let sy = max(sunDir.y, 0.0);
  if (sy < 0.06) { return 1.0; }
  let stepX = sunDir.x / sy;
  let stepZ = sunDir.z / sy;
  let last = i32(GRID_SIZE) - 1;
  var blocked: f32 = 0.0;
  for (var i: u32 = 1u; i <= 8u; i = i + 1u) {
    let dH = f32(i) * 0.85;
    let rayH = worldPos.y + dH;
    let px = worldPos.x + stepX * dH;
    let pz = worldPos.z + stepZ * dH;
    let gx = i32(floor((px + SCENE_EXTENT) / CELL_SIZE));
    let gz = i32(floor((pz + SCENE_EXTENT) / CELL_SIZE));
    if (gx < 0 || gx > last || gz < 0 || gz > last) { continue; }
    let cellH = f32(lightGrid[u32(gz) * GRID_SIZE + u32(gx)]) / HEIGHT_SCALE;
    if (cellH > rayH + 0.15) {
      blocked = max(blocked, smoothstep(0.0, 1.2, cellH - rayH));
    }
  }
  return 1.0 - blocked * 0.65;
}

const ALIVE_BIT: u32 = 2u;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) depth: f32,
  @location(3) @interpolate(flat) barkHue: f32,
  @location(4) @interpolate(flat) plantType: u32,
};

fn rotateByQuat(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

const SIDES: u32 = 8u;
const TAU: f32 = 6.28318530718;

fn cylVert(vi: u32) -> vec2<f32> {
  let triIdx = vi / 3u;
  let vInTri = vi % 3u;
  let quadIdx = triIdx / 2u;
  let triInQuad = triIdx % 2u;
  var ring: f32;
  var sideOffset: u32;
  if (triInQuad == 0u) {
    if (vInTri == 0u) { ring = 0.0; sideOffset = 0u; }
    else if (vInTri == 1u) { ring = 1.0; sideOffset = 0u; }
    else { ring = 1.0; sideOffset = 1u; }
  } else {
    if (vInTri == 0u) { ring = 0.0; sideOffset = 0u; }
    else if (vInTri == 1u) { ring = 1.0; sideOffset = 1u; }
    else { ring = 0.0; sideOffset = 1u; }
  }
  let s = f32((quadIdx + sideOffset) % SIDES) / f32(SIDES);
  return vec2<f32>(s, ring);
}

// Smooth, world-position-based wind.
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
  let s = segments[ii];
  let plantIdx = ii / sim.segsPerPlant;
  let g = genomes[plantIdx];
  let sr = cylVert(vi);
  let angle = sr.x * TAU;
  let ringT = sr.y;

  var out: VSOut;

  // Bail on dead, zero-length, NaN, or implausibly tall segments so a
  // single bad data point can't produce a tall vertical streak. Caps are
  // intentionally tight: longest legitimate segment is < 2 m, tallest
  // legitimate plant tip < 12 m, so anything past these is bogus.
  let lenBad = s.len <= 0.0 || s.len > 4.0 || s.len != s.len
            || s.radius <= 0.0 || s.radius > 1.0 || s.radius != s.radius;
  let posBad = s.pos.x != s.pos.x || s.pos.y != s.pos.y || s.pos.z != s.pos.z
            || abs(s.pos.y) > 20.0 || abs(s.pos.x) > 80.0 || abs(s.pos.z) > 80.0;
  if ((s.flags & ALIVE_BIT) == 0u || lenBad || posBad) {
    out.clip = vec4<f32>(0.0, 0.0, -1.0, 1.0);
    out.worldPos = vec3<f32>(0.0);
    out.worldNormal = vec3<f32>(0.0, 1.0, 0.0);
    out.depth = 0.0;
    out.barkHue = 0.0;
    out.plantType = 0u;
    return out;
  }

  // Gentler taper from base→tip (was 0.88, now 0.94) so terminal twigs
  // don't pinch to a needle right where the leaves attach.
  let radHere = mix(s.radius, s.radius * 0.94, ringT);
  let localPos = vec3<f32>(cos(angle) * radHere, ringT * s.len, sin(angle) * radHere);
  let localNormal = vec3<f32>(cos(angle), 0.0, sin(angle));

  var worldPos = s.pos + rotateByQuat(s.oriQuat, localPos);
  let worldNormal = normalize(rotateByQuat(s.oriQuat, localNormal));
  worldPos = worldPos + windOffset(worldPos, frame.cameraPosTime.w);

  out.clip = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.worldNormal = worldNormal;
  out.depth = s.depth;
  out.barkHue = g.barkHue;
  out.plantType = u32(g.plantType + 0.5);
  return out;
}

// barkHue ∈ [0, 1] tints the trunk smoothly between three character bark
// looks: 0 = warm cherry/red bark, 0.5 = neutral oak, 1 = cool silver-birch.
fn tintBark(base: vec3<f32>, hue: f32) -> vec3<f32> {
  let warm = vec3<f32>(1.18, 0.78, 0.66);
  let neutral = vec3<f32>(1.00, 1.00, 1.00);
  let cool = vec3<f32>(0.78, 0.92, 1.10);
  let t = clamp(hue, 0.0, 1.0);
  let lower = mix(warm, neutral, smoothstep(0.0, 0.5, t));
  let upper = mix(neutral, cool, smoothstep(0.5, 1.0, t));
  let tint = select(lower, upper, t > 0.5);
  return base * tint;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNormal);
  let L = normalize(frame.sunDir.xyz);
  let lambert = max(dot(N, L), 0.0);

  let t = clamp(in.depth / 6.0, 0.0, 1.0);
  var albedo: vec3<f32>;
  if (in.plantType == 2u) {
    // Grass blade — green, darker near root, brighter at tip.
    let darkBlade = vec3<f32>(0.10, 0.32, 0.10);
    let lightBlade = vec3<f32>(0.32, 0.65, 0.22);
    albedo = mix(darkBlade, lightBlade, clamp(in.depth / 5.0, 0.0, 1.0));
  } else if (in.plantType == 3u) {
    // Flower stem — slender green, no bark.
    albedo = vec3<f32>(0.18, 0.36, 0.16);
  } else {
    // Tree / bush — bark tinted by genome.barkHue.
    let trunkBase = vec3<f32>(0.36, 0.24, 0.16);
    let twigBase  = vec3<f32>(0.46, 0.36, 0.21);
    let trunkColor = tintBark(trunkBase, in.barkHue);
    let twigColor  = tintBark(twigBase,  in.barkHue);
    albedo = mix(trunkColor, twigColor, t);
  }

  let shadow = shadowCast(in.worldPos, normalize(frame.sunDir.xyz));
  let lit = albedo * (frame.sunColor.rgb * lambert * shadow + frame.ambient.rgb);
  return vec4<f32>(lit, 1.0);
}
