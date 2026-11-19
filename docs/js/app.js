import { buildVehicle, defaultProject, geometryFromProject, solveView } from './kinematics.js';
import { EngineeringView } from './views.js';
import { downloadCsv, downloadHardpointsCsv, downloadMembersCsv, downloadPng, downloadStep } from './exports.js';
import { mountDynamics } from './dynamics.js';

const $ = id => document.getElementById(id);
const corners = ['FL', 'FR', 'RL', 'RR'];
const hardpointKeys = ['upper_front', 'upper_rear', 'upper_ball', 'lower_front', 'lower_rear', 'lower_ball'];
const info = {
  front: ['Front FV', 'Front axle geometry in the lateral plane'],
  rear: ['Rear FV', 'Rear axle geometry in the lateral plane'],
  side: ['Side View (SV)', 'Longitudinal suspension geometry and anti characteristics'],
  wheel: ['Wheel End (WE3D)', 'Wheel centre, steering axis and contact-point geometry'],
  static: ['Static Full Car', 'Four-corner suspension hardpoints in the vehicle frame'],
};
const vehicleFields = [
  ['m', 'Total mass (kg)', '.01', '1'], ['lf', 'CG to front axle (m)', '.001', '.01'],
  ['lr', 'CG to rear axle (m)', '.001', '.01'], ['tf', 'Front track (m)', '.001', '.01'],
  ['tr', 'Rear track (m)', '.001', '.01'], ['h_cg', 'CG height (m)', '.001', '0'],
  ['gravity', 'Gravity (m/s²)', '.01', '.01'], ['clearance', 'Static clearance (m)', '.001', '0'],
  ['free_radius', 'Unloaded wheel radius (m)', '.001', '.01'], ['wheel_width', 'Wheel width (m)', '.001', '.01'],
  ['brake_front', 'Front brake bias (fraction)', '.01', '0', '1'],
  ['drive_front', 'Front drive split (fraction)', '.01', '0', '1'],
];
const axleFields = [
  ['fvsa', 'Front-view swing arm (m)', '.001', '.01'], ['rc', 'Design roll centre height (m)', '.001'],
  ['svsa', 'Side-view swing arm (m)', '.001', '.01'], ['kpi', 'Kingpin inclination (°)', '.1'],
  ['caster', 'Caster (°)', '.1'], ['camber', 'Static camber (°)', '.1'], ['toe', 'Static toe (°)', '.1'],
  ['scrub', 'Scrub radius (m)', '.001'], ['trail', 'Mechanical trail (m)', '.001'],
  ['upperOffset', 'Upper ball joint height above wheel centre (m)', '.001'],
  ['lowerOffset', 'Lower ball joint drop below wheel centre (m)', '.001', '0'],
  ['upperInboard', 'Upper inboard pivot distance from centreline (m)', '.001', '0'],
  ['lowerInboard', 'Lower inboard pivot distance from centreline (m)', '.001', '0'],
  ['upperSpan', 'Upper chassis mount separation (m)', '.001', '.001'],
  ['lowerSpan', 'Lower chassis mount separation (m)', '.001', '.001'],
  ['brakeAnti', 'Braking anti (fraction)', '.01'], ['driveAnti', 'Drive anti (fraction)', '.01'],
];
const defaults = { travelMm: 0, steerDeg: 0, rollDeg: 0, pitchDeg: 0, corner: 'FL', side: 'left', sweepMinMm: -40, sweepMaxMm: 40, samples: 41 };
const state = { project: defaultProject(), page: 'front', poses: {}, chart: 'geometry', view: null, draft: null };
const viewer = new EngineeringView($('geometry-plot'));
const dynamics = mountDynamics($('dynamics-workspace'), { geometry: () => state.project });

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function notify(message = '', error = false) {
  $('status').textContent = message;
  $('status').toggleAttribute('data-error', error);
}

function numberText(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 3, useGrouping: false }).format(value)
    : value == null ? '—' : String(value);
}

function filename(tag, extension) {
  const name = (state.project.name || 'SuspensionDynamicsLab').replace(/[^\p{L}\p{N}._-]+/gu, '-');
  return `${name}${tag ? `-${tag}` : ''}.${extension}`;
}

function saveJSON(value, name) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }));
  const link = node('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeSelect(items, current) {
  const select = node('select');
  for (const [value, name] of items) select.add(new Option(name, value));
  select.value = current;
  return select;
}

function labelField(label, input) {
  const container = node('label', null, 'field');
  container.append(node('span', label), input);
  return container;
}

function numberInput(value, step = 'any', min, max) {
  const input = node('input');
  input.type = 'number';
  input.value = value ?? '';
  input.step = step;
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  input.required = true;
  return input;
}

function pose() {
  const scan = state.project.scan || {};
  const isWheel = state.page === 'wheel';
  state.poses[state.page] ??= { ...defaults, sweepVariable: isWheel ? 'steer' : 'travel',
    sweepMinMm: -(isWheel ? scan.steer_deg : scan.droop_mm), sweepMaxMm: isWheel ? scan.steer_deg : scan.bump_mm, samples: scan.samples ?? 41 };
  return state.poses[state.page];
}

function rangeControl(key, label, min, max, step) {
  const current = pose();
  const field = node('div', null, 'field');
  const title = node('label', label);
  title.htmlFor = `pose-${key}`;
  const pair = node('div', null, 'input-pair');
  const slider = numberInput(current[key], step, min, max);
  slider.type = 'range';
  slider.id = `pose-${key}`;
  const numeric = numberInput(current[key], step, min, max);
  numeric.setAttribute('aria-label', label);
  const update = (source, target) => {
    if (!source.validity.valid || !Number.isFinite(source.valueAsNumber)) return;
    target.value = source.value;
    current[key] = source.valueAsNumber;
    updateGeometry(true);
  };
  slider.addEventListener('input', () => update(slider, numeric));
  numeric.addEventListener('change', () => {
    if (numeric.reportValidity()) update(numeric, slider);
  });
  pair.append(slider, numeric);
  field.append(title, pair);
  return field;
}

function renderPose() {
  const page = state.page;
  const current = pose();
  const fields = $('pose-fields');
  fields.replaceChildren();
  if (page === 'wheel') {
    const corner = makeSelect(corners.map(key => [key, key]), current.corner);
    corner.addEventListener('change', () => { current.corner = corner.value; updateGeometry(false); });
    fields.append(labelField('Corner', corner));
  }
  if (page === 'side') {
    const side = makeSelect([['left', 'Left'], ['right', 'Right']], current.side);
    side.addEventListener('change', () => { current.side = side.value; updateGeometry(false); });
    fields.append(labelField('Vehicle side', side));
  }
  if (page !== 'static') {
    const sweep = state.project.scan || {};
    fields.append(rangeControl('travelMm', 'Wheel travel (mm)', -Math.abs(sweep.droop_mm ?? 40), sweep.bump_mm ?? 40, .5));
  }
  if (page === 'front' || page === 'rear') fields.append(rangeControl('rollDeg', 'Body roll (°)', -8, 8, .1));
  if (page === 'side') fields.append(rangeControl('pitchDeg', 'Body pitch (°)', -8, 8, .1));
  if (page === 'wheel') {
    const limit = Math.abs(state.project.scan?.steer_deg ?? 35);
    fields.append(rangeControl('steerDeg', 'Steering angle (°)', -limit, limit, .1));
  }
  if (page === 'static') fields.append(node('p', 'Zero wheel travel and steering. Edit the reference geometry in Vehicle settings.', 'muted'));
  $('reset-pose').hidden = page === 'static';
  $('scan-settings').hidden = page === 'static';
  $('sweep-fields').replaceChildren();
  if (page === 'static') return;
  const options = { travel: 'Wheel travel (mm)' };
  if (page === 'wheel') options.steer = 'Steering (°)';
  if (page === 'front' || page === 'rear') options.roll = 'Body roll (°)';
  if (page === 'side') options.pitch = 'Body pitch (°)';
  const sweep = makeSelect(Object.entries(options), current.sweepVariable);
  const scan = state.project.scan;
  const bounds = { travel: [-scan.droop_mm, scan.bump_mm, 300], steer: [-scan.steer_deg, scan.steer_deg, 85], roll: [-5, 5, 15], pitch: [-5, 5, 15] };
  sweep.addEventListener('change', () => {
    current.sweepVariable = sweep.value;
    [current.sweepMinMm, current.sweepMaxMm] = bounds[sweep.value];
    renderPose();
    updateGeometry(false);
  });
  $('sweep-fields').append(labelField('Sweep variable', sweep));
  const [, , limit] = bounds[current.sweepVariable];
  const sweepSpecs = [['sweepMinMm', 'Sweep minimum', -limit, 0], ['sweepMaxMm', 'Sweep maximum', 0, limit]];
  for (const [key, label, min, max] of [...sweepSpecs, ['samples', 'Sample count', 3, 201]]) {
    const input = numberInput(current[key], key === 'samples' ? 1 : 'any', min, max);
    input.addEventListener('change', () => {
      if (!input.reportValidity()) return;
      const minimum = key === 'sweepMinMm' ? input.valueAsNumber : current.sweepMinMm;
      const maximum = key === 'sweepMaxMm' ? input.valueAsNumber : current.sweepMaxMm;
      if (minimum === maximum) {
        notify('The sweep endpoints must be different.', true);
        input.value = current[key];
        return;
      }
      current[key] = input.valueAsNumber;
      updateGeometry(true);
    });
    $('sweep-fields').append(labelField(label, input));
  }
}

function metricsTable(metrics) {
  return metrics.map(({ label, value, unit }) => {
    const entry = node('div');
    const description = node('dd', numberText(value));
    if (unit && value != null) description.append(node('small', ` ${unit}`));
    entry.append(node('dt', label), description);
    return entry;
  });
}

function gridTable(rows) {
  if (!rows?.length) return node('p', 'No samples to display.', 'muted');
  const table = node('table');
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const heading = table.createTHead().insertRow();
  for (const key of columns) {
    const label = node('th', pretty(key));
    label.scope = 'col';
    heading.append(label);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const entry = body.insertRow();
    for (const key of columns) entry.insertCell().textContent = numberText(row[key]);
  }
  return table;
}

function pretty(key) {
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, char => char.toUpperCase());
}

function sweepOptions(view) {
  if (state.page === 'static' || !view.rows.length) return { x: null, y: [] };
  const row = view.rows.find(candidate => Object.values(candidate).some(Number.isFinite));
  if (!row) return { x: null, y: [] };
  const keys = Object.keys(row);
  const x = view.axis?.key || keys.find(key => Number.isFinite(row[key]));
  return { x, y: keys.filter(key => key !== x && view.rows.some(sample => Number.isFinite(sample[key]))) };
}

function drawGeometry(preserveView = false) {
  const view = state.view;
  if (!view) return;
  const plots = sweepOptions(view);
  const display = $('chart-mode');
  display.replaceChildren(new Option('Linkage geometry', 'geometry'), ...plots.y.map(key => new Option(pretty(key), key)));
  if (state.chart !== 'geometry' && !plots.y.includes(state.chart)) state.chart = 'geometry';
  display.value = state.chart;
  $('chart-field').hidden = !plots.y.length;
  const is3D = state.chart === 'geometry' && ['wheel', 'static'].includes(state.page);
  $('projection').hidden = !is3D;
  $('view-toggles').hidden = state.chart !== 'geometry';
  $('plot-hint').textContent = is3D ? 'Drag to orbit · Shift-drag to pan · Scroll to zoom' : 'Drag to pan · Scroll to zoom';
  if (state.chart === 'geometry') {
    viewer.setScene(view, { preserveView, showConstruction: $('construction').checked, showLabels: $('point-labels').checked });
    if (is3D && !preserveView) viewer.setProjection($('projection').value);
  } else {
    viewer.setChart({
      xLabel: view.axis ? `${view.axis.label} (${view.axis.unit})` : pretty(plots.x), yLabel: pretty(state.chart),
      currentX: pose()[view.axis?.control],
      series: [{ label: pretty(state.chart), points: view.rows.map(row => [row[plots.x], row[state.chart]]) }],
    }, { preserveView });
  }
}

function updateGeometry(preserveView = false) {
  if (state.page === 'dynamics') return;
  try {
    const current = pose();
    const view = solveView(state.model, state.page, current);
    state.view = view;
    $('metrics').replaceChildren(...metricsTable(view.metrics));
    $('sample-title').textContent = state.page === 'static' ? `Geometry points (${view.points.length})` : `Sweep data (${view.rows.length} samples)`;
    const sweepOption = $('export-format').querySelector('option[value=sweep]');
    sweepOption.disabled = state.page === 'static';
    if (sweepOption.disabled && sweepOption.selected) $('export-format').value = 'state';
    if ($('sample-section').open) renderSamples();
    $('result-caption').textContent = state.page === 'static' ? 'Vehicle frame · X forward, Y left, Z up' : 'Values at the current pose';
    drawGeometry(preserveView);
    $('export-geometry').disabled = false;
    notify();
  } catch (error) {
    notify(error.message, true);
    $('export-geometry').disabled = true;
  }
}

function renderSamples() {
  const view = state.view;
  if (!view) return;
  $('samples').replaceChildren(gridTable(state.page === 'static' ? view.points.map(point => ({
    corner: point.corner, hardpoint: point.label, x_m: point.position[0], y_m: point.position[1], z_m: point.position[2],
  })) : view.rows));
}

function choosePage(page) {
  if (page !== 'dynamics' && !Object.hasOwn(info, page)) return;
  state.page = page;
  notify();
  for (const button of $('pages').querySelectorAll('button')) {
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  const dynamic = page === 'dynamics';
  $('geometry-workspace').hidden = dynamic;
  $('dynamics-workspace').hidden = !dynamic;
  if (dynamic) { dynamics.activate(); return; }
  dynamics.deactivate();
  state.chart = 'geometry';
  state.view = null;
  $('projection').value = 'iso';
  $('view-title').textContent = info[page][0];
  $('view-description').textContent = info[page][1];
  $('project-name').textContent = state.project.name;
  renderPose();
  updateGeometry();
}

function formFieldset(legend, fields) {
  const section = node('fieldset', null, 'section-form');
  const grid = node('div', null, 'form-grid');
  grid.append(...fields);
  section.append(node('legend', legend), grid);
  return section;
}

function settingsNumbers(target, fields) {
  return fields.filter(([key]) => Object.hasOwn(target, key)).map(([key, label, , min, max]) => {
    const input = numberInput(target[key], 'any', min, max);
    input.addEventListener('input', () => { target[key] = input.valueAsNumber; });
    return labelField(label, input);
  });
}

function hardpointForm(draft) {
  const container = node('div', null, 'table-wrap');
  const table = node('table', null, 'hardpoint-table');
  const head = table.createTHead().insertRow();
  for (const label of ['Corner', 'Hardpoint', 'X (m)', 'Y (m)', 'Z (m)']) head.append(node('th', label));
  const body = table.createTBody();
  for (const corner of corners) for (const key of hardpointKeys) {
    const row = body.insertRow();
    row.insertCell().textContent = corner;
    row.insertCell().textContent = pretty(key);
    const point = draft.geometry.hardpoints[`${corner}_${key}`];
    for (const [index, axis] of ['X', 'Y', 'Z'].entries()) {
      const input = numberInput(point?.[index] ?? 0);
      input.setAttribute('aria-label', `${corner} ${pretty(key)} ${axis}`);
      input.addEventListener('input', () => { point[index] = input.valueAsNumber; });
      row.insertCell().append(input);
    }
  }
  container.append(table);
  return container;
}

function renderSettings() {
  const draft = state.draft;
  const geometry = draft.geometry;
  const content = $('settings-fields');
  const grid = node('div', null, 'settings-grid');
  const name = node('input');
  name.type = 'text';
  name.required = true;
  name.value = draft.name;
  name.addEventListener('input', () => { draft.name = name.value; });
  const mode = makeSelect([['parameters', 'Design parameters'], ['hardpoints', 'Direct hardpoints']], geometry.mode);
  mode.addEventListener('change', () => {
    if (mode.value === 'hardpoints' && !Object.keys(geometry.hardpoints).length) {
      try { geometry.hardpoints = structuredClone(buildVehicle(draft).hardpoints); }
      catch (error) { $('settings-error').textContent = error.message; mode.value = geometry.mode; return; }
    }
    geometry.mode = mode.value;
    renderSettings();
    content.querySelector('select').focus();
  });
  grid.append(labelField('Project name', name), labelField('Geometry input mode', mode));
  const dimensions = formFieldset('Vehicle dimensions', settingsNumbers(draft.vehicle, vehicleFields));
  dimensions.classList.add('full-width');
  grid.append(dimensions);
  if (geometry.mode === 'hardpoints') {
    const section = node('section', null, 'stack full-width');
    section.append(node('h3', 'Suspension hardpoints'), node('p', 'Vehicle-frame coordinates. X is forward, Y is left and Z is up.', 'muted'), hardpointForm(draft));
    grid.append(section);
  } else {
    grid.append(formFieldset('Front axle', settingsNumbers(geometry.front, axleFields)), formFieldset('Rear axle', settingsNumbers(geometry.rear, axleFields)));
  }
  const scan = formFieldset('Motion and sweep limits', settingsNumbers(draft.scan, [
    ['droop_mm', 'Maximum droop (mm)', '1', '1', '250'], ['bump_mm', 'Maximum bump (mm)', '1', '1', '250'],
    ['steer_deg', 'Steering lock (°)', '.1', '1', '85'], ['samples', 'Default sweep sample count', '1', '3', '201'],
  ]));
  scan.classList.add('full-width');
  grid.append(scan);
  content.replaceChildren(grid);
}

function openSettings() {
  state.draft = structuredClone(state.project);
  $('settings-error').textContent = '';
  renderSettings();
  $('settings').showModal();
}

function applyProject(project, model = buildVehicle(project)) {
  state.project = model.project || project;
  state.model = model;
  state.poses = {};
  choosePage(state.page);
}

async function importProject(file) {
  const source = JSON.parse((await file.text()).replace(/^\ufeff/, ''));
  if (!source || Array.isArray(source) || typeof source !== 'object') throw new Error('Choose a valid project JSON object.');
  const project = geometryFromProject(source);
  const model = buildVehicle(project);
  const dynamicSource = source.dynamics_project ?? (source.application === 'SuspensionSetupLab' || source.application === 'VehicleInitialSizingLab-DynamicsExport' || source.parameters?.full ? source : null);
  if (dynamicSource) await dynamics.importProject(dynamicSource);
  else dynamics.clearProject();
  applyProject(project, model);
  notify(`Imported ${file.name}.`);
}

async function exportGeometry() {
  if (!state.view) return;
  const format = $('export-format').value;
  const view = state.view;
  const id = state.page;
  switch (format) {
    case 'state': downloadCsv(view.metrics, filename(`${id}-results`, 'csv'), ['label', 'value', 'unit']); break;
    case 'sweep':
      if (!view.rows.length) throw new Error('This view has no sweep samples.');
      downloadCsv(view.rows, filename(`${id}-sweep`, 'csv')); break;
    case 'points': downloadHardpointsCsv(view, filename(`${id}-hardpoints`, 'csv')); break;
    case 'members': downloadMembersCsv(view, filename(`${id}-members`, 'csv')); break;
    case 'step': $('step-options').showModal(); return;
    case 'png': viewer.draw(); await downloadPng($('geometry-plot'), filename(id, 'png')); break;
    case 'json': saveJSON(view, filename(id, 'json')); break;
  }
  notify('Download started.');
}

$('pages').addEventListener('click', event => { if (event.target.dataset.page) choosePage(event.target.dataset.page); });
$('sample-section').addEventListener('toggle', () => { if ($('sample-section').open) renderSamples(); });
$('reset-pose').addEventListener('click', () => { delete state.poses[state.page]; renderPose(); updateGeometry(false); });
$('chart-mode').addEventListener('change', event => { state.chart = event.target.value; drawGeometry(); });
for (const key of ['construction', 'point-labels']) $(key).addEventListener('change', () => drawGeometry(true));
$('projection').addEventListener('change', event => viewer.setProjection(event.target.value));
$('zoom-in').addEventListener('click', () => viewer.zoomBy(1.25));
$('zoom-out').addEventListener('click', () => viewer.zoomBy(.8));
$('reset-camera').addEventListener('click', () => viewer.reset());
$('open-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => $('settings').close());
$('reset-settings').addEventListener('click', () => { state.draft = defaultProject(); $('settings-error').textContent = ''; renderSettings(); });
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const model = buildVehicle(state.draft);
    applyProject(state.draft, model);
    dynamics.geometryChanged();
    $('settings').close();
    notify('Vehicle settings applied.');
  } catch (error) { $('settings-error').textContent = error.message; $('settings-error').setAttribute('data-error', ''); }
});
$('import-project').addEventListener('click', () => $('project-file').click());
$('project-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try { await importProject(file); } catch (error) { notify(`Could not import project. ${error.message}`, true); }
});
$('save-project').addEventListener('click', async () => {
  try {
    const snapshot = await dynamics.exportProject();
    saveJSON({ ...state.project, ...(snapshot ? { dynamics_project: snapshot } : {}) }, filename('', 'json'));
    notify('Project JSON download started.');
  } catch (error) { notify(`Could not save dynamics settings. ${error.message}`, true); }
});
$('export-geometry').addEventListener('click', () => exportGeometry().catch(error => notify(error.message, true)));
$('cancel-step').addEventListener('click', () => $('step-options').close());
$('step-form').addEventListener('submit', event => {
  event.preventDefault();
  const { diameter, joint, stepMode, wheels } = event.currentTarget.elements;
  try {
    downloadStep(state.view, filename(state.page, 'step'), { memberRadiusMm: diameter.valueAsNumber / 2, jointRadiusMm: joint.valueAsNumber / 2, mode: stepMode.value, includeWheels: wheels.checked });
    $('step-options').close();
    notify('STEP download started.');
  } catch (error) { $('step-options').close(); notify(error.message, true); }
});

applyProject(state.project);
