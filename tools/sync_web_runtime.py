"""Rebuild the browser archive with the local SuspensionDynamicsLab solver."""

import argparse
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "SuspensionDynamicsLab" / "setup_lab"
RUNTIME = ROOT / "docs" / "runtime"
MODULES = (
    "__init__", "components", "engine", "geometry_lookup", "load_transfer", "project", "road",
    "road_profiles", "roll_center_scan", "simulation_export",
)


def omit_lateral_tire_solver(source):
    source = source.replace("from functools import cached_property\n", "")
    source = source.replace("from .lateral_tire import LateralTire\n", "")
    for start, end in (
        ("def contact_patch(", "class TransferDistribution:"),
        ("    @cached_property\n    def tire", "    def load_state("),
        ("    def at(self, ay_g):", "def suspension_roll_stiffness("),
    ):
        begin = source.index(start)
        source = source[:begin] + source[source.index(end, begin):]
    return source


def archive_contents():
    entries = {"dynamics_bridge.py": (RUNTIME / "dynamics_bridge.py").read_text(encoding="utf-8")}
    for module in MODULES:
        filename = f"{module}.py"
        source = (SOURCE / filename).read_text(encoding="utf-8")
        if module == "load_transfer":
            source = omit_lateral_tire_solver(source)
        entries[f"setup_lab/{filename}"] = source

    stream = BytesIO()
    with ZipFile(stream, "w") as archive:
        for filename, source in sorted(entries.items()):
            entry = ZipInfo(filename, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            archive.writestr(entry, source.encode("utf-8"))
    return stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if the checked-in archive is stale.")
    options = parser.parse_args()
    archive = RUNTIME / "dynamics.zip"
    content = archive_contents()
    if options.check:
        if not archive.exists() or archive.read_bytes() != content:
            parser.exit(1, "Browser solver archive is stale. Run python tools/sync_web_runtime.py.\n")
    else:
        archive.write_bytes(content)


if __name__ == "__main__":
    main()
