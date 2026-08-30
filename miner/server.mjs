import http from "node:http";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const MAX_URL_LENGTH = 4_096;
const MAX_TX_HASH_LENGTH = 66;
const RPC_TIMEOUT_MS = 8_000;
const WEATHER_TIMEOUT_MS = 8_000;
const WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_API_URL = "https://geocoding-api.open-meteo.com/v1/search";
const MAX_FORECAST_DAYS = 7;
const NEWS_TIMEOUT_MS = 8_000;
const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search";
const MAX_NEWS_QUERY_LENGTH = 120;
const MAX_NEWS_RESULTS = 10;
const NEWS_CACHE_TTL_MS = 30_000;
const NEWS_STALE_TTL_MS = 15 * 60_000;
const NEWS_CACHE_LIMIT = 100;
const newsCache = new Map();
const REVISION = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "unknown";

const CHAINS = {
  ethereum: {
    chainId: 1,
    defaultRpcs: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"],
    env: "RPC_ETHEREUM_URL",
    envList: "RPC_ETHEREUM_URLS",
  },
  base: {
    chainId: 8453,
    defaultRpcs: ["https://mainnet.base.org"],
    env: "RPC_BASE_URL",
  },
  arbitrum: {
    chainId: 42161,
    defaultRpcs: ["https://arb1.arbitrum.io/rpc"],
    env: "RPC_ARBITRUM_URL",
  },
  optimism: {
    chainId: 10,
    defaultRpcs: ["https://mainnet.optimism.io"],
    env: "RPC_OPTIMISM_URL",
  },
  polygon: {
    chainId: 137,
    defaultRpcs: ["https://polygon-rpc.com"],
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

function chainFromQuestion(value) {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (/\b(?:ethereum|eth|mainnet)\b/.test(text)) return "ethereum";
  if (/\b(?:arbitrum|arb)\b/.test(text)) return "arbitrum";
  if (/\b(?:optimism|op mainnet)\b/.test(text)) return "optimism";
  if (/\bpolygon\b/.test(text)) return "polygon";
  if (/\bbase\b/.test(text)) return "base";
  return "";
}

function hashFromQuestion(value) {
  return typeof value === "string" ? value.match(/0x[0-9a-fA-F]{64}/)?.[0] ?? "" : "";
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

function units(value, decimals = 18) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function celsiusToFahrenheit(value) {
  return Math.round((value * 9 / 5 + 32) * 10) / 10;
}

function weatherCondition(code) {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Unknown conditions";
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

function inferredForecastDays(value) {
  if (typeof value !== "string") return null;
  const explicit = value.match(/\b(?:next|for|over)?\s*([1-7])\s*days?\b/i)?.[1];
  if (explicit) return Number(explicit);
  if (/\b(?:week|7-day|seven days)\b/i.test(value)) return 7;
  if (/\b(?:tomorrow|today|24 hours?)\b/i.test(value)) return 1;
  return null;
}

function placeFromQuestion(value) {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact || compact.length > 200 || /[\u0000-\u001F\u007F]/.test(compact)) return null;
  const match = compact.match(/\b(?:in|for|at)\s+([\p{L}][\p{L} .'-]{0,80}?)(?=\s+(?:today|tomorrow|this|next|on|over|during|for\s+\d)|[?.!,]|$)/iu);
  return match?.[1]?.trim() || compact;
}

function newsQuery(value) {
  if (typeof value !== "string") return null;
  const query = value.trim().replace(/\s+/g, " ");
  return query.length > 0 && query.length <= MAX_NEWS_QUERY_LENGTH && !/[\u0000-\u001F\u007F]/.test(query) ? query : null;
}

function newsResults(value) {
  if (value === null || value === undefined || value === "") return 5;
  if (typeof value !== "string" || !/^\d{1,2}$/.test(value.trim())) return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MAX_NEWS_RESULTS ? count : null;
}

function oneOf(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? null;
}

function shortCode(value, fallback, length) {
  if (value === null || value === undefined || value === "") return fallback;
  const code = String(value).trim();
  return new RegExp(`^[A-Za-z]{2,${length}}$`).test(code) ? code : null;
}

function recentDays(value) {
  if (value === null || value === undefined || value === "") return null;
  return /^\d{1,2}$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 30 ? Number(value) : null;
}

function excludedDomains(value) {
  if (value === null || value === undefined || value === "") return [];
  const domains = String(value).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return domains.length <= 10 && domains.every((domain) => /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) ? domains : null;
}

function newsDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : false;
}

function newsCategory(value) {
  if (value === null || value === undefined || value === "") return null;
  const category = String(value).trim().replace(/\s+/g, " ");
  return category.length <= 40 && /^[A-Za-z0-9 &-]+$/.test(category) ? category : false;
}

function xmlText(value) {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function xmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? xmlText(match[1]) : "";
}

function plainText(value) {
  return xmlText(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function rpcUrls(chain) {
  const configured = chain.envList ? process.env[chain.envList]?.split(",").map((value) => value.trim()).filter(Boolean) : [];
  const legacy = process.env[chain.env]?.trim();
  return [...new Set([...(configured ?? []), ...(legacy ? [legacy] : []), ...chain.defaultRpcs])]
    .filter((value) => { try { return new URL(value).protocol === "https:"; } catch { return false; } });
}

async function rpc(url, method, params, fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
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

async function resolveLocation(input, fetcher = fetch) {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 100 || /[\u0000-\u001F\u007F]/.test(name)) return null;
  const url = new URL(GEOCODING_API_URL);
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const body = await fetchWeather(url, fetcher);
  const match = body?.results?.[0];
  if (!match || !Number.isFinite(match.latitude) || !Number.isFinite(match.longitude)) return null;
  return {
    name: String(match.name ?? name).slice(0, 100),
    country: String(match.country ?? "").slice(0, 100),
    latitude: match.latitude,
    longitude: match.longitude,
    timezone: String(match.timezone ?? "UTC").slice(0, 100),
  };
}

async function weatherLocation(input, fetcher) {
  const latitude = coordinate(input.latitude, -90, 90);
  const longitude = coordinate(input.longitude, -180, 180);
  if (latitude !== null && longitude !== null) {
    return { latitude, longitude, name: null, country: null, timezone: "auto" };
  }
  const explicit = oneOf(input.location, input.q, input.query);
  return resolveLocation(explicit ?? placeFromQuestion(input.question), fetcher);
}

async function fetchNews(url, fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/rss+xml, application/xml;q=0.9" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`NEWS_HTTP_${response.status}`);
    const length = Number(response.headers?.get?.("content-length") ?? 0);
    if (Number.isFinite(length) && length > 1_000_000) throw new Error("NEWS_RESPONSE_TOO_LARGE");
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupWeather(input, fetcher = fetch) {
  const location = await weatherLocation(input, fetcher);
  if (!location) {
    return {
      error: "INVALID_COORDINATES",
      message: "latitude must be between -90 and 90 and longitude must be between -180 and 180.",
    };
  }
  const { latitude, longitude } = location;

  const url = new URL(WEATHER_API_URL);
  url.searchParams.set("latitude", canonicalCoordinate(latitude));
  url.searchParams.set("longitude", canonicalCoordinate(longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,precipitation,weather_code,pressure_msl,wind_speed_10m",
  );
  url.searchParams.set("timezone", "UTC");
  const body = await fetchWeather(url, fetcher);
  const current = body?.current;
  const required = [
    "time",
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "dew_point_2m",
    "precipitation",
    "weather_code",
    "pressure_msl",
    "wind_speed_10m",
  ];
  if (!current || required.some((field) => typeof current[field] !== "number" && typeof current[field] !== "string")) {
    throw new Error("WEATHER_MALFORMED_RESPONSE");
  }

  const lat = canonicalCoordinate(latitude);
  const lon = canonicalCoordinate(longitude);
  const condition = weatherCondition(current.weather_code);
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
    apparent_temperature_f: celsiusToFahrenheit(current.apparent_temperature),
    temperature_f: celsiusToFahrenheit(current.temperature_2m),
    dew_point_c: current.dew_point_2m,
    dew_point_f: celsiusToFahrenheit(current.dew_point_2m),
    precipitation_mm: current.precipitation,
    weather_code: current.weather_code,
    condition,
    pressure_hpa: current.pressure_msl,
    wind_speed_kmh: current.wind_speed_10m,
    location: location.name ? { name: location.name, country: location.country } : null,
    source: "Open-Meteo",
    confidence: 1,
    canonical,
    answer: `${location.name ? `${location.name}${location.country ? `, ${location.country}` : ""}: ` : `${lat}, ${lon}: `}${condition}; ${current.temperature_2m} C (${celsiusToFahrenheit(current.temperature_2m)} F), feels like ${current.apparent_temperature} C, humidity ${current.relative_humidity_2m}%, pressure ${current.pressure_msl} hPa, precipitation ${current.precipitation} mm, wind ${current.wind_speed_10m} km/h at ${current.time} UTC.`,
    summary: `Open-Meteo current conditions for ${location.name ? `${location.name}${location.country ? `, ${location.country}` : ""}` : `${lat}, ${lon}`}.`,
  };
}

export async function lookupForecast(input, fetcher = fetch) {
  const location = await weatherLocation(input, fetcher);
  const requestedDays = oneOf(input.forecast_days, input.days);
  const days = forecastDays(requestedDays ?? String(inferredForecastDays(input.question) ?? 3));
  if (!location || days === null) {
    return {
      error: "INVALID_FORECAST_REQUEST",
      message: "latitude and longitude must be valid coordinates; forecast_days must be an integer from 1 to 7.",
    };
  }
  const { latitude, longitude } = location;

  const url = new URL(WEATHER_API_URL);
  url.searchParams.set("latitude", canonicalCoordinate(latitude));
  url.searchParams.set("longitude", canonicalCoordinate(longitude));
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max");
  url.searchParams.set("hourly", "temperature_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("forecast_days", String(days));
  url.searchParams.set("timezone", location.timezone || "auto");
  const body = await fetchWeather(url, fetcher);
  const daily = body?.daily;
  const fields = ["time", "weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "wind_speed_10m_max"];
  if (!daily || fields.some((field) => !Array.isArray(daily[field]) || daily[field].length !== days)) {
    throw new Error("FORECAST_MALFORMED_RESPONSE");
  }
  const hourly = body?.hourly;
  const hourlyFields = ["time", "temperature_2m", "dew_point_2m", "precipitation_probability", "precipitation", "weather_code", "wind_speed_10m"];
  if (!hourly || hourlyFields.some((field) => !Array.isArray(hourly[field])) || hourlyFields.some((field) => hourly[field].length !== hourly.time.length)) {
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
  const hourlyPayload = hourly.time.map((time, index) => ({
    time,
    temperature_c: hourly.temperature_2m[index],
    dew_point_c: hourly.dew_point_2m[index],
    precipitation_probability_percent: hourly.precipitation_probability[index],
    precipitation_mm: hourly.precipitation[index],
    weather_code: hourly.weather_code[index],
    condition: weatherCondition(hourly.weather_code[index]),
    wind_speed_kmh: hourly.wind_speed_10m[index],
  }));
  if (hourlyPayload.some((entry) => typeof entry.time !== "string" || Object.values(entry).some((value) => value === null || value === undefined))) {
    throw new Error("FORECAST_MALFORMED_RESPONSE");
  }
  const canonical = [lat, lon, days, ...daysPayload.map((day) => [day.date, day.weather_code, day.temperature_max_c, day.temperature_min_c, day.precipitation_probability_max_percent, day.wind_speed_max_kmh].join(","))].join("|");
  return {
    latitude: lat,
    longitude: lon,
    forecast_days: days,
    location: { name: location.name, country: location.country, latitude: lat, longitude: lon },
    timezone: String(body.timezone ?? location.timezone ?? "UTC"),
    days: daysPayload,
    hourly: hourlyPayload,
    coverage: { days, hourly_points: hourlyPayload.length, starts_at: hourlyPayload[0]?.time ?? null, ends_at: hourlyPayload.at(-1)?.time ?? null },
    source: "Open-Meteo",
    confidence: 1,
    canonical,
    answer: `${location.name ? `${location.name}${location.country ? `, ${location.country}` : ""}: ` : `${lat}, ${lon}: `}${daysPayload.map((day) => `${day.date} ${weatherCondition(day.weather_code)}, low ${day.temperature_min_c} C, high ${day.temperature_max_c} C, precipitation ${day.precipitation_probability_max_percent}%, wind ${day.wind_speed_max_kmh} km/h`).join("; ")}`,
    summary: `${days}-day daily and ${hourlyPayload.length}-point hourly Open-Meteo forecast for ${location.name ? `${location.name}${location.country ? `, ${location.country}` : ""}` : `${lat}, ${lon}`}.`,
  };
}

export async function lookupNews(input, fetcher = fetch) {
  const queryInput = oneOf(input.q, input.query, input.question);
  const maxResultsInput = oneOf(input.max_results, input.max);
  const query = newsQuery(queryInput);
  const maxResults = newsResults(maxResultsInput);
  const country = shortCode(input.country, "US", 2);
  const language = shortCode(input.language ?? input.lang, "en", 3);
  const ageDays = recentDays(input.recent_days);
  const excluded = excludedDomains(input.exclude_domains);
  const from = newsDate(input.from);
  const to = newsDate(input.to);
  const category = newsCategory(input.category);
  if (!query || maxResults === null || !country || !language || excluded === null || from === false || to === false || category === false || (input.recent_days && ageDays === null)) {
    return { error: "INVALID_NEWS_QUERY", message: "Use a printable query, max 1-10, ISO country/language codes, recent_days 1-30, and up to 10 comma-separated domains." };
  }
  const effectiveQuery = [query, category, ...(ageDays ? [`when:${ageDays}d`] : []), ...(from ? [`after:${from}`] : []), ...(to ? [`before:${to}`] : []), ...excluded.map((domain) => `-site:${domain}`)].filter(Boolean).join(" ");
  const cacheKey = `${effectiveQuery.toLowerCase()}|${maxResults}|${country}|${language}`;
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < NEWS_CACHE_TTL_MS) return cached.value;

  const url = new URL(GOOGLE_NEWS_RSS_URL);
  url.searchParams.set("q", effectiveQuery);
  url.searchParams.set("hl", `${language}-${country}`);
  url.searchParams.set("gl", country.toUpperCase());
  url.searchParams.set("ceid", `${country.toUpperCase()}:${language.toLowerCase()}`);
  let xml;
  try {
    xml = await fetchNews(url, fetcher);
  } catch (error) {
    if (cached && Date.now() - cached.createdAt < NEWS_STALE_TTL_MS) {
      return { ...cached.value, stale: true, confidence: 0.7, summary: `${cached.value.summary} Cached results served because Google News was temporarily unavailable.` };
    }
    throw error;
  }
  if (xml.length > 1_000_000) throw new Error("NEWS_RESPONSE_TOO_LARGE");
  const articles = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    if (articles.length >= maxResults) break;
    const title = xmlTag(match[1], "title");
    const articleUrl = xmlTag(match[1], "link");
    const publishedAt = xmlTag(match[1], "pubDate");
    const source = xmlTag(match[1], "source");
    const description = plainText(xmlTag(match[1], "description")).slice(0, 600);
    let parsedUrl;
    try { parsedUrl = new URL(articleUrl); } catch { continue; }
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "news.google.com" || !title || !publishedAt || !source) continue;
    articles.push({ title: title.slice(0, 300), url: parsedUrl.toString(), published_at: publishedAt, source: source.slice(0, 160), description });
  }
  const top = articles[0] ?? null;
  const readings = articles.map((article, index) => `${index + 1}. ${article.title} — ${article.source} (${article.published_at})`).join("; ");
  const answer = top
    ? `${top.title} — ${top.source} (${top.published_at}).${readings ? ` Readings: ${readings}` : ""}`
    : `No matching current news was found for ${query}.`;
  const value = {
    query,
    effective_query: effectiveQuery,
    filters: { country: country.toUpperCase(), language: language.toLowerCase(), category, recent_days: ageDays, from, to, excluded_domains: excluded },
    articles,
    headline: top?.title ?? null,
    source: top?.source ?? null,
    published_at: top?.published_at ?? null,
    url: top?.url ?? null,
    result_count: articles.length,
    as_of: new Date().toISOString(),
    source_feed: "Google News RSS",
    confidence: top ? 0.96 : 0.2,
    canonical: [query.toLowerCase(), ...articles.map((article) => `${article.source}|${article.published_at}|${article.title}`)].join("|"),
    answer,
    summary: answer,
  };
  if (newsCache.size >= NEWS_CACHE_LIMIT) newsCache.delete(newsCache.keys().next().value);
  newsCache.set(cacheKey, { createdAt: Date.now(), value });
  return value;
}

export async function lookupTransaction({ chain: chainInput, tx_hash: hashInput, hash, txHash: camelHash, query, question }, fetcher = fetch, urlsOverride = null) {
  const naturalLanguage = oneOf(question, query);
  const chainName = normaliseChain(chainInput) || chainFromQuestion(naturalLanguage) || "base";
  const txHash = normaliseHash(oneOf(hashInput, hash, camelHash, hashFromQuestion(naturalLanguage)));
  const chain = CHAINS[chainName];

  if (!chain) {
    return { error: "UNSUPPORTED_CHAIN", message: "Use ethereum, base, arbitrum, optimism, or polygon." };
  }
  if (!isTransactionHash(txHash)) {
    return { error: "INVALID_TX_HASH", message: "tx_hash must be a 0x-prefixed 32-byte transaction hash." };
  }

  const urls = urlsOverride ?? rpcUrls(chain);
  let transaction = null;
  let selectedUrl = null;
  let successfulProviders = 0;
  let lastError = null;
  for (const url of urls) {
    try {
      const candidate = await rpc(url, "eth_getTransactionByHash", [txHash], fetcher);
      successfulProviders += 1;
      if (candidate) {
        transaction = candidate;
        selectedUrl = url;
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!transaction) {
    if (successfulProviders === 0) throw lastError ?? new Error("RPC_UNAVAILABLE");
    return {
      chain: chainName,
      chain_id: chain.chainId,
      tx_hash: txHash,
      status: "not_found",
      confidence: successfulProviders >= 2 ? 0.85 : 0.5,
      providers_checked: successfulProviders,
      canonical: `${chainName}|${txHash}|not_found|-|-|-|-`,
      answer: `No transaction was found for ${txHash} on ${chainName} after checking ${successfulProviders} RPC provider${successfulProviders === 1 ? "" : "s"}.`,
      summary: "Not-found responses are reported with reduced confidence because public RPC history can be incomplete.",
    };
  }

  let receipt = null;
  for (const url of [selectedUrl, ...urls.filter((candidate) => candidate !== selectedUrl)]) {
    try {
      receipt = await rpc(url, "eth_getTransactionReceipt", [txHash], fetcher);
      if (receipt) break;
    } catch { /* a transaction-only result remains useful but cannot prove execution */ }
  }

  const blockNumber = receipt?.blockNumber ?? transaction.blockNumber;
  const isPending = !blockNumber;
  const status = isPending
    ? "pending"
    : !receipt
      ? "confirmed_unknown"
      : receipt.status === "0x0"
      ? "confirmed_reverted"
      : "confirmed_success";
  const block = isPending ? "-" : hexToDecimal(blockNumber) ?? "-";
  const from = canonicalAddress(transaction.from);
  const to = canonicalAddress(transaction.to);
  const valueWei = hexToDecimal(transaction.value) ?? "-";
  const valueEth = units(valueWei);
  const input = typeof transaction.input === "string" ? transaction.input.toLowerCase() : "0x";
  const methodSelector = /^0x[0-9a-f]{8}/.test(input) ? input.slice(0, 10) : null;
  const transactionType = input === "0x" || input === "0x0" ? "native_transfer" : "contract_call";
  const gasLimit = hexToDecimal(transaction.gas);
  const gasPriceWei = hexToDecimal(receipt?.effectiveGasPrice ?? transaction.gasPrice);
  const gasUsed = hexToDecimal(receipt?.gasUsed);
  const feeWei = gasPriceWei && gasUsed ? (BigInt(gasPriceWei) * BigInt(gasUsed)).toString() : null;
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
    value_eth: valueEth,
    method_selector: methodSelector,
    transaction_type: transactionType,
    gas_limit: gasLimit,
    gas_used: gasUsed,
    gas_price_wei: gasPriceWei,
    transaction_fee_wei: feeWei,
    transaction_fee_eth: feeWei ? units(feeWei) : null,
    log_count: Array.isArray(receipt?.logs) ? receipt.logs.length : null,
    providers_checked: successfulProviders,
    confidence: receipt || isPending ? 1 : 0.8,
    canonical,
    answer: `${status.replaceAll("_", " ")}; ${valueEth ?? valueWei} ETH transferred on ${chainName} in transaction ${txHash}, block ${block}, from ${from} to ${to}${methodSelector ? `, method selector ${methodSelector}` : ""}${feeWei ? `, transaction fee ${units(feeWei)} ETH (${feeWei} wei)` : ""}.`,
    summary: `Verified using an archive-capable ${chainName} RPC with fallback support.`,
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
        intents: ["ONCHAIN_TX_LOOKUP", "WEATHER_CHECK", "WEATHER_FORECAST", "NEWS_SEARCH"],
        revision: REVISION,
      });
    }
    if (url.pathname === "/v1/weather") {
      try {
        const result = await lookupWeather({
          latitude: url.searchParams.get("latitude"),
          longitude: url.searchParams.get("longitude"),
          location: oneOf(url.searchParams.get("location"), url.searchParams.get("q"), url.searchParams.get("query")),
          question: url.searchParams.get("question"),
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
          location: oneOf(url.searchParams.get("location"), url.searchParams.get("q"), url.searchParams.get("query")),
          forecast_days: oneOf(url.searchParams.get("forecast_days"), url.searchParams.get("days")),
          question: url.searchParams.get("question"),
        });
        return json(response, result.error ? 400 : 200, result);
      } catch (error) {
        console.error("forecast_lookup_failed", { message: error instanceof Error ? error.message : "unknown" });
        return json(response, 502, { error: "UPSTREAM_UNAVAILABLE", message: "Forecast data could not be queried." });
      }
    }
    if (url.pathname === "/v1/news") {
      try {
        const result = await lookupNews({
          q: oneOf(url.searchParams.get("q"), url.searchParams.get("query")),
          question: url.searchParams.get("question"),
          max_results: oneOf(url.searchParams.get("max_results"), url.searchParams.get("max")),
          recent_days: url.searchParams.get("recent_days"),
          exclude_domains: url.searchParams.get("exclude_domains"),
          country: url.searchParams.get("country"),
          language: oneOf(url.searchParams.get("language"), url.searchParams.get("lang")),
          category: url.searchParams.get("category"),
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
        });
        return json(response, result.error ? 400 : 200, result);
      } catch (error) {
        console.error("news_lookup_failed", { message: error instanceof Error ? error.message : "unknown" });
        return json(response, 502, { error: "UPSTREAM_UNAVAILABLE", message: "News data could not be queried." });
      }
    }
    if (url.pathname !== "/v1/lookup") return json(response, 404, { error: "NOT_FOUND" });

    try {
      const result = await lookupTransaction({
        chain: url.searchParams.get("chain"),
        tx_hash: url.searchParams.get("tx_hash"),
        hash: url.searchParams.get("hash"),
        txHash: url.searchParams.get("txHash"),
        query: url.searchParams.get("query"),
        question: url.searchParams.get("question"),
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
