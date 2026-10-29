// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end check of in-browser automatic analysis in real Chrome: a local MP4's actual
// bytes go through the native file input, decode + models + court + physics run in the
// page's workers, the validated result autoplays with players and shuttle, and no request
// leaves the local static server. Also exercises cancel and replace. Optional: needs
// playwright-core (PLAYWRIGHT_CORE=/path) and Chrome; exits 0 with "SKIP" when unavailable.
//
//   node web/smoke/browser-analysis-e2e.mjs --video clip.mp4 [--out DIR] [--channel chrome]
//        [--url http://127.0.0.1:PORT/shuttle-replay/demo/] [--timeout-s 900] [--headed]

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startServer } from "../serve.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const WEB = fileURLToPath(new URL("..", import.meta.url));
const OUT = opt("--out", "smoke-out/e2e");
const VIDEO = opt("--video", join(WEB, "demo", "assets", "real", "source_clip.mp4"));
const CHANNEL = opt("--channel", "chrome");
const TIMEOUT_MS = Number(opt("--timeout-s", "900")) * 1000;
const ONLY = opt("--only", "all"); // all | analyze | cancel

async function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_CORE, "playwright-core", "playwright"].filter(Boolean)) {
    try {
      const mod = await import(c.startsWith("/") ? pathToFileURL(join(c, "index.mjs")).href : c);
      return mod.chromium || mod.default.chromium;
    } catch {}
  }
  return null;
}

const chromium = await loadPlaywright();
if (!chromium) {
  console.log("SKIP: playwright-core not available (set PLAYWRIGHT_CORE)");
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });
// A neutral file name: the picked file is the user's, never a bundled asset URL.
const picked = join(OUT, "picked-input.mp4");
copyFileSync(VIDEO, picked);

let server = null;
let url = opt("--url", null);
if (!url) {
  server = await startServer(WEB, 0);
  url = `http://127.0.0.1:${server.address().port}/shuttle-replay/demo/`;
}
const origin = new URL(url).origin;
const report = { url, video: "picked-input.mp4", steps: [], requests: [], console: [] };
// Playback-quality numbers need --headed: headless Chrome drops frames even for a bare <video>.
const browser = await chromium.launch({ channel: CHANNEL, headless: !args.includes("--headed"), args: ["--enable-unsafe-webgpu"] });

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("request", (r) => report.requests.push({ method: r.method(), url: r.url().replace(origin, ""), external: !r.url().startsWith(origin) && !r.url().startsWith("blob:") && !r.url().startsWith("data:") }));
  page.on("console", (m) => report.console.push(`${m.type()}: ${m.text()}`.slice(0, 400)));
  page.on("pageerror", (e) => report.console.push(`pageerror: ${e.message}`.slice(0, 400)));
  await page.goto(url);
  return { ctx, page };
}

const ui = (page) => page.evaluate(() => ({
  state: document.getElementById("source-state").textContent,
  overlay: !document.getElementById("analyzing").hidden,
  label: document.getElementById("analyzing-label").textContent,
  progress: document.getElementById("analyzing-progress").value,
  play: !document.getElementById("btn-play").disabled,
  t: document.getElementById("video").currentTime,
  paused: document.getElementById("video").paused,
  ended: document.getElementById("video").ended,
  summary: document.getElementById("stage").dataset.analysis || null,
}));

try {
  if (ONLY === "all" || ONLY === "cancel") {
    // Cancel: overlay goes away, the picked video stays playable, nothing is attached.
    const { ctx, page } = await newPage({ width: 1280, height: 800 });
    await page.setInputFiles("#in-video-first", picked);
    await page.waitForFunction(() => document.getElementById("analyzing-progress").value > 0, null, { timeout: 120000 });
    await page.screenshot({ path: join(OUT, "cancel-before.png") });
    await page.click("#btn-cancel");
    const s = await ui(page);
    assert.equal(s.overlay, false);
    assert.equal(s.play, true);
    assert.match(s.state, /취소/);
    await page.click("#btn-play");
    await page.waitForFunction(() => document.getElementById("video").currentTime > 0.3, null, { timeout: 10000 });
    assert.equal((await ui(page)).summary, null);
    report.steps.push({ step: "cancel", ok: true, after: await ui(page) });
    // Replace: a second pick during analysis supersedes the first (only one result can attach).
    await page.setInputFiles("#in-video", picked);
    await page.waitForFunction(() => document.getElementById("analyzing-progress").value > 0, null, { timeout: 120000 });
    await page.setInputFiles("#in-video", picked);
    await page.waitForFunction(() => !document.getElementById("analyzing").hidden, null, { timeout: 10000 });
    await page.click("#btn-cancel");
    report.steps.push({ step: "replace_then_cancel", ok: true, after: await ui(page) });
    await ctx.close();
  }

  if (ONLY === "all" || ONLY === "analyze") {
    const { ctx, page } = await newPage({ width: 1280, height: 800 });
    const t0 = Date.now();
    await page.setInputFiles("#in-video-first", picked);
    const samples = [];
    let shot = 0;
    while (Date.now() - t0 < TIMEOUT_MS) {
      const s = await ui(page);
      if (!s.overlay && /자동 분석/.test(s.state) && !/중/.test(s.state)) break;
      if (samples.length === 0 || samples[samples.length - 1].label !== s.label) {
        samples.push({ ms: Date.now() - t0, label: s.label, progress: s.progress });
        console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s.label}`);
        if (shot < 4 && s.progress >= shot * 25) await page.screenshot({ path: join(OUT, `progress-${shot++}.png`) });
      }
      await page.waitForTimeout(500);
    }
    const done = await ui(page);
    report.steps.push({ step: "analyze", ms: Date.now() - t0, progress: samples, result: done });
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
    assert.ok(done.summary, `analysis did not attach: ${done.state}`);
    const sum = JSON.parse(done.summary);
    report.summary = sum;
    // Autoplay of the analyzed result, then the whole clip to the end.
    await page.waitForFunction(() => !document.getElementById("video").paused || document.getElementById("video").ended, null, { timeout: 10000 });
    for (let k = 0; k < 4; k++) {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(OUT, `playback-${k}.png`) });
    }
    await page.waitForFunction(() => document.getElementById("video").ended, null, { timeout: 120000 });
    report.steps.push({ step: "full_playback", ok: true, end: await ui(page) });
    // Narrow / portrait layout of the analyzed result.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { const v = document.getElementById("video"); v.currentTime = v.duration / 2; });
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, "narrow-analyzed.png"), fullPage: true });
    await ctx.close();
    assert.ok(sum.observed > 0, "no observed shuttle frames");
    assert.ok(sum.players > 0, "no player frames");
  }
  const external = report.requests.filter((r) => r.external || r.method !== "GET");
  report.external_or_non_get = external;
  assert.deepEqual(external, [], "requests left the local static server or were not GET");
  assert.ok(!report.requests.some((r) => /picked-input/.test(r.url)), "picked file must not be requested over HTTP");
  report.pass = true;
  console.log("PASS", JSON.stringify(report.summary || {}));
} catch (e) {
  report.pass = false;
  report.error = String(e && e.stack || e);
  console.log("FAIL", report.error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  if (server) server.close();
}
