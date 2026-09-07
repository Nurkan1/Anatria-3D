import { describe, expect, it } from "vitest";

import { agentBriefing } from "./agentBriefing";

const NAME = "anatria3d-control-S-1-5-21-000-000-000-1001";
const PIPE = `\\\\.\\pipe\\${NAME}`;

/** Wrapping is layout; these assertions are about what the text says. */
const flat = (pipe: string) => agentBriefing(pipe).replace(/\s+/g, " ");

describe("agentBriefing", () => {
  it("carries the pipe this window is actually listening on", () => {
    // A briefing with a placeholder path is worse than none: it looks
    // authoritative and sends the agent to a pipe that does not exist.
    expect(agentBriefing(PIPE)).toContain(PIPE);
  });

  it("also gives the bare name the Windows API actually wants", () => {
    // `NamedPipeClientStream` takes the last segment. Handing it the full
    // path fails in a way that reads like the bridge being down, which is one
    // of the two ways an agent loses its first attempt here.
    const text = agentBriefing(PIPE);
    expect(text).toContain(`'${NAME}'`);
    expect(text).toContain("takes the NAME, not the path");
  });

  it("works for a reader who has the application and no source", () => {
    // The first version of this briefing sent the agent to two files in the
    // repository. The installer ships the engine and nothing else, so on a
    // machine where somebody installed the .exe neither exists — the test
    // only passed because the repository was on the same disk.
    const text = flat(PIPE);
    expect(text).toContain("does NOT include this server");
    expect(text).toContain("needs no source and no Python");
    // A whole client, not a description of one.
    expect(text).toContain("NamedPipeClientStream");
    expect(text).toContain("$writer.WriteLine");
  });

  it("names the source route first for whoever can take it", () => {
    // Typed, validated tools beat hand-rolled frames whenever both are open.
    const text = agentBriefing(PIPE);
    expect(text.indexOf("IF YOU HAVE THE ANATRIA3D SOURCE")).toBeLessThan(
      text.indexOf("OTHERWISE"),
    );
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
    // It cannot search over the pipe, so it must not invent identifiers.
    expect(text).toContain("no way to search over the pipe");
  });

  it("tells the agent its prose is attributed and unsaved", () => {
    // It should know the lane it lands in before it writes for it.
    const text = flat(PIPE);
    expect(text).toContain("via the control bridge");
    expect(text).toContain("never sent to the reader's AI provider");
  });
});
