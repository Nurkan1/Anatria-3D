"""Export Z-Anatomy collections to .glb for the Anatria3D viewer.

Run headless:

    blender.exe --background Startup.blend \
        --python tools/asset-pipeline/blender_export.py -- \
        --collection "Bonus collection/Cardiovascular system/Heart" \
        --out public/anatomy/cardiovascular_male.glb \
        --report tools/asset-pipeline/vendor/export-report.json

Design notes:

* Selection is by **collection**, not by a hand-written list of object names.
  Z-Anatomy's hierarchy is the anatomical hierarchy; naming objects by hand
  would duplicate it and drift from it.
* Object names are preserved verbatim as glTF node names. They match the
  `English` column of TA2.csv exactly, which is what lets `build-manifest.mjs`
  join geometry to nomenclature with no manual mapping.
* Objects with no polygons are skipped. Z-Anatomy uses zero-geometry objects
  (the `.j` suffix) as grouping/annotation nodes; exporting them would produce
  empty nodes the viewer would report as missing meshes.
* Everything is unhidden before export. Most of the atlas ships hidden, and the
  glTF exporter silently skips hidden objects — which would look like a
  selection bug rather than a visibility one.
"""

import json
import sys

import bpy  # type: ignore[import-not-found]  # provided by Blender's runtime


def script_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args(args: list[str]) -> dict:
    parsed: dict = {
        "collections": [],
        "out": None,
        "report": None,
        "system": None,
        "draco": True,
    }
    index = 0
    while index < len(args):
        flag = args[index]
        if flag == "--collection":
            parsed["collections"].append(args[index + 1])
            index += 2
        elif flag == "--out":
            parsed["out"] = args[index + 1]
            index += 2
        elif flag == "--report":
            parsed["report"] = args[index + 1]
            index += 2
        elif flag == "--system":
            parsed["system"] = args[index + 1]
            index += 2
        elif flag == "--no-draco":
            parsed["draco"] = False
            index += 1
        else:
            raise SystemExit(f"Unknown argument: {flag}")
    if not parsed["collections"] or not parsed["out"] or not parsed["system"]:
        raise SystemExit(
            "--collection (one or more), --out and --system are required"
        )
    return parsed


def build_collection_index() -> dict:
    """Map 'Parent/Child/Grandchild' paths to collections."""
    parents = {}
    for parent in bpy.data.collections:
        for child in parent.children:
            parents[child.name] = parent

    paths = {}
    for collection in bpy.data.collections:
        parts = [collection.name]
        current = collection
        while current.name in parents:
            current = parents[current.name]
            parts.append(current.name)
        paths["/".join(reversed(parts))] = collection
    return paths


# Object types that can yield a mesh once evaluated.
#
# CURVE matters more than it looks: Z-Anatomy models the entire vascular tree —
# aorta, venae cavae, coronary arteries — as bevelled curves, not meshes.
# Filtering on `type == "MESH"` silently drops every blood vessel in the atlas
# and leaves the heart chambers floating on their own.
#
# FONT is excluded just as deliberately. The atlas carries 1,232 3D text objects
# ("CRANIUM", "SYSTEMIC ARTERIES") used as in-viewport annotations in Blender.
# They evaluate to real geometry, so including them exports floating words that
# hang in the scene next to the body — labels, not anatomy. META is excluded for
# the same reason: it is scaffolding, not structure.
GEOMETRY_TYPES = {"MESH", "CURVE", "SURFACE"}


#: Objects whose name ends in `.g` are Z-Anatomy's 3D section headings —
#: "Skeletal system.g", "Joints.g", "Nervous system & Sense organs.g". They are
#: real mesh geometry (extruded text, 200-1,600 polygons each), not FONT
#: objects, so excluding FONT does not catch them. Left in, they float beside
#: the body as giant words.
HEADING_SUFFIX = ".g"


def is_heading(name: str) -> bool:
    return name.lower().endswith(HEADING_SUFFIX)


def gather_geometry(collection) -> dict:
    """Every potentially-renderable object below a collection, with its ancestry.

    Returns `{object: [ancestor collection names]}`. The collection chain is
    kept because **it is the anatomical hierarchy** — Z-Anatomy nests
    `Heart/Left ventricle/Trabecular part of left ventricle`, and flattening
    that throws away the structure that lets a reader study an organ together
    with everything inside it.

    An object can be linked into several collections; the first path the walk
    reaches wins, which is stable for a given collection order.

    Emptiness is judged after evaluation in `build_clean_scene`, not here: a
    curve has no polygons until its bevel is applied, so testing up front would
    reintroduce the very bug this function exists to avoid.
    """
    found: dict[object, list[str]] = {}
    seen: set[str] = set()

    def walk(node, trail: list[str]) -> None:
        for obj in node.objects:
            if obj.type not in GEOMETRY_TYPES or is_heading(obj.name):
                continue
            if obj.name in seen:
                continue
            seen.add(obj.name)
            found[obj] = trail
        for child in node.children:
            walk(child, [*trail, child.name])

    walk(collection, [])
    return found


def ensure_gltf_addon() -> None:
    """Enable the glTF exporter before invoking its operator.

    The Z-Anatomy blend carries its own add-on and preferences, and opening it
    can leave `io_scene_gltf2` half-initialised — the operator then dies deep
    inside its own imports with `cannot import name ... (unknown location)`,
    which reads like a broken Blender install rather than a disabled add-on.
    Enabling it explicitly is idempotent and removes the whole class of failure.
    """
    import addon_utils  # type: ignore[import-not-found]

    enabled, loaded = addon_utils.check("io_scene_gltf2")
    if not (enabled and loaded):
        addon_utils.enable("io_scene_gltf2", default_set=True, persistent=True)

    if not hasattr(bpy.ops.export_scene, "gltf"):
        raise SystemExit("The glTF exporter is unavailable in this Blender build.")


def build_clean_scene(source_objects) -> tuple:
    """Copy evaluated geometry into a fresh scene, then export that.

    Exporting straight out of the Z-Anatomy scene fails with an IndexError deep
    inside the glTF gatherer. That scene carries a lot of baggage the exporter
    has to walk: driver networks, a known dependency cycle (the oesophagus
    curve-follow), custom add-on state and elaborate material node trees, none
    of which we want in the output anyway.

    Baking each object down to a plain evaluated mesh in an empty scene removes
    every one of those failure modes at once, and it is also what we want
    semantically — modifiers applied, materials dropped (the viewer shades
    organs itself), world transforms preserved so organs keep their spatial
    relationships.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    scene = bpy.data.scenes.new("anatria_export")

    skipped: list[str] = []
    exported: list[dict] = []

    for obj in list(source_objects):
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated)

        # Grouping and annotation nodes evaluate to nothing. Exporting them
        # would put empty meshes in the glb that the viewer reports as missing.
        if mesh is None or len(mesh.polygons) == 0:
            skipped.append(obj.name)
            if mesh is not None:
                bpy.data.meshes.remove(mesh)
            continue

        mesh.materials.clear()

        # The object name becomes the glTF node name and the manifest joins on
        # it, so it has to survive verbatim. Blender enforces unique object
        # names, so creating a copy while the original still holds the name
        # yields "Left ventricle.001" — which would break the join against
        # TA2.csv. Freeing the name first keeps the copy exact. The source blend
        # is never saved, so renaming it costs nothing.
        #
        # The placeholder must be *short*, not derived from the original:
        # Blender truncates names at 63 characters, so appending a suffix to a
        # name already near the limit silently produces a mangled name that
        # then collides — which is how
        # "Articular capsules of proximal interphalangeal joints of foot.r"
        # became "…joints of fo".
        original_name = obj.name
        obj.name = f"#src{len(exported)}"

        copy = bpy.data.objects.new(original_name, mesh)
        copy.matrix_world = obj.matrix_world.copy()
        scene.collection.objects.link(copy)

        exported.append({"name": original_name, "polygons": len(mesh.polygons)})

        if copy.name != original_name:
            raise SystemExit(
                f"Node name collision: wanted {original_name!r}, got {copy.name!r}"
            )

    if skipped:
        print(f"skipped {len(skipped)} objects with no evaluated geometry")
    return scene, exported, skipped


def main() -> None:
    args = parse_args(script_args())
    ensure_gltf_addon()
    index = build_collection_index()

    targets = []
    for path in args["collections"]:
        collection = index.get(path)
        if collection is None:
            available = "\n  ".join(sorted(index)[:20])
            raise SystemExit(
                f"Collection not found: {path!r}\nFirst known paths:\n  {available}"
            )
        targets.append((path, collection))

    objects: dict[str, object] = {}
    ancestry: dict[str, list[str]] = {}
    for _path, collection in targets:
        for obj, trail in gather_geometry(collection).items():
            if obj.name in objects:
                continue
            objects[obj.name] = obj
            ancestry[obj.name] = trail

    if not objects:
        raise SystemExit("No geometry objects found in the given collections.")

    scene, exported, skipped = build_clean_scene(objects.values())
    for entry in exported:
        entry["path"] = ancestry.get(entry["name"], [])
    bpy.context.window.scene = scene

    export_kwargs = {
        "filepath": args["out"],
        "export_format": "GLB",
        "use_selection": False,        # the staging scene contains only our meshes
        "use_active_scene": True,
        "export_apply": False,         # modifiers were already baked into the copies
        "export_yup": True,            # Blender is Z-up, glTF is Y-up
        "export_materials": "NONE",    # the viewer applies its own shading
        "export_normals": True,
        "export_texcoords": False,     # untextured anatomical surfaces
        "export_cameras": False,
        "export_lights": False,
        "export_extras": False,
        "export_animations": False,
    }
    if args["draco"]:
        export_kwargs.update(
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14,
            export_draco_normal_quantization=10,
        )

    bpy.ops.export_scene.gltf(**export_kwargs)

    # Counts come from the evaluated copies. Reading `.polygons` off the source
    # objects would crash on every curve — which is most of the vasculature.
    report = {
        "system": args["system"],
        "collections": args["collections"],
        "output": args["out"],
        "draco": args["draco"],
        "object_count": len(exported),
        "skipped_count": len(skipped),
        "skipped": sorted(skipped),
        "objects": sorted(exported, key=lambda o: o["name"]),
    }
    if args["report"]:
        with open(args["report"], "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=1, ensure_ascii=False)

    total = sum(o["polygons"] for o in report["objects"])
    print(f"exported {len(exported)} objects, {total:,} polygons -> {args['out']}")


if __name__ == "__main__":
    main()
