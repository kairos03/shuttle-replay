// SPDX-License-Identifier: AGPL-3.0-only
// Page-side owner of browser analysis workers. Each analyze() call gets its own module
// worker; a newer call or cancel() terminates the previous one, so a superseded request can
// never deliver a result, progress or error. The file is handed to the worker by structured
// clone (same page, same machine); nothing is uploaded.

export const WORKER_URL = new URL("./analyzer-worker.mjs", import.meta.url);

export class BrowserAnalyzer {
  /**
   * @param {object} [deps]
   * @param {(url: URL) => Worker} [deps.createWorker]
   */
  constructor({ createWorker = (url) => new Worker(url, { type: "module", name: "shuttle-replay-analysis" }) } = {}) {
    this.createWorker = createWorker;
    this.current = null; // { id, worker, finish }
    this.seq = 0;
  }

  get busy() {
    return this.current !== null;
  }

  /**
   * Resolves { status: "done", doc, sourceSha256 } | { status: "failed", error: {code, message} }
   * | { status: "cancelled" } (superseded or cancelled; the caller shows nothing from it).
   */
  analyze(file, { onProgress = () => {} } = {}) {
    this.cancel();
    const id = ++this.seq;
    let worker;
    try {
      worker = this.createWorker(WORKER_URL);
    } catch (e) {
      return Promise.resolve({ status: "failed", error: { code: "unsupported_browser", message: `분석 작업자를 시작할 수 없습니다 (${String(e && e.message).slice(0, 80)}).` } });
    }
    return new Promise((resolve) => {
      const job = { id, worker };
      const finish = (result) => {
        if (this.current !== job) return; // already superseded: its promise was settled by cancel()
        this.current = null;
        worker.terminate();
        resolve(result);
      };
      job.finish = (result) => {
        worker.terminate();
        resolve(result);
      };
      this.current = job;
      worker.onmessage = ({ data }) => {
        if (this.current !== job || !data || data.id !== id) return;
        if (data.type === "progress") onProgress(data);
        else if (data.type === "done") finish({ status: "done", doc: data.doc, sourceSha256: data.sourceSha256 });
        else if (data.type === "failed") finish({ status: "failed", error: data.error });
      };
      worker.onerror = (e) => {
        e.preventDefault?.();
        finish({ status: "failed", error: { code: "worker_error", message: String((e && e.message) || "분석 작업자 오류").slice(0, 200) } });
      };
      worker.onmessageerror = () => finish({ status: "failed", error: { code: "worker_error", message: "분석 결과를 받지 못했습니다." } });
      worker.postMessage({ type: "analyze", id, file });
    });
  }

  /** Terminate the running worker (if any); its pending analyze() resolves "cancelled". */
  cancel() {
    const job = this.current;
    this.current = null;
    if (job) {
      try {
        job.worker.postMessage({ type: "cancel", id: job.id });
      } catch {}
      job.finish({ status: "cancelled" });
    }
  }
}
