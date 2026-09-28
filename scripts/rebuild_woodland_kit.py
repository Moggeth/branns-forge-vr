"""Rebuild and install the Orchard's deterministic Blender woodland kit.

Run from any directory: python scripts/rebuild_woodland_kit.py
Requires the project-local Blender and Godot installed by Setup Tools.ps1.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "assets" / "atmosphere" / "woodland-kit"
GAME = ROOT / "godot"
BLENDER = ROOT / "tools" / "blender-4.5.13-windows-x64" / "blender.exe"
GODOT = ROOT / "tools" / "godot" / "Godot_v4.7.2-stable_win64_console.exe"


def run(label: str, command: list[str], cwd: Path, marker: str | None = None) -> None:
    print(f"{label}: {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, check=False)
    print(result.stdout[-5000:], flush=True)
    if result.returncode != 0 or "SCRIPT ERROR" in result.stdout or "ERROR:" in result.stdout:
        raise RuntimeError(f"{label} failed (exit {result.returncode})")
    if marker is not None and marker not in result.stdout:
        raise RuntimeError(f"{label} did not report {marker!r}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-import", action="store_true",
                        help="Only regenerate the source kit and copy GLBs; skip the Godot import check")
    args = parser.parse_args()
    if not BLENDER.is_file():
        raise FileNotFoundError(f"Install project tools first: {BLENDER}")
    if not args.no_import and not GODOT.is_file():
        raise FileNotFoundError(f"Install project tools first: {GODOT}")

    run("Blender woodland build", [str(BLENDER), "-b", "--factory-startup", "-P", "build_kit.py"], KIT)
    destination = GAME / "assets" / "atmosphere" / "woodland"
    destination.mkdir(parents=True, exist_ok=True)
    glbs = sorted((KIT / "glb").glob("*.glb"))
    if len(glbs) != 9:
        raise RuntimeError(f"Expected nine woodland GLBs, found {len(glbs)}")
    for source in glbs:
        shutil.copy2(source, destination / source.name)
    print(f"Installed {len(glbs)} GLBs in {destination}", flush=True)

    if not args.no_import:
        run("Godot asset import", [str(GODOT), "--headless", "--xr-mode", "off",
                                   "--audio-driver", "Dummy", "--path", str(GAME), "--import"], ROOT)
        run("Godot asset check", [str(GODOT), "--headless", "--xr-mode", "off",
                                    "--audio-driver", "Dummy", "--path", str(GAME),
                                    "--script", "res://atmosphere_asset_check.gd", "--quit-after", "900"],
            ROOT, "ATMOSPHERE_ASSET_RESULT []")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (FileNotFoundError, RuntimeError) as error:
        print(f"WOODLAND_REBUILD_FAILED {error}", file=sys.stderr)
        sys.exit(1)
