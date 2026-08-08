import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy-to-clipboard with a confirmation that resets itself.
 *
 * Falls back to the legacy `execCommand` path: the async Clipboard API needs a
 * secure context and a permission that a webview does not always grant, and a
 * copy button that silently does nothing is worse than no button.
 */
export function useCopy(resetAfterMs = 1600) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string) => {
      const ok = (await writeClipboard(text)) || legacyCopy(text);
      if (!ok) return false;

      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetAfterMs);
      return true;
    },
    [resetAfterMs],
  );

  return { copied, copy };
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    // Off-screen rather than hidden: a `display:none` element is not
    // selectable, so the copy would quietly produce an empty clipboard.
    area.style.position = "fixed";
    area.style.top = "-9999px";
    area.setAttribute("readonly", "");
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
