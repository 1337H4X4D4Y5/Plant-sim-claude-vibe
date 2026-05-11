// Plant Sim v0.1 — "Hello plant"
// Single-file ES module: math + WebGPU init + camera + frame uniforms +
// plant authoring + sky/ground/branch renderers + RAF loop.
// Loaded by index.html as <script type="module" src="./main.js">.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  dprCap: 2,
  nearPlane: 0.1,
  farPlane: 200,
  fovYDeg: 55,
  camera: {
    initialYaw: -0.6,
    initialPitch: 0.35,
    initialDistance: 9,
    minPitch: -0.2,
    maxPitch: 1.4,
    minDistance: 2,
    maxDistance: 50,
    target: [0, 1.5, 0],
    orbitSpeed: 0.005,
    zoomSpeed: 0.0015,
    pinchSpeed: 0.01,
  },
  sun: {
    direction: [0.45, 0.78, 0.43],
    color: [1.05, 0.97, 0.88],
    ambient: [0.22, 0.28, 0.32],
  },
  sim: {
    simHz: 2.0,
    maxSegs: 2048,
    rngSeed: 0xC0FFEE,
    workgroupSize: 64,
    startDelay: 0.6,
  },
};

// ---------------------------------------------------------------------------
// Math (column-major Float32Array mat4, right-handed, depth 0..1)
// ---------------------------------------------------------------------------

function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4Perspective(fovYRad, aspect, near, far, out) {
  const f = 1 / Math.tan(fovYRad / 2);
  const o = out || new Float32Array(16);
  o.fill(0);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = far / (near - far);
  o[11] = -1;
  o[14] = (near * far) / (near - far);
  return o;
}

function mat4LookAt(eye, target, up, out) {
  let fx = eye[0] - target[0];
  let fy = eye[1] - target[1];
  let fz = eye[2] - target[2];
  let fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;

  let rx = up[1] * fz - up[2] * fy;
  let ry = up[2] * fx - up[0] * fz;
  let rz = up[0] * fy - up[1] * fx;
  let rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;

  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;

  const o = out || new Float32Array(16);
  o[0] = rx; o[1] = ux; o[2] = fx; o[3] = 0;
  o[4] = ry; o[5] = uy; o[6] = fy; o[7] = 0;
  o[8] = rz; o[9] = uz; o[10] = fz; o[11] = 0;
  o[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  o[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  o[14] = -(fx * eye[0] + fy * eye[1] + fz * eye[2]);
  o[15] = 1;
  return o;
}

function mat4Multiply(a, b, out) {
  const o = out || new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function mat4Inverse(m, out) {
  const a00 = m[0],  a01 = m[1],  a02 = m[2],  a03 = m[3];
  const a10 = m[4],  a11 = m[5],  a12 = m[6],  a13 = m[7];
  const a20 = m[8],  a21 = m[9],  a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00*a11 - a01*a10;
  const b01 = a00*a12 - a02*a10;
  const b02 = a00*a13 - a03*a10;
  const b03 = a01*a12 - a02*a11;
  const b04 = a01*a13 - a03*a11;
  const b05 = a02*a13 - a03*a12;
  const b06 = a20*a31 - a21*a30;
  const b07 = a20*a32 - a22*a30;
  const b08 = a20*a33 - a23*a30;
  const b09 = a21*a32 - a22*a31;
  const b10 = a21*a33 - a23*a31;
  const b11 = a22*a33 - a23*a32;

  let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
  if (!det) throw new Error('mat4Inverse: singular matrix');
  det = 1.0 / det;

  const o = out || new Float32Array(16);
  o[0]  = (a11*b11 - a12*b10 + a13*b09) * det;
  o[1]  = (a02*b10 - a01*b11 - a03*b09) * det;
  o[2]  = (a31*b05 - a32*b04 + a33*b03) * det;
  o[3]  = (a22*b04 - a21*b05 - a23*b03) * det;
  o[4]  = (a12*b08 - a10*b11 - a13*b07) * det;
  o[5]  = (a00*b11 - a02*b08 + a03*b07) * det;
  o[6]  = (a32*b02 - a30*b05 - a33*b01) * det;
  o[7]  = (a20*b05 - a22*b02 + a23*b01) * det;
  o[8]  = (a10*b10 - a11*b08 + a13*b06) * det;
  o[9]  = (a01*b08 - a00*b10 - a03*b06) * det;
  o[10] = (a30*b04 - a31*b02 + a33*b00) * det;
  o[11] = (a21*b02 - a20*b04 - a23*b00) * det;
  o[12] = (a11*b07 - a10*b09 - a12*b06) * det;
  o[13] = (a00*b09 - a01*b07 + a02*b06) * det;
  o[14] = (a31*b01 - a30*b03 - a32*b00) * det;
  o[15] = (a20*b03 - a21*b01 + a22*b00) * det;
  return o;
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------------------
// Shader loading
// ---------------------------------------------------------------------------

async function loadShader(name) {
  const url = new URL(`./shaders/${name}.wgsl`, import.meta.url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load shader ${name}.wgsl: ${resp.status}`);
  return resp.text();
}

// ---------------------------------------------------------------------------
// WebGPU context
// ---------------------------------------------------------------------------

async function initContext(canvas) {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser. Try Chrome 113+, Edge 113+, or Safari 17+.');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter found.');
  const device = await adapter.requestDevice();

  let deviceLostInfo = null;
  device.lost.then((info) => {
    deviceLostInfo = info;
    console.error('WebGPU device lost:', info.message);
  });
  device.addEventListener('uncapturederror', (e) => {
    console.error('WebGPU uncaptured error:', e.error?.message || e);
  });

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Failed to acquire WebGPU canvas context.');
  const format = navigator.gpu.getPreferredCanvasFormat();

  // Snapshot adapter info + features + a hand-picked limit list for the
  // debug HUD. Both adapter.info (newer) and adapter.requestAdapterInfo()
  // (older) are tried.
  let adapterInfo = {};
  try {
    if (adapter.info) {
      adapterInfo = {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        description: adapter.info.description,
      };
    } else if (adapter.requestAdapterInfo) {
      const i = await adapter.requestAdapterInfo();
      adapterInfo = { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description };
    }
  } catch (e) {
    adapterInfo = { error: String(e) };
  }
  const features = adapter.features ? [...adapter.features] : [];
  const limitNames = [
    'maxBindGroups', 'maxBufferSize', 'maxStorageBufferBindingSize',
    'maxUniformBufferBindingSize', 'minStorageBufferOffsetAlignment',
    'minUniformBufferOffsetAlignment', 'maxComputeInvocationsPerWorkgroup',
    'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupsPerDimension',
    'maxStorageBuffersPerShaderStage', 'maxVertexBuffers', 'maxVertexAttributes',
  ];
  const limits = {};
  for (const n of limitNames) limits[n] = adapter.limits?.[n];

  const ctx = {
    device, context, canvas, format, adapter,
    adapterInfo, features, limits,
    get deviceLostInfo() { return deviceLostInfo; },
    depthTexture: null, depthView: null,
    width: 0, height: 0,
    resizeCallbacks: [],
    onResize(cb) { this.resizeCallbacks.push(cb); },
  };

  function configure() {
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    context.configure({ device, format, alphaMode: 'opaque' });
    if (ctx.depthTexture) ctx.depthTexture.destroy();
    ctx.depthTexture = device.createTexture({
      size: { width: w, height: h },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    ctx.depthView = ctx.depthTexture.createView();
    ctx.width = w;
    ctx.height = h;
    for (const cb of ctx.resizeCallbacks) cb(w, h);
  }

  configure();
  new ResizeObserver(configure).observe(canvas);
  return ctx;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function createCamera(canvas) {
  let yaw = CONFIG.camera.initialYaw;
  let pitch = CONFIG.camera.initialPitch;
  let distance = CONFIG.camera.initialDistance;
  const target = [...CONFIG.camera.target];

  const view = mat4Identity();
  const proj = mat4Identity();
  const position = new Float32Array(3);

  let aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);

  function recomputeProj() {
    mat4Perspective((CONFIG.fovYDeg * Math.PI) / 180, aspect, CONFIG.nearPlane, CONFIG.farPlane, proj);
  }
  function recomputeView() {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    position[0] = target[0] + distance * cp * sy;
    position[1] = target[1] + distance * sp;
    position[2] = target[2] + distance * cp * cy;
    mat4LookAt(position, target, [0, 1, 0], view);
  }
  recomputeProj();
  recomputeView();

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function orbit(dx, dy) {
    yaw -= dx * CONFIG.camera.orbitSpeed;
    pitch += dy * CONFIG.camera.orbitSpeed;
    pitch = clamp(pitch, CONFIG.camera.minPitch, CONFIG.camera.maxPitch);
    recomputeView();
  }

  function pan(dx, dy) {
    // dx,dy in CSS pixels. Scale so a dragged point in the focal plane follows the cursor.
    const canvasH = Math.max(1, canvas.clientHeight);
    const worldPerPx = (2 * distance * Math.tan((CONFIG.fovYDeg * Math.PI / 180) / 2)) / canvasH;
    // Camera-right axis in world = first row of view = (view[0], view[4], view[8]).
    // Camera-up axis in world  = second row = (view[1], view[5], view[9]).
    target[0] += (-dx * view[0] + dy * view[1]) * worldPerPx;
    target[1] += (-dx * view[4] + dy * view[5]) * worldPerPx;
    target[2] += (-dx * view[8] + dy * view[9]) * worldPerPx;
    recomputeView();
  }

  function zoomBy(amt) {
    distance = clamp(distance + amt, CONFIG.camera.minDistance, CONFIG.camera.maxDistance);
    recomputeView();
  }

  // ---- Pointer (mouse + touch) ----
  const pointers = new Map();
  let twoFinger = null;
  let shiftHeld = false;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const wantsPan = e.button === 1 || e.button === 2 || shiftHeld;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, mode: wantsPan ? 'pan' : 'orbit' });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      twoFinger = {
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
      };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (pointers.size === 1) {
      if (p.mode === 'pan') pan(dx, dy);
      else orbit(dx, dy);
    } else if (pointers.size === 2 && twoFinger) {
      const [a, b] = [...pointers.values()];
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const dcx = cx - twoFinger.cx;
      const dcy = cy - twoFinger.cy;
      const ddist = twoFinger.dist - d;
      if (dcx !== 0 || dcy !== 0) pan(dcx, dcy);
      if (ddist !== 0) zoomBy(ddist * CONFIG.camera.pinchSpeed * distance * 0.1);
      twoFinger.cx = cx;
      twoFinger.cy = cy;
      twoFinger.dist = d;
    }
  });

  function release(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) twoFinger = null;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY * CONFIG.camera.zoomSpeed * distance * 0.2);
  }, { passive: false });

  // ---- Keyboard (WASD + QE + shift modifier) ----
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftHeld = true;
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftHeld = false;
    keys.delete(e.key.toLowerCase());
  });

  function update(dt) {
    let dxIn = 0, dzIn = 0, dyIn = 0;
    if (keys.has('w')) dzIn += 1;
    if (keys.has('s')) dzIn -= 1;
    if (keys.has('a')) dxIn -= 1;
    if (keys.has('d')) dxIn += 1;
    if (keys.has('q')) dyIn -= 1;
    if (keys.has('e')) dyIn += 1;
    if (dxIn === 0 && dzIn === 0 && dyIn === 0) return;
    const speed = Math.max(2, distance * 0.8);
    // World-space right axis = (view[0], view[4], view[8]).
    // Camera "forward toward target" in world = -(view[2], view[6], view[10]).
    const rx = view[0], ry = view[4], rz = view[8];
    let fx = -view[2], fy = -view[6], fz = -view[10];
    // Flatten forward onto XZ so traversal stays ground-locked.
    const flen = Math.hypot(fx, 0, fz) || 1;
    fx /= flen; fz /= flen; fy = 0;
    target[0] += (dxIn * rx + dzIn * fx) * speed * dt;
    target[1] += dyIn * speed * dt;
    target[2] += (dxIn * rz + dzIn * fz) * speed * dt;
    recomputeView();
  }

  return {
    view, proj, position,
    setAspect(a) { aspect = a; recomputeProj(); },
    update,
  };
}

// ---------------------------------------------------------------------------
// Frame uniforms
//   mat4 view, mat4 proj, mat4 viewProj, mat4 invViewProj,
//   vec4 cameraPosTime, vec4 sunDir, vec4 sunColor, vec4 ambient, vec4 viewport
//   = 336 bytes / 84 floats
// ---------------------------------------------------------------------------

const FRAME_FLOATS = 16 * 4 + 4 * 5;
const FRAME_BYTES = FRAME_FLOATS * 4;

function createFrameUniforms(device) {
  const cpu = new Float32Array(FRAME_FLOATS);
  const buffer = device.createBuffer({
    size: FRAME_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const viewProj = new Float32Array(16);
  const invVP = new Float32Array(16);

  return {
    buffer,
    cpu,
    update(p) {
      cpu.set(p.view, 0);
      cpu.set(p.proj, 16);
      mat4Multiply(p.proj, p.view, viewProj);
      cpu.set(viewProj, 32);
      mat4Inverse(viewProj, invVP);
      cpu.set(invVP, 48);
      cpu[64] = p.cameraPos[0];
      cpu[65] = p.cameraPos[1];
      cpu[66] = p.cameraPos[2];
      cpu[67] = p.time;
      const sd = norm3(p.sunDir);
      cpu[68] = sd[0]; cpu[69] = sd[1]; cpu[70] = sd[2]; cpu[71] = 0;
      cpu[72] = p.sunColor[0]; cpu[73] = p.sunColor[1]; cpu[74] = p.sunColor[2]; cpu[75] = 0;
      cpu[76] = p.ambient[0]; cpu[77] = p.ambient[1]; cpu[78] = p.ambient[2]; cpu[79] = 0;
      cpu[80] = p.width; cpu[81] = p.height; cpu[82] = 0; cpu[83] = 0;
    },
    upload(queue) {
      queue.writeBuffer(buffer, 0, cpu.buffer, cpu.byteOffset, cpu.byteLength);
    },
  };
}

// ---------------------------------------------------------------------------
// Simulation resources (GPU growth)
//
// Segment (48 B), matching shaders/branch.wgsl and shaders/growth.wgsl:
//   offset  0  pos    vec3<f32>
//   offset 12  length f32
//   offset 16  ori    vec4<f32>   (quat rotating +Y to segment direction)
//   offset 32  radius f32
//   offset 36  depth  f32
//   offset 40  flags  u32         (bit0=TIP, bit1=ALIVE)
//   offset 44  age    u32         (tick of creation)
//
// Counter: atomic<u32> at buffer offset 0. Stored as the next free slot
// (== number of currently-allocated segments).
// ---------------------------------------------------------------------------

const SEGMENT_BYTES = 48;
const TIP_BIT = 1;
const ALIVE_BIT = 2;

const GENOME = {
  branchAngle: 0.55,
  branchProb: 0.78,
  lenScale: 0.85,
  radScale: 0.78,
  maxDepth: 6,
  growthBias: 1.0,
};

function createSimResources(device, maxSegs) {
  const segments = device.createBuffer({
    label: 'segments',
    size: maxSegs * SEGMENT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  {
    // mappedAtCreation guarantees zeroed initial contents; write the seed.
    const range = segments.getMappedRange();
    const f = new Float32Array(range);
    const u = new Uint32Array(range);
    // Segment 0: trunk seed at origin pointing +Y.
    f[0] = 0; f[1] = 0; f[2] = 0;     // pos
    f[3] = 0.85;                       // length
    f[4] = 0; f[5] = 0; f[6] = 0; f[7] = 1.0;  // identity quat (+Y -> +Y)
    f[8] = 0.16;                       // radius
    f[9] = 0;                          // depth
    u[10] = TIP_BIT | ALIVE_BIT;       // flags
    u[11] = 0;                         // age (eligible to grow on tick >= 1)
    segments.unmap();
  }

  const counter = device.createBuffer({
    label: 'counter',
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  new Uint32Array(counter.getMappedRange()).set([1, 0, 0, 0]);
  counter.unmap();

  // SimParams: tick, maxSegs, rngSeed, pad.
  const simBuffer = device.createBuffer({
    label: 'sim-params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const simCpu = new Uint32Array(4);
  simCpu[0] = 0;
  simCpu[1] = maxSegs;
  simCpu[2] = CONFIG.sim.rngSeed;
  simCpu[3] = 0;
  device.queue.writeBuffer(simBuffer, 0, simCpu);

  // Genome (32 B, 8 floats).
  const genomeBuffer = device.createBuffer({
    label: 'genome',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  const gf = new Float32Array(genomeBuffer.getMappedRange());
  gf[0] = GENOME.branchAngle;
  gf[1] = GENOME.branchProb;
  gf[2] = GENOME.lenScale;
  gf[3] = GENOME.radScale;
  gf[4] = GENOME.maxDepth;
  gf[5] = GENOME.growthBias;
  genomeBuffer.unmap();

  return { segments, counter, simBuffer, simCpu, genomeBuffer };
}

function createGrowthPipeline(device, module) {
  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: 'growth',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    compute: { module, entryPoint: 'grow' },
  });
  return { pipeline, bindGroupLayout: bgl };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const VERTS_PER_CYLINDER = 48;

function createBranchRenderer(ctx, frame, module, segmentsBuffer, maxSegs) {
  const { device, format } = ctx;

  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'branches',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: [
      { binding: 0, resource: { buffer: frame.buffer } },
      { binding: 1, resource: { buffer: segmentsBuffer } },
    ],
  });

  return {
    draw(pass) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(VERTS_PER_CYLINDER, maxSegs, 0, 0);
    },
  };
}

function createFullscreenRenderer(ctx, frame, module, label, opts) {
  const { device, format } = ctx;
  const bgl = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
  });
  const pipeline = device.createRenderPipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: opts.cull },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: opts.depthWrite,
      depthCompare: opts.depthCompare,
    },
  });
  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: [{ binding: 0, resource: { buffer: frame.buffer } }],
  });
  return {
    draw(pass) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(opts.vertexCount, 1, 0, 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Debug capture
// ---------------------------------------------------------------------------

const errorLog = [];
window.addEventListener('error', (e) => {
  errorLog.push(`[error] ${e.message} @ ${e.filename || '?'}:${e.lineno || '?'}`);
});
window.addEventListener('unhandledrejection', (e) => {
  errorLog.push(`[promise] ${e.reason && e.reason.message ? e.reason.message : String(e.reason)}`);
});

const debugState = {
  version: 'v0.2.4',
  ctx: null,
  fps: null,
  simTick: 0,
  counters: null,  // { next, dispatched, liveTips, maxIdx }
  startTime: Date.now(),
  initError: null,
  shaderMessages: {},   // { branch: [...], sky: [...], ground: [...], growth: [...] }
  gpuScopeErrors: [],    // each: `[label] message`
};

// Compile-a-shader-and-keep-its-messages helper. Stashes messages into
// debugState.shaderMessages[label] so the Copy debug dump shows them.
async function compileShader(device, code, label) {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ code, label });
  const createErr = await device.popErrorScope();
  const msgs = [];
  if (createErr) msgs.push(`create: ${createErr.message}`);
  try {
    const info = await module.getCompilationInfo();
    for (const m of info.messages) {
      msgs.push(`${m.type}: ${m.message} @ ${m.lineNum}:${m.linePos}`);
    }
  } catch (e) {
    msgs.push(`getCompilationInfo failed: ${e}`);
  }
  debugState.shaderMessages[label] = msgs;
  if (createErr || msgs.some(m => m.startsWith('error'))) {
    errorLog.push(`[shader:${label}] ${msgs.join(' | ') || 'unknown failure'}`);
  }
  return module;
}

// Run a sync GPU-creation function inside a validation error scope so any
// failure lands in debugState.gpuScopeErrors instead of disappearing.
async function withScope(device, label, fn) {
  device.pushErrorScope('validation');
  const out = fn();
  const err = await device.popErrorScope();
  if (err) {
    const line = `[${label}] ${err.message}`;
    debugState.gpuScopeErrors.push(line);
    errorLog.push(`[gpu:${label}] ${err.message}`);
    console.error(`GPU validation error in ${label}:`, err.message);
  }
  return out;
}

function buildDebugText() {
  const s = debugState;
  const ctx = s.ctx;
  const lines = [
    `Plant Sim debug — ${new Date().toISOString()}`,
    `version: ${s.version}`,
    `elapsed: ${((Date.now() - s.startTime) / 1000).toFixed(1)} s`,
    `userAgent: ${navigator.userAgent}`,
    `viewport: ${window.innerWidth}x${window.innerHeight} @ DPR ${window.devicePixelRatio}`,
    `webgpu.available: ${!!navigator.gpu}`,
  ];
  if (s.initError) {
    lines.push(`initError: ${s.initError}`);
  }
  if (ctx) {
    lines.push(`canvas: ${ctx.width}x${ctx.height}`);
    lines.push(`format: ${ctx.format}`);
    lines.push(`adapterInfo: ${JSON.stringify(ctx.adapterInfo)}`);
    lines.push(`features: ${JSON.stringify(ctx.features)}`);
    lines.push(`limits: ${JSON.stringify(ctx.limits)}`);
    if (ctx.deviceLostInfo) {
      lines.push(`deviceLost: ${ctx.deviceLostInfo.reason || '?'} — ${ctx.deviceLostInfo.message || ''}`);
    }
  }
  lines.push(`fps: ${s.fps == null ? '--' : s.fps.toFixed(1)}`);
  lines.push(`simTick: ${s.simTick}`);
  const c = s.counters;
  if (c) {
    lines.push(`counters.next:       ${c.next}   (segment count; should grow)`);
    lines.push(`counters.dispatched: ${c.dispatched}  (thread-0 bump; should == simTick once kernel runs)`);
    lines.push(`counters.liveTips:   ${c.liveTips}  (threads past alive+tip+age gate; should be >0 after first tick)`);
    lines.push(`counters.maxIdx:     ${c.maxIdx}  (largest sim.tick seen by kernel)`);
  } else {
    lines.push(`counters: --`);
  }
  // Shader compilation messages (warnings + errors).
  const sm = s.shaderMessages || {};
  const smKeys = Object.keys(sm);
  if (smKeys.length) {
    lines.push(`shaderMessages:`);
    for (const k of smKeys) {
      if (sm[k].length === 0) {
        lines.push(`  ${k}: (none)`);
      } else {
        lines.push(`  ${k}:`);
        for (const m of sm[k]) lines.push(`    ${m}`);
      }
    }
  }
  if (s.gpuScopeErrors && s.gpuScopeErrors.length) {
    lines.push(`gpuScopeErrors:`);
    for (const e of s.gpuScopeErrors) lines.push(`  ${e}`);
  }
  lines.push(`errors:${errorLog.length ? '\n  ' + errorLog.join('\n  ') : ' (none)'}`);
  return lines.join('\n');
}

function showFallback(text) {
  const el = document.getElementById('fallback');
  const ta = document.getElementById('fallback-text');
  ta.value = text;
  el.style.display = 'flex';
  // Auto-select for one-tap copy on iOS.
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
}

function installCopyButton() {
  const copyBtn = document.getElementById('copy');
  copyBtn.addEventListener('click', async () => {
    const text = buildDebugText();
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (_) { /* fall through to manual select */ }
    if (ok) {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('ok');
      setTimeout(() => {
        copyBtn.textContent = 'Copy debug';
        copyBtn.classList.remove('ok');
      }, 1600);
    } else {
      showFallback(text);
    }
  });
  document.getElementById('fallback-close').addEventListener('click', () => {
    document.getElementById('fallback').style.display = 'none';
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  installCopyButton();

  const canvas = document.getElementById('c');
  const fpsEl = document.getElementById('fps');
  const tickEl = document.getElementById('tick');
  const segsEl = document.getElementById('segs');
  const dispEl = document.getElementById('disp');
  const liveEl = document.getElementById('live');
  const errEl = document.getElementById('err');
  const errInner = errEl.querySelector('.inner');

  try {
    const [branchCode, skyCode, groundCode, growthCode] = await Promise.all([
      loadShader('branch'),
      loadShader('sky'),
      loadShader('ground'),
      loadShader('growth'),
    ]);

    const ctx = await initContext(canvas);
    debugState.ctx = ctx;
    const camera = createCamera(canvas);
    camera.setAspect(ctx.width / Math.max(1, ctx.height));
    ctx.onResize((w, h) => camera.setAspect(w / Math.max(1, h)));

    const frame = createFrameUniforms(ctx.device);

    const sim = createSimResources(ctx.device, CONFIG.sim.maxSegs);

    // Compile each shader module under its own error scope so any compilation
    // problem lands in debugState.shaderMessages[label] (and the error log)
    // rather than disappearing silently.
    const [branchModule, skyModule, groundModule, growthModule] = await Promise.all([
      compileShader(ctx.device, branchCode, 'branch'),
      compileShader(ctx.device, skyCode, 'sky'),
      compileShader(ctx.device, groundCode, 'ground'),
      compileShader(ctx.device, growthCode, 'growth'),
    ]);

    const growth = await withScope(ctx.device, 'growth-pipeline',
      () => createGrowthPipeline(ctx.device, growthModule));
    const growthBindGroup = await withScope(ctx.device, 'growth-bindgroup',
      () => ctx.device.createBindGroup({
        layout: growth.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: sim.segments } },
          { binding: 1, resource: { buffer: sim.counter } },
          { binding: 2, resource: { buffer: sim.simBuffer } },
          { binding: 3, resource: { buffer: sim.genomeBuffer } },
        ],
      }));
    const growthDispatchCount = Math.ceil(CONFIG.sim.maxSegs / CONFIG.sim.workgroupSize);

    const branches = await withScope(ctx.device, 'branch-renderer',
      () => createBranchRenderer(ctx, frame, branchModule, sim.segments, CONFIG.sim.maxSegs));
    const sky = await withScope(ctx.device, 'sky-renderer',
      () => createFullscreenRenderer(ctx, frame, skyModule, 'sky', {
        vertexCount: 3, cull: 'none', depthWrite: false, depthCompare: 'less-equal',
      }));
    const ground = await withScope(ctx.device, 'ground-renderer',
      () => createFullscreenRenderer(ctx, frame, groundModule, 'ground', {
        vertexCount: 6, cull: 'none', depthWrite: true, depthCompare: 'less',
      }));

    let lastTime = performance.now();
    let frameCount = 0;
    let fpsAccum = 0;
    let fpsTimer = 0;

    let firstTickValidated = false;
    let simTick = 0;
    let simAccum = 0;
    let elapsed = 0;
    const tickPeriod = 1 / CONFIG.sim.simHz;

    // Counter readback (debug HUD): copy the GPU counter into a CPU-mappable
    // staging buffer, then mapAsync. Single-slot, so skip if a previous
    // readback is still in flight.
    const stagingBuffer = ctx.device.createBuffer({
      label: 'counter-readback',
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    let readbackBusy = false;
    let lastReadback = 0;
    async function queueCounterReadback() {
      if (readbackBusy) return;
      readbackBusy = true;
      try {
        const e = ctx.device.createCommandEncoder({ label: 'counter-copy' });
        e.copyBufferToBuffer(sim.counter, 0, stagingBuffer, 0, 16);
        ctx.device.queue.submit([e.finish()]);
        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const u = new Uint32Array(stagingBuffer.getMappedRange());
        const c = { next: u[0], dispatched: u[1], liveTips: u[2], maxIdx: u[3] };
        stagingBuffer.unmap();
        segsEl.textContent = String(c.next);
        dispEl.textContent = String(c.dispatched);
        liveEl.textContent = String(c.liveTips);
        debugState.counters = c;
      } catch (err) {
        console.error('counter readback failed', err);
        segsEl.textContent = 'err';
        dispEl.textContent = 'err';
        liveEl.textContent = 'err';
        debugState.counters = { error: err && err.message ? err.message : String(err) };
      } finally {
        readbackBusy = false;
      }
    }

    function loop(now) {
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      elapsed += dt;
      frameCount++;
      fpsAccum += dt;
      fpsTimer += dt;
      if (fpsTimer >= 0.5) {
        const fps = frameCount / fpsAccum;
        fpsEl.textContent = fps.toFixed(0);
        debugState.fps = fps;
        frameCount = 0;
        fpsAccum = 0;
        fpsTimer = 0;
      }

      camera.update(dt);
      frame.update({
        view: camera.view,
        proj: camera.proj,
        cameraPos: camera.position,
        time: now / 1000,
        sunDir: CONFIG.sun.direction,
        sunColor: CONFIG.sun.color,
        ambient: CONFIG.sun.ambient,
        width: ctx.width,
        height: ctx.height,
      });
      frame.upload(ctx.device.queue);

      // Accumulate sim time and queue at most one growth tick per frame; the
      // simulation deliberately lags behind real-time when tickRate < frameRate
      // so growth stays visible.
      let runTick = false;
      if (elapsed > CONFIG.sim.startDelay) {
        simAccum += dt;
        if (simAccum >= tickPeriod) {
          simAccum -= tickPeriod;
          simTick++;
          sim.simCpu[0] = simTick;
          ctx.device.queue.writeBuffer(sim.simBuffer, 0, sim.simCpu);
          runTick = true;
          tickEl.textContent = String(simTick);
          debugState.simTick = simTick;
        }
      }

      // Async readback of the segment counter every ~500 ms so the HUD
      // shows whether growth is actually appending segments on the GPU.
      if (now - lastReadback > 500) {
        lastReadback = now;
        queueCounterReadback();
      }

      // Wrap the very first compute dispatch + render in a validation scope
      // so anything WebGPU silently rejects there lands in gpuScopeErrors.
      const scopeFirstTick = runTick && !firstTickValidated;
      if (scopeFirstTick) ctx.device.pushErrorScope('validation');

      const encoder = ctx.device.createCommandEncoder();

      if (runTick) {
        const cpass = encoder.beginComputePass({ label: 'growth' });
        cpass.setPipeline(growth.pipeline);
        cpass.setBindGroup(0, growthBindGroup);
        cpass.dispatchWorkgroups(growthDispatchCount);
        cpass.end();
      }

      const view = ctx.context.getCurrentTexture().createView();
      const rpass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0.05, g: 0.08, b: 0.06, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: ctx.depthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      sky.draw(rpass);
      ground.draw(rpass);
      branches.draw(rpass);
      rpass.end();
      ctx.device.queue.submit([encoder.finish()]);

      if (scopeFirstTick) {
        firstTickValidated = true;
        ctx.device.popErrorScope().then((err) => {
          if (err) {
            const line = `[first-tick-frame] ${err.message}`;
            debugState.gpuScopeErrors.push(line);
            errorLog.push(`[gpu:first-tick] ${err.message}`);
            console.error('GPU validation error during first tick frame:', err.message);
          }
        });
      }

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    debugState.initError = msg;
    errorLog.push(`[init] ${msg}`);
    errEl.style.display = 'flex';
    errInner.innerHTML = `WebGPU initialization failed.<code>${escapeHtml(msg)}</code>`;
    console.error(e);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

main();
