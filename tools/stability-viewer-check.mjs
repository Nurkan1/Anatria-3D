/** Local browser regression probe. No credentials, cloud calls or journal writes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const baseline = process.argv.includes("--baseline");
const label = `${baseline ? "baseline" : "working"}${process.argv.includes("--repeat") ? "-repeat" : ""}-visible`;
const root = process.cwd();
const reportDirectory = path.join(root, "test-results", "stability");
const original = new Map();
if (baseline) {
  const changed = execFileSync("git", ["diff", "--name-only", "--", "src"], { encoding: "utf8" }).trim().split(/\r?\n/);
  for (const relative of changed.filter(Boolean)) {
    original.set(path.resolve(relative).replaceAll("\\", "/"), execFileSync("git", ["show", `HEAD:${relative}`], { encoding: "utf8" }));
  }
}
const server = await createServer({
  cacheDir: path.join(root, "node_modules", `.vite-stability-${label}`),
  server: { host: "127.0.0.1", port: 1421, strictPort: true, watch: null },
  plugins: [{ name: "read-only-baseline", enforce: "pre", load(id) { return original.get(id.split("?")[0]); } }],
});
let browser;
const reports = [];
const errors = [];
try {
  await mkdir(reportDirectory, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || url.protocol === "data:" || url.protocol === "blob:"
      ? route.continue() : route.abort();
  });
  await page.goto("http://127.0.0.1:1421", { timeout: 120000 });
  await page.getByRole("button", { name: "Start exploring" }).click({ timeout: 60000 });
  await page.evaluate(async () => {
    const scene = await import("/src/stores/sceneStore.ts");
    const views = await import("/src/stores/studyViewsStore.ts");
    const bridge = await import("/src/features/viewer/viewerBridge.ts");
    window.stabilityProbe = { scene: scene.useSceneStore, views: views.useStudyViewsStore, bridge };
  });
  for (const gender of ["male", "female"]) {
    await page.evaluate((gender) => window.stabilityProbe.scene.getState().setGenderModel(gender), gender);
    await page.waitForFunction(() => window.stabilityProbe.scene.getState().manifest !== null, null, { timeout: 60000 });
    await page.evaluate(() => window.stabilityProbe.scene.setState({ hiddenSystems: [], hideConnective: false }));
    await page.waitForFunction(() => {
      const { scene, bridge } = window.stabilityProbe;
      return bridge.getViewerHandle()?.centres.size === Object.keys(scene.getState().organs).length;
    }, null, { timeout: 90000 });
    const scopes = gender === "male" ? ["full", "single", "group"] : ["full", "single"];
    for (const scope of scopes) {
      const expected = await page.evaluate((scope) => {
        const { scene, views } = window.stabilityProbe;
        const state = scene.getState();
        const ids = Object.keys(state.organs);
        let chosen = [ids[0]];
        if (scope === "group") {
          const groups = new Map();
          for (const organ of Object.values(state.organs)) {
            for (const name of organ.path) groups.set(name, [...(groups.get(name) ?? []), organ.organ_id]);
          }
          chosen = [...groups.values()].sort((a, b) => b.length - a.length)[0];
        }
        scene.setState({ selectedOrganIds: scope === "full" ? [] : chosen, isolatedOrganIds: scope === "full" ? null : chosen });
        views.setState({ wanted: scope !== "full", active: ["anterior", "left", "superior"] });
        return scope === "full" ? ids.length : chosen.length;
      }, scope);
      await page.waitForTimeout(5000);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.detach();
      const result = await page.evaluate(async () => {
        const { sample } = await import("/src/features/viewer/renderSample.ts");
        const intervals = [];
        let last = performance.now();
        await new Promise((resolve) => {
          const tick = (time) => {
            intervals.push(time - last); last = time;
            if (intervals.length >= 180) resolve(); else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        intervals.shift();
        intervals.sort((a, b) => a - b);
        return {
          meanMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
          p95Ms: intervals[Math.floor(intervals.length * 0.95)],
          heapMb: performance.memory?.usedJSHeapSize / 1048576,
          calls: sample.calls, triangles: sample.triangles,
          geometries: sample.geometries, visible: sample.visible, canvases: document.querySelectorAll("canvas").length,
        };
      });
      assert.equal(result.canvases, 1);
      assert.ok(result.calls > 0 && result.triangles > 0);
      reports.push({ gender, scope, expected, ...result });
      console.log(JSON.stringify(reports.at(-1)));
      await page.screenshot({ path: path.join(reportDirectory, `${label}-${gender}-${scope}.png`) });
    }
  }
  assert.deepEqual(errors, [], "Unhandled browser errors");
  await writeFile(path.join(reportDirectory, `${label}.json`), JSON.stringify({ browser: await browser.version(), reports, errors }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
