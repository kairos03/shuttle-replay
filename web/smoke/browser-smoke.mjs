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
const SAMPLE = join(WEB, "demo", "assets", "sample");

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
  const overlayColors = () =>
    page.evaluate(() => {
      const c = document.getElementById("cv-overlay");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let green = 0, orange = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue;
        if (d[i + 1] > 180 && d[i] < 120) green++;
        if (d[i] > 220 && d[i + 1] > 100 && d[i + 1] < 170 && d[i + 2] < 80) orange++;
      }
      return { green, orange };
    });

  await check("sample loads with 5 flights and badge", async () => {
    await page.waitForFunction(() => document.querySelectorAll("#flight-list li").length === 5, null, { timeout: 8000 });
    assert.equal((await text("#data-badge")).trim(), "합성 샘플");
    await waitText("#ro-frame", /#0 /);
  });
  const media = await page.evaluate(() => document.getElementById("video").currentSrc);
  results.push(["INFO", `sample media: ${media.split("/").pop()}`]);
  if (ROOT !== WEB) {
    await check("docs link resolves in built site", async () => {
      const href = await page.getAttribute(".links a", "href");
      const res = await page.request.get(new URL(href, base).href);
      assert.equal(res.status(), 200);
    });
  }
  await check("frame stepping follows analysis frames", async () => {
    for (let i = 0; i < 3; i++) {
      await page.click("#btn-next");
      await waitText("#ro-frame", new RegExp(`#${i + 1} `));
    }
    await page.keyboard.press("ArrowLeft");
    await waitText("#ro-frame", /#2 /);
  });
  await check("flight list jumps to t0 and highlights flight", async () => {
    await page.click('#flight-list button[data-flight="3"]');
    await waitText("#ro-flight", /flight_c4/);
    assert.equal(await page.getAttribute('#flight-list button[data-flight="3"]', "aria-current"), "true");
  });
  await check("camera cut shows no overlay", async () => {
    await seekRange(2.7);
    await waitText("#ro-state", /카메라 컷/);
    const c = await overlayColors();
    assert.equal(c.green + c.orange, 0);
  });
  await check("observed + model drawn and independently toggleable", async () => {
    await seekRange(3.3339);
    await waitText("#ro-frame", /#100 /);
    let c = await overlayColors();
    assert.ok(c.green > 0 && c.orange > 0, JSON.stringify(c));
    await page.uncheck("#tg-model");
    c = await overlayColors();
    assert.ok(c.green > 0 && c.orange === 0, JSON.stringify(c));
    await page.check("#tg-model");
    await page.uncheck("#tg-observed");
    c = await overlayColors();
    assert.ok(c.green === 0 && c.orange > 0, JSON.stringify(c));
    await page.check("#tg-observed");
  });
  await page.screenshot({ path: join(OUT, "desktop-1280.png"), fullPage: true });

  const mp4 = readFileSync(join(SAMPLE, "synthetic_rally.mp4"));
  const webm = readFileSync(join(SAMPLE, "synthetic_rally.webm"));
  const okVideo = media.endsWith(".mp4")
    ? { name: "synthetic_rally.mp4", mimeType: "video/mp4", buffer: mp4 }
    : { name: "synthetic_rally.webm", mimeType: "video/webm", buffer: webm };
  const analysis = readFileSync(join(SAMPLE, "analysis.json"));
  const pick = async (video, json) => {
    await page.setInputFiles("#in-video", video);
    await page.setInputFiles("#in-analysis", { name: "analysis.json", mimeType: "application/json", buffer: Buffer.from(json) });
    await page.click("#btn-apply");
  };
  await check("invalid JSON is rejected, sample stays active", async () => {
    await pick(okVideo, "{broken");
    await waitText("#file-msg", /적용하지 못했습니다.*JSON/);
    assert.equal((await text("#data-badge")).trim(), "합성 샘플");
    assert.equal(await page.locator("#flight-list li").count(), 5);
  });
  await check("unknown schema rejected in Korean", async () => {
    await pick(okVideo, JSON.stringify({ schema: "other/v9", frames: [] }));
    await waitText("#file-msg", /지원하지 않는 스키마/);
  });
  await check("unsupported media rejected visibly", async () => {
    await pick({ name: "bad.mp4", mimeType: "video/mp4", buffer: Buffer.from("not a video") }, analysis);
    await waitText("#file-msg", /적용하지 못했습니다/);
    assert.equal((await text("#data-badge")).trim(), "합성 샘플");
  });
  await check("valid local pair applies, sample recovery works", async () => {
    await pick(okVideo, analysis);
    await waitText("#data-badge", /로컬 파일/);
    await page.click("#btn-sample");
    await waitText("#data-badge", /합성 샘플/);
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
