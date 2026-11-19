# SuspensionDynamicsLab for GitHub Pages

The English browser workbench runs the local SuspensionDynamicsLab Python solver through Pyodide and NumPy in a worker. It provides full vehicle, left/right half car, front/rear half car, quarter car, vehicle settings, springs and dampers, geometry lookup, aerodynamics and load transfer. The lateral tire analysis is excluded.

Project JSON uses the native desktop format. Import also accepts the desktop legacy formats. CSV road replay, component tables, geometry tables, result exports, calculation snapshots, A/B comparisons and schematic animation are available. The first calculation loads the Pyodide runtime from jsDelivr. Inputs are processed in the browser.

Publish the `docs` directory on `main` through GitHub Pages. Preview with `python -m http.server 8765 --directory docs`. Rebuild the packaged desktop solver with `python tools/sync_web_runtime.py` after changing its Python source. Check freshness with `--check`.
