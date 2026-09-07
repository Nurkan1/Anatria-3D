import { describe, expect, it } from "vitest";

import { agentBriefing } from "./agentBriefing";

const PIPE = "\\\\.\\pipe\\anatria3d-control-S-1-5-21-000-000-000-1001";

describe("agentBriefing", () => {
  it("carries the pipe this window is actually listening on", () => {
    // A briefing with a placeholder path is worse than none: it looks
    // authoritative and sends the agent to a pipe that does not exist.
    expect(agentBriefing(PIPE)).toContain(PIPE);
  });

  it("names the MCP server before the raw pipe", () => {
    // Hand a model two ways in and it will often take the one it can start
    // immediately. The typed, validated path has to come first and be marked
    // as the preferred one, or the fallback becomes the default.
    const text = agentBriefing(PIPE);
    expect(text.indexOf("PREFERRED")).toBeLessThan(text.indexOf("FALLBACK"));
    expect(text).toContain("ANATRIA3D_BRIDGE");
  });

  it("gives a frame an agent can send without reading the source", () => {
    const text = agentBriefing(PIPE);
    expect(text).toContain('"type":"scene_command"');
    expect(text).toContain("One JSON object per line, UTF-8");
    // Its own request_id is dropped, and an agent that does not know that
    // will try to correlate replies by one it invented.
    expect(text).toContain("request_id");
  });

  it("points at the working client rather than inviting a new one", () => {
    expect(agentBriefing(PIPE)).toContain("tools/anatria_mcp/bridge.py");
  });

  it("repeats the three warnings an agent on the fallback path never sees", () => {
    // The MCP server states these about itself. An agent writing raw frames
    // never reads them, and each one costs a reader a round trip.
    //
    // Whitespace is collapsed first: what matters is that the sentence is
    // there, not where the prose happens to wrap.
    const text = agentBriefing(PIPE).replace(/\s+/g, " ");
    expect(text).toContain("accepted here and does nothing on screen");
    expect(text).toContain("not guessable");
    expect(text).toContain("finds nothing even when the structure exists");
  });
});
