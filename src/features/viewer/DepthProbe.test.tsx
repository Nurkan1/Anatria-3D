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
    pinnedStack: null,
    depthProbeVisible: true,
    isolatedOrganIds: null,
    focusRequest: null,
    hoveredOrganId: null,
    selectedOrganIds: [],
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

describe("picking a few layers out of the crossing", () => {
  it("adds a line to the selection on Ctrl-click, without flying to it", () => {
    // Flying is the thing that must not happen. The camera would leave the one
    // place the reading is about, in the middle of building a set there.
    render(<DepthProbe />);

    fireEvent.click(screen.getByText("Fascia pectoralis"), { ctrlKey: true });

    expect(useSceneStore.getState().selectedOrganIds).toEqual(["fascia"]);
    expect(useSceneStore.getState().focusRequest).toBeNull();
  });

  it("takes the same line back out on a second Ctrl-click", () => {
    // The undo for a misclick is the gesture itself, exactly as it is on the
    // body. A set you can only add to is a set you have to clear and rebuild.
    render(<DepthProbe />);

    const line = screen.getByText("Fascia pectoralis");
    fireEvent.click(line, { ctrlKey: true });
    fireEvent.click(line, { ctrlKey: true });

    expect(useSceneStore.getState().selectedOrganIds).toEqual([]);
  });

  it("accepts Cmd too, for the keyboard where Ctrl-click is a right-click", () => {
    render(<DepthProbe />);

    fireEvent.click(screen.getByText("Musculus pectoralis major"), { metaKey: true });

    expect(useSceneStore.getState().selectedOrganIds).toEqual(["pectoralis"]);
  });

  it("builds a set across several lines, in the order they were picked", () => {
    render(<DepthProbe />);

    fireEvent.click(screen.getByText("Regio pectoralis"), { ctrlKey: true });
    fireEvent.click(screen.getByText("Musculus pectoralis major"), { ctrlKey: true });

    expect(useSceneStore.getState().selectedOrganIds).toEqual(["skin", "pectoralis"]);
  });

  it("leaves a plain click flying, so the older gesture is untouched", () => {
    useSceneStore.setState({ selectedOrganIds: ["skin"] });
    render(<DepthProbe />);

    fireEvent.click(screen.getByText("Fascia pectoralis"));

    expect(useSceneStore.getState().focusRequest?.organId).toBe("fascia");
  });

  it("teaches the gesture while nothing is picked", () => {
    // Nothing on screen suggests a modifier exists. Without this line the
    // feature is only reachable by someone who already knows it is there.
    render(<DepthProbe />);

    expect(screen.getByText(/Ctrl-click a line/i)).toBeTruthy();
  });

  it("counts only the picks that are in this reading", () => {
    // The selection may hold structures taken from the tree or the search box.
    // Counting those here would describe a reading nobody is looking at.
    useSceneStore.setState({ selectedOrganIds: ["fascia", "somewhere_else"] });
    render(<DepthProbe />);

    expect(screen.getByText(/1 of these selected/i)).toBeTruthy();
    expect(screen.queryByText(/Ctrl-click a line/i)).toBeNull();
  });
});
