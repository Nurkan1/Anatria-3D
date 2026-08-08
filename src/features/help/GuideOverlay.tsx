import { useEffect, useRef, useState } from "react";

/**
 * How the app works, for someone opening it for the first time.
 *
 * It leads with the boundary rather than the controls. A student who learns
 * what this tool is *not* for before they learn to rotate the model is a
 * student who never has to unlearn anything.
 *
 * Every gesture described here is one that exists — the file is written against
 * `OrganMesh`, `AnatomyScene` and `SelectionBar`, not against intentions. If a
 * gesture changes, this changes with it.
 */

interface Section {
  id: string;
  nav: string;
  title: string;
  body: React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "boundary",
    nav: "What this is",
    title: "An atlas that explains itself",
    body: (
      <>
        <p>
          Anatria3D is a 3D human anatomy atlas with an assistant that teaches from
          it. Ask a question and it answers while moving the model — isolating the
          structure, cutting a section, marking a disease state — so the explanation
          and the thing being explained are on screen together.
        </p>
        <Callout>
          <strong>It is study material, and only that.</strong> Anatria3D is not a
          medical device and gives no advice about any real person. If you describe
          symptoms — yours or anyone's — the assistant will decline and point you to a
          qualified professional. That boundary is deliberate and cannot be switched
          off.
        </Callout>
        <p>
          Everything stays on your machine. The anatomy ships with the app, your notes
          live in a local file, and the only thing that ever leaves is the question you
          type — sent to the AI provider whose key you supplied.
        </p>
        <Callout>
          <strong>The atlas is a male body.</strong> Its source, Z-Anatomy, publishes
          one model and describes it as such, so there is no female anatomy here — no
          uterus, no ovaries, no female pelvic structures. Everything that is not
          sex-specific is the same in both, but where it differs, this shows one of
          them. Worth knowing before you rely on it for the pelvis.
        </Callout>
        <Callout>
          <strong>Some other things are missing too</strong>, and it is better to read
          it here than to find out mid-revision. The gut runs duodenum → jejunum and
          then jumps to the colon: there is no <em>ileum, caecum, rectum or anal
          canal</em>. There are no <em>meninges</em> — no dura, arachnoid or pia — and
          no <em>skin</em> as an organ, only named surface regions. Also absent: the
          thoracic duct, the vocal folds, and the lung's bronchopulmonary segments,
          though all twenty-seven segmental bronchi are here.
        </Callout>
        <p>
          A few things exist only as their parts, with no single mesh for the whole:
          the skull, the larynx, the lung, the small intestine, the peritoneum and the
          lumbar and sacral plexuses. Right-click reaches the group where the atlas
          defines one.
        </p>
        <p>
          What <em>is</em> complete: the arterial and venous trees down to the limbs,
          the musculature, the urinary and endocrine organs, every bone, the twelve
          cranial nerves, the lymph nodes in unusual detail, and the eight hepatic
          segments.
        </p>
      </>
    ),
  },
  {
    id: "moving",
    nav: "Moving around",
    title: "Getting to what you want to see",
    body: (
      <>
        <Rows
          rows={[
            ["Drag", "Orbit around the model"],
            ["Right-drag", "Pan — slide the model sideways"],
            ["Scroll", "Zoom toward the pointer, not the centre"],
          ]}
        />
        <p>
          Zoom follows the cursor deliberately. Point at an eye and scroll, and you
          arrive at the eye; zooming toward the body's centre would let you approach a
          head only by going through the chest.
        </p>
        <p>
          The <Ui>Atlas</Ui> panel on the left lists every structure, grouped by
          system. Switch a system off to get it out of the way — the app only loads
          the geometry for systems that are actually on, so the body arrives in pieces
          as you ask for them.
        </p>
        <Callout>
          <strong>The row at the bottom right is the way back.</strong> Orbiting
          freehand is how you end up upside down behind the left shoulder with no
          idea how you got there. <Ui>Fit</Ui> reframes — the whole body, or just
          what you are studying if anything is isolated. <Ui>A P L R S</Ui> are the
          standard anatomical viewpoints: anterior, posterior, left and right
          lateral, superior. <Ui>+</Ui> and <Ui>−</Ui> move you in and out without
          needing a scroll wheel.
          <br />
          <br />
          The viewpoints only <em>turn</em> the view; they keep the distance you had.
          Zooming in on a valve and then pressing <Ui>P</Ui> shows you that valve
          from behind, still close up — <Ui>Fit</Ui> is the separate button for when
          you want to pull back out. And <Ui>L</Ui> is the body's own left, not the
          left of your screen, read from the model itself.
        </Callout>
        <p>
          How you leave the view is how you find it. Which systems are on, how
          translucent they are, whether names are shown, what the space sits on and
          whether the eyes follow you all come back next time. What you were{" "}
          <em>doing</em> does not — a selection, an isolation or a cross-section
          belongs to the session it was made in. A body that opened already sliced
          through the neck would just look broken.
        </p>
        <p>
          Each system has three controls, and they answer different questions. The
          checkbox shows or hides it. <Ui>◐</Ui> makes it translucent — ghost the body
          surface and the muscles beneath it read straight through, with the surface
          still there for context, which hiding it would throw away. <Ui>X-ray</Ui> ghosts
          everything <em>except</em> that system, which is how you follow the nerves
          through a whole body. <Ui>Solo</Ui> hides the rest outright.
        </p>
        <p>
          A ghosted structure stops catching clicks, so you can reach what is under
          it. Select it from this panel instead when you want the ghost itself.
        </p>
        <Callout>
          <strong>Point at the body and look at the panel on the right.</strong> It
          lists everything under the cursor from the surface inwards — at the neck,
          the surface region, then platysma, then sternocleidomastoid, then the
          carotid sheath, then the artery. That is the question a surgical approach
          asks and the one an examiner asks, and it depends on exactly where you are
          pointing, so no page in a book can answer it.
          <br />
          <br />
          Nothing there is inferred. It is not a model of tissue layers: it is the
          geometry a ray from your cursor actually crossed, in the order it crossed
          it. Click any line to fly to that structure.
        </Callout>
        <p>
          <strong>Then press <Ui>Glass body</Ui>.</strong> The whole model turns to
          glass, and now the column under your cursor does not just get listed — it{" "}
          <em>lights up</em>, brightest at the surface and fading with depth. Sweep
          the pointer across the abdomen and the organs light in turn as you pass
          over them.
        </p>
        <p>
          The light is warm and white on purpose. Blue would read as "selected" and
          amber as "diseased"; this is neither. It is a lamp falling on something,
          which is exactly what it is — and it only becomes visible once you can see
          through what is in front, which is exactly when you want it.
        </p>
        <p>
          <strong>The assistant uses the same light.</strong> Ask it something and it
          will point at what it is naming as it names it — the quietest thing it can
          do to the scene, since nothing moves and nothing is hidden. A bar names
          what is lit and turns it off. While the assistant's light is on it takes
          precedence over your cursor's, so there is never a question of which lit
          thing is being talked about; the panel still lists whatever is under your
          pointer.
        </p>
        <p>
          <strong>Surface anatomy is what those three controls are for.</strong> The
          body's outside lives in the <Ui>Regional</Ui> system, and it is the layer to
          reach for: <Ui>Solo</Ui> it for the surface alone, the way you would look at a
          person; press <Ui>◐</Ui> once and it turns translucent, so you can read which
          muscle makes which contour — with the contour still on screen, which is the
          whole question. Ghosted that far it also stops catching clicks, so the muscle
          you are looking at is the one you select.
        </p>
        <Callout>
          Switching the surface on over everything else and leaving both solid is the
          one combination that tells you nothing: opaque skin over opaque muscle is just
          skin. That is what <Ui>◐</Ui> is for.
          <br />
          <br />
          The faint lines across the face, neck and chest are not a fault. The atlas has
          no skin as a single organ — the surface is a sheet cut into 256 named regions,
          and those lines are where it is cut. Each one is a structure you can click,
          name and study.
        </Callout>
        <p>
          Structures are coloured by tissue, the way a printed atlas is: bone ivory,
          muscle deep red, nerves pale yellow, lymphatics green. Arteries are drawn red
          and veins blue, so a vascular tree reads without clicking anything. The dot
          beside each system in the left panel is the legend.
        </p>
        <p>
          Tissue beats system where the two disagree — tendons and fascia are pearly
          white rather than muscle red, cartilage is blue-white, fat is yellow, and the
          liver, spleen, pancreas and gallbladder each keep their own colour instead of
          sharing one for “digestive”.
        </p>
        <p>
          <Ui>Label what I select</Ui> puts the names out in the margins with a leader
          line to each structure, the way an atlas plate does it. Then{" "}
          <Ui>Save this view as an image</Ui> writes the whole thing — labels, colours
          and attribution — to a PNG you can put in a slide or a revision card.
        </p>
        <p>
          <Ui>Background</Ui> switches the 3D space between dark and light. Dark is
          easier over a long session; light is for anything the figure has to leave in
          — a handout, a slide, a document that is not itself dark. The image export
          follows whichever you picked.
        </p>
        <p>
          The <Ui>Colour key</Ui> in the corner names every colour that is on screen
          right now, and nothing else — switch a system on and its tissues join the
          list; isolate the heart and it shrinks to what the heart is made of. Drag it
          anywhere, or collapse it with <Ui>▴</Ui>.
        </p>
      </>
    ),
  },
  {
    id: "choosing",
    nav: "Choosing structures",
    title: "Selecting, isolating, dissecting",
    body: (
      <>
        <Rows
          rows={[
            ["Click", "Select one structure"],
            ["Ctrl+click", "Add it to the selection, or take it out again"],
            ["Double-click", "Open that structure with everything inside it"],
            ["Right-click", "Choose which level to isolate"],
          ]}
        />
        <p>
          Ctrl+click is what makes comparison possible: pick four muscles, then ask the
          assistant how they differ. The same gesture removes one added by mistake.
        </p>
        <Callout>
          <strong>Ctrl+drag draws round a whole region.</strong> Hold Ctrl and trace a
          loop — freehand, not a box, because a rectangle round a skull takes the
          collarbones with it. Everything whose centre falls inside joins the
          selection, including what is behind. Then <Ui>I</Ui> isolates it. Picking out
          the bones of the head one click at a time is forty clicks; the tree cannot
          help, because the grouping you want there is spatial and the tree is
          taxonomic.
        </Callout>
        <Callout>
          <strong>Right-click is worth knowing about.</strong> The atlas has no single
          mesh called “Heart” — the heart is a collection of seventeen parts, so
          clicking a chamber can only ever select that chamber. Right-clicking offers
          the ancestry instead: the chamber, then the heart, then the whole
          cardiovascular system, each with the number of structures it would show.
        </Callout>
        <Callout>
          <strong>An organ is studied with its supply, or it is not studied.</strong>{" "}
          The atlas files structures by system, so isolating the heart brings its
          chambers and valves and leaves the coronary arteries behind under{" "}
          <em>Systemic arteries</em> — a different branch entirely. While anything is
          isolated, <Ui>+ vessels</Ui> folds in the arteries and veins that reach it,
          and <Ui>+ nerves</Ui> does the same for its innervation. Both switch the
          system on for you if it was off.
          <br />
          <br />
          It works on whatever you are studying, not on a list of important organs:
          the heart with its coronaries, the brain with the circle of Willis, one
          muscle with the nerve that moves it. What comes in is what physically
          reaches the structure, so a vessel that only passes close by will arrive
          too — drop it with its <Ui>✕</Ui> and the rest stays.
        </Callout>
        <p>
          While structures are isolated, the panel at the top lists every part in the
          set. Click one to fly to it, hover to highlight it on the model, or press its
          <Ui> ✕</Ui> to drop it — which is how you take the seventeen parts of the
          heart and keep the four you are actually revising.
        </p>
        <p>
          Drag that panel by its header to wherever it suits you; it stays there next
          time. Double-click the header to put it back.
        </p>
        <p>
          With a selection made, the bar at the bottom of the viewport offers two
          verbs. <Ui>Isolate</Ui> shows only what you picked. <Ui>Hide</Ui> takes it
          out of the way — the dissection move, peeling off what covers the thing you
          actually want to see. They combine: hide the deltoid, then isolate what was
          underneath.
        </p>
        <p>
          <strong>The third verb is to take the group apart.</strong> Press <Ui>X</Ui>
          and the parts move outwards away from their own shared centre — far enough
          apart to see the faces that are normally pressed together. It acts on what you
          have selected, or on what you are studying, or on the whole body when neither
          applies; the bar that appears over the viewport always says which.
        </p>
        <p>
          That bar carries a slider, and so does the panel. The key steps through four
          fixed amounts, which is what you want for knocking a group open and shut; the
          slider is for the times when one particular separation is the one that shows
          the relationship, and you want to find it while watching the model rather than
          the control.
        </p>
        <Callout>
          Nothing is hidden and nothing is rearranged. Every part moves straight out
          along the line it already stood on, by the same proportion, so what was medial
          stays medial and you never lose track of which piece is which. Slide back to
          zero — or press <Ui>Reassemble</Ui> — and the anatomy is exactly as it was.
          The one thing it cannot do is separate structures that share a centre, such as
          the tunics of the eyeball: there is no direction to move them in, and that is
          what transparency is for.
        </Callout>
      </>
    ),
  },
  {
    id: "assistant",
    nav: "The assistant",
    title: "Asking, and being shown",
    body: (
      <>
        <p>
          The assistant needs a key from an AI provider — Anthropic, OpenAI or Google.
          Open <Ui>Settings</Ui> in the assistant panel, paste one, and the app will
          fetch the models that key can use. That same call is what proves the key
          works, so there is no separate test to run.
        </p>
        <Callout>
          Your key is stored in your operating system's credential manager and is never
          visible to the app's interface. It is read only when a question is on its way
          out.
        </Callout>
        <p>
          Set your <Ui>profile</Ui> before asking. The same structure is explained
          three different ways: everyday language for a layperson, terminology and
          mechanism for a student, clinical density for a clinician. Set your language
          too — answers come in Bulgarian, Spanish or English, with the Latin kept
          alongside so the term still travels to other sources.
        </p>
        <Callout>
          <strong>Those three are a default, not a limit.</strong> If none of them is
          yours, write your question in your own language and the assistant will answer
          in it, and keep doing so. There is no setting to change — three buttons cannot
          list every reader, and the one they leave out is the one who cannot read the
          buttons. Typing an anatomical term in Latin does not count as switching
          language; it is the atlas's nomenclature, not a request.
        </Callout>
        <p>
          Structure names in an answer carry a small numbered pin. Hover one to
          highlight that structure in the viewport; click it to fly there. The full set
          appears as a legend under the answer.
        </p>
        <p>
          The names on the model are always in Terminologia Anatomica Latin. That is
          the profession's nomenclature and it does not change by country — translating
          it for your level and language is the assistant's job, done per question.
        </p>
      </>
    ),
  },
  {
    id: "cases",
    nav: "Case drills",
    title: "Practising instead of reading",
    body: (
      <>
        <p>
          Switch the assistant from <Ui>Tutor</Ui> to <Ui>Case drill</Ui> and it stops
          answering questions and starts asking them. You get a patient, the relevant
          anatomy marked on the model, and one question: what is happening, and what
          would you do first?
        </p>
        <p>
          Then it stops. It will not solve the case for you — that is the entire point.
          Answer in your own words, and it grades what you wrote out of 100: what you
          got right, what you missed, and the reasoning it was looking for. The score
          goes into your journal, so the average across your drills means something.
        </p>
        <Callout>
          <strong>The patient is invented.</strong> Every scenario is constructed for
          teaching and says so in its opening line. If you describe someone real, the
          drill ends and the assistant goes back to the rules above.
        </Callout>
      </>
    ),
  },
  {
    id: "journal",
    nav: "Your journal",
    title: "What you write down, and what you have done",
    body: (
      <>
        <p>
          The <Ui>Study</Ui> tab on the left is yours. Conversations are filed there
          automatically as you have them — you never have to remember to save one — and
          each is indexed by the structures that were selected when you asked. That is
          what makes <em>“what have I already studied about the left ventricle?”</em> a
          question with an answer.
        </p>
        <p>
          Add a note at any time; if a structure is selected, the note is filed under
          it. Any answer from the assistant can be kept with <Ui>Save as note</Ui>.
          Press <Ui>⌕</Ui> on a note to narrow everything to that structure, and the
          search box still works inside that — so “aorta” plus “dissection” is one
          question, not two.
        </p>
        <p>
          Reopening a session brings back its transcript and the structures it was
          about. All of it lives in a local file; nothing is uploaded anywhere.
        </p>
        <p>
          Because it is local, it is yours to carry. <Ui>Export</Ui> writes the whole
          journal to one file; <Ui>Import</Ui> on another machine folds it back in.
          Importing <em>merges</em> — it adds to what is already there, never
          overwrites a note you edited more recently, and doing it twice does nothing
          the second time.
        </p>
        <Callout>
          <strong>And you can see your revision on the body itself.</strong> Switch on{" "}
          <Ui>Show what I have studied</Ui> in the left panel and the model is
          coloured by your own journal: everything you have written about or worked
          through lights up, and everything you have not stays grey. Forty notes on
          the thorax and nothing on the pelvis is invisible in a list. It is
          impossible to miss as a shape on a body.
          <br />
          <br />
          The scale is relative to your own journal — the brightest is whatever you
          have worked on most, not some standard — so it answers "where have I been",
          not "how much is enough".
        </Callout>
        <p>
          <strong>It also comes out on paper.</strong> <Ui>⎙</Ui> on a session prints
          that conversation with the structures it covered and, for a case drill, the
          score and how it went. <Ui>⎙ print</Ui> above the notes prints the notes you
          are looking at — narrowed to one structure if you have narrowed them, and
          filtered by your search if you have searched. What is on screen is what comes
          out.
        </p>
        <Callout>
          A preview opens first, so you can see the page before anything is printed.
          From there your own print dialog can send it to a printer or save it as a
          PDF. Nothing is generated for the occasion and nothing is sent anywhere — a
          printed page is a record of work you already did, so the same journal always
          produces the same page. The compliance notice sits at the foot of{" "}
          <em>every</em> page, in your language and in English, because pages get
          separated from each other.
        </Callout>
      </>
    ),
  },
  {
    id: "keys",
    nav: "Keyboard",
    title: "Shortcuts",
    body: (
      <>
        <Rows
          rows={[
            ["I", "Isolate the selection"],
            ["H", "Hide the selection"],
            ["U", "Restore everything hidden"],
            ["X", "Step the exploded view apart, and back together"],
            ["Enter", "Send your question"],
            ["Shift+Enter", "New line instead of sending"],
            ["Ctrl+Enter", "Save the note you are writing"],
            ["Esc", "Close a menu, or this guide"],
          ]}
        />
        <p>
          The viewport shortcuts stand down while you are typing — <Ui>I</Ui> belongs
          to your sentence, not to the model.
        </p>
      </>
    ),
  },
  {
    id: "credits",
    nav: "Credits",
    title: "Who built this, and what it is made of",
    body: (
      <>
        <Credit
          role="Designed & built by"
          name="Nurdzhan Kerimov"
          badge="PYSBG"
        >
          Anatria3D was conceived, designed and engineered as a working instrument
          for anatomy — the atlas, the assistant and the study journal alike.
        </Credit>

        <Credit role="Copyright" name="Digital Rose" badge="digitalrose.org">
          Digital Rose holds the copyright in the Anatria3D application and its
          name. The <strong>source code is released under the Apache&nbsp;2.0
          licence</strong>, which grants you the right to use, study, modify and
          redistribute it, including commercially. The name and marks are not part
          of that grant: a fork is welcome, a fork called Anatria3D is not.
        </Credit>

        <p>
          It is given to students and to universities. That is not a slogan about
          the licence — it <em>is</em> the licence, and it is why this page reads
          the way it does rather than reserving all rights.
        </p>

        <h3 className="pt-2 text-[13px] font-semibold text-slate-200">
          The anatomy is not ours
        </h3>
        <p>
          Every mesh and every anatomical name in this application comes from work
          other people gave away first, and it reaches you under the same terms it
          reached us:
        </p>
        <Rows
          rows={[
            ["BodyParts3D", "The Database Center for Life Science (DBCLS), Japan — CC BY-SA 2.1 JP"],
            ["Z-Anatomy", "The libre 3D atlas of anatomy, derived from BodyParts3D — CC BY-SA 4.0"],
            ["Terminologia Anatomica 2", "The Latin nomenclature, by way of Z-Anatomy's TA2 data"],
            ["Anatria3D", "Our adaptation: export, compression and stable identifiers — CC BY-SA 4.0"],
          ]}
        />
        <Callout>
          <strong>Share-alike, and it binds us too.</strong> The meshes and labels
          are licensed under Creative Commons Attribution-ShareAlike 4.0
          International. You may redistribute them, including commercially, so long
          as this attribution chain travels with them and they stay under the same
          licence. Nobody — us included — may relicense them or claim exclusive
          rights over them.
          <br />
          <br />
          The two licences do not merge. The code is Apache&nbsp;2.0 and the anatomy
          is CC BY-SA 4.0, whichever way you redistribute either. The full text of
          both ships in the application folder, with the attribution in{" "}
          <Ui>anatomy/NOTICE</Ui>.
        </Callout>

        <h3 className="pt-2 text-[13px] font-semibold text-slate-200">Built with</h3>
        <p>
          Open source the whole way down, and worth naming: <Ui>Tauri</Ui> for the
          desktop shell, <Ui>React</Ui> and <Ui>React Three Fiber</Ui> over{" "}
          <Ui>three.js</Ui> for the viewport, Google's <Ui>Draco</Ui> for mesh
          compression, <Ui>Rust</Ui> and <Ui>SQLite</Ui> for the study journal, and{" "}
          <Ui>Python</Ui> with <Ui>Pydantic AI</Ui> for the assistant. Each keeps its
          own licence; none of them is ours.
        </p>
        <p className="pt-2 text-[11px] text-slate-500">
          © 2026 Digital Rose. Anatria3D is a trademark of Digital Rose. Application
          code under Apache-2.0; anatomical assets under CC BY-SA 4.0.
        </p>
      </>
    ),
  },
];

export function GuideOverlay({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(SECTIONS[0]!.id);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Which section the reader is actually in, so the nav tracks scrolling rather
  // than only responding to clicks.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    );
    for (const section of SECTIONS) {
      const node = root.querySelector(`#${section.id}`);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="How Anatria3D works"
      onClick={onClose}
    >
      <div
        // The backdrop closes; the card must not close when its own text is
        // clicked, which is what selecting a sentence looks like to React.
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <nav className="hidden w-44 shrink-0 flex-col gap-0.5 border-r border-slate-800 bg-slate-950/40 p-3 sm:flex">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Guide
          </p>
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() =>
                scrollRef.current
                  ?.querySelector(`#${section.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className={`rounded px-2 py-1 text-left text-[11px] transition ${
                active === section.id
                  ? "bg-sky-600/15 text-sky-300"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {section.nav}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-5 py-3">
            <h2 className="text-sm font-semibold tracking-tight text-slate-100">
              How Anatria<span className="text-sky-400">3D</span> works
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
            >
              Start exploring
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {SECTIONS.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-4 pb-7">
                <h3 className="mb-2 text-[13px] font-semibold text-slate-100">
                  {section.title}
                </h3>
                <div className="space-y-2.5 text-[12px] leading-relaxed text-slate-400">
                  {section.body}
                </div>
              </section>
            ))}
            <p className="border-t border-slate-800 pt-3 text-[10px] text-slate-600">
              Reopen this any time with <Ui>?</Ui> at the top of the window. Anatomy
              from Z-Anatomy, CC BY-SA 4.0 — see NOTICE.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-slate-700/70 bg-slate-950/50 px-3 py-2 text-slate-300">
      {children}
    </p>
  );
}

/** A gesture or key, and what it does. */
function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-hidden rounded border border-slate-800">
      {rows.map(([gesture, effect], index) => (
        <div
          key={gesture}
          className={`flex gap-3 px-3 py-1.5 ${
            index % 2 === 0 ? "bg-slate-950/40" : ""
          }`}
        >
          <kbd className="w-28 shrink-0 font-sans text-[11px] font-medium text-sky-300">
            {gesture}
          </kbd>
          <span className="text-[12px] text-slate-400">{effect}</span>
        </div>
      ))}
    </div>
  );
}

/** Something the reader will see named exactly this way in the interface. */
function Ui({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-slate-200">{children}</span>;
}

/**
 * One party with a claim on this application.
 *
 * Domains are printed rather than linked. Opening a URL would mean granting the
 * webview `opener:allow-open-url`, and the capability file is short on purpose —
 * a credits panel in an offline application is not worth widening it for.
 */
function Credit({
  role,
  name,
  badge,
  children,
}: {
  role: string;
  name: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
        {role}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-100">{name}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider text-sky-400">
        {badge}
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-slate-400">{children}</p>
    </div>
  );
}
