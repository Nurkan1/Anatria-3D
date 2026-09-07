# The Anatria3D MCP server, as installed

These files ship inside Anatria3D. You are reading the copy that came with the
application, not the repository — there is no git checkout here and none is
needed.

## What this is

A Model Context Protocol server that lets an outside agent read the anatomy
atlas and, when you allow it, move what is on screen.

- **Five tools, always.** Search the 3,742 structures by Latin or English name,
  read a structure's record, walk the hierarchy, list the systems, and ask which
  atlas is loaded and under which licence. These need nothing running: the
  application can be closed.
- **Fifteen more, when you switch the control bridge on.** Isolate, illuminate,
  ghost a layer, cut a section, trace a pathway, and write a message into the
  panel. These act on the window in front of you, immediately.

## Why it is source and not a program

Freezing it would have added roughly ninety megabytes to a sixty-megabyte
installer, for something most readers never use. Seventy kilobytes of Python
costs nothing and can be run by anyone who has an interpreter — which is
anything that could have driven the bridge in the first place.

## Running it

You need Python 3.10 or newer. Make an environment of your own; do not install
anything into the application's own folder.

```
python -m venv <somewhere>/mcpenv
<somewhere>/mcpenv/Scripts/python -m pip install "mcp>=2.1,<3"
```

On Linux and macOS the interpreter is `<somewhere>/mcpenv/bin/python`.

Then point your MCP client at `atlas.py` in this directory, with that
interpreter. To get the fifteen tools that move the view, add to the entry's
environment:

```
"ANATRIA3D_BRIDGE": "1"
```

and turn the **control bridge** switch on in Anatria3D — Settings, beside the
model. It is off at every launch, on purpose.

## What it will not do

It cannot read your study journal, your case files, your notes or your API
keys. It has no network access of its own. A command naming a structure that is
not loaded is accepted and does nothing — the reader can switch whole systems
off, so that is not an error and not evidence the structure is absent.

The index holds Terminologia Anatomica Latin, English and identifiers only. A
search in any other language finds nothing even when the structure exists.

## Licence

The code is Apache-2.0. The anatomy it reads is not: the male atlas is
CC BY-SA 4.0 and the female trunk CC BY 4.0. Call `atlas_info` before
reproducing any of it — the tool exists to answer exactly that.
