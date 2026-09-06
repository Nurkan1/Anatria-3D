/** Boot the frozen engine without a key or a provider request. */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

const executable = path.resolve(process.argv[2] ?? `engine/dist/anatria-engine/anatria-engine${process.platform === "win32" ? ".exe" : ""}`);
const expected = Number(readFileSync("src/lib/schemas.ts", "utf8").match(/export const PROTOCOL_VERSION = (\d+)/)?.[1]);
if (!Number.isInteger(expected)) throw new Error("Cannot read the frontend protocol version");
const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const lines = createInterface({ input: child.stdout });
let ready = false;
let failure = null;
const timer = setTimeout(() => { failure = "Engine did not shut down within 30 seconds"; child.kill(); }, 30000);
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
lines.on("line", (line) => {
  try {
    const event = JSON.parse(line);
    if (event.type !== "ready") throw new Error(`Unexpected boot event: ${JSON.stringify(event)}`);
    if (event.protocol_version !== expected) throw new Error(`Protocol ${event.protocol_version}, expected ${expected}`);
    ready = true;
    console.log(`Frozen engine ready; protocol ${expected}`);
    child.stdin.end(JSON.stringify({ kind: "shutdown" }) + "\n");
  } catch (error) { failure = String(error); child.kill(); }
});
child.on("error", (error) => { failure = String(error); });
child.on("close", (code) => {
  clearTimeout(timer);
  lines.close();
  if (failure || !ready || code !== 0) {
    console.error(failure ?? `Engine exited with code ${code}; ready=${ready}`);
    process.exitCode = 1;
  } else console.log("Frozen engine shut down cleanly");
});
