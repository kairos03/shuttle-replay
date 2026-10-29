// SPDX-License-Identifier: AGPL-3.0-only
// Staged loading of a (video, analysis) pair. Only the newest request may be
// committed; a failed or superseded request never touches the active pair.

export class PairLoader {
  /**
   * @param {object} deps
   * @param {(file: any) => Promise<string>} deps.readText
   * @param {(text: string) => any} deps.parse   throws on invalid analysis
   * @param {(url: string) => Promise<object>} deps.probeVideo  resolves metadata or rejects
   * @param {(file: any) => string} deps.createURL
   * @param {(url: string) => void} deps.revokeURL
   */
  constructor(deps) {
    this.deps = deps;
    this.generation = 0;
    this.active = null; // { model, videoURL, meta, owned, label }
  }

  /**
   * Stage and, if still current, commit a pair. `video` is either
   * { file } (an ObjectURL is created and owned) or { url } (not owned).
   * Analysis is { file }, { text } or null (a video with no analysis; model is null).
   * Resolves { status: "committed" | "superseded" | "failed", error?, pair? }.
   */
  async apply({ video, analysis, label }) {
    const gen = ++this.generation;
    const owned = Boolean(video.file);
    let url = null;
    const discard = () => {
      if (owned && url) this.deps.revokeURL(url);
      url = null;
    };
    try {
      let model = null;
      if (analysis) {
        const text = analysis.file ? await this.deps.readText(analysis.file) : analysis.text;
        if (gen !== this.generation) return discard(), { status: "superseded" };
        model = this.deps.parse(text);
      }
      url = owned ? this.deps.createURL(video.file) : video.url;
      const meta = await this.deps.probeVideo(url);
      if (gen !== this.generation) return discard(), { status: "superseded" };
      const previous = this.active;
      this.active = { model, videoURL: url, meta, owned, label };
      // Release the replaced URL only after the new pair is in place.
      if (previous && previous.owned && previous.videoURL !== url) this.deps.revokeURL(previous.videoURL);
      return { status: "committed", pair: this.active };
    } catch (error) {
      discard();
      if (gen !== this.generation) return { status: "superseded" };
      return { status: "failed", error };
    }
  }

  /**
   * Attach a validated analysis to the active pair, only while `gen` is still the newest
   * request (a later selection or reset makes a late result a no-op). Returns the pair or null.
   */
  attachModel(gen, model) {
    if (gen !== this.generation || !this.active) return null;
    this.active = { ...this.active, model };
    return this.active;
  }

  /** Supersede any in-flight request; the active pair is kept. Returns the new generation. */
  cancel() {
    return ++this.generation;
  }

  /** Release everything (page unload). */
  dispose() {
    this.generation++;
    if (this.active && this.active.owned) this.deps.revokeURL(this.active.videoURL);
    this.active = null;
  }
}
