import { useEffect } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { repairGluedHeadings } from "@/features/chat/repairMarkdown";
import { APP_VERSION_LABEL } from "@/lib/appVersion";
import { usePrintStore } from "@/stores/printStore";

import {
  aiNotice,
  disclaimers,
  isPrintable,
  type PrintDocument,
  type PrintVisit,
} from "./printDocument";

/**
 * The printable page, shown first as a preview.
 *
 * # Why the browser prints this instead of a PDF library
 *
 * The assistant answers in whatever language the reader writes in, so a journal
 * can hold any script — Cyrillic, Greek, Arabic, Devanagari. A PDF library would
 * need a bundled font for each, plus right-to-left shaping, and would still be
 * guessing. The webview already has the system's fonts and the engine that lays
 * them out. It costs no dependency, nothing in the installer, and no new way to
 * write files: the reader's own print dialog decides where the PDF lands.
 *
 * # Why it is a preview and not a straight `window.print()`
 *
 * "What exactly gets exported" is a fair question to ask of anything leaving the
 * app, and the honest answer is to show it. The reader sees the page, then
 * prints it — and the print is their click, not ours.
 */
export function PrintSheet() {
  const document = usePrintStore((s) => s.document);
  const close = usePrintStore((s) => s.close);

  useEffect(() => {
    if (!document) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [document, close]);

  if (!document) return null;

  return createPortal(
    // Outside `#root`, which the print stylesheet hides. A sheet rendered
    // inside the app shell would be hidden along with it.
    <div
      data-print-root
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/85 p-6 backdrop-blur-sm"
    >
      <Toolbar onClose={close} />
      <article className="print-sheet mx-auto max-w-[820px] rounded bg-white px-12 py-10 text-slate-900 shadow-2xl">
        {/*
          A table, purely so the compliance notice can live in a `tfoot`.

          The first attempt fixed the notice to the bottom of the page. It did
          repeat on every page — but a fixed element is out of the flow, so it
          reserved no space, and the last lines of each page ran underneath it.
          A footer that eats the text above it is not a footer.

          `display: table-footer-group` is the one mechanism in print CSS that
          both repeats a block on every page *and* keeps the height for it. On
          screen the stylesheet collapses all of this back to plain blocks, so
          the preview is exactly the page.
        */}
        <table className="print-layout">
          <tbody>
            <tr>
              <td>
                <Heading document={document} />
                {document.verdict && <Verdict text={document.verdict} />}
                {document.structures.length > 0 && (
                  <Structures names={document.structures} />
                )}
                {document.notes.length > 0 && <Notes document={document} />}
                {document.findings && <Findings text={document.findings} />}
                {document.recordUpdates.length > 0 && (
                  <IntervalHistory document={document} />
                )}
                {document.symptoms.length > 0 && <Presentation document={document} />}
                {document.visits.map((visit) => (
                  <Visit key={visit.visitNo} visit={visit} />
                ))}
                {document.exchanges.length > 0 && <Transcript document={document} />}
                {/* Last on the page, deliberately: whoever hands this sheet to
                    a student passes the answer on the way to the end of it. */}
                {document.sealedAnswer && <SealedAnswer text={document.sealedAnswer} />}
                {!isPrintable(document) && (
                  <p className="mt-8 text-sm italic text-slate-500">
                    There is nothing here yet to print.
                  </p>
                )}
              </td>
            </tr>
          </tbody>
          {/*
            After `tbody` in the source, not before it. HTML allows either, and
            Chromium treats it as the footer group whichever way round — but on
            screen, where these are ordinary blocks, source order is the only
            thing deciding where the notice lands.
          */}
          <tfoot>
            <tr>
              <td>
                <Footer document={document} />
              </td>
            </tr>
          </tfoot>
        </table>
      </article>
    </div>,
    window.document.body,
  );
}

function Toolbar({ onClose }: { onClose: () => void }) {
  return (
    <div className="no-print mx-auto mb-4 flex max-w-[820px] items-start gap-2">
      <div className="text-[11px] leading-relaxed text-slate-400">
        <p>This is exactly what will be printed.</p>
        {/*
          Chromium stamps the page with a date, a page number and the app's
          internal address unless the reader turns it off, and no stylesheet can
          reach it — it is drawn outside the document. Said here because this is
          the moment the checkbox is in front of them.
        */}
        <p className="text-slate-500">
          In the print dialog, turn off <span className="text-slate-400">Headers and
          footers</span> — otherwise it stamps the page with its own date and address.
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.print()}
        className="ml-auto rounded border border-sky-600 bg-sky-600/15 px-3 py-1 text-xs text-sky-200 transition hover:bg-sky-600/30"
      >
        Print… or save as PDF
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500"
      >
        Close · Esc
      </button>
    </div>
  );
}

/** Date and time, in the reader's own locale conventions. */
function moment(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function day(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Heading({ document }: { document: PrintDocument }) {
  return (
    <header className="border-b border-slate-300 pb-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
        Anatria3D · Study journal
      </p>
      <h1 className="mt-1 text-2xl font-semibold leading-tight">{document.heading}</h1>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-600">
        {document.facts.map((fact) => (
          <div key={fact.label} className="flex gap-1.5">
            <dt className="text-slate-500">{fact.label}:</dt>
            <dd className="font-medium text-slate-800">{fact.value}</dd>
          </div>
        ))}
        {document.createdAt !== null && (
          <div className="flex gap-1.5">
            <dt className="text-slate-500">Started:</dt>
            <dd className="font-medium text-slate-800">{day(document.createdAt)}</dd>
          </div>
        )}
        {document.updatedAt !== null && (
          <div className="flex gap-1.5">
            <dt className="text-slate-500">Last worked on:</dt>
            <dd className="font-medium text-slate-800">{day(document.updatedAt)}</dd>
          </div>
        )}
      </dl>
    </header>
  );
}

function Verdict({ text }: { text: string }) {
  return (
    <section className="print-block mt-6 border-l-2 border-slate-400 pl-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        How it went
      </h2>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{text}</p>
    </section>
  );
}

function Structures({ names }: { names: string[] }) {
  return (
    <section className="print-block mt-6">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Structures covered
      </h2>
      <p className="mt-1 text-[12px] italic leading-relaxed text-slate-700">
        {names.join(" · ")}
      </p>
    </section>
  );
}

function Notes({ document }: { document: PrintDocument }) {
  return (
    <section className="mt-6">
      <SectionHeading>Notes</SectionHeading>
      <div className="mt-2 space-y-4">
        {document.notes.map((note, index) => (
          <div key={index} className="print-block">
            <p className="text-[10px] text-slate-500">
              {note.structure && (
                <span className="italic text-slate-700">{note.structure} · </span>
              )}
              {moment(note.when)}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed">
              {note.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** What the case was given: vitals, history, results. Never a secret. */
function Findings({ text }: { text: string }) {
  return (
    <section className="mt-6 print-block">
      <SectionHeading>On the record</SectionHeading>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{text}</p>
    </section>
  );
}

/**
 * What was learned after the opening, in visit order.
 *
 * Its own section rather than appended to the findings, because when it was
 * learned is part of what it says: "BP 130/85 at visit 6" and "BP 130/85" are
 * different clinical statements, and only the first one describes a course.
 */
function IntervalHistory({ document }: { document: PrintDocument }) {
  return (
    <section className="mt-6">
      <SectionHeading>Added to the record</SectionHeading>
      <div className="mt-2 space-y-2">
        {document.recordUpdates.map((entry, index) => (
          <div key={index} className="print-block">
            <p className="text-[10px] text-slate-500">
              <span className="font-semibold text-slate-700">
                Visit {entry.visitNo}
              </span>
              {" · "}
              {moment(entry.when)}
            </p>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
              {entry.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The complaints, in the order they were reported.
 *
 * Headed "as reported" because that is the whole content of the section: this
 * is where the reader said it hurt, which in a case worth teaching is not
 * where the cause is. A page that presented these as findings would invert the
 * exercise.
 */
function Presentation({ document }: { document: PrintDocument }) {
  return (
    <section className="mt-6">
      <SectionHeading>Presentation, as reported</SectionHeading>
      <div className="mt-2 space-y-2">
        {document.symptoms.map((symptom, index) => (
          <div key={index} className="print-block">
            <p className="text-[10px] text-slate-500">
              {symptom.structure && (
                <span className="italic text-slate-700">{symptom.structure} · </span>
              )}
              {moment(symptom.when)}
              {symptom.severity !== null && (
                <span className="ml-2">severity {symptom.severity}/10</span>
              )}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed">{symptom.symptom}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Visit({ visit }: { visit: PrintVisit }) {
  return (
    <section className="mt-6">
      <SectionHeading>
        Visit {visit.visitNo}
        <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
          {moment(visit.when)}
        </span>
        {visit.score !== null && (
          <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">
            · {visit.score} / 100
          </span>
        )}
      </SectionHeading>

      {visit.structures.length > 0 && (
        <p className="mt-1 text-[11px] italic leading-relaxed text-slate-600">
          {visit.structures.join(" · ")}
        </p>
      )}

      <div className="mt-2 space-y-5">
        {visit.exchanges.map((exchange, index) => (
          <div key={index}>
            <p className="print-keep-with-next text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {exchange.role === "user" ? "Asked" : "Answered"}
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                {moment(exchange.when)}
              </span>
              {exchange.model && (
                <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                  · by {exchange.model}
                </span>
              )}
            </p>
            <div
              className={
                exchange.role === "user"
                  ? "mt-1 border-l-2 border-slate-300 pl-3 text-[13px] leading-relaxed"
                  : "mt-1 text-[13px] leading-relaxed"
              }
            >
              <PrintMarkdown>{repairGluedHeadings(exchange.body)}</PrintMarkdown>
            </div>
          </div>
        ))}
      </div>

      {visit.verdict && (
        <div className="mt-3 border-l-2 border-slate-400 pl-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Assessment
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed">
            {visit.verdict}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * What the case was sealed with, written before anyone attempted it.
 *
 * Labelled as authored rather than as a conclusion: nothing on this page was
 * concluded from the presentation above it. Someone wrote it, in advance, and
 * the point of the exercise was to arrive at it.
 */
function SealedAnswer({ text }: { text: string }) {
  return (
    <section className="mt-6 print-block">
      <SectionHeading>Authored answer — sealed when the case opened</SectionHeading>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{text}</p>
    </section>
  );
}

function Transcript({ document }: { document: PrintDocument }) {
  return (
    <section className="mt-6">
      <SectionHeading>The conversation</SectionHeading>
      <div className="mt-2 space-y-5">
        {document.exchanges.map((exchange, index) => (
          <div key={index}>
            <p className="print-keep-with-next text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {exchange.role === "user" ? "Asked" : "Answered"}
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                {moment(exchange.when)}
              </span>
              {/* On the "Answered" line rather than in the header facts,
                  because a session can span models: printing one name at the
                  top would misattribute every answer that came from another. */}
              {exchange.model && (
                <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                  · by {exchange.model}
                </span>
              )}
            </p>
            <div
              className={
                exchange.role === "user"
                  ? "mt-1 border-l-2 border-slate-300 pl-3 text-[13px] leading-relaxed"
                  : "mt-1 text-[13px] leading-relaxed"
              }
            >
              <PrintMarkdown>{repairGluedHeadings(exchange.body)}</PrintMarkdown>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="print-keep-with-next border-b border-slate-300 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
      {children}
    </h2>
  );
}

/**
 * The assistant's Markdown, restyled for paper.
 *
 * A separate component from the chat panel's renderer rather than a variant of
 * it: that one is built for a dark panel and turns structure markers into
 * interactive pins, neither of which survives a printer. Raw HTML stays off
 * here for the same reason it is off there — model output must not become
 * markup inside the webview.
 */
function PrintMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      // Same repair as the chat panel. A heading the model welded to the
      // previous sentence would otherwise print two literal hashes mid-
      // paragraph, on the one artefact here that cannot be corrected after the
      // fact — paper.
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h3 className="mt-3 text-sm font-semibold">{children}</h3>,
        h2: ({ children }) => (
          <h4 className="mt-3 text-[13px] font-semibold">{children}</h4>
        ),
        h3: ({ children }) => (
          <h5 className="mt-2 text-[12px] font-semibold uppercase tracking-wide text-slate-600">
            {children}
          </h5>
        ),
        p: ({ children }) => <p className="mt-1.5">{children}</p>,
        ul: ({ children }) => (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
        ),
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="mt-1.5 border-l-2 border-slate-300 pl-3 text-slate-700">
            {children}
          </blockquote>
        ),
        // A link in a printed document cannot be followed, and the underline
        // would only promise something the paper cannot deliver.
        a: ({ children }) => <span>{children}</span>,
        code: ({ children }) => (
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="print-block mt-1.5 overflow-x-auto rounded bg-slate-100 p-2 text-[11px]">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <table className="print-block mt-2 w-full border-collapse text-[11px]">
            {children}
          </table>
        ),
        th: ({ children }) => (
          <th className="border border-slate-300 px-2 py-1 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-slate-300 px-2 py-1 align-top">{children}</td>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

/**
 * The compliance notice.
 *
 * On screen it closes the sheet; on paper it repeats at the foot of *every*
 * page, carried there by the `tfoot` above. That is not belt and braces — pages
 * get separated, torn out and photographed one at a time, and a notice that
 * only exists on page one stops being attached to anything the moment that
 * happens.
 */
function Footer({ document }: { document: PrintDocument }) {
  return (
    <footer className="print-footer mt-10 border-t border-slate-300 pt-3 text-[9px] leading-snug text-slate-500">
      {disclaimers(document.language).map((line) => (
        <p key={line}>{line}</p>
      ))}
      {/*
        Under the medical notice rather than above it. Both belong on the page,
        but only one of them is about whether a person can be harmed by acting
        on what is printed, and that one reads first.
      */}
      {aiNotice(document).map((line) => (
        <p key={line} className="mt-1">
          {line}
        </p>
      ))}
      <p className="mt-1">
        Anatria3D {APP_VERSION_LABEL} · printed {moment(document.producedAt)}
      </p>
    </footer>
  );
}
