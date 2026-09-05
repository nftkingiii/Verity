import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const upstream = process.env.TELEGRAPH_MINER_URL ?? "https://verity-production-fcf5.up.railway.app";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method !== "GET") { res.writeHead(405); return res.end(); }
  if (url.pathname === "/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ status: "ok", service: "routepulse", version: "0.2.0", revision: process.env.APP_REVISION ?? "local" })); }
  if (url.pathname === "/api/telegraph") {
    const kind = url.searchParams.get("kind");
    if (!["news", "forecast", "weather", "lookup"].includes(kind)) { res.writeHead(400); return res.end(); }
    const target = new URL("/v1/" + kind, upstream);
    for (const [key, value] of url.searchParams) if (key !== "kind") target.searchParams.set(key, value);
    try { const response = await fetch(target, {signal: AbortSignal.timeout(18000)}); res.writeHead(response.status, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(await response.text()); }
    catch { res.writeHead(502, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "UPSTREAM_UNAVAILABLE" })); }
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!["index.html", "styles.css", "app.js"].includes(file)) { res.writeHead(404); return res.end(); }
  if (!/^[\w./-]+$/.test(file) || file.includes("..")) { res.writeHead(404); return res.end(); }
  try { const body = await readFile(path.join(root, file)); res.writeHead(200, { "content-type": mime[path.extname(file)] ?? "application/octet-stream", "x-content-type-options": "nosniff" }); res.end(body); }
  catch { res.writeHead(404); res.end("Not found"); }
});
server.listen(port, "0.0.0.0", () => console.log(`RoutePulse listening on ${port}`));
