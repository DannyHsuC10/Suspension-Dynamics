import { EngineeringView } from './views.js';
import { buildPlaybackScene } from './dynamics-playback.js';
import { buildVehicle, geometryLookupRows } from './kinematics.js';
import { csvText, downloadCsv, downloadPng } from './exports.js';
import { LP02View } from './lp02.js';

const models = { flex: 'Full vehicle · 8 DOF, flexible chassis', rigid: 'Full vehicle · 7 DOF, rigid chassis', half_lr: 'Half vehicle · left/right', half_fr: 'Half vehicle · front/rear', quarter: 'Quarter vehicle · 2 DOF' };
const scenarios = { bump: 'Road bump or dip', iso_a: 'ISO 8608 Class A', iso_b: 'ISO 8608 Class B', iso_c: 'ISO 8608 Class C', cornering: 'Lateral acceleration', maneuver: 'Braking, acceleration or cornering', combined: 'Bump with acceleration', csv: 'Recorded CSV replay' };
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
  ax: 'Longitudinal acceleration (m/s²)', ay: 'Lateral acceleration (m/s²)', ramp: 'Acceleration rise time (s)' };
const geometryColumns = {
  roll_center: ['travel_mm', 'front_rc_mm', 'rear_rc_mm'],
  anti: ['travel_mm', 'front_anti_dive_pct', 'rear_anti_lift_pct', 'front_anti_lift_pct', 'rear_anti_squat_pct'],
};
const prefixes = { run: 'Simulation', vehicle: 'Vehicle and vertical response', components: 'Springs and dampers',
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

export function mountDynamics(host, { geometry }) {
  const runtime = new Runtime();
  const state = {
    project: null, base: null, panel: 'run', active: false, busy: false, needsGeometry: true,
    results: {}, baselines: {}, activeChannel: 'heave_f', current: null, scan: null,
    mode: 'chart', group: 'Wheel loads', frame: 0, animation: 0, playbackRate: 1, displacementGain: 1,
    transfer: { ...transferDefaults }, transferResult: null, generation: 0,
  };
  const shell = el('div', null, 'dynamics-layout');
  const nav = el('nav', null, 'dynamics-subnav');
  nav.setAttribute('aria-label', 'Dynamics tools');
  const message = el('p', null, 'notice');
  message.setAttribute('role', 'status');
  const content = el('div');
  shell.append(nav, message, content);
  host.append(shell);
  let viewer;
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

  function updateShared() {
    if (!state.project) return;
    const source = geometry();
    for (const key of Object.keys(sharedFields)) state.project.vehicle[key] = source.vehicle[key];
    state.project.name = source.name;
    state.needsGeometry = false;
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
        fill();
      });
      link.setAttribute('aria-pressed', String(state.panel === key));
      link.disabled = state.busy;
      return link;
    }));
    viewer?.destroy();
    viewer = undefined;
    const render = { run: renderRun, vehicle: renderVehicle, components: renderComponents,
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
      if (state.needsGeometry) updateShared();
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
    state.baselines = {};
    state.current = null;
    state.scan = null;
    persistCase();
  }

  function clearProject() {
    stopPlayback();
    state.generation++;
    state.project = state.base ? structuredClone(state.base) : null;
    state.transfer = { ...transferDefaults };
    state.transferResult = null;
    state.results = {};
    state.baselines = {};
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
      (key !== 'cornering' || roll) && (!['maneuver', 'combined'].includes(key) || !quarter)));
    const bump = ['bump', 'combined'].includes(test.scenario);
    const iso = test.scenario.startsWith('iso_');
    const maneuvers = ['cornering', 'maneuver', 'combined'].includes(test.scenario);
    const fields = ['dt', 'speed'];
    if (test.scenario !== 'csv') fields.unshift('duration', 'start');
    if (bump) fields.push('height', 'period');
    if (iso) fields.push('seed');
    if (maneuvers && test.scenario !== 'cornering' && pitch) fields.push('ax');
    if ((maneuvers || (iso && test.iso_lateral)) && roll) fields.push('ay');
    if (maneuvers || (iso && test.iso_lateral)) fields.push('ramp');
    const aside = runPanel();
    aside.append(el('h2', 'Simulation setup'), select('Model', models, model, configureModel));
    if (sourceOptions[model]) {
      project.model_sources ??= {};
      project.model_sources[model] ??= Object.keys(sourceOptions[model])[0];
      aside.append(select(model === 'quarter' ? 'Corner' : model === 'half_lr' ? 'Axle' : 'Side', sourceOptions[model], project.model_sources[model], value => {
        project.model_sources[model] = value; alignTarget(); persistCase(); fill();
      }));
    }
    aside.append(select('Input condition', scenarioOptions, test.scenario, value => { test.scenario = value; persistCase(); fill(); }));
    if (bump || iso) {
      const targets = Object.fromEntries(Object.entries(choices).filter(([key]) => sourceWheels().some(wheel => wheelTargets[key].includes(wheel))));
      aside.append(select('Input wheels', targets, test.target, value => { test.target = value; persistCase(); }));
    }
    aside.append(numberGrid(test, Object.fromEntries(fields.map(key => [key, caseFields[key]])), persistCase));
    if ((bump || iso) && pitch) aside.append(check('Apply wheelbase delay to rear inputs', test.rear_delay, value => { test.rear_delay = value; persistCase(); }));
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
    const wrapper = el('div', null, 'work-grid');
    const right = el('div', null, 'result-grid');
    wrapper.append(renderCase(), right);
    if (state.busy) {
      const running = el('section', null, 'panel data-panel');
      const progress = el('progress', null, 'dynamics-progress');
      progress.id = 'solver-progress';
      progress.max = 1;
      progress.setAttribute('aria-label', 'Calculation progress');
      running.append(el('h2', 'Calculating'), progress, button('Cancel', () => runtime.stop()));
      right.append(running);
    }
    if (state.scan) right.append(scanPanel());
    if (state.current) right.append(resultPanel(state.current), resultMetrics(state.current));
    else if (!state.busy) {
      const empty = el('section', null, 'panel data-panel');
      empty.append(el('h2', 'Results'), el('p', 'Choose a model and input condition, then run a simulation to inspect traces and playback.', 'muted'));
      right.append(empty);
    }
    return wrapper;
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

  function baselineFor(result) {
    const baseline = state.baselines[result.project.model];
    return baseline && JSON.stringify(baseline.signature) === JSON.stringify(result.signature) ? baseline : null;
  }

  function resultPanel(result) {
    const panel = el('section', null, 'panel figure-panel');
    const header = el('div', null, 'figure-header');
    const displays = { chart: 'Time series', playback: 'Schematic playback' };
    if (result.corners.length === 4) displays.lp02 = 'LP02 3D playback';
    if (!Object.hasOwn(displays, state.mode)) state.mode = 'chart';
    header.append(el('h2', 'Simulation output'), select('Display', displays, state.mode, value => { stopPlayback(); state.mode = value; fill(); }));
    const toolbar = el('div', null, 'plot-toolbar');
    if (!result.groups[state.group]) state.group = Object.keys(result.groups)[0];
    if (state.mode === 'chart') {
      const groups = Object.fromEntries(Object.keys(result.groups).map(key => [key, key]));
      toolbar.append(select('Signal group', groups, state.group, value => { state.group = value; drawResult(false); }));
    } else {
      toolbar.append(el('span', 'Drag to orbit or pan · Scroll to zoom'));
    }
    if (state.mode === 'playback') toolbar.append(select('Displacement gain', { 1: '1×', 2: '2×', 4: '4×', 8: '8×' }, String(state.displacementGain), value => {
      state.displacementGain = Number(value);
      drawResult(false);
    }));
    toolbar.append(button('Fit view', () => viewer?.reset()));
    const plot = el('div', null, 'plot');
    const canvas = el('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Suspension dynamics plot');
    plot.append(canvas);
    const transport = el('div', null, 'data-panel');
    const timeline = el('div', null, 'dynamics-controls');
    frameLabel = el('output', '', 'muted');
    frameSlider = el('input');
    frameSlider.type = 'range';
    frameSlider.min = 0;
    frameSlider.max = result.time.length - 1;
    frameSlider.value = state.frame;
    frameSlider.setAttribute('aria-label', 'Playback sample');
    frameSlider.addEventListener('input', () => { stopPlayback(); state.frame = frameSlider.valueAsNumber; drawResult(true); });
    playButton = button('Play', togglePlayback);
    timeline.append(playButton, button('Previous frame', () => stepFrame(-1)), button('Next frame', () => stepFrame(1)),
      select('Playback speed', { '0.25': '0.25×', '0.5': '0.5×', '1': '1×', '2': '2×' }, String(state.playbackRate), value => { stopPlayback(); state.playbackRate = Number(value); }), frameLabel);
    liveMetrics = el('div', null, 'dynamics-controls');
    transport.append(timeline, frameSlider, liveMetrics);
    const actions = el('div', null, 'export-bar');
    actions.append(button('Set as baseline A', () => { state.baselines[result.project.model] = result; status('Current result saved as baseline A.'); fill(); }),
      button('Download CSV', () => exportResult(result)),
      button('Download snapshot JSON', () => download(`${JSON.stringify(result.project, null, 2)}\n`, nameOf(result.project, 'calculation', 'json'), 'application/json')),
      button('Download PNG', async () => {
        try { await viewer.ready; viewer.draw(); await downloadPng(canvas, nameOf(result.project, 'simulation', 'png')); }
        catch (error) { status(error.message, true); }
      }));
    panel.append(header, toolbar, plot, transport, actions);
    queueMicrotask(async () => {
      if (!canvas.isConnected) return;
      try {
        const camera = state.mode === 'lp02' ? new LP02View(canvas) : new EngineeringView(canvas);
        viewer = camera;
        renderedResult = result;
        drawResult(false);
        if (camera.ready) {
          const label = el('p', 'Loading LP02 CAD geometry…', 'plot-message');
          plot.append(label);
          await camera.ready;
          label.remove();
        }
      } catch (error) {
        if (!canvas.isConnected) return;
        status(`${error.message} Showing schematic playback.`, true);
        stopPlayback();
        state.mode = 'playback';
        fill();
      }
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
    if (state.mode === 'lp02') viewer.setFrame(result, index);
    else if (state.mode === 'playback') viewer.setScene(buildPlaybackScene(result, index, { gain: state.displacementGain }), { preserveView: preserve, showConstruction: true, showLabels: true });
    else {
      const names = result.groups[state.group] || [];
      const stride = Math.max(1, Math.floor(result.time.length / 2500));
      const baseline = baselineFor(result);
      const chart = names.map((label, channelIndex) => {
        const values = result.series[label];
        return { label, color: plotColours[channelIndex % plotColours.length], points: sampledPairs(result.time, values, stride) };
      });
      if (baseline && baseline !== result) for (const [channelIndex, label] of names.entries()) {
        if (!baseline.series[label]) continue;
        chart.push({ label: `A · ${label}`, color: plotColours[channelIndex % plotColours.length], dash: [6, 5], points: sampledPairs(baseline.time, baseline.series[label], Math.max(1, Math.floor(baseline.time.length / 2500))) });
      }
      const units = [...new Set(names.map(name => name.match(/\[([^\]]+)\]$/)?.[1]).filter(Boolean))];
      viewer.setChart({ xLabel: 'Time (s)', yLabel: units.length === 1 ? units[0] : state.group, series: chart, currentX: seconds }, { preserveView: preserve });
    }
    liveMetrics.replaceChildren(...result.corners.map(corner => {
      const key = Object.keys(result.series).find(label => label === `${corner} [N]` || label.startsWith(`${corner} wheel load`));
      return el('span', `${corner} ${fmt(result.series[key]?.[index], 1)} N`, 'muted');
    }));
  }

  function sampledPairs(time, values, stride) {
    const points = [];
    for (let i = 0; i < time.length; i += stride) points.push([time[i], values[i]]);
    if ((time.length - 1) % stride) points.push([time.at(-1), values.at(-1)]);
    return points;
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
    const section = el('section', null, 'panel data-panel');
    const baseline = baselineFor(result);
    section.append(el('h2', 'Tuning metrics'));
    const summary = [`Heave acceleration RMS ${fmt(result.metrics.body_rms)} m/s²`, `${result.steps.toLocaleString('en-US')} integration steps`];
    if (baseline && baseline !== result) summary.push(`RMS B − A ${fmt(result.metrics.body_rms - baseline.metrics.body_rms)} m/s²`);
    section.append(el('p', summary.join(' · '), 'muted'));
    const headers = ['Corner', 'Initial load (N)', 'Minimum load (N)', 'Maximum load (N)', 'Minimum travel (mm)', 'Maximum travel (mm)', 'Unloaded time (s)'];
    const compare = baseline && baseline !== result;
    if (compare) headers.push('Min. load B − A (N)');
    section.append(table(headers, result.corners.map(corner => {
      const [initial, low, high, , minTravel, maxTravel, air] = result.metrics[corner];
      const row = [corner, ...[initial, low, high, minTravel, maxTravel, air].map(value => fmt(value))];
      if (compare) row.push(fmt(low - baseline.metrics[corner][1]));
      return row;
    })));
    if (result.metrics.load_transfer_rate) section.append(table(['Transfer path', 'Peak rate (N/s)', 'Time (s)'], Object.entries(result.metrics.load_transfer_rate).map(([path, [rate, time]]) => [path, fmt(rate), fmt(time)])));
    if (result.warnings?.length) section.append(el('p', result.warnings.join('\n'), 'notice'));
    if (state.baselines[result.project.model] && !baseline) section.append(el('p', 'Baseline A uses a different model source or input condition.', 'muted'));
    return section;
  }

  function renderVehicle() {
    const project = state.project;
    const section = el('section', null, 'panel data-panel');
    section.append(el('h2', 'Vehicle and vertical response'));
    const shared = el('div', null, 'metrics');
    for (const [key, label] of Object.entries(sharedFields)) {
      const card = el('div');
      card.append(el('dt', label), el('dd', fmt(project.vehicle[key])));
      shared.append(card);
    }
    section.append(shared, el('p', 'Edit these shared dimensions using Vehicle settings in the header.', 'muted'),
      numberGrid(project.vehicle, Object.fromEntries(Object.entries(vehicleFields).filter(([key]) => !(key in sharedFields)))));
    const corners = el('div', null, 'settings-grid border-section');
    for (const corner of wheelPositions) {
      const wheel = el('section', null, 'stack');
      wheel.append(el('h3', corner), numberGrid(project.tires[corner], { mu: 'Unsprung mass (kg)', k: 'Vertical stiffness (N/mm)', c: 'Vertical damping (N·s/m)' }));
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
    const plotHost = el('div', null, 'stack');
    section.append(button('Plot component curves', async () => {
      status('Calculating component curves…');
      try {
        const curves = await runtime.request('componentCurves', { project: projectSnapshot(), channel });
        const display = el('div', null, 'figure-panel panel');
        const chartHeader = el('div', null, 'figure-header');
        const plot = el('div', null, 'plot');
        const canvas = el('canvas');
        canvas.tabIndex = 0;
        plot.append(canvas);
        const options = Object.fromEntries(['spring', 'damper', 'mr'].map(key => [key, curves[key].title]));
        const draw = key => {
          const chart = curves[key];
          viewer.setChart({ xLabel: chart.xlabel, yLabel: chart.ylabel, series: chart.series.map(series => ({ label: chart.title, points: series.x.map((x, i) => [x, series.y[i]]) })) });
        };
        chartHeader.append(select('Component curve', options, 'spring', draw), button('Fit view', () => viewer.reset()));
        display.append(chartHeader, plot);
        plotHost.replaceChildren(display, el('p', curves.notes.join(' '), 'muted'));
        viewer?.destroy();
        viewer = new EngineeringView(canvas);
        draw('spring');
        status('');
      } catch (error) { status(error.message, true); }
    }), plotHost);
    return section;
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
    const section = el('section', null, 'panel data-panel');
    section.append(el('h2', 'Geometry lookup'), el('p', 'Travel is relative to no-aero static equilibrium. Positive travel is compression.', 'muted'), numberGrid(project.vehicle, geometryFields));
    project.geometry_tables ??= {};
    project.geometry_modes ??= {};
    for (const [kind, columnNames] of Object.entries(geometryColumns)) {
      const block = el('section', null, 'border-section');
      const title = kind === 'anti' ? 'Anti geometry' : 'Roll centre';
      const mode = project.geometry_modes[kind] || (project.geometry_tables[kind] ? 'lookup' : 'fixed');
      block.append(el('h3', title), select('Data source', { fixed: 'Fixed values', lookup: 'Travel lookup table' }, mode, value => {
        if (value === 'lookup' && !project.geometry_tables[kind]?.length) {
          status('Import or generate a lookup table first.', true);
          fill();
          return;
        }
        project.geometry_modes[kind] = value;
        fill();
      }));
      const saveRows = rows => {
        project.geometry_tables[kind] = rows;
        project.geometry_modes[kind] = 'lookup';
        fill();
        status(`Applied ${rows.length} lookup samples.`);
      };
      const tools = el('div', null, 'dynamics-controls');
      tools.append(localFile('Import lookup CSV', async file => {
        try { saveRows((await runtime.request('parseCsv', { kind, text: await file.text() })).rows); }
        catch (error) { status(error.message, true); }
      }), button('Use vehicle geometry', async () => {
        try {
          const rows = geometryLookupRows(buildVehicle(geometry()), kind);
          if (!rows.length) throw new Error('No valid lookup samples in the configured travel range.');
          const validated = await runtime.request('parseCsv', { kind, text: csvText(rows, columnNames) });
          saveRows(validated.rows);
        } catch (error) { status(error.message, true); }
      }), button('Download CSV template', () => {
        const samples = [-25, 0, 25].map(travel => Object.fromEntries(columnNames.map((key, i) => [key, i === 0 ? travel : (kind === 'anti' ? 15 : 25)])));
        downloadCsv(samples, `${kind}-template.csv`, columnNames);
      }));
      const rows = project.geometry_tables[kind];
      if (rows) tools.append(button('Download current CSV', () => downloadCsv(rows.map(row => Object.fromEntries(columnNames.map((key, i) => [key, row[i]]))), nameOf(project, kind, 'csv'), columnNames)));
      block.append(tools);
      if (rows) {
        const details = el('details');
        details.append(el('summary', `${rows.length} samples`), table(columnNames, rows.map(row => row.map(value => fmt(value)))));
        block.append(details);
      }
      section.append(block);
    }
    return section;
  }

  function renderAero() {
    const project = state.project;
    project.aero ??= structuredClone(state.base.aero);
    const aero = project.aero;
    const section = el('section', null, 'panel data-panel');
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
    section.append(el('h2', 'Aerodynamics'), check('Enable downforce', aero.enabled, value => { aero.enabled = value; draw(); }),
      number('Reference speed (km/h)', aero.reference_speed_kmh, value => { aero.reference_speed_kmh = value; draw(); }, { min: .1, max: 540 }),
      number('Reference downforce (N)', aero.reference_force_n, value => { aero.reference_force_n = value; draw(); }, { min: 0, max: 1000000 }), output, panel);
    queueMicrotask(() => { if (canvas.isConnected) { viewer = new EngineeringView(canvas); draw(); } });
    return section;
  }

  function renderTransfer() {
    const section = el('section', null, 'panel data-panel');
    const options = state.transfer;
    const readout = el('div', null, 'stack');
    const runTransfer = button('Calculate load transfer', async () => {
      runTransfer.disabled = true;
      status('Calculating lateral load transfer…');
      try {
        const project = projectSnapshot();
        const result = await runtime.request('loadTransfer', { project, options });
        state.transferResult = result;
        renderTransferResult(readout, result);
        status('');
      } catch (error) { status(error.message, true); }
      finally { runTransfer.disabled = false; }
    }, 'primary');
    const update = () => {
      state.project.load_transfer ??= {};
      state.project.load_transfer.distribution = { ...state.project.load_transfer.distribution, ...options };
      state.transferResult = null;
      readout.replaceChildren();
    };
    const fields = el('div', null, 'form-grid');
    fields.append(...[
      ['ay', 'Lateral acceleration (g)', -3, 3], ['radius', 'Corner radius (m)', 2, 5000],
      ['height_f', 'Front unsprung CG height (mm)', 0, 2000], ['height_r', 'Rear unsprung CG height (mm)', 0, 2000],
    ].map(([key, title, min, max]) => number(title, options[key], value => { options[key] = value; update(); }, { min, max })));
    section.append(el('h2', 'Quasi-static load transfer'), fields, runTransfer, readout);
    if (state.transferResult) renderTransferResult(readout, state.transferResult);
    return section;
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
      if (state.project && state.needsGeometry) updateShared();
      return activate();
    },
    deactivate() { state.active = false; stopPlayback(); },
    exportProject,
    importProject,
    clearProject,
    geometryChanged() {
      state.generation++;
      state.needsGeometry = true;
      state.transferResult = null;
      updateShared();
      if (state.active) fill();
    },
  };
}
