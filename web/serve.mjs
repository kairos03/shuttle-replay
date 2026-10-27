// SPDX-License-Identifier: AGPL-3.0-only
// Minimal local static server with HTTP Range support (needed for video seeking).
// Mirrors GitHub Pages layout: <root> is served under /shuttle-replay/.
//
//   node web/serve.mjs                       # serves web/ -> http://127.0.0.1:8000/shuttle-replay/demo/
//   node web/serve.mjs docs/_build/html 8000 # serves the built docs site (demo at /shuttle-replay/demo/)

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8",
};
export const PREFIX = "/shuttle-replay/";

export function startServer(root, port = 8000, host = "127.0.0.1") {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith(PREFIX)) {
      res.writeHead(302, { location: PREFIX + "demo/" }).end();
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(PREFIX.length));
    const file = normalize(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) return res.writeHead(403).end();
    let path = file;
    let st;
    try {
      st = statSync(path);
      if (st.isDirectory()) {
        if (!url.pathname.endsWith("/")) return res.writeHead(301, { location: url.pathname + "/" }).end();
        path = join(path, "index.html");
        st = statSync(path);
      }
    } catch {
      return res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
    const headers = {
      "content-type": TYPES[extname(path)] || "application/octet-stream",
      "accept-ranges": "bytes",
      "cache-control": "no-cache",
    };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, st.size - 1);
      if (start > end) return res.writeHead(416, { "content-range": `bytes */${st.size}` }).end();
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      return createReadStream(path, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "content-length": st.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(path).pipe(res);
  });
  return new Promise((ok) => server.listen(port, host, () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || fileURLToPath(new URL(".", import.meta.url));
  const port = Number(process.argv[3] || 8000);
  const server = await startServer(root, port);
  const { port: p } = server.address();
  console.log(`serving ${resolve(root)} at http://127.0.0.1:${p}${PREFIX}demo/`);
}
