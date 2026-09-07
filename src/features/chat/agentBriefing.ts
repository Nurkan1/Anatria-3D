/**
 * What to hand an outside agent so it can drive this window.
 *
 * # Why this exists
 *
 * Reported from the field: an agent that was not already configured with the
 * MCP server worked the bridge out by reading the repository — it found the
 * named pipe, the frame shape and the client module on its own, and spent its
 * first attempt on a refusal. Every part of that was discoverable and none of
 * it was *offered*, so the reader paid for the discovery in round trips.
 *
 * A capable agent finding its own way to the answer is not a success. It is the
 * application failing to say something it already knows.
 *
 * # Why it must stand alone
 *
 * The first version of this text sent the agent to `tools/anatria_mcp/atlas.py`
 * and `bridge.py`. That worked in testing and would have failed for every real
 * reader: the installer bundles the frozen sidecar and nothing else, so on a
 * machine where somebody installed the `.exe` those files do not exist. The
 * test only passed because the repository happened to be on the same disk.
 *
 * So the pipe half is written for someone who has the application and no source
 * at all, and it carries a whole client rather than a description of one.
 *
 * # The three things that cost an attempt
 *
 * **The API wants the bare name**, not the `\\.\pipe\` path — passing the whole
 * path to `NamedPipeClientStream` fails in a way that reads like the bridge
 * being down. **One client at a time**, so a configured MCP client holding the
 * pipe will refuse a second connection, which reads like the switch being off.
 * And the encoding: a byte order mark is now tolerated, but writing without one
 * is still the correct thing to do.
 */
export function agentBriefing(pipe: string): string {
  // `\\.\pipe\name` → `name`. The Win32 API takes the last segment alone, and
  // handing it the full path is the commonest way to fail at this.
  const name = pipe.replace(/^\\\\\.\\pipe\\/, "");

  return `You are driving Anatria3D, a 3D anatomy atlas already running on this
computer. It offers twenty tools: five that read the atlas and fifteen that move
what is on screen. The control bridge switch is on, or you would not have been
given this.

IF YOU HAVE THE ANATRIA3D SOURCE — best, and skip the rest.
Configure its MCP server and restart your client:
  server: tools/anatria_mcp/atlas.py
  env:    {"ANATRIA3D_BRIDGE": "1"}
The tools then arrive typed, validated and documented, and you never touch the
wire format. The installed application does NOT include this server — it ships
the engine only — so if you have no source, use the pipe below.

OTHERWISE — write to the named pipe. This needs no source and no Python.
  full path:  ${pipe}
  pipe name:  ${name}

The Windows API takes the NAME, not the path. Passing the full path fails in a
way that looks like the bridge being down.

  $pipe = New-Object System.IO.Pipes.NamedPipeClientStream(
      '.', '${name}', [System.IO.Pipes.PipeDirection]::Out)
  $pipe.Connect(5000)
  $writer = New-Object System.IO.StreamWriter(
      $pipe, (New-Object System.Text.UTF8Encoding $false))
  $writer.AutoFlush = $true
  $writer.WriteLine('{"type":"scene_command","command":{"action":"say","text":"hello"}}')
  $writer.Dispose(); $pipe.Dispose()

One JSON object per line, UTF-8, at most 64 KB per line. Useful actions:
  {"action":"say","text":"..."}                      up to 4000 characters
  {"action":"focus_organ","organ_id":"..."}
  {"action":"isolate_structures","organ_ids":["...","..."]}
  {"action":"illuminate_structures","organ_ids":["..."]}
  {"action":"reset_view"}
The bridge stamps its own request_id and drops every field it does not model,
so sending one of your own has no effect.

WHAT WILL SURPRISE YOU OTHERWISE
- One client at a time. If an MCP client already holds the pipe, your
  connection is refused — which reads exactly like the switch being off.
- A command naming a structure that is not loaded is accepted and does nothing
  on screen. That is not an error, and not evidence the structure is absent:
  the reader can switch whole systems off.
- Identifiers are not guessable. There is no way to search over the pipe, so
  ask the reader for the identifier, or use the MCP server, which can search.
- Your text appears in a separate lane marked "via the control bridge". It is
  not the Anatria3D assistant, it is not saved, and it is never sent to the
  reader's AI provider. Write accordingly.`;
}
