"""Dump the Z-Anatomy scene graph so the export selection can be written against
the real object names.

Run headless:

    blender.exe --background Z-Anatomy.blend --python tools/asset-pipeline/blender_inspect.py -- --out inspect.json

Writes JSON to `--out` (and a short summary to stdout) describing every
collection and mesh object: name, parent collection, triangle count and world
bounding box. That is what `selections/*.json` needs in order to name real
geometry instead of guessing.
"""

import json
from pathlib import Path
import sys

import bpy  # type: ignore[import-not-found]  # provided by Blender's runtime


def argv_after_ddash() -> list[str]:
    """Blender passes script args after a bare `--`."""
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_out_path(args: list[str]) -> str:
    if "--out" in args:
        return args[args.index("--out") + 1]
    return "inspect.json"


def collection_path(collection, index: dict) -> str:
    parts = [collection.name]
    current = collection
    while True:
        parent = index.get(current.name)
        if parent is None:
            break
        parts.append(parent.name)
        current = parent
    return "/".join(reversed(parts))


def build_parent_index() -> dict:
    parents = {}
    for parent in bpy.data.collections:
        for child in parent.children:
            parents[child.name] = parent
    return parents


def main() -> None:
    out_path = parse_out_path(argv_after_ddash())
    parents = build_parent_index()

    collections = []
    for collection in bpy.data.collections:
        meshes = [obj for obj in collection.objects if obj.type == "MESH"]
        collections.append(
            {
                "name": collection.name,
                "path": collection_path(collection, parents),
                "children": [c.name for c in collection.children],
                "mesh_count": len(meshes),
                # Sampled rather than exhaustive: some collections hold
                # thousands of objects and the full list would be unreadable.
                "sample_objects": [obj.name for obj in meshes[:40]],
            }
        )

    objects = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        objects.append(
            {
                "name": obj.name,
                "collections": [c.name for c in obj.users_collection],
                "vertices": len(mesh.vertices),
                "polygons": len(mesh.polygons),
                "hide_viewport": obj.hide_viewport,
                "hide_render": obj.hide_render,
            }
        )

    payload = {
        "blend_file": Path(bpy.data.filepath).name,
        "collection_count": len(collections),
        "mesh_object_count": len(objects),
        "collections": sorted(collections, key=lambda c: c["path"]),
        "objects": sorted(objects, key=lambda o: o["name"]),
    }

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)

    print(f"collections: {len(collections)}  mesh objects: {len(objects)}")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
