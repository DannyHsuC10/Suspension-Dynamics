const corners = ['FL', 'FR', 'RL', 'RR'];
const millimetres = 0.001;
const radians = Math.PI / 180;
const roadPeriod = 1.8;
const roadDash = 0.95;
const roadSpeedScale = 0.16;

const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
uniform vec3 target, right, up, cg;
uniform mediump vec3 eye;
uniform vec3 viewExtent;
uniform vec2 axles;
uniform vec4 bodyAngles;
uniform float wheelTravel;
uniform bool isBody;
varying mediump vec3 vertexNormal;

vec3 rotation(vec3 v, float roll, float pitch) {
  float cr = cos(roll), sr = sin(roll);
  float cp = cos(pitch), sp = sin(pitch);
  vec3 w = vec3(v.x, cr*v.y - sr*v.z, sr*v.y + cr*v.z);
  return vec3(cp*w.x - sp*w.z, w.y, sp*w.x + cp*w.z);
}

void main() {
  vec3 p = position;
  vertexNormal = normal;
  if (isBody) {
    float weight = clamp((p.x - axles.x) / (axles.y - axles.x), 0.0, 1.0);
    float roll = mix(bodyAngles.z, bodyAngles.w, weight);
    p = cg + rotation(p - cg, roll, bodyAngles.y);
    p.z += bodyAngles.x;
    vertexNormal = rotation(normal, roll, bodyAngles.y);
  } else {
    p.z += wheelTravel;
  }
  vec3 relative = p - target;
  vec3 projected = vec3(dot(relative, right), dot(relative, up), -dot(relative, eye));
  gl_Position = vec4(projected / viewExtent, 1.0);
}`;

const fragmentSource = `
precision mediump float;
uniform vec3 colour;
uniform mediump vec3 eye;
uniform bool unlit;
varying mediump vec3 vertexNormal;

void main() {
  if (unlit) {
    gl_FragColor = vec4(colour, 1.0);
    return;
  }
  vec3 n = normalize(vertexNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 light = normalize(eye + vec3(0.1, -0.25, 0.7));
  float diffuse = max(dot(light, n), 0.0);
  float specular = pow(max(dot(n, normalize(light + eye)), 0.0), 26.0);
  gl_FragColor = vec4(colour * (0.38 + 0.58 * diffuse) + 0.13 * specular, 1.0);
}`;

function vectorCross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(vector) {
  const size = Math.hypot(...vector) || 1;
  return vector.map(value => value / size);
}

export function parseStl(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 84) throw new Error('The LP02 mesh file is incomplete.');
  const triangles = view.getUint32(80, true);
  if (triangles === 0 || 84 + triangles * 50 !== view.byteLength) throw new Error('Invalid LP02 binary STL mesh.');
  const vertices = new Float32Array(triangles * 18);
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let triangle = 0, cursor = 0; triangle < triangles; triangle++) {
    let offset = 84 + triangle * 50;
    const normal = [0, 4, 8].map(index => view.getFloat32(offset + index, true));
    offset += 12;
    for (let vertex = 0; vertex < 3; vertex++) {
      for (let axis = 0; axis < 3; axis++, offset += 4) {
        const value = view.getFloat32(offset, true) * millimetres;
        low[axis] = Math.min(low[axis], value);
        high[axis] = Math.max(high[axis], value);
        vertices[cursor++] = value;
      }
      vertices.set(normal, cursor);
      cursor += 3;
    }
  }
  if (![...low, ...high].every(Number.isFinite)) throw new Error('Invalid LP02 vertex coordinates.');
  return { vertices, low, high, center: low.map((value, i) => (value + high[i]) / 2) };
}

let assetLoad;

function loadAssets() {
  assetLoad ??= Promise.all(['LP02', ...corners.map(corner => `W_${corner}`)].map(async name => {
    const response = await fetch(new URL(`../assets/lp02/${name}.stl`, import.meta.url));
    if (!response.ok) throw new Error(`Could not load the LP02 mesh ${name} (${response.status}).`);
    return parseStl(await response.arrayBuffer());
  })).catch(error => {
    assetLoad = undefined;
    throw error;
  });
  return assetLoad;
}

function makeProgram(gl) {
  const shaders = [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]].map(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('Could not start the LP02 3D renderer.');
    }
    return shader;
  });
  const program = gl.createProgram();
  for (const shader of shaders) gl.attachShader(program, shader);
  gl.linkProgram(program);
  for (const shader of shaders) gl.deleteShader(shader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error('Could not link the LP02 3D renderer.');
  }
  return program;
}

function motionAt(result, index) {
  const series = result.series ?? result.signals;
  const front = series['Front roll [deg]'] ?? series['Roll [deg]'];
  const rear = series['Rear roll [deg]'] ?? front;
  const pitch = series['Pitch [deg]'];
  const heave = series['Heave [mm]'];
  const bodyAngles = [(heave?.[index] ?? 0) * millimetres, (pitch?.[index] ?? 0) * radians,
    (rear?.[index] ?? 0) * radians, (front?.[index] ?? 0) * radians];
  const wheelTravel = corners.map(corner => {
    const c = result.corners.indexOf(corner);
    return c < 0 ? 0 : result.motion[index][c][1] - result.motion[0][c][1];
  });
  const elapsed = Math.max(0, result.time[index] - (result.replay_start ?? 0));
  const roadShift = (elapsed * result.project.case.speed * roadSpeedScale) % roadPeriod;
  return { bodyAngles, wheelTravel, roadShift };
}

function sceneGeometry(meshes) {
  const [body, ...wheels] = meshes;
  const low = body.low.map((value, i) => Math.min(value, ...wheels.map(wheel => wheel.low[i])));
  const high = body.high.map((value, i) => Math.max(value, ...wheels.map(wheel => wheel.high[i])));
  const frontX = (wheels[0].center[0] + wheels[1].center[0]) / 2;
  const rearX = (wheels[2].center[0] + wheels[3].center[0]) / 2;
  const centerY = wheels.reduce((total, wheel) => total + wheel.center[1], 0) / 4;
  const ground = Math.min(...wheels.map(wheel => wheel.low[2]));
  const target = low.map((value, axis) => (value + high[axis]) / 2);
  const fit = Math.hypot(...high.map((value, axis) => value - low[axis])) / 2;
  return { frontX, rearX, centerY, ground, target, fit, roadStart: body.low[0] - 1.2, roadEnd: body.high[0] + 1.2 };
}

export class LP02View {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true, antialias: true });
    if (!this.gl) throw new Error('WebGL is required for LP02 3D playback.');
    const gl = this.gl;
    this.program = makeProgram(gl);
    this.uniforms = Object.fromEntries(['target', 'right', 'up', 'eye', 'cg', 'viewExtent', 'axles', 'bodyAngles',
      'wheelTravel', 'isBody', 'colour', 'unlit'].map(key => [key, gl.getUniformLocation(this.program, key)]));
    this.attributes = Object.fromEntries(['position', 'normal'].map(key => [key, gl.getAttribLocation(this.program, key)]));
    this.roadBuffer = gl.createBuffer();
    this.events = new AbortController();
    this.setInteractions();
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(canvas);
    this.reset();
    this.ready = loadAssets().then(meshes => {
      if (this.destroyed) return;
      this.geometry = sceneGeometry(meshes);
      this.meshes = meshes.map(mesh => {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
        return { buffer, count: mesh.vertices.length / 6 };
      });
      this.draw();
    });
  }

  setInteractions() {
    const { canvas } = this;
    const receiver = { signal: this.events.signal };
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
    }, receiver);
    canvas.addEventListener('pointermove', event => {
      if (this.drag?.id !== event.pointerId) return;
      this.orbit((this.drag.x - event.clientX) * 0.008, (event.clientY - this.drag.y) * 0.008);
      this.drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }, receiver);
    for (const signal of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(signal, () => { this.drag = null; }, receiver);
    }
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.changeZoom(Math.exp(-Math.sign(event.deltaY) * 0.12));
    }, { ...receiver, passive: false });
    canvas.addEventListener('dblclick', () => this.reset(), receiver);
    canvas.addEventListener('keydown', event => {
      const keys = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.12], ArrowDown: [0, -0.12] };
      if (event.key in keys) this.orbit(...keys[event.key]);
      else if (event.key === '+' || event.key === '=') this.changeZoom(1.12);
      else if (event.key === '-') this.changeZoom(1 / 1.12);
      else if (event.key === 'Home') this.reset();
      else return;
      event.preventDefault();
    }, receiver);
  }

  reset() {
    this.azimuth = -Math.PI / 4;
    this.elevation = Math.PI / 6;
    this.zoom = 1;
    this.draw();
  }

  orbit(dx, dy) {
    this.azimuth += dx;
    this.elevation = Math.max(-1.51, Math.min(1.51, this.elevation + dy));
    this.draw();
  }

  changeZoom(scale) {
    this.zoom = Math.max(0.12, Math.min(15, this.zoom * scale));
    this.draw();
  }

  setFrame(result, index) {
    this.result = result;
    this.index = Math.max(0, Math.min(result.time.length - 1, Math.round(index)));
    this.draw();
  }

  bindVertices(buffer) {
    const { gl, attributes } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(attributes.position);
    gl.enableVertexAttribArray(attributes.normal);
    gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(attributes.normal, 3, gl.FLOAT, false, 24, 12);
  }

  drawRoad(shift) {
    const { gl, uniforms, geometry } = this;
    const { centerY, ground, roadStart, roadEnd } = geometry;
    const lines = [];
    for (let x = roadStart - shift; x < roadEnd; x += roadPeriod) {
      const start = Math.max(x, roadStart);
      const end = Math.min(x + roadDash, roadEnd);
      if (end > start) lines.push(start, centerY, ground, 0, 0, 1, end, centerY, ground, 0, 0, 1);
    }
    this.bindVertices(this.roadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
    gl.uniform1i(uniforms.unlit, 1);
    gl.uniform1i(uniforms.isBody, 0);
    gl.uniform1f(uniforms.wheelTravel, 0);
    gl.uniform3f(uniforms.colour, 0.98, 0.72, 0.23);
    gl.drawArrays(gl.LINES, 0, lines.length / 6);
  }

  draw() {
    if (this.destroyed || !this.meshes) return false;
    const { canvas, gl, uniforms, geometry } = this;
    const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * pixelRatio);
    const height = Math.round(canvas.clientHeight * pixelRatio);
    if (width < 1 || height < 1) return false;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const aspect = width / height;
    const extent = Math.max(0.25, geometry.fit * 0.77) / this.zoom;
    const eye = [Math.cos(this.azimuth) * Math.cos(this.elevation), Math.sin(this.azimuth) * Math.cos(this.elevation), Math.sin(this.elevation)];
    const right = normalize(vectorCross([0, 0, 1], eye));
    const up = vectorCross(eye, right);
    const motion = this.result ? motionAt(this.result, this.index) : { bodyAngles: [0, 0, 0, 0], wheelTravel: [0, 0, 0, 0], roadShift: 0 };
    const vehicle = this.result?.project.vehicle;
    const fraction = vehicle ? vehicle.lr / (vehicle.lf + vehicle.lr) : 0.5;
    const cg = [geometry.rearX + fraction * (geometry.frontX - geometry.rearX), geometry.centerY, geometry.ground + (vehicle?.h_cg ?? 0.3)];

    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.085, 0.126, 0.183, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform3fv(uniforms.target, geometry.target);
    gl.uniform3fv(uniforms.eye, eye);
    gl.uniform3fv(uniforms.right, right);
    gl.uniform3fv(uniforms.up, up);
    gl.uniform3f(uniforms.viewExtent, extent * Math.max(aspect, 1), extent * Math.max(1 / aspect, 1), geometry.fit * 2 + 2);
    gl.uniform3fv(uniforms.cg, cg);
    gl.uniform2f(uniforms.axles, geometry.rearX, geometry.frontX);
    gl.uniform4fv(uniforms.bodyAngles, motion.bodyAngles);
    this.drawRoad(motion.roadShift);
    gl.uniform1i(uniforms.unlit, 0);
    for (const [index, mesh] of this.meshes.entries()) {
      const body = index === 0;
      this.bindVertices(mesh.buffer);
      gl.uniform1i(uniforms.isBody, body ? 1 : 0);
      gl.uniform1f(uniforms.wheelTravel, body ? 0 : motion.wheelTravel[index - 1]);
      gl.uniform3fv(uniforms.colour, body ? [0.75, 0.82, 0.89] : [0.27, 0.33, 0.39]);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.abort();
    this.resize.disconnect();
    for (const mesh of this.meshes ?? []) this.gl.deleteBuffer(mesh.buffer);
    this.gl.deleteBuffer(this.roadBuffer);
    this.gl.deleteProgram(this.program);
  }
}
