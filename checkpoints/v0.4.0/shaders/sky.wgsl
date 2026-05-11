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

  let sun = normalize(frame.sunDir.xyz);
  let sunY = sun.y;

  // Two blend weights from sun elevation:
  //   nightW  — 1 when sun is below horizon, 0 by sunY=0.05
  //   sunsetW — 1 just above horizon (0..0.20), 0 above ~0.35
  //   dayW    — 1 once sun is well above horizon
  let nightW  = 1.0 - smoothstep(-0.10, 0.05, sunY);
  let sunsetW = smoothstep(0.00, 0.10, sunY) * (1.0 - smoothstep(0.20, 0.45, sunY));
  let dayW    = smoothstep(0.20, 0.45, sunY);

  // Palette presets for horizon and zenith colours.
  let zenithNight  = vec3<f32>(0.025, 0.035, 0.08);
  let zenithSunset = vec3<f32>(0.18,  0.16,  0.32);
  let zenithDay    = vec3<f32>(0.16,  0.33,  0.55);
  let horizonNight  = vec3<f32>(0.06, 0.08, 0.16);
  let horizonSunset = vec3<f32>(0.95, 0.50, 0.25);
  let horizonDay    = vec3<f32>(0.62, 0.72, 0.78);

  let zenith  = zenithNight  * nightW + zenithSunset  * sunsetW + zenithDay  * dayW;
  let horizon = horizonNight * nightW + horizonSunset * sunsetW + horizonDay * dayW;

  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  var col = mix(horizon, zenith, smoothstep(0.0, 0.9, t));

  // Below-horizon ground tint follows the time of day.
  let below = smoothstep(0.0, 0.18, -dir.y);
  let groundTint = vec3<f32>(0.10, 0.12, 0.10) * (0.20 + 0.80 * dayW);
  col = mix(col, groundTint, below * 0.6);

  // Warm bloom around the sun when it's low (golden-hour halo).
  let cosTheta = dot(dir, sun);
  let lowSunBoost = max(0.0, 1.0 - max(sunY, 0.0) * 2.0);
  let bloom = pow(max(cosTheta, 0.0), 6.0);
  col += vec3<f32>(1.0, 0.55, 0.25) * lowSunBoost * bloom * 0.35;

  // Sun disc + tight glow — fade out when sun is below horizon.
  let aboveHorizon = clamp(sunY * 4.0, 0.0, 1.0);
  let disc = smoothstep(0.9995, 0.99985, cosTheta) * aboveHorizon;
  let glow = pow(max(cosTheta, 0.0), 64.0) * 0.6 * aboveHorizon;
  col += frame.sunColor.rgb * (disc * 8.0 + glow);

  return vec4<f32>(col, 1.0);
}
