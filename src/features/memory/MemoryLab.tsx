import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "@/features/chat/Markdown";
import { stripOrganRefs } from "@/features/chat/organRefs";
import { loadManifest, meshUrl } from "@/lib/manifest";
import type { ManifestOrgan } from "@/lib/schemas";
import { getStudySession, listNotes, listStudySessions, type SessionDetail, type StudyNote } from "@/lib/studyDb";
import { useSceneStore } from "@/stores/sceneStore";
import { useStudyStore } from "@/stores/studyStore";

import "./memoryLab.css";
import { EraseQueue, RESTORE_WINDOW_S } from "./eraseQueue";
import { createLabSound, storedLabSound, storeLabSound, type LabSound } from "./labSound";
import { calloutPlacement, freeMargins, type Box } from "./layout";
import { byMonth, memoriesFrom, tally, type Memory, type MemoryKind } from "./memories";
import { createBodyHologram, type BodyHologram } from "./scene/bodyHologram";
import type { BrainStructure } from "./scene/brainLoader";
import { studiedIds, studiedOrgans, type StudiedOrgan } from "./studied";
import { createMemoryScene, type GraphicsStatus, type LabPhase, type MemoryScene } from "./scene/memoryScene";

/**
 * The Memory Lab: the study journal as a map of memories on a holographic brain.
 *
 * A screen of its own, over everything, and deliberately apart from the atlas:
 * nothing here touches the body or the viewport. It reads the journal, lets a
 * memory be opened and read, and lets one be erased — with a countdown during
 * which it can still be restored, because the journal's delete is final.
 *
 * Loaded only when opened, and it frees everything it made when closed, so the
 * rest of the application does not pay for it.
 */

const KIND_LABEL: Record<MemoryKind, string> = {
  session: "STUDY SESSION",
  case: "CASE VISIT",
  note: "NOTE",
};

/**
 * Three ways to lay the lab out, chosen from the real size of the window —
 * never from the device. `wide` tilts the panels in 3D, `medium` flattens and
 * narrows them, `compact` folds the index into a rail and raises the reader
 * from the bottom as a sheet.
 */
type Size = "wide" | "medium" | "compact";
function sizeFor(width: number, height: number): Size {
  if (width < 960 || height < 600) return "compact";
  if (width < 1320 || height < 780) return "medium";
  return "wide";
}

/** Hair is drawn as strands, which the hologram turns into noise; the figure is better bare. */
const NOT_SURFACE = /^(Hairs of|Eyelashes|Pubic hairs)/;

const FOCUS_KEY = "anatria3d.memory.focus.v1";

/** Focus is remembered: someone who reads with it on will want it on next time. */
function storedFocus(): boolean {
  try {
    return window.localStorage.getItem(FOCUS_KEY) === "on";
  } catch {
    return false;
  }
}

function storeFocus(on: boolean): void {
  try {
    window.localStorage.setItem(FOCUS_KEY, on ? "on" : "off");
  } catch {
    // Blocked storage: the choice lasts until the lab closes.
  }
}

/** How long the hologram may take to appear before the page says it is slow. */
const SLOW_LOAD_MS = 15000;
/** How long a graphics reset may last before the page offers to start again. */
const RESET_GRACE_MS = 6000;

/**
 * One line under the title saying how the hologram is running, only when that
 * is worth knowing. Worst news first; nothing at all when all is well.
 */
function graphicsNotice(noGraphics: boolean, status: GraphicsStatus | null): string | null {
  if (noGraphics) return "THIS COMPUTER CANNOT DRAW THE HOLOGRAM · EVERY MEMORY IS STILL HERE TO READ";
  if (!status) return null;
  if (status.lost) return "THE GRAPHICS CARD RESET · RESTORING THE HOLOGRAM…";
  if (status.adapter === "software") return "NO GRAPHICS ACCELERATION ON THIS COMPUTER · RUNNING LIGHT";
  if (status.eased) return "EFFECTS EASED TO KEEP THE HOLOGRAM SMOOTH ON THIS COMPUTER";
  return null;
}

/** How long Erase must be held down, in milliseconds. */
const HOLD_MS = 1400;

type Reading =
  | { state: "loading" }
  | { state: "session"; detail: SessionDetail }
  | { state: "note"; note: StudyNote }
  | { state: "missing" };

/**
 * One formatter, made once. `toLocaleString` with options builds a new one on
 * every call, and the timeline formats a date per memory on every render —
 * with two hundred memories that was most of the time a hover took.
 */
const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const when = (ms: number) => DATE.format(ms);

/** A failure to load, said as what could not be reached rather than as a stack. */
function unreachable(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  return /fetch|network|load/i.test(text)
    ? "The brain hologram could not be loaded. Your memories are safe — try again."
    : `The hologram stopped: ${text}`;
}

export function MemoryLab({ onClose }: { onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bodyBox = useRef<HTMLDivElement>(null);
  const body = useRef<BodyHologram | null>(null);
  const sound = useRef<LabSound | null>(null);
  const head = useRef<HTMLElement>(null);
  const left = useRef<HTMLElement>(null);
  const right = useRef<HTMLElement>(null);
  const footer = useRef<HTMLElement>(null);
  const callout = useRef<HTMLDivElement>(null);
  const scene = useRef<MemoryScene | null>(null);
  const queue = useRef(new EraseQueue());

  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [notes, setNotes] = useState<Map<string, StudyNote>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<LabPhase>("boot");
  const [mapped, setMapped] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [erased, setErased] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ key: string; left: number } | null>(null);
  const [holding, setHolding] = useState(false);
  const [size, setSize] = useState<Size>(() => sizeFor(window.innerWidth, window.innerHeight));
  const [railOpen, setRailOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [soundOn, setSoundOn] = useState(storedLabSound);
  /**
   * Focus mode, for reading: the film grain over the whole screen goes, and the
   * panels lie flat with plain crisp text. The hologram and all its motion stay.
   */
  const [focus, setFocusMode] = useState(storedFocus);
  const focusNow = useRef(focus);
  const [graphics, setGraphics] = useState<GraphicsStatus | null>(null);
  /** No WebGL at all: the lab carries on as an index and a reader. */
  const [noGraphics, setNoGraphics] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);
  const [atlas, setAtlas] = useState<readonly ManifestOrgan[]>([]);
  /** What the open memory was about, as lit in the figure; null while it is being found. */
  const [studied, setStudied] = useState<StudiedOrgan[] | null>([]);
  /** Bumped by Retry, to load the hologram again after a failure. */
  const [attempt, setAttempt] = useState(0);

  const byKey = useMemo(() => new Map((memories ?? []).map((m) => [m.key, m])), [memories]);
  const live = useMemo(() => (memories ?? []).filter((m) => !erased.has(m.key)), [memories, erased]);

  // --- the journal ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    Promise.all([listStudySessions(null, null, null, 1000), listNotes(null, null, 1000)])
      .then(([sessions, noteList]) => {
        if (cancelled) return;
        setNotes(new Map(noteList.map((note) => [String(note.id), note])));
        setMemories(memoriesFrom(sessions, noteList));
      })
      .catch((reason: unknown) => !cancelled && setError(String(reason)));
    return () => {
      cancelled = true;
    };
  }, []);

  // --- the hologram --------------------------------------------------------
  useEffect(() => {
    const element = stage.current;
    if (!element || !memories || memories.length === 0) return;
    let disposed = false;
    // The male atlas always: the brain lives there, whichever body is on screen.
    // Read, never changed: when the atlas already holds the male index it is
    // reused, instead of fetching and validating 1.3 MB again while the
    // hologram is trying to start.
    const atlas = useSceneStore.getState();
    const known = atlas.genderModel === "male" ? atlas.manifest : null;
    (known ? Promise.resolve(known) : loadManifest("male"))
      .then((manifest) => {
        if (disposed) return;
        setAtlas(manifest.organs);
        const structures: BrainStructure[] = manifest.organs
          .filter((organ) => organ.path?.includes("Brain") && organ.mesh_file === "nervous_male.glb")
          .map((organ) => ({
            node: organ.node,
            name: organ.name_en.replace(/\s*\((left|right)\)$/, ""),
            latin: organ.ta2_latin,
            region: organ.path![organ.path!.indexOf("Brain") + 1] ?? "Brain",
            side: /\(left\)$/.test(organ.name_en) ? "left" : /\(right\)$/.test(organ.name_en) ? "right" : "midline",
          }));
        try {
          scene.current = createMemoryScene(element, {
            meshUrl: meshUrl("nervous_male.glb"),
            structures,
            dracoPath: "/draco/",
            memories: memories.map(({ key, kind }) => ({ key, kind })),
            onGraphics: setGraphics,
            onHover: setHovered,
            onSelect: setSelected,
            onPhase: (next, count) => {
              setPhase(next);
              setMapped(count);
            },
            onError: (reason) => setError(unreachable(reason)),
          });
          scene.current.setFilm(!focusNow.current);
        } catch {
          // No WebGL on this machine. Everything except the hologram still works,
          // so open the index and let the memories be read.
          setNoGraphics(true);
          setRailOpen(true);
          return;
        }
        const figure = bodyBox.current;
        const frame = root.current;
        if (!figure || !frame || !scene.current) return;
        const surface: BrainStructure[] = manifest.organs
          .filter((organ) => organ.mesh_file === "regional_male.glb" && !NOT_SURFACE.test(organ.name_en))
          .map((organ) => ({
            node: organ.node,
            name: organ.name_en,
            latin: organ.ta2_latin,
            region: "Body",
            side: "midline",
          }));
        // The figure is decoration: if it cannot load, the lab goes on without it.
        body.current = createBodyHologram(figure, {
          meshUrl: meshUrl("regional_male.glb"),
          structures: surface,
          dracoPath: "/draco/",
          host: scene.current,
          frame,
          fileUrl: meshUrl,
          onError: () => {
            body.current?.dispose();
            body.current = null;
          },
        });
      })
      .catch((reason: unknown) => !disposed && setError(unreachable(reason)));
    return () => {
      disposed = true;
      scene.current?.dispose();
      scene.current = null;
      body.current?.dispose();
      body.current = null;
    };
  }, [memories, attempt]);

  useEffect(() => {
    focusNow.current = focus;
    storeFocus(focus);
    scene.current?.setFilm(!focus);
  }, [focus]);

  // --- saying so when loading is slow or the graphics card resets -------------
  useEffect(() => {
    setSlowLoad(false);
    if (!memories || memories.length === 0 || phase !== "boot" || noGraphics) return;
    const timer = window.setTimeout(() => setSlowLoad(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [memories, phase, noGraphics, attempt]);
  useEffect(() => {
    if (!graphics?.lost) return;
    const timer = window.setTimeout(
      () => setError("The graphics card reset and the hologram did not come back. Your memories are safe — try again."),
      RESET_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [graphics?.lost]);

  // --- sound -------------------------------------------------------------------
  useEffect(() => {
    sound.current = createLabSound(storedLabSound());
    return () => {
      sound.current?.close();
      sound.current = null;
    };
  }, []);
  useEffect(() => {
    sound.current?.setEnabled(soundOn);
    storeLabSound(soundOn);
  }, [soundOn]);
  useEffect(() => sound.current?.phase(phase), [phase]);
  useEffect(() => {
    if (phase === "mapping" && mapped > 0) sound.current?.mapped(mapped - 1, memories?.length ?? 1);
  }, [phase, mapped, memories]);
  useEffect(() => {
    const kind = hovered ? memories?.find((m) => m.key === hovered)?.kind : undefined;
    if (kind) sound.current?.hover(kind);
  }, [hovered, memories]);
  useEffect(() => {
    const kind = selected ? memories?.find((m) => m.key === selected)?.kind : undefined;
    sound.current?.select(kind ?? null);
  }, [selected, memories]);

  // What the open memory was about, lit inside the figure.
  useEffect(() => {
    const known = new Set(atlas.map((organ) => organ.organ_id));
    const ids =
      reading?.state === "session"
        ? studiedIds(
            reading.detail.structures,
            reading.detail.messages.filter((m) => m.role === "assistant").map((m) => m.content),
            (id) => known.has(id),
          )
        : reading?.state === "note"
          ? studiedIds(reading.note.organ_id ? [reading.note.organ_id] : [], [reading.note.body], (id) => known.has(id))
          : [];
    const organs = studiedOrgans(ids, atlas);
    const figure = body.current;
    if (!figure || organs.length === 0) {
      void figure?.show([]);
      setStudied([]);
      return;
    }
    let cancelled = false;
    setStudied(null);
    // Named under the figure only once found: a name with nothing lit above it would mislead.
    void figure.show(organs).then((found) => {
      if (cancelled) return;
      const lit = new Set(found);
      setStudied(organs.filter((organ) => lit.has(organ.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [reading, atlas]);

  // The index is laid over the figure; the figure steps back while it is open.
  useEffect(() => body.current?.setPresence(railOpen ? 0.15 : 1), [railOpen]);

  // --- making room: the size class, and where the hologram may go ------------
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      setSize(sizeFor(element.clientWidth, element.clientHeight));
      const frame = element.getBoundingClientRect();
      const boxes: Box[] = [];
      // The title is a corner, not a panel: it would push the brain aside for nothing.
      for (const ref of [bodyBox, left, right, footer]) {
        const panel = ref.current;
        if (!panel || panel.classList.contains("ml-hidden") || panel.classList.contains("ml-wide")) continue;
        if (panel.offsetParent === null) continue;
        const r = panel.getBoundingClientRect();
        boxes.push({ left: r.left - frame.left, top: r.top - frame.top, right: r.right - frame.left, bottom: r.bottom - frame.top });
      }
      scene.current?.setFocus(freeMargins(boxes, element.clientWidth, element.clientHeight));
    };
    // A class change moves a panel on the next frame, so measure just after it.
    const timer = window.setTimeout(measure, 40);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [selected, railOpen, wide, size, phase, memories]);

  // --- erasing -------------------------------------------------------------
  const commit = useCallback(async (keys: string[]) => {
    const study = useStudyStore.getState();
    for (const key of keys) {
      const [kind, id] = key.split(":") as [string, string];
      const ok = kind === "note" ? await study.removeNote(Number(id)) : await study.removeSession(id);
      if (!ok) setError("A memory could not be erased. It is still in your journal.");
    }
  }, []);

  // The countdown, and deleting whatever has run out.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const due = queue.current.due(now);
      if (due.length > 0) void commit(due);
      setPending((current) => {
        if (!current) return null;
        if (!queue.current.isPending(current.key)) return null;
        return { key: current.key, left: queue.current.secondsLeft(current.key, now) };
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [commit]);

  // Leaving commits what is pending: the reader saw it go and walked away.
  const close = useCallback(() => {
    const leftover = queue.current.flush();
    if (leftover.length > 0) void commit(leftover);
    onClose();
  }, [commit, onClose]);

  const erase = useCallback(
    (key: string) => {
      queue.current.erase(key, Date.now());
      scene.current?.erase(key);
      sound.current?.erase();
      setErased((current) => new Set(current).add(key));
      setPending({ key, left: RESTORE_WINDOW_S });
      setSelected(null);
      scene.current?.select(null);
    },
    [],
  );

  const restore = useCallback((key: string) => {
    if (!queue.current.restore(key)) return;
    scene.current?.restore(key);
    sound.current?.restore();
    setErased((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setPending(null);
  }, []);

  // --- reading the selected memory -------------------------------------------
  useEffect(() => {
    if (!selected) {
      setReading(null);
      return;
    }
    const memory = byKey.get(selected);
    if (!memory) return;
    if (memory.kind === "note") {
      const note = notes.get(memory.id);
      setReading(note ? { state: "note", note } : { state: "missing" });
      return;
    }
    setReading({ state: "loading" });
    let cancelled = false;
    getStudySession(memory.id)
      .then((detail) => !cancelled && setReading(detail ? { state: "session", detail } : { state: "missing" }))
      .catch(() => !cancelled && setReading({ state: "missing" }));
    return () => {
      cancelled = true;
    };
  }, [selected, byKey, notes]);

  const sizeNow = useRef(size);
  sizeNow.current = size;
  // Stable, so the index, the reader and the timeline below are not redrawn
  // just because the lab around them was.
  const choose = useCallback((key: string | null) => {
    setSelected(key);
    scene.current?.select(key);
    if (key === null) setWide(false);
    // On a small screen the rail folds away once something is picked from it.
    if (key !== null && sizeNow.current === "compact") setRailOpen(false);
  }, []);
  const toggleWide = useCallback(() => setWide((w) => !w), []);
  const holdStart = useCallback(() => {
    setHolding(true);
    sound.current?.holdStart();
  }, []);
  const holdEnd = useCallback(() => {
    setHolding(false);
    sound.current?.holdEnd();
  }, []);
  const holdDone = useCallback(
    (key: string) => {
      setHolding(false);
      sound.current?.holdEnd();
      erase(key);
    },
    [erase],
  );

  // --- the label that follows the pointed memory -----------------------------
  // Reading large covers the brain, and a label pointing into it would float over the page.
  const labelled = wide ? null : (hovered ?? selected);
  useEffect(() => {
    let frame = 0;
    const place = () => {
      frame = requestAnimationFrame(place);
      const element = callout.current;
      if (!element) return;
      const at = labelled ? scene.current?.screenPosition(labelled) : null;
      if (!at) {
        element.style.opacity = "0";
        return;
      }
      element.style.opacity = "1";
      element.style.transform = `translate(${at.x}px, ${at.y}px)`;
      const tag = element.querySelector<HTMLElement>(".ml-tag");
      const frame_ = root.current?.getBoundingClientRect();
      if (!tag || !frame_) return;
      // The clear stretch between whatever stands on the left and the reader on the right.
      // Only panels standing at a side count: the sheet a small screen reads in
      // lies across the bottom, and the label is never beside it.
      const standing = (panel: HTMLElement | null): DOMRect | null => {
        if (!panel || panel.offsetParent === null) return null;
        if (panel.classList.contains("ml-hidden") || panel.classList.contains("ml-wide")) return null;
        const r = panel.getBoundingClientRect();
        return r.width < frame_.width * 0.55 ? r : null;
      };
      let from = 0;
      for (const panel of [bodyBox.current, left.current]) {
        const r = standing(panel);
        if (r) from = Math.max(from, r.right - frame_.left);
      }
      const reader = standing(right.current);
      const to = reader ? reader.left - frame_.left : frame_.width;
      const natural = Math.max(...[...tag.children].map((child) => child.scrollWidth)) + 32;
      const placed = calloutPlacement(at.x, natural, from, to);
      element.classList.toggle("ml-flip", placed.side === "left");
      tag.style.maxWidth = `${placed.maxWidth}px`;
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [labelled]);

  // --- keys --------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (wide) setWide(false);
        else if (selected) choose(null);
        else if (railOpen) setRailOpen(false);
        else close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const total = memories?.length ?? 0;
  // Without a hologram there is no opening sequence to wait for.
  const intro = phase !== "live" && !noGraphics;
  const notice = graphicsNotice(noGraphics, graphics);
  const labelMemory = labelled ? byKey.get(labelled) : undefined;
  const selectedMemory = selected ? byKey.get(selected) : undefined;

  return (
    <div
      ref={root}
      className={`ml-root ${focus ? "ml-focus" : ""}`}
      data-size={size}
      role="dialog"
      aria-label="Study memory"
      onPointerDown={() => sound.current?.resume()}
      onClick={() => {
        if (!intro) return;
        scene.current?.skipIntro();
        body.current?.skipIntro();
      }}
    >
      <div ref={stage} className="ml-stage" />
      <div ref={bodyBox} className={`ml-body ${total > 0 && !noGraphics ? "" : "ml-hidden"}`}>
        {selectedMemory && studied !== null && studied.length > 0 && (
          <div className="ml-studied" aria-live="polite">
            <span>STUDIED IN THIS MEMORY</span>
            {studied.slice(0, 4).map((organ) => (
              <b key={organ.id}>{organ.name}</b>
            ))}
            {studied.length > 4 && <em>+{studied.length - 4} MORE</em>}
          </div>
        )}
        {selectedMemory && studied === null && (
          <div className="ml-studied">
            <span>LOCATING…</span>
          </div>
        )}
      </div>

      <div className="ml-hud">
        <header ref={head} className="ml-head">
          <div className="ml-title">STUDY MEMORY</div>
          <div className="ml-sub">YOUR JOURNAL · {live.length} MEMORIES · STORED ON THIS COMPUTER</div>

        </header>
        <div className="ml-corner">
          <button
            type="button"
            className={`ml-focus-toggle ${focus ? "ml-on" : ""}`}
            onClick={() => setFocusMode((on) => !on)}
            aria-pressed={focus}
            title={focus ? "Bring the film texture back" : "Clear the film texture and sharpen the text for reading"}
          >
            <i aria-hidden>◎</i>
            FOCUS {focus ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            className={`ml-sound ${soundOn ? "ml-on" : ""}`}
            onClick={() => setSoundOn((on) => !on)}
            aria-pressed={soundOn}
            title={soundOn ? "Turn the lab's sound off" : "Turn the lab's sound on"}
          >
            <i aria-hidden>
              <b />
              <b />
              <b />
              <b />
            </i>
            SOUND {soundOn ? "ON" : "OFF"}
          </button>
          <button type="button" className="ml-exit" onClick={close}>
            EXIT <span aria-hidden>✕</span>
          </button>
        </div>

        {memories && memories.length === 0 && (
          <div className="ml-empty">
            <b>NO MEMORIES YET</b>
            Every conversation with the assistant, every case and every note you keep becomes a memory here.
          </div>
        )}

        {total > 0 && (
          <>
            {!intro && (
              <button
                type="button"
                className={`ml-rail ${railOpen ? "ml-on" : ""}`}
                onClick={() => setRailOpen((open) => !open)}
                aria-expanded={railOpen}
              >
                <span aria-hidden>{railOpen ? "▴" : "▾"}</span> MEMORY INDEX · {live.length}
              </button>
            )}
            <section
              ref={left}
              className={`ml-panel ml-left ${
                intro || !railOpen ? "ml-hidden" : ""
              }`}
            >
              <MemoryIndex live={live} selected={selected} onChoose={choose} />
            </section>

            <section
              ref={right}
              className={`ml-panel ml-right ${selectedMemory ? "" : "ml-hidden"} ${wide ? "ml-wide" : ""}`}
              aria-live="polite"
            >
              {selectedMemory && (
                <MemoryReader
                  memory={selectedMemory}
                  reading={reading}
                  wide={wide}
                  holding={holding}
                  onToggleWide={toggleWide}
                  onClose={choose}
                  onHoldStart={holdStart}
                  onHoldEnd={holdEnd}
                  onHoldDone={holdDone}
                />
              )}
            </section>

            <footer ref={footer} className="ml-bottom">
              {intro ? (
                <>
                  <div className="ml-row">
                    <div className="ml-status">
                      {phase === "boot" &&
                        (slowLoad ? "STILL LOADING · THIS COMPUTER IS TAKING LONGER THAN USUAL" : "ACCESSING STUDY MEMORY")}
                      {phase === "deploy" && "DEPLOYING HOLOGRAPHIC PROJECTION"}
                      {phase === "materialize" && "RECONSTRUCTING NEURAL SURFACE"}
                      {phase === "mapping" && `MAPPING STUDY MEMORY · ${byKey.get(memories![Math.max(0, mapped - 1)]!.key)?.title.toUpperCase() ?? ""}`}
                    </div>
                    <div className="ml-percent">
                      {mapped}
                      <small>/ {total} MAPPED</small>
                    </div>
                  </div>
                  <div className="ml-bar">
                    <i style={{ width: `${(mapped / total) * 100}%` }} />
                  </div>
                  <div className="ml-skip">CLICK TO SKIP</div>
                </>
              ) : (
                <Timeline memories={memories!} erased={erased} selected={selected} onChoose={choose} onHover={setHovered} />
              )}
            </footer>
          </>
        )}

        <div ref={callout} className="ml-callout" aria-hidden>
          <svg width="160" height="60">
            <circle cx="0" cy="0" r="9" />
            <polyline points="0,0 34,-30 150,-30" />
          </svg>
          {labelMemory && (
            <div className="ml-tag">
              <b>{labelMemory.title}</b>
              <span>
                {KIND_LABEL[labelMemory.kind]} · {when(labelMemory.at)}
              </span>
            </div>
          )}
        </div>

        {pending && (
          <div className="ml-toast" role="status">
            <span>MEMORY ERASED</span>
            <button type="button" onClick={() => restore(pending.key)}>
              RESTORE ({pending.left})
            </button>
          </div>
        )}
        {notice && !error && (
          <div className="ml-notice" role="status">
            {notice}
          </div>
        )}
        {error && (
          <div className="ml-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              RETRY
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The pieces below are drawn only when what they show changes.
 *
 * Pointing at a memory changes one thing — the label that follows it — and it
 * used to redraw everything: the index, the reader with its Markdown, and a
 * button per memory along the timeline. That took long enough to drop frames,
 * and on a variable-refresh monitor a dropped frame is a visible blink.
 */

const MemoryIndex = memo(function MemoryIndex({
  live,
  selected,
  onChoose,
}: {
  live: Memory[];
  selected: string | null;
  onChoose: (key: string | null) => void;
}) {
  const counts = useMemo(() => tally(live), [live]);
  const months = useMemo(() => byMonth(live), [live]);
  const busiest = Math.max(1, ...months.map((m) => m.count));
  const recent = useMemo(() => [...live].reverse().slice(0, 12), [live]);
  return (
    <>
      <h3>
        MEMORY INDEX <span>{String(live.length).padStart(3, "0")}</span>
      </h3>
      {(["session", "case", "note"] as const).map((kind) => (
        <div key={kind} className="ml-count">
          <i className={`ml-dot ml-${kind}`} />
          <span>{KIND_LABEL[kind]}S</span>
          <b>{counts[kind]}</b>
        </div>
      ))}
      <h3 className="ml-gap">BY MONTH</h3>
      <div className="ml-months">
        {months.map((m) => (
          <div key={m.month} className="ml-month" title={`${m.month}: ${m.count}`}>
            <i style={{ height: `${(m.count / busiest) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="ml-months-scale">
        <span>{months[0]?.month}</span>
        <span>{months[months.length - 1]?.month}</span>
      </div>
      <h3 className="ml-gap">RECENT</h3>
      <ol className="ml-recent">
        {recent.map((m) => (
          <li key={m.key}>
            <button type="button" onClick={() => onChoose(m.key)} className={m.key === selected ? "ml-on" : ""}>
              <i className={`ml-dot ml-${m.kind}`} />
              <em>{m.title}</em>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
});

const MemoryReader = memo(function MemoryReader({
  memory,
  reading,
  wide,
  holding,
  onToggleWide,
  onClose,
  onHoldStart,
  onHoldEnd,
  onHoldDone,
}: {
  memory: Memory;
  reading: Reading | null;
  wide: boolean;
  holding: boolean;
  onToggleWide: () => void;
  onClose: (key: null) => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onHoldDone: (key: string) => void;
}) {
  return (
    <>
      <h3>
        {KIND_LABEL[memory.kind]} <span>{when(memory.at)}</span>
        <button
          type="button"
          className="ml-expand"
          onClick={onToggleWide}
          title={wide ? "Back to the side" : "Read it large"}
          aria-pressed={wide}
        >
          {wide ? "⤡" : "⤢"}
        </button>
      </h3>
      <div className="ml-reading-title">{memory.title}</div>
      <div className="ml-reading">
        {reading?.state === "loading" && <p className="ml-faint">RECALLING…</p>}
        {reading?.state === "missing" && <p className="ml-faint">This memory is no longer in the journal.</p>}
        {reading?.state === "note" && <p className="ml-note">{stripOrganRefs(reading.note.body)}</p>}
        {reading?.state === "session" && (
          <>
            {reading.detail.session.score !== null && (
              <p className="ml-score">
                SCORE {reading.detail.session.score}
                {reading.detail.session.verdict ? ` · ${reading.detail.session.verdict}` : ""}
              </p>
            )}
            {reading.detail.messages.map((message, i) => (
              <div key={i} className={`ml-message ml-${message.role}`}>
                <span>{message.role === "user" ? "YOU" : "ASSISTANT"}</span>
                {message.role === "assistant" ? (
                  // The lab does not link into the atlas, so the answer's
                  // structure markers are taken out rather than shown raw.
                  <Markdown structurePins={false}>{stripOrganRefs(message.content)}</Markdown>
                ) : (
                  <p>{message.content}</p>
                )}
              </div>
            ))}
          </>
        )}
      </div>
      <div className="ml-actions">
        <button type="button" className="ml-close-reading" onClick={() => onClose(null)}>
          CLOSE
        </button>
        <button
          type="button"
          className={`ml-erase ${holding ? "ml-holding" : ""}`}
          style={{ ["--ml-hold" as string]: `${HOLD_MS}ms` }}
          onPointerDown={onHoldStart}
          onPointerUp={onHoldEnd}
          onPointerLeave={onHoldEnd}
          onAnimationEnd={() => onHoldDone(memory.key)}
          title="Hold to erase this memory from your journal"
        >
          <i />
          HOLD TO ERASE
        </button>
      </div>
    </>
  );
});

/**
 * One button per memory, in the order they were made. The pointer is read once
 * on the strip rather than by a pair of handlers per button.
 */
const Timeline = memo(function Timeline({
  memories,
  erased,
  selected,
  onChoose,
  onHover,
}: {
  memories: Memory[];
  erased: Set<string>;
  selected: string | null;
  onChoose: (key: string | null) => void;
  onHover: (key: string | null) => void;
}) {
  const keyOf = (target: EventTarget | null) => {
    const key = (target as HTMLElement | null)?.closest<HTMLElement>(".ml-tick")?.dataset.key;
    return key && !erased.has(key) ? key : null;
  };
  return (
    <div
      className="ml-timeline"
      aria-label="Memories in the order they were made"
      onClick={(event) => {
        const key = keyOf(event.target);
        if (key) onChoose(key);
      }}
      onMouseOver={(event) => onHover(keyOf(event.target))}
      onMouseLeave={() => onHover(null)}
    >
      {memories.map((m) => (
        <button
          type="button"
          key={m.key}
          data-key={m.key}
          className={`ml-tick ml-${m.kind} ${erased.has(m.key) ? "ml-gone" : ""} ${m.key === selected ? "ml-on" : ""}`}
          aria-label={`${m.title}, ${when(m.at)}`}
        />
      ))}
    </div>
  );
});

export default MemoryLab;
