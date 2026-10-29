// SPDX-License-Identifier: AGPL-3.0-only
// Boots the real app.js against a tiny stand-in DOM. Browser analysis workers are replaced
// by FakeWorker: tests read env.workers and drive progress/done/failed messages; `env.worker`
// (optional) is called with (worker, message) for every message the page posts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const REAL_JSON = readFileSync(new URL("../demo/assets/real/analysis.json", import.meta.url), "utf8");
export const BASE = "http://127.0.0.1/demo/";
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
  "btn-sample", "chooser", "source-actions", "source-msg", "source-state", "source-name", "court-cue",
  "stage", "analyzing", "analyzing-label", "analyzing-progress", "btn-cancel"];
let n = 0;

class FakeWorker {
  constructor(env, url, opts) {
    Object.assign(this, { env, url: String(url), opts, posted: [], terminated: false, onmessage: null, onerror: null });
  }
  postMessage(m) {
    this.posted.push(m);
    if (this.env.worker) this.env.worker(this, m);
  }
  terminate() { this.terminated = true; }
  /** Deliver a worker -> page message for the analyze request (ignored after terminate, as in browsers). */
  emit(m) {
    if (this.terminated || !this.onmessage) return;
    const id = this.posted.find((x) => x.type === "analyze")?.id;
    this.onmessage({ data: { id, ...m } });
  }
}

export async function boot({ worker = null } = {}) {
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
  env.worker = worker;
  env.workers = [];
  globalThis.Worker = class extends FakeWorker {
    constructor(url, opts) {
      super(env, url, opts);
      env.workers.push(this);
    }
  };
  globalThis.fetch = async (url) => {
    env.fetches.push(String(url));
    return { ok: true, status: 200, text: async () => REAL_JSON };
  };
  URL.createObjectURL = (f) => { const u = `blob:${BASE}${f.name}#${++n}`; env.live.add(u); return u; };
  URL.revokeObjectURL = (u) => { env.live.delete(u); env.revoked.push(u); };
  await import(`../demo/js/app.js?boot=${++n}`);
  return env;
}

export const settle = () => new Promise((r) => setTimeout(r, 20));
// CI runners can defer the metadata timer beyond one arbitrary 20ms sleep.
// Await the observable state, with a bounded failure, instead of racing assertions.
export async function waitFor(predicate) {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "source did not settle within 2 seconds");
    await settle();
  }
}
export const pick = (input, file) => { input.files = file ? [file] : []; input.dispatch("change"); };
export const space = (env) => (env.docListeners.keydown || []).forEach((f) => f({ key: " ", target: { tagName: "BODY" }, preventDefault() {} }));
