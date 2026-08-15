import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { ManifestOrgan } from "@/lib/schemas";
import { useSceneStore } from "@/stores/sceneStore";

import { DepthProbe } from "./DepthProbe";

// Latin and English kept distinct, because the panel renders both: a fixture
// that used one string for each would make every query ambiguous.
function organ(id: string, latin: string, english: string): ManifestOrgan {
  return {
    organ_id: id,
    ta2_latin: latin,
    name_en: english,
    system: "muscular",
    mesh_file: "muscular_male.glb",
    node: latin,
    path: [],
  } as ManifestOrgan;
}

const ORGANS = {
  skin: organ("skin", "Regio pectoralis", "Pectoral region"),
  fascia: organ("fascia", "Fascia pectoralis", "Pectoral fascia"),
  pectoralis: organ("pectoralis", "Musculus pectoralis major", "Pectoralis major"),
};

beforeEach(() => {
  useSceneStore.setState({
    organs: ORGANS,
    depthStack: ["skin", "fascia", "pectoralis"],
    depthStackLive: true,
    pinnedStack: null,
    depthProbeVisible: true,
    isolatedOrganIds: null,
    focusRequest: null,
    hoveredOrganId: null,
  });
});

describe("the depth panel's controls", () => {
  it("still flies to a structure when its line is clicked", () => {
    // The gesture that existed first, and the one at risk when the row gained
    // a second button beside it. Isolating empties the viewport of everything
    // else; a reader scanning the list and tapping a name does not mean that.
    render(<DepthProbe />);

    fireEvent.click(screen.getByText("Fascia pectoralis"));

    expect(useSceneStore.getState().focusRequest?.organId).toBe("fascia");
    expect(useSceneStore.getState().isolatedOrganIds).toBeNull();
  });

  it("leaves only the one structure when its solo is pressed", () => {
    render(<DepthProbe />);

    const solos = screen.getAllByTitle(/^Show only /);
    fireEvent.click(solos[1]!);

    expect(useSceneStore.getState().isolatedOrganIds).toEqual(["fascia"]);
  });

  it("leaves the whole crossing when the approach is isolated", () => {
    // What the panel is actually about: a ray through the shoulder is a
    // surgical approach written down, in the order it is met.
    render(<DepthProbe />);

    fireEvent.click(screen.getByText(/Isolate these 3/i));

    expect(useSceneStore.getState().isolatedOrganIds).toEqual([
      "skin",
      "fascia",
      "pectoralis",
    ]);
  });

  it("isolates the reading that was pinned, not the one under the cursor", () => {
    // The two have to agree. Isolating what the pointer happens to be crossing
    // while the panel lists something else would empty the viewport of the
    // very structures the reader is looking at.
    useSceneStore.setState({
      pinnedStack: ["skin", "fascia"],
      depthStack: ["pectoralis"],
    });
    render(<DepthProbe />);

    fireEvent.click(screen.getByText(/Isolate these 2/i));

    expect(useSceneStore.getState().isolatedOrganIds).toEqual(["skin", "fascia"]);
  });

  it("offers nothing to isolate when the panel is not shown", () => {
    useSceneStore.setState({ depthProbeVisible: false });
    render(<DepthProbe />);

    expect(screen.queryByText(/Isolate these/i)).toBeNull();
  });
});
