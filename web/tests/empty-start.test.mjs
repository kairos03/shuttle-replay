// SPDX-License-Identifier: AGPL-3.0-only
// Empty first screen and lazy source choice, exercised on the real app.js with a tiny
// stand-in DOM: nothing loads until a choice, cancel/error keep the chooser, the sample
// keeps its analysis and a picked video has none.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const REAL_JSON = readFileSync(new URL("../demo/assets/real/analysis.json", import.meta.url), "utf8");
const BASE = "http://127.0.0.1/demo/";
const ctx = new Proxy({}, {
  get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : () => {}),
  set: () => true,
});

class El {
  constructor(tag) {
    Object.assign(this, { tag, listeners: {}, attrs: {}, dataset: {}, hidden: false, disabled: false, textContent: "", title: "",
      children: [], value: "", files: null, clientWidth: 320, clientHeight: 180, width: 0, height: 0 });
    this.classList = { toggle: (c, on) => (this[`class_${c}`] = Boolean(on)) };
  }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  dispatch(t, e = {}) { for (const f of this.listeners[t] || []) f({ target: this, preventDefault() {}, ...e }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  replaceChildren(...c) { this.children = c; this.textContent = ""; }
  append(...c) { this.children.push(...c); }
  getContext() { return ctx; }
  click() { if (!this.disabled) this.dispatch("click"); }
  get text() { return this.textContent || this.children.filter((c) => typeof c === "string").join(""); }
}

class Video extends El {
  constructor(env) {
    super("video");
    Object.assign(this, { env, paused: true, ended: false, currentTime: 0, duration: NaN, muted: false, played: 0, videoWidth: 0, videoHeight: 0 });
  }
  get src() { return this.attrs.src ? new URL(this.attrs.src, BASE).href : ""; }
  set src(u) {
    this.attrs.src = u;
    if (this.onloadedmetadata) this.env.probe(this, u); // probe element only
  }
  pause() { this.paused = true; }
  load() {}
  play() { this.played++; this.paused = false; return Promise.resolve(); }
}

const IDS = ["video", "cv-overlay", "cv-court", "video-msg", "rng-time", "btn-play", "in-video", "in-video-first", "btn-demo",
  "btn-sample", "chooser", "source-actions", "source-msg", "source-state", "source-name", "court-cue"];
let n = 0;

async function boot() {
  const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
  const env = { fetches: [], live: new Set(), revoked: [], pending: [], probeMode: "ok", docListeners: {} };
  env.probe = (v, url) => {
    const settle = () => {
      if (env.probeMode === "bad" || /bad/.test(url)) return v.onerror && v.onerror();
      Object.assign(v, { videoWidth: 1080, videoHeight: 1920, duration: 7 });
      v.onloadedmetadata && v.onloadedmetadata();
    };
    if (env.probeMode === "manual") env.pending.push({ url, settle });
    else setTimeout(settle, 0);
  };
  const els = {};
  for (const id of IDS) {
    const e = id === "video" ? new Video(env) : new El(id);
    // Initial hidden/disabled state comes from the real markup.
    const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `#${id} in index.html`);
    e.hidden = /\shidden[\s>]/.test(tag[0]);
    e.disabled = /\sdisabled[\s>]/.test(tag[0]);
    els[id] = e;
  }
  env.els = els;
  globalThis.document = {
    baseURI: BASE, activeElement: null,
    getElementById: (id) => els[id] ?? null,
    createElement: (tag) => (tag === "video" ? new Video(env) : new El(tag)),
    addEventListener: (t, f) => (env.docListeners[t] ??= []).push(f),
  };
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.fetch = async (url) => {
    env.fetches.push(String(url));
    return { ok: true, status: 200, text: async () => REAL_JSON };
  };
  URL.createObjectURL = (f) => { const u = `blob:${BASE}${f.name}#${++n}`; env.live.add(u); return u; };
  URL.revokeObjectURL = (u) => { env.live.delete(u); env.revoked.push(u); };
  await import(`../demo/js/app.js?boot=${++n}`);
  return env;
}

const settle = () => new Promise((r) => setTimeout(r, 20));
// CI runners can defer the metadata timer beyond one arbitrary 20ms sleep.
// Await the observable state, with a bounded failure, instead of racing assertions.
async function waitFor(predicate) {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "source did not settle within 2 seconds");
    await settle();
  }
}
const pick = (input, file) => { input.files = file ? [file] : []; input.dispatch("change"); };
const space = (env) => (env.docListeners.keydown || []).forEach((f) => f({ key: " ", target: { tagName: "BODY" }, preventDefault() {} }));

test("first visit is empty: no fetch, no video src, chooser shown, header actions and transport off", async () => {
  const env = await boot();
  await settle();
  const e = env.els;
  assert.deepEqual(env.fetches, []);
  assert.equal(e.video.getAttribute("src"), null);
  assert.equal(e.chooser.hidden, false);
  assert.equal(e["source-actions"].hidden, true);
  assert.equal(e["btn-play"].disabled, true);
  assert.equal(e["rng-time"].disabled, true);
  assert.equal(e["court-cue"].text, "");
  space(env);
  e["btn-play"].click();
  await settle();
  assert.equal(e.video.played, 0);
  assert.deepEqual(env.fetches, []);
});

test("cancel and undecodable first pick keep the empty chooser with a short error", async () => {
  const env = await boot();
  const e = env.els;
  pick(e["in-video-first"], null);
  await settle();
  assert.equal(e.chooser.hidden, false);
  assert.equal(e.video.getAttribute("src"), null);
  pick(e["in-video-first"], { name: "bad.mp4" });
  await waitFor(() => e["source-msg"].class_error === true);
  assert.equal(e.chooser.hidden, false);
  assert.equal(e["source-actions"].hidden, true);
  assert.equal(e.video.getAttribute("src"), null);
  assert.equal(e["btn-play"].disabled, true);
  assert.equal(e["source-msg"].class_error, true);
  assert.match(e["source-state"].text, /열 수 없습니다/);
  assert.equal(env.live.size, 0);
  assert.deepEqual(env.fetches, []);
});

test("own video: blob only, no analysis fetched, chooser gone; header sample switch restores analysis", async () => {
  const env = await boot();
  const e = env.els;
  pick(e["in-video-first"], { name: "<b>mine</b>.mov" });
  await waitFor(() => e.chooser.hidden);
  assert.deepEqual(env.fetches, []);
  assert.match(e.video.getAttribute("src"), /^blob:/);
  assert.equal(e.chooser.hidden, true);
  assert.equal(e["source-actions"].hidden, false);
  assert.equal(e["btn-play"].disabled, false);
  assert.equal(e["rng-time"].disabled, false);
  assert.equal(e["source-state"].text, "선택한 영상, 분석 결과 없음");
  assert.equal(e["source-name"].textContent, "<b>mine</b>.mov");
  assert.equal(e["court-cue"].text, "분석 결과 없음");
  assert.equal(e["btn-demo"].hidden, false);
  e["btn-demo"].click();
  await waitFor(() => e.video.getAttribute("src") === "assets/real/source_clip.mp4");
  assert.deepEqual(env.fetches, ["assets/real/analysis.json"]);
  assert.equal(e.video.getAttribute("src"), "assets/real/source_clip.mp4");
  assert.equal(e["court-cue"].text, "셔틀 위치 ≈ 추정");
  assert.equal(e["btn-demo"].hidden, true);
  assert.equal(env.live.size, 0);
});

test("sample choice loads the unchanged real pair once, with its analysis cue", async () => {
  const env = await boot();
  const e = env.els;
  e["btn-sample"].click();
  await waitFor(() => e.video.getAttribute("src") === "assets/real/source_clip.mp4");
  assert.deepEqual(env.fetches, ["assets/real/analysis.json"]);
  assert.equal(e.video.getAttribute("src"), "assets/real/source_clip.mp4");
  assert.equal(e.chooser.hidden, true);
  assert.equal(e["source-actions"].hidden, false);
  assert.equal(e["btn-play"].disabled, false);
  assert.equal(e["court-cue"].text, "셔틀 위치 ≈ 추정");
  assert.equal(e.video.played, 0); // no autoplay
});

test("rapid own pick then sample: sample wins, stale blob released", async () => {
  const env = await boot();
  const e = env.els;
  env.probeMode = "manual";
  pick(e["in-video-first"], { name: "slow.mp4" });
  await waitFor(() => env.pending.length === 1);
  e["btn-sample"].click();
  await waitFor(() => env.pending.length === 2);
  for (const p of env.pending.splice(0).reverse()) p.settle();
  await waitFor(() => e.video.getAttribute("src") === "assets/real/source_clip.mp4");
  assert.equal(e.video.getAttribute("src"), "assets/real/source_clip.mp4");
  assert.equal(e["court-cue"].text, "셔틀 위치 ≈ 추정");
  assert.equal(env.live.size, 0);
});

test("markup: chooser holds a native upload label and a sample button; no middle dots", () => {
  const html = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../demo/js/app.js", import.meta.url), "utf8");
  assert.match(html, /<label class="pick">영상 업로드\s*<input type="file" id="in-video-first" accept="video\/\*"/);
  assert.match(html, /<button type="button" id="btn-sample">샘플 보기<\/button>/);
  assert.ok(!/<video[^>]*\ssrc=/.test(html));
  assert.ok(!/·/.test(html + app));
});
