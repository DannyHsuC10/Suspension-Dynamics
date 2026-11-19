const bodyHeight = 0.85;
const wheelRadius = 0.22;
const wheelWidth = 0.20;
const bodyColor = '#60e0c6';
const roadColor = '#fbac71';
const springColors = { FL: '#82ceff', FR: '#e6acff', RL: '#fdcf7a', RR: '#f5a1ae' };
const ranges = new WeakMap();

const modelLabels = {
  quarter: 'Quarter-car motion', half_lr: 'Left/right half-car motion', half_fr: 'Front/rear half-car motion',
  rigid: 'Full-car motion', flex: 'Full-car motion with chassis twist',
};

function rangeOfMotion(result) {
  if (ranges.has(result)) return ranges.get(result);
  const low = result.motion[0].map(corner => [...corner]);
  const high = result.motion[0].map(corner => [...corner]);
  for (const sample of result.motion) {
    for (let c = 0; c < sample.length; c++) {
      for (let axis = 0; axis < 3; axis++) {
        low[c][axis] = Math.min(low[c][axis], sample[c][axis]);
        high[c][axis] = Math.max(high[c][axis], sample[c][axis]);
      }
    }
  }
  const extent = { low, high };
  ranges.set(result, extent);
  return extent;
}

function heightAt(first, current, gain, installedHeight) {
  return installedHeight + first + gain * (current - first);
}

function positionsFor(corners, model, vehicle) {
  return corners.map(corner => {
    const front = corner.startsWith('F');
    const side = corner.endsWith('L') ? 1 : -1;
    const x = front ? (vehicle.lf ?? 0.765) : -(vehicle.lr ?? 0.765);
    const y = side * (front ? (vehicle.tf ?? 1.25) : (vehicle.tr ?? 1.24)) / 2;
    return [model === 'quarter' || model === 'half_lr' ? 0 : x, model === 'quarter' || model === 'half_fr' ? 0 : y];
  });
}

function inferModel(corners) {
  if (corners.length === 1) return 'quarter';
  if (corners.length === 2) return corners[0][0] === corners[1][0] ? 'half_lr' : 'half_fr';
  return 'rigid';
}

function sampleIndex(time, requestedTime) {
  if (requestedTime <= time[0]) return 0;
  if (requestedTime >= time[time.length - 1]) return time.length - 1;
  let low = 0;
  let high = time.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (time[middle] <= requestedTime) low = middle;
    else high = middle;
  }
  return low + (requestedTime - time[low]) / (time[high] - time[low]);
}

function roadHeight(result, time, gain) {
  const index = sampleIndex(result.time, time);
  const a = Math.floor(index);
  const b = Math.ceil(index);
  const first = result.motion[0][0][2];
  const current = result.motion[a][0][2] + (index - a) * (result.motion[b][0][2] - result.motion[a][0][2]);
  return heightAt(first, current, gain, 0);
}

function fitBounds(result, positions, model, gain) {
  const { low, high } = rangeOfMotion(result);
  const body = result.motion[0];
  const marginX = model === 'quarter' ? 0.68 : 0.36;
  const marginY = model === 'half_lr' ? 0.30 : 0.25;
  const minZ = low.flatMap(([bodyZ, hubZ, roadZ], corner) => [
    heightAt(body[corner][0], bodyZ, gain, bodyHeight),
    heightAt(body[corner][1], hubZ, gain, 0),
    heightAt(body[corner][2], roadZ, gain, 0),
  ]);
  const maxZ = high.flatMap(([bodyZ, hubZ, roadZ], corner) => [
    heightAt(body[corner][0], bodyZ, gain, bodyHeight),
    heightAt(body[corner][1], hubZ, gain, wheelRadius * 2),
    heightAt(body[corner][2], roadZ, gain, 0),
  ]);
  return {
    low: [Math.min(...positions.map(point => point[0])) - marginX, Math.min(...positions.map(point => point[1])) - marginY, Math.min(...minZ) - 0.08],
    high: [Math.max(...positions.map(point => point[0])) + marginX, Math.max(...positions.map(point => point[1])) + marginY, Math.max(...maxZ) + 0.07],
  };
}

function line(points, color, width = 2) {
  return { points, color, width };
}

function bodyOutline(mounts, corners, model) {
  if (model === 'quarter') {
    const [x, y, z] = mounts[0];
    return [[x - 0.33, y, z], [x + 0.33, y, z]];
  }
  if (mounts.length !== 4) return mounts;
  const order = ['FL', 'FR', 'RR', 'RL', 'FL'];
  return order.map(corner => mounts[corners.indexOf(corner)]);
}

function coil(x, y, body, hub, lateral) {
  return Array.from({ length: 13 }, (_, i) => {
    const delta = i === 0 || i === 12 ? 0 : (i % 2 ? 0.025 : -0.025);
    return [x + (lateral ? 0 : delta), y + (lateral ? delta : 0), body + (hub - body) * i / 12];
  });
}

export function buildPlaybackScene(result, index, { project = result?.project, gain = 1 } = {}) {
  if (!result?.motion?.length || !result.corners?.length) return null;
  const corners = result.corners;
  const model = project?.model ?? inferModel(corners);
  const projection = model === 'half_lr' ? 'front' : ['quarter', 'half_fr'].includes(model) ? 'side' : 'iso';
  const frameIndex = Math.max(0, Math.min(Math.round(Number(index) || 0), result.motion.length - 1));
  const frame = result.motion[frameIndex];
  const first = result.motion[0];
  const options = project?.case ?? {};
  const fadeRoad = /^iso_/.test(options.scenario) ? Math.max(0.1, options.speed || 1) : 1;
  const positions = positionsFor(corners, model, project?.vehicle ?? {});
  const movementScale = Number.isFinite(gain) && gain >= 0 ? gain : 1;
  const motion = frame.map((corner, c) => corner.map((current, axis) =>
    heightAt(first[c][axis], current, movementScale, [bodyHeight, wheelRadius, 0][axis])));
  const mounts = motion.map(([body], corner) => [...positions[corner], body]);
  const lines = [line(bodyOutline(mounts, corners, model), bodyColor, 3.2)];
  const wheels = [];
  const points = [];
  const lateral = model === 'half_lr';

  for (const [i, id] of corners.entries()) {
    const [x, y] = positions[i];
    const [body, hub, road] = motion[i];
    const load = (result.series ?? result.signals)?.[`${id} [N]`]?.[frameIndex];
    const loadLabel = Number.isFinite(load) ? `${id} · ${Math.round(load)} N` : id;
    const unloaded = Number.isFinite(load) && load <= 1e-8;
    lines.push(line(coil(x, y, body, hub, lateral), springColors[id] ?? '#c5d4e4', 2));
    const dx = lateral ? 0 : 0.06;
    const dy = lateral ? 0.06 : 0;
    lines.push(line([[x + dx, y + dy, hub], [x + dx, y + dy, body]], '#8b9aaf', 1.8));
    wheels.push({ corner: id, center: [x, y, hub], axis: [0, 1, 0], up: [0, 0, 1], heading: [1, 0, 0],
      radius: wheelRadius, width: wheelWidth, color: unloaded ? '#ff8497' : '#dce9f6' });
    const roadLine = lateral ? [[x, y - 0.24, road], [x, y + 0.24, road]] : [[x - 0.31, y, road], [x + 0.31, y, road]];
    if (model === 'quarter' && result.time?.length === result.motion.length) {
      const time = result.time[frameIndex];
      lines.push(line(Array.from({ length: 49 }, (_, j) => {
        const offset = -0.64 + 1.28 * j / 48;
        return [x + offset, y, roadHeight(result, time + offset / fadeRoad, movementScale)];
      }), roadColor, 2.6));
    } else lines.push(line(roadLine, roadColor, 2.6));
    points.push({ id, kind: 'wheelCenter', label: loadLabel, position: [x, y, hub], color: springColors[id] });
  }
  return { type: `dynamics-${model}`, label: modelLabels[model] ?? 'Vehicle motion', projection,
    fitBounds: fitBounds(result, positions, model, movementScale), lines, points, wheels };
}
