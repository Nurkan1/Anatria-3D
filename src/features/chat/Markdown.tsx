import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { organLabel, useSceneStore } from "@/stores/sceneStore";

import { collectOrganRefs, linkifyOrganRefs, REF_SCHEME } from "./organRefs";
import { useCopy } from "./useCopy";

/**
 * Renders assistant output.
 *
 * The model writes Markdown — headings, lists, emphasis, the occasional table
 * of diagnostic findings. Showing that raw would bury the structure it uses to
 * teach, so it is rendered. Only Markdown is parsed: raw HTML is not enabled,
 * which keeps model output from becoming a markup injection vector inside the
 * webview.
 */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const text = String(children).replace(/\n$/, "");
  const { copied, copy } = useCopy();

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-md bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-200">
        <code>{text}</code>
      </pre>
      <button
        type="button"
        onClick={() => void copy(text)}
        className="absolute right-2 top-2 rounded border border-slate-700 bg-slate-900/90 px-1.5 py-0.5 text-[10px] text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-slate-200"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

/**
 * A numbered pin tying a phrase in the answer to a structure in the viewport.
 *
 * Hovering highlights the mesh, clicking flies the camera to it — the same
 * store the assistant's own tools write to, so a click and a tool call put the
 * scene in exactly the same state.
 */
function OrganPin({ organId, label }: { organId: string; label: string }) {
  const organ = useSceneStore((s) => s.organs[organId]);
  const setHovered = useSceneStore((s) => s.setHovered);
  const applyCommand = useSceneStore((s) => s.applyCommand);
  if (!organ) return null;

  return (
    <button
      type="button"
      onMouseEnter={() => setHovered(organId)}
      onMouseLeave={() => setHovered(null)}
      onFocus={() => setHovered(organId)}
      onBlur={() => setHovered(null)}
      onClick={() => applyCommand({ action: "focus_organ", organ_id: organId })}
      title={organLabel(organ)}
      className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500/20 px-1 align-super text-[9px] font-semibold text-sky-300 transition hover:bg-sky-500/40 hover:text-sky-100"
    >
      {label}
    </button>
  );
}

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  const organs = useSceneStore((s) => s.organs);

  // Markers are resolved against the structures actually loaded, so an id the
  // model invented disappears instead of surfacing as literal brackets.
  const source = useMemo(() => {
    const refs = collectOrganRefs(children, (organId) => organId in organs);
    return refs.length > 0 ? linkifyOrganRefs(children, refs) : children;
  }, [children, organs]);

  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-slate-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="mt-3 text-sm font-semibold text-slate-100">{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 className="mt-3 text-[13px] font-semibold text-slate-100">{children}</h4>
          ),
          h3: ({ children }) => (
            <h5 className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {children}
            </h5>
          ),
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-4 marker:text-slate-600">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-4 marker:text-slate-600">{children}</ol>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-50">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-sky-700/60 pl-3 text-slate-400">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => {
            if (href?.startsWith(REF_SCHEME)) {
              return (
                <OrganPin
                  organId={href.slice(REF_SCHEME.length)}
                  label={String(children)}
                />
              );
            }
            // Any other model-authored link must not navigate the app shell
            // away from itself; render it as inert text.
            return (
              <span className="text-sky-400 underline decoration-dotted" title={href}>
                {children}
              </span>
            );
          },
          code: ({ children, className }) =>
            className?.includes("language-") ? (
              <CodeBlock>{children}</CodeBlock>
            ) : (
              <code className="rounded bg-slate-800 px-1 py-0.5 text-[11px] text-sky-200">
                {children}
              </code>
            ),
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-slate-700 px-2 py-1 text-left font-semibold text-slate-300">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-slate-800 px-2 py-1 align-top">{children}</td>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
