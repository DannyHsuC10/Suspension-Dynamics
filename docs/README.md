# SuspensionDynamicsLab for GitHub Pages

The public workbench is deployed from the `docs` directory on `main`. To preview it locally, run `python -m http.server 8765 --directory docs` from the repository root and open `http://localhost:8765`.

## Geometry and file formats

The five geometry views use the same rigid double-wishbone model. Vehicle settings accept axle design parameters or 24 XYZ suspension hardpoints. The vehicle frame uses X forward, Y left and Z up. The wheel-end view uses an idealized wheel envelope and steering-axis rotation. Steering rack geometry, compliance and tire-force modelling are outside this geometry model.

Project JSON contains geometry settings and, when used, a native Dynamics Lab project. The importer also accepts desktop tuning and Vehicle Initial Sizing Lab dynamics exports. Geometry CSVs contain pose results, sweeps, hardpoints or member endpoints. STEP uses millimetres and supports both analytic cylinders and wireframes. PNG uses the current view and camera.

## Dynamics

The desktop Python solver runs in a browser worker through Pyodide and NumPy. The first use of Dynamics loads the runtime from jsDelivr. Project files and recorded inputs are processed in the browser. The vertical wheel spring and damper remain available for ride and load calculations. The lateral tire model is excluded.

Vehicle playback uses a schematic for each model and an optional LP02 CAD view for full-vehicle results. The LP02 viewer uses the desktop STL assets and requires WebGL.

After editing the local desktop solver or `docs/runtime/dynamics_bridge.py`, run `python tools/sync_web_runtime.py` to update `docs/runtime/dynamics.zip` before publishing. The `--check` option verifies the archive against the local source.
