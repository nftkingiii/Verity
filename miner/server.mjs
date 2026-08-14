import http from "node:http";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const MAX_URL_LENGTH = 4_096;
const MAX_TX_HASH_LENGTH = 66;
const RPC_TIMEOUT_MS = 8_000;
const REVISION = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "unknown";

const CHAINS = {
  ethereum: {
    chainId: 1,
    defaultRpc: "https://cloudflare-eth.com",
    env: "RPC_ETHEREUM_URL",
  },
  base: {
    chainId: 8453,
    defaultRpc: "https://mainnet.base.org",
    env: "RPC_BASE_URL",
  },
  arbitrum: {
    chainId: 42161,
    defaultRpc: "https://arb1.arbitrum.io/rpc",
    env: "RPC_ARBITRUM_URL",
  },
  optimism: {
    chainId: 10,
    defaultRpc: "https://mainnet.optimism.io",
    env: "RPC_OPTIMISM_URL",
  },
  polygon: {
    chainId: 137,
    defaultRpc: "https://polygon-rpc.com",
    env: "RPC_POLYGON_URL",
  },
};

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "geolocation=(), microphone=(), camera=()",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  });
  response.end(JSON.stringify(body));
}

function normaliseChain(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normaliseHash(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isTransactionHash(value) {
  return /^0x[0-9a-f]{64}$/.test(value) && value.length === MAX_TX_HASH_LENGTH;
}

function hexToDecimal(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  return BigInt(value).toString(10);
}

function canonicalAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : "-";
}

function rpcUrl(chain) {
  return process.env[chain.env]?.trim() || chain.defaultRpc;
}

async function rpc(url, method, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error("RPC_ERROR");
    return body.result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupTransaction({ chain: chainInput, tx_hash: hashInput }) {
  const chainName = normaliseChain(chainInput);
  const txHash = normaliseHash(hashInput);
  const chain = CHAINS[chainName];

  if (!chain) {
    return { error: "UNSUPPORTED_CHAIN", message: "Use ethereum, base, arbitrum, optimism, or polygon." };
  }
  if (!isTransactionHash(txHash)) {
    return { error: "INVALID_TX_HASH", message: "tx_hash must be a 0x-prefixed 32-byte transaction hash." };
  }

  const url = rpcUrl(chain);
  const [transaction, receipt] = await Promise.all([
    rpc(url, "eth_getTransactionByHash", [txHash]),
    rpc(url, "eth_getTransactionReceipt", [txHash]),
  ]);

  if (!transaction) {
    return {
      chain: chainName,
      chain_id: chain.chainId,
      tx_hash: txHash,
      status: "not_found",
      confidence: 1,
      canonical: `${chainName}|${txHash}|not_found|-|-|-|-`,
      summary: "The transaction was not found on the selected chain.",
    };
  }

  const blockNumber = receipt?.blockNumber ?? transaction.blockNumber;
  const isPending = !blockNumber;
  const status = isPending
    ? "pending"
    : receipt?.status === "0x0"
      ? "confirmed_reverted"
      : "confirmed_success";
  const block = isPending ? "-" : hexToDecimal(blockNumber) ?? "-";
  const from = canonicalAddress(transaction.from);
  const to = canonicalAddress(transaction.to);
  const valueWei = hexToDecimal(transaction.value) ?? "-";
  const canonical = `${chainName}|${txHash}|${status}|${block}|${from}|${to}|${valueWei}`;

  return {
    chain: chainName,
    chain_id: chain.chainId,
    tx_hash: txHash,
    status,
    block_number: block === "-" ? null : block,
    from,
    to,
    value_wei: valueWei,
    confidence: 1,
    canonical,
    summary: `Verified against the ${chainName} RPC at request time.`,
  };
}

export function createServer() {
  return http.createServer(async (request, response) => {
    if (!request.url || request.url.length > MAX_URL_LENGTH) {
      return json(response, 414, { error: "REQUEST_URI_TOO_LONG" });
    }
    if (request.method !== "GET") return json(response, 405, { error: "METHOD_NOT_ALLOWED" });

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") {
      return json(response, 200, {
        status: "ok",
        service: "verity",
        intent: "ONCHAIN_TX_LOOKUP",
        revision: REVISION,
      });
    }
    if (url.pathname !== "/v1/lookup") return json(response, 404, { error: "NOT_FOUND" });

    try {
      const result = await lookupTransaction({
        chain: url.searchParams.get("chain"),
        tx_hash: url.searchParams.get("tx_hash"),
      });
      return json(response, result.error ? 400 : 200, result);
    } catch (error) {
      console.error("lookup_failed", { message: error instanceof Error ? error.message : "unknown" });
      return json(response, 502, { error: "UPSTREAM_UNAVAILABLE", message: "The selected chain RPC could not be queried." });
    }
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1].replaceAll("\\", "/")) {
  createServer().listen(PORT, "0.0.0.0", () => console.log(`Verity listening on ${PORT}`));
}
