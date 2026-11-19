export function seriesExtrema(points) {
  let minimum;
  let maximum;
  for (const point of points) {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    if (!minimum || point[1] < minimum[1]) minimum = point;
    if (!maximum || point[1] > maximum[1]) maximum = point;
  }
  if (!minimum) return [];
  if (minimum[1] === maximum[1]) return [{ kind: 'Min = Max', point: minimum }];
  return [{ kind: 'Min', point: minimum }, { kind: 'Max', point: maximum }];
}

const signalCache = new WeakMap();

export function signalSeries(result, label) {
  let cache = signalCache.get(result);
  if (!cache) { cache = new Map(); signalCache.set(result, cache); }
  if (cache.has(label)) return cache.get(label);
  const values = result.series[label];
  const all = result.time.map((time, index) => [time, values[index]]);
  const extrema = seriesExtrema(all);
  const stride = Math.max(1, Math.floor(all.length / 2500));
  const retained = new Set([0, all.length - 1]);
  for (let i = 0; i < all.length; i += stride) retained.add(i);
  for (const entry of extrema) retained.add(all.indexOf(entry.point));
  const series = { label, points: [...retained].sort((a, b) => a - b).map(index => all[index]), extrema };
  cache.set(label, series);
  return series;
}

const guideCache = new WeakMap();

export function wheelTravelGuides(result, names) {
  let cache = guideCache.get(result);
  if (!cache) { cache = new Map(); guideCache.set(result, cache); }
  const cacheKey = names.join('|');
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const guides = [];
  for (const threshold of result.travel_thresholds || []) {
    const travels = threshold.corners.map(corner => result.series[`${corner} Wheel travel [mm]`]);
    for (const [index, corner] of threshold.corners.entries()) {
      const weight = threshold.weights[index];
      if (!weight || !names.includes(`${corner} Wheel travel [mm]`)) continue;
      // Hold the other wheels at their simulated travel and solve the modal
      // coordinate for this wheel. This also supports coupled full-car channels.
      const points = result.time.map((time, sample) => {
        const otherTravel = threshold.weights.reduce((sum, coefficient, wheel) =>
          wheel === index || !coefficient ? sum : sum + coefficient * travels[wheel][sample], 0);
        return [time, (threshold.modal_mm - otherTravel) / weight];
      });
      guides.push({ label: `${corner} · ${threshold.label} · ${threshold.kind}`, corner, kind: threshold.kind, points });
    }
  }
  cache.set(cacheKey, guides);
  return guides;
}
