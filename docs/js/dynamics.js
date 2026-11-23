import { signalSeries, wheelTravelGuides } from './chart-data.js';
import { EngineeringView } from './views.js';
import { buildPlaybackScene } from './dynamics-playback.js';
import { downloadCsv, downloadPng } from './exports.js';

const models = { flex: 'Full vehicle · 8 DOF, flexible chassis', rigid: 'Full vehicle · 7 DOF, rigid chassis', half_lr: 'Half vehicle · left/right', half_fr: 'Half vehicle · front/rear', quarter: 'Quarter vehicle · 2 DOF' };
const scenarios = { bump: 'Road bump or dip', step: 'Step input', random: 'Random road', iso_a: 'ISO 8608 Class A', iso_b: 'ISO 8608 Class B', iso_c: 'ISO 8608 Class C', cornering: 'Lateral acceleration', maneuver: 'Braking, acceleration or cornering', combined: 'Bump with acceleration', csv: 'Recorded CSV replay' };
const channels = { heave_f: 'Front heave', heave_r: 'Rear heave', roll_f: 'Front roll', roll_r: 'Rear roll', roll_c: 'Combined roll', warp: 'Diagonal warp', FL: 'FL direct', FR: 'FR direct', RL: 'RL direct', RR: 'RR direct' };
const wheelPositions = ['FL', 'FR', 'RL', 'RR'];
const families = { full: 'Full vehicle', half_lr: 'Half left/right', half_fr: 'Half front/rear', quarter: 'Quarter vehicle' };
const wheelTargets = { FL: ['FL'], FR: ['FR'], RL: ['RL'], RR: ['RR'], front: ['FL', 'FR'], rear: ['RL', 'RR'], left: ['FL', 'RL'], right: ['FR', 'RR'], all: wheelPositions };
const choices = { FL: 'FL', FR: 'FR', RL: 'RL', RR: 'RR', front: 'Front axle', rear: 'Rear axle', left: 'Left side', right: 'Right side', all: 'All wheels' };
const sharedFields = {
  m: 'Total mass (kg)', lf: 'CG to front axle (m)', lr: 'CG to rear axle (m)', tf: 'Front track (m)', tr: 'Rear track (m)', h_cg: 'CG height (m)',
};
const vehicleFields = {
  ...sharedFields, Ixx: 'Sprung roll inertia (kg·m²)', Iyy: 'Sprung pitch inertia (kg·m²)',
  body_twist_k: 'Chassis torsional stiffness (N·m/rad)', body_twist_c: 'Chassis torsional damping (N·m·s/rad)',
};
const geometryFields = { h_rc_f: 'Front roll centre (m)', h_rc_r: 'Rear roll centre (m)',
  dive_front: 'Front anti-dive (fraction)', lift_rear: 'Rear braking anti-lift (fraction)',
  lift_front: 'Front drive anti-lift (fraction)', squat_rear: 'Rear anti-squat (fraction)' };
const caseFields = { duration: 'Duration (s)', dt: 'Output interval (s)', start: 'Input start (s)', height: 'Bump height (mm)',
  period: 'Bump crossing time (s)', speed: 'Vehicle speed (m/s)', seed: 'Road random seed',
  random_interval: 'Random road knot interval (s)',
  ax: 'Longitudinal acceleration (m/s²)', ay: 'Lateral acceleration (m/s²)', ramp: 'Acceleration rise time (s)' };
const geometryColumns = {
  roll_center: ['travel_mm', 'front_rc_mm', 'rear_rc_mm'],
  anti: ['travel_mm', 'front_anti_dive_pct', 'rear_anti_lift_pct', 'front_anti_lift_pct', 'rear_anti_squat_pct'],
};
const prefixes = { full: 'Full Vehicle', half_lr: 'Half Car · Left / Right', half_fr: 'Half Car · Front / Rear', quarter: 'Quarter Car', vehicle: 'Vehicle settings', components: 'Springs and Dampers',
  geometry: 'Geometry lookup', aero: 'Aerodynamics', transfer: 'Load transfer' };
const plotColours = ['#60e0c6', '#7bbcff', '#ffc477', '#e5a7e8', '#99df94', '#edaaaa', '#b6bbf8', '#e5e09b'];
const transferDefaults = { ay: 1, radius: 20, height_f: 230, height_r: 230 };

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, click, className) {
  const node = el('button', text, className);
  node.type = 'button';
  if (click) node.addEventListener('click', click);
  return node;
}

function field(label, control) {
  const node = el('label', null, 'field');
  node.append(el('span', label), control);
  return node;
}

function select(label, options, value, onChange) {
  const node = el('select');
  for (const [key, text] of Object.entries(options)) node.add(new Option(text, key));
  if (Object.hasOwn(options, value)) node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return field(label, node);
}

function number(label, value, onChange, { min, max, integer } = {}) {
  const input = el('input');
  input.type = 'number';
  input.value = value ?? '';
  input.step = integer ? 1 : 'any';
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  input.required = true;
  input.addEventListener('change', () => {
    if (!input.reportValidity()) { input.value = value; return; }
    onChange(input.valueAsNumber);
  });
  return field(label, input);
}

function check(label, value, onChange) {
  const node = el('label', null, 'check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  node.append(input, el('span', label));
  return node;
}

function numberGrid(target, definitions, onChange) {
  const grid = el('div', null, 'form-grid');
  for (const [key, label] of Object.entries(definitions)) {
    grid.append(number(label, target[key], value => { target[key] = value; onChange?.(); }, { integer: key === 'seed' }));
  }
  return grid;
}

function fmt(value, precision = 3) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: precision, useGrouping: false }).format(value);
}

function legacyFrame(project) {
  const half = project.page_cases?.half_lr ?? project.page_cases?.half;
  const stored = project.model === 'half_lr' ? project.case.roll_center_frame : half?.case?.roll_center_frame;
  return { enabled: true, stiffness: 500000, damping: 1.4 * Math.sqrt(500000 * 65), mass: 65, ...stored };
}

function table(headers, rows) {
  const wrap = el('div', null, 'table-wrap');
  const node = el('table');
  const header = node.createTHead().insertRow();
  for (const name of headers) { const cell = el('th', name); cell.scope = 'col'; header.append(cell); }
  const body = node.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value;
  }
  wrap.append(node);
  return wrap;
}

function localFile(label, handle) {
  const holder = el('div', null, 'dynamics-controls');
  const input = el('input');
  input.type = 'file';
  input.hidden = true;
  input.accept = '.csv,text/csv';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (file) await handle(file);
  });
  holder.append(button(label, () => input.click()), input);
  return holder;
}

function nameOf(project, tag, ext) {
  const base = (project?.name || 'suspension').replace(/[^\p{L}\p{N}._-]+/gu, '-');
  return `${base}-${tag}.${ext}`;
}

function download(value, name, type) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = el('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function modelFamily(model) {
  return ['rigid', 'flex'].includes(model) ? 'full' : model;
}

function elapsedFrame(time, seconds) {
  let low = 0;
  let high = time.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (time[mid] <= seconds) low = mid;
    else high = mid - 1;
  }
  return low;
}

class Runtime {
  worker;
  calls = new Map();
  serial = 0;

  request(command, payload = {}, onProgress) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./dynamics-worker.js', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', ({ data }) => {
        const call = this.calls.get(data.id);
        if (!call) return;
        if (data.progress) { call.onProgress?.(data.progress); return; }
        this.calls.delete(data.id);
        if (data.ok) call.resolve(data.result);
        else call.reject(new Error(data.error || 'Dynamics solver failed.'));
      });
      this.worker.addEventListener('error', () => this.stop('Could not start the dynamics runtime.'));
    }
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, command, payload });
    });
  }

  stop(message = 'Calculation cancelled.') {
    this.worker?.terminate();
    this.worker = undefined;
    for (const call of this.calls.values()) call.reject(new Error(message));
    this.calls.clear();
  }
}

export function mountDynamics(host) {
  const runtime = new Runtime();
  const state = {
    project: null, base: null, panel: 'full', active: false, busy: false, needsGeometry: true,
    results: {}, activeChannel: 'heave_f', current: null, scan: null,
    group: 'Wheel loads', frame: 0, animation: 0, playbackRate: 1, displacementGain: 1, leftViews: {},
    transfer: { ...transferDefaults }, transferResult: null, generation: 0,
  };
  const shell = el('div', null, 'dynamics-layout');
  const nav = el('nav', null, 'dynamics-subnav');
  nav.setAttribute('aria-label', 'Dynamics tools');
  const message = el('p', null, 'notice');
  message.setAttribute('role', 'status');
  const content = el('div', null, 'app-content');
  shell.append(nav, message, content);
  host.append(shell);
  let viewer;
  let modelViewer;
  let auxiliaryViews = [];
  let monitorRows = [];
  let thresholdReadout;
  let extremaReadout;
  let pendingActivation;
  let renderedResult;
  let frameLabel;
  let frameSlider;
  let playButton;
  let liveMetrics;

  function transferFromProject(project) {
    const saved = project?.load_transfer?.distribution;
    return Object.fromEntries(Object.entries(transferDefaults).map(([key, value]) => [key, saved?.[key] ?? value]));
  }

  function status(text, error = false) {
    message.textContent = text;
    message.toggleAttribute('data-error', error);
  }

  function chartCard(title) {
    const panel = el('section', null, 'visual-panel');
    const header = el('div', null, 'visual-toolbar');
    const plot = el('div', null, 'plot');
    const canvas = el('canvas'); canvas.tabIndex = 0;
    let camera;
    let pending = { xLabel: 'Input', yLabel: 'Result', series: [] };
    header.append(el('h3', title), button('Fit', () => camera?.reset()));
    plot.append(canvas); panel.append(header, plot);
    queueMicrotask(() => {
      if (!canvas.isConnected) return;
      camera = new EngineeringView(canvas); auxiliaryViews.push(camera); camera.setChart(pending);
    });
    return { panel, set(chart) { pending = chart; camera?.setChart(chart); } };
  }

  function persistCase() {
    if (!state.project) return;
    const project = state.project;
    project.page_cases ??= {};
    if (project.page_cases.half) {
      const legacy = project.page_cases.half;
      if (families[legacy.model]) project.page_cases[legacy.model] ??= legacy;
      delete project.page_cases.half;
    }
    const family = modelFamily(project.model);
    if (project.case.scenario === 'csv' && project.case.recording.length < 2) delete project.page_cases[family];
    else project.page_cases[family] = { model: project.model, case: structuredClone(project.case) };
  }

  function fill() {
    if (!state.project) return;
    nav.replaceChildren(...Object.entries(prefixes).map(([key, text]) => {
      const link = button(text, () => {
        if (state.busy) return;
        stopPlayback();
        state.panel = key;
        status('');
        if (Object.hasOwn(families, key)) {
          const saved = state.project.page_cases?.[key]?.model;
          configureModel(saved || (key === 'full' ? 'flex' : key));
        } else fill();
      });
      link.setAttribute('aria-pressed', String(state.panel === key));
      link.disabled = state.busy;
      return link;
    }));
    viewer?.destroy();
    viewer = undefined;
    for (const chart of auxiliaryViews) chart.destroy();
    auxiliaryViews = [];
    monitorRows = [];
    thresholdReadout = undefined;
    extremaReadout = undefined;
    modelViewer?.destroy();
    modelViewer = undefined;
    const render = { full: renderRun, half_lr: renderRun, half_fr: renderRun, quarter: renderRun, vehicle: renderVehicle, components: renderComponents,
      geometry: renderLookup, aero: renderAero, transfer: renderTransfer }[state.panel];
    content.replaceChildren(render());
  }

  async function activate() {
    state.active = true;
    if (state.project && state.base) { fill(); return; }
    if (pendingActivation) return pendingActivation;
    status('Loading the dynamics solver…');
    pendingActivation = runtime.request('defaults').then(project => {
      state.base = structuredClone(project);
      state.project ??= project;
      persistCase();
      status('');
      if (state.active) fill();
    }).catch(error => {
      status(error.message, true);
      content.replaceChildren(button('Retry solver', activate));
      runtime.stop();
    }).finally(() => { pendingActivation = null; });
    return pendingActivation;
  }

  async function importProject(project) {
    const normalized = await runtime.request('importProject', { project });
    stopPlayback();
    state.generation++;
    state.project = normalized;
    state.transfer = transferFromProject(normalized);
    state.transferResult = null;
    state.needsGeometry = false;
    state.results = {};
    state.current = null;
    state.scan = null;
    state.panel = modelFamily(normalized.model);
    state.current = null;
    persistCase();
    if (state.active) fill();
  }

  function clearProject() {
    stopPlayback();
    state.generation++;
    state.project = state.base ? structuredClone(state.base) : null;
    state.transfer = { ...transferDefaults };
    state.transferResult = null;
    state.results = {};
    state.current = null;
    state.scan = null;
    state.needsGeometry = true;
  }

  function projectSnapshot() {
    persistCase();
    return state.project && structuredClone(state.project);
  }

  async function exportProject() {
    const project = projectSnapshot();
    return project && runtime.request('importProject', { project });
  }

  function runPanel() {
    return Object.assign(el('aside', null, 'panel sidebar'), { inert: state.busy });
  }

  function configureModel(model) {
    persistCase();
    const family = modelFamily(model);
    state.panel = family;
    const project = state.project;
    const saved = project.page_cases[family]?.case;
    project.model = model;
    project.case = structuredClone(saved ?? state.base.case);
    alignTarget();
    persistCase();
    state.current = state.results[model] || null;
    state.group = 'Wheel loads';
    state.frame = 0;
    state.scan = null;
    stopPlayback();
    status('');
    fill();
  }

  function sourceWheels() {
    const { model, model_sources: source } = state.project;
    if (model === 'quarter') return [source?.quarter ?? 'FL'];
    if (model === 'half_lr') return wheelTargets[source?.half_lr ?? 'front'];
    if (model === 'half_fr') return wheelTargets[source?.half_fr ?? 'left'];
    return wheelPositions;
  }

  function alignTarget() {
    const test = state.project.case;
    const targets = wheelTargets[test.target];
    if (!sourceWheels().some(wheel => targets?.includes(wheel))) test.target = sourceWheels()[0];
  }

  function renderCase() {
    const project = state.project;
    const { model, case: test } = project;
    const quarter = model === 'quarter';
    const roll = ['flex', 'rigid', 'half_lr'].includes(model);
    const pitch = ['flex', 'rigid', 'half_fr'].includes(model);
    const sourceOptions = { quarter: Object.fromEntries(wheelPositions.map(key => [key, key])),
      half_lr: { front: 'Front axle', rear: 'Rear axle' }, half_fr: { left: 'Left side', right: 'Right side' } };
    const scenarioOptions = Object.fromEntries(Object.entries(scenarios).filter(([key]) =>
      (key !== 'cornering' || roll) && (!['maneuver', 'combined'].includes(key) || !quarter)
      && (key !== 'random' || quarter)));
    const bump = ['bump', 'combined'].includes(test.scenario);
    const iso = test.scenario.startsWith('iso_');
    const step = test.scenario === 'step';
    const random = test.scenario === 'random';
    const targetedRoad = bump || iso || step || random;
    const maneuvers = ['cornering', 'maneuver', 'combined'].includes(test.scenario);
    const fields = ['dt', 'speed'];
    if (test.scenario !== 'csv') fields.unshift('duration', 'start');
    if (bump || step || random) fields.push('height');
    if (bump) fields.push('period');
    if (iso || random) fields.push('seed');
    if (random) {
      test.seed ??= state.base.case.seed;
      test.random_interval ??= state.base.case.random_interval;
      fields.push('random_interval');
    }
    if (maneuvers && test.scenario !== 'cornering' && pitch) fields.push('ax');
    if ((maneuvers || (iso && test.iso_lateral)) && roll) fields.push('ay');
    if (maneuvers || (iso && test.iso_lateral)) fields.push('ramp');
    const aside = runPanel();
    aside.append(el('h2', 'Simulation setup'), select('Model', Object.fromEntries(Object.entries(models).filter(([key]) => modelFamily(key) === modelFamily(model))), model, configureModel));
    if (sourceOptions[model]) {
      project.model_sources ??= {};
      project.model_sources[model] ??= Object.keys(sourceOptions[model])[0];
      aside.append(select(model === 'quarter' ? 'Corner' : model === 'half_lr' ? 'Axle' : 'Side', sourceOptions[model], project.model_sources[model], value => {
        project.model_sources[model] = value; alignTarget(); persistCase(); fill();
      }));
    }
    aside.append(select('Input condition', scenarioOptions, test.scenario, value => { test.scenario = value; persistCase(); fill(); }));
    if (targetedRoad) {
      const targets = Object.fromEntries(Object.entries(choices).filter(([key]) => sourceWheels().some(wheel => wheelTargets[key].includes(wheel))));
      aside.append(select('Input wheels', targets, test.target, value => { test.target = value; persistCase(); }));
    }
    const labels = { ...caseFields, height: step ? 'Step height (mm)' : random ? 'Height standard deviation (mm)' : caseFields.height };
    aside.append(numberGrid(test, Object.fromEntries(fields.map(key => [key, labels[key]])), persistCase));
    if ((bump || iso) && pitch) aside.append(check('Apply wheelbase delay to rear inputs', test.rear_delay, value => { test.rear_delay = value; persistCase(); }));
    if (targetedRoad || test.scenario === 'csv') {
      aside.append(check('Use tire road filter', test.tire_road_filter, value => {
        test.tire_road_filter = value; persistCase(); fill();
      }));
      if (test.tire_road_filter) {
        const modes = { average: 'Contact patch moving average', envelope: 'Circular tire envelope' };
        aside.append(select('Tire filter method', modes, test.tire_road_filter_mode ?? 'average', value => {
          test.tire_road_filter_mode = value; persistCase();
        }));
      }
    }
    if (iso && roll) aside.append(check('Add lateral acceleration', test.iso_lateral, value => { test.iso_lateral = value; persistCase(); fill(); }));
    if (test.scenario === 'csv') {
      aside.append(localFile('Import road CSV', importRoad));
      if (test.recording_name) aside.append(el('p', `${test.recording_name} · ${test.recording.length} rows`, 'muted'));
      aside.append(button('Download road CSV template', () => download('time_s,z_fl_mm,z_fr_mm,z_rl_mm,z_rr_mm,ax_mps2,ay_mps2\n0,0,0,0,0,0,0\n0.25,5,0,0,0,-2,1\n0.50,0,0,5,0,-3,2\n', 'road-replay-template.csv', 'text/csv')));
    }
    const controls = el('div', null, 'dynamics-controls');
    controls.append(button('Run simulation', () => run('simulate'), 'primary'), button('Run to CSV', () => run('simulateCsv')));
    if (model === 'half_lr') controls.append(button('Scan roll centre', () => run('rollCenterScan')));
    aside.append(controls);
    return aside;
  }

  async function importRoad(file) {
    try {
      const data = await runtime.request('parseCsv', { kind: 'road', text: await file.text() });
      if (data.missing?.length && !window.confirm(`Fill these missing channels with zero?\n${data.missing.join(', ')}`)) return;
      state.project.case.recording = data.rows;
      state.project.case.recording_name = file.name;
      persistCase();
      fill();
      status(`Loaded ${data.rows.length} road samples.`);
    } catch (error) { status(error.message, true); }
  }

  function renderRun() {
    const wrapper = el('div', null, 'work-grid run-workbench');
    wrapper.append(renderCase(), resultPanel(state.current));
    return wrapper;
  }

  function simulationLeftPanel(result, visuals, response, fullVehicle) {
    const family = state.panel;
    const monitorTitle = fullVehicle ? 'Full vehicle force monitor' : 'Wheel loads and attitude';
    const panel = el('section', null, 'visual-panel');
    panel.setAttribute('aria-label', 'Model animation and force monitor');
    const header = el('div', null, 'visual-toolbar');
    const gain = select('Motion scale', { 1: '1×', 2: '2×', 4: '4×', 8: '8×' }, String(state.displacementGain), value => {
      state.displacementGain = Number(value);
      if (result) drawResult(false);
    });
    gain.classList.add('compact-control');
    gain.querySelector('select').disabled = !result;
    const fit = button('Fit', () => modelViewer?.reset());
    const body = el('div', null, 'simulation-left-content');
    const plot = el('div', null, 'plot');
    const canvas = el('canvas');
    canvas.tabIndex = 0;
    plot.append(canvas);
    const monitor = forceMonitor(result, monitorTitle);
    const update = value => {
      state.leftViews[family] = value;
      const showMonitor = value === 'forces';
      if (fullVehicle) {
        visuals.classList.toggle('force-overview', showMonitor);
        response.hidden = showMonitor;
      }
      plot.inert = showMonitor;
      monitor.hidden = !showMonitor;
      gain.hidden = fit.hidden = showMonitor;
    };
    const view = state.leftViews[family] ?? 'model';
    const picker = select('Left panel view', { model: 'Model animation', forces: monitorTitle }, view, update);
    picker.classList.add('compact-control', 'left-view-picker');
    header.append(picker, gain, fit);
    body.append(plot, monitor);
    panel.append(header, body);
    update(view);
    queueMicrotask(() => {
      if (!canvas.isConnected) return;
      try {
        const camera = new EngineeringView(canvas);
        modelViewer = camera;
        const preview = result || {
          project: structuredClone(state.project), corners: sourceWheels(), time: [0], series: {},
          motion: [sourceWheels().map(() => [0, 0, 0])],
        };
        camera.setScene(buildPlaybackScene(preview, result ? state.frame : 0, { gain: state.displacementGain }), { showLabels: true });
      } catch (error) {
        if (!canvas.isConnected) return;
        status(`${error.message} Showing schematic playback.`, true);
        stopPlayback(); fill();
      }
    });
    return panel;
  }

  async function run(command) {
    if (state.busy) return;
    stopPlayback();
    state.busy = true;
    state.scan = null;
    status('Preparing simulation…');
    fill();
    const project = projectSnapshot();
    const generation = state.generation;
    try {
      const result = await runtime.request(command, { project }, progress => {
        if (generation !== state.generation) return;
        const indicator = content.querySelector('#solver-progress');
        if (indicator && progress.total) indicator.value = progress.current / progress.total;
        if (progress.message) status(progress.message);
      });
      if (generation !== state.generation) return;
      if (command === 'simulateCsv') {
        download(result.csv, nameOf(project, 'simulation', 'csv'), 'text/csv');
        status(`Exported ${result.count} samples.${result.warnings?.length ? `\n${result.warnings.join('\n')}` : ''}`);
      } else if (command === 'rollCenterScan') {
        state.scan = result;
        status(`Evaluated ${result.heights.length} roll-centre heights.`);
      } else {
        state.current = result;
        state.results[result.project.model] = result;
        state.frame = 0;
        status(`Calculated ${result.time.length} output samples.`);
      }
    } catch (error) { if (generation === state.generation) status(error.message, error.message !== 'Calculation cancelled.'); }
    finally { state.busy = false; if (state.active) fill(); }
  }

  function scanPanel() {
    const result = state.scan;
    const panel = el('section', null, 'panel data-panel');
    panel.append(el('h2', 'Roll-centre scan'), el('p', `Best height ${fmt(result.heights[result.best_index])} mm · peak absolute load-transfer rate ${fmt(result.peaks[result.best_index])} N/s`, 'muted'));
    const tools = el('div', null, 'dynamics-controls');
    tools.append(button('View best case', () => { stopPlayback(); state.current = result.best_result; state.frame = 0; fill(); }),
      button('Download scan CSV', () => downloadCsv(result.heights.map((value, index) => ({ height_mm: value, peak_transfer_rate_nps: result.peaks[index] })), nameOf(state.project, 'roll-centre-scan', 'csv'))));
    panel.append(tools, table(['Height (mm)', 'Peak rate (N/s)'], result.heights.map((value, index) => [fmt(value), fmt(result.peaks[index])])));
    return panel;
  }

  function resultPanel(result) {
    const panel = el('section', null, 'panel analysis-panel');
    panel.setAttribute('aria-label', 'Analysis results');
    const header = el('div', null, 'analysis-heading');
    header.append(el('h2', 'Analysis results'));
    const exports = el('div', null, 'result-files');
    const format = el('select');
    format.setAttribute('aria-label', 'Download format');
    for (const [value, label] of Object.entries({ csv: 'Results CSV', chart: 'Chart PNG', model: 'Model PNG', snapshot: 'Snapshot JSON' })) format.add(new Option(label, value));
    const downloadButton = button('Download', async () => {
      try {
        if (format.value === 'csv') exportResult(result);
        else if (format.value === 'snapshot') download(`${JSON.stringify(result.project, null, 2)}\n`, nameOf(result.project, 'calculation', 'json'), 'application/json');
        else {
          const camera = format.value === 'model' ? modelViewer : viewer;
          await camera.ready;
          camera.draw();
          await downloadPng(camera.canvas, nameOf(result.project, format.value, 'png'));
        }
      } catch (error) { status(error.message, true); }
    });
    format.disabled = downloadButton.disabled = !result;
    exports.append(format, downloadButton);
    header.append(exports);
    const controls = el('div', null, 'result-controls');
    const groups = result ? Object.fromEntries(Object.keys(result.groups).map(key => [key, key])) : { empty: 'Run a simulation' };
    if (result && !result.groups[state.group]) state.group = Object.keys(result.groups)[0];
    const signals = select('Signal group', groups, result ? state.group : 'empty', value => {
      state.group = value; drawResult(false);
    });
    signals.querySelector('select').disabled = !result;
    controls.append(signals);
    const note = el('p', result ? `${models[result.project.model]} · ${result.time.length.toLocaleString('en-US')} samples` : 'Run a simulation to view motion and response curves.', 'result-note');
    const visuals = el('div', null, 'simulation-visuals');
    const response = el('section', null, 'visual-panel response-visual');
    response.setAttribute('aria-label', 'Time response');
    const chartHeader = el('div', null, 'visual-toolbar');
    chartHeader.append(el('h3', 'Time response'), button('Fit', () => viewer?.reset()));
    const plot = el('div', null, 'plot');
    const canvas = el('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Suspension time response plot');
    plot.append(canvas);
    response.append(chartHeader, plot);
    thresholdReadout = el('div', null, 'threshold-readout');
    const extremaDetails = el('details', null, 'plot-details');
    extremaReadout = el('div');
    extremaDetails.append(el('summary', 'Curve extrema'), extremaReadout);
    response.append(thresholdReadout, extremaDetails);
    const fullVehicle = state.panel === 'full';
    visuals.classList.toggle('full-vehicle-visuals', fullVehicle);
    visuals.append(simulationLeftPanel(result, visuals, response, fullVehicle), response);
    const transport = el('div', null, 'playback-bar');
    frameLabel = el('output', '0.000 s', 'playback-clock');
    frameSlider = el('input');
    frameSlider.type = 'range';
    frameSlider.min = 0;
    frameSlider.max = result ? result.time.length - 1 : 0;
    frameSlider.value = result ? state.frame : 0;
    frameSlider.setAttribute('aria-label', 'Playback sample');
    frameSlider.addEventListener('input', () => { stopPlayback(); state.frame = frameSlider.valueAsNumber; drawResult(true); });
    playButton = button('Play', togglePlayback);
    const previous = button('Previous', () => stepFrame(-1));
    const next = button('Next', () => stepFrame(1));
    const speed = select('Playback speed', { '0.25': '0.25×', '0.5': '0.5×', '1': '1×', '2': '2×' }, String(state.playbackRate), value => {
      stopPlayback(); state.playbackRate = Number(value);
    });
    speed.classList.add('compact-control');
    for (const control of [playButton, previous, next, frameSlider, speed.querySelector('select')]) control.disabled = !result;
    transport.append(playButton, previous, next, frameSlider, frameLabel, speed);
    liveMetrics = el('div', null, 'live-wheel-loads');
    panel.append(header, controls, note, visuals, transport, liveMetrics);
    if (state.busy) {
      const running = el('div', null, 'calculation-progress');
      const progress = el('progress', null, 'dynamics-progress');
      progress.id = 'solver-progress'; progress.max = 1;
      progress.setAttribute('aria-label', 'Calculation progress');
      running.append(progress, button('Cancel', () => runtime.stop()));
      panel.append(running);
    }
    if (state.scan) panel.append(scanPanel());
    if (result) panel.append(resultMetrics(result));
    queueMicrotask(() => {
      if (!canvas.isConnected) return;
      viewer = new EngineeringView(canvas);
      renderedResult = result;
      if (result) drawResult(false);
      else viewer.setChart({ xLabel: 'Time (s)', yLabel: 'Result', series: [] });
    });
    return panel;
  }

  function drawResult(preserve) {
    const result = renderedResult;
    if (!result || !viewer) return;
    const index = Math.max(0, Math.min(result.time.length - 1, state.frame));
    const seconds = result.time[index];
    frameLabel.value = `${fmt(seconds, 4)} s / ${fmt(result.time.at(-1), 4)} s`;
    frameSlider.value = index;
    modelViewer?.setScene(buildPlaybackScene(result, index, { gain: state.displacementGain }), { preserveView: preserve, showLabels: true });
    const names = result.groups[state.group] || [];
    const chart = names.map((label, channelIndex) => ({
      ...signalSeries(result, label), color: plotColours[channelIndex % plotColours.length],
    }));
    const units = [...new Set(names.map(name => name.match(/\[([^\]]+)\]$/)?.[1]).filter(Boolean))];
    const thresholds = wheelTravelGuides(result, names);
    const guideColours = { 'Tender bind': '#ffe082', 'Compression stop': '#ff879e', 'Rebound stop': '#7bd7ff' };
    const guides = thresholds.map(guide => ({ ...guide, color: guideColours[guide.kind], dash: [6, 4] }));
    viewer.setChart({ xLabel: 'Time (s)', yLabel: units.length === 1 ? units[0] : state.group,
      series: chart, guides, showExtrema: true, currentX: seconds }, { preserveView: preserve });
    if (!preserve) {
      extremaReadout.replaceChildren(table(['Signal', 'Point', 'Value', 'Time (s)'], chart.flatMap(series =>
        series.extrema.map(entry => [series.label, entry.kind, fmt(entry.point[1], 6), fmt(entry.point[0], 6)]))));
    }
    thresholdReadout.replaceChildren();
    if (thresholds.length) {
      const details = el('details', null, 'plot-details');
      details.open = state.thresholdsOpen ?? false;
      details.addEventListener('toggle', () => { state.thresholdsOpen = details.open; });
      details.append(el('summary', 'Stiffness transition lines'),
        el('p', 'Dashed lines show Tender bind and active travel stops. Coupled-channel thresholds follow the other wheels’ simulated travel.', 'muted'),
        table(['Wheel / channel / transition', 'Wheel travel now (mm)'], thresholds.map(guide => [guide.label, fmt(guide.points[index][1])])));
      thresholdReadout.append(details);
    }
    for (const row of monitorRows) {
      const value = row.values?.[index];
      row.output.textContent = Number.isFinite(value) ? fmt(value, row.precision) : '—';
      const position = Number.isFinite(value) ? Math.max(0, Math.min(1, (value - row.low) / (row.high - row.low))) : row.zero;
      if (row.bar) {
        row.bar.style.top = `${(1 - Math.max(position, row.zero)) * 100}%`;
        row.bar.style.height = `${Math.abs(position - row.zero) * 100}%`;
        row.bar.toggleAttribute('data-negative', value < 0);
      }
    }
    liveMetrics.replaceChildren(...result.corners.map(corner => {
      const key = Object.keys(result.series).find(label => label === `${corner} [N]` || label.startsWith(`${corner} wheel load`));
      return el('span', `${corner} ${fmt(result.series[key]?.[index], 1)} N`, 'muted');
    }));
  }

  function forceMonitor(result, title) {
    const panel = el('section', null, 'force-monitor');
    panel.setAttribute('aria-label', title);
    if (!result) {
      panel.append(el('p', 'Run a simulation to view wheel loads, suspension forces and body motion.'));
      return panel;
    }
    const groups = el('div', null, 'monitor-groups');
    for (const group of result.monitor || []) {
      const section = el('section', null, 'monitor-group');
      const bodyMotion = group.title === 'Body motion';
      if (bodyMotion) section.classList.add('motion-readouts');
      section.append(el('h3', group.title));
      let extent = 1;
      let signed = false;
      for (const item of group.rows) for (const value of result.series[item.signal] || []) {
        extent = Math.max(extent, Math.abs(value));
        if (value < 0) signed = true;
      }
      const low = signed ? -extent * 1.1 : 0;
      const high = extent * 1.1;
      const zero = -low / (high - low);
      const chart = el('div', null, bodyMotion ? 'monitor-readout-list' : 'force-bar-chart');
      const columns = el('div', null, bodyMotion ? 'monitor-readouts' : 'force-columns');
      if (!bodyMotion) {
        const scale = el('div', null, 'force-scale');
        scale.setAttribute('aria-hidden', 'true');
        scale.append(el('span', fmt(high, 0), 'force-scale-high'), el('span', fmt(low, 0), 'force-scale-low'));
        if (signed) {
          const zeroLabel = el('span', '0', 'force-scale-zero');
          zeroLabel.style.top = `${(1 - zero) * 100}%`;
          scale.append(zeroLabel);
        }
        chart.append(scale);
      }
      for (const [index, item] of group.rows.entries()) {
        const row = el('div', null, bodyMotion ? 'monitor-readout' : 'force-column');
        const output = el('output', '—');
        output.setAttribute('aria-label', `${group.title} · ${item.label}`);
        let bar;
        if (bodyMotion) row.append(el('span', item.label), output);
        else {
          const track = el('div', null, 'force-bar-track');
          track.setAttribute('role', 'img');
          track.setAttribute('aria-label', `${item.label} force bar`);
          bar = el('i', null, 'force-bar');
          bar.style.height = '0%';
          bar.style.backgroundColor = plotColours[index % plotColours.length];
          const axis = el('i', null, 'force-zero-line');
          axis.style.top = `${(1 - zero) * 100}%`;
          track.append(axis, bar);
          row.append(output, track, el('span', item.label, 'force-bar-label'));
        }
        columns.append(row);
        monitorRows.push({ values: result.series[item.signal], output, bar, low, high, zero, precision: bodyMotion ? 2 : 0 });
      }
      chart.append(columns);
      section.append(chart);
      groups.append(section);
    }
    panel.append(groups);
    return panel;
  }

  function stopPlayback() {
    cancelAnimationFrame(state.animation);
    state.animation = 0;
    if (playButton) playButton.textContent = 'Play';
  }

  function stepFrame(delta) {
    stopPlayback();
    state.frame = Math.max(0, Math.min(renderedResult.time.length - 1, state.frame + delta));
    drawResult(true);
  }

  function togglePlayback() {
    if (state.animation) { stopPlayback(); return; }
    const time = renderedResult.time;
    if (state.frame >= time.length - 1) state.frame = 0;
    const start = performance.now();
    const offset = time[state.frame];
    playButton.textContent = 'Pause';
    const animate = now => {
      const target = offset + (now - start) / 1000 * state.playbackRate;
      const frame = elapsedFrame(time, target);
      if (frame !== state.frame) { state.frame = frame; drawResult(true); }
      if (target >= time.at(-1)) stopPlayback();
      else state.animation = requestAnimationFrame(animate);
    };
    state.animation = requestAnimationFrame(animate);
  }

  function exportResult(result) {
    const labels = Object.keys(result.series);
    const columns = ['time_s', ...labels];
    const rows = result.time.map((time, index) => [time, ...labels.map(label => result.series[label][index])]);
    downloadCsv(rows, nameOf(result.project, 'simulation', 'csv'), columns);
  }

  function resultMetrics(result) {
    const section = el('details', null, 'panel data-panel results-details');
    section.open = state.resultsOpen ?? false;
    section.addEventListener('toggle', () => { state.resultsOpen = section.open; });
    section.append(el('summary', 'Current results'));
    const summary = [`Heave acceleration RMS ${fmt(result.metrics.body_rms)} m/s²`, `${result.steps.toLocaleString('en-US')} integration steps`];
    section.append(el('p', summary.join(' · '), 'muted'));
    const headers = ['Corner', 'Initial load (N)', 'Minimum load (N)', 'Maximum load (N)', 'Minimum travel (mm)', 'Maximum travel (mm)', 'Unloaded time (s)'];
    section.append(table(headers, result.corners.map(corner => {
      const [initial, low, high, , minTravel, maxTravel, air] = result.metrics[corner];
      return [corner, ...[initial, low, high, minTravel, maxTravel, air].map(value => fmt(value))];
    })));
    if (result.metrics.load_transfer_rate) section.append(table(['Transfer path', 'Peak rate (N/s)', 'Time (s)'], Object.entries(result.metrics.load_transfer_rate).map(([path, [rate, time]]) => [path, fmt(rate), fmt(time)])));
    if (result.warnings?.length) section.append(el('p', result.warnings.join('\n'), 'notice'));
    return section;
  }

  function renderVehicle() {
    const project = state.project;
    const section = el('section', null, 'panel data-panel');
    section.append(el('h2', 'Vehicle settings'));
    section.append(numberGrid(project.vehicle, vehicleFields));
    const name = el('input');
    name.type = 'text'; name.value = project.name;
    name.addEventListener('change', () => { if (name.value.trim()) project.name = name.value.trim(); });
    section.append(field('Project name', name));
    const corners = el('div', null, 'settings-grid border-section');
    for (const corner of wheelPositions) {
      const wheel = el('section', null, 'stack');
      project.tires[corner].radius ??= state.base.tires[corner].radius;
      wheel.append(el('h3', corner), numberGrid(project.tires[corner], { mu: 'Unsprung mass (kg)', k: 'Vertical stiffness (N/mm)', c: 'Vertical damping (N·s/m)', radius: 'Free tire radius (m)' }));
      corners.append(wheel);
    }
    project.roll_center_frame ??= legacyFrame(project);
    const frame = project.roll_center_frame;
    const roll = el('section', null, 'border-section');
    roll.append(el('h3', 'Half-car chassis force path'), check('Enable chassis force compliance', frame.enabled, value => { frame.enabled = value; fill(); }));
    if (frame.enabled) roll.append(numberGrid(frame, { stiffness: 'Equivalent stiffness (N/m)', damping: 'Equivalent damping (N·s/m)', mass: 'Equivalent mass (kg)' }));
    section.append(corners, roll);
    return section;
  }

  function renderComponents() {
    const project = state.project;
    const channel = state.activeChannel;
    const setup = project.channels[channel];
    const section = el('section', null, 'panel data-panel');
    section.append(el('h2', 'Springs and dampers'), select('Suspension channel', channels, channel, value => { state.activeChannel = value; status(''); fill(); }));
    const scope = el('div', null, 'toggle-list');
    scope.append(el('h3', 'Enabled by model'));
    for (const [key, label] of Object.entries(families)) scope.append(check(label, setup.enabled_models?.[key] ?? setup.enabled, value => {
      setup.enabled_models ??= {};
      setup.enabled_models[key] = value;
    }));
    section.append(scope, select('Spring type', { single: 'Single spring', tender: 'Tender and main spring', stages: 'Staged rate', force: 'Force CSV lookup' }, setup.spring_kind, value => {
      setup.spring_kind = value;
      if (value === 'force' && setup.spring.length < 2) setup.spring = [[0, 0], [10, 10 * setup.main_rate]];
      if (value === 'stages') setup.spring = [[0, setup.main_rate]];
      if (value === 'tender' && !setup.main_rate) setup.main_rate = 1;
      fill();
    }));
    const springNumbers = { installed_mm: 'Installation preload (mm)', jounce_mm: 'Compression stop after static trim (mm)',
      jounce_rate: 'Compression stop total rate (N/mm)', rebound_mm: 'Rebound stop from installed position (mm)', rebound_rate: 'Rebound stop total rate (N/mm)' };
    if (['single', 'tender'].includes(setup.spring_kind)) springNumbers.main_rate = 'Main spring rate (N/mm)';
    if (setup.spring_kind === 'tender') Object.assign(springNumbers, { tender_rate: 'Tender rate (N/mm)', tender_after_static_mm: 'Tender bind after static trim (mm)' });
    section.append(numberGrid(setup, springNumbers));
    if (setup.spring_kind === 'force') section.append(componentFile('Import spring force CSV', 'spring', setup), el('p', `${setup.spring.length} spring samples`, 'muted'));
    if (setup.spring_kind === 'stages') section.append(editCurve('Shaft travel (mm), spring rate (N/mm)', setup.spring, rows => { setup.spring = rows; }));
    const key = damperMode(setup);
    section.append(select('Damper type', { single: 'Shared linear coefficient', split: 'Separate compression and rebound', bilinear: 'Low and high speed', force: 'Force CSV lookup', stages: 'Staged coefficients (legacy)' }, key, value => {
      if (value === 'stages' && !['single', 'split', 'bilinear', 'stages'].includes(setup.damper_kind)) {
        setup.compression = [[0, 0]]; setup.rebound = [[0, 0]];
      }
      const fromForce = key === 'force';
      const compression = fromForce ? 0 : setup.compression[0][1];
      const rebound = fromForce ? 0 : setup.rebound[0][1];
      if (value === 'force') {
        setup.compression = [[0, 0], [.1, .1 * compression]];
        setup.rebound = [[0, 0], [.1, .1 * rebound]];
      }
      if (value === 'single' || value === 'split') {
        setup.compression = [[0, compression]];
        setup.rebound = [[0, value === 'single' ? compression : rebound]];
      }
      if (value === 'bilinear') {
        setup.compression = [[0, compression], [.1, compression]];
        setup.rebound = [[0, rebound], [.1, rebound]];
      }
      setup.damper_kind = value;
      if (!['single', 'split', 'bilinear'].includes(value)) setup.damper_ratio = false;
      fill();
    }));
    if (key === 'force') section.append(componentFile('Import damper force CSV', 'damper', setup), el('p', `${setup.compression.length} damper samples`, 'muted'));
    else if (key === 'stages') section.append(...['compression', 'rebound'].map(side => editCurve(`${side === 'compression' ? 'Compression' : 'Rebound'} speed (m/s), coefficient (N·s/m)`, setup[side], rows => { setup[side] = rows; })));
    else {
      section.append(check('Enter damping ratios (ζ)', setup.damper_ratio, async value => {
        const before = setup.damper_kind;
        try {
          const copy = projectSnapshot();
          copy.channels[channel].damper_kind = key;
          const critical = await runtime.request('dampingScale', { project: copy, channel });
          if (value && critical === 0 && ['compression', 'rebound'].some(side => setup[side].some(([, coefficient]) => coefficient))) {
            throw new Error('Zero spring stiffness cannot convert a nonzero damping coefficient to a ratio.');
          }
          const scale = value && critical ? 1 / critical : critical;
          for (const side of ['compression', 'rebound']) setup[side] = setup[side].map(([speed, coefficient]) => [speed, coefficient * scale]);
          setup.damper_kind = key;
          setup.damper_ratio = value;
          status('');
        } catch (error) { setup.damper_kind = before; status(error.message, true); }
        fill();
      }));
      const grid = el('div', null, 'form-grid');
      const unit = setup.damper_ratio ? 'ζ' : 'N·s/m';
      for (const side of key === 'single' ? ['compression'] : ['compression', 'rebound']) {
        const label = key === 'single' ? 'Damper coefficient' : side === 'compression' ? 'Compression' : 'Rebound';
        grid.append(number(`${label}${key === 'bilinear' ? ' low speed' : ''} (${unit})`, setup[side][0][1], value => {
          setup[side][0][1] = value;
          if (key === 'single') setup.rebound[0][1] = value;
        }, { min: 0 }));
        if (key === 'bilinear') grid.append(number(`${label} high speed (${unit})`, setup[side][1][1], value => { setup[side][1][1] = value; }, { min: 0 }),
          number(`${label} switch speed (m/s)`, setup[side][1][0], value => { setup[side][1][0] = value; }, { min: .0001 }));
      }
      section.append(grid);
    }
    const tableMode = setup.mr.length > 1 || state.motionRatioTable === channel;
    section.append(select('Motion ratio type', { fixed: 'Fixed motion ratio', lookup: 'CSV lookup' }, tableMode ? 'lookup' : 'fixed', value => {
      if (value === 'fixed') { state.motionRatioTable = null; setup.mr = [[0, setup.mr[0][1]]]; }
      else state.motionRatioTable = channel;
      fill();
    }));
    if (tableMode) section.append(componentFile('Import motion ratio CSV', 'mr', setup), el('p', `${setup.mr.length} motion-ratio samples`, 'muted'));
    else section.append(number('Motion ratio', setup.mr[0][1], value => { setup.mr = [[0, value]]; }, { min: .000001 }));
    const wrapper = el('div', null, 'work-grid run-workbench');
    wrapper.classList.add('components-workbench');
    section.className = 'panel sidebar';
    const previews = el('section', null, 'panel analysis-panel');
    const plots = el('div', null, 'component-charts');
    const cards = Object.fromEntries(['spring', 'damper', 'mr'].map(key => [key, chartCard({ spring: 'Spring and travel stops', damper: 'Damper force', mr: 'Motion ratio' }[key])]));
    plots.append(...Object.values(cards).map(card => card.panel));
    const notes = el('p', '', 'notice');
    let revision = 0;
    let timer;
    const refresh = async () => {
      if (!previews.isConnected) return;
      const request = ++revision;
      notes.textContent = 'Updating component curves…';
      try {
        const curves = await runtime.request('componentCurves', { project: projectSnapshot(), channel });
        if (!previews.isConnected || request !== revision) return;
        for (const key of ['spring', 'damper', 'mr']) {
          const chart = curves[key];
          cards[key].set({ xLabel: chart.xlabel, yLabel: chart.ylabel,
            series: chart.series.map(series => ({ label: chart.title, points: series.x.map((x, index) => [x, series.y[index]]) })) });
        }
        notes.textContent = curves.notes.join(' ');
        notes.removeAttribute('data-error');
      } catch (error) {
        if (!previews.isConnected || request !== revision) return;
        notes.textContent = error.message;
        notes.setAttribute('data-error', '');
        for (const card of Object.values(cards)) card.set({ xLabel: 'Input', yLabel: 'Result', series: [] });
      }
    };
    section.addEventListener('change', () => { revision++; clearTimeout(timer); timer = setTimeout(refresh, 180); });
    previews.append(el('h2', 'Component curves'), notes, plots);
    section.append(button('Refresh curves', refresh));
    wrapper.append(section, previews);
    queueMicrotask(refresh);
    return wrapper;
  }

  function damperMode(setup) {
    const kind = setup.damper_kind;
    if (typeof kind === 'object' || kind === 'force') return 'force';
    if (kind !== 'stages') return kind;
    if (setup.compression.length !== 1 || setup.rebound.length !== 1) return 'stages';
    return setup.compression[0][1] === setup.rebound[0][1] ? 'single' : 'split';
  }

  function componentFile(label, kind, setup) {
    return localFile(label, async file => {
      try {
        const data = await runtime.request('parseCsv', { kind, text: await file.text() });
        Object.assign(setup, data.curves);
        if (kind === 'damper') {
          setup.damper_kind = 'force';
          setup.damper_ratio = false;
        }
        fill();
        status(`Loaded ${file.name}.`);
      } catch (error) { status(error.message, true); }
    });
  }

  function editCurve(title, values, onChange) {
    const area = el('textarea');
    area.rows = 4;
    area.value = values.map(row => row.join(',')).join('\n');
    area.addEventListener('change', () => {
      const rows = area.value.trim().split(/\r?\n/).map(line => line.split(',').map(value => value.trim() ? Number(value) : NaN));
      if (rows.some(row => row.length !== 2 || row.some(value => !Number.isFinite(value)))) {
        status('Enter two comma-separated finite values on each row.', true);
        return;
      }
      onChange(rows);
      status('');
    });
    return field(title, area);
  }

  function renderLookup() {
    const project = state.project;
    const section = el('section', null, 'panel analysis-panel lookup-page');
    section.append(el('h2', 'Geometry lookup'), el('p', 'Each axle uses its average wheel travel relative to no-aero, no-acceleration static equilibrium. Positive travel is compression.', 'result-note'));
    const columns = el('div', null, 'lookup-columns');
    const keys = { roll_center: ['h_rc_f', 'h_rc_r'], anti: ['dive_front', 'lift_rear', 'lift_front', 'squat_rear'] };
    const names = { roll_center: ['Front roll centre', 'Rear roll centre'],
      anti: ['Front anti-dive', 'Rear braking anti-lift', 'Front drive anti-lift', 'Rear anti-squat'] };
    project.geometry_tables ??= {};
    project.geometry_modes ??= {};
    for (const [kind, columnNames] of Object.entries(geometryColumns)) {
      const title = kind === 'anti' ? 'Anti geometry' : 'Roll centre';
      const block = el('section', null, 'lookup-column');
      const controls = el('div', null, 'lookup-controls stack');
      const chart = chartCard(title);
      const caption = el('p', '', 'notice');
      const units = kind === 'anti' ? 100 : 1000;
      const mode = project.geometry_modes[kind] || (project.geometry_tables[kind] ? 'lookup' : 'fixed');
      const draw = () => {
        let rows;
        if (mode === 'lookup') {
          rows = project.geometry_tables[kind];
          if (!rows?.length) {
            caption.textContent = 'Import a CSV table to display the relationship.';
            chart.set({ xLabel: 'Relative static wheel travel (mm)', yLabel: kind === 'anti' ? 'Anti (%)' : 'Height (mm)', series: [] });
            return;
          }
          caption.textContent = `${rows.length} samples · ${fmt(rows[0][0])} to ${fmt(rows.at(-1)[0])} mm`;
          if (rows.length === 1) rows = [[rows[0][0] - 1, ...rows[0].slice(1)], [rows[0][0] + 1, ...rows[0].slice(1)]];
        } else {
          const values = keys[kind].map(key => project.vehicle[key] * units);
          rows = [-20, 20].map(travel => [travel, ...values]);
          caption.textContent = kind === 'anti' ? 'Fixed ratios · 0.15 = 15%' : 'Fixed heights shown in millimetres.';
        }
        chart.set({ xLabel: 'Relative static wheel travel (mm)', yLabel: kind === 'anti' ? 'Anti (%)' : 'Height (mm)',
          series: names[kind].map((label, index) => ({ label, points: rows.map(row => [row[0], row[index + 1]]) })) });
      };
      controls.append(select(`${title} data source`, { fixed: 'Fixed values', lookup: 'CSV travel lookup' }, mode, value => {
        project.geometry_modes[kind] = value;
        fill();
      }));
      if (mode === 'fixed') {
        const fields = el('div', null, 'form-grid');
        for (const key of keys[kind]) fields.append(number(geometryFields[key], project.vehicle[key], value => {
          project.vehicle[key] = value; draw();
        }, { min: kind === 'anti' ? -2 : -10, max: kind === 'anti' ? 2 : 10 }));
        controls.append(fields);
      } else {
        controls.append(localFile('Import lookup CSV', async file => {
          try {
            const data = await runtime.request('parseCsv', { kind, text: await file.text() });
            if (project !== state.project) return;
            project.geometry_tables[kind] = data.rows;
            project.geometry_modes[kind] = 'lookup';
            fill();
            status(`Imported ${file.name} · ${data.rows.length} samples.`);
          } catch (error) { status(error.message, true); }
        }));
      }
      const tools = el('div', null, 'dynamics-controls');
      tools.append(button('Download CSV template', () => {
        const values = keys[kind].map(key => project.vehicle[key] * units);
        const rows = [-20, 0, 20].map(travel => Object.fromEntries(columnNames.map((key, index) => [key, index === 0 ? travel : values[index - 1]])));
        downloadCsv(rows, `${kind}-template.csv`, columnNames);
      }));
      const stored = project.geometry_tables[kind];
      if (stored) tools.append(button('Download current CSV', () => downloadCsv(stored.map(row =>
        Object.fromEntries(columnNames.map((key, index) => [key, row[index]]))), nameOf(project, kind, 'csv'), columnNames)));
      controls.append(tools, caption);
      block.append(controls, chart.panel);
      if (stored) {
        const details = el('details', null, 'lookup-samples');
        details.append(el('summary', `Lookup samples (${stored.length})`), table(columnNames, stored.map(row => row.map(value => fmt(value)))));
        block.append(details);
      }
      columns.append(block);
      draw();
    }
    section.append(columns);
    return section;
  }

  function renderAero() {
    const project = state.project;
    project.aero ??= structuredClone(state.base.aero);
    const aero = project.aero;
    const section = el('section', null, 'panel data-panel aero-page');
    const panel = el('section', null, 'panel figure-panel');
    const plot = el('div', null, 'plot');
    const canvas = el('canvas');
    canvas.tabIndex = 0;
    plot.append(canvas);
    const output = el('p', null, 'muted');
    const draw = () => {
      const speed = project.case.speed * 3.6;
      const factor = aero.enabled ? aero.reference_force_n / aero.reference_speed_kmh ** 2 : 0;
      const upper = Math.max(40, 1.1 * speed, 1.2 * aero.reference_speed_kmh);
      const points = Array.from({ length: 81 }, (_, index) => {
        const v = upper * index / 80;
        return [v, factor * v ** 2];
      });
      viewer?.setChart({ xLabel: 'Speed (km/h)', yLabel: 'Downforce (N)', currentX: speed, series: [{ label: 'Vehicle downforce', points }] });
      output.textContent = `${fmt(factor * speed ** 2)} N at the current simulation speed of ${fmt(speed)} km/h.`;
    };
    panel.append(plot);
    const referenceFields = el('div', null, 'form-grid aero-reference-fields');
    referenceFields.append(
      number('Reference speed (km/h)', aero.reference_speed_kmh, value => { aero.reference_speed_kmh = value; draw(); }, { min: .1, max: 540 }),
      number('Reference downforce (N)', aero.reference_force_n, value => { aero.reference_force_n = value; draw(); }, { min: 0, max: 1000000 }));
    section.append(el('h2', 'Aerodynamics'), check('Enable downforce', aero.enabled, value => { aero.enabled = value; draw(); }), referenceFields, output, panel);
    queueMicrotask(() => { if (canvas.isConnected) { viewer = new EngineeringView(canvas); draw(); } });
    return section;
  }

  function renderTransfer() {
    const wrapper = el('div', null, 'work-grid run-workbench');
    const setup = el('aside', null, 'panel sidebar');
    const section = el('section', null, 'panel analysis-panel');
    const options = state.transfer;
    const readout = el('div', null, 'stack');
    const charts = el('div', null, 'transfer-charts');
    const cards = Object.fromEntries(['Wheel loads', 'Body roll', 'Transfer distribution', 'Three-path moments'].map(title => [title, chartCard(title)]));
    charts.append(...Object.values(cards).map(card => card.panel));
    let revision = 0;
    let timer;
    const calculate = async () => {
      if (!section.isConnected) return;
      const request = ++revision;
      calculateButton.disabled = true;
      status('Calculating lateral load transfer…');
      try {
        const result = await runtime.request('loadTransfer', { project: projectSnapshot(), options: { ...options } });
        if (!section.isConnected || request !== revision) return;
        state.transferResult = result;
        renderTransferResult(readout, result);
        const { ay_g: x, states } = result.sweep;
        const series = (label, values) => ({ label, points: x.map((ay, index) => [ay, values[index]]) });
        const set = (title, yLabel, lines) => cards[title].set({ xLabel: 'Lateral acceleration (g)', yLabel, currentX: options.ay, series: lines });
        set('Wheel loads', 'Normal load (N)', wheelPositions.map((corner, index) => series(corner, states.map(row => row.loads[index]))));
        set('Body roll', 'Roll angle (°)', [series('Body roll', states.map(row => row.roll))]);
        set('Transfer distribution', 'Inside to outside transfer (N)', ['Front', 'Rear'].map((axle, index) => series(axle, states.map(row => row.lateral[index]))));
        set('Three-path moments', 'Moment (N·m)', ['Unsprung', 'Geometric', 'Elastic'].flatMap((path, index) =>
          ['Front', 'Rear'].map((axle, end) => series(`${axle} ${path}`, states.map(row => row.paths[index][end])))));
        status('');
      } catch (error) { if (section.isConnected && request === revision) status(error.message, true); }
      finally { if (section.isConnected && request === revision) calculateButton.disabled = false; }
    };
    const update = () => {
      state.project.load_transfer ??= {};
      state.project.load_transfer.distribution = { ...state.project.load_transfer.distribution, ...options };
      state.transferResult = null;
      revision++;
      readout.replaceChildren();
      for (const card of Object.values(cards)) card.set({ xLabel: 'Lateral acceleration (g)', yLabel: 'Result', series: [] });
      clearTimeout(timer); timer = setTimeout(calculate, 180);
    };
    const calculateButton = button('Calculate load transfer', calculate, 'primary');
    setup.append(el('h2', 'Load transfer settings'), ...[
      ['ay', 'Lateral acceleration (g)', -3, 3], ['radius', 'Corner radius (m)', 2, 5000],
      ['height_f', 'Front unsprung CG height (mm)', 0, 2000], ['height_r', 'Rear unsprung CG height (mm)', 0, 2000],
    ].map(([key, title, min, max]) => number(title, options[key], value => { options[key] = value; update(); }, { min, max })), calculateButton);
    const details = el('details', null, 'detail-section');
    details.append(el('summary', 'Calculation details'), readout);
    section.append(el('h2', 'Quasi-static load transfer'), charts, details);
    wrapper.append(setup, section);
    queueMicrotask(calculate);
    return wrapper;
  }

  function renderTransferResult(holder, result) {
    const paths = ['Unsprung', 'Geometric', 'Elastic'];
    const summary = [['Speed (km/h)', result.speed_kmh], ['Body roll (°)', result.roll], ['Roll gradient (°/g)', result.roll_gradient], ['Front transfer share (%)', result.front_share == null ? null : result.front_share * 100]];
    holder.replaceChildren(
      table(['Result', 'Value'], summary.map(([key, value]) => [key, fmt(value)])),
      table(['Corner', 'Normal load (N)', 'Baseline load (N)'], wheelPositions.map((corner, index) => [corner, fmt(result.loads[index]), fmt(result.baseline[index])])),
      table(['Path', 'Front moment (N·m)', 'Rear moment (N·m)'], paths.map((path, index) => [path, ...result.paths[index].map(value => fmt(value))])),
      table(['Axle', 'Transfer (N)', 'Roll stiffness (N·m/rad)'], ['Front', 'Rear'].map((axle, index) => [axle, fmt(result.lateral[index]), fmt(result.roll_stiffness[index])])),
      button('Download load transfer CSV', () => downloadCsv(wheelPositions.map((corner, index) => ({ corner, load_n: result.loads[index], baseline_load_n: result.baseline[index] })), nameOf(state.project, 'load-transfer', 'csv'))),
    );
  }

  return {
    activate() {
      return activate();
    },
    deactivate() { state.active = false; stopPlayback(); },
    exportProject,
    importProject,
    clearProject,
    async newProject() {
      runtime.stop(); stopPlayback(); state.generation++; state.busy = false;
      clearProject(); state.panel = 'full';
      await activate();
    },
    run() { if (!state.busy && Object.hasOwn(families, state.panel)) return run('simulate'); },
  };
}
