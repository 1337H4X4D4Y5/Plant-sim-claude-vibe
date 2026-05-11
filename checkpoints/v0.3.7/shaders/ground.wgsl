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
@group(0) @binding(1) var<storage, read> lightGrid: array<u32>;

const SIZE: f32 = 80.0;
const GRID_SIZE: u32 = 256u;
const SCENE_EXTENT: f32 = 40.0;
const CELL_SIZE: f32 = 0.3125;     // matches light.wgsl

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var c: vec2<f32>;
  switch (vi) {
    case 0u: { c = vec2<f32>(-1.0, -1.0); }
    case 1u: { c = vec2<f32>( 1.0, -1.0); }
    case 2u: { c = vec2<f32>(-1.0,  1.0); }
    case 3u: { c = vec2<f32>(-1.0,  1.0); }
    case 4u: { c = vec2<f32>( 1.0, -1.0); }
    default: { c = vec2<f32>( 1.0,  1.0); }
  }
  let worldPos = vec3<f32>(c.x * SIZE, 0.0, c.y * SIZE);
  var out: VSOut;
  out.clip = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  return out;
}

fn hash(p: vec2<f32>) -> f32 {
  let q = fract(p * vec2<f32>(123.34, 456.21));
  let r = q + dot(q, q + 45.32);
  return fract(r.x * r.y);
}

fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash(i);
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Sample the splat grid in a 3×3 region for smooth canopy shadow.
fn canopyShadow(worldPos: vec3<f32>) -> f32 {
  let cell = vec2<f32>(
    (worldPos.x + SCENE_EXTENT) / CELL_SIZE,
    (worldPos.z + SCENE_EXTENT) / CELL_SIZE,
  );
  let gx = i32(floor(cell.x));
  let gz = i32(floor(cell.y));
  let last = i32(GRID_SIZE) - 1;
  var total: f32 = 0.0;
  var taken: f32 = 0.0;
  for (var dz: i32 = -1; dz <= 1; dz = dz + 1) {
    for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
      let sx = gx + dx;
      let sz = gz + dz;
      if (sx >= 0 && sx <= last && sz >= 0 && sz <= last) {
        let idx = u32(sz) * GRID_SIZE + u32(sx);
        total = total + f32(lightGrid[idx]);
        taken = taken + 1.0;
      }
    }
  }
  let avg = total / max(taken, 1.0);
  // Each unit of weight ~= one canopy segment tip; darken progressively.
  return clamp(1.0 - avg * 0.06, 0.25, 1.0);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let p = in.worldPos.xz;
  let n = valueNoise(p * 0.7) * 0.6 + valueNoise(p * 2.3) * 0.3 + valueNoise(p * 6.1) * 0.1;
  let grass = mix(vec3<f32>(0.09, 0.13, 0.08), vec3<f32>(0.16, 0.22, 0.11), n);
  let soil = vec3<f32>(0.12, 0.10, 0.07);
  let m = smoothstep(0.35, 0.65, n);
  var albedo = mix(soil, grass, m);

  let r = length(p) / SIZE;
  albedo = mix(albedo, albedo * 0.7, smoothstep(0.6, 1.0, r));

  let N = vec3<f32>(0.0, 1.0, 0.0);
  let L = normalize(frame.sunDir.xyz);
  let lambert = max(dot(N, L), 0.0);
  let shadow = canopyShadow(in.worldPos);

  let lit = albedo * (frame.sunColor.rgb * lambert * shadow + frame.ambient.rgb * 1.4);
  return vec4<f32>(lit, 1.0);
}
