// Leaves. 3 instances per segment; segment-index = floor(ii / 3),
// leaf-index = ii % 3. Each is a small camera-billboarded quad attached
// to a point along its parent segment. Segments below DEPTH_THRESHOLD
// don't sprout leaves so the trunk stays bare.

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

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> segments: array<Segment>;

const ALIVE_BIT: u32 = 2u;
const LEAVES_PER_SEG: u32 = 3u;
const DEPTH_THRESHOLD: f32 = 2.5;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) shade: f32,
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

fn quadVert(vi: u32) -> vec2<f32> {
  // Quad as 2 triangles: u in [-0.5, 0.5], v in [0, 1].
  switch (vi) {
    case 0u: { return vec2<f32>(-0.5, 0.0); }
    case 1u: { return vec2<f32>( 0.5, 0.0); }
    case 2u: { return vec2<f32>(-0.5, 1.0); }
    case 3u: { return vec2<f32>(-0.5, 1.0); }
    case 4u: { return vec2<f32>( 0.5, 0.0); }
    default: { return vec2<f32>( 0.5, 1.0); }
  }
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let segIdx = ii / LEAVES_PER_SEG;
  let leafIdx = ii % LEAVES_PER_SEG;
  let s = segments[segIdx];

  var out: VSOut;

  let alive = (s.flags & ALIVE_BIT) != 0u;
  if (!alive || s.depth < DEPTH_THRESHOLD || s.len <= 0.0) {
    // Collapse degenerate slots.
    out.clip = vec4<f32>(0.0, 0.0, -1.0, 1.0);
    out.worldPos = vec3<f32>(0.0);
    out.worldNormal = vec3<f32>(0.0, 1.0, 0.0);
    out.shade = 0.0;
    return out;
  }

  // Deterministic per-leaf jitter.
  let h = hash32((segIdx * 17u) + leafIdx + 7u);
  let t = 0.32 + f32(leafIdx) * 0.32 + (f32(h & 0xFFu) / 255.0) * 0.06;
  let twist = (f32(leafIdx) * 2.094) + ((f32((h >> 8u) & 0xFFu) / 255.0) * 0.5);
  let size = 0.085 + ((f32((h >> 16u) & 0x7Fu) / 127.0) * 0.05);

  // Anchor position along the segment.
  let parentDir = normalize(rotateByQuat(s.oriQuat, vec3<f32>(0.0, 1.0, 0.0)));
  let basePos = s.pos + (parentDir * (s.len * t));

  // Build a basis around the segment to offset the leaf radially.
  let absY = abs(parentDir.y);
  let refAxis = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), absY > 0.9);
  let rightAxis = normalize(cross(refAxis, parentDir));
  let fwdAxis = cross(parentDir, rightAxis);
  let stem = (cos(twist) * rightAxis) + (sin(twist) * fwdAxis);
  let leafCenter = basePos + (stem * (size * 1.4));

  // Camera-billboard basis: rows 0 and 1 of the view matrix are the
  // world-space right and up axes of the camera.
  let camRight = vec3<f32>(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let camUp    = vec3<f32>(frame.view[0][1], frame.view[1][1], frame.view[2][1]);

  let q = quadVert(vi);
  let worldPos = leafCenter
    + (camRight * (q.x * size))
    + (camUp    * ((q.y - 0.3) * size * 1.4));

  // Lean the fake normal upward so top-lit leaves are bright.
  let leafNormal = normalize(mix(camUp, vec3<f32>(0.0, 1.0, 0.0), 0.65));

  out.clip = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.worldNormal = leafNormal;
  out.shade = f32((h >> 24u) & 0xFFu) / 255.0;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNormal);
  let L = normalize(frame.sunDir.xyz);
  let lambert = max(dot(N, L), 0.0);
  let back = max(-dot(N, L), 0.0);

  let darkGreen = vec3<f32>(0.10, 0.26, 0.08);
  let lightGreen = vec3<f32>(0.36, 0.58, 0.22);
  let albedo = mix(darkGreen, lightGreen, in.shade);

  let lit = albedo * ((frame.sunColor.rgb * (lambert + back * 0.4)) + (frame.ambient.rgb * 1.6));
  return vec4<f32>(lit, 1.0);
}
