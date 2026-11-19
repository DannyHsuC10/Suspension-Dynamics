const runtimeUrl = "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/";

async function loadSolver() {
  const archiveUrl = new URL("../runtime/dynamics.zip", import.meta.url);
  const archive = fetch(archiveUrl, { cache: "no-cache" }).then((response) => {
    if (!response.ok) throw new Error(`Could not load the dynamics solver (${response.status}).`);
    return response.arrayBuffer();
  });
  const runtime = import(`${runtimeUrl}pyodide.mjs`);
  const [{ loadPyodide }, bytes] = await Promise.all([runtime, archive]);
  const pyodide = await loadPyodide({ indexURL: runtimeUrl });
  await pyodide.loadPackage("numpy");
  pyodide.unpackArchive(bytes, "zip", { extractDir: "/home/pyodide/suspension" });
  return pyodide.runPython([
    "import sys",
    "sys.path.insert(0, '/home/pyodide/suspension')",
    "from dynamics_bridge import handle",
    "handle",
  ].join("\n"));
}

let solver;

self.addEventListener("message", async ({ data }) => {
  const { id, command, payload = {} } = data;
  try {
    solver ??= loadSolver().catch((error) => {
      solver = undefined;
      throw error;
    });
    const handle = await solver;
    let current = 0;
    const response = handle(command, JSON.stringify(payload), (fraction, message) => {
      if (fraction >= 0) current = fraction;
      const progress = { current, total: 1, ...(message && { message }) };
      self.postMessage({ id, progress });
    });
    self.postMessage({ id, ...JSON.parse(response) });
  } catch (error) {
    const message = error.message?.trim().split("\n").filter(Boolean).at(-1) || String(error);
    self.postMessage({ id, ok: false, error: message });
  }
});
