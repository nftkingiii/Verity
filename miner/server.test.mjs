import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "./server.mjs";

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

test("health endpoint identifies the correct canonical intent", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal((await response.json()).intent, "ONCHAIN_TX_LOOKUP");
  });
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
