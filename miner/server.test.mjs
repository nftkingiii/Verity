import test from "node:test";
import assert from "node:assert/strict";
import { createServer, lookupWeather } from "./server.mjs";

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
    assert.deepEqual(body.intents, ["ONCHAIN_TX_LOOKUP", "WEATHER_CHECK"]);
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
