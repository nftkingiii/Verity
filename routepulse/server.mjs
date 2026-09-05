import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const engine = (process.env.TELEGRAPH_ENGINE_URL ?? "https://devnode.telegraphprotocol.com").replace(/\/$/, "");
const privateKey = process.env.EVM_PRIVATE_KEY?.trim();
const signer = privateKey ? privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) : null;
const paidFetch = signer ? wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(signer) }] }) : null;
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const limits = new Map();
const intents = {
  weather: ({ location }) => ({ query: `Return current weather conditions for ${location}. Classify this as WEATHER_CHECK.`, context: { location } }),
  forecast: ({ location, days }) => ({ query: `Return the ${days}-day weather forecast for ${location}. Classify this as WEATHER_FORECAST.`, context: { location, days: Number(days) } }),
  news: ({ q, max_results, recent_days }) => ({ query: `Search recent news for: ${q}. Classify this as NEWS_SEARCH.`, context: { query: q, q, max_results: Number(max_results), recent_days: Number(recent_days) } }),
  lookup: ({ chain, tx_hash }) => ({ query: `Look up transaction ${tx_hash} on ${chain}. Classify this as ONCHAIN_TX_LOOKUP.`, context: { chain, tx_hash } }),
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

function allowed(req) {
  const key = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
  const now = Date.now();
  const item = limits.get(key);
  if (!item || now - item.started > 600_000) { limits.set(key, { started: now, count: 1 }); return true; }
  item.count += 1;
  return item.count <= 12;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method !== "GET") { res.writeHead(405, { allow: "GET" }); return res.end(); }
  if (url.pathname === "/health") return json(res, 200, { status: "ok", service: "routepulse", version: "0.3.0", revision: process.env.APP_REVISION ?? "local", routing: "telegraph-engine", payments_configured: Boolean(signer) });
  if (url.pathname === "/api/telegraph") {
    if (!allowed(req)) return json(res, 429, { error: "RATE_LIMITED", message: "Too many paid signal requests. Try again shortly." });
    const kind = url.searchParams.get("kind");
    if (!Object.hasOwn(intents, kind)) return json(res, 400, { error: "INVALID_SIGNAL" });
    if (!paidFetch) return json(res, 503, { error: "PAYMENT_SIGNER_NOT_CONFIGURED", message: "Telegraph x402 routing is not configured on this deployment." });
    const params = Object.fromEntries(url.searchParams);
    if ([params.location, params.q].some(value => value && value.length > 140) || (params.tx_hash && !/^0x[0-9a-fA-F]{64}$/.test(params.tx_hash))) return json(res, 400, { error: "INVALID_INPUT" });
    try {
      const response = await paidFetch(`${engine}/engine/v1/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(intents[kind](params)),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return json(res, response.status, { error: "TELEGRAPH_ENGINE_ERROR", message: body.error ?? "The routed request failed.", details: body.warnings });
      const result = body.result && typeof body.result === "object" ? body.result : { value: body.result };
      return json(res, 200, { ...result, _telegraph: { miner_id: body.miner_id, miner_name: body.miner_name, intent: body.intent, reasoning: body.reasoning, cost_usd: body.cost_usd, duration_ms: body.duration_ms, signal_hash: body.signal_hash, timestamp: body.timestamp } });
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      return json(res, 502, { error: timeout ? "TELEGRAPH_TIMEOUT" : "TELEGRAPH_UNAVAILABLE", message: timeout ? "The routed request timed out." : "The Telegraph Engine is unavailable." });
    }
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!["index.html", "styles.css", "app.js"].includes(file) || !/^[\w./-]+$/.test(file) || file.includes("..")) { res.writeHead(404); return res.end(); }
  try { const body = await readFile(path.join(root, file)); res.writeHead(200, { "content-type": mime[path.extname(file)] ?? "application/octet-stream", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" }); res.end(body); }
  catch { res.writeHead(404); res.end("Not found"); }
});
server.listen(port, "0.0.0.0", () => console.log(`RoutePulse listening on ${port}`));
