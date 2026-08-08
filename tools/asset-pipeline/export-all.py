"""Export every anatomical system from the Z-Anatomy atlas.

    python tools/asset-pipeline/export-all.py --blender <path-to-blender.exe>
    node tools/asset-pipeline/build-manifest.mjs

One Blender run per system, each producing a `.glb` plus a report the manifest
builder joins against TA2.csv. Systems are separate files on purpose: the viewer
fetches a system's mesh only when that system is switched on, so a user who
opens the heart never downloads the skeleton.

Each run reopens the 306 MB source blend, which costs roughly a minute of the
total — worth it for isolation, since a failure in one system leaves the others
untouched and re-runnable.
"""

from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
BLEND = HERE / "vendor" / "Z-Anatomy" / "Startup.blend"
REPORTS = HERE / "vendor" / "reports"
OUT_DIR = REPO / "public" / "anatomy"
EXPORT_SCRIPT = HERE / "blender_export.py"

# Maps our `AnatomicalSystem` values onto Z-Anatomy collection paths.
#
# `Bonus collection` mirrors the numbered top-level systems but with the proper
# anatomical hierarchy, which is what we want: selection by collection means the
# atlas's own structure decides what belongs together.
#
# Note the trailing apostrophe in "Genital systems'" — that is the real name in
# the blend, not a typo here.
SYSTEMS: list[tuple[str, list[str]]] = [
    # Each system draws from BOTH trees. `Bonus collection` gives the tidy
    # anatomical hierarchy; the numbered top-level collections are the complete
    # ones. Neither is a superset of the other — an audit against every
    # geometry-bearing object in the blend found 2,061 structures (37%) that the
    # Bonus tree alone never reaches, including 509 skeletal landmarks and all
    # 705 muscle insertions. The exporter de-duplicates by object name, so
    # listing both costs nothing but reaches everything.
    (
        "cardiovascular",
        ["Bonus collection/Cardiovascular system", "5: Cardiovascular system"],
    ),
    ("respiratory", ["Bonus collection/Visceral systems/Respiratory system"]),
    ("digestive", ["Bonus collection/Visceral systems/Digestive system"]),
    ("renal", ["Bonus collection/Visceral systems/Urinary system"]),
    ("endocrine", ["Bonus collection/Visceral systems/Endocrine glands"]),
    ("reproductive", ["Bonus collection/Visceral systems/Genital systems'"]),
    (
        "lymphatic",
        ["Bonus collection/Visceral systems/Lymphoid system", "6: Lymphoid organs"],
    ),
    (
        "nervous",
        [
            "Bonus collection/Nervous system",
            # The eye and ear live here, not under the Bonus nervous tree — a
            # collection can hang off several parents in Blender, so the tidy
            # hierarchy does not contain everything its name suggests.
            "7: Nervous system & Sense organs",
        ],
    ),
    (
        "skeletal",
        ["Bonus collection/Skeletal system", "1: Skeletal system"],
    ),
    (
        "muscular",
        [
            "Bonus collection/Muscular system",
            "4: Muscular system",
            # Origin and insertion markings on bone — `.el`/`.er`/`.ol`/`.or`.
            # Core teaching material, and absent from the Bonus tree entirely.
            "2: Muscular insertions",
        ],
    ),
    (
        "articular",
        ["Bonus collection/Arthrology", "3: Joints"],
    ),
    # Organ surface landmarks (borders, impressions, segments). Flat in the
    # atlas with no per-organ split, so the manifest routes each one to its
    # visceral system by name.
    ("visceral", ["8: Visceral systems"]),
    # Surface and regional anatomy — "Anal region", "Angle of mouth". Taught
    # alongside the systems, and 299 structures would otherwise be dropped.
    ("regional", ["9: Regions of human body"]),
]


def find_blender(explicit: str | None) -> str:
    if explicit:
        return explicit
    found = shutil.which("blender")
    if found:
        return found
    raise SystemExit(
        "Blender not found. Pass --blender <path>.\n"
        "Install it at a SHORT path: its glTF add-on fails to import when its "
        "own files sit past Windows' 260-character MAX_PATH limit."
    )


def export(blender: str, system: str, paths: list[str], only: set[str] | None) -> bool:
    if only and system not in only:
        return True

    out = OUT_DIR / f"{system}_male.glb"
    report = REPORTS / f"{system}.json"
    print(f"\n=== {system} ===")
    for path in paths:
        print(f"    {path}")

    started = time.monotonic()
    result = subprocess.run(
        [
            blender,
            "--background",
            str(BLEND),
            "--python",
            str(EXPORT_SCRIPT),
            "--",
            *[arg for path in paths for arg in ("--collection", path)],
            "--system", system,
            "--out", str(out),
            "--report", str(report),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    elapsed = time.monotonic() - started
    summary = [
        line
        for line in (result.stdout or "").splitlines()
        if line.startswith(("exported ", "skipped "))
    ]
    for line in summary:
        print("   ", line)

    if not out.is_file():
        print(f"    FAILED after {elapsed:.0f}s")
        tail = (result.stdout or "").strip().splitlines()[-8:]
        for line in tail:
            print("      ", line[:160])
        return False

    print(f"    {out.stat().st_size / 1_048_576:.1f} MB in {elapsed:.0f}s")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", help="path to the Blender executable")
    parser.add_argument(
        "--only",
        nargs="*",
        help="export just these systems (default: all)",
    )
    args = parser.parse_args()

    if not BLEND.is_file():
        raise SystemExit(f"Source blend not found: {BLEND}\nSee README for the download.")

    blender = find_blender(args.blender)
    REPORTS.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    only = set(args.only) if args.only else None
    failures = [
        system for system, paths in SYSTEMS if not export(blender, system, paths, only)
    ]

    total = sum(
        path.stat().st_size for path in OUT_DIR.glob("*.glb")
    ) / 1_048_576
    print(f"\nTotal bundled geometry: {total:.1f} MB")

    if failures:
        print(f"FAILED: {', '.join(failures)}", file=sys.stderr)
        return 1

    print("Now run: node tools/asset-pipeline/build-manifest.mjs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
