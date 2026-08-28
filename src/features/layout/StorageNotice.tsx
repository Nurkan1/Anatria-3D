import { useEffect, useState } from "react";

import { onStorageFailure, storageFailure } from "@/lib/localStore";

/**
 * Said once, where the settings are, when the machine will not keep them.
 *
 * # Why this is worth the room it takes
 *
 * Without it the application is indistinguishable from one that has simply
 * never been configured. Every launch opens on the default provider, the
 * default model, every system on, the guide in front — exactly what a first run
 * looks like — and the reader is left to conclude that the app forgets on
 * purpose, or that they did not really save anything. It cost a morning to
 * work out from the outside, with the code in hand; a reader has neither.
 *
 * So it names the fact and its consequence, and stops. There is no action to
 * offer: the browser engine underneath has refused storage for the session, and
 * nothing the application can do from inside will change that. Saying "try
 * again" would be a lie.
 *
 * The exact error goes in the tooltip rather than the line, because the sentence
 * is for the reader and `SecurityError: Failed to read the 'localStorage'
 * property` is for whoever they report it to.
 */
export function StorageNotice() {
  const [failure, setFailure] = useState(storageFailure);

  useEffect(() => {
    // Storage can fail later than the first read — a quota reached mid-session
    // is a different failure from one refused at launch — so this listens
    // rather than checking once.
    setFailure(storageFailure());
    return onStorageFailure(() => setFailure(storageFailure()));
  }, []);

  if (failure === null) return null;

  return (
    <p
      title={failure}
      className="shrink-0 border-t border-amber-700/50 bg-amber-500/10 px-4 py-2 text-[10px] leading-snug text-amber-300"
    >
      This machine is not letting Anatria3D remember anything. Your provider,
      model, systems and layout will be back to their defaults next time you
      open it. Your notes and your API keys are unaffected — those are kept
      elsewhere.
    </p>
  );
}
