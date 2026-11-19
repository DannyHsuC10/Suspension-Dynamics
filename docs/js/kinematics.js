// Vehicle coordinates are in metres: +X forward, +Y left, +Z up.
export const CORNERS = ["FL", "FR", "RL", "RR"];
export const HARDPOINTS = [
  "upper_front", "upper_rear", "upper_ball", "lower_front", "lower_rear", "lower_ball",
];

const EPS = 1e-9;
const RAD = Math.PI / 180;
const UP = [0, 0, 1];
const FORWARD = [1, 0, 0];

function axleDefaults(front) {
  return {
    fvsa: .972043272, rc: .025, kpi: 8, caster: front ? 6.05268288 : 0,
    camber: 0, toe: 0, scrub: .018, trail: front ? .02 : 0,
    upperOffset: .065, lowerOffset: .065, upperInboard: .30, lowerInboard: .31,
    upperSpan: .235, lowerSpan: .27, svsa: 1.35, brakeAnti: .15, driveAnti: .15,
  };
}

export function defaultProject() {
  return {
    application: "SuspensionDynamicsLab-Web", schema_version: 1, name: "Baseline vehicle",
    vehicle: {
      m: 321, lf: .765, lr: .765, tf: 1.28, tr: 1.24, h_cg: .3, gravity: 9.81,
      free_radius: .2, wheel_width: .18, brake_front: .75, drive_front: .5, clearance: .055,
    },
    geometry: {mode: "parameters", front: axleDefaults(true), rear: axleDefaults(false), hardpoints: {}},
    scan: {bump_mm: 25, droop_mm: 25, steer_deg: 30, samples: 41},
  };
}

const add = (a, b) => a.map((value, i) => value + b[i]);
const sub = (a, b) => a.map((value, i) => value - b[i]);
const scale = (a, s) => a.map(value => value * s);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(...a);
const mm = value => Number.isFinite(value) ? value * 1000 : null;
const degrees = value => Number.isFinite(value) ? value / RAD : null;
const percent = value => Number.isFinite(value) ? value * 100 : null;
const ratio = (a, b) => Number.isFinite(a) && Math.abs(b) > EPS ? a / b : null;

function unit(a) {
  const length = norm(a);
  if (!Number.isFinite(length) || length < EPS) throw new Error("The suspension points do not define a finite, nonzero axis.");
  return scale(a, 1 / length);
}

function rotate(p, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(p, c), scale(cross(axis, p), s)), scale(axis, dot(axis, p) * (1 - c)));
}

function alignedVector(vector, from, to) {
  const axis = cross(from, to);
  const sine = norm(axis);
  if (sine < EPS) return vector;
  return rotate(vector, scale(axis, 1 / sine), Math.atan2(sine, dot(from, to)));
}

function projectObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function copyKnown(defaults, source) {
  return Object.fromEntries(Object.keys(defaults).map(key => [key, source?.[key] ?? defaults[key]]));
}

export function geometryFromProject(source) {
  if (!projectObject(source)) throw new Error("The project file must contain a JSON object.");
  const result = defaultProject();
  if (typeof source.name === "string" && source.name.trim()) result.name = source.name.trim();
  if (source.application === result.application || (source.geometry?.front && source.geometry?.rear)) {
    if (source.schema_version !== undefined && source.schema_version !== 1) {
      throw new Error(`Unsupported project schema version ${source.schema_version}.`);
    }
    result.vehicle = copyKnown(result.vehicle, source.vehicle);
    result.scan = copyKnown(result.scan, source.scan);
    result.geometry.mode = source.geometry?.mode ?? result.geometry.mode;
    for (const axle of ["front", "rear"]) {
      result.geometry[axle] = copyKnown(result.geometry[axle], source.geometry?.[axle]);
    }
    if (source.geometry?.hardpoints !== undefined) {
      if (!projectObject(source.geometry.hardpoints)) throw new Error("Hardpoints must be a JSON object.");
      result.geometry.hardpoints = Object.fromEntries(Object.entries(source.geometry.hardpoints)
        .map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
    }
  } else {
    const legacy = source.parameters?.full;
    if (!projectObject(legacy) && !["m", "lf", "lr", "tf", "tr"].some(key => source.vehicle?.[key] !== undefined)) {
      throw new Error("This file does not contain Suspension Dynamics Lab vehicle settings.");
    }
    const values = {...legacy, ...source.vehicle, ...source.geometry, ...source.dynamics};
    result.vehicle = copyKnown(result.vehicle, values);
    for (const [axle, suffix, brakeKey, driveKey] of [
      ["front", "f", "dive_front", "lift_front"], ["rear", "r", "lift_rear", "squat_rear"],
    ]) {
      const design = result.geometry[axle];
      for (const [to, from] of Object.entries({
        fvsa: `fvsa_${suffix}`, rc: `h_rc_${suffix}`, kpi: `kpi_${suffix}_deg`,
        caster: `caster_${suffix}_deg`, camber: `camber_${suffix}_deg`, svsa: `svsa_${suffix}`,
      })) {
        design[to] = values[from] ?? design[to];
      }
      design.brakeAnti = values[brakeKey] ?? values[`anti_${axle}`] ?? design.brakeAnti;
      design.driveAnti = values[driveKey] ?? values[`anti_${axle}`] ?? design.driveAnti;
    }
    result.scan = copyKnown(result.scan, {...source.geometry, ...source.scan});
  }
  validateSettings(result);
  return result;
}

function finiteRange(value, min, max, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a number from ${min} to ${max}.`);
  }
}

function validateSettings(project) {
  const vehicle = project.vehicle;
  for (const [key, min, max, label] of [
    ["m", 1, 100000, "Vehicle mass"], ["lf", .01, 30, "CG to front axle"],
    ["lr", .01, 30, "CG to rear axle"], ["tf", .01, 30, "Front track"], ["tr", .01, 30, "Rear track"],
    ["h_cg", .001, 20, "CG height"], ["gravity", .01, 100, "Gravity"],
    ["free_radius", .05, 2, "Wheel radius"], ["wheel_width", .01, 2, "Wheel width"],
    ["brake_front", 0, 1, "Front brake share"], ["drive_front", 0, 1, "Front drive share"],
    ["clearance", 0, 20, "Ground clearance"],
  ]) finiteRange(vehicle[key], min, max, label);
  if (vehicle.clearance > vehicle.h_cg) throw new Error("Ground clearance cannot exceed the CG height.");
  const {geometry, scan} = project;
  if (!["parameters", "hardpoints"].includes(geometry.mode)) throw new Error("Select parameter or hardpoint geometry.");
  for (const axle of ["front", "rear"]) {
    const design = geometry[axle];
    const halfTrack = (axle === "front" ? vehicle.tf : vehicle.tr) / 2;
    for (const [key, min, max] of [
      ["fvsa", .01, 30], ["rc", -10, 10], ["kpi", -60, 60], ["caster", -60, 60],
      ["camber", -35, 35], ["toe", -30, 30], ["scrub", -.5, .5], ["trail", -.5, .5],
      ["upperOffset", .005, 2], ["lowerOffset", .005, 2], ["upperInboard", 0, 15],
      ["lowerInboard", 0, 15], ["upperSpan", .01, 4], ["lowerSpan", .01, 4],
      ["svsa", .01, 30], ["brakeAnti", -2, 2], ["driveAnti", -2, 2],
    ]) finiteRange(design[key], min, max, `${axle} ${key}`);
    if (geometry.mode === "parameters" && (design.upperInboard >= halfTrack || design.lowerInboard >= halfTrack)) {
      throw new Error(`${axle === "front" ? "Front" : "Rear"} inboard pivot offset must be smaller than half the track.`);
    }
  }
  finiteRange(scan.bump_mm, 0, 300, "Bump travel");
  finiteRange(scan.droop_mm, 0, 300, "Droop travel");
  if (scan.bump_mm + scan.droop_mm === 0) throw new Error("Enter a non-zero bump or droop range.");
  finiteRange(scan.steer_deg, 0, 85, "Steering range");
  finiteRange(scan.samples, 3, 201, "Sweep samples");
  if (!Number.isInteger(scan.samples)) throw new Error("Sweep samples must be a whole number.");
}

function geometryForCorner(project, corner) {
  const front = corner.startsWith("F");
  const side = corner.endsWith("L") ? 1 : -1;
  const {vehicle, geometry} = project;
  const design = geometry[front ? "front" : "rear"];
  const x = front ? vehicle.lf : -vehicle.lr;
  const y = side * (front ? vehicle.tf : vehicle.tr) / 2;
  const heading = rotate(FORWARD, UP, -side * design.toe * RAD);
  const up = rotate(UP, heading, -side * design.camber * RAD);
  const center = [x, y, up[2] * vehicle.free_radius];
  const contact = add(center, scale(up, -vehicle.free_radius));
  const fbShare = front ? vehicle.brake_front : 1 - vehicle.brake_front;
  const driveShare = front ? vehicle.drive_front : 1 - vehicle.drive_front;
  const designGain = fbShare > EPS && Math.abs(design.brakeAnti) > EPS ? design.brakeAnti / fbShare :
    driveShare > EPS ? design.driveAnti / driveShare : 0;
  return {corner, front, side, vehicle, design, x, y, center, heading, up, contact, fbShare, driveShare, designGain};
}

function parameterHardpoints(settings) {
  const {corner, front, side, vehicle, design, center, contact, designGain} = settings;
  const kingpinGround = add(contact, [design.trail, -side * design.scrub, -contact[2]]);
  const kingpinSlope = [-Math.tan(design.caster * RAD), -side * Math.tan(design.kpi * RAD), 1];
  const fvIC = [contact[1] - side * design.fvsa,
    contact[2] + (design.rc - contact[2]) * design.fvsa / Math.abs(contact[1])];
  const centerHeight = center[2];
  // The side-view IC constrains both control-arm tangents at the reference pose.
  const longitudinalScale = vehicle.h_cg / (vehicle.lf + vehicle.lr);
  const slope = designGain * longitudinalScale;
  const svIC = [contact[0] + (front ? -1 : 1) * design.svsa, contact[2] + slope * design.svsa];
  const points = {};
  for (const [name, height] of [["upper", centerHeight + design.upperOffset], ["lower", centerHeight - design.lowerOffset]]) {
    const ball = add(kingpinGround, scale(kingpinSlope, height));
    const dyDz = ratio(fvIC[1] - ball[2], ball[1] - fvIC[0]);
    const dxDz = ratio(svIC[1] - ball[2], ball[0] - svIC[0]);
    if (dyDz === null || dxDz === null) {
      throw new Error(`${corner} ${name} arm cannot be generated from the requested swing-arm geometry.`);
    }
    const tangent = [dxDz, dyDz, 1];
    const yPivot = side * design[`${name}Inboard`];
    const pivot = [ball[0], yPivot, ball[2] + dyDz * (ball[1] - yPivot)];
    let axis = unit(cross(sub(ball, pivot), tangent));
    if (axis[0] < 0) axis = scale(axis, -1);
    if (axis[0] < EPS) throw new Error(`${corner} ${name} arm does not have longitudinal pivot spacing.`);
    const segment = scale(axis, design[`${name}Span`] / 2);
    points[`${corner}_${name}_front`] = add(pivot, segment);
    points[`${corner}_${name}_rear`] = sub(pivot, segment);
    points[`${corner}_${name}_ball`] = ball;
  }
  return points;
}

function makeArm(hardpoints, corner, name) {
  const id = `${corner}_${name}`;
  const front = hardpoints[`${id}_front`];
  const rear = hardpoints[`${id}_rear`];
  const ball = hardpoints[`${id}_ball`];
  if (front[0] <= rear[0]) throw new Error(`${corner} ${name} front pivot must be ahead of its rear pivot.`);
  const axis = unit(sub(front, rear));
  const origin = add(rear, scale(axis, dot(sub(ball, rear), axis)));
  const radial = sub(ball, origin);
  if (norm(radial) < EPS) throw new Error(`${corner} ${name} ball joint lies on its inboard pivot axis.`);
  return {front, rear, ball, axis, origin, radial};
}

export function buildVehicle(source = defaultProject()) {
  const project = geometryFromProject(source);
  const {vehicle, geometry} = project;
  const hardpoints = {};
  const corners = {};
  for (const corner of CORNERS) {
    const settings = geometryForCorner(project, corner);
    if (geometry.mode === "parameters") {
      Object.assign(hardpoints, parameterHardpoints(settings));
    } else {
      for (const suffix of HARDPOINTS) {
        const key = `${corner}_${suffix}`;
        const p = geometry.hardpoints[key];
        if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) {
          throw new Error(`${key} requires three finite X, Y, Z coordinates.`);
        }
        hardpoints[key] = [...p];
      }
    }
    const upper = makeArm(hardpoints, corner, "upper");
    const lower = makeArm(hardpoints, corner, "lower");
    if (upper.ball[1] * settings.side <= EPS || lower.ball[1] * settings.side <= EPS) {
      throw new Error(`${corner} ball joints must be on their own side of the vehicle centreline.`);
    }
    const kingpin = sub(upper.ball, lower.ball);
    if (kingpin[2] <= EPS) throw new Error(`${corner} upper ball joint must be above the lower ball joint.`);
    corners[corner] = {
      ...settings, upper, lower, kingpin: unit(kingpin), kingpinLength: norm(kingpin),
      centerOffset: sub(settings.center, lower.ball),
    };
  }
  const wheelbase = vehicle.lf + vehicle.lr;
  const frontShare = vehicle.lr / wheelbase;
  const metrics = {
    wheelbaseMm: mm(wheelbase), frontTrackMm: mm(vehicle.tf), rearTrackMm: mm(vehicle.tr),
    frontShare, rearShare: 1 - frontShare, totalWeightN: vehicle.m * vehicle.gravity,
  };
  const model = {project, hardpoints, corners, metrics};
  const {points, segments} = solveView(model, "static");
  return {...model, points, segments};
}

const ballAt = (arm, angle) => add(arm.origin, rotate(arm.radial, arm.axis, angle));

function cornerPose(corner, lowerAngle, upperAngle, steer) {
  const lower = ballAt(corner.lower, lowerAngle);
  const upper = ballAt(corner.upper, upperAngle);
  const upright = sub(upper, lower);
  const kingpin = unit(upright);
  const offset = alignedVector(corner.centerOffset, corner.kingpin, kingpin);
  const alignThenSteer = p => rotate(alignedVector(p, corner.kingpin, kingpin), kingpin, steer);
  const center = add(lower, rotate(offset, kingpin, steer));
  const heading = unit(alignThenSteer(corner.heading));
  const up = unit(alignThenSteer(corner.up));
  const axis = cross(up, heading);
  const radius = corner.vehicle.free_radius;
  // Lowest position on the wheel centre plane, projected along global gravity.
  const upInPlane = unit(sub(UP, scale(axis, dot(UP, axis))));
  const contact = sub(center, scale(upInPlane, radius));
  return {
    corner: corner.corner, lower, upper, upright, kingpin, center, heading, up, axis, radius,
    width: corner.vehicle.wheel_width, contact, lowerAngle, upperAngle,
    camber: -corner.side * degrees(Math.asin(Math.max(-1, Math.min(1, dot(UP, axis))))),
    toe: -corner.side * degrees(Math.atan2(heading[1], heading[0])),
    caster: degrees(Math.atan2(-kingpin[0], kingpin[2])),
    kpi: degrees(Math.atan2(-corner.side * kingpin[1], kingpin[2])),
    steer: degrees(steer),
  };
}

function solveCorner(corner, travel, steer, initial) {
  let lowerAngle = initial?.lowerAngle ?? 0;
  let upperAngle = initial?.upperAngle ?? 0;
  const targetZ = corner.center[2] + travel;
  const residual = pose => [norm(pose.upright) - corner.kingpinLength, pose.center[2] - targetZ];
  for (let iteration = 0; iteration < 30; iteration++) {
    const pose = cornerPose(corner, lowerAngle, upperAngle, steer);
    const [lengthError, heightError] = residual(pose);
    if (Math.hypot(lengthError, heightError) < 1e-8) {
      if (pose.upright[2] <= 0) break;
      return pose;
    }
    const h = 1e-5;
    const [l1, z1] = residual(cornerPose(corner, lowerAngle + h, upperAngle, steer));
    const [l2, z2] = residual(cornerPose(corner, lowerAngle, upperAngle + h, steer));
    const a = (l1 - lengthError) / h;
    const b = (l2 - lengthError) / h;
    const c = (z1 - heightError) / h;
    const d = (z2 - heightError) / h;
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < EPS) break;
    const deltaL = (-d * lengthError + b * heightError) / determinant;
    const deltaU = (c * lengthError - a * heightError) / determinant;
    const relaxation = Math.min(1, .24 / Math.max(Math.abs(deltaL), Math.abs(deltaU)));
    lowerAngle += relaxation * deltaL;
    upperAngle += relaxation * deltaU;
    if (Math.max(Math.abs(lowerAngle), Math.abs(upperAngle)) > Math.PI / 2) break;
  }
  throw new Error(`${corner.corner} cannot reach ${mm(travel).toFixed(1)} mm travel at ${degrees(steer).toFixed(1)}° steer.`);
}

const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];

function intersection(pointA, dirA, pointB, dirB) {
  const den = cross2(dirA, dirB);
  if (Math.abs(den) < EPS * norm(dirA) * norm(dirB) || Math.abs(den) < 1e-14) return null;
  return add(pointA, scale(dirA, cross2(sub(pointB, pointA), dirB) / den));
}

function instantCenter(corner, pose, horizontal) {
  const project = p => [p[horizontal], p[2]];
  const normal = (arm, ball) => {
    const tangent = project(cross(arm.axis, sub(ball, arm.origin)));
    return [-tangent[1], tangent[0]];
  };
  return intersection(project(pose.upper), normal(corner.upper, pose.upper),
    project(pose.lower), normal(corner.lower, pose.lower));
}

function frontGeometry(model, poses, left, right) {
  const l = poses[left];
  const r = poses[right];
  const lIC = instantCenter(model.corners[left], l, 1);
  const rIC = instantCenter(model.corners[right], r, 1);
  const lc = l.contact.slice(1);
  const rc = r.contact.slice(1);
  const rollCenter = lIC && rIC ? intersection(lc, sub(lIC, lc), rc, sub(rIC, rc)) : null;
  return {
    l, r, lIC, rIC, rollCenter, track: l.center[1] - r.center[1],
    lFvsa: lIC ? lc[0] - lIC[0] : null, rFvsa: rIC ? rIC[0] - rc[0] : null,
  };
}

function sideGeometry(model, poses, front, rear) {
  const f = poses[front];
  const r = poses[rear];
  const fs = model.corners[front];
  const rs = model.corners[rear];
  const fIC = instantCenter(fs, f, 0);
  const rIC = instantCenter(rs, r, 0);
  const fc = [f.contact[0], f.contact[2]];
  const rc = [r.contact[0], r.contact[2]];
  const pitchCenter = fIC && rIC ? intersection(fc, sub(fIC, fc), rc, sub(rIC, rc)) : null;
  const fSvsa = fIC ? fc[0] - fIC[0] : null;
  const rSvsa = rIC ? rIC[0] - rc[0] : null;
  const scale = model.project.vehicle.h_cg / (model.project.vehicle.lf + model.project.vehicle.lr);
  const fGain = fIC ? ratio(fIC[1] - fc[1], fSvsa * scale) : null;
  const rGain = rIC ? ratio(rIC[1] - rc[1], rSvsa * scale) : null;
  // Reference anti values represent distinct brake and drive force paths in the dynamics project.
  // Linkage motion changes their common side-view slope in proportion to each axle's force share.
  function anti(settings, gain, mode) {
    if (gain === null) return null;
    const brake = mode === "brake";
    const share = brake ? settings.fbShare : settings.driveShare;
    if (share <= EPS) return 0;
    if (model.project.geometry.mode === "hardpoints") return gain * share;
    const target = brake ? settings.design.brakeAnti : settings.design.driveAnti;
    return target + (gain - settings.designGain) * share;
  }
  return {
    f, r, fIC, rIC, pitchCenter, fSvsa, rSvsa, wheelbase: f.center[0] - r.center[0],
    diveFront: anti(fs, fGain, "brake"), liftRear: anti(rs, rGain, "brake"),
    liftFront: anti(fs, fGain, "drive"), squatRear: anti(rs, rGain, "drive"),
  };
}

function solvePoses(model, corners, controls) {
  const travel = controls.travelMm / 1000;
  const roll = Math.sin(controls.rollDeg * RAD);
  const pitch = Math.sin(controls.pitchDeg * RAD);
  const steer = controls.steerDeg * RAD;
  return Object.fromEntries(corners.map(id => {
    const corner = model.corners[id];
    const displacement = travel - corner.y * roll + corner.x * pitch;
    return [id, solveCorner(corner, displacement, controls.steerAll || corner.front ? steer : 0)];
  }));
}

function normalizeControls(model, type, controls) {
  const {scan} = model.project;
  const corner = CORNERS.includes(controls.corner) ? controls.corner : "FL";
  const travelMm = controls.travelMm ?? 0;
  const steerDeg = controls.steerDeg ?? 0;
  const rollDeg = controls.rollDeg ?? 0;
  const pitchDeg = controls.pitchDeg ?? 0;
  const sweepVariable = ["steer", "roll", "pitch", "travel"].includes(controls.sweepVariable) ? controls.sweepVariable : "travel";
  const defaultRange = {
    steer: [-scan.steer_deg, scan.steer_deg], roll: [-5, 5], pitch: [-5, 5], travel: [-scan.droop_mm, scan.bump_mm],
  }[sweepVariable];
  const sweepMinMm = controls.sweepMinMm ?? defaultRange[0];
  const sweepMaxMm = controls.sweepMaxMm ?? defaultRange[1];
  const samples = controls.samples ?? scan.samples;
  finiteRange(travelMm, -300, 300, "Wheel travel");
  finiteRange(steerDeg, -85, 85, "Steering");
  finiteRange(rollDeg, -45, 45, "Body roll");
  finiteRange(pitchDeg, -45, 45, "Body pitch");
  finiteRange(sweepMinMm, -300, 300, "Sweep minimum");
  finiteRange(sweepMaxMm, -300, 300, "Sweep maximum");
  finiteRange(samples, 3, 201, "Sweep samples");
  if (!Number.isInteger(samples) || sweepMinMm > sweepMaxMm) throw new Error("Enter an ordered sweep range and a whole sample count.");
  return {
    ...controls, corner, side: controls.side === "right" ? "right" : "left", travelMm, steerDeg, rollDeg, pitchDeg,
    sweepVariable, sweepMinMm, sweepMaxMm, samples, steerAll: type === "wheel" || type === "rear",
  };
}

function viewCorners(type, controls) {
  switch (type) {
    case "front": return ["FL", "FR"];
    case "rear": return ["RL", "RR"];
    case "side": return controls.side === "right" ? ["FR", "RR"] : ["FL", "RL"];
    case "wheel": return [controls.corner];
    case "static": return CORNERS;
    default: throw new Error(`Unknown geometry view ${type}.`);
  }
}

function wheelValues(model, pose) {
  const corner = model.corners[pose.corner];
  const groundDistance = ratio(pose.contact[2] - pose.lower[2], pose.kingpin[2]);
  const intercept = groundDistance === null ? null : add(pose.lower, scale(pose.kingpin, groundDistance));
  return {
    camber_deg: pose.camber, toe_deg: pose.toe, caster_deg: pose.caster, kpi_deg: pose.kpi,
    scrub_mm: intercept ? mm(corner.side * (pose.contact[1] - intercept[1])) : null,
    trail_mm: intercept ? mm(intercept[0] - pose.contact[0]) : null,
    center_x_mm: mm(pose.center[0]), center_y_mm: mm(pose.center[1]), center_z_mm: mm(pose.center[2]),
    contact_x_mm: mm(pose.contact[0]), contact_y_mm: mm(pose.contact[1]), contact_z_mm: mm(pose.contact[2]),
  };
}

function measurement(label, value, unit, key) {
  return {label, value: Number.isFinite(value) ? value + 0 : null, unit, key};
}

function frontResult(model, poses, cornerIds) {
  const [left, right] = cornerIds;
  const data = frontGeometry(model, poses, left, right);
  const rollCenterZ = data.rollCenter?.[1];
  const groundZ = (data.l.contact[2] + data.r.contact[2]) / 2;
  const result = {
    roll_center_mm: mm(Number.isFinite(rollCenterZ) ? rollCenterZ - groundZ : null),
    roll_center_y_mm: mm(data.rollCenter?.[0]), track_mm: mm(data.track),
    left_fvsa_mm: mm(data.lFvsa), right_fvsa_mm: mm(data.rFvsa),
    left_ic_y_mm: mm(data.lIC?.[0]), left_ic_z_mm: mm(data.lIC?.[1]),
    right_ic_y_mm: mm(data.rIC?.[0]), right_ic_z_mm: mm(data.rIC?.[1]),
  };
  for (const id of cornerIds) {
    for (const [key, value] of Object.entries(wheelValues(model, poses[id]))) result[`${id.toLowerCase()}_${key}`] = value;
  }
  const axle = left === "FL" ? "front" : "rear";
  result[`${axle}_rc_mm`] = result.roll_center_mm;
  const metrics = [
    ["Roll centre height", "roll_center_mm", "mm"], ["Roll centre lateral position", "roll_center_y_mm", "mm"],
    ["Wheel centre track", "track_mm", "mm"], ["Left FVSA", "left_fvsa_mm", "mm"],
    ["Right FVSA", "right_fvsa_mm", "mm"], ["Left camber", `${left.toLowerCase()}_camber_deg`, "°"],
    ["Right camber", `${right.toLowerCase()}_camber_deg`, "°"],
  ].map(([label, key, unit]) => measurement(label, result[key], unit, key));
  return {data, result, metrics};
}

function sideResult(model, poses, cornerIds) {
  const [front, rear] = cornerIds;
  const data = sideGeometry(model, poses, front, rear);
  const groundZ = (data.f.contact[2] + data.r.contact[2]) / 2;
  const result = {
    pitch_center_mm: mm(Number.isFinite(data.pitchCenter?.[1]) ? data.pitchCenter[1] - groundZ : null),
    pitch_center_x_mm: mm(data.pitchCenter?.[0]), wheelbase_mm: mm(data.wheelbase),
    front_svsa_mm: mm(data.fSvsa), rear_svsa_mm: mm(data.rSvsa),
    front_ic_x_mm: mm(data.fIC?.[0]), front_ic_z_mm: mm(data.fIC?.[1]),
    rear_ic_x_mm: mm(data.rIC?.[0]), rear_ic_z_mm: mm(data.rIC?.[1]),
    front_anti_dive_pct: percent(data.diveFront), rear_anti_lift_pct: percent(data.liftRear),
    front_anti_lift_pct: percent(data.liftFront), rear_anti_squat_pct: percent(data.squatRear),
  };
  const metrics = [
    ["Pitch centre height", "pitch_center_mm", "mm"], ["Pitch centre longitudinal position", "pitch_center_x_mm", "mm"],
    ["Wheelbase", "wheelbase_mm", "mm"], ["Front SVSA", "front_svsa_mm", "mm"],
    ["Rear SVSA", "rear_svsa_mm", "mm"], ["Front anti-dive", "front_anti_dive_pct", "%"],
    ["Rear brake anti-lift", "rear_anti_lift_pct", "%"], ["Front drive anti-lift", "front_anti_lift_pct", "%"],
    ["Rear anti-squat", "rear_anti_squat_pct", "%"],
  ].map(([label, key, unit]) => measurement(label, result[key], unit, key));
  return {data, result, metrics};
}

function wheelResult(model, poses, cornerIds) {
  const result = wheelValues(model, poses[cornerIds[0]]);
  const metrics = [
    ["Camber", "camber_deg", "°"], ["Toe-in", "toe_deg", "°"], ["Caster", "caster_deg", "°"], ["KPI", "kpi_deg", "°"],
    ["Scrub radius", "scrub_mm", "mm"], ["Mechanical trail", "trail_mm", "mm"],
    ["Wheel centre X", "center_x_mm", "mm"], ["Wheel centre Y", "center_y_mm", "mm"], ["Wheel centre Z", "center_z_mm", "mm"],
  ].map(([label, key, unit]) => measurement(label, result[key], unit, key));
  return {data: null, result, metrics};
}

function staticResult(model, poses) {
  const {wheelbaseMm, frontTrackMm, rearTrackMm, frontShare, rearShare, totalWeightN} = model.metrics;
  const weight = [frontShare, frontShare, rearShare, rearShare].map(fraction => totalWeightN * fraction / 2);
  const fp = frontResult(model, poses, ["FL", "FR"]);
  const rp = frontResult(model, poses, ["RL", "RR"]);
  const sv = sideResult(model, poses, ["FL", "RL"]);
  const result = {
    wheelbase_mm: wheelbaseMm, front_track_mm: frontTrackMm, rear_track_mm: rearTrackMm,
    front_weight_pct: percent(frontShare), rear_weight_pct: percent(rearShare), total_weight_n: totalWeightN,
    fl_weight_n: weight[0], fr_weight_n: weight[1], rl_weight_n: weight[2], rr_weight_n: weight[3],
    front_rc_mm: fp.result.roll_center_mm, rear_rc_mm: rp.result.roll_center_mm, pitch_center_mm: sv.result.pitch_center_mm,
    clearance_mm: mm(model.project.vehicle.clearance), cg_height_mm: mm(model.project.vehicle.h_cg),
  };
  const metrics = [
    ["Wheelbase", "wheelbase_mm", "mm"], ["Front track", "front_track_mm", "mm"],
    ["Rear track", "rear_track_mm", "mm"], ["Front weight distribution", "front_weight_pct", "%"],
    ["FL static load", "fl_weight_n", "N"], ["FR static load", "fr_weight_n", "N"],
    ["RL static load", "rl_weight_n", "N"], ["RR static load", "rr_weight_n", "N"],
    ["Front roll centre height", "front_rc_mm", "mm"], ["Rear roll centre height", "rear_rc_mm", "mm"],
    ["Pitch centre height", "pitch_center_mm", "mm"], ["Chassis ground clearance", "clearance_mm", "mm"],
  ].map(([label, key, unit]) => measurement(label, result[key], unit, key));
  return {data: {front: fp.data, rear: rp.data, side: sv.data}, result, metrics};
}

function calculate(model, type, poses, corners) {
  if (type === "front" || type === "rear") return frontResult(model, poses, corners);
  if (type === "side") return sideResult(model, poses, corners);
  if (type === "wheel") return wheelResult(model, poses, corners);
  return staticResult(model, poses);
}

function makeScene(model, type, poses, corners, data) {
  const points = [];
  const segments = [];
  const point = (id, label, corner, position, kind) => points.push({id, label, corner, position, kind});
  const line = (id, a, b, kind, corner = null) => segments.push({id, a, b, kind, corner});
  for (const id of corners) {
    const corner = model.corners[id];
    const pose = poses[id];
    for (const [name, ball] of [["upper", pose.upper], ["lower", pose.lower]]) {
      const arm = corner[name];
      const kind = `${name}Arm`;
      for (const [index, end] of [["F", "front"], ["R", "rear"]]) {
        point(`${id}_${name}_${end}`, `${id} ${name[0].toUpperCase()}${index}`, id, arm[end], kind);
        line(`${id}_${name}_${end}_arm`, arm[end], ball, kind, id);
      }
      point(`${id}_${name}_ball`, `${id} ${name[0].toUpperCase()}BJ`, id, ball, kind);
      line(`${id}_${name}_pivot`, arm.front, arm.rear, "chassis", id);
    }
    point(`${id}_wheel_center`, `${id} WC`, id, pose.center, "wheelCenter");
    point(`${id}_contact`, `${id} CP`, id, pose.contact, "contact");
    line(`${id}_kingpin`, pose.lower, pose.upper, "kingpin", id);
    line(`${id}_spindle`, add(pose.lower, scale(pose.upright, .5)), pose.center, "spindle", id);
  }
  const vehicle = model.project.vehicle;
  const leftSide = ["FL", "RL"].filter(id => corners.includes(id));
  const rightSide = ["FR", "RR"].filter(id => corners.includes(id));
  for (const side of [leftSide, rightSide]) {
    if (side.length !== 2) continue;
    for (const name of ["upper", "lower"]) {
      line(`${side[0]}_${side[1]}_${name}_rail`, model.corners[side[0]][name].rear, model.corners[side[1]][name].front, "chassis");
    }
  }
  for (const [l, r] of [["FL", "FR"], ["RL", "RR"]]) {
    if (!corners.includes(l) || !corners.includes(r)) continue;
    for (const name of ["upper", "lower"]) {
      for (const end of ["front", "rear"]) {
        line(`${l}_${r}_${name}_${end}_rail`, model.corners[l][name][end], model.corners[r][name][end], "chassis");
      }
    }
  }

  const fvGuides = info => {
    const x = (info.l.center[0] + info.r.center[0]) / 2;
    const xyz = p => [x, ...p];
    for (const [side, ic] of [[info.l, info.lIC], [info.r, info.rIC]]) {
      if (!ic) continue;
      const id = side.corner;
      const location = xyz(ic);
      point(`${id}_fv_ic`, `${id} IC`, id, location, "instantCenter");
      line(`${id}_fv_contact`, side.contact, location, "contactLine", id);
      line(`${id}_fv_upper`, side.upper, location, "swingArm", id);
      line(`${id}_fv_lower`, side.lower, location, "swingArm", id);
    }
    if (info.rollCenter) {
      const id = `${info.l.corner[0]}_rc`;
      point(id, `${info.l.corner[0]}RC`, null, xyz(info.rollCenter), "rollCenter");
    }
    line(`${info.l.corner[0]}_ground`, info.l.contact, info.r.contact, "axis");
  };

  const svGuides = info => {
    const y = (info.f.center[1] + info.r.center[1]) / 2;
    const xyz = p => [p[0], y, p[1]];
    for (const [side, ic] of [[info.f, info.fIC], [info.r, info.rIC]]) {
      if (!ic) continue;
      const id = side.corner;
      const location = xyz(ic);
      point(`${id}_sv_ic`, `${id} SVIC`, id, location, "instantCenter");
      line(`${id}_sv_contact`, side.contact, location, "contactLine", id);
      line(`${id}_sv_upper`, side.upper, location, "swingArm", id);
      line(`${id}_sv_lower`, side.lower, location, "swingArm", id);
    }
    if (info.pitchCenter) point("pc", "PC", null, xyz(info.pitchCenter), "pitchCenter");
    line("side_ground", info.f.contact, info.r.contact, "axis");
  };

  if (type === "front" || type === "rear") fvGuides(data);
  if (type === "side") svGuides(data);
  if (type === "static") {
    fvGuides(data.front);
    fvGuides(data.rear);
    svGuides(data.side);
    if (data.front.rollCenter && data.rear.rollCenter) {
      line("roll_axis", [vehicle.lf, ...data.front.rollCenter], [-vehicle.lr, ...data.rear.rollCenter], "axis");
    }
    point("cg", "CG", null, [0, 0, vehicle.h_cg], "cg");
    const datum = [0, 0, vehicle.clearance];
    line("clearance", [0, 0, 0], datum, "clearance");
    line("chassis_datum", [-vehicle.lr, 0, vehicle.clearance], [vehicle.lf, 0, vehicle.clearance], "axis");
  }
  if (type === "wheel") {
    const pose = poses[corners[0]];
    const planeDistance = ratio(pose.contact[2] - pose.lower[2], pose.kingpin[2]);
    if (planeDistance !== null) {
      const intercept = add(pose.lower, scale(pose.kingpin, planeDistance));
      point(`${pose.corner}_kingpin_ground`, "Steering axis at contact height", pose.corner, intercept, "instantCenter");
      line(`${pose.corner}_kingpin_ground`, pose.lower, intercept, "swingArm", pose.corner);
      line(`${pose.corner}_scrub_trail`, pose.contact, intercept, "contactLine", pose.corner);
    }
  }
  return {points, segments};
}

const sweepAxes = {
  travel: {control: "travelMm", key: "travel_mm", label: "Wheel travel", unit: "mm"},
  steer: {control: "steerDeg", key: "steer_deg", label: "Steering angle", unit: "°"},
  roll: {control: "rollDeg", key: "roll_deg", label: "Body roll", unit: "°"},
  pitch: {control: "pitchDeg", key: "pitch_deg", label: "Body pitch", unit: "°"},
};

function sweepRows(controls, calculateAt, values) {
  const {control, key} = sweepAxes[controls.sweepVariable];
  const start = controls.sweepMinMm;
  const end = controls.sweepMaxMm;
  const count = start === end ? 1 : controls.samples;
  return Array.from({length: count}, (_, i) => {
    const n = count === 1 ? start : start + (end - start) * i / (count - 1);
    try {
      return {[key]: n, ...calculateAt({...controls, [control]: n}), solved: true};
    } catch (error) {
      return {[key]: n, ...Object.fromEntries(Object.keys(values).map(key => [key, null])), solved: false, message: error.message};
    }
  });
}

export function solveView(model, type, input = {}) {
  const controls = normalizeControls(model, type, input);
  const corners = viewCorners(type, controls);
  const poses = solvePoses(model, corners, type === "static" ? {...controls, travelMm: 0, steerDeg: 0, rollDeg: 0, pitchDeg: 0} : controls);
  const {data, result, metrics} = calculate(model, type, poses, corners);
  const {points, segments} = makeScene(model, type, poses, corners, data);
  const axis = type === "static" ? null : sweepAxes[controls.sweepVariable];
  let rows = [];
  if (type === "static") {
    rows = points.map(({id, label, corner, position}) => ({
      id, label, corner, x_mm: mm(position[0]), y_mm: mm(position[1]), z_mm: mm(position[2]),
    }));
  } else if (controls.includeSweep !== false) {
    rows = sweepRows(controls, at => calculate(model, type, solvePoses(model, corners, at), corners).result, result);
  }
  return {type, controls, points, segments, wheels: Object.values(poses), metrics, result, rows, axis};
}

export function geometryLookupRows(model, kind, input = {}) {
  if (!["roll_center", "anti"].includes(kind)) throw new Error(`Unknown geometry lookup ${kind}.`);
  const controls = normalizeControls(model, "static", {...input, sweepVariable: "travel", steerDeg: 0, rollDeg: 0, pitchDeg: 0});
  const keys = kind === "roll_center" ? ["front_rc_mm", "rear_rc_mm"] : [
    "front_anti_dive_pct", "rear_anti_lift_pct", "front_anti_lift_pct", "rear_anti_squat_pct",
  ];
  const values = Object.fromEntries(keys.map(key => [key, null]));
  const getValues = at => {
    const corners = CORNERS;
    const poses = solvePoses(model, corners, at);
    if (kind === "roll_center") return {
      front_rc_mm: frontResult(model, poses, corners.slice(0, 2)).result.roll_center_mm,
      rear_rc_mm: frontResult(model, poses, corners.slice(2)).result.roll_center_mm,
    };
    const side = sideResult(model, poses, ["FL", "RL"]).result;
    return Object.fromEntries(keys.map(key => [key, side[key]]));
  };
  const rows = sweepRows(controls, getValues, values);
  const limit = kind === "roll_center" ? 10000 : 200;
  return rows.filter(row => row.solved && keys.every(key => Number.isFinite(row[key]) && Math.abs(row[key]) <= limit))
    .map(row => Object.fromEntries(["travel_mm", ...keys].map(key => [key, row[key]])));
}
