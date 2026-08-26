"""What a scene command names in the atlas, and whether the atlas has it.

The internal agent cannot send a command naming a structure that does not
exist: every tool in `scene_tools` validates its arguments against the loaded
manifest and raises `ModelRetry` on a miss. A caller arriving over the control
bridge does not pass through those tools, so the same check has to exist
somewhere it can reach — here.

It is a check on *references*, not a second copy of the wire format. The shape
of a command is already owned twice, by Zod and by Pydantic, and joined by
`tests/protocol-contract.test.ts`. This module asks the one question neither of
those can: the manifest is data, and no type system knows whether
`left_atrium_l` is in it.

**Standard library only**, for the same reason as `atlas_search`: the control
server runs in `tools/anatria_mcp/.venv` without the sidecar's dependencies,
and a dependency added here would have to be satisfied twice.

Nothing imports this from the running application, and that is deliberate. The
internal path already validates, earlier and with better errors; adding a second
check to it would be changing a working path to prepare for one that does not
exist yet.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal

from anatria_engine.atlas_search import Atlas, heading_names

#: How a field names something in the atlas.
#:
#: `"group"` is separate from `"ids"` because it is not an identifier at all —
#: `isolate_group` takes a heading name, since most groups have no mesh of their
#: own to name. A validator built only for identifiers would wave it through.
Reference = Literal["id", "ids", "group"]

#: The field of each scene action that names the atlas, and how.
#:
#: `None` means the action names nothing the manifest knows about: an enum, a
#: bounded number, or no argument at all. Those are held by Zod and Pydantic
#: already and there is nothing left here to check.
#:
#: **Every action of the `SceneCommand` union must appear**, including the ones
#: mapping to `None`. `test_scene_contract.py` asserts it against the union
#: itself, so a fifteenth action fails the build until somebody classifies it
#: rather than silently arriving unchecked.
ATLAS_REFERENCES: dict[str, tuple[str, Reference] | None] = {
    "focus_organ": ("organ_id", "id"),
    "isolate_region": ("organ_id", "id"),
    "apply_pathology_overlay": ("organ_id", "id"),
    "isolate_structures": ("organ_ids", "ids"),
    "highlight_pathway": ("organ_ids", "ids"),
    "illuminate_structures": ("organ_ids", "ids"),
    "isolate_group": ("group", "group"),
    "set_layer_visibility": None,
    "set_layer_opacity": None,
    "add_supply": None,
    "clear_pathology_overlays": None,
    "clear_pathway": None,
    "set_cross_section": None,
    "reset_view": None,
}


#: How faint the other systems go in an x-ray view.
#:
#: Not a limit like the ones in `protocol`, but a value that must agree in three
#: places at once: here, `scene_tools.XRAY_OPACITY` for the internal agent, and
#: the viewer's own `XRAY_OPACITY` in `sceneStore.ts`. A view built by an agent
#: should look like one the reader could have built by hand, and it does not if
#: the three disagree.
#:
#: It lives in this module because this is the only home both callers can reach:
#: `scene_tools` needs pydantic-ai, which the MCP server's virtualenv does not
#: have and must not acquire. `test_scene_contract` pins the agent's copy to
#: this one.
XRAY_OPACITY = 0.16


class UnclassifiedActionError(ValueError):
    """A command names an action this module has no classification for.

    Raised rather than ignored. An unknown action reaching a validator that
    shrugs is precisely the hole the classification exists to close, and it
    would show up as a command that passed validation and then did nothing.
    """


def unknown_references(atlas: Atlas, command: Mapping[str, object]) -> list[str]:
    """Everything this command names that the atlas does not have.

    Empty means the command's references all resolve — not that the command is
    correct in every other way, which is Zod's and Pydantic's job.

    The two failures are worth telling apart, because the application handles
    them differently and only one of them is loud:

    - An unknown **identifier** reaches `applyCommand`, which has no view of the
      manifest, and leaves an empty viewport with no error. Recoverable through
      `reset_view`, but silent, and this is the case worth stopping early.
    - An unknown **group name** is already harmless: `isolateGroupIn` returns
      null and the store keeps its previous state. Checked anyway, because a
      command that quietly does nothing is still a bad answer to give a caller.
    """
    action = command.get("action")
    if not isinstance(action, str) or action not in ATLAS_REFERENCES:
        raise UnclassifiedActionError(f"No atlas-reference classification for action {action!r}.")

    reference = ATLAS_REFERENCES[action]
    if reference is None:
        return []

    field, kind = reference
    value = command.get(field)

    if kind == "group":
        known = isinstance(value, str) and value in heading_names(atlas.structures)
        return [] if known else [str(value)]

    named = [value] if kind == "id" else value
    if isinstance(named, str) or not isinstance(named, Sequence):
        named = [named]

    return [str(item) for item in named if not isinstance(item, str) or atlas.by_id(item) is None]
