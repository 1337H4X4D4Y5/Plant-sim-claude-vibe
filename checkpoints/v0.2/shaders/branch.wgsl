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
  length: f32,
  oriQuat: vec4<f32>,
  radius: f32,
  depth: f32,
  flags: u32,
  age: u32,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> segments: array<Segment>;

const ALIVE_BIT: u32 = 2u;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) depth: f32,
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

// Smooth, world-position-based wind. Vertices at the same world Y get the
// same offset, which keeps neighboring segments continuous at their joins.
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
  let sr = cylVert(vi);
  let angle = sr.x * TAU;
  let ringT = sr.y;

  var out: VSOut;

  if ((s.flags & ALIVE_BIT) == 0u || s.length <= 0.0) {
    // Collapse dead/empty slots so they produce no fragments.
    out.clip = vec4<f32>(0.0, 0.0, -1.0, 1.0);
    out.worldPos = vec3<f32>(0.0);
    out.worldNormal = vec3<f32>(0.0, 1.0, 0.0);
    out.depth = 0.0;
    return out;
  }

  let radHere = mix(s.radius, s.radius * 0.88, ringT);
  let localPos = vec3<f32>(cos(angle) * radHere, ringT * s.length, sin(angle) * radHere);
  let localNormal = vec3<f32>(cos(angle), 0.0, sin(angle));

  var worldPos = s.pos + rotateByQuat(s.oriQuat, localPos);
  let worldNormal = normalize(rotateByQuat(s.oriQuat, localNormal));
  worldPos = worldPos + windOffset(worldPos, frame.cameraPosTime.w);

  out.clip = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.worldNormal = worldNormal;
  out.depth = s.depth;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNormal);
  let L = normalize(frame.sunDir.xyz);
  let lambert = max(dot(N, L), 0.0);

  let trunkColor = vec3<f32>(0.36, 0.24, 0.16);
  let twigColor = vec3<f32>(0.46, 0.36, 0.21);
  let t = clamp(in.depth / 6.0, 0.0, 1.0);
  let albedo = mix(trunkColor, twigColor, t);

  let lit = albedo * (frame.sunColor.rgb * lambert + frame.ambient.rgb);
  return vec4<f32>(lit, 1.0);
}
