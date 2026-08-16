import test from "node:test";
import assert from "node:assert/strict";
import { createServer, lookupForecast, lookupNews, lookupWeather } from "./server.mjs";

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
          },
        }),
      };
    },
  );
  assert.equal(response.canonical, "6.5244|3.3792|2026-08-14T08:00|27.5|81|31.2|0|2|14.1");
  assert.equal(response.confidence, 1);
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
      return { ok: true, json: async () => ({ daily: {
        time: ["2026-08-17", "2026-08-18"], weather_code: [2, 3],
        temperature_2m_max: [29.5, 30.1], temperature_2m_min: [24.2, 24.7],
        precipitation_probability_max: [15, 40], wind_speed_10m_max: [18.5, 20.2],
      } }) };
    },
  );
  assert.equal(result.canonical, "6.5244|3.3792|2|2026-08-17,2,29.5,24.2,15,18.5|2026-08-18,3,30.1,24.7,40,20.2");
  assert.equal(result.days.length, 2);
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
      return { ok: true, headers: new Headers(), text: async () => `<?xml version="1.0"?><rss><channel><item><title><![CDATA[OpenAI update]]></title><link>https://news.google.com/rss/articles/one</link><pubDate>Sat, 16 Aug 2026 10:00:00 GMT</pubDate><source url="https://example.com">Example News</source></item><item><title>Second &amp; story</title><link>https://news.google.com/rss/articles/two</link><pubDate>Sat, 16 Aug 2026 09:00:00 GMT</pubDate><source>Second Source</source></item></channel></rss>` };
    },
  );
  assert.equal(result.articles.length, 2);
  assert.equal(result.articles[1].title, "Second & story");
  assert.equal(result.canonical, "openai|Example News|Sat, 16 Aug 2026 10:00:00 GMT|OpenAI update|Second Source|Sat, 16 Aug 2026 09:00:00 GMT|Second & story");
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
