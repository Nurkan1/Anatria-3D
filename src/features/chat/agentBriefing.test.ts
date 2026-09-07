import { describe, expect, it } from "vitest";

import { agentBriefing } from "./agentBriefing";

const NAME = "anatria3d-control-S-1-5-21-000-000-000-1001";
const PIPE = `\\\\.\\pipe\\${NAME}`;
const SERVER = "C:\\Program Files\\Anatria3D\\resources\\anatria-mcp";

/** Wrapping is layout; these assertions are about what the text says. */
const flat = (pipe: string, server: string | null = null) =>
  agentBriefing(pipe, server).replace(/\s+/g, " ");

describe("agentBriefing", () => {
  it("carries the pipe this window is actually listening on", () => {
    // A briefing with a placeholder path is worse than none: it looks
    // authoritative and sends the agent to a pipe that does not exist.
    expect(agentBriefing(PIPE, null)).toContain(PIPE);
  });

  it("also gives the bare name the Windows API actually wants", () => {
    // `NamedPipeClientStream` takes the last segment. Handing it the full path
    // fails in a way that reads like the bridge being down — one of the two
    // ways an agent loses its first attempt here.
    const text = agentBriefing(PIPE, null);
    expect(text).toContain(`'${NAME}'`);
    expect(text).toContain("takes the NAME, not the path");
  });

  it("carries a whole client for a reader with no Python", () => {
    // The pipe half has to stand alone: it is the route for somebody who has
    // the application and nothing else installed.
    const text = flat(PIPE);
    expect(text).toContain("needs no Python at all");
    expect(text).toContain("NamedPipeClientStream");
    expect(text).toContain("$writer.WriteLine");
  });

  it("names the MCP route before the pipe", () => {
    // Typed, validated tools beat hand-rolled frames whenever both are open,
    // and a model handed two ways in often takes the one it can start now.
    const text = agentBriefing(PIPE, null);
    expect(text.indexOf("BEST —")).toBeLessThan(text.indexOf("OTHERWISE —"));
    expect(text).toContain("ANATRIA3D_BRIDGE");
  });

  it("writes without a byte order mark rather than relying on tolerance", () => {
    expect(flat(PIPE)).toContain("UTF8Encoding $false");
  });

  it("warns that a second client is refused", () => {
    // The other way a first attempt is lost: an MCP client already holding the
    // pipe, which reads exactly like the switch being off.
    expect(flat(PIPE)).toContain("One client at a time");
  });

  it("repeats the warnings an agent on the pipe never reads elsewhere", () => {
    const text = flat(PIPE);
    expect(text).toContain("accepted and does nothing on screen");
    expect(text).toContain("not guessable");
    expect(text).toContain("no way to search over the pipe");
  });

  it("tells the agent its prose is attributed and unsaved", () => {
    // It should know the lane it lands in before it writes for it.
    const text = flat(PIPE);
    expect(text).toContain("via the control bridge");
    expect(text).toContain("never sent to the reader's AI provider");
  });
});

describe("agentBriefing, when the server ships with the application", () => {
  it("gives the path on this machine, separator and all", () => {
    // In a template literal `\a` is just `a`, so a single backslash in the
    // source produces "…anatria-mcpatlas.py" — a path that exists nowhere, in
    // a briefing whose entire purpose is not to do that. It happened once.
    expect(agentBriefing(PIPE, SERVER)).toContain(`${SERVER}\\atlas.py`);
  });

  it("falls back to the source path when this build carries no server", () => {
    expect(agentBriefing(PIPE, null)).toContain("in the Anatria3D source");
  });

  it("never tells the reader to install into the application's folder", () => {
    // The MCP SDK must not land beside the frozen engine: `build_sidecar.py`
    // collects pydantic_ai wholesale and the SDK sits inside that package.
    expect(flat(PIPE, SERVER)).toContain(
      "do not install anything into the application's folder",
    );
  });
});
