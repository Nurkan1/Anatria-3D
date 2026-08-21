"""The tools that let the assistant drive the 3D viewport.

Every tool validates its arguments against the structures **actually loaded**
and raises `ModelRetry` on a miss. That is the mechanism that stops the model
inventing anatomy: a hallucinated `organ_id` never becomes a scene command, the
model is told what does exist, and it tries again. The viewport only ever
receives identifiers the manifest vouched for.

Return values are short confirmations, not prose. The model narrates in the
user's language; the tool just says what happened.
"""

from __future__ import annotations

import difflib
from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Literal

from pydantic import BaseModel
from pydantic_ai import Agent, ModelRetry, RunContext

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
    Language,
    OrganMeta,
    ResetView,
    SectionPlane,
    SetCrossSection,
    SetLayerOpacity,
    SetLayerVisibility,
    UserProfile,
)

MAX_ISOLATED = 64

#: Past this a lit set is a lit body, and the reader learns nothing from being
#: told that everything is important.
MAX_ILLUMINATED = 24
_SUGGESTIONS = 6

#: A route needs at least two stops. One structure is `focus_organ`.
MIN_PATHWAY_STOPS = 2
#: Above this a "pathway" is a tour, and the reader has lost the thread long
#: before the marker arrives. Mirrors the protocol's own cap.
MAX_PATHWAY_STOPS = 24

MIN_STEP_SECONDS = 0.2
MAX_STEP_SECONDS = 10.0
#: Slow enough to narrate a step, fast enough that a ten-stop route does not
#: outlast the reader's attention.
DEFAULT_STEP_SECONDS = 1.2

#: Floor for ghosting. Below this a layer is invisible but still present, which
#: is a state a reader cannot interpret — that is what `set_layer_visibility`
#: is for, and it says so in the retry message.
MIN_GHOST = 0.05

#: How faint the other systems go in an x-ray. Matches the viewer's own
#: `XRAY_OPACITY`, so a view the assistant builds looks like one the reader
#: could have built by hand.
XRAY_OPACITY = 0.16


@dataclass
class SceneContext:
    """Everything a tool needs: what exists, and how to reach the viewport."""

    organs: dict[str, OrganMeta]
    systems: set[AnatomicalSystem]
    profile: UserProfile
    language: Language
    #: Writes one scene command to stdout. Called during the model's turn, so
    #: the viewport moves while the explanation is still streaming.
    emit: Callable[[BaseModel], None]
    #: Records the grade for a case drill, as (score, verdict).
    #:
    #: It sits here rather than in a context of its own because an agent has one
    #: dependency type, and the drill needs the scene tools too. `None` outside
    #: case mode, where `record_case_verdict` is not registered at all — so a
    #: lesson has no way to write a grade even if the model asks for one.
    emit_verdict: Callable[[int, str], None] | None = None
    #: Named groups that can be isolated whole — "Brain", "Muscles of hand". Validated
    #: against, so the model cannot invent a heading the hierarchy lacks.
    #:
    #: Defaulted empty, which disables `isolate_group` rather than breaking it:
    #: a client that sends no groups gets a tool that always retries with "not a
    #: group", and the model falls back to naming ids.
    groups: set[str] = field(default_factory=set)
    #: Commands emitted this turn, for assertions in tests.
    emitted: list[BaseModel] = field(default_factory=list)

    def dispatch(self, command: BaseModel) -> None:
        self.emitted.append(command)
        self.emit(command)


def _resolve(ctx: RunContext[SceneContext], organ_id: str) -> OrganMeta:
    """Look up a structure, or tell the model precisely what it may use."""
    organ = ctx.deps.organs.get(organ_id)
    if organ is not None:
        return organ

    close = difflib.get_close_matches(organ_id, ctx.deps.organs, n=_SUGGESTIONS, cutoff=0.5)
    if close:
        hint = "Did you mean: " + ", ".join(close)
    else:
        sample = list(ctx.deps.organs)[:_SUGGESTIONS]
        hint = "Loaded structures include: " + ", ".join(sample)

    raise ModelRetry(
        f"There is no structure {organ_id!r} in the viewport. {hint}. "
        "Use an organ_id exactly as given in the scene inventory."
    )


#: Results returned by one search. Enough to disambiguate, small enough that a
#: vague query does not dump the atlas back into the context window.
MAX_SEARCH_RESULTS = 25


def register_scene_tools(agent: Agent[SceneContext, str]) -> None:
    """Attach the viewport tools to an agent.

    **Every tool that moves the viewport is `sequential=True`, and that is the
    whole teaching guarantee.** Pydantic AI runs the tool calls in one model
    response concurrently, and these are sync functions, so they are handed to a
    thread pool and finish in whatever order the scheduler picks. Measured
    before this flag went on: asking for three focuses in one turn produced all
    six permutations across 300 runs, the intended one only 21% of the time.

    A walkthrough of the heart that visits the chambers in a shuffled order is
    not a slower explanation, it is a wrong one — and it fails silently, because
    every individual command is valid. `sequential=True` makes each tool a
    barrier, so the viewport receives them exactly as the model ordered them.

    `find_structures` is deliberately left concurrent: it is a read-only query
    that dispatches nothing, so it has no order to preserve.
    """

    @agent.tool
    def find_structures(ctx: RunContext[SceneContext], query: str) -> str:
        """Search the loaded structures by name, in Latin or English.

        Use this to get the exact `organ_id` for something before focusing it.
        The full atlas runs to thousands of structures, so the prompt lists only
        a summary — this is how you reach the rest.
        """
        needle = query.strip().lower()
        if len(needle) < 2:
            raise ModelRetry("Search for at least two characters.")

        matches = [
            organ
            for organ in ctx.deps.organs.values()
            if needle in organ.ta2_latin.lower()
            or needle in organ.name_en.lower()
            or needle in organ.organ_id
        ]
        if not matches:
            return (
                f"Nothing loaded matches {query!r}. It may belong to a system that "
                "is switched off — try set_layer_visibility, or search a broader term."
            )

        # Shortest name first: an exact-ish term outranks the long compound
        # names that merely contain it.
        matches.sort(key=lambda organ: len(organ.name_en))
        shown = matches[:MAX_SEARCH_RESULTS]
        lines = "\n".join(f"  {organ.describe()}" for organ in shown)
        more = (
            f"\n  …and {len(matches) - len(shown)} more; narrow the query."
            if len(matches) > len(shown)
            else ""
        )
        return f"{len(matches)} match(es) for {query!r}:\n{lines}{more}"

    @agent.tool(sequential=True)
    def focus_organ(ctx: RunContext[SceneContext], organ_id: str) -> str:
        """Move the camera to a structure and select it.

        Call this before explaining a structure, and again for each structure in
        turn when walking through a process.
        """
        organ = _resolve(ctx, organ_id)
        ctx.deps.dispatch(FocusOrgan(organ_id=organ.organ_id))
        return f"Focused {organ.ta2_latin} ({organ.name_en})."

    @agent.tool(sequential=True)
    def isolate_structures(ctx: RunContext[SceneContext], organ_ids: list[str]) -> str:
        """Show only these structures, hiding everything else.

        Use when surrounding anatomy obscures what you are describing.
        """
        if not organ_ids:
            raise ModelRetry("isolate_structures needs at least one organ_id.")
        if len(organ_ids) > MAX_ISOLATED:
            raise ModelRetry(
                f"Too many structures to isolate ({len(organ_ids)}); "
                f"the limit is {MAX_ISOLATED}. Narrow the selection."
            )

        resolved = [_resolve(ctx, organ_id).organ_id for organ_id in organ_ids]
        ctx.deps.dispatch(IsolateStructures(organ_ids=resolved))
        return f"Isolated {len(resolved)} structure(s)."

    @agent.tool(sequential=True)
    def illuminate_structures(ctx: RunContext[SceneContext], organ_ids: list[str]) -> str:
        """Shine a light on the structures you are talking about.

        The quietest way to point: nothing moves, nothing is hidden, and nothing
        is marked as diseased. Prefer this over `isolate_structures` whenever the
        surroundings are the point — the relationship between a nerve and the
        muscle it enters is destroyed by hiding either of them.

        It is also the only highlight that reads *through* a see-through body,
        so it is the right tool when you have ghosted a layer to explain what
        lies under it.

        Call it again with a different list as your explanation moves on; the
        light is always exactly the last list you gave. Pass an empty list to
        turn it off.
        """
        if len(organ_ids) > MAX_ILLUMINATED:
            raise ModelRetry(
                f"Too many structures to light ({len(organ_ids)}); the limit is "
                f"{MAX_ILLUMINATED}. Light the ones you are naming, not the region."
            )

        resolved = [_resolve(ctx, organ_id).organ_id for organ_id in organ_ids]
        ctx.deps.dispatch(IlluminateStructures(organ_ids=resolved))
        if not resolved:
            return "Turned the light off."
        return f"Lit {len(resolved)} structure(s)."

    @agent.tool(sequential=True)
    def isolate_region(ctx: RunContext[SceneContext], organ_id: str) -> str:
        """Show a structure together with everything anatomically inside it.

        Use this for an organ with internal parts — the heart with its chambers
        and valves, the brain with its lobes and ventricles. `isolate_structures`
        shows only the shell; this opens it up.
        """
        organ = _resolve(ctx, organ_id)
        ctx.deps.dispatch(IsolateRegion(organ_id=organ.organ_id))
        return f"Isolated {organ.ta2_latin} and its internal structures."

    @agent.tool(sequential=True)
    def isolate_group(ctx: RunContext[SceneContext], group: str) -> str:
        """Show every structure under a named anatomical group.

        For the groups listed in your instructions — "Brain", "Muscles of hand",
        "Vertebral column". Use this when the reader asks for a whole organ or
        region that is modelled as many parts: the atlas often has no single
        mesh for it, so `focus_organ` has nothing to point at and naming the
        parts one by one is not an answer.

        The name must be spelled exactly as listed.
        """
        wanted = group.strip()
        if wanted not in ctx.deps.groups:
            near = [name for name in sorted(ctx.deps.groups) if wanted.lower() in name.lower()]
            hint = f" Did you mean: {', '.join(near[:5])}?" if near else ""
            raise ModelRetry(
                f"{group!r} is not a group in the loaded hierarchy.{hint} "
                "Use the exact name from the list in your instructions, or "
                "isolate_structures with organ_ids instead."
            )
        ctx.deps.dispatch(IsolateGroup(group=wanted))
        return f"Isolated everything under {wanted}."

    @agent.tool(sequential=True)
    def add_supply(ctx: RunContext[SceneContext], kind: Literal["vascular", "neural"]) -> str:
        """Bring in the vessels — or the nerves — that reach what is isolated.

        Use this after isolating something, when the reader asks what supplies
        it, what drains it, or what innervates it. `vascular` brings arteries
        and veins; `neural` brings nerves.

        **Do not answer these by naming vessels and isolating them.** The atlas
        is organised by system and this relationship is spatial: the coronary
        arteries are not inside the heart in the hierarchy, they are under
        *Systemic arteries*, and no list of ids you can write reproduces what
        actually reaches a territory. The viewer measures it against the
        geometry, which is the only thing that knows.

        Isolate first. There is nothing to measure against a whole body, and
        the answer would be every vessel in it.

        **What comes back is proximity, not proven supply**, and you must say
        so rather than upgrade it. The viewer adds whole structures whose extent
        meets the region, so a long one passing nearby arrives entire — asking
        what innervates the heart brings the spinal nerves that run past it, not
        only its cardiac branches. Describe the result as the vessels or nerves
        *running through this region*, and name the ones that actually supply it
        from your own knowledge of the anatomy.
        """
        ctx.deps.dispatch(AddSupply(kind=kind))
        label = "vessels" if kind == "vascular" else "nerves"
        return (
            f"Asked the viewer to add the {label} whose extent meets the isolated "
            "region. This is proximity, measured against the geometry — it is not "
            "a claim that each one supplies the region, and a long structure "
            "passing nearby is added whole. Say what the reader is now seeing in "
            "those terms, and name what actually supplies it yourself. It may add "
            "nothing, if the region has none nearby or nothing is isolated."
        )

    @agent.tool(sequential=True)
    def show_all_structures(ctx: RunContext[SceneContext]) -> str:
        """Clear any isolation and show the whole loaded scene again.

        Undoes what has been *hidden or drawn* — isolation, cross-sections,
        pathology overlays, traced pathways. It deliberately leaves the reader's
        own way of looking alone: if they have made the body transparent or
        drained its colour, it stays that way. Those are their settings, not
        yours, and they are usually the reason they can see what you are
        explaining at all.

        To undo transparency that *you* applied, use `set_layer_opacity` on the
        system you ghosted rather than reaching for this.
        """
        ctx.deps.dispatch(ResetView())
        return (
            "Cleared isolation, section and overlays; the full scene is visible. "
            "The reader's own transparency and colour settings are unchanged."
        )

    @agent.tool(sequential=True)
    def set_layer_visibility(
        ctx: RunContext[SceneContext], system: AnatomicalSystem, visible: bool
    ) -> str:
        """Switch a whole anatomical system on or off."""
        if system not in ctx.deps.systems:
            available = ", ".join(sorted(ctx.deps.systems))
            raise ModelRetry(
                f"The {system} system is not part of this atlas build. "
                f"Available systems: {available}."
            )
        ctx.deps.dispatch(SetLayerVisibility(system=system, visible=visible))
        return f"{system} is now {'visible' if visible else 'hidden'}."

    @agent.tool(sequential=True)
    def set_layer_opacity(
        ctx: RunContext[SceneContext], system: AnatomicalSystem, opacity: float
    ) -> str:
        """Make a whole system translucent so the reader can see through it.

        The move for "show me X under Y": ghost the skin and the muscles read
        straight through it, with the skin still on screen for context. Use this
        rather than `set_layer_visibility` whenever the relationship between the
        two layers is part of what you are explaining — hiding a layer throws
        that relationship away.

        `opacity` runs 0 to 1. Around 0.25 shows the shape of the layer while
        letting what is behind it read clearly; 1.0 puts it back to solid.
        """
        if system not in ctx.deps.systems:
            available = ", ".join(sorted(ctx.deps.systems))
            raise ModelRetry(
                f"The {system} system is not part of this atlas build. "
                f"Available systems: {available}."
            )
        if not MIN_GHOST <= opacity <= 1.0:
            raise ModelRetry(
                f"opacity must be between {MIN_GHOST} and 1, got {opacity}. "
                "To remove a layer entirely use set_layer_visibility — an "
                "invisible-but-present layer is a state the reader cannot "
                "interpret."
            )
        ctx.deps.dispatch(SetLayerOpacity(system=system, opacity=opacity))
        if opacity >= 1.0:
            return f"{system} is solid again."
        return f"{system} is now {opacity:.0%} opaque; what is behind it shows through."

    @agent.tool(sequential=True)
    def xray_system(ctx: RunContext[SceneContext], system: AnatomicalSystem) -> str:
        """Ghost every system *except* this one, so it can be followed through
        the whole body.

        The answer to "trace the nerves down the arm": everything else becomes
        a faint shell and the system in question stands alone inside it, still
        in place. Expands to one opacity change per other system, so there is
        no need to call `set_layer_opacity` repeatedly yourself.
        """
        if system not in ctx.deps.systems:
            available = ", ".join(sorted(ctx.deps.systems))
            raise ModelRetry(
                f"The {system} system is not loaded. Available systems: {available}."
            )

        others = sorted(ctx.deps.systems - {system})
        # The chosen system is set solid explicitly rather than left alone: it
        # may already be ghosted from an earlier x-ray, and the reader asked
        # for this one to be the layer that stands out.
        ctx.deps.dispatch(SetLayerOpacity(system=system, opacity=1.0))
        for other in others:
            ctx.deps.dispatch(SetLayerOpacity(system=other, opacity=XRAY_OPACITY))
        return (
            f"{system} is solid; {len(others)} other system(s) faded back so it "
            "can be followed through them."
        )

    @agent.tool(sequential=True)
    def apply_pathology_overlay(
        ctx: RunContext[SceneContext],
        organ_id: str,
        pathology: str,
        severity: float,
    ) -> str:
        """Tint a structure to show a disease state.

        `severity` runs 0 to 1 and drives the colour from healthy through amber
        to deep red, so it should track the degree you are describing.
        """
        organ = _resolve(ctx, organ_id)
        if not 0.0 <= severity <= 1.0:
            raise ModelRetry(
                f"severity must be between 0 and 1, got {severity}. "
                "Use 0.25 for mild, 0.5 for moderate, 0.85 for severe."
            )
        label = pathology.strip()
        if not label:
            raise ModelRetry("pathology must name the condition being shown.")

        ctx.deps.dispatch(
            ApplyPathologyOverlay(
                organ_id=organ.organ_id, pathology=label[:120], severity=severity
            )
        )
        return f"Marked {organ.name_en} with {label} at severity {severity:.2f}."

    @agent.tool(sequential=True)
    def clear_pathology_overlays(ctx: RunContext[SceneContext]) -> str:
        """Remove every disease overlay. Call this when the topic moves on."""
        ctx.deps.dispatch(ClearPathologyOverlays())
        return "Cleared all pathology overlays."

    @agent.tool(sequential=True)
    def highlight_pathway(
        ctx: RunContext[SceneContext],
        label: str,
        organ_ids: list[str],
        step_seconds: float = DEFAULT_STEP_SECONDS,
        loop: bool = True,
    ) -> str:
        """Animate a marker travelling through structures in anatomical order.

        This is the tool for a *process*, where the sequence is the lesson:
        swallowing a mouthful of water, food through the gut, blood through the
        chambers of the heart, air down to the alveoli, urine from kidney to
        urethra, an impulse along a nerve. A static highlight cannot show order;
        this can.

        Prefer it over repeated `focus_organ` calls when the reader needs to see
        the *whole* route at once — the tube stays on screen, so the shape of
        the journey is visible after the marker has passed.

        - `label` names the process in the reader's language. It is shown over
          the canvas, so write it for them: "Swallowing a glass of water".
        - `organ_ids` is the route, in the order the thing travels. Get the ids
          with `find_structures` first; never guess them.
        - `step_seconds` is how long the marker takes between consecutive
          structures. Raise it when you are explaining each step in detail.
        - `loop` replays the route continuously. Use it for a circuit such as
          circulation, and turn it off for a one-way journey, where looping
          jumps visibly from the last structure back to the first.
        """
        name = label.strip()
        if not name:
            raise ModelRetry(
                "label must name the process being traced — the reader sees it "
                "over the model."
            )

        if len(organ_ids) < MIN_PATHWAY_STOPS:
            raise ModelRetry(
                f"A pathway needs at least {MIN_PATHWAY_STOPS} structures, got "
                f"{len(organ_ids)}. To point at a single structure use focus_organ."
            )
        if len(organ_ids) > MAX_PATHWAY_STOPS:
            raise ModelRetry(
                f"Too many stops ({len(organ_ids)}); the limit is "
                f"{MAX_PATHWAY_STOPS}. Trace the part of the route that answers "
                "the question, or split it into two pathways."
            )

        if not MIN_STEP_SECONDS <= step_seconds <= MAX_STEP_SECONDS:
            raise ModelRetry(
                f"step_seconds must be between {MIN_STEP_SECONDS} and "
                f"{MAX_STEP_SECONDS}, got {step_seconds}. "
                f"{DEFAULT_STEP_SECONDS} suits most explanations."
            )

        resolved = [_resolve(ctx, organ_id).organ_id for organ_id in organ_ids]

        # A repeated stop is a zero-length segment, which gives the viewer's
        # curve an undefined tangent and corrupts the whole route rather than
        # just that step. Cheaper to refuse here than to defend downstream.
        for previous, current in pairwise(resolved):
            if previous == current:
                raise ModelRetry(
                    f"{current!r} appears twice in a row. Each step must move to "
                    "a different structure; list the route without repeats."
                )

        ctx.deps.dispatch(
            HighlightPathway(
                label=name[:120],
                organ_ids=resolved,
                step_seconds=step_seconds,
                loop=loop,
            )
        )
        return (
            f"Tracing {name!r} through {len(resolved)} structures at "
            f"{step_seconds:g}s per step{', looping' if loop else ''}."
        )

    @agent.tool(sequential=True)
    def clear_pathway(ctx: RunContext[SceneContext]) -> str:
        """Stop tracing the current route. Call this when the topic moves on."""
        ctx.deps.dispatch(ClearPathway())
        return "Cleared the pathway."

    @agent.tool(sequential=True)
    def set_cross_section(
        ctx: RunContext[SceneContext], plane: SectionPlane, position: float
    ) -> str:
        """Cut the model open along a plane to reveal internal structure.

        `position` runs -1 to 1 across the model's extent on that axis; 0 cuts
        through the middle.
        """
        if not -1.0 <= position <= 1.0:
            raise ModelRetry(
                f"position must be between -1 and 1, got {position}. "
                "0 cuts through the centre."
            )
        ctx.deps.dispatch(SetCrossSection(plane=plane, position=position))
        return f"Cut the model on the {plane} plane at {position:.2f}."
