# Anatria3D Atlas — MCP server

Anatomical reference over the Model Context Protocol, and — if you pair it —
control of a running Anatria3D. Answers from the manifest the application
already ships: **3,478 structures** in the male atlas and **264** in the female
trunk, each with its Terminologia Anatomica (TA2) Latin term, its system, and
its place in the hierarchy.

## Two halves, and the second one is off

**The read half** needs no running application, no API key and no network.
Five tools:

| Tool | Answers |
|---|---|
| `search_structures` | "what is the id for the left atrium?" |
| `describe_structure` | the record, plus the muscle's origin and insertion areas |
| `list_systems` | each system's size and where in the tree it sits |
| `browse_hierarchy` | one level of the atlas tree at a time, paged |
| `atlas_info` | version, structure count, licence, credit |

**The control half** drives the viewport of an application you have open, and
is the same fifteen tools its own assistant has: `focus_organ`,
`illuminate_structures`, `isolate_structures`, `isolate_region`,
`isolate_group`, `show_all_structures`, `add_supply`, `set_layer_visibility`,
`set_layer_opacity`, `xray_system`, `apply_pathology_overlay`,
`clear_pathology_overlays`, `highlight_pathway`, `clear_pathway`,
`set_cross_section`.

**They are not registered unless you ask for them.** Without
`ANATRIA3D_BRIDGE` the server is read-only in the strong sense: the tools do
not exist, so a model is never offered them and never spends a turn
discovering they fail. See *Driving the application* below.

Neither half can read your study journal, your case files or your API keys.
There is no tool for any of them and no code path that opens them.

## What it does not hold

Stated because a model asked these and had to be told no — and because a gap
left unstated is one a model fills from its own memory.

- **The index is TA2 Latin, English and identifiers.** A query in Bulgarian or
  Spanish finds nothing. **Every** empty search carries a note saying so —
  keyed on the result, not on the characters, because the first version fired
  on non-ASCII input and therefore helped `corazón` while missing `corazon`,
  which is how a Spanish speaker on an English keyboard actually types.
- **No relationships.** Nothing records what supplies, innervates, drains or
  borders a structure. `add_supply` in the application answers that from live
  geometry; the manifest has no geometry and therefore no edges.
- **Attachment areas are the source data's marking, not our finding.**
  Z-Anatomy names a muscle's origin and insertion meshes `.ol`/`.el` beside the
  belly's `.l`, and `part` repeats that convention. 451 of them exist in the
  male atlas, **197 muscles carry only one of the two**, and 59 markings have no
  belly under the derived id at all. An empty list is this dataset's coverage,
  not an anatomical claim. The link runs both ways: `belongs_to` names a
  marking's muscle, or is null when that muscle is not in the atlas. They are
  filed under `Muscular insertions`, never among the muscles.

## The two atlases are different works

They do not share a licence, and they do not cover the same body.

| | male | female |
|---|---|---|
| structures | 3,478 | 264 |
| licence | **CC-BY-SA-4.0** | **CC-BY-4.0** |
| source | Z-Anatomy / BodyParts3D (DBCLS) | NIH Human Reference Atlas / Visible Human Female |
| systems | 12 | 7 — **no muscular, no nervous** |

Share-alike on one side and plain attribution on the other: anything that
merges output from both is combining two licences with different obligations.
`atlas_info` reports each atlas's own fields, and it is the only place that
says so.

## Why it has its own virtualenv

The MCP SDK is **not** installed into the repository's `.venv`, and must not be.

`engine/build_sidecar.py` runs PyInstaller with `--collect-all=pydantic_ai`, and
`pydantic-ai-slim` declares an `mcp` extra whose module (`pydantic_ai/mcp.py`)
is already inside that package. Install the SDK beside it and PyInstaller
follows the import: **73 MB** of `cryptography`, `starlette`, `pywin32`,
`opentelemetry` and their dependencies land in the shipped sidecar, for a
feature the sidecar does not use.

This is the same mechanism that took the sidecar from 97 MB to 434 MB during
the voice experiment. The isolation is the fix, and it only works while nobody
runs `pip install mcp` in the repository root.

The seam between the two environments is `anatria_engine/atlas_search.py`,
which is standard library only. Adding a dependency there would have to be
satisfied twice.

## Setting it up

```bash
python -m venv tools/anatria_mcp/.venv
tools/anatria_mcp/.venv/Scripts/python.exe -m pip install "mcp>=2.1,<3" pytest anyio
```

On Linux and macOS the interpreter is `tools/anatria_mcp/.venv/bin/python`.

Run the tests — they spawn the server over stdio exactly as a client does:

```bash
tools/anatria_mcp/.venv/Scripts/python.exe -m pytest tools/anatria_mcp -q
```

## Connecting a client

Every client wants the same two things: the interpreter from this virtualenv,
and the path to `atlas.py`. Use absolute paths — clients do not run from the
repository.

### Claude Code

```bash
claude mcp add anatria-atlas -- "C:\path\to\Anatria3D\tools\anatria_mcp\.venv\Scripts\python.exe" "C:\path\to\Anatria3D\tools\anatria_mcp\atlas.py"
```

### Claude Desktop — `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "anatria-atlas": {
      "command": "C:\\path\\to\\Anatria3D\\tools\\anatria_mcp\\.venv\\Scripts\\python.exe",
      "args": ["C:\\path\\to\\Anatria3D\\tools\\anatria_mcp\\atlas.py"]
    }
  }
}
```

### Codex CLI — `~/.codex/config.toml`

```toml
[mcp_servers.anatria-atlas]
command = "C:\\path\\to\\Anatria3D\\tools\\anatria_mcp\\.venv\\Scripts\\python.exe"
args = ["C:\\path\\to\\Anatria3D\\tools\\anatria_mcp\\atlas.py"]
```

### Gemini CLI — `~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "anatria-atlas": {
      "command": "C:\\path\\to\\Anatria3D\\tools\\anatria_mcp\\.venv\\Scripts\\python.exe",
      "args": ["C:\\path\\to\\Anatria3D\\tools\\anatria_mcp\\atlas.py"]
    }
  }
}
```

## Driving the application

One line, and it never changes:

```json
"env": { "ANATRIA3D_BRIDGE": "1" }
```

Then open Anatria3D, turn **Control bridge** on in the settings drawer, and
restart the MCP client once. There is nothing to copy: the pipe is named for
the account that created it and the server runs as that same account, so it
finds the window by itself.

- **Windows only for now.** The transport is a named pipe. On other platforms
  the switch is not offered and the panel says so.
- **The switch is the consent.** Nothing listens until a person turns it on,
  a `bridge` badge sits in the application's header for as long as it is, and
  turning it off takes the pipe with it.
- **One client at a time.** A second program waits for the first to disconnect.
- **The account owns the pipe.** Its permissions admit the user who created it
  and nobody else.

There is no token. There was one, minted per switch-on and copied from the
panel, and it bought less than it cost: the pipe's permissions already answer
the question that matters, and *which of your own programs* is not a question
you can act on — any program running as you can already read your journal and
your case files without going near a viewport. Against that, a value that
changed every session meant editing this file and restarting the client every
session, which reads as a broken feature rather than a careful one.

`ANATRIA3D_BRIDGE_PIPE` still overrides the derived name, for an application
running as a different account that has deliberately been made reachable.
Nobody needs it for the ordinary setup.

### What it does not record

**Nothing.** The bridge carries scene commands and nothing else, so a session
driven from here leaves no trace in the application: no saved conversation, no
note, no case file, no coverage, no token accounting. What was said stays in
the client's own window.

That is the design, not a gap. Everything that makes Anatria3D a study tool
rather than a viewer is built by the assistant inside the application, on the
reader's own API key. This server drives the atlas; it does not keep a record
of having done so.

### What it cannot know

That a structure is in the manifest does not mean it is on the reader's screen.
The atlas has two bodies and every system can be switched off, and the bridge
has no way to ask which. A command naming something real but not loaded is
accepted here and does nothing there.

Identifiers *are* checked against the manifests before anything is sent, and
that check is not cosmetic: the bridge cannot report that an action was
refused, so an invented `organ_id` would reach the viewport and empty it with
no error at all.

### Reading the manifests from somewhere else

By default the server reads `public/anatomy/` from this checkout. Point it at an
installed copy with `ANATRIA_ATLAS_DIR`:

```json
"env": { "ANATRIA_ATLAS_DIR": "C:\\Program Files\\Anatria3D\\anatomy" }
```

## Licence of the data

**There is no single answer** — see the table above. Ask `atlas_info` for the
atlas you actually used and take the licence, credit and attribution it returns.
Data that leaves the application should not leave without its provenance, and
with two works under two licences a hardcoded answer would be wrong half the
time. Whichever you reproduce, that licence travels with it.
