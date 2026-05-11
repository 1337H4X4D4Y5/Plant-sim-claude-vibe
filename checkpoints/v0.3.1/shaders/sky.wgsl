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

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p: vec2<f32>;
  if (vi == 0u) { p = vec2<f32>(-1.0, -1.0); }
  else if (vi == 1u) { p = vec2<f32>(3.0, -1.0); }
  else { p = vec2<f32>(-1.0, 3.0); }
  var out: VSOut;
  out.clip = vec4<f32>(p, 1.0, 1.0);
  out.ndc = p;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let nearH = frame.invViewProj * vec4<f32>(in.ndc, 0.0, 1.0);
  let farH = frame.invViewProj * vec4<f32>(in.ndc, 1.0, 1.0);
  let nearW = nearH.xyz / nearH.w;
  let farW = farH.xyz / farH.w;
  let dir = normalize(farW - nearW);

  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let horizon = vec3<f32>(0.62, 0.72, 0.78);
  let zenith = vec3<f32>(0.18, 0.36, 0.55);
  var col = mix(horizon, zenith, smoothstep(0.0, 0.9, t));

  let below = smoothstep(0.0, 0.18, -dir.y);
  col = mix(col, vec3<f32>(0.10, 0.12, 0.10), below * 0.6);

  let sun = normalize(frame.sunDir.xyz);
  let cosTheta = dot(dir, sun);
  let disc = smoothstep(0.9995, 0.99985, cosTheta);
  let glow = pow(max(cosTheta, 0.0), 64.0) * 0.6;
  col += frame.sunColor.rgb * (disc * 8.0 + glow);

  return vec4<f32>(col, 1.0);
}
