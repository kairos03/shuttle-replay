// SPDX-License-Identifier: AGPL-3.0-only
// Video-only selection, reset to the bundled pair, generation ordering and URL ownership.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseAnalysisText } from "../demo/js/analysis-model.js";
import { PairLoader } from "../demo/js/pair-loader.js";
import { fixture } from "./helpers.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

function harness() {
  const live = new Set();
  const probes = new Map();
  let n = 0;
  let parsed = 0;
  const loader = new PairLoader({
    readText: async (file) => file.text,
    parse: (t) => (parsed++, parseAnalysisText(t)),
    createURL: (file) => {
      const url = `blob:${file.name}#${++n}`;
      live.add(url);
      return url;
    },
    revokeURL: (url) => live.delete(url),
    probeVideo: (url) => {
      const d = deferred();
      probes.set(url.replace(/#\d+$/, ""), d);
      return d.promise;
    },
  });
  return { loader, live, probes, parsedCount: () => parsed };
}

const good = JSON.stringify(fixture());
const tick = () => new Promise((r) => setImmediate(r));
const META = { width: 1080, height: 1920, duration: 3 };

test("user video without analysis commits with no model and never parses anything", async () => {
  const { loader, live, probes, parsedCount } = harness();
  const p = loader.apply({ video: { file: { name: "mine.mov" } }, analysis: null, label: "mine.mov" });
  await tick();
  probes.get("blob:mine.mov").resolve(META);
  const r = await p;
  assert.equal(r.status, "committed");
  assert.equal(r.pair.model, null);
  assert.equal(r.pair.label, "mine.mov");
  assert.deepEqual(r.pair.meta, META);
  assert.equal(parsedCount(), 0);
  assert.deepEqual([...live], [r.pair.videoURL]);
});

test("user video replacing the sample pair drops the sample analysis", async () => {
  const { loader, probes } = harness();
  const s = loader.apply({ video: { url: "assets/real/source_clip.mp4" }, analysis: { text: good } });
  await tick();
  probes.get("assets/real/source_clip.mp4").resolve({ width: 640, height: 360, duration: 7 });
  assert.ok((await s).pair.model);
  const u = loader.apply({ video: { file: { name: "u.mp4" } }, analysis: null });
  await tick();
  probes.get("blob:u.mp4").resolve(META);
  assert.equal((await u).pair.model, null);
  assert.equal(loader.active.model, null);
});

test("undecodable user video fails, releases its URL and keeps the current pair", async () => {
  const { loader, live, probes } = harness();
  const a = loader.apply({ video: { file: { name: "ok.mp4" } }, analysis: null });
  await tick();
  probes.get("blob:ok.mp4").resolve(META);
  const okPair = (await a).pair;
  const b = loader.apply({ video: { file: { name: "bad.mp4" } }, analysis: null });
  await tick();
  probes.get("blob:bad.mp4").reject(new Error("decode"));
  const r = await b;
  assert.equal(r.status, "failed");
  assert.equal(loader.active, okPair);
  assert.deepEqual([...live], [okPair.videoURL]);
});

test("reset to the bundled pair revokes the user's blob URL once committed", async () => {
  const { loader, live, probes } = harness();
  const u = loader.apply({ video: { file: { name: "u.mp4" } }, analysis: null });
  await tick();
  probes.get("blob:u.mp4").resolve(META);
  await u;
  assert.equal(live.size, 1);
  const s = loader.apply({ video: { url: "assets/real/source_clip.mp4" }, analysis: { text: good } });
  await tick();
  assert.equal(live.size, 1); // still showing the user video until the sample is ready
  probes.get("assets/real/source_clip.mp4").resolve({ width: 640, height: 360, duration: 7 });
  const r = await s;
  assert.equal(r.status, "committed");
  assert.ok(r.pair.model);
  assert.equal(live.size, 0);
});

test("reset issued while a user video is loading wins even if the upload finishes later", async () => {
  const { loader, live, probes } = harness();
  const u = loader.apply({ video: { file: { name: "slow.mp4" } }, analysis: null });
  await tick();
  const s = loader.apply({ video: { url: "assets/real/source_clip.mp4" }, analysis: { text: good } });
  await tick();
  probes.get("assets/real/source_clip.mp4").resolve({ width: 640, height: 360, duration: 7 });
  probes.get("blob:slow.mp4").resolve(META);
  assert.equal((await s).status, "committed");
  assert.equal((await u).status, "superseded");
  assert.ok(loader.active.model);
  assert.equal(live.size, 0);
});

test("cancel() supersedes an in-flight selection without touching the active pair", async () => {
  const { loader, live, probes } = harness();
  const u = loader.apply({ video: { file: { name: "x.mp4" } }, analysis: null });
  await tick();
  const g = loader.cancel();
  assert.equal(g, loader.generation);
  probes.get("blob:x.mp4").resolve(META);
  assert.equal((await u).status, "superseded");
  assert.equal(loader.active, null);
  assert.equal(live.size, 0);
});

// Static checks on the simplified page: no legacy forms, local-only, text-only rendering.
const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../demo/js/app.js", import.meta.url), "utf8");

test("page offers one video picker (video/*), a hidden demo reset and no legacy forms", () => {
  assert.match(html, /<input type="file" id="in-video" accept="video\/\*"/);
  assert.match(html, /영상 선택/);
  assert.match(html, /<button type="button" id="btn-demo"[^>]*hidden/);
  assert.match(html, /데모 영상/);
  for (const gone of ["in-analysis", "in-offset", "btn-apply", "flight-list", "tech-details", "display-options", "strip-key", "data-badge", "roles"]) {
    assert.ok(!html.includes(gone), gone);
  }
  assert.ok(!/<video[^>]*\scontrols/.test(html), "no native controls next to the custom transport");
});

test("page and app stay local: no external links, fetches or HTML injection", () => {
  assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, "")));
  assert.ok(!/href="\.\.\//.test(html));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(app));
  const fetches = app.match(/fetch\(([^)]*)\)/g) || [];
  assert.deepEqual(fetches, ['fetch(SAMPLE_DIR + "analysis.json", { cache: "no-cache" })']);
  assert.ok(!/upload|XMLHttpRequest|sendBeacon|WebSocket/.test(app));
  assert.ok(!/자동 분석/.test(html + app));
});
