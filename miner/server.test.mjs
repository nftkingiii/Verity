import test from "node:test";
import assert from "node:assert/strict";
import { createServer, lookupForecast, lookupNews, lookupTransaction, lookupWeather } from "./server.mjs";

const HASH = `0x${"a".repeat(64)}`;

async function withServer(run) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint identifies Verity's supported canonical intents", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    const body = await response.json();
    assert.deepEqual(body.intents, ["ONCHAIN_TX_LOOKUP", "WEATHER_CHECK", "WEATHER_FORECAST", "NEWS_SEARCH"]);
    assert.equal(body.revision, "unknown");
  });
});

test("weather lookup rejects invalid coordinates before the upstream request", async () => {
  let called = false;
  const result = await lookupWeather(
    { latitude: "91", longitude: "0" },
    async () => {
      called = true;
      throw new Error("must not fetch");
    },
  );
  assert.equal(result.error, "INVALID_COORDINATES");
  assert.equal(called, false);
});

test("weather lookup returns a stable canonical current-conditions payload", async () => {
  const response = await lookupWeather(
    { latitude: "6.5244", longitude: "3.3792" },
    async (url) => {
      assert.equal(url.origin, "https://api.open-meteo.com");
      assert.equal(url.pathname, "/v1/forecast");
      return {
        ok: true,
        json: async () => ({
          current: {
            time: "2026-08-14T08:00",
            temperature_2m: 27.5,
            relative_humidity_2m: 81,
            apparent_temperature: 31.2,
            precipitation: 0,
            weather_code: 2,
            wind_speed_10m: 14.1,
            dew_point_2m: 23.8,
            pressure_msl: 1012.4,
          },
        }),
      };
    },
  );
  assert.equal(response.canonical, "6.5244|3.3792|2026-08-14T08:00|27.5|81|31.2|0|2|14.1");
  assert.equal(response.confidence, 1);
  assert.equal(response.condition, "Partly cloudy");
  assert.equal(response.temperature_f, 81.5);
  assert.match(response.answer, /Partly cloudy/);
});

test("transaction lookup falls back when one RPC returns a false null", async () => {
  const calls = [];
  const result = await lookupTransaction(
    { chain: "ethereum", tx_hash: HASH },
    async (url, options) => {
      const request = JSON.parse(options.body);
      calls.push(`${url}:${request.method}`);
      if (url === "https://first.invalid") {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: null }) };
      }
      if (request.method === "eth_getTransactionByHash") {
        return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: {
          hash: HASH, blockNumber: "0x10", from: `0x${"1".repeat(40)}`, to: `0x${"2".repeat(40)}`,
          value: "0xde0b6b3a7640000", input: "0xa9059cbb00", gas: "0x5208", gasPrice: "0x3b9aca00",
        } }) };
      }
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: {
        blockNumber: "0x10", status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", logs: [],
      } }) };
    },
    ["https://first.invalid", "https://second.invalid"],
  );
  assert.deepEqual(calls.slice(0, 2), [
    "https://first.invalid:eth_getTransactionByHash",
    "https://second.invalid:eth_getTransactionByHash",
  ]);
  assert.equal(result.status, "confirmed_success");
  assert.equal(result.value_eth, "1");
  assert.equal(result.method_selector, "0xa9059cbb");
  assert.equal(result.transaction_type, "contract_call");
  assert.match(result.answer, /1 ETH/);
});

test("transaction lookup extracts a hash and chain from a natural-language question", async () => {
  const result = await lookupTransaction(
    { question: `Was Ethereum transaction ${HASH} successful?` },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: request.method === "eth_getTransactionByHash" ? {
        hash: HASH, blockNumber: "0x10", from: `0x${"1".repeat(40)}`, to: `0x${"2".repeat(40)}`,
        value: "0x0", input: "0x", gas: "0x5208", gasPrice: "0x3b9aca00",
      } : { blockNumber: "0x10", status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x3b9aca00", logs: [] } }) };
    },
    ["https://rpc.invalid"],
  );
  assert.equal(result.chain, "ethereum");
  assert.equal(result.tx_hash, HASH);
  assert.match(result.answer, /^confirmed success;/);
});

test("forecast rejects an excessive horizon before the upstream request", async () => {
  let called = false;
  const result = await lookupForecast(
    { latitude: "6.5244", longitude: "3.3792", forecast_days: "8" },
    async () => { called = true; throw new Error("must not fetch"); },
  );
  assert.equal(result.error, "INVALID_FORECAST_REQUEST");
  assert.equal(called, false);
});

test("forecast returns a stable canonical daily payload", async () => {
  const result = await lookupForecast(
    { latitude: "6.5244", longitude: "3.3792", forecast_days: "2" },
    async (url) => {
      assert.equal(url.origin, "https://api.open-meteo.com");
      assert.equal(url.searchParams.get("forecast_days"), "2");
      return { ok: true, json: async () => ({ timezone: "UTC", daily: {
        time: ["2026-08-17", "2026-08-18"], weather_code: [2, 3], temperature_2m_max: [29.5, 30.1],
        temperature_2m_min: [24.2, 24.7], precipitation_probability_max: [15, 40], wind_speed_10m_max: [18.5, 20.2],
      }, hourly: {
        time: ["2026-08-17T00:00", "2026-08-17T01:00"], temperature_2m: [25, 25.2], dew_point_2m: [23, 23.1],
        precipitation_probability: [10, 12], precipitation: [0, 0], weather_code: [2, 2], wind_speed_10m: [8, 8.2],
      } }) };
    },
  );
  assert.equal(result.canonical, "6.5244|3.3792|2|2026-08-17,2,29.5,24.2,15,18.5|2026-08-18,3,30.1,24.7,40,20.2");
  assert.equal(result.days.length, 2);
  assert.equal(result.hourly.length, 2);
  assert.match(result.answer, /2026-08-17/);
  assert.doesNotMatch(result.answer, /Hourly:/);
});

test("forecast resolves a place name and requests hourly coverage", async () => {
  const result = await lookupForecast(
    { location: "Tokyo", forecast_days: "1" },
    async (url) => {
      if (url.hostname === "geocoding-api.open-meteo.com") {
        return { ok: true, json: async () => ({ results: [{ name: "Tokyo", country: "Japan", latitude: 35.6762, longitude: 139.6503, timezone: "Asia/Tokyo" }] }) };
      }
      assert.match(url.searchParams.get("hourly"), /dew_point_2m/);
      return { ok: true, json: async () => ({ timezone: "Asia/Tokyo", daily: {
        time: ["2026-08-25"], weather_code: [1], temperature_2m_max: [31], temperature_2m_min: [24],
        precipitation_probability_max: [20], wind_speed_10m_max: [16],
      }, hourly: {
        time: ["2026-08-25T00:00"], temperature_2m: [25], dew_point_2m: [20], precipitation_probability: [5],
        precipitation: [0], weather_code: [1], wind_speed_10m: [7],
      } }) };
    },
  );
  assert.equal(result.location.name, "Tokyo");
  assert.equal(result.timezone, "Asia/Tokyo");
});

test("forecast extracts place and horizon from a natural-language question", async () => {
  const result = await lookupForecast(
    { question: "What is the weather forecast for Tokyo tomorrow?" },
    async (url) => {
      if (url.hostname === "geocoding-api.open-meteo.com") {
        assert.equal(url.searchParams.get("name"), "Tokyo");
        return { ok: true, json: async () => ({ results: [{ name: "Tokyo", country: "Japan", latitude: 35.6762, longitude: 139.6503, timezone: "Asia/Tokyo" }] }) };
      }
      assert.equal(url.searchParams.get("forecast_days"), "1");
      return { ok: true, json: async () => ({ timezone: "Asia/Tokyo", daily: {
        time: ["2026-08-31"], weather_code: [2], temperature_2m_max: [30], temperature_2m_min: [23],
        precipitation_probability_max: [25], wind_speed_10m_max: [14],
      }, hourly: { time: ["2026-08-31T00:00"], temperature_2m: [24], dew_point_2m: [20], precipitation_probability: [10], precipitation: [0], weather_code: [2], wind_speed_10m: [7] } }) };
    },
  );
  assert.equal(result.forecast_days, 1);
  assert.match(result.answer, /^Tokyo, Japan:/);
});

test("news search rejects invalid input before the upstream request", async () => {
  let called = false;
  const result = await lookupNews({ q: "", max_results: "11" }, async () => { called = true; throw new Error("must not fetch"); });
  assert.equal(result.error, "INVALID_NEWS_QUERY");
  assert.equal(called, false);
});

test("news search normalizes the fixed Google News RSS response", async () => {
  const result = await lookupNews(
    { q: "OpenAI", max_results: "2" },
    async (url) => {
      assert.equal(url.origin, "https://news.google.com");
      assert.equal(url.searchParams.get("q"), "OpenAI");
      return { ok: true, headers: new Headers(), text: async () => `<?xml version="1.0"?><rss><channel><item><title><![CDATA[OpenAI update]]></title><link>https://news.google.com/rss/articles/one</link><pubDate>Sat, 16 Aug 2026 10:00:00 GMT</pubDate><description><![CDATA[OpenAI shipped a major model update.]]></description><source url="https://example.com">Example News</source></item><item><title>Second &amp; story</title><link>https://news.google.com/rss/articles/two</link><pubDate>Sat, 16 Aug 2026 09:00:00 GMT</pubDate><source>Second Source</source></item></channel></rss>` };
    },
  );
  assert.equal(result.articles.length, 2);
  assert.equal(result.articles[1].title, "Second & story");
  assert.equal(result.articles[0].description, "OpenAI shipped a major model update.");
  assert.equal(result.headline, "OpenAI update");
  assert.match(result.answer, /^OpenAI update/);
  assert.equal(result.summary, result.answer);
  assert.equal(result.canonical, "openai|Example News|Sat, 16 Aug 2026 10:00:00 GMT|OpenAI update|Second Source|Sat, 16 Aug 2026 09:00:00 GMT|Second & story");
});

test("news search applies recency and excluded-domain filters", async () => {
  const result = await lookupNews(
    { query: "US technology", max: "5", recent_days: "3", exclude_domains: "techcrunch.com,theverge.com", country: "US", language: "en", category: "artificial intelligence", from: "2026-08-20" },
    async (url) => {
      assert.match(url.searchParams.get("q"), /when:3d/);
      assert.match(url.searchParams.get("q"), /-site:techcrunch\.com/);
      assert.match(url.searchParams.get("q"), /artificial intelligence/);
      assert.match(url.searchParams.get("q"), /after:2026-08-20/);
      assert.equal(url.searchParams.get("gl"), "US");
      return { ok: true, headers: new Headers(), text: async () => "<rss><channel></channel></rss>" };
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.filters.recent_days, 3);
});

test("news search serves bounded stale results during an upstream outage", async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const request = { q: "unique stale cache fixture", max_results: "1" };
    await lookupNews(request, async () => ({ ok: true, headers: new Headers(), text: async () => `
      <rss><channel><item><title>Cached result</title><link>https://news.google.com/rss/articles/cached</link>
      <pubDate>Mon, 24 Aug 2026 10:00:00 GMT</pubDate><description>Still useful</description><source>Fixture News</source></item></channel></rss>` }));
    now += 31_000;
    const result = await lookupNews(request, async () => { throw new Error("temporary outage"); });
    assert.equal(result.stale, true);
    assert.equal(result.confidence, 0.7);
    assert.equal(result.articles[0].title, "Cached result");
  } finally {
    Date.now = originalNow;
  }
});

test("lookup rejects unsupported chains without calling an upstream", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/lookup?chain=bitcoin&tx_hash=${HASH}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "UNSUPPORTED_CHAIN");
  });
});

test("lookup rejects malformed transaction hashes", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/lookup?chain=base&tx_hash=0x1234`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "INVALID_TX_HASH");
  });
});
