import { useSceneStore } from "./sceneStore";
import { writeStoredView } from "./viewPreferences";

/**
 * Keep the stored view in step with the one on screen.
 *
 * Subscribed to the store rather than wired into each control: there are a
 * dozen ways to change what a system looks like — the tree, the x-ray button,
 * the assistant's own scene commands — and every one of them should be
 * remembered. Watching the result covers all of them, including the ones added
 * next month.
 */

/**
 * The section slider fires continuously while it is dragged, and switching a
 * dozen systems is a dozen writes. `localStorage` is synchronous and on the
 * main thread, so it is worth coalescing.
 */
const SETTLE_MS = 400;

export function startViewPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const unsubscribe = useSceneStore.subscribe((state, previous) => {
    // Nothing is worth storing until an atlas has loaded. Without this the
    // empty defaults present during startup would overwrite the very
    // preferences that are about to be restored.
    if (!state.manifest) return;

    const changed =
      state.hiddenSystems !== previous.hiddenSystems ||
      state.systemOpacity !== previous.systemOpacity ||
      state.eyeTracking !== previous.eyeTracking ||
      state.labelsVisible !== previous.labelsVisible ||
      state.background !== previous.background;
    if (!changed) return;

    clearTimeout(timer);
    timer = setTimeout(() => {
      const current = useSceneStore.getState();
      writeStoredView({
        hiddenSystems: current.hiddenSystems,
        systemOpacity: current.systemOpacity,
        eyeTracking: current.eyeTracking,
        labelsVisible: current.labelsVisible,
        background: current.background,
      });
    }, SETTLE_MS);
  });

  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
