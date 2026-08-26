"""The tools that let an external agent drive a running Anatria3D.

The same fifteen the application's own assistant has, under the same names.
That is the point of the exercise rather than an aesthetic choice: an agent
reaching the atlas over MCP should be able to do what the assistant in the
window can do, and a smaller surface would be a different product wearing the
same name.

# Where the wire format comes from

From `anatria_engine.protocol`, the actual Pydantic models the engine emits.
Nothing here restates a limit — that a route has between two and twenty-four
stops, that opacity runs 0 to 1, that at most sixty-four structures can be
isolated at once — because every one of those already lives on a model, is
mirrored in Zod on the TypeScript side, and is joined by
`tests/protocol-contract.test.ts`. A validation error becomes a `ToolError`
the calling model can read and correct.

That import is only possible because `protocol` is pure Pydantic, and Pydantic
arrives with the MCP SDK. `scene_tools`, which holds the assistant's copy of
these tools, needs pydantic-ai and is deliberately **not** imported here: that
dependency must never enter this virtualenv.

# What it can and cannot check

Identifiers are validated against the manifests on disk before anything is
sent, because the bridge cannot report an action-level refusal — a bad
`organ_id` reaches the viewport and empties it, silently. See
`scene_contract.unknown_references`, which exists for this caller.

What no check here can know is **what the reader currently has on screen**. The
manifest says a structure exists; it does not say the reader has that body
loaded, or that its system is switched on. A command naming something real but
not loaded is accepted here and does nothing there. The bridge has no way to
ask, and inventing an answer would be worse than saying so.
"""

from __future__ import annotations

import difflib
from collections.abc import Callable
from itertools import pairwise
from typing import Annotated, Literal

from anatria_engine.atlas_search import Atlas
from anatria_engine.protocol import (
    AddSupply,
    AnatomicalSystem,
    ApplyPathologyOverlay,
    ClearPathologyOverlays,
    ClearPathway,
    FocusOrgan,
    HighlightPathway,
    IlluminateStructures,
    IsolateGroup,
    IsolateRegion,
    IsolateStructures,
    ResetView,
    SectionPlane,
    SetCrossSection,
    SetLayerOpacity,
    SetLayerVisibility,
)
from anatria_engine.scene_contract import XRAY_OPACITY, unknown_references
from bridge import BridgeUnavailable, ControlBridge
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field, ValidationError

#: Near-misses offered when an identifier is not found.
#:
#: The mechanism that stops a model inventing anatomy. Told only "no such
#: structure", a model guesses again; handed six real identifiers it picks the
#: right one on the next call. `_resolve` in the engine's `scene_tools` does
#: the same for the internal agent, and for the same reason.
SUGGESTIONS = 6

#: Nothing here reads. Every one of these changes what a person is looking at.
#:
#: `idempotent_hint` is true because these set a state rather than accumulate
#: one — asking twice for the same view leaves the same view. The exception is
#: `apply_pathology_overlay`, which layers, and says so where it is declared.
CHANGES_THE_VIEW = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, idempotent_hint=True
)

#: Guidance the reader's own assistant gives in prose, kept short here.
#:
#: An opacity below this is a layer that is invisible but still present, which
#: is a state nobody can interpret. Not enforced — the protocol's own 0-to-1 is
#: the contract, and a second limit in a second place is how the two drift.
GHOST_FLOOR = 0.05


def register_scene_tools(
    mcp: MCPServer,
    bridge: ControlBridge,
    atlases: Callable[[], list[Atlas]],
) -> None:
    """Attach the viewport tools to a server that has a bridge to drive.

    Called only when the bridge is configured. A server without one registers
    none of this, so a client that was never given a token does not merely fail
    to move the viewport — it is never offered the ability, and its model does
    not spend a turn discovering that.
    """

    def send(command: BaseModel) -> None:
        """Check what a command names, then put it on the wire."""
        payload = command.model_dump()
        loaded = atlases()
        if not loaded:
            # Sending anyway would mean skipping the one check that stands
            # between a mistyped identifier and an empty viewport with no
            # error. Refusing says which file is missing; proceeding would not.
            raise ToolError(
                "No atlas manifest could be read, so nothing can be checked "
                "before it is sent. Set ANATRIA_ATLAS_DIR to the directory "
                "holding manifest.json."
            )
        missing = _unknown(payload, loaded)
        if missing:
            raise ToolError(_no_such(missing, loaded))
        try:
            bridge.send(payload)
        except BridgeUnavailable as err:
            raise ToolError(str(err)) from err

    def build(model: type[BaseModel], **fields: object) -> BaseModel:
        """Build a protocol model, turning its complaint into a readable one.

        Pydantic already knows every limit this protocol has. Catching its
        error and re-raising is the whole of the validation code here, and it
        is why there is no second copy of those limits to go stale.
        """
        try:
            return model(**fields)
        except ValidationError as err:
            raise ToolError(_readable(err)) from err

    # ------------------------------------------------------------------
    # Pointing at things
    # ------------------------------------------------------------------

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def focus_organ(organ_id: str) -> str:
        """Move the camera to a structure and select it.

        Call this before explaining a structure, and again for each structure
        in turn when walking through a process.
        """
        send(build(FocusOrgan, organ_id=organ_id))
        return f"Focused {organ_id}."

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def illuminate_structures(organ_ids: list[str]) -> str:
        """Shine a light on the structures you are talking about.

        The quietest way to point: nothing moves, nothing is hidden, and
        nothing is marked as diseased. Prefer this over `isolate_structures`
        whenever the surroundings are the point — the relationship between a
        nerve and the muscle it enters is destroyed by hiding either of them.

        It is also the only highlight that reads *through* a see-through body,
        so it is the right tool after ghosting a layer to explain what lies
        under it.

        The light is always exactly the last list given. Pass an empty list to
        turn it off.
        """
        send(build(IlluminateStructures, organ_ids=organ_ids))
        if not organ_ids:
            return "Turned the light off."
        return f"Lit {len(organ_ids)} structure(s)."

    # ------------------------------------------------------------------
    # Showing less
    # ------------------------------------------------------------------

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def isolate_structures(organ_ids: list[str]) -> str:
        """Show only these structures, hiding everything else.

        Use when surrounding anatomy obscures what you are describing.
        """
        send(build(IsolateStructures, organ_ids=organ_ids))
        return f"Isolated {len(organ_ids)} structure(s)."

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def isolate_region(organ_id: str) -> str:
        """Show a structure together with everything anatomically inside it.

        Use this for an organ with internal parts — the heart with its chambers
        and valves, the brain with its lobes and ventricles. `isolate_structures`
        shows only the shell; this opens it up.
        """
        send(build(IsolateRegion, organ_id=organ_id))
        return f"Isolated {organ_id} and its internal structures."

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def isolate_group(group: str) -> str:
        """Show every structure under a named anatomical group.

        For headings in the hierarchy — "Brain", "Muscles of hand", "Vertebral
        column". Use this when the reader asks for a whole organ or region that
        is modelled as many parts: the atlas often has no single mesh for it,
        so `focus_organ` has nothing to point at and naming the parts one by
        one is not an answer.

        Get the exact spelling from `browse_hierarchy`. The name must match.
        """
        send(build(IsolateGroup, group=group.strip()))
        return f"Isolated everything under {group.strip()!r}."

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def show_all_structures() -> str:
        """Clear any isolation and show the whole scene again.

        Undoes what has been *hidden or drawn* — isolation, cross-sections,
        pathology overlays, traced pathways. It deliberately leaves the
        reader's own way of looking alone: if they have made the body
        transparent or drained its colour, it stays that way. Those are their
        settings, and they are usually the reason they can see what is being
        explained at all.

        To undo transparency *you* applied, use `set_layer_opacity` on the
        system you ghosted rather than reaching for this.
        """
        send(build(ResetView))
        return (
            "Cleared isolation, section and overlays; the full scene is "
            "visible. The reader's own transparency and colour settings are "
            "unchanged."
        )

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def add_supply(kind: Literal["vascular", "neural"]) -> str:
        """Bring in the vessels — or the nerves — that reach what is isolated.

        Use this after isolating something, when the reader asks what supplies
        it, what drains it, or what innervates it.

        **Do not answer these by naming vessels and isolating them.** The atlas
        is organised by system and this relationship is spatial: the coronary
        arteries are not inside the heart in the hierarchy, they are under
        *Systemic arteries*, and no list of identifiers reproduces what actually
        reaches a territory. The viewer measures it against the geometry, which
        is the only thing that knows.

        Isolate first. There is nothing to measure against a whole body.

        **What comes back is proximity, not proven supply**, and it must be
        described that way. The viewer adds whole structures whose extent meets
        the region, so a long one passing nearby arrives entire — asking what
        innervates the heart brings the spinal nerves running past it, not only
        its cardiac branches.
        """
        send(build(AddSupply, kind=kind))
        label = "vessels" if kind == "vascular" else "nerves"
        return (
            f"Asked the viewer to add the {label} whose extent meets the "
            "isolated region. This is proximity measured against the geometry "
            "— not a claim that each one supplies the region, and a long "
            "structure passing nearby is added whole. It may add nothing, if "
            "the region has none nearby or nothing is isolated."
        )

    # ------------------------------------------------------------------
    # Whole systems
    # ------------------------------------------------------------------

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def set_layer_visibility(system: AnatomicalSystem, visible: bool) -> str:
        """Switch a whole anatomical system on or off."""
        _known_system(system, atlases())
        send(build(SetLayerVisibility, system=system, visible=visible))
        return f"{system} is now {'visible' if visible else 'hidden'}."

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def set_layer_opacity(
        system: AnatomicalSystem,
        opacity: Annotated[float, Field(description="0 is invisible, 1 is solid.")],
    ) -> str:
        """Make a whole system translucent so the reader can see through it.

        The move for "show me X under Y": ghost the skin and the muscles read
        straight through it, with the skin still on screen for context. Use
        this rather than `set_layer_visibility` whenever the relationship
        between two layers is part of what is being explained — hiding a layer
        throws that relationship away.

        Around 0.25 shows the shape of the layer while letting what is behind
        it read clearly; 1.0 puts it back to solid. Below about 0.05 the layer
        is invisible but still present, which is a state a reader cannot
        interpret — use `set_layer_visibility` to remove it instead.
        """
        _known_system(system, atlases())
        send(build(SetLayerOpacity, system=system, opacity=opacity))
        if opacity >= 1.0:
            return f"{system} is solid again."
        if opacity < GHOST_FLOOR:
            return (
                f"{system} is now {opacity:.0%} opaque, which is close enough "
                "to invisible that the reader cannot tell it is still there. "
                "set_layer_visibility is the honest way to remove a layer."
            )
        return f"{system} is now {opacity:.0%} opaque; what is behind it shows through."

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def xray_system(system: AnatomicalSystem) -> str:
        """Ghost every system *except* this one, so it can be followed through
        the whole body.

        The answer to "trace the nerves down the arm": everything else becomes
        a faint shell and the system in question stands alone inside it, still
        in place. Expands to one opacity change per system, so there is no need
        to call `set_layer_opacity` repeatedly.
        """
        known = _known_system(system, atlases())
        others = sorted(known - {system})
        # The chosen system is set solid explicitly rather than left alone: it
        # may already be ghosted from an earlier x-ray, and it is the layer the
        # caller asked to stand out.
        send(build(SetLayerOpacity, system=system, opacity=1.0))
        for other in others:
            send(build(SetLayerOpacity, system=other, opacity=XRAY_OPACITY))
        return (
            f"{system} is solid; {len(others)} other system(s) faded back so "
            "it can be followed through them."
        )

    # ------------------------------------------------------------------
    # Marking and tracing
    # ------------------------------------------------------------------

    @mcp.tool(
        annotations=ToolAnnotations(
            read_only_hint=False,
            destructive_hint=False,
            # Unlike the rest, these accumulate: a second call marks a second
            # structure rather than replacing the first.
            idempotent_hint=False,
        )
    )
    def apply_pathology_overlay(organ_id: str, pathology: str, severity: float) -> str:
        """Tint a structure to show a disease state.

        `severity` runs 0 to 1 and drives the colour from healthy through amber
        to deep red, so it should track the degree being described: 0.25 for
        mild, 0.5 for moderate, 0.85 for severe.

        Overlays accumulate. Use `clear_pathology_overlays` when the topic
        moves on.
        """
        label = pathology.strip()
        if not label:
            raise ToolError("pathology must name the condition being shown.")
        send(
            build(
                ApplyPathologyOverlay,
                organ_id=organ_id,
                pathology=label[:120],
                severity=severity,
            )
        )
        return f"Marked {organ_id} with {label} at severity {severity:.2f}."

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def clear_pathology_overlays() -> str:
        """Remove every disease overlay. Call this when the topic moves on."""
        send(build(ClearPathologyOverlays))
        return "Cleared all pathology overlays."

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def highlight_pathway(
        label: str,
        organ_ids: list[str],
        step_seconds: float = 1.2,
        loop: bool = True,
    ) -> str:
        """Animate a marker travelling through structures in anatomical order.

        The tool for a *process*, where the sequence is the lesson: swallowing
        a mouthful of water, food through the gut, blood through the chambers
        of the heart, air down to the alveoli, an impulse along a nerve. A
        static highlight cannot show order; this can.

        Prefer it over repeated `focus_organ` calls when the whole route
        matters — the tube stays on screen, so the shape of the journey is
        visible after the marker has passed.

        - `label` names the process in the reader's language. It is shown over
          the canvas, so write it for them: "Swallowing a glass of water".
        - `organ_ids` is the route, in the order the thing travels. Find the
          identifiers with `search_structures` first; never guess them.
        - `step_seconds` is how long the marker takes between structures.
          Raise it when explaining each step in detail.
        - `loop` replays continuously. Use it for a circuit such as
          circulation, and turn it off for a one-way journey, where looping
          jumps visibly from the last structure back to the first.
        """
        name = label.strip()
        if not name:
            raise ToolError(
                "label must name the process being traced — the reader sees it "
                "over the model."
            )
        _no_repeats(organ_ids)
        send(
            build(
                HighlightPathway,
                label=name[:120],
                organ_ids=organ_ids,
                step_seconds=step_seconds,
                loop=loop,
            )
        )
        return (
            f"Tracing {name!r} through {len(organ_ids)} structures at "
            f"{step_seconds:g}s per step{', looping' if loop else ''}."
        )

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def clear_pathway() -> str:
        """Stop tracing the current route. Call this when the topic moves on."""
        send(build(ClearPathway))
        return "Cleared the pathway."

    @mcp.tool(annotations=CHANGES_THE_VIEW)
    def set_cross_section(plane: SectionPlane, position: float) -> str:
        """Cut the model open along a plane to reveal internal structure.

        `position` runs -1 to 1 across the model's extent on that axis; 0 cuts
        through the middle.
        """
        send(build(SetCrossSection, plane=plane, position=position))
        return f"Cut the model on the {plane} plane at {position:.2f}."


# ---------------------------------------------------------------------------
# Checking what a command names
# ---------------------------------------------------------------------------


def _unknown(payload: dict, loaded: list[Atlas]) -> list[str]:
    """What this command names that no available atlas has.

    Checked against every manifest rather than one, because the application can
    be showing either body and the bridge cannot say which. Rejecting a female
    structure because the male manifest lacks it would refuse a command that
    works.
    """
    misses: set[str] | None = None
    for atlas in loaded:
        found = set(unknown_references(atlas, payload))
        misses = found if misses is None else (misses & found)
    return sorted(misses or ())


def _no_such(missing: list[str], loaded: list[Atlas]) -> str:
    """Name what was not found, and offer what was."""
    known = [structure.organ_id for atlas in loaded for structure in atlas.structures]
    lines = []
    for name in missing:
        close = difflib.get_close_matches(name, known, n=SUGGESTIONS, cutoff=0.5)
        hint = f" Did you mean: {', '.join(close)}?" if close else ""
        lines.append(f"No structure {name!r} in the atlas.{hint}")
    return " ".join(lines) + " Use search_structures to find the exact identifier."


def _known_system(system: str, loaded: list[Atlas]) -> set[str]:
    """Every system present in any atlas, having checked this one is among them.

    The female manifest covers the trunk only and has no muscular or nervous
    structures at all, so a system real in one atlas may be absent from the
    other. The union is the honest answer to "could this command ever do
    something".
    """
    present = {structure.system for atlas in loaded for structure in atlas.structures}
    if system not in present:
        raise ToolError(
            f"The {system} system is not in this atlas build. Present: "
            f"{', '.join(sorted(present))}."
        )
    return present


def _no_repeats(organ_ids: list[str]) -> None:
    """Refuse a route that stops twice in the same place.

    A repeated stop is a zero-length segment, which gives the viewer's curve an
    undefined tangent and corrupts the whole route rather than just that step.
    Cheaper to refuse here than to defend downstream.
    """
    for previous, current in pairwise(organ_ids):
        if previous == current:
            raise ToolError(
                f"{current!r} appears twice in a row. Each step must move to a "
                "different structure; list the route without repeats."
            )


def _readable(err: ValidationError) -> str:
    """Pydantic's complaint, as a sentence a model can act on."""
    parts = []
    for problem in err.errors():
        where = ".".join(str(piece) for piece in problem["loc"]) or "the command"
        parts.append(f"{where}: {problem['msg']}")
    return "; ".join(parts)
