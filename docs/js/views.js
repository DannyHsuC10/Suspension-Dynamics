const palette = {
  background: '#111d31', grid: '#25354b', gridMajor: '#34485e',
  text: '#e5edf5', muted: '#a8b9cd', ground: '#8c9db0',
  upperArm: '#58b2b9', lowerArm: '#6cc9f0', kingpin: '#ffbf70',
  upright: '#ffbf70', chassis: '#8295ab', contactLine: '#78d6be',
  swingArm: '#9ba9d1', axis: '#8295ab', clearance: '#ccafef',
  wheel: '#dce9f6', spindle: '#dce9f6', centroid: '#ffe082',
};

const chartColors = ['#60e0c6', '#6cc9f0', '#ffbf70', '#e9a5ed', '#d7de8d', '#f18f9e'];
const tickNumberFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: 4, useGrouping: false });
const defaultCamera = { azimuth: 0.88, elevation: 0.54, scale: 1, panX: 0, panY: 0 };
const axisNames = {
  front: ['Lateral position, −Y (mm)', 'Height, Z (mm)'],
  rear: ['Lateral position, Y (mm)', 'Height, Z (mm)'],
  side: ['Longitudinal position, X (mm)', 'Height, Z (mm)'],
  top: ['Longitudinal position, X (mm)', 'Lateral position, Y (mm)'],
};
const defaultProjection = { front: 'front', rear: 'rear', side: 'side', wheel: 'iso', static: 'iso' };
const constructionKinds = new Set(['contactLine', 'swingArm', 'axis', 'clearance', 'construction', 'force', 'ground']);
const guideMarkerKinds = new Set(['instantCenter', 'rollCenter', 'pitchCenter']);
const labeledMarkerKinds = new Set([...guideMarkerKinds, 'wheelCenter', 'contact', 'cg']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finitePoint(point, dimension = 3) {
  return Array.isArray(point) && point.length >= dimension && point.slice(0, dimension).every(Number.isFinite);
}

function boundsOf(points, fallback) {
  if (!points.length) return fallback;
  const low = [...points[0]];
  const high = [...points[0]];
  for (const point of points) {
    for (let i = 0; i < low.length; i++) {
      low[i] = Math.min(low[i], point[i]);
      high[i] = Math.max(high[i], point[i]);
    }
  }
  return { low, high };
}

function projectFor(projection, { azimuth, elevation }) {
  if (projection === 'front') return ([x, y, z]) => [-y, z, x];
  if (projection === 'rear') return ([x, y, z]) => [y, z, -x];
  if (projection === 'side') return ([x, y, z]) => [x, z, y];
  if (projection === 'top') return ([x, y, z]) => [x, y, z];
  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  const cosE = Math.cos(elevation);
  const sinE = Math.sin(elevation);
  return ([x, y, z]) => {
    const depth = x * cosA + y * sinA;
    return [x * sinA - y * cosA, z * cosE - depth * sinE, depth * cosE + z * sinE];
  };
}

function path2D(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
}

function stroke(ctx, points, color, width = 1, dash = []) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  path2D(ctx, points);
  ctx.stroke();
  ctx.setLineDash([]);
}

function text(ctx, label, x, y, { color = palette.muted, align = 'left', size = 12, bold = false } = {}) {
  ctx.font = `${bold ? '600 ' : ''}${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
}

function marker(ctx, x, y, color, size = 3, hovered = false) {
  ctx.fillStyle = hovered ? '#fff' : palette.background;
  ctx.strokeStyle = color;
  ctx.lineWidth = hovered ? 2 : 1.25;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
}

function tickStep(range, target) {
  const raw = Math.max(range / target, Number.EPSILON);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return magnitude * multiplier;
}

function ticks(low, high, step) {
  const first = Math.ceil(low / step);
  const last = Math.floor(high / step);
  return Array.from({ length: Math.max(0, Math.min(60, last - first + 1)) }, (_, i) => (first + i) * step);
}

function numberLabel(value) {
  if (Math.abs(value) < 1e-8) return '0';
  if (Math.abs(value) >= 100000 || Math.abs(value) < 0.0001) return value.toExponential(1);
  return tickNumberFormatter.format(value);
}

function wheelCircle(wheel, offset, radius, count = 72) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = 2 * Math.PI * index / count;
    return wheel.center.map((value, axis) => value + wheel.axis[axis] * offset +
      radius * (wheel.up[axis] * Math.cos(angle) + wheel.heading[axis] * Math.sin(angle)));
  });
}

function wheelPaths(wheel) {
  if (![wheel.center, wheel.axis, wheel.up, wheel.heading].every(point => finitePoint(point)) ||
      !Number.isFinite(wheel.radius) || wheel.radius <= 0) return [];
  const width = Math.max(wheel.width || 0, 0);
  const sides = width ? [-width / 2, width / 2] : [0];
  const circles = sides.map(offset => wheelCircle(wheel, offset, wheel.radius));
  const rim = wheelCircle(wheel, sides[0], wheel.radius * 0.58);
  const paths = circles.map(points => ({ points, kind: 'wheel', color: wheel.color, width: 1.45 }));
  paths.push({ points: rim, kind: 'wheel', color: '#8295ab', width: 1 });
  if (circles.length > 1) {
    for (const i of [0, 18, 36, 54]) paths.push({ points: [circles[0][i], circles[1][i]], kind: 'wheel', color: wheel.color, width: 1 });
  }
  return paths;
}

function lineStyle(segment) {
  const isReference = segment.construction ?? constructionKinds.has(segment.kind);
  const color = segment.color || palette[segment.kind] || palette.wheel;
  return { color, width: segment.width ?? (isReference ? 1.1 : 2), dash: segment.dash ?? (isReference ? [5, 5] : []), isReference };
}

function plotRect(width, height, flat) {
  return flat
    ? { left: width >= 420 ? 72 : 59, top: 20, right: width - 21, bottom: height - 56 }
    : { left: 17, top: 15, right: width - 17, bottom: height - 25 };
}

export class EngineeringView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = { ...defaultCamera };
    this.projection = 'iso';
    this.scene = null;
    this.chart = null;
    this.pointer = new Map();
    this.hitAreas = [];
    this.listeners = new AbortController();
    this.elementSize = { width: 0, height: 0 };
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-description', 'Use arrow keys to pan, plus and minus to zoom, and Home to reset the view.');
    canvas.style.touchAction = 'none';
    this.observe = new ResizeObserver(([entry]) => {
      this.elementSize = { width: entry.contentRect.width, height: entry.contentRect.height };
      this.scheduleDraw();
    });
    this.observe.observe(canvas);
    this.listen('wheel', event => {
      event.preventDefault();
      const delta = event.deltaMode === 0 ? event.deltaY : event.deltaY * 16;
      const rect = canvas.getBoundingClientRect();
      this.zoomBy(Math.exp(-clamp(delta, -160, 160) * 0.002), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    this.listen('dblclick', () => this.reset());
    this.listen('contextmenu', event => event.preventDefault());
    this.listen('pointerdown', event => this.handlePointerDown(event));
    this.listen('pointermove', event => this.handlePointerMove(event));
    this.listen('pointerup', event => this.handlePointerEnd(event));
    this.listen('pointercancel', event => this.handlePointerEnd(event));
    this.listen('lostpointercapture', event => this.handlePointerEnd(event));
    this.listen('pointerleave', () => {
      this.hovered = null;
      this.scheduleDraw();
    });
    this.listen('keydown', event => this.handleKey(event));
  }

  listen(name, action, options = {}) {
    this.canvas.addEventListener(name, action, { ...options, signal: this.listeners.signal });
  }

  setScene(scene, { preserveView = false, showConstruction = true, showLabels = true } = {}) {
    const sameType = scene?.type === this.scene?.type;
    this.scene = scene;
    this.chart = null;
    this.showConstruction = showConstruction;
    this.showLabels = showLabels;
    this.hovered = null;
    this.scenePaths = [
      ...(scene?.segments ?? []).map(segment => ({ ...segment, points: segment.points ?? [segment.a, segment.b] })),
      ...(scene?.lines ?? []),
      ...(scene?.wheels ?? []).flatMap(wheelPaths),
    ].filter(path => path.points?.length > 1 && path.points.every(point => finitePoint(point)));
    this.sceneMarkers = (scene?.points ?? []).filter(point => finitePoint(point.position));
    if (!preserveView || !sameType || !this.sceneBounds) {
      this.projection = scene?.projection ?? defaultProjection[scene?.type] ?? 'iso';
      this.fitScene();
      this.camera = { ...defaultCamera };
    }
    this.canvas.setAttribute('aria-label', `${scene?.label ?? ({
      front: 'Front suspension front view', rear: 'Rear suspension front view',
      side: 'Suspension side view', wheel: 'Wheel end in three dimensions', static: 'Static vehicle in three dimensions',
    })[scene?.type] ?? 'Suspension geometry'}. Interactive diagram.`);
    this.scheduleDraw();
  }

  fitScene() {
    const bounds = this.scene?.fitBounds;
    if (finitePoint(bounds?.low) && finitePoint(bounds?.high)) {
      this.sceneBounds = bounds;
      return;
    }
    // Swing-arm and force-line intersections can be far outside the physical assembly.
    const solid = this.scenePaths.filter(path => !lineStyle(path).isReference).flatMap(path => path.points);
    const fitPoints = solid.length ? solid : this.sceneMarkers.map(point => point.position);
    this.sceneBounds = boundsOf(fitPoints, { low: [-0.6, -0.6, 0], high: [0.6, 0.6, 0.5] });
  }

  setVisibility({ showConstruction = this.showConstruction, showLabels = this.showLabels } = {}) {
    this.showConstruction = showConstruction;
    this.showLabels = showLabels;
    this.scheduleDraw();
  }

  setProjection(projection) {
    const next = projection.toLowerCase();
    if (next !== 'iso' && !Object.hasOwn(axisNames, next)) return;
    this.projection = next;
    this.reset();
  }

  setChart(chart, { preserveView = false } = {}) {
    this.scene = null;
    this.chart = chart;
    this.hovered = null;
    this.chartSeries = (chart.series ?? []).map((series, index) => ({
      ...series, color: series.color ?? chartColors[index % chartColors.length],
    }));
    if (!preserveView || !this.chartBounds) this.fitChart();
    if (!preserveView) this.camera = { ...defaultCamera };
    this.canvas.setAttribute('aria-label', `${chart.yLabel || 'Result'} by ${chart.xLabel || 'input'}. Interactive plot.`);
    this.scheduleDraw();
  }

  fitChart() {
    const points = this.chartSeries.flatMap(series => series.points.filter(point => finitePoint(point, 2)));
    this.chartBounds = boundsOf(points, { low: [-1, -1], high: [1, 1] });
  }

  reset() {
    this.camera = { ...defaultCamera };
    if (this.scene) this.fitScene();
    if (this.chart) this.fitChart();
    this.scheduleDraw();
  }

  zoomBy(factor, x, y) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const { width, height } = this.elementSize;
    const rect = this.activeRect ?? plotRect(width, height, Boolean(this.chart) || this.projection !== 'iso');
    const midX = (rect.left + rect.right) / 2;
    const midY = (rect.top + rect.bottom) / 2;
    const previous = this.camera.scale;
    this.camera.scale = clamp(previous * factor, 0.18, 30);
    const applied = this.camera.scale / previous;
    this.camera.panX = (x ?? midX) - midX - ((x ?? midX) - midX - this.camera.panX) * applied;
    this.camera.panY = (y ?? midY) - midY - ((y ?? midY) - midY - this.camera.panY) * applied;
    this.scheduleDraw();
  }

  handlePointerDown(event) {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.pointer.set(event.pointerId, [event.clientX, event.clientY]);
    this.panGesture = event.shiftKey || event.button !== 0;
    this.canvas.style.cursor = 'grabbing';
    this.hovered = null;
    this.scheduleDraw();
  }

  handlePointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const current = [event.clientX, event.clientY];
    const previous = this.pointer.get(event.pointerId);
    if (!previous) {
      const x = current[0] - rect.left;
      const y = current[1] - rect.top;
      const nearest = this.hitAreas.reduce((best, point) => {
        const distance = Math.hypot(x - point.x, y - point.y);
        return distance <= 11 && (!best || distance < best.distance) ? { ...point, distance } : best;
      }, null);
      if (nearest?.id !== this.hovered?.id) {
        this.hovered = nearest;
        this.canvas.style.cursor = nearest ? 'crosshair' : '';
        this.scheduleDraw();
      }
      return;
    }
    this.pointer.set(event.pointerId, current);
    const dx = current[0] - previous[0];
    const dy = current[1] - previous[1];
    if (this.pointer.size > 1) {
      const other = Array.from(this.pointer.entries()).find(([id]) => id !== event.pointerId)[1];
      const before = Math.max(Math.hypot(previous[0] - other[0], previous[1] - other[1]), 1);
      const after = Math.max(Math.hypot(current[0] - other[0], current[1] - other[1]), 1);
      this.camera.panX += dx / 2;
      this.camera.panY += dy / 2;
      this.zoomBy(after / before, (current[0] + other[0]) / 2 - rect.left, (current[1] + other[1]) / 2 - rect.top);
    } else if (this.projection === 'iso' && !this.chart && !this.panGesture && !event.shiftKey) {
      this.camera.azimuth += dx * 0.009;
      this.camera.elevation = clamp(this.camera.elevation + dy * 0.009, -1.45, 1.45);
    } else {
      this.camera.panX += dx;
      this.camera.panY += dy;
    }
    this.scheduleDraw();
  }

  handlePointerEnd(event) {
    this.pointer.delete(event.pointerId);
    if (!this.pointer.size) this.canvas.style.cursor = '';
  }

  handleKey(event) {
    const offsets = { ArrowLeft: [-22, 0], ArrowRight: [22, 0], ArrowUp: [0, -22], ArrowDown: [0, 22] };
    if (event.key === 'Home' || event.key === '0') this.reset();
    else if (event.key === '+' || event.key === '=') this.zoomBy(1.2);
    else if (event.key === '-') this.zoomBy(1 / 1.2);
    else if (Object.hasOwn(offsets, event.key)) {
      const [dx, dy] = offsets[event.key];
      if (event.shiftKey && this.projection === 'iso' && !this.chart) {
        this.camera.azimuth += dx * 0.009;
        this.camera.elevation = clamp(this.camera.elevation + dy * 0.009, -1.45, 1.45);
      } else {
        this.camera.panX += dx;
        this.camera.panY += dy;
      }
      this.scheduleDraw();
    } else return;
    event.preventDefault();
  }

  scheduleDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  draw() {
    const { width, height } = this.elementSize;
    if (width < 120 || height < 110) return;
    const ctx = this.ctx;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.hitAreas = [];
    const flat = Boolean(this.chart) || this.projection !== 'iso';
    const rect = plotRect(width, height, flat);
    if (this.chart && this.chartSeries.length > 1) rect.top += this.drawChartLegend(ctx, rect);
    this.activeRect = rect;
    if (this.chart) this.drawChart(ctx, rect);
    else if (this.scene) this.drawScene(ctx, rect);
    else text(ctx, 'No geometry to display', width / 2, height / 2, { align: 'center' });
    if (this.hovered) this.drawTooltip(ctx, width, height);
  }

  frameTransform(rect, origin, scaleX, scaleY = scaleX) {
    const centerX = (rect.left + rect.right) / 2 + this.camera.panX;
    const centerY = (rect.top + rect.bottom) / 2 + this.camera.panY;
    const sx = scaleX * this.camera.scale;
    const sy = scaleY * this.camera.scale;
    return {
      screen: ([x, y]) => [centerX + (x - origin[0]) * sx, centerY - (y - origin[1]) * sy],
      x: pixel => origin[0] + (pixel - centerX) / sx,
      y: pixel => origin[1] - (pixel - centerY) / sy,
    };
  }

  clip(ctx, { left, right, top, bottom }) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
  }

  drawGrid(ctx, rect, transform, labels, units = 1) {
    const { left, right, top, bottom } = rect;
    const loX = transform.x(left) * units;
    const hiX = transform.x(right) * units;
    const loY = transform.y(bottom) * units;
    const hiY = transform.y(top) * units;
    for (const value of ticks(loX, hiX, tickStep(hiX - loX, Math.max(3, (right - left) / 85)))) {
      const [x] = transform.screen([value / units, 0]);
      stroke(ctx, [[x, top], [x, bottom]], value === 0 ? palette.gridMajor : palette.grid);
      text(ctx, numberLabel(value), x, bottom + 14, { align: 'center', size: 11 });
    }
    for (const value of ticks(loY, hiY, tickStep(hiY - loY, Math.max(3, (bottom - top) / 53)))) {
      const [, y] = transform.screen([0, value / units]);
      stroke(ctx, [[left, y], [right, y]], value === 0 ? palette.gridMajor : palette.grid);
      text(ctx, numberLabel(value), left - 8, y, { align: 'right', size: 11 });
    }
    stroke(ctx, [[left, top], [left, bottom], [right, bottom]], palette.gridMajor);
    text(ctx, labels[0], (left + right) / 2, bottom + 37, { align: 'center', color: palette.text });
    ctx.save();
    ctx.translate(15, (top + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    text(ctx, labels[1], 0, 0, { align: 'center', color: palette.text });
    ctx.restore();
  }

  drawGround(ctx, project, screen, bounds) {
    const min = bounds.low;
    const max = bounds.high;
    const z = Math.min(0, min[2]);
    const span = Math.max(max[0] - min[0], max[1] - min[1], 0.2);
    const margin = span * 0.16;
    const step = tickStep(span, 9);
    const x0 = Math.floor((min[0] - margin) / step) * step;
    const x1 = Math.ceil((max[0] + margin) / step) * step;
    const y0 = Math.floor((min[1] - margin) / step) * step;
    const y1 = Math.ceil((max[1] + margin) / step) * step;
    const draw = (a, b, value) => stroke(ctx, [screen(project(a)), screen(project(b))], value === 0 ? palette.gridMajor : palette.grid);
    for (const x of ticks(x0, x1, step)) draw([x, y0, z], [x, y1, z], x);
    for (const y of ticks(y0, y1, step)) draw([x0, y, z], [x1, y, z], y);
  }

  drawTriad(ctx, project, rect) {
    const [x, y] = [rect.left + 38, rect.bottom - 26];
    const axes = [[[1, 0, 0], 'X', '#ff9c9c'], [[0, 1, 0], 'Y', '#80dac2'], [[0, 0, 1], 'Z', '#8bd5ff']];
    for (const [axis, label, color] of axes) {
      const [dx, dy] = project(axis);
      stroke(ctx, [[x, y], [x + dx * 22, y - dy * 22]], color, 1.4);
      text(ctx, label, x + dx * 32, y - dy * 32, { size: 11, align: 'center', color, bold: true });
    }
  }

  drawScene(ctx, rect) {
    const project = projectFor(this.projection, this.camera);
    const { low, high } = this.sceneBounds;
    const corners = [];
    for (const x of [low[0], high[0]]) {
      for (const y of [low[1], high[1]]) {
        for (const z of [low[2], high[2]]) corners.push(project([x, y, z]));
      }
    }
    const limits = boundsOf(corners);
    const flat = this.projection !== 'iso';
    const sceneWidth = Math.max(limits.high[0] - limits.low[0], 0.025);
    const sceneHeight = Math.max(limits.high[1] - limits.low[1], 0.025);
    const center = limits.low.slice(0, 2).map((value, i) => (value + limits.high[i]) / 2);
    const padding = flat ? 1.16 : 1.25;
    const scale = Math.min((rect.right - rect.left) / sceneWidth, (rect.bottom - rect.top) / sceneHeight) / padding;
    const transform = this.frameTransform(rect, center, scale);
    const screen = point => transform.screen(project(point));
    if (flat) this.drawGrid(ctx, rect, transform, axisNames[this.projection], 1000);
    this.clip(ctx, rect);
    if (!flat) this.drawGround(ctx, project, transform.screen, this.sceneBounds);
    const paths = this.scenePaths.map(path => {
      const points = path.points.map(project);
      const depth = points.reduce((sum, point) => sum + point[2], 0) / points.length;
      return { depth, points, ...lineStyle(path) };
    }).sort((a, b) => Number(b.isReference) - Number(a.isReference) || a.depth - b.depth);
    for (const path of paths) {
      if (!path.isReference || this.showConstruction) {
        stroke(ctx, path.points.map(transform.screen), path.color, path.width, path.dash);
      }
    }
    if (!this.scenePaths.length) {
      text(ctx, 'No geometry to display', (rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2, { align: 'center' });
    }
    this.drawMarkers(ctx, rect, screen);
    ctx.restore();
    if (!flat) this.drawTriad(ctx, project, rect);
  }

  drawMarkers(ctx, rect, screen) {
    const labels = [];
    for (const point of this.sceneMarkers) {
      const isGuide = point.construction || guideMarkerKinds.has(point.kind);
      if (isGuide && !this.showConstruction) continue;
      const [x, y] = screen(point.position);
      if (x < rect.left + 3 || x > rect.right - 3 || y < rect.top + 3 || y > rect.bottom - 3) continue;
      const important = labeledMarkerKinds.has(point.kind);
      const color = point.color ?? (isGuide ? palette.swingArm : important ? palette.centroid : palette.wheel);
      const hovered = this.hovered?.id === point.id;
      marker(ctx, x, y, color, important ? 3.7 : 2.4, hovered);
      this.hitAreas.push({ ...point, x, y, tooltip: point.position.map(value => `${numberLabel(value * 1000)} mm`) });
      if (this.showLabels && point.label && !hovered) labels.push({ label: point.label, x, y, color, important });
    }
    const placed = [];
    labels.sort((a, b) => Number(b.important) - Number(a.important));
    for (const { label, x, y, color } of labels) {
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      const w = ctx.measureText(label).width;
      const candidates = [[x + 8, y - 10], [x + 8, y + 10], [x - w - 8, y - 10], [x - w - 8, y + 10]];
      const position = candidates.find(([lx, ly]) => lx >= rect.left + 3 && lx + w <= rect.right - 3 &&
        ly >= rect.top + 8 && ly <= rect.bottom - 8 &&
        !placed.some(other => lx < other.right && lx + w > other.left && Math.abs(ly - other.y) < 14));
      if (!position) continue;
      const [lx, ly] = position;
      ctx.fillStyle = '#111d31e6';
      ctx.fillRect(lx - 2, ly - 7, w + 4, 14);
      text(ctx, label, lx, ly, { size: 11, color });
      placed.push({ left: lx - 2, right: lx + w + 2, y: ly });
    }
  }

  drawChart(ctx, rect) {
    const { left, right, top, bottom } = rect;
    const { low, high } = this.chartBounds;
    const ranges = low.map((value, axis) => Math.max(high[axis] - value, Math.abs(value) * 0.05, 0.01));
    const center = low.map((value, axis) => (value + high[axis]) / 2);
    const transform = this.frameTransform(rect, center, (right - left) / ranges[0] / 1.11, (bottom - top) / ranges[1] / 1.19);
    this.drawGrid(ctx, rect, transform, [this.chart.xLabel ?? '', this.chart.yLabel ?? '']);
    this.clip(ctx, rect);
    if (Number.isFinite(this.chart.currentX)) {
      const [x] = transform.screen([this.chart.currentX, 0]);
      stroke(ctx, [[x, top], [x, bottom]], palette.centroid, 1, [4, 5]);
    }
    this.chartSeries.forEach((series, lineIndex) => {
      let path = [];
      series.points.forEach((point, pointIndex) => {
        if (!finitePoint(point, 2)) {
          stroke(ctx, path, series.color, 2);
          path = [];
          return;
        }
        const [x, y] = transform.screen(point);
        path.push([x, y]);
        if (x < left || x > right || y < top || y > bottom) return;
        const id = `${lineIndex}:${pointIndex}`;
        this.hitAreas.push({ id, label: series.label, x, y, tooltip: point.map(numberLabel) });
        if (this.hovered?.id === id || series.points.length === 1) marker(ctx, x, y, series.color, 4, this.hovered?.id === id);
      });
      stroke(ctx, path, series.color, 2);
    });
    if (!this.hitAreas.length && !this.chartSeries.some(series => series.points.some(point => finitePoint(point, 2)))) {
      text(ctx, 'No finite samples to display', (left + right) / 2, (top + bottom) / 2, { align: 'center' });
    }
    ctx.restore();
  }

  drawChartLegend(ctx, { left, right }) {
    let x = left;
    let y = 16;
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    for (const series of this.chartSeries) {
      const width = ctx.measureText(series.label).width + 36;
      if (x > left && x + width > right) {
        x = left;
        y += 17;
      }
      stroke(ctx, [[x, y], [x + 15, y]], series.color, 2);
      text(ctx, series.label, x + 21, y, { size: 11 });
      x += width;
    }
    return y - 7;
  }

  drawTooltip(ctx, width, height) {
    const point = this.hitAreas.find(area => area.id === this.hovered.id);
    if (!point) return;
    const names = this.chart ? ['X', 'Y'] : ['X', 'Y', 'Z'];
    const lines = [point.label ?? String(point.id), point.tooltip.map((value, i) => `${names[i]} ${value}`).join('   ')];
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    const boxWidth = Math.max(...lines.map(line => ctx.measureText(line).width)) + 22;
    const boxHeight = 47;
    const x = clamp(point.x + 13, 6, Math.max(6, width - boxWidth - 6));
    const y = clamp(point.y - boxHeight - 8, 6, Math.max(6, height - boxHeight - 6));
    ctx.fillStyle = '#1c2b43';
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.strokeStyle = palette.gridMajor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, boxWidth, boxHeight);
    text(ctx, lines[0], x + 11, y + 14, { color: palette.text, bold: true });
    text(ctx, lines[1], x + 11, y + 32);
  }

  destroy() {
    this.observe.disconnect();
    this.listeners.abort();
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}
