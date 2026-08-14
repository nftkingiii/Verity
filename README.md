# Verity

Verity is a deterministic `ONCHAIN_TX_LOOKUP` Miner and paired WebAssembly scoring module for Telegraph.

**Live Miner:** https://verity-production-fcf5.up.railway.app/health
**Scoring module:** https://github.com/nftkingiii/Verity/releases/download/v0.1.2/verity_scorer.wasm

It accepts an EVM chain plus transaction hash, fetches the transaction and receipt from a fixed allowlist of RPC providers, and returns a compact canonical payload:

```text
chain|tx_hash|status|block_number|from|to|value_wei
```

The miner never accepts an RPC URL from callers, preventing the service from becoming an SSRF proxy. It validates chain names and transaction-hash format before any upstream request.

## Miner

```bash
cp .env.example .env
npm test
npm start
curl "http://localhost:8080/health"
```

For production, configure dedicated RPC URLs in the environment. Public defaults are suitable only for local proving; leaderboard reliability needs provider-backed endpoints and monitoring.

## Telegraph configuration

`verity-miner.yaml` uses the exact uppercase canonical intent required by Telegraph:

```yaml
supported_intents:
  - ONCHAIN_TX_LOOKUP
```

Before dashboard registration, confirm:

- `id: 9001` if the dashboard reports it as unavailable;

Upload exactly the bytes you hash. The dashboard sandbox-tests the endpoint, pins the YAML, and registers the Miner. Do not put a private key, provider secret, or raw API key in the YAML.

## Scoring module

The scorer implements Telegraph's required WASM exports: `alloc`, `dealloc`, `rank_answer`, and `breakdown_answer`. It is intentionally stateless and has no network/filesystem capability.

```bash
cd scorer
rustup target add wasm32-unknown-unknown
cargo test
cargo build --release --target wasm32-unknown-unknown
```

Register the resulting `scorer/target/wasm32-unknown-unknown/release/verity_scorer.wasm` through the integration dashboard after hosting it at a durable public URL.

The verified v0.1.2 scorer binary is already available from the GitHub Release linked above.

## Status

The implementation follows the public Miner YAML and WASM ABI documentation checked on 2026-08-14. It still requires live dashboard sandbox validation, a production deployment, actual Miner registration, and an end-to-end Telegraph request before any live-performance claim.
