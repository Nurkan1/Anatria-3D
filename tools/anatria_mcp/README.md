# Anatria3D Atlas — MCP server

Read-only anatomical reference over the Model Context Protocol. Answers from the
manifest Anatria3D already ships: **3,478 structures** in the male atlas and
**264** in the female trunk, each with its Terminologia Anatomica (TA2) Latin
term, its system, and its place in the hierarchy.

No running application, no API key, no network.

## What it can and cannot do

Five tools, all reads:

| Tool | Answers |
|---|---|
| `search_structures` | "what is the id for the left atrium?" |
| `describe_structure` | the record, plus the muscle's origin and insertion areas |
| `list_systems` | each system's size, where it sits in the tree, and how much of it is unfiled |
| `browse_hierarchy` | one level of the atlas tree at a time, paged |
| `atlas_info` | version, structure count, licence, credit |

**It cannot change anything.** It does not talk to the Anatria3D application,
cannot move the viewport, and cannot read your study journal, your case files or
your API keys. Driving the viewer is a different surface with a different
security model, and it is deliberately not in this server.

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
  marking's muscle, or is null when that muscle is not in the atlas.
- **A quarter of the male atlas is unfiled** — 910 structures with no hierarchy
  path, the attachment markings among them. They surface at the root of
  `browse_hierarchy`, which is why that call is paged.

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
tools/anatria_mcp/.venv/Scripts/python.exe -m pip install mcp pytest pytest-asyncio anyio
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
