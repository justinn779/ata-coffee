// 本機靜態伺服器：模擬 GitHub Pages（網站位於 /ata-coffee/ 子路徑）。僅供 E2E 測試與預覽。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("out");
const base = process.env.BASE_PATH ?? "/ata-coffee";
const port = Number(process.env.PORT ?? 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain" };

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (url === "/" ) { res.writeHead(302, { Location: base + "/" }); return res.end(); }
  if (!url.startsWith(base)) { res.writeHead(404); return res.end("Not found"); }
  let p = path.join(root, url.slice(base.length));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(p)).isDirectory()) p = path.join(p, "index.html");
  } catch {
    p = path.join(root, "404.html");
  }
  try {
    const buf = await readFile(p);
    res.writeHead(p.endsWith("404.html") ? 404 : 200, { "Content-Type": types[path.extname(p)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`static: http://127.0.0.1:${port}${base}/`));
