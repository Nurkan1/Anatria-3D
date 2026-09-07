import { useBridgeStore } from "@/stores/bridgeStore";

import { Markdown } from "./Markdown";

/** External prose is deliberately not a MessageBubble or a journal entry. */
export function BridgeProse() {
  const entries = useBridgeStore((s) => s.prose);
  if (entries.length === 0) return null;

  return (
    <section
      aria-label="Control bridge messages"
      className="max-h-[35%] shrink-0 space-y-3 overflow-y-auto border-y border-amber-800/60 bg-amber-950/20 p-3"
    >
      <h2 className="text-xs font-semibold text-amber-200">External messages</h2>
      <p className="text-[11px] text-amber-200/80">
        Not the Anatria3D assistant. Not saved or sent to your provider.
        Latest 20 messages; cleared when the bridge is turned off.
      </p>
      {entries.map((entry) => (
        <article key={entry.id} className="border-l-2 border-amber-700 pl-3">
          <p className="mb-1 text-[11px] font-semibold text-amber-300">via the control bridge</p>
          <Markdown structurePins={false}>{entry.text}</Markdown>
        </article>
      ))}
    </section>
  );
}
