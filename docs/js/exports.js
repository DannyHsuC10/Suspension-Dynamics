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

export async function downloadPng(canvas, filename) {
  const image = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!image) throw new Error("The view is not ready to save as an image.");
  saveBlob(image, filename);
}
