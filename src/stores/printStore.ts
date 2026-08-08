import { create } from "zustand";

import type { PrintDocument } from "@/features/study/printDocument";

/**
 * The page waiting to be printed, if any.
 *
 * A store rather than props because the two ends are far apart: the buttons
 * that build a document live inside the study panel's lists, and the sheet has
 * to render at the application root — a preview inside a scrolling side panel
 * would inherit its width and its clipping.
 *
 * Nothing here is persisted. A print is an action, not a setting.
 */
interface PrintStore {
  document: PrintDocument | null;
  show: (document: PrintDocument) => void;
  close: () => void;
}

export const usePrintStore = create<PrintStore>()((set) => ({
  document: null,
  show: (document) => set({ document }),
  close: () => set({ document: null }),
}));
