"""The one tool a case drill has that a lesson does not: recording the grade.

Registered only when the request arrives in `case` mode, which is the point —
a tutoring turn has no way to write a score into the student's journal even if
the model decides it would like to.

The score is separated from the prose deliberately. The evaluation itself
streams as ordinary text and is worth reading once; the number is what the
journal can average, sort and chart, and it cannot be recovered from a
paragraph after the fact.
"""

from __future__ import annotations

from pydantic_ai import Agent, ModelRetry, RunContext

from anatria_engine.scene_tools import SceneContext

#: Below this the "verdict" is an acknowledgement, not an evaluation. A student
#: reviewing a drill three weeks later needs to see why they scored what they
#: scored, and "Good answer." does not survive that gap.
MIN_VERDICT_CHARS = 40

MAX_VERDICT_CHARS = 4000


def register_case_tools(agent: Agent[SceneContext, str]) -> None:
    """Attach the grading tool. Case mode only."""

    @agent.tool
    def record_case_verdict(
        ctx: RunContext[SceneContext], score: int, verdict: str
    ) -> str:
        """Record the grade for the student's answer to a case drill.

        Call this once, after you have finished evaluating the attempt — not
        when you first present the scenario, and never before the student has
        answered.

        `score` runs 0 to 100 and follows the bands in your instructions.
        `verdict` is a short written judgement the student will see again when
        they revisit this case: what they got right, what they missed, and the
        reasoning they should have reached.
        """
        record = ctx.deps.emit_verdict
        if record is None:
            raise ModelRetry(
                "Grades can only be recorded during a case drill. "
                "Answer the question directly instead."
            )

        if not 0 <= score <= 100:
            raise ModelRetry(
                f"score must be between 0 and 100, got {score}. "
                "Use the bands in your instructions."
            )

        summary = " ".join(verdict.split())
        if len(summary) < MIN_VERDICT_CHARS:
            raise ModelRetry(
                "The verdict is too short to be useful later. Say what the "
                "student got right, what they missed, and why it matters."
            )

        record(score, summary[:MAX_VERDICT_CHARS])
        return f"Recorded {score}/100 in the study journal."
