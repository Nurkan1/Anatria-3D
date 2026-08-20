import { describe, expect, it } from "vitest";

import { describeFrame } from "./ipc";

/**
 * A malformed frame is logged so a protocol drift can be found. What must not
 * come with it is the frame's contents: this channel carries base64 audio for
 * the voice experiment, and a recording of somebody's voice in a console is
 * both unreadable and a thing nobody agreed to keep.
 */
describe("describeFrame", () => {
  it("names the shape without reproducing any value", () => {
    const clip = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=".repeat(40);
    const described = describeFrame({
      type: "speech",
      request_id: "r1",
      audio_b64: clip,
      mime_type: "audio/wav",
    });

    expect(described).toContain("speech");
    expect(described).toContain("audio_b64");
    expect(described).not.toContain(clip);
    // Not even a fragment — a prefix of a clip is still a clip.
    expect(described).not.toContain(clip.slice(0, 24));
  });

  it("keeps a transcript out of the log too", () => {
    const heard = "the patient reports chest pain";
    expect(describeFrame({ type: "transcript", text: heard })).not.toContain(heard);
  });

  it("survives a frame that is not an object at all", () => {
    expect(describeFrame(null)).toBe("<object>");
    expect(describeFrame("a stray string")).toBe("<string>");
  });
});
