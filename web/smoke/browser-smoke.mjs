// SPDX-License-Identifier: AGPL-3.0-only
// Local browser smoke test for the static demo. Optional: needs playwright-core
// (not a project dependency). Set PLAYWRIGHT_CORE=/path/to/playwright-core if it
// is not resolvable; exits 0 with "SKIP" when unavailable.
//
//   node web/smoke/browser-smoke.mjs [--out DIR] [--channel chrome] [--root docs/_build/html]
// --root serves a built docs site instead of web/ (same /shuttle-replay/demo/ URL).

import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startServer } from "../serve.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = opt("--out", process.env.SMOKE_OUT || "smoke-out");
const CHANNEL = opt("--channel", undefined);
const WEB = fileURLToPath(new URL("..", import.meta.url));
const REAL = join(WEB, "demo", "assets", "real");

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE, "playwright-core", "playwright"].filter(Boolean);
  for (const c of candidates) {
    try {
      const spec = c.startsWith("/") ? pathToFileURL(join(c, "index.mjs")).href : c;
      const mod = await import(spec);
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
const ROOT = opt("--root", WEB);
const server = await startServer(ROOT, 0);
const base = `http://127.0.0.1:${server.address().port}/shuttle-replay/demo/`;
const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message.split("\n")[0]]);
  }
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => {
    if (!r.url().startsWith(`http://127.0.0.1:${server.address().port}/`) && !r.url().startsWith("blob:")) {
      errors.push(`external request: ${r.url()}`);
    }
  });
  await page.goto(base);
  const text = (sel) => page.locator(sel).textContent();
  const waitText = (sel, re) =>
    page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s).textContent), [sel, re.source], { timeout: 8000 });
  const seekRange = (t) =>
    page.evaluate((v) => {
      const r = document.getElementById("rng-time");
      r.value = String(v);
      r.dispatchEvent(new Event("input"));
    }, t);
  const overlayInk = () =>
    page.evaluate(() => {
      const c = document.getElementById("cv-overlay");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
  const demoHidden = () => page.evaluate(() => document.getElementById("btn-demo").hidden);
  const clip = { name: "my <b>clip</b>.mp4", mimeType: "video/mp4", buffer: readFileSync(join(REAL, "source_clip.mp4")) };

  await check("first visit is empty: no JSON/media request, chooser shown, transport disabled", async () => {
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name));
    assert.deepEqual(res.filter((u) => /\.(json|mp4|webm|mov)(\?|$)/.test(u)), []);
    assert.equal(await page.evaluate(() => document.getElementById("video").getAttribute("src")), null);
    assert.equal(await page.isVisible("#chooser"), true);
    assert.equal(await page.isVisible("#source-actions"), false);
    assert.equal(await page.isDisabled("#btn-play"), true);
    assert.equal(await page.isDisabled("#rng-time"), true);
    await page.keyboard.press("Space");
    assert.equal(await page.evaluate(() => document.getElementById("video").getAttribute("src")), null);
  });
  await check("cancelled first pick keeps the empty chooser", async () => {
    await page.setInputFiles("#in-video-first", []);
    await page.waitForTimeout(150);
    assert.equal(await page.isVisible("#chooser"), true);
  });
  await check("undecodable first pick keeps the chooser with a short error", async () => {
    await page.setInputFiles("#in-video-first", { name: "bad.mp4", mimeType: "video/mp4", buffer: Buffer.from("not a video") });
    await waitText("#source-state", /열 수 없습니다/);
    assert.equal(await page.isVisible("#chooser"), true);
    assert.equal(await page.evaluate(() => document.getElementById("video").getAttribute("src")), null);
  });
  await check("sample choice loads the real pair with overlays and no demo button", async () => {
    await page.click("#btn-sample");
    await page.waitForFunction(() => document.getElementById("video").readyState >= 2, null, { timeout: 8000 });
    await seekRange(1.0);
    await page.waitForTimeout(200);
    assert.ok((await overlayInk()) > 0, "overlay drawn");
    assert.equal(await demoHidden(), true);
    assert.equal((await text("#court-cue")).includes("분석 결과 없음"), false);
  });
  await check("picked video plays without bundled analysis", async () => {
    await page.setInputFiles("#in-video", clip);
    await waitText("#source-state", /선택한 영상, 분석 결과 없음/);
    assert.equal(await text("#source-name"), clip.name); // textContent, not markup
    assert.equal(await page.locator("#source-name b").count(), 0);
    assert.match(await page.evaluate(() => document.getElementById("video").src), /^blob:/);
    await waitText("#court-cue", /분석 결과 없음/);
    await seekRange(1.0);
    await page.waitForTimeout(200);
    assert.equal(await overlayInk(), 0);
    assert.equal(await demoHidden(), false);
  });
  await check("cancelled picker keeps the current video", async () => {
    const before = await page.evaluate(() => document.getElementById("video").src);
    await page.setInputFiles("#in-video", []);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.getElementById("video").src), before);
  });
  await check("undecodable media shows a small error and keeps the current video", async () => {
    const before = await page.evaluate(() => document.getElementById("video").src);
    await page.setInputFiles("#in-video", { name: "bad.mp4", mimeType: "video/mp4", buffer: Buffer.from("not a video") });
    await waitText("#source-state", /열 수 없습니다/);
    assert.equal(await page.evaluate(() => document.getElementById("video").src), before);
  });
  await check("demo button restores the real pair and analysis", async () => {
    await page.click("#btn-demo");
    await page.waitForFunction(() => !document.getElementById("video").src.startsWith("blob:") && document.getElementById("video").readyState >= 2, null, { timeout: 8000 });
    assert.equal(await demoHidden(), true);
    await seekRange(1.0);
    await page.waitForTimeout(200);
    assert.ok((await overlayInk()) > 0);
  });
  await check("rapid pick then reset ends on the real pair", async () => {
    await page.setInputFiles("#in-video", clip);
    await page.click("#btn-demo", { force: true }).catch(() => page.evaluate(() => document.getElementById("btn-demo").click()));
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => document.getElementById("video").src.startsWith("blob:")), false);
    assert.equal(await demoHidden(), true);
  });
  await check("playback advances time", async () => {
    await page.click("#btn-play");
    await page.waitForTimeout(700);
    await page.click("#btn-play");
    const t = await page.evaluate(() => document.getElementById("video").currentTime);
    assert.ok(t > 0.2, `currentTime ${t}`);
  });

  for (const [w, h] of [[820, 1180], [390, 844]]) {
    await check(`no horizontal overflow at ${w}px`, async () => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(o.sw <= o.cw, JSON.stringify(o));
      await page.screenshot({ path: join(OUT, `viewport-${w}.png`), fullPage: true });
    });
  }
  await check("no console errors or external requests", async () => {
    // A rejected bad.mp4 probe may log a media error in some browsers; ignore only that.
    const real = errors.filter((e) => !/MEDIA_ERR|DEMUXER|Format error|bad\.mp4/i.test(e));
    assert.deepEqual(real, []);
  });
} finally {
  await browser.close();
  server.close();
}

for (const r of results) console.log(r.join("  "));
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
