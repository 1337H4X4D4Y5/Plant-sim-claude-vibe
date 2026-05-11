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

@group(0) @binding(0) var<uniform> frame: Frame;

struct VSIn {
  @builtin(vertex_index) vi: u32,
  @location(0) posLen: vec4<f32>,
  @location(1) oriQuat: vec4<f32>,
  @location(2) radDepth: vec4<f32>,
};

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

@vertex
fn vs(in: VSIn) -> VSOut {
  let sr = cylVert(in.vi);
  let angle = sr.x * TAU;
  let ringT = sr.y;

  let radius = in.radDepth.x;
  let length = in.posLen.w;
  let basePos = in.posLen.xyz;
  let depth = in.radDepth.y;

  let radHere = mix(radius, radius * 0.88, ringT);
  let localPos = vec3<f32>(cos(angle) * radHere, ringT * length, sin(angle) * radHere);
  let localNormal = vec3<f32>(cos(angle), 0.0, sin(angle));

  let worldPos = basePos + rotateByQuat(in.oriQuat, localPos);
  let worldNormal = normalize(rotateByQuat(in.oriQuat, localNormal));

  var out: VSOut;
  out.clip = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.worldNormal = worldNormal;
  out.depth = depth;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNormal);
  let L = normalize(frame.sunDir.xyz);
  let lambert = max(dot(N, L), 0.0);

  let trunkColor = vec3<f32>(0.36, 0.24, 0.16);
  let twigColor = vec3<f32>(0.42, 0.34, 0.20);
  let t = clamp(in.depth / 5.0, 0.0, 1.0);
  let albedo = mix(trunkColor, twigColor, t);

  let lit = albedo * (frame.sunColor.rgb * lambert + frame.ambient.rgb);
  return vec4<f32>(lit, 1.0);
}
