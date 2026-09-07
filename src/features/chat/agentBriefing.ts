/**
 * What to hand an outside agent so it can drive this window.
 *
 * # Why this exists
 *
 * Reported from the field: an agent that was not already configured with the
 * MCP server worked out the bridge by reading the repository — it identified
 * the named pipe, the frame shape and the client module on its own, and spent
 * its first attempt on a refusal. Every part of that was discoverable and none
 * of it was *offered*, so the reader paid for the discovery in round trips.
 *
 * A capable agent finding its own way to the answer is not a success. It is the
 * application failing to say something it knows.
 *
 * # Why the preferred path is named first
 *
 * Configuring the MCP server is better in every way — the tools arrive typed,
 * validated and documented, and the agent never touches the wire format. Hand
 * a model two options and it will often take the one it can start immediately,
 * so the fallback is written second and marked as the fallback.
 *
 * # Why the caveats are in here rather than left to the model
 *
 * The last three lines are the ones that cost a reader real time otherwise: a
 * command naming a structure that is not loaded is accepted and does nothing,
 * which reads exactly like a broken bridge; identifiers cannot be guessed; and
 * the index holds no Spanish or Bulgarian, so an empty search is not evidence
 * of absence. Those are the same warnings the MCP server states about itself,
 * repeated here because an agent on the fallback path never sees them.
 */
export function agentBriefing(pipe: string): string {
  return `You are driving Anatria3D, a 3D anatomy atlas already running on this
computer. It offers twenty tools over the Model Context Protocol: five that read
the atlas and fifteen that move what is on screen.

PREFERRED — configure the MCP server, then restart your client.
  server: tools/anatria_mcp/atlas.py in the Anatria3D repository
  env:    {"ANATRIA3D_BRIDGE": "1"}
The five read-only tools are always there. The fifteen that move the view appear
only with that variable set, and only while the control bridge switch is on.

FALLBACK — only if your client cannot be configured with an MCP server, write to
the named pipe directly:
  ${pipe}
One JSON object per line, UTF-8:
  {"type":"scene_command","command":{"action":"focus_organ","organ_id":"heart"}}
The bridge stamps its own request_id and drops every field it does not model, so
sending one of your own has no effect. tools/anatria_mcp/bridge.py in the
repository is a working client — read it before writing another.

WHAT WILL SURPRISE YOU OTHERWISE
- A command naming a structure that is not loaded is accepted here and does
  nothing on screen. That is not an error, and not evidence the structure is
  absent: the reader can switch whole systems off.
- Identifiers are not guessable. Call search_structures before naming one.
- The index holds Terminologia Anatomica Latin, English and identifiers only. A
  query in any other language finds nothing even when the structure exists.`;
}
