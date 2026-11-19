const mm = (metres) => metres * 1000;
const mmCoordinates = (coordinates) => coordinates.map(mm);
const sum = (a, b) => a.map((value, i) => value + b[i]);
const difference = (a, b) => a.map((value, i) => value - b[i]);
const times = (vector, factor) => vector.map((value) => value * factor);
const length = (vector) => Math.hypot(...vector);
const unit = (vector) => times(vector, 1 / length(vector));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const physicalMembers = new Set([
  "upperArm", "lowerArm", "kingpin", "chassis", "tieRod", "pushRod", "toeLink",
  "rack", "damper", "rocker", "upright", "antiRollBar", "halfShaft", "spindle",
]);

function csvCell(value) {
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "";
  const field = String(value);
  return /[,"\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function csvText(rows, columns = [...new Set(rows.flatMap(Object.keys))]) {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    const values = Array.isArray(row) ? columns.map((_, index) => row[index]) : columns.map((key) => row[key]);
    lines.push(values.map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function geometryCsv(view) {
  const { points } = view.geometry ?? view;
  const rows = points.map(({ id, label, corner, position, kind }) => {
    const [x_mm, y_mm, z_mm] = mmCoordinates(position);
    return { id, label, corner, x_mm, y_mm, z_mm, kind };
  });
  return csvText(rows, ["id", "label", "corner", "x_mm", "y_mm", "z_mm", "kind"]);
}

export function membersCsv(view) {
  const { segments } = view.geometry ?? view;
  const rows = segments.map(({ id, kind, corner, a, b }) => {
    const [start_x_mm, start_y_mm, start_z_mm] = mmCoordinates(a);
    const [end_x_mm, end_y_mm, end_z_mm] = mmCoordinates(b);
    const length_mm = mm(length(difference(b, a)));
    return { id, kind, corner, start_x_mm, start_y_mm, start_z_mm, end_x_mm, end_y_mm, end_z_mm, length_mm };
  });
  return csvText(rows, ["id", "kind", "corner", "start_x_mm", "start_y_mm", "start_z_mm", "end_x_mm", "end_y_mm", "end_z_mm", "length_mm"]);
}

function stepString(value) {
  const ascii = String(value).replace(/[^\x20-\x7e]/g, "_");
  return `'${ascii.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function stepReal(value) {
  if (!Number.isFinite(value)) throw new Error("STEP geometry contains a non-finite coordinate.");
  const [significand, exponent] = (Object.is(value, -0) ? 0 : value).toString().split("e");
  const decimal = significand.includes(".") ? significand : `${significand}.`;
  return exponent === undefined ? decimal : `${decimal}E${exponent}`;
}

function stepTuple(values) {
  return `(${values.join(",")})`;
}

class StepDocument {
  constructor() {
    this.entities = [];
  }

  add(entity) {
    const reference = `#${this.entities.length + 1}`;
    this.entities.push(`${reference}=${entity};`);
    return reference;
  }

  point(point) {
    return this.add(`CARTESIAN_POINT('',${stepTuple(point.map(stepReal))})`);
  }

  direction(vector) {
    return this.add(`DIRECTION('',${stepTuple(vector.map(stepReal))})`);
  }

  placement(point, normal, reference) {
    return this.add(`AXIS2_PLACEMENT_3D('',${this.point(point)},${this.direction(normal)},${this.direction(reference)})`);
  }

  edge(start, end, curve) {
    return this.add(`EDGE_CURVE('',${start},${end},${curve},.T.)`);
  }

  face(surface, boundary) {
    const oriented = boundary.map(([edge, forward]) => this.add(`ORIENTED_EDGE('',*,*,${edge},${forward ? ".T." : ".F."})`));
    const loop = this.add(`EDGE_LOOP('',${stepTuple(oriented)})`);
    const bound = this.add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    return this.add(`ADVANCED_FACE('',(${bound}),${surface},.T.)`);
  }

  polyline(start, end, name) {
    return this.add(`POLYLINE(${stepString(name)},(${this.point(start)},${this.point(end)}))`);
  }

  circle(center, axis, radial, radius, name = "") {
    const placement = this.placement(center, axis, radial);
    return this.add(`CIRCLE(${stepString(name)},${placement},${stepReal(radius)})`);
  }

  cylinder(start, end, radius, name) {
    const axis = unit(difference(end, start));
    const radial = radialTo(axis);
    const vertices = [start, end].map((center) => [radial, times(radial, -1)].map((direction) => {
      const point = this.point(sum(center, times(direction, radius)));
      return { point, vertex: this.add(`VERTEX_POINT('',${point})`) };
    }));
    const rimEdges = [start, end].map((center, i) => {
      const rim = this.circle(center, axis, radial, radius);
      const [a, b] = vertices[i];
      return [this.edge(a.vertex, b.vertex, rim), this.edge(b.vertex, a.vertex, rim)];
    });
    const direction = this.direction(axis);
    const vector = this.add(`VECTOR('',${direction},1.)`);
    const seamEdges = vertices[0].map(({ point, vertex }, i) => {
      return this.edge(vertex, vertices[1][i].vertex, this.add(`LINE('',${point},${vector})`));
    });

    // Two half faces give each straight seam two incident faces with opposite edge directions.
    const faces = [radial, times(radial, -1)].map((direction, i) => {
      const placement = this.placement(start, axis, direction);
      const surface = this.add(`CYLINDRICAL_SURFACE('',${placement},${stepReal(radius)})`);
      return this.face(surface, [[rimEdges[0][i], true], [seamEdges[1 - i], true], [rimEdges[1][i], false], [seamEdges[i], false]]);
    });
    const bottom = this.add(`PLANE('',${this.placement(start, times(axis, -1), radial)})`);
    const top = this.add(`PLANE('',${this.placement(end, axis, radial)})`);
    faces.push(this.face(bottom, [[rimEdges[0][1], false], [rimEdges[0][0], false]]));
    faces.push(this.face(top, [[rimEdges[1][0], true], [rimEdges[1][1], true]]));
    const shell = this.add(`CLOSED_SHELL('',${stepTuple(faces)})`);
    return this.add(`MANIFOLD_SOLID_BREP(${stepString(name)},${shell})`);
  }

  finish(items, filename, wireframe) {
    const application = this.add("APPLICATION_CONTEXT('automotive_design')");
    this.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${application})`);
    const productContext = this.add(`PRODUCT_CONTEXT('',${application},'mechanical')`);
    const product = this.add(`PRODUCT('suspension','Suspension geometry','',(${productContext}))`);
    const formation = this.add(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',${product},.NOT_KNOWN.)`);
    const definitionContext = this.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${application},'design')`);
    const definition = this.add(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`);
    const shape = this.add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
    const distance = this.add("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))");
    const angle = this.add("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))");
    const solidAngle = this.add("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())");
    const tolerance = this.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-6),${distance},'distance_accuracy_value','')`);
    const context = this.add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${tolerance})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${distance},${angle},${solidAngle})) REPRESENTATION_CONTEXT('','3D'))`);
    const origin = this.placement([0, 0, 0], [0, 0, 1], [1, 0, 0]);
    const representation = wireframe
      ? this.add(`GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('',(${origin},${this.add(`GEOMETRIC_CURVE_SET('',${stepTuple(items)})`)}),${context})`)
      : this.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',${stepTuple([origin, ...items])},${context})`);
    this.add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);

    return [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION(('Suspension Dynamics Lab geometry in millimeters'),'2;1');",
      `FILE_NAME(${stepString(filename)},${stepString(new Date().toISOString())},(''),(''),'Suspension Dynamics Lab','Suspension Dynamics Lab','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
      "ENDSEC;",
      "DATA;",
      ...this.entities,
      "ENDSEC;",
      "END-ISO-10303-21;",
      "",
    ].join("\n");
  }
}

function radialTo(axis) {
  const reference = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return unit(cross(axis, reference));
}

export function geometryStep(view, {
  filename = "suspension.step", mode = "solid", memberRadiusMm = 6,
  jointRadiusMm = 0, includeWheels = false,
} = {}) {
  const { segments, points = [], wheels = [] } = view.geometry ?? view;
  const wireframe = mode === "wireframe";
  if (!wireframe && (!Number.isFinite(memberRadiusMm) || memberRadiusMm <= 0)) throw new Error("Member radius must be positive.");
  if (!Number.isFinite(jointRadiusMm) || jointRadiusMm < 0) throw new Error("Joint radius must be zero or positive.");

  const document = new StepDocument();
  const items = [];
  for (const { id, kind, corner, a, b } of segments) {
    if (!physicalMembers.has(kind)) continue;
    const start = mmCoordinates(a);
    const end = mmCoordinates(b);
    if (length(difference(end, start)) <= 1e-6) continue;
    const name = [corner, kind, id].filter(Boolean).join(" ");
    items.push(wireframe ? document.polyline(start, end, name) : document.cylinder(start, end, memberRadiusMm, name));
  }

  if (!wireframe && jointRadiusMm > 0) {
    const jointOffset = [0, 0, jointRadiusMm / 2];
    for (const { label, position, kind } of points) {
      if (kind !== "upperArm" && kind !== "lowerArm") continue;
      const center = mmCoordinates(position);
      const start = difference(center, jointOffset);
      const end = sum(center, jointOffset);
      items.push(document.cylinder(start, end, jointRadiusMm, `${label} joint marker`));
    }
  }

  if (includeWheels) {
    for (const { corner, center, axis, radius, width } of wheels) {
      if (width <= 0 || radius <= 0 || length(axis) <= 1e-12) continue;
      const normal = unit(axis);
      const offset = times(normal, width / 2);
      const start = mmCoordinates(difference(center, offset));
      const end = mmCoordinates(sum(center, offset));
      if (wireframe) {
        const radial = radialTo(normal);
        items.push(document.circle(start, normal, radial, mm(radius), `${corner} wheel inner envelope`));
        items.push(document.circle(end, normal, radial, mm(radius), `${corner} wheel outer envelope`));
      } else {
        items.push(document.cylinder(start, end, mm(radius), `${corner} wheel envelope`));
      }
    }
  }

  if (items.length === 0) throw new Error("This view has no structural members to export.");
  return document.finish(items, filename, wireframe);
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(rows, filename, columns) {
  saveBlob(new Blob([csvText(rows, columns)], { type: "text/csv;charset=utf-8" }), filename);
}

export function downloadHardpointsCsv(view, filename) {
  saveBlob(new Blob([geometryCsv(view)], { type: "text/csv;charset=utf-8" }), filename);
}

export function downloadMembersCsv(view, filename) {
  saveBlob(new Blob([membersCsv(view)], { type: "text/csv;charset=utf-8" }), filename);
}

export function downloadStep(view, filename, options) {
  const contents = geometryStep(view, { ...options, filename });
  saveBlob(new Blob([contents], { type: "model/step" }), filename);
}

export function downloadSvg(svg, filename) {
  const markup = typeof svg === "string" ? svg : new XMLSerializer().serializeToString(svg);
  saveBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), filename);
}

export async function downloadPng(canvas, filename) {
  const image = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!image) throw new Error("The view is not ready to save as an image.");
  saveBlob(image, filename);
}
