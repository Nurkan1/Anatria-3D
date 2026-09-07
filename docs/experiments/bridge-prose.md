# Bridge prose experiment

## Scope and baseline

Local branch: `experiment/bridge-prose`. No push, pull request or merge.
Base: `7e2c5cb866196d247c494539f443d759485ba69a` (main on 2026-09-07).
The v0.2.5 release commit is `0037951023d313983e7a61ee07a8449eb5ef3dbd`;
main already had one subsequent README-only commit before this experiment.
Main must keep its original commit, not be reset to the release tag.

Before edits: TypeScript passed; 908 frontend, 277 Python, 80 MCP and
173 Rust tests passed; Ruff and Clippy passed. The first sandboxed frontend
run could not launch Python for the protocol contract. Running the same suite
with permission to use the existing interpreter passed. No packages were installed.

## Design and observable changes

- `say(text)` is the twenty-first MCP tool when `ANATRIA3D_BRIDGE=1`.
  Its `BridgeText` Pydantic annotation publishes and enforces `maxLength: 4000`.
  Zod checks the same bound in Unicode code points, including supplementary
  characters. Overflow is refused, not truncated. No atlas lookup is needed
  for prose, which contains no structure identifiers to validate.
- The existing `scene_command` frame carries `action: "say"`. Rust remains
  opaque and continues stamping bridge request identifiers. No new transport,
  permission, pairing mechanism, frame limit or connection limit was introduced.
- The frontend routes bridge prose before the viewport reducer and before
  the chat command callback. Non-bridge `say` frames are ignored. The local
  assistant's registered tools have not changed.
- `bridgeStore.prose` holds the latest 20 entries in memory. It is never
  persisted, included in `chatStore.messages`, passed through `history()`, or
  saved with `saveTurn`. It remains across chat/session/atlas switches and
  while the panel is hidden: it belongs to the bridge, not a study session.
- `BridgeProse` renders a separate amber lane, with `via the control bridge`
  beside every message and an explicit external/not-saved notice. It does not
  identify a client or model. The existing permanent disclaimer is untouched.
- The existing Markdown renderer has an opt-out for structure pins. Bridge
  markers remain inert literal text, links cannot navigate, HTML is not enabled,
  and external image markup displays its alt text without fetching an image.
  Local Markdown keeps its default behavior, including structure pins.
- Confirmed bridge shutdown, including an off status returned by Rust, clears
  the lane. Prose received while a switch operation is pending or the bridge
  is off is ignored. A failed shutdown preserves the messages and running
  status and reports its error; it must not pretend the pipe closed.
- Status polls begun before a switch operation cannot overwrite its result.
  Duplicate switch requests are ignored while the first is pending. Settings
  and the bridge indicator now disclose external, unsaved messages.

Tool discovery and the window switch are different: without bridge environment
configuration, the MCP server exposes only its five read tools and `say` is
absent. A server already launched with the bridge configured still lists its
tools if the window subsequently switches the pipe off; calls then fail to
connect. This is the existing discovery/transport model, not a new live
capability-negotiation protocol. The pipe remains off at application startup.

## Rejected approaches and actual failures

1. Reusing an assistant bubble would imply the wrong author and couple external
   prose to assistant actions and persistence. A dedicated component and store
   field avoid that coupling; no changes to the journal or chat store are needed.
2. Reusing Markdown unchanged would activate structure pins, including explicit
   `anatria-ref:` links. Both marker conversion and the link renderer must be
   disabled for external prose, not just one of them.
3. JavaScript string length is not Python string length for supplementary
   Unicode characters. Using an ordinary JS length cap would refuse some
   messages accepted by MCP. Tests cover 4000/4001 ASCII and heart emojis.
4. An `img: undefined` component override failed TypeScript's
   `exactOptionalPropertyTypes`. The local default is the intrinsic `img`
   component; the bridge override renders alt text only.
5. A spy installed after the event hook mounted did not observe its captured
   callback. The first routing mutation therefore escaped that assertion.
   Installing spies before mount made the deliberately bad route fail.
6. A synchronous simulated-agent test triggered a dependency event-loop
   deprecation warning. It now awaits the agent in an async test; no warning
   filter or dependency update was added.
7. The first `pnpm tauri build` could not find `python` on the process PATH.
   The retry prepends the existing repository `.venv/Scripts` for that process
   only. It does not modify machine configuration or install an interpreter.

## Regression evidence

Temporary mutations were applied and then removed without rewriting Git history:

- Retain 21 messages: the 20-entry test failed.
- Remove clearing on off: both shutdown and status-refresh tests failed.
- Allow a stale poll to set status after shutdown: the race test failed.
- Allow 4001 characters: two frontend and two Python Unicode boundary tests failed.
- Pass prose to `applyCommand`/the chat callback: the panel integration test failed.

After restoration, all directed tests passed. Integration assertions cover
rendering while hidden, unchanged `messages`, empty provider history, no
`saveTurn`, no scene command callback, subsequent local completion and the next
outbound local request. A real Windows test pipe verifies the MCP wire payload,
schema advertisement and readable overflow refusal. These tests use simulated
application/provider responses, not a real student journal or paid provider.

`git grep` against v0.2.5 and the working copy confirmed `RestoreViewButton`,
`noteCommand` and `describeTurnCost` remain in `ChatPanel.tsx`. Its production
diff contains only the lane import and insertion. The five version files,
workflows, prompts, journal schemas and Rust pipe/security files are unchanged.

Final gate logs are local ignored artifacts under `test-results/bridge-prose/`.
They are not included in this commit.

Final gate output excerpts (2026-09-07, all exit code 0):

```text
pnpm typecheck
> tsc --noEmit

pnpm test
 Test Files  68 passed (68)
      Tests  920 passed (920)

cd engine; ../.venv/Scripts/python -m pytest -q
280 passed in 7.83s

cd engine; ../.venv/Scripts/python -m ruff check .
All checks passed!

cd src-tauri; cargo test
test result: ok. 173 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.03s

cd src-tauri; cargo clippy --all-targets -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.63s

tools/anatria_mcp/.venv/Scripts/python.exe -m pytest tools/anatria_mcp -q
85 passed in 86.16s (0:01:26)
```

Cargo's launcher additionally reported `could not canonicalize path
C:\Users\TrendingPC`; Cargo itself completed both gates successfully.

## Build observations

Command: `pnpm tauri build`, with the existing repository `.venv/Scripts`
prepended to the child process PATH. `beforeBuildCommand` rebuilt the Python
sidecar and the frontend without changing any build configuration.

PyInstaller reported collection warnings for AG-UI, OpenAI voice helpers
(missing numpy), and tzdata; Vite reported its large-chunk warning. No optional
package was installed to silence these. The frozen engine was started with
empty stdin and no visible window, exited with code 0, and emitted:

```json
{"type":"ready","protocol_version":2,"engine_version":"0.1.0"}
```

This verifies startup of the frozen engine, not live requests to providers or
every optional integration. Its executable is at
`engine/dist/anatria-engine/anatria-engine.exe`, not directly under `engine/dist`.

The build completed successfully (exit 0), producing both configured Windows
bundles. Local artifact measurements, all timestamps UTC on 2026-09-07:

| Artifact | Bytes | Last modified |
| --- | ---: | --- |
| `src-tauri/target/release/bundle/nsis/Anatria3D_0.2.5_x64-setup.exe` | 61,422,056 | 08:49:21.4625063 |
| `src-tauri/target/release/bundle/msi/Anatria3D_0.2.5_x64_en-US.msi` | 69,698,060 | 08:47:59.001 |
| `engine/dist/anatria-engine/anatria-engine.exe` | 17,618,824 | 08:45:54.8417039 |

NSIS SHA-256:
`4F97AC4914742E581BF52778477D9DC2F3D030BFD7C9F8C3526E3286C7D1ADAF`.

Sidecar SHA-256:
`7818AF7FBC95403BD4D95F587D14F74BE5174BAC96950AEF32DB6BC7F18BF7E8`.
The resource copy at `src-tauri/target/release/anatria-engine/anatria-engine.exe`
has that same hash and independently emitted the same ready frame with exit 0.
This is the resource staged for packaging, not a test after installing the bundle.

The last Python edit was `engine/tests/test_bridge_prose.py` at
08:43:45.1848637; the runtime protocol was last edited at 08:41:16.7335265.
The frozen executable is later than both. No installer was run, no application
window was launched, and no real journal was opened. Build outputs remain
ignored and are not in Git.

## Promotion and manual acceptance

No new runtime library or bundled model was added. Retention is bounded to
80,000 Unicode code points of source text; this is a bound, not a heap or
frame-time measurement. No matched v0.2.5 installer existed locally, so the
experiment cannot claim an installer-size delta from this machine.

Promotion remains the owner's decision. Before promoting, review the branch,
test the installer in an isolated test profile, and validate:

1. Offline startup, bridge initially off, and both atlases.
2. Bridge on: send Markdown, 20+ messages and a rejected 4001-character call.
3. Local response in progress: send bridge prose, hide/reopen the panel, then
   check the journal and the next local conversation remain separate.
4. Turn the bridge off: the lane clears; reopening it does not restore prose.
5. Existing scene tools, local structure pins, Restore view, multiview, notes,
   export and cost display still behave normally.

Graphical Windows validation and real-provider compatibility are not certified
by unit tests or by a successful installer build. This task does not validate
Linux graphically; the control pipe remains Windows-only as before.
