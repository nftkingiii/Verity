import http from "node:http";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const MAX_URL_LENGTH = 4_096;
const MAX_TX_HASH_LENGTH = 66;
const RPC_TIMEOUT_MS = 8_000;
const WEATHER_TIMEOUT_MS = 8_000;
const WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast";
const MAX_FORECAST_DAYS = 7;
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

function coordinate(value, minimum, maximum) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 16) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function canonicalCoordinate(value) {
  return value.toFixed(4);
}

function forecastDays(value) {
  if (typeof value !== "string" || !/^\d{1,2}$/.test(value.trim())) return null;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= MAX_FORECAST_DAYS ? days : null;
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

async function fetchWeather(url, fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`WEATHER_HTTP_${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupWeather({ latitude: latitudeInput, longitude: longitudeInput }, fetcher = fetch) {
  const latitude = coordinate(latitudeInput, -90, 90);
  const longitude = coordinate(longitudeInput, -180, 180);
  if (latitude === null || longitude === null) {
    return {
      error: "INVALID_COORDINATES",
      message: "latitude must be between -90 and 90 and longitude must be between -180 and 180.",
    };
  }

  const url = new URL(WEATHER_API_URL);
  url.searchParams.set("latitude", canonicalCoordinate(latitude));
  url.searchParams.set("longitude", canonicalCoordinate(longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
  );
  url.searchParams.set("timezone", "UTC");
  const body = await fetchWeather(url, fetcher);
  const current = body?.current;
  const required = [
    "time",
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
  ];
  if (!current || required.some((field) => typeof current[field] !== "number" && typeof current[field] !== "string")) {
    throw new Error("WEATHER_MALFORMED_RESPONSE");
  }

  const lat = canonicalCoordinate(latitude);
  const lon = canonicalCoordinate(longitude);
  const canonical = [
    lat,
    lon,
    current.time,
    current.temperature_2m,
    current.relative_humidity_2m,
    current.apparent_temperature,
    current.precipitation,
    current.weather_code,
    current.wind_speed_10m,
  ].join("|");
  return {
    latitude: lat,
    longitude: lon,
    observed_at: current.time,
    temperature_c: current.temperature_2m,
    relative_humidity_percent: current.relative_humidity_2m,
    apparent_temperature_c: current.apparent_temperature,
    precipitation_mm: current.precipitation,
    weather_code: current.weather_code,
    wind_speed_kmh: current.wind_speed_10m,
    confidence: 1,
    canonical,
    summary: "Current conditions verified against Open-Meteo at request time.",
  };
}

export async function lookupForecast({ latitude: latitudeInput, longitude: longitudeInput, forecast_days: daysInput }, fetcher = fetch) {
  const latitude = coordinate(latitudeInput, -90, 90);
  const longitude = coordinate(longitudeInput, -180, 180);
  const days = forecastDays(daysInput ?? "3");
  if (latitude === null || longitude === null || days === null) {
    return {
      error: "INVALID_FORECAST_REQUEST",
      message: "latitude and longitude must be valid coordinates; forecast_days must be an integer from 1 to 7.",
    };
  }

  const url = new URL(WEATHER_API_URL);
  url.searchParams.set("latitude", canonicalCoordinate(latitude));
  url.searchParams.set("longitude", canonicalCoordinate(longitude));
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max");
  url.searchParams.set("forecast_days", String(days));
  url.searchParams.set("timezone", "UTC");
  const body = await fetchWeather(url, fetcher);
  const daily = body?.daily;
  const fields = ["time", "weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "wind_speed_10m_max"];
  if (!daily || fields.some((field) => !Array.isArray(daily[field]) || daily[field].length !== days)) {
    throw new Error("FORECAST_MALFORMED_RESPONSE");
  }

  const daysPayload = daily.time.map((date, index) => {
    const values = fields.slice(1).map((field) => daily[field][index]);
    if (typeof date !== "string" || values.some((value) => typeof value !== "number")) {
      throw new Error("FORECAST_MALFORMED_RESPONSE");
    }
    return {
      date,
      weather_code: daily.weather_code[index],
      temperature_max_c: daily.temperature_2m_max[index],
      temperature_min_c: daily.temperature_2m_min[index],
      precipitation_probability_max_percent: daily.precipitation_probability_max[index],
      wind_speed_max_kmh: daily.wind_speed_10m_max[index],
    };
  });
  const lat = canonicalCoordinate(latitude);
  const lon = canonicalCoordinate(longitude);
  const canonical = [lat, lon, days, ...daysPayload.map((day) => [day.date, day.weather_code, day.temperature_max_c, day.temperature_min_c, day.precipitation_probability_max_percent, day.wind_speed_max_kmh].join(","))].join("|");
  return {
    latitude: lat,
    longitude: lon,
    forecast_days: days,
    days: daysPayload,
    confidence: 1,
    canonical,
    summary: "Daily forecast verified against Open-Meteo at request time.",
  };
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
        intents: ["ONCHAIN_TX_LOOKUP", "WEATHER_CHECK", "WEATHER_FORECAST"],
        revision: REVISION,
      });
    }
    if (url.pathname === "/v1/weather") {
      try {
        const result = await lookupWeather({
          latitude: url.searchParams.get("latitude"),
          longitude: url.searchParams.get("longitude"),
        });
        return json(response, result.error ? 400 : 200, result);
      } catch (error) {
        console.error("weather_lookup_failed", { message: error instanceof Error ? error.message : "unknown" });
        return json(response, 502, { error: "UPSTREAM_UNAVAILABLE", message: "Current weather data could not be queried." });
      }
    }
    if (url.pathname === "/v1/forecast") {
      try {
        const result = await lookupForecast({
          latitude: url.searchParams.get("latitude"),
          longitude: url.searchParams.get("longitude"),
          forecast_days: url.searchParams.get("forecast_days"),
        });
        return json(response, result.error ? 400 : 200, result);
      } catch (error) {
        console.error("forecast_lookup_failed", { message: error instanceof Error ? error.message : "unknown" });
        return json(response, 502, { error: "UPSTREAM_UNAVAILABLE", message: "Forecast data could not be queried." });
      }
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
