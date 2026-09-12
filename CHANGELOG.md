# Changelog

What changed in Anatria3D, written for the person using it rather than the
person who wrote it. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file starts at 0.1.7. Earlier releases are described on the
[Releases page](https://github.com/Nurkan1/Anatria-3D/releases) — they are not
reconstructed here, because notes written from memory a year later are a good
way to record something that did not happen.

There is **no auto-updater**, by design: the application never reaches the
network on its own. A new version reaches you only when you download and install
it, so this file is also the answer to "is it worth reinstalling".

## [Unreleased]

### Added

**The scanner reads the body from the front, too.** An *Axial | Front* choice
sits above the scanner's handle. In *Front* the plane stands upright and travels
from the front of the body to the back, and the section is drawn the way a
coronal image is read: the head at the top, the patient's left on your right.
The line above the picture says how deep the plane is, measured from the most
anterior point of the body, and the wheel steps a centimetre at a time. *Cut*,
*Slab*, the torch, magnifying, the caliper and *Save* all work as they do across
the body. The same ring serves both: in *Front* it stays at the chest and reads
*ANATRIA 3D FRONT*, and the light on the body marks the plane. Each plane keeps
its own place, and a measurement stays on the section it was drawn on.

**The assistant knows where the scanner is.** With nothing selected and the
light held at a level, a question like *"what is in this part?"* is answered
about that level; a note above the box says so while you type. A selection
always comes first, and your own words win over the scanner. It is not sent
while the light is travelling, for a frontal plane, or in a case. A question
about pain there is answered with the anatomy of the level, never with an
assessment of you.

**The assistant can ask for a frontal section.** *"A frontal section of the
heart"* switches the scanner to *Front* and puts the plane through it; asking for
a level goes back to *Axial*. The same choice is open to an agent driving the
atlas over MCP.

### Fixed

**The box you type in opened as a squashed strip.** A field measures itself to
decide how tall to be, and a field inside a panel that is switched off measures
zero — so the assistant's composer kept that zero, on first launch and every
time the panel was folded away and brought back. Typing in it put it right,
which is how it survived this long. It now keeps its proper height, and is
measured again when the panel comes back or is dragged narrower.

## [0.2.9] — 2026-09-11

### Added

**Several measurements at once, each on its own level.** Every drag with
*Measure* adds another line instead of replacing the last, and each belongs to
the level it was drawn on: step to another level and it waits there, then comes
back when you return — the way rulers behave on a scan. Click a number to remove
that measurement; *Clear* removes the ones on this level, and *Save* puts all of
them in the picture.

### Fixed

**Cross-sections were drawn upside down.** In 0.2.8 the section put the spine at
the top and the teeth at the bottom, under a caption saying the front was at the
top. It is now the way every axial image is read: anterior at the top, and the
patient's left on your right, as if looking up from the feet. Left and right were
already right; only the vertical was reversed. The caliper, the drag, the zoom and
the torch all turn with the picture.

**A measurement followed you to other levels.** Stepping with the wheel kept the
line on screen at the new level, where it sat over different anatomy and measured
nothing.

## [0.2.8] — 2026-09-11

### Added

**The scanner reads the body in section.** Tick *Cross-section where I let go*
and, when you let go of the light, the body is drawn at that height from above,
in a panel beside the scanner: anterior at the top, the way every axial image is
arranged. It is drawn once, at the moment of release, rather than sixty times a
second — a section only has to be right while the plane is still, and paying for
it on every frame would take the viewport from fifty frames a second to thirty.
Click it to see it full size.

**Two cuts, because they answer two questions.** *Cut* opens the body at the
plane: you look down onto the surfaces below it, and the shapes read as solid
volumes, with depth behind what is at this level. *Slab* keeps only the four
millimetres at the plane — the truthful section, and the harder picture, since
what survives of a structure in that band is its wall. The cut surfaces are open
in both: clipping removes the part of a surface outside the plane and does not
close the hole it leaves.

**It says where it is.** The line above the picture names the vertebral level —
*T8*, *L4–L5* — whenever the plane is at one, and says nothing out in the limbs
or below the coccyx rather than naming the nearest vertebra. Beside the picture
are its width in centimetres, how many structures the plane crossed, and six of
them named with a swatch of the colour they are drawn in.

**The wheel steps through the body, one centimetre at a time.** A fixed step
rather than one proportional to the gesture, because regular increments are what
make *three levels above T7* something one person can say and another can
reproduce.

**Magnifying adds detail instead of enlarging pixels.** Ctrl and the wheel, or
the − and + buttons, render the section again framed on the window you are
looking at, so the same pixels are spent on a ninth of the body and come out nine
times finer. It zooms about the pointer, stops at six centimetres across, and the
button between − and + gives a width — *9 cm* — rather than a factor. Drag to move
the window. Magnified, you can still step: the window is held in centimetres of
body, so it stays over the same anatomy as you travel through it.

**A caliper.** *Measure*, then drag across the section, and the length appears on
the line. Both ends lie in the plane, so it is the true distance between those
two points; the line is held in the body's own coordinates and stays on the
anatomy it was drawn across when you magnify or step. Measure a level in *Slab*:
in *Cut* the structure under an end may lie below the plane.

**Save a section as a picture.** *Save* writes what is on screen to a PNG, with
the measurement on it if you drew one, and suggests a name made of what it is —
`anatria3d-axial-T8-13cm-slab.png` — so a folder of them can be read without
opening any. The line saying it is not a medical device is part of the picture,
because a caption on screen does not travel with a screenshot.

**The assistant can take you to a level.** Ask to be taken to T8, or to where the
renal arteries leave, and it puts the scanner there, switching it on if it was
off. It names a structure rather than a level, so a vertebra and the aortic root
are the same request. When the assistant is the one that moved it, the ring reads
*ANATRIA 3D AI*; move it yourself and it goes back to *ANATRIA 3D*.

**A torch.** *Aim the light with the pointer* makes the cursor the lamp over the
enlarged section: the middle is overhead and the edges lay the light flat across
the surfaces, the way anyone examines a specimen. It is the one setting whose cost
repeats while you use it, so it is off until you ask.

**Quality.** Reads each section at four times the pixels, for a finer picture of
the whole section. It costs four times the readback and about a quarter of a
gigabyte while it is on, so it is a switch for a machine with room to spare —
on a modest one, magnify instead. The explanation is on the label's tooltip.

**The scanner answers the hand.** Letting go of the light gives a short pulse of
light at that level, in the tissue's own colours when *Reveal colour, not light*
is on; *Sound when I let go* adds a short tone, off by default. *Fade what it has
passed* plays down everything behind the plane, so the sweep reads as progress
through the body. *hide* folds the scanner's controls into a chip without
stopping the scanner.

**The guide explains cross-sections**, including what they are not.

### Changed

**The controls over the viewport read on a light background.** They stood on a
wash tuned for the dark one; over a light viewport the Scanner and Study views
switches and the folded chips were barely legible. They now carry their own dark
ground.

**A 14-inch laptop shows the whole scanner.** The column of controls over the
viewport runs to the bottom edge, and the controls hint takes room only while it
is open. On short windows the slider and the section thumbnail give a little
height back.

**The letters that reopen a closed study panel sit over the Study views switch**,
rather than above the scanner where they read as part of it. The renderer panel
(M) can be dragged out of the way.

### Fixed

**Linux: the scanner's slider could not be dragged.** Clicking a height worked,
dragging did not. WebKitGTK loses the drag of a native slider when the page
captures the pointer on it; the slider no longer does, and still lets go wherever
the pointer is released.

**The wheel counts a notch as a notch.** Engines that report the wheel in lines
rather than pixels would have needed dozens of notches for one step.

### Not a radiograph

A CT slice is a map of densities. A section here is the atlas's own geometry cut
at a height and drawn solid, so a structure that is see-through in the viewport
still arrives filled, and nothing on it corresponds to a Hounsfield number. What
the caliper measures is the atlas — one body, modelled rather than imaged. It is
for learning anatomy, not for any clinical use.

## [0.2.7] — 2026-09-09

### Added

**The scanner's light has a colour, and it is a way of reading rather than a
theme.** The light is *added* to the colour the tissue already has, so the hue
decides which structures separate from their neighbours and which sink into
them. Four to choose from, each picked for what it separates from: cyan is the
neutral one, because nothing in the body is cyan; green reads against muscle and
anything vascular; amber buries the reds and lifts bone, cartilage and fascia,
which is the opposite selection; violet separates from both and shows the pale
structures — nerves, tendon, the fatty planes — that cyan washes out.

**A carbon body, so the light has somewhere to go.** The appearance button now
steps *Solid → Scan → Carbon*. Carbon is the drained body pressed down towards
black, and the reason is not decoration: additive light saturates almost at once
on a mid-lit surface, and the falloff that carries the shape of what was reached
disappears into white. Against a dark body the same light has range. It is why
radiology is read on black. Bone still sits lighter than muscle — the lightness
is compressed, not flattened — and whatever is marked, selected or isolated
keeps its own colour through every tone.

**The sweep can give each structure its colour back instead of lighting it.**
The glow says *where* the plane is; this answers *what* it reached, and on a
drained or carbon body colour carries that far better than brightness — a lit
grey liver is a lit grey shape. Tick *Reveal colour, not light* under the
swatches. It replaces the glow rather than joining it, because a hue seen
through an additive wash is a paler version of itself. What comes back is the
colour the structure would have at full tone, including a revision colour or a
pathology overlay.

**The panel naming what is being crossed can be moved out of the way.** Click
*hide* on the panel itself — it sits over the model, and the moment you want it
gone you are looking straight at it. It leaves the chip it collapsed into, which
is its own way back.

### Fixed

**The eyes lit up when the sweep reached the ankles.** The eye parts are drawn
inside a group that turns them to follow you, so their matrices are rebased onto
the eye's own centre — near the origin, which is the height of the feet. The
sweep read its extent from one of those while the shader read each fragment's
real position, so the two disagreed: the eyes lit at the ankles and never lit
when the plane crossed the face. Both halves are now right.

**On Linux the scanner's slider showed a handle and no line, and answered badly
to a drag.** A vertical range input through `writing-mode` is a recent addition
to the platform: the Windows engine draws it and the WebKitGTK on a Debian
desktop did not, so the control stayed horizontal inside a 16-pixel-wide box.
It is now a plain horizontal control turned a quarter turn, and the coloured
track is drawn by the application rather than left to the browser.

## [0.2.6] — 2026-09-08

### Added

**Scanner: a plane of light that sweeps the body and names what it reaches.**
Press <kbd>Scanner</kbd> in the left column and a ring comes down onto the crown
of the head, then travels to the feet and back. Every structure the plane
reaches lights up *whole* while it passes — not a slice of it — and a panel
names what is being crossed as it goes: the six largest, with the rest counted,
because a plane through the chest passes two hundred structures and listing all
of them tells you nothing.

It is a way of reading the body rather than an effect. Structures you would
never think to click on announce themselves on the way past, in the order they
actually lie, which is the one thing a list of names in a sidebar cannot show
you.

**You can put the light where you want it.** Drag the slider beside the switch
to hold the light at a height, and press <kbd>Hold</kbd> to pin it there so you
can look without keeping a finger down. Let go and the sweep carries on from
that height rather than jumping back — move it to the diaphragm, look, and it
continues downward from the diaphragm.

**It also runs by itself while the assistant is writing.** That is the one
moment where you are waiting with nothing to look at, so the atlas reads itself
instead. The ring is left out of that half, because a solid ring crossing the
body would hide the structure the answer is about — the light alone passes
through and covers nothing. A checkbox under the switch turns that half off for
a machine that would rather not, and it is remembered.

**What it costs, measured on the whole male atlas:** no extra draw calls, no
extra triangles, one extra compiled shader program, and 0.6 ms on the 95th
percentile frame. 3,478 materials share a single compiled program rather than
compiling one each, which is the only reason a mode like this is affordable
here at all.

**The MCP server now ships with the application.** Another program on this
machine — an AI agent — could already open the bridge and move the view, but
only somebody who had cloned the repository could give it the half that
searches, and identifiers are not guessable. In practice that meant an agent
that could talk and reset the camera. The five read-only tools now travel in the
installer: they search the atlas, read a structure and walk the hierarchy
without the bridge, without this window open and without a key. They are source
rather than a second frozen binary — 72 KB against a 61 MB installer.

**And the application hands an agent its instructions instead of making it
look.** An agent that had not been configured with the server worked the bridge
out by reading the repository — it found the pipe, the frame shape and the
client on its own, and spent its first attempt on a refusal. All of that was
discoverable and none of it was offered. One button under *Writing your own
client?* now copies a briefing that names the server first, carries the pipe
this window is actually listening on, and gives the three warnings that
otherwise read as a broken bridge. The panel says out loud that the briefing
contains a path identifying a Windows account, because somebody about to paste
it into a hosted model should know that before they do and not after.

**On Linux, the panel now says which half is there.** Shipping the server put it
in the `.deb` and the AppImage as well, while the panel returned early on an
unsupported platform — so a Linux reader had a working server installed and no
way to find out. It now names the file and says plainly that the fifteen tools
which move the view are absent, so nobody configures a client expecting them.

### Fixed

**A client that writes a byte order mark is no longer refused.** PowerShell
writes UTF-8 with one by default, and three invisible bytes look like nothing at
all in a terminal — an agent's first attempt came back `NotJson` with nothing on
screen to explain it. Exactly one mark, and only at the start: two of them, or
one inside the frame, are still refused.

## [0.2.5] — 2026-09-07

### Changed

**Anthropic answers stopped paying full price for the same bytes.** Every
question re-sends the whole system prompt and every tool definition, and
Anthropic caches none of it unless the request asks — which this one never did.
Measured on a real journal: 41 turns and more than 800,000 tokens of input, all
of it at **exactly zero** cached, while OpenAI on the same journal ran between
74% and 97%. The first two turns after the fix came back at **72%**, and
Anthropic bills a cache read at a tenth.

The tool definitions are the same fifteen schemas on every turn of every
session, so they can never miss. The instructions are stable too, apart from
the list of what is loaded and what you have selected — so two questions about
the same structure both hit, and moving to another one still keeps the tools.

**Questions cost less and answers arrive sooner.** The catalogue of loaded
structures is now the last thing in the prompt rather than the middle, and what
is listed is in a fixed order. Providers cache by matching the start of a
request against one they saw a moment ago, and anything that moves breaks the
match from that point on — so the volatile part belongs at the end. No anatomy
is described any differently; it is the same prompt in a better order.

### Fixed

**An answer can no longer land in the wrong conversation.** Hiding the chat
panel mid-answer, starting a new session, reopening an older one from the
journal, or switching atlas while the assistant was still writing could leave
the tail of one answer arriving into a transcript it did not belong to. Each
turn now belongs to the session, mode, atlas and case it was asked in, and a
turn whose ground moves is ended rather than left running. What it cost is
still recorded — the transcript may go, the accounting may not.

**A draft you had not sent survives collapsing the panel.** Both in the chat
and in the notes.

**Very long conversations stopped being refused.** More than fifty exchanges in
one session exceeded a limit on how much history a request may carry, and the
request was rejected rather than trimmed. The oldest exchanges are now dropped
to fit.

**The four-panel study view frames correctly after exporting an image**, and
the bounds it measures are no longer recomputed on every frame.

## [0.2.4] — 2026-09-05

### Added

**An answer can put the model back the way it left it.** One question can move
the model a great deal — isolate a region, take the body to glass, cut a
section, light ten structures — and then you spend five minutes turning it round
and the arrangement the words are describing is gone. `Restore this view`, next
to `Copy answer`, brings it back.

It appears only on answers that moved something, and it is kept in your journal,
so a session reopened next month restores as well as it did the day you asked
it. Answers written before this version recorded nothing and carry no button:
there is nothing to invent for them, and a button that restored a guess would be
worse than none.

### Changed

**What an answer cost stopped reading as what it sent.** The count under each
answer added everything the provider reported, which is not what you are
charged. One real turn here sent 415,895 tokens of context and had 402,775 of
them — 96.8% — served back out of the provider's own cache at a fraction of the
price. The line said "418.9k tokens" about a turn charged like sixteen thousand,
in the one place you look to decide whether an answer was expensive.

That number grows with the number of things the assistant did, not with what you
asked. A question that drives the model through thirty commands re-sends the
same context thirty times, which is exactly the shape a provider caches best —
so the alarming figure and the cheap turn were the same event.

It now reads `16.1k of 418.9k tokens`: what was charged first, because that is
the question being asked, and what your provider's dashboard will show second,
because a figure here that appears nowhere on your bill would be one more number
to reconcile rather than an answer. Where nothing was cached the two are equal
and only one is shown.

### Fixed

**GPT-6 models can be chosen.** They reason by default, and OpenAI will not
serve tools to a model doing that over the endpoint this application was using
for them — so picking one failed with a rejection, and the assistant could not
drive the atlas at all. The whole family now goes over the same endpoint GPT-5.6
already used. The list deciding this can only ever name families that exist when
a version is built, which is why an unfamiliar model is still offered rather
than hidden: it may well work.

**A journal you import keeps what it was charged.** Exporting has recorded how
much of each turn came out of the provider's cache since 0.2.3, and importing
wrote every other figure and skipped that one. A journal carried to a second
machine arrived claiming every turn had been paid for at full rate — the exact
overstatement that column was added to correct.

## [0.2.3] — 2026-08-28

### Added

**Four views of one structure, at once.** Isolate something and a new
`Study views` switch appears over the viewport. The panel you drive keeps the
top-left corner and behaves exactly as it did — orbit, zoom, click, select —
and beside it sit three fixed anatomical views of the same thing: anterior,
left lateral, superior, lettered at the middle of the screen. Click a letter to
close that panel; the ones left take the space, and a closed view comes back
from a chip beside the switch.

The three follow the view you drive rather than framing themselves, so all four
agree about how big the structure is. Move the main camera closer and they come
with you.

It asks for something isolated first, and that is arithmetic rather than
fussiness. Four views of the whole atlas is four passes over three and a half
thousand structures, which no machine holds at a usable frame rate; four views
of one isolated structure cost four times almost nothing. That was measured
before any of it was built.

**Another program can drive the atlas.** A read-only Model Context Protocol
server already let an outside agent search this anatomy. It can now also *move*
what is on your screen — isolate, light, ghost, cut a section — through the same
fifteen tools the built-in assistant uses, checked by the same schema.

It is off unless you turn it on, in Settings, and the indicator says when it is
listening. It records nothing: what an outside agent asks and what it answers
never reaches your journal, which is why an API key remains the way to get the
full use of this application. Said plainly here because it is the difference
between the two, not a detail.

**The application can tell you what is wrong with it.** Click the version number
beside the tabs. A window opens with what state everything is in — whether your
settings are being saved, whether the journal opened, how much of the atlas is
loaded, whether the assistant engine is running — and a log of what has happened,
kept on disk beside your journal so it survives closing the window.

`Copy report` puts all of it on the clipboard as text, `Save a copy…` writes it
wherever you like, and `Empty the log` clears it. **Nothing you write goes in
it** — not a question, not an answer, not a note, not a session title. Only what
the application did and what went wrong with it.

**The frame counter ships.** Press `M` over the model for frame rate, draw
calls, triangles and memory. It was built to decide whether the four-panel view
was affordable and it stays, because "the atlas is slow on my machine" and
"34 fps, 3,478 draw calls" are not the same report, and only one of them can be
acted on.

### Changed

**The keyboard and mouse hints fold away.** Seven lines of small print sat
permanently over the lower left of the body. They collapse to one quiet
`Controls` marker and come back for ten seconds when you put the cursor on it.

**What a question costs is counted honestly.** Providers charge a fraction for
context they recognise from a moment ago, and a long conversation is exactly
what they recognise. That was being counted at full price, so the notice warning
about expensive conversations overstated them — and did it worst in the case it
fired on. Cached context is now reported separately, in the notice and in the
`Usage` tab, and the warning measures what was actually charged.

The guide used to say switching systems off makes questions cheaper. Measured,
that is no longer true: the whole atlas costs about as much to describe as a
single structure. It still makes the model clearer to read, and the guide now
says that instead.

### Fixed

**The window fits the screen it opens on.** It asked for a size that fits a
1080p desktop with a hundred pixels to spare and did not say where to open, so
the platform was free to place it low enough that the bottom of the interface
fell behind the taskbar — taking the view controls, the viewpoint bar and part
of the keyboard hints with it, with nothing on screen to say anything was
missing. It now measures itself against the desktop and shrinks to fit if it
has to.

**The application says when your machine will not let it remember.** Six places
kept your settings and every one of them swallowed the error if the store
refused. On a machine where that happens the application opens on the default
provider, the default model, every system on and the guide in front — exactly
what a first run looks like — and nothing distinguished "you have not set this
yet" from "I cannot keep anything you set". It now says so, once, above the view
controls, and notes that your journal and your API keys are unaffected because
those are kept elsewhere.

## [0.2.2] — 2026-08-25

### Added

**You can take the fascia off.** The muscular system carries 116 sheets — the
pectoral fascia, the rectus sheath, the fascia lata — lying directly on the
muscles they wrap. They were drawn pale and thin, because that is what they
are, and they still veiled the bellies underneath: what you saw was a body
before anyone had started dissecting. A new checkbox in the left panel lifts
them, and the choice is remembered between sessions.

It is off by default. With the fascia on, the anatomy is honest; taking it off
is the dissection move, and that should be your decision rather than ours.

**The atlas answers questions outside the application.** A read-only Model
Context Protocol server ships in `tools/anatria_mcp/`. Point Claude, Codex or
Gemini at it and they can search the 3,742 structures by Latin or English name,
read a structure's record and its place in the hierarchy, walk that hierarchy,
and see which licence each atlas carries — with Anatria3D closed, without an API
key, and without touching the network.

It cannot change anything. It does not talk to the running application, cannot
move the viewport, and cannot read your study journal, your case files or your
keys. Driving the viewer from outside is a separate question with a separate
security model, and it is deliberately not part of this.

It also states its own limits rather than letting a model guess at them: the
index is Latin, English and identifiers, so a search in Bulgarian or Spanish
finds nothing and now says so instead of returning a bare zero; and the manifest
records no relationships, so nothing there can say what supplies or innervates a
structure.

[@astreos108](https://github.com/astreos108) forked the repo and built a
version of his own while this was still on the list, which is what moved it to
the front of it.

### Fixed

**Every structure now has a place in the atlas.** 910 of them — a quarter of the
male body — had none, and five whole systems had none at all: the endocrine
glands, the lymphoid system, the body regions, the urinary tract and the genital
organs. You could find a kidney by asking for it by name, and never by opening
the hierarchy, because there was no heading to open. Asking the assistant to
isolate them as a group did not work either, since the group did not exist.

The names had been there all along, in the atlas we build from. The export was
dropping them.

Eleven new groups come with it, and the largest is one you could not reach
before at all: the **451 muscle attachment areas** — where each muscle takes
origin and where it inserts — now sit under `Muscular insertions`, separate from
the muscles themselves. Isolating the muscles still gives you muscles.

Nothing moved. All 3,478 structures are still there, every path that already
worked is unchanged, and the geometry is identical to the byte.

**A heading called "Muscles" held 42 of them.** Ask the assistant to isolate the
muscles and it would land you on the pelvic floor, having done exactly what it
was told: there was a group with that name, so it took it. It is the atlas's
catch-all for the muscles its regional scheme has no room for — the
intercostals, the diaphragm, the levator ani — and it is now called **Other
muscles**, which is what it holds. Asked for the muscles as a whole, the
assistant now switches off the other systems instead.

**The help page had a list inside a paragraph.** Invalid markup that a browser
recovers from by closing the paragraph early and moving what follows. Nothing
looked wrong, and the page you were reading was not the one that had been
written.

## [0.2.1] — 2026-08-22

### Added

**The atlas knows where its structures live.** Asking to isolate a region used
to reach 121 named groups; it now reaches 291, and not one of the old ones was
lost. "Show me the muscles of the hand", "isolate the cervical vertebrae",
"open the digestive canal" — none of those could be answered before, because
those groups existed in the source and never survived the export.

The clearest case is the **aorta**, which went from naming nothing at all to
holding 180 structures. Asking what branches off it now shows them.

**The assistant can ask what supplies a structure.** Isolate the heart, ask what
irrigates it, and the coronary arteries arrive in the viewport instead of being
listed in a paragraph. It works for nerves too. This is measured against the
geometry rather than looked up in the hierarchy, because the relationship is
spatial: the coronary arteries are not filed inside the heart, and no list of
names reproduces what actually reaches a territory.

It reports what it is: the structures **running through** a region, which is not
the same as the structures that supply it. A long nerve passing nearby is added
whole. The assistant is told to say so and to name the real supply itself.

**Answers can be read aloud, on Windows.** A *Read aloud* button appears under an
answer when the computer has a voice for the language it is written in, using
voices Windows already has — nothing is downloaded and nothing is sent anywhere.
Speed, volume and how much of a long answer to read are in Settings.

It uses only voices the system marks as local. Some platforms offer voices that
work by sending the text to a company's servers, and an answer about your own
anatomy question is not something to hand to a third party.

**On Linux there is no Read aloud**, and the reason is not fixable here: the
browser engine Linux builds embed reports a fixed list of four voices regardless
of what the system has, and marks all of them non-local. Installing voices does
not change it. Settings says so rather than sending you to look.

### Fixed

**A numbered reference now points at something.** Clicking ④ in an answer moved
the camera and then left you to work out which of the structures in view it
meant. The structure is now named on screen, marked with the same number the
answer used — and it is named whether or not "Label what I select" is switched
on, because a number that points nowhere is not a preference.

**And it reveals what it points at.** If the structure was hidden, or outside
what you had isolated, the camera used to fly to it and show you whatever was in
the way. It comes back into view now. Nothing you asked to see is taken away.

**Anatomical errors in the atlas itself.** `Adductor hallucis`, a muscle of the
foot, was filed under the ulnar nerve — which does not reach the foot. It sits
under the lateral plantar nerve, which innervates it. `Atlas (C1)` sat loose in
`Axial skeleton` and is now in the cervical vertebrae. Sixty-seven structures had
no place in the hierarchy at all and now do.

**Saved images no longer cut their labels.** A plate exported with long Latin
names came back with the first letters off the edge — *"t breve musculi bicipitis
brachii"* where it should read *Caput*. The name columns now leave room for the
longest name in them. The same fault had been quietly trimming names on screen.

## [0.2.0] — 2026-08-20

### Added

**A female atlas.** The atlas now has a second body. A Male/Female switch sits
above the systems list, and choosing Female loads 264 structures built from the
NIH Human Reference Atlas: the vertebral column from C1 to the coccyx, the
pelvic girdle, the uterus with its cervix and walls, both uterine tubes down to
the fimbriae, the ovaries, the vagina, sixteen ligaments and peritoneal folds,
the bladder and ureters, both kidneys, the liver with its impressions and
ligaments, the biliary tract, the pancreas, the spleen, the small and large
intestine, sixty vessels — the pelvic set, the coeliac trunk, the mesenteric
arteries and the whole hepatic portal system — and the breast.

The breast is worth calling out because **the male atlas has none at all**: the
body of the breast, lobes of the mammary gland, lactiferous ducts and sinuses,
suspensory ligaments, nipple, areola and areolar tubercles, on both sides. It is filed
under the integumentary system, where Terminologia Anatomica files it, and it
is the first structure in either atlas to use that system.

The placenta is in the source and is **not** shipped. Terminologia Anatomica is
adult anatomy: it names the umbilical vessels but not the placenta itself, nor
the amnion, the chorionic plate or the cord — those belong to Terminologia
Embryologica, which this atlas does not carry. Three vessels floating where a
placenta should be would teach nothing and look like a failed load.

It is **the trunk, not a whole female body**, and the application says so where
you choose it. There is no skull, no ribcage, no limbs, and no skeletal muscle
or peripheral nerve anywhere — the source models organs rather than a body, and
no open dataset publishes a whole female one.

In one respect it is better than the male atlas, which the structure count
hides. Its viscera are far more finely modelled: a kidney opens into capsule,
hilum, cortex, columns and every pyramid with its papilla, where the male atlas
has a single kidney mesh.

**It is one woman, not an average, and the interface says where she differs.**
The male atlas is an idealised composite; this is a 59-year-old subject. She has
**six lumbar vertebrae** rather than five, and **her kidneys span L1 to L5**
where the classical description is T12 to L3, with the left 2.7 cm longer than
the right. Both are real, both are measurable in the geometry, and neither is
corrected. They are stated where you choose the body, in the guide, and in the
assistant's own instructions — which now give the textbook value first and
describe this body second, so that measuring her on screen does not cost you a
mark in an exam.

Every structure carries its Terminologia Anatomica Latin, matched by hand,
because the source names anatomy with UBERON and FMA labels that are not unique
and often word structures differently. Eleven structures in the source are not
shipped, because TA2 does not list them and inventing Latin would be worse than
leaving them out; three more that TA2 does name are left out by judgement, and
they are recorded separately so a decision cannot hide behind the standard.

The two atlases stay in separate files under their own licences — the male one
share-alike through Z-Anatomy, the female attribution-only through the HRA —
and nothing merges them. **An exported image now credits whichever atlas it came
from**, read from that atlas's own manifest, so a plate of the female pelvis
carries the NIH Human Reference Atlas and CC BY 4.0 rather than a line about
Z-Anatomy.

**Structures now say which one they are.** A labelled spine used to export with
twelve identical *Vertebra thoracica* on twelve leader lines, and both halves of
a hip bone as *Os ilium*. Where Terminologia Anatomica names a structure
individually its own term is used — every vertebra is numbered there, so T7 is
*Vertebra thoracis VII*, exactly as the male atlas already called it. Where TA2
names only the class, the part is appended after it: *Os ilium · left · compact
bone*.

**The assistant can now isolate a whole organ.** Ask it for "the kidney" or "the
spine" and it shows you all of it. That sounds like something it could always
do, and it could not: most of what a reader asks for is a heading in the atlas
rather than a structure with an identifier — the kidney is fifty separate meshes
on the female body, the muscles are four hundred on the male, and 109 of the
male atlas's 110 groups have no mesh of their own. You could isolate them by
right-clicking; the assistant had to name every part or admit it could not.
It now reaches the same groups you do, through the same resolver, so the two
cannot drift into isolating different anatomy under one name.

The sixth lumbar vertebra is the one place the two atlases cannot agree, and it
is the more useful for it. TA2 stops at L5 — it does not name a sixth, because
it does not expect one — so that vertebra alone reads *Vertebra lumbalis · L6*
under *Vertebra lumborum V*. The variant announces itself in the label.

**The assistant answers better when you point first, and now it says so.** Select
a structure before you ask and the assistant is told exactly what you mean and
treats it as the subject; select several and it is told to compare them. With
nothing selected it is handed a summary of every structure loaded and has to
search the atlas before it can start — a vaguer answer, and a larger bill,
because every search is another pass through the whole conversation.

A **How to ask** button sits under the composer with the four things worth
knowing. And if you start typing a question with nothing selected, one line says
so. It appears while you type rather than sitting there as a banner, and it
retires itself the first time you ask with something selected — which is the
behaviour it was asking for, so nobody who already works this way is ever told
to. It stays out of case drills entirely: there the subject is the patient, and
what you are typing is an answer.

**Printed pages now say when a model wrote part of them.** A PDF containing
assistant answers, or a case the assistant graded, carries a notice at the foot
of every page — beneath the medical one, which still reads first.

It appears **only when something on the page was actually generated**. A notebook
of your own notes carries nothing, because there is nothing to disclose.

The notice also says where its knowledge stops: notes are entered by you, and
Anatria3D does not record where their text came from. That second half is not
padding. Without it the first half would quietly certify that everything
unmarked was written by a human, and that is not something this application can
know — a paragraph pasted from a chatbot and one copied from a textbook arrive
through the same keystroke. Anatria3D does not guess: it does not run your
writing through a detector, and it does not record what you paste. Both would
produce false accusations, and detectors are wrong most often about people
writing outside their first language.

**The application now says which version it is.** `v0.2.0` sits in the tab strip
above the atlas, in the guide's footer, and on every plate you export. There is
no auto-updater here by design, so the copy on your machine is whichever one you
last installed — and until now nothing on screen said which that was. That
mattered in three places: reporting a problem meant guessing, an exported plate
carried no record of the build that drew it, and two plates of the same
structure could disagree with nothing to say which was current. The corrections
below are exactly that kind of change.

### Fixed

**Asking for the brain gave you half a brain.** Isolating `Brain` returned 68
structures: the right hemisphere's gyri and sulci, and the cerebellum. The left
hemisphere, the entire brainstem, the entire diencephalon and the corpus
callosum were filed as *siblings* of the brain rather than parts of it, so they
were hidden. Ask the assistant how many parts the brain has and it would explain
correctly while showing you a model missing most of what it was naming — and the
numbered pins in its answer pointed at structures that were not on screen.

It was a fault in the hierarchy the atlas inherits, not in the anatomy or the
rendering. For the application, the left precentral gyrus was not part of the
brain. 195 structures are refiled, and `Brain` now holds 200: both hemispheres,
the diencephalon, the brainstem with its midbrain, pons and medulla, and the
cerebellum. The meninges and the spinal cord are deliberately *outside* it —
isolating the brain should not bring the dura with it.

Nine groups you can now isolate by name did not exist before: **Brainstem,
Diencephalon, Mesencephalon, Pons, Medulla oblongata, Ventricular system, Spinal
cord, Meninges** and **Eyeball**. Ask for the brainstem and you get the
brainstem.

Nothing outside the nervous system moved, and no structure was added, removed or
renamed.

**The female atlas opened as a bare pelvis.** Switching to it showed the
skeleton alone, and the uterus, kidneys, gut, vessels and breast each had to be
switched back on by hand — every time you switched. It now opens whole.

The male atlas still opens on the skeleton and loads the rest when you ask for
it, because it is 37 MB across thirteen files. The female module is 5.3 MB
across seven; the six systems that used to wait come to 4 MB between them, read
off local disk. The saving was never worth what it cost to use.

**White scrollbars in a dark interface.** On a machine with Windows set to light
mode, every scrollbar rendered light — white tracks with stepper arrows, down the
side of the atlas tree and the transcript. The application had told the browser
it followed the system theme, and it does not: the panels are dark whatever
Windows is set to, and the Dark/Light control changes the background *behind the
model*, not the interface around it. Scrollbars are now dark, narrow, and
without the arrow buttons, so several scrolling panes sit together without any
of them looking like a document.

**The liver and the lung now open into their parts.** Asking to open the liver
gave you a single mesh with its eight Couinaud segments loose beside it, and the
lung the same with its five lobes. Both now open whole.

They are the two that could be fixed honestly. The atlas's visceral systems all
export flat — a fault in the export, not in the source — and most of what could
be reconstructed would have arrived incomplete: a *digestive canal* without the
oesophagus, the jejunum or the appendix, and a *bronchi* group holding the
trachea alone while fourteen real bronchi sat outside it. That is the same
defect as the brain, and it is not improved by being somewhere else. Those
groups are recorded, with the reason, and wait for the export to be repaired.

**Pointing at something now shows it.** When the assistant lit a structure that
an isolation was hiding, the light fell on nothing and the pin beside it led
nowhere. Lighting a structure now brings it into view — it widens what you are
shown, never narrows it.

**And everything it names is lit, not just the first few.** The light's
brightness was graded by the same falloff the cursor uses to show depth, which
goes fully dark past the sixth layer. The assistant may name up to
twenty-four structures — so from the seventh onwards nothing lit at all, while
the answer still carried a numbered pin pointing at it, and the fifth or sixth
arrived so dim that a deep structure behind a ghosted brain was indistinguishable
from unlit. The order still reads — the first structure named is brightest — but
the last one named is now unmistakably lit rather than nearly invisible.

**Sixty-one Latin terms were misspelled, truncated or named the wrong
structure.** An audit of every label in both atlases against Terminologia
Anatomica found defects in the vendored term list that reached the screen and
the printed plates. They fall into four kinds, and the fourth is the one that
mattered:

- **Accents that do not belong in Latin.** Fifty rows had picked up the French
  spelling from the column beside them — `Nodi sacrales latérales` for *Nodi
  sacrales laterales*. Latin anatomical terms carry no diacritics, so this is
  now fixed by rule rather than row by row.
- **A word left stuck on the end**, usually the row's synonym run into the main
  term with no separator: `Regio retromalleolaris lateralis regio`, `Arteria
  transversa colli arteria transversa cervicis`.
- **Letters dropped or misread** — `Arteria musculoohrenica` for
  *musculophrenica*, `Venae pudendales extemae` for *externae*.
- **Terms that had lost the word identifying them**, which is worse than a
  misspelling because what remains is a real name for something else.
  `Arteria pancreaticoduodenalis` without *inferior* is a different vessel;
  `Radix anterior nervi cutanei femoris` without *posterioris* is a different
  nerve. Worst of the set, the articular capsules of the **metatarsophalangeal**
  joints carried the **glenohumeral** capsule's Latin — a label in the foot
  naming a joint in the shoulder.

114 structures in the male atlas and 2 in the female now read differently. No
structure was added, removed or renumbered, so nothing you had saved refers to
anything else. Both renal arteries now read `Arteria renalis`, which is the term
Terminologia Anatomica publishes; the side is on the English name, where it
already was.

The atlas now refuses to build if any Latin label carries a diacritic or repeats
a word — the two signatures every one of these defects left behind.

## [0.1.7] — 2026-08-16

### Added

**Virtual patients you can follow across visits.** A case file is no longer a
single question and an answer. Each visit adds to the record — a weight that
came down, a pressure that did not, what the imaging said — and the assistant
reasons from the record as it stands at that visit. The order is the clinical
content: a figure that moved over four visits is a different case from one that
was always there.

The answer is written when the case is opened, before anything is attempted, and
cannot be edited afterwards. That is the whole discipline — an answer decided
once the attempt is in hand grades nothing. It can now be opened deliberately,
with a confirmation in front of it, and a case that has been opened stays open,
so a summary cannot include the answer today and withhold it tomorrow.

**A resting screen.** After fifteen minutes, or on `Ctrl+X`, the body fades to a
grey brain lit by slow waves of neon blue expanding from points on the cortex.
It is capped to a low frame rate and stops entirely when the window is hidden,
so it costs a laptop almost nothing.

**A keyboard for the viewport.** `I` isolate, `H` hide, `U` bring back what is
hidden, `C` clear the selection, `X` step the exploded view, `F` fit, `A P L R S`
for the anatomical viewpoints, and `+` / `−` to zoom. The letters match what is
printed on the buttons, and a single place decides whether a keystroke belongs to
the viewport — so typing "aorta" into a search box no longer turns the body.

**More from the list of what is under the cursor.** The panel naming everything
a ray from your pointer crosses can now be switched off from the left panel or
the right-click menu, pinned by clicking the body so you can walk over to it,
isolated whole — a ray through the shoulder is a surgical approach written down —
or picked from: `Ctrl`-click the lines to take three of the twelve and leave the
rest of the body out of the way. Picked lines join the same selection a
`Ctrl`-click on the body builds, so `I` isolates them.

**Writing boxes that grow with what is in them.** Every field that takes prose —
the chat, notes, the patient record, the case composer — now fits what you paste
into it, up to a limit, and scrolls after that. Reviewing a pasted case no longer
means reading it three lines at a time.

**A journal that folds.** Notes, patients and sessions each fold away, with the
count kept beside the heading. Notes rest folded, because notes are what you go
and look up while the patients and sessions are the work in front of you. A
search opens all three, since one box narrows all three.

### Fixed

**Installers shipped a stale engine.** `tauri build` never re-froze the Python
sidecar, so a build could carry an engine hours older than the interface it was
bundled with — including prompt changes, which are the easiest to miss because
they are "just words". Freezing the sidecar is now part of the release build.

**Notes could not be written in a new conversation.** A note carries the
conversation it was written in, but a conversation only reaches the journal once
a turn has been filed — so writing a note before the first answer failed with a
foreign key error every time, while saving a note from an answer worked. If you
have wondered why your note count stayed at zero, this is why.

**The open patient record ran off the window.** Nothing bounded its height, so a
long record pushed the conversation to nothing and then carried on past the
bottom of the screen, with the end of the sealed answer somewhere no scrollbar
could reach. It now takes at most half the panel and scrolls itself.

**A click that ended an orbit selected whatever it landed on.** Rotating the body
and releasing the mouse picked a structure. A drag is now a drag.

**A single click did nothing with the body in glass.** With everything ghosted
there was no structure solid enough to accept the click, so selection silently
stopped working while double-click went on isolating.

**The tree opened with every system expanded**, which meant reaching for
*Collapse all* before doing anything.

**The cursor list stayed behind after the pointer left**, describing a place
nobody was pointing at.

**Export and Import claimed a count of zero** beside them, which read as a
failure when nothing had failed.

### Changed

The release pipeline builds and publishes nothing when run by hand, attaching the
packages to the run instead — so a build can be installed and tried on a real
machine before a tag claims it works there. And the five files that carry the
version are checked against each other, and against the tag, before anything is
built.
