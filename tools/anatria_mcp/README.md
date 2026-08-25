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
| `describe_structure` | the full record and its hierarchy trail |
| `list_systems` | the twelve systems and how many structures each holds |
| `browse_hierarchy` | one level of the atlas tree at a time |
| `atlas_info` | version, structure count, licence, credit |

**It cannot change anything.** It does not talk to the Anatria3D application,
cannot move the viewport, and cannot read your study journal, your case files or
your API keys. Driving the viewer is a different surface with a different
security model, and it is deliberately not in this server.

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

The atlas is **CC-BY-SA-4.0**, credited to Z-Anatomy / BodyParts3D (DBCLS).
`atlas_info` returns those fields with every answer that asks for them, because
data that leaves the application should not leave without its provenance. If you
reproduce it anywhere, that licence travels with it.
