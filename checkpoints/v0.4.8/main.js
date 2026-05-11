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
  farPlane: 350,
  fovYDeg: 55,
  camera: {
    initialYaw: -0.6,
    initialPitch: 0.45,
    initialDistance: 55,
    minPitch: -0.2,
    maxPitch: 1.4,
    minDistance: 2,
    maxDistance: 220,
    target: [0, 2.5, 0],
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
    maxPlants: 256,        // 16×16 grid
    segsPerPlant: 128,     // each plant's pre-reserved slot range
    get maxSegs() { return this.maxPlants * this.segsPerPlant; },
    rngSeed: 0xC0FFEE,
    workgroupSize: 64,
    startDelay: 0.6,
    gridSpacing: 3.5,      // metres between plant centres
    gridJitter: 1.2,       // additional random offset
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

// Column-major mat4 * vec4 helper for CPU-side picking math.
function applyMat4Vec4(m, x, y, z, w) {
  return [
    m[0] * x + m[4] * y + m[8]  * z + m[12] * w,
    m[1] * x + m[5] * y + m[9]  * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Day cycle: sun arcs east → zenith → west, dips below horizon for night,
// loops every CONFIG.sky.dayLength seconds. Sun colour, ambient and the
// implicit sky palette in sky.wgsl all respond to elevation.
function computeSky(t) {
  const dayLength = 240;          // seconds for one full day arc; no night
  const cyclePos = (t / dayLength) - Math.floor(t / dayLength);   // 0..1

  // Pure day arc: phase 0 → π means sun rises in the east, climbs to
  // zenith, sets in the west. At cyclePos == 1 we wrap back to dawn in
  // the east. There's no negative-elevation half — night is removed.
  const phase = cyclePos * Math.PI;
  const sinP = Math.sin(phase);
  const cosP = -Math.cos(phase);    // -1 at sunrise (east), +1 at sunset (west)

  const sunDir = [cosP * 0.78, sinP, Math.sin(cyclePos * Math.PI * 2 * 0.62) * 0.32];

  const elevation = Math.max(0.02, sinP);   // tiny floor so dawn/dusk still has *some* light
  const falloff = Math.pow(elevation, 0.45);
  const warmth = 1 - Math.min(1, elevation * 1.6);

  const sunColor = [
    falloff * (1.05 + warmth * 0.25),
    falloff * (0.92 - warmth * 0.08),
    falloff * (0.75 - warmth * 0.45),
  ];

  // Cool ambient at dawn/dusk, warmer + brighter at noon.
  const ambient = [
    0.06 + falloff * 0.22,
    0.08 + falloff * 0.24,
    0.11 + falloff * 0.20,
  ];

  return { sunDir, sunColor, ambient, elevation, phase };
}

// Deterministic [0, 1) hash from a u32 seed. Useful for one-off jitter
// without needing a stateful RNG.
function mulberry32_one(seed) {
  let s = (seed | 0) >>> 0;
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
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
  leafShape: 0,  // 0=oval, 1=round, 2=lance, 3=lobed, 4=heart
};

const LEAF_SHAPE_NAMES = ['oval', 'round', 'lance', 'lobed', 'heart'];

function createSimResources(device, maxPlants, segsPerPlant) {
  const maxSegs = maxPlants * segsPerPlant;

  // Generate per-plant genomes first; seed sizes are read from them.
  const cpuGenomes = [];
  const cpuPlantPositions = [];   // {x, z} world-space; mirror of seed pos for evolution
  const cpuPlantBirthTick = [];   // sim tick at which this plant was last (re)planted
  for (let p = 0; p < maxPlants; p++) {
    cpuGenomes.push(makeGenome(CONFIG.sim.rngSeed, p));
    cpuPlantBirthTick.push(0);
    cpuPlantPositions.push({ x: 0, z: 0 });
  }

  // Each plant gets `segsPerPlant` contiguous slots; its seed lives at the
  // first slot of that range. Position is grid + hash-driven jitter.
  const segments = device.createBuffer({
    label: 'segments',
    size: maxSegs * SEGMENT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  {
    const range = segments.getMappedRange();
    const f = new Float32Array(range);
    const u = new Uint32Array(range);
    const cols = Math.ceil(Math.sqrt(maxPlants));
    const spacing = CONFIG.sim.gridSpacing;
    const jitter = CONFIG.sim.gridJitter;
    const seed = CONFIG.sim.rngSeed;
    for (let p = 0; p < maxPlants; p++) {
      const slot = p * segsPerPlant;
      const off = slot * 12;
      const g = cpuGenomes[p];

      const gx = (p % cols) - (cols - 1) / 2;
      const gz = Math.floor(p / cols) - (cols - 1) / 2;
      const h1 = mulberry32_one(seed ^ (p * 0x9E37));
      const h2 = mulberry32_one(seed ^ (p * 0x85EB));
      const wx = gx * spacing + (h1 - 0.5) * jitter * 2;
      const wz = gz * spacing + (h2 - 0.5) * jitter * 2;
      cpuPlantPositions[p].x = wx;
      cpuPlantPositions[p].z = wz;

      f[off + 0] = wx;
      f[off + 1] = 0;
      f[off + 2] = wz;
      f[off + 3] = g.seedLength;       // per-plant trunk length
      f[off + 4] = 0;
      f[off + 5] = 0;
      f[off + 6] = 0;
      f[off + 7] = 1.0;                // identity quat
      f[off + 8] = g.seedRadius;       // per-plant trunk thickness
      f[off + 9] = 0;                  // depth
      u[off + 10] = TIP_BIT | ALIVE_BIT;
      u[off + 11] = 0;                 // age
    }
    segments.unmap();
  }

  // Counter buffer: 16 B header + maxPlants × 4 B per-plant atomics.
  const counterHeaderBytes = 16;
  const counterBytes = counterHeaderBytes + maxPlants * 4;
  const counter = device.createBuffer({
    label: 'counter',
    size: counterBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  });
  {
    const u = new Uint32Array(counter.getMappedRange());
    u[0] = maxPlants;     // totalSegs = N seeds
    u[1] = 0;             // dispatched
    u[2] = 0;             // liveTips
    u[3] = 0;             // maxIdx
    for (let p = 0; p < maxPlants; p++) {
      u[4 + p] = 1;        // each plant has used 1 slot (its seed)
    }
    counter.unmap();
  }

  // SimParams: tick, maxSegs, rngSeed, segsPerPlant.
  const simBuffer = device.createBuffer({
    label: 'sim-params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const simCpu = new Uint32Array(4);
  simCpu[0] = 0;
  simCpu[1] = maxSegs;
  simCpu[2] = CONFIG.sim.rngSeed;
  simCpu[3] = segsPerPlant;
  device.queue.writeBuffer(simBuffer, 0, simCpu);

  // Genomes — one per plant (32 B each, 8 f32). Lives in a storage buffer
  // so both growth.wgsl and leaf.wgsl can index by plantIdx. cpuGenomes was
  // built at the top of this function so the seed segments could use the
  // per-plant seedLength/seedRadius CPU-only fields.
  const genomeBytes = maxPlants * 48;
  const genomeBuffer = device.createBuffer({
    label: 'genomes',
    size: genomeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  {
    const gf = new Float32Array(genomeBuffer.getMappedRange());
    for (let p = 0; p < maxPlants; p++) writeGenome(gf, p, cpuGenomes[p]);
    genomeBuffer.unmap();
  }

  // Top-down light grid: 256×256 u32 atomics. Cleared + splatted every frame
  // by light.wgsl and read by ground.wgsl.
  const LIGHT_GRID_CELLS = 256 * 256;
  const lightGridBuffer = device.createBuffer({
    label: 'lightGrid',
    size: LIGHT_GRID_CELLS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // Per-plant captured-light accumulator. light.capture atomicAdds into this
  // every frame; CPU readbacks copy it into measuredLight for evolution.
  const plantLightBuffer = device.createBuffer({
    label: 'plantLight',
    size: maxPlants * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const measuredLight = new Uint32Array(maxPlants);   // CPU mirror, updated by readback

  return {
    segments, counter, simBuffer, simCpu, genomeBuffer, lightGridBuffer,
    plantLightBuffer, measuredLight,
    cpuGenomes, cpuPlantPositions, cpuPlantBirthTick,
    maxPlants, segsPerPlant,
    lightGridCells: LIGHT_GRID_CELLS,
  };
}

// CPU-side per-plant genome.
// Plant types and their share of the initial population.
const PLANT_TYPE_NAMES = ['tree', 'bush', 'grass', 'flower'];
const PLANT_TYPE_WEIGHTS = [0.30, 0.25, 0.35, 0.10];

// Single source of truth for per-type parameter ranges. Used by both the
// initial random spawn (`rollByType`) and `mutateGenome` clamps, so a
// "grass" can never mutate into a 10 m blade by accident.
function typeBounds(t) {
  if (t === 1) {       // bush
    return {
      branchAngle: [0.55, 1.30],
      branchProb:  [0.70, 0.97],
      lenScale:    [0.50, 0.72],
      radScale:    [0.45, 0.72],
      maxDepth:    [4, 6],
      growthBias:  [-0.20, 1.00],
      seedLength:  [0.25, 0.80],
      seedRadius:  [0.06, 0.16],
    };
  }
  if (t === 2) {       // grass
    return {
      branchAngle: [0.02, 0.18],
      branchProb:  [0.00, 0.08],
      lenScale:    [0.65, 0.82],
      radScale:    [0.40, 0.65],
      maxDepth:    [3, 5],
      growthBias:  [0.50, 1.50],
      seedLength:  [0.10, 0.28],
      seedRadius:  [0.010, 0.028],
    };
  }
  if (t === 3) {       // flower
    return {
      branchAngle: [0.20, 0.55],
      branchProb:  [0.10, 0.45],
      lenScale:    [0.50, 0.72],
      radScale:    [0.40, 0.65],
      maxDepth:    [3, 4],
      growthBias:  [0.50, 1.55],
      seedLength:  [0.15, 0.45],
      seedRadius:  [0.025, 0.070],
    };
  }
  // tree
  return {
    branchAngle: [0.25, 1.05],
    branchProb:  [0.50, 0.95],
    lenScale:    [0.72, 0.93],
    radScale:    [0.55, 0.86],
    maxDepth:    [5, 8],
    growthBias:  [-0.20, 1.40],
    seedLength:  [0.60, 1.40],
    seedRadius:  [0.10, 0.26],
  };
}

function rollByType(plantType, rand) {
  const b = typeBounds(plantType);
  const span = (r) => r[0] + rand() * (r[1] - r[0]);
  return {
    branchAngle: span(b.branchAngle),
    branchProb:  span(b.branchProb),
    lenScale:    span(b.lenScale),
    radScale:    span(b.radScale),
    maxDepth:    b.maxDepth[0] + Math.floor(rand() * (b.maxDepth[1] - b.maxDepth[0] + 1)),
    growthBias:  span(b.growthBias),
    seedLength:  span(b.seedLength),
    seedRadius:  span(b.seedRadius),
  };
}

function pickPlantType(rand) {
  let r = rand();
  for (let i = 0; i < PLANT_TYPE_WEIGHTS.length; i++) {
    r -= PLANT_TYPE_WEIGHTS[i];
    if (r <= 0) return i;
  }
  return PLANT_TYPE_WEIGHTS.length - 1;
}

function makeGenome(seedBase, plantIdx) {
  let s = ((seedBase ^ (plantIdx * 0x9E3779B1)) >>> 0) || 1;
  const rand = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
  const plantType = pickPlantType(rand);
  const p = rollByType(plantType, rand);
  return {
    ...p,
    leafShape: Math.floor(rand() * 5),
    barkHue:   rand(),
    plantType,
    flowerHue: rand(),
  };
}

function writeGenome(gf, plantIdx, g) {
  const off = plantIdx * 12;
  gf[off + 0]  = g.branchAngle;
  gf[off + 1]  = g.branchProb;
  gf[off + 2]  = g.lenScale;
  gf[off + 3]  = g.radScale;
  gf[off + 4]  = g.maxDepth;
  gf[off + 5]  = g.growthBias;
  gf[off + 6]  = g.leafShape;
  gf[off + 7]  = g.barkHue;
  gf[off + 8]  = g.plantType;
  gf[off + 9]  = g.flowerHue;
  gf[off + 10] = 0;
  gf[off + 11] = 0;
}

// Inherit from a parent with small random jitter per gene. Plant type jumps
// rarely; when it does, the whole shape is re-rolled from the new type's
// bounds but leafShape/barkHue/flowerHue carry over so the lineage stays
// visually related. Non-type-jump mutations are clamped to the current
// type's bounds — that's why grass can no longer end up tree-sized.
function mutateGenome(parent) {
  const clampRange = (v, r) => Math.max(r[0], Math.min(r[1], v));
  const jitter = (val, amp) => val + (Math.random() - 0.5) * amp;
  const stepInt = () => (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0);

  let plantType = parent.plantType;
  if (Math.random() < 0.04) plantType = (parent.plantType + 1 + Math.floor(Math.random() * 3)) % 4;

  if (plantType !== parent.plantType) {
    const p = rollByType(plantType, Math.random);
    return {
      ...p,
      leafShape: parent.leafShape,
      barkHue:   parent.barkHue,
      plantType,
      flowerHue: parent.flowerHue,
    };
  }

  const b = typeBounds(plantType);
  return {
    branchAngle: clampRange(jitter(parent.branchAngle, 0.12), b.branchAngle),
    branchProb:  clampRange(jitter(parent.branchProb,  0.08), b.branchProb),
    lenScale:    clampRange(jitter(parent.lenScale,    0.05), b.lenScale),
    radScale:    clampRange(jitter(parent.radScale,    0.05), b.radScale),
    maxDepth:    clampRange(parent.maxDepth + stepInt(), b.maxDepth),
    growthBias:  clampRange(jitter(parent.growthBias,  0.25), b.growthBias),
    leafShape:   Math.random() < 0.08
                   ? Math.floor(Math.random() * 5)
                   : parent.leafShape,
    barkHue:     clampRange(jitter(parent.barkHue,     0.06), [0, 1]),
    plantType,
    flowerHue:   clampRange(jitter(parent.flowerHue,   0.08), [0, 1]),
    seedLength:  clampRange(jitter(parent.seedLength,  0.07), b.seedLength),
    seedRadius:  clampRange(jitter(parent.seedRadius,  0.015), b.seedRadius),
  };
}

function createGrowthPipeline(device, module) {
  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
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
const VERTS_PER_LEAF = 6;
const LEAVES_PER_SEG = 3;

function createLeafRenderer(ctx, frame, module, segmentsBuffer, genomeBuffer, simBuffer, lightGridBuffer, maxSegs) {
  const { device, format } = ctx;
  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'leaves',
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
      { binding: 2, resource: { buffer: genomeBuffer } },
      { binding: 3, resource: { buffer: simBuffer } },
      { binding: 4, resource: { buffer: lightGridBuffer } },
    ],
  });
  const instanceCount = maxSegs * LEAVES_PER_SEG;
  return {
    draw(pass) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(VERTS_PER_LEAF, instanceCount, 0, 0);
    },
  };
}

function createBranchRenderer(ctx, frame, module, segmentsBuffer, genomeBuffer, simBuffer, lightGridBuffer, maxSegs) {
  const { device, format } = ctx;

  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
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
      { binding: 2, resource: { buffer: genomeBuffer } },
      { binding: 3, resource: { buffer: simBuffer } },
      { binding: 4, resource: { buffer: lightGridBuffer } },
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

function createGroundRenderer(ctx, frame, module, lightGridBuffer) {
  const { device, format } = ctx;
  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'ground',
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
      { binding: 1, resource: { buffer: lightGridBuffer } },
    ],
  });
  return {
    draw(pass) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6, 1, 0, 0);
    },
  };
}

function createLightPipelines(device, module, lightGridBuffer, segmentsBuffer, simBuffer, plantLightBuffer) {
  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const clearPipeline = device.createComputePipeline({
    label: 'light-clear',
    layout,
    compute: { module, entryPoint: 'clear' },
  });
  const splatPipeline = device.createComputePipeline({
    label: 'light-splat',
    layout,
    compute: { module, entryPoint: 'splat' },
  });
  const capturePipeline = device.createComputePipeline({
    label: 'light-capture',
    layout,
    compute: { module, entryPoint: 'capture' },
  });
  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: [
      { binding: 0, resource: { buffer: lightGridBuffer } },
      { binding: 1, resource: { buffer: segmentsBuffer } },
      { binding: 2, resource: { buffer: simBuffer } },
      { binding: 3, resource: { buffer: plantLightBuffer } },
    ],
  });
  return { clearPipeline, splatPipeline, capturePipeline, bindGroup };
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
  version: 'v0.4.8',
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
  if (s.timeScale != null) lines.push(`timeScale: ${s.timeScale.toFixed(2)}`);
  lines.push(`simTick: ${s.simTick}`);
  if (s.births != null) lines.push(`births: ${s.births}  (mutated offspring planted so far)`);
  if (s.totalLight != null) lines.push(`totalLight: ${s.totalLight}  (sum of per-plant captured sun, last readback)`);
  const c = s.counters;
  if (c) {
    lines.push(`counters.totalSegs:  ${c.totalSegs}  (aggregate segment count across all plants)`);
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
    const [branchCode, leafCode, skyCode, groundCode, growthCode, lightCode] = await Promise.all([
      loadShader('branch'),
      loadShader('leaf'),
      loadShader('sky'),
      loadShader('ground'),
      loadShader('growth'),
      loadShader('light'),
    ]);

    const ctx = await initContext(canvas);
    debugState.ctx = ctx;
    const camera = createCamera(canvas);
    camera.setAspect(ctx.width / Math.max(1, ctx.height));
    ctx.onResize((w, h) => camera.setAspect(w / Math.max(1, h)));

    const frame = createFrameUniforms(ctx.device);

    const sim = createSimResources(ctx.device, CONFIG.sim.maxPlants, CONFIG.sim.segsPerPlant);

    // Compile each shader module under its own error scope so any compilation
    // problem lands in debugState.shaderMessages[label] (and the error log)
    // rather than disappearing silently.
    const [branchModule, leafModule, skyModule, groundModule, growthModule, lightModule] = await Promise.all([
      compileShader(ctx.device, branchCode, 'branch'),
      compileShader(ctx.device, leafCode, 'leaf'),
      compileShader(ctx.device, skyCode, 'sky'),
      compileShader(ctx.device, groundCode, 'ground'),
      compileShader(ctx.device, growthCode, 'growth'),
      compileShader(ctx.device, lightCode, 'light'),
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

    const light = await withScope(ctx.device, 'light-pipelines',
      () => createLightPipelines(ctx.device, lightModule, sim.lightGridBuffer, sim.segments, sim.simBuffer, sim.plantLightBuffer));
    const lightClearDispatch = Math.ceil(sim.lightGridCells / 64);
    const lightSplatDispatch = Math.ceil(CONFIG.sim.maxSegs / 64);

    const branches = await withScope(ctx.device, 'branch-renderer',
      () => createBranchRenderer(ctx, frame, branchModule, sim.segments, sim.genomeBuffer, sim.simBuffer, sim.lightGridBuffer, CONFIG.sim.maxSegs));
    const leaves = await withScope(ctx.device, 'leaf-renderer',
      () => createLeafRenderer(ctx, frame, leafModule, sim.segments, sim.genomeBuffer, sim.simBuffer, sim.lightGridBuffer, CONFIG.sim.maxSegs));
    const sky = await withScope(ctx.device, 'sky-renderer',
      () => createFullscreenRenderer(ctx, frame, skyModule, 'sky', {
        vertexCount: 3, cull: 'none', depthWrite: false, depthCompare: 'less-equal',
      }));
    const ground = await withScope(ctx.device, 'ground-renderer',
      () => createGroundRenderer(ctx, frame, groundModule, sim.lightGridBuffer));

    // Leaf-shape cycle button. State 'varied' restores each plant's own
    // genome.leafShape; the named states override every plant with the same
    // shape, useful for spotting one species against the field.
    const leafShapeBtn = document.getElementById('leaf-shape');
    const leafCycleStates = ['varied', ...LEAF_SHAPE_NAMES];
    const leafBuf = new Float32Array(CONFIG.sim.maxPlants * 12);
    let leafCycleIdx = 0;

    function applyLeafState(stateIdx) {
      const state = leafCycleStates[stateIdx];
      for (let p = 0; p < CONFIG.sim.maxPlants; p++) {
        const g = sim.cpuGenomes[p];
        const overrideShape = state === 'varied' ? g.leafShape : (stateIdx - 1);
        writeGenome(leafBuf, p, { ...g, leafShape: overrideShape });
      }
      ctx.device.queue.writeBuffer(sim.genomeBuffer, 0, leafBuf);
      const label = state === 'varied' ? 'Leaf: varied ›' : `Leaf: ${state} ›`;
      leafShapeBtn.textContent = label;
      debugState.leafShape = state;
    }
    applyLeafState(leafCycleIdx);
    leafShapeBtn.addEventListener('click', () => {
      leafCycleIdx = (leafCycleIdx + 1) % leafCycleStates.length;
      applyLeafState(leafCycleIdx);
    });

    // ---- Sim-speed slider: scales the dt fed into the sim-tick accumulator,
    //      the evolution clock and the day-cycle. 0 = paused; render runs on.
    const speedSlider = document.getElementById('speed-slider');
    const speedLabelEl = document.getElementById('speed-label');
    let timeScale = parseFloat(speedSlider.value) || 1;
    function applySpeed() {
      timeScale = parseFloat(speedSlider.value);
      speedLabelEl.textContent = timeScale <= 0 ? 'paused' : `${timeScale.toFixed(1)}×`;
      debugState.timeScale = timeScale;
    }
    speedSlider.addEventListener('input', applySpeed);
    applySpeed();

    // ---- Tap-to-inspect a plant. CPU ray-vs-bounding-sphere against
    //      every plant; closest hit wins. Sphere is generous (radius 5 m,
    //      centred 4 m up) so canopy taps land on the right plant.
    const inspectEl = document.getElementById('inspect');
    const insTitle = document.getElementById('ins-title');
    const insBody = document.getElementById('ins-body');
    const insClose = document.getElementById('ins-close');
    let selectedPlantIdx = -1;
    function hideInspect() {
      inspectEl.hidden = true;
      selectedPlantIdx = -1;
    }
    function showInspect(idx) {
      selectedPlantIdx = idx;
      const g = sim.cpuGenomes[idx];
      const pos = sim.cpuPlantPositions[idx];
      const age = Math.max(0, simTick - sim.cpuPlantBirthTick[idx]);
      const light = sim.measuredLight[idx];
      const shapeName = LEAF_SHAPE_NAMES[Math.max(0, Math.min(LEAF_SHAPE_NAMES.length - 1, Math.round(g.leafShape)))];
      const typeName = PLANT_TYPE_NAMES[Math.max(0, Math.min(PLANT_TYPE_NAMES.length - 1, Math.round(g.plantType)))];
      insTitle.textContent = `Plant #${idx} — ${typeName} / ${shapeName}`;
      insBody.innerHTML = [
        ['type',        typeName],
        ['pos',         `${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`],
        ['age',         `${age} ticks`],
        ['light',       `${light}`],
        '<hr/>',
        ['branchAngle', `${g.branchAngle.toFixed(2)} rad`],
        ['branchProb',  g.branchProb.toFixed(2)],
        ['lenScale',    g.lenScale.toFixed(2)],
        ['radScale',    g.radScale.toFixed(2)],
        ['maxDepth',    g.maxDepth.toString()],
        ['growthBias',  g.growthBias.toFixed(2)],
        ['barkHue',     g.barkHue.toFixed(2)],
        ['flowerHue',   g.flowerHue.toFixed(2)],
        ['seedLen',     `${g.seedLength.toFixed(2)} m`],
        ['seedRad',     `${g.seedRadius.toFixed(2)} m`],
      ].map((r) => typeof r === 'string'
        ? r
        : `<div class="ins-row"><span class="ins-k">${r[0]}</span><span class="ins-v">${r[1]}</span></div>`,
      ).join('');
      inspectEl.hidden = false;
    }
    insClose.addEventListener('click', hideInspect);

    // Tap detection on the canvas. We track per-pointer down position +
    // time + total movement; a short, near-stationary press is a tap.
    const tapVP = new Float32Array(16);
    const tapInvVP = new Float32Array(16);
    function pickPlantAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);

      mat4Multiply(camera.proj, camera.view, tapVP);
      mat4Inverse(tapVP, tapInvVP);

      const near = applyMat4Vec4(tapInvVP, ndcX, ndcY, 0, 1);
      const far  = applyMat4Vec4(tapInvVP, ndcX, ndcY, 1, 1);
      const o = [near[0] / near[3], near[1] / near[3], near[2] / near[3]];
      const f = [far[0]  / far[3],  far[1]  / far[3],  far[2]  / far[3]];
      const dir = norm3([f[0] - o[0], f[1] - o[1], f[2] - o[2]]);

      const R = 5.0, R2 = R * R;
      let bestT = Infinity, bestIdx = -1;
      for (let i = 0; i < CONFIG.sim.maxPlants; i++) {
        const p = sim.cpuPlantPositions[i];
        const lx = p.x - o[0];
        const ly = 4 - o[1];
        const lz = p.z - o[2];
        const tca = lx * dir[0] + ly * dir[1] + lz * dir[2];
        if (tca < 0) continue;
        const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
        if (d2 > R2) continue;
        const t = tca - Math.sqrt(R2 - d2);
        if (t < bestT) { bestT = t; bestIdx = i; }
      }
      return bestIdx;
    }

    const taps = new Map();   // pointerId → { x, y, t, moved }
    canvas.addEventListener('pointerdown', (e) => {
      taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now(), moved: 0 });
    }, { capture: true });
    canvas.addEventListener('pointermove', (e) => {
      const s = taps.get(e.pointerId);
      if (!s) return;
      const d = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (d > s.moved) s.moved = d;
    }, { capture: true });
    function endTap(e) {
      const s = taps.get(e.pointerId);
      if (!s) return;
      const dt = Date.now() - s.t;
      taps.delete(e.pointerId);
      if (s.moved < 8 && dt < 350) {
        const idx = pickPlantAt(e.clientX, e.clientY);
        if (idx >= 0) showInspect(idx);
      }
    }
    canvas.addEventListener('pointerup', endTap, { capture: true });
    canvas.addEventListener('pointercancel', (e) => taps.delete(e.pointerId), { capture: true });

    let lastTime = performance.now();
    let frameCount = 0;
    let fpsAccum = 0;
    let fpsTimer = 0;

    let firstTickValidated = false;
    let simTick = 0;
    let simAccum = 0;
    let elapsed = 0;
    // simTime advances by `dt * timeScale` each frame; drives the day cycle
    // so sunrise/sunset speeds up alongside growth.
    let simTime = 0;
    const tickPeriod = 1 / CONFIG.sim.simHz;

    // ---- Evolution: replace mature plants with mutated offspring of the
    //      currently-best-looking parents. CPU-only logic; queue.writeBuffer
    //      patches the three GPU buffers that own the per-plant state.
    const EV = {
      startTick: 20,        // wait until everyone's first growth has settled
      retireAge: 25,        // ticks since (re)birth before a plant is replaceable
      perTick: 3,           // number of plants to replace each sim tick
      births: 0,
      // Reusable scratch storage so we don't allocate per replacement.
      zerosBuf: new ArrayBuffer(CONFIG.sim.segsPerPlant * SEGMENT_BYTES),
      segBuf: new ArrayBuffer(SEGMENT_BYTES),
      genomeBuf: new Float32Array(8),
      counterScratch: new Uint32Array([1]),
    };
    EV.segF = new Float32Array(EV.segBuf);
    EV.segU = new Uint32Array(EV.segBuf);

    function fitnessScore(plantIdx) {
      // Prefer GPU-measured captured-light when we've got a real readback;
      // fall back to the old genome-proxy until the first readback completes.
      const measured = sim.measuredLight[plantIdx];
      if (measured > 200) return measured;
      const g = sim.cpuGenomes[plantIdx];
      return g.seedLength * 1.8
           + g.maxDepth
           + Math.max(0, g.growthBias) * 0.8
           + g.lenScale * 1.5;
    }

    function pickWeighted(scores) {
      let total = 0;
      for (const s of scores) total += s;
      let pick = Math.random() * total;
      for (let i = 0; i < scores.length; i++) {
        pick -= scores[i];
        if (pick <= 0) return i;
      }
      return scores.length - 1;
    }

    function replacePlant(targetIdx, parentIdx, tick) {
      const newGenome = mutateGenome(sim.cpuGenomes[parentIdx]);
      sim.cpuGenomes[targetIdx] = newGenome;
      sim.cpuPlantBirthTick[targetIdx] = tick;

      // Position near parent, jittered.
      const p = sim.cpuPlantPositions[parentIdx];
      const dx = (Math.random() - 0.5) * 5.5;
      const dz = (Math.random() - 0.5) * 5.5;
      sim.cpuPlantPositions[targetIdx] = { x: p.x + dx, z: p.z + dz };
      const pos = sim.cpuPlantPositions[targetIdx];

      // 1. Update this plant's genome slot.
      writeGenome(EV.genomeBuf, 0, newGenome);
      ctx.device.queue.writeBuffer(sim.genomeBuffer, targetIdx * 32, EV.genomeBuf);

      // 2. Clear the whole segment range for this plant (segsPerPlant × 48 B).
      ctx.device.queue.writeBuffer(
        sim.segments,
        targetIdx * CONFIG.sim.segsPerPlant * SEGMENT_BYTES,
        EV.zerosBuf,
      );

      // 3. Write a fresh seed segment at slot 0 of that range.
      EV.segF.fill(0);
      EV.segF[0] = pos.x;
      EV.segF[2] = pos.z;
      EV.segF[3] = newGenome.seedLength;
      EV.segF[7] = 1.0;                          // identity quat.w
      EV.segF[8] = newGenome.seedRadius;
      EV.segU[10] = TIP_BIT | ALIVE_BIT;
      EV.segU[11] = 0;                           // age 0 → eligible next tick
      ctx.device.queue.writeBuffer(
        sim.segments,
        targetIdx * CONFIG.sim.segsPerPlant * SEGMENT_BYTES,
        EV.segBuf,
      );

      // 4. Reset this plant's next-free counter back to 1.
      ctx.device.queue.writeBuffer(
        sim.counter,
        16 + targetIdx * 4,
        EV.counterScratch,
      );

      EV.births++;
      debugState.births = EV.births;
    }

    function evolveStep(tick) {
      if (tick < EV.startTick) return;

      // Only mature plants participate. They're BOTH the eligible parents
      // (their genome has been tested by surviving long enough to capture
      // sun) AND the eligible targets (death by old age). Newborn plants
      // are still growing and don't enter the pool until they age out.
      const scores = new Array(CONFIG.sim.maxPlants).fill(0);
      const mature = [];
      for (let i = 0; i < CONFIG.sim.maxPlants; i++) {
        const age = tick - sim.cpuPlantBirthTick[i];
        if (age >= EV.retireAge) {
          scores[i] = fitnessScore(i);
          mature.push(i);
        }
      }
      if (mature.length < 2) return;

      for (let r = 0; r < EV.perTick; r++) {
        const targetIdx = mature[(Math.random() * mature.length) | 0];
        const parentIdx = pickWeighted(scores);
        if (parentIdx === targetIdx) continue;
        replacePlant(targetIdx, parentIdx, tick);
      }
    }

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

    // Per-plant light readback: copies GPU plantLight into sim.measuredLight,
    // which evolveStep then uses as the fitness signal.
    const plantLightBytes = CONFIG.sim.maxPlants * 4;
    const plantLightStaging = ctx.device.createBuffer({
      label: 'plantLight-readback',
      size: plantLightBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const zeroPlantLight = new Uint32Array(CONFIG.sim.maxPlants);  // reused per frame
    let lightReadbackBusy = false;
    let lastLightReadback = 0;
    async function readPlantLight() {
      if (lightReadbackBusy) return;
      lightReadbackBusy = true;
      try {
        const e = ctx.device.createCommandEncoder({ label: 'plantLight-copy' });
        e.copyBufferToBuffer(sim.plantLightBuffer, 0, plantLightStaging, 0, plantLightBytes);
        ctx.device.queue.submit([e.finish()]);
        await plantLightStaging.mapAsync(GPUMapMode.READ);
        const u = new Uint32Array(plantLightStaging.getMappedRange());
        let total = 0;
        for (let p = 0; p < CONFIG.sim.maxPlants; p++) {
          sim.measuredLight[p] = u[p];
          total += u[p];
        }
        plantLightStaging.unmap();
        debugState.totalLight = total;
      } catch (err) {
        console.error('plantLight readback failed', err);
      } finally {
        lightReadbackBusy = false;
      }
    }
    async function queueCounterReadback() {
      if (readbackBusy) return;
      readbackBusy = true;
      try {
        const e = ctx.device.createCommandEncoder({ label: 'counter-copy' });
        e.copyBufferToBuffer(sim.counter, 0, stagingBuffer, 0, 16);
        ctx.device.queue.submit([e.finish()]);
        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const u = new Uint32Array(stagingBuffer.getMappedRange());
        const c = { totalSegs: u[0], dispatched: u[1], liveTips: u[2], maxIdx: u[3] };
        stagingBuffer.unmap();
        segsEl.textContent = String(c.totalSegs);
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
      simTime += dt * timeScale;
      const skyState = computeSky(simTime);
      frame.update({
        view: camera.view,
        proj: camera.proj,
        cameraPos: camera.position,
        time: now / 1000,
        sunDir: skyState.sunDir,
        sunColor: skyState.sunColor,
        ambient: skyState.ambient,
        width: ctx.width,
        height: ctx.height,
      });
      frame.upload(ctx.device.queue);

      // Accumulate sim time (scaled by user-controlled timeScale) and queue
      // at most one growth tick per frame. At very high timeScale the
      // accumulator is clamped so it never builds a multi-frame backlog.
      let runTick = false;
      if (elapsed > CONFIG.sim.startDelay && timeScale > 0) {
        simAccum += dt * timeScale;
        if (simAccum > tickPeriod * 4) simAccum = tickPeriod * 4;
        if (simAccum >= tickPeriod) {
          simAccum -= tickPeriod;
          simTick++;
          sim.simCpu[0] = simTick;
          ctx.device.queue.writeBuffer(sim.simBuffer, 0, sim.simCpu);
          runTick = true;
          tickEl.textContent = String(simTick);
          debugState.simTick = simTick;
          evolveStep(simTick);
        }
      }

      // Async readback of the segment counter every ~500 ms so the HUD
      // shows whether growth is actually appending segments on the GPU.
      if (now - lastReadback > 500) {
        lastReadback = now;
        queueCounterReadback();
      }
      // Async per-plant light readback every ~1 s — feeds evolveStep's
      // fitness function so plants who caught more sun spawn more offspring.
      if (now - lastLightReadback > 1000) {
        lastLightReadback = now;
        readPlantLight();
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

      // Zero the per-plant accumulator before this frame's capture pass.
      ctx.device.queue.writeBuffer(sim.plantLightBuffer, 0, zeroPlantLight);

      // Light grid + plant-light capture. Each kernel runs in its own
      // compute pass so WebGPU's inter-pass barrier guarantees clear → splat
      // → capture see one another's writes.
      {
        const lp = encoder.beginComputePass({ label: 'light-clear' });
        lp.setBindGroup(0, light.bindGroup);
        lp.setPipeline(light.clearPipeline);
        lp.dispatchWorkgroups(lightClearDispatch);
        lp.end();
      }
      {
        const lp = encoder.beginComputePass({ label: 'light-splat' });
        lp.setBindGroup(0, light.bindGroup);
        lp.setPipeline(light.splatPipeline);
        lp.dispatchWorkgroups(lightSplatDispatch);
        lp.end();
      }
      {
        const lp = encoder.beginComputePass({ label: 'light-capture' });
        lp.setBindGroup(0, light.bindGroup);
        lp.setPipeline(light.capturePipeline);
        lp.dispatchWorkgroups(lightSplatDispatch);
        lp.end();
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
      leaves.draw(rpass);
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
