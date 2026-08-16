# Verity

Verity is a deterministic `ONCHAIN_TX_LOOKUP` Miner, `WEATHER_CHECK` Miner, `WEATHER_FORECAST` Miner, `NEWS_SEARCH` Miner, and paired WebAssembly scoring module for Telegraph.

**Live Miner:** https://verity-production-fcf5.up.railway.app/health
**Scoring module:** https://github.com/nftkingiii/Verity/releases/download/v0.1.3/verity_scorer.wasm

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

### Weather miner

`GET /v1/weather?latitude=6.5244&longitude=3.3792` validates bounded coordinates and queries only the fixed Open-Meteo HTTPS host. It returns timestamped current conditions and a canonical payload. The configuration is in `verity-weather-miner.yaml`; it is built and tested locally but deliberately not registered until the evaluator's replacement status is confirmed.

### Weather Forecast miner

`GET /v1/forecast?latitude=6.5244&longitude=3.3792&forecast_days=3` returns one to seven UTC daily forecasts and a canonical payload. It uses the same fixed Open-Meteo host, strictly bounds coordinates and horizon, and never accepts a caller-supplied URL. Its standalone Telegraph configuration is `verity-weather-forecast-miner.yaml`.

### News Search miner

`GET /v1/news?q=central+bank+interest+rates&max_results=5` queries a fixed Google News RSS host and returns up to ten normalized articles with source and publication-time provenance. It does not fetch returned article URLs. The standalone Telegraph configuration is `verity-news-search-miner.yaml`.

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

The scorer implements Telegraph's required WASM exports: `alloc`, `dealloc`, and `rank_answer`. It is intentionally stateless and has no network/filesystem capability.

```bash
cd scorer
rustup target add wasm32-unknown-unknown
cargo test
cargo build --release --target wasm32-unknown-unknown
```

Register the resulting `scorer/target/wasm32-unknown-unknown/release/verity_scorer.wasm` through the integration dashboard after hosting it at a durable public URL.

The verified v0.1.3 scorer binary is already available from the GitHub Release linked above.

### Weather Forecast evaluator

`weather-forecast-scorer` is a separate, stateless evaluator for
`WEATHER_FORECAST`. It scores Verity's canonical forecast format by matching
the requested coordinates, forecast horizon, and each complete daily record.
It intentionally gives no partial credit to malformed payloads and exports
only `alloc`, `dealloc`, and `rank_answer`.

```powershell
cd weather-forecast-scorer
cargo test
cargo build --release --target wasm32-unknown-unknown
```

Upload `weather-forecast-scorer/target/wasm32-unknown-unknown/release/verity_weather_forecast_scorer.wasm`
to a new Telegraph WASM registration for `WEATHER_FORECAST`.

### Weather Check evaluator

`weather-check-scorer` is the separate, stateless evaluator for `WEATHER_CHECK`.
It scores coordinates, observation time, and each normalized current-condition
measurement without allowing malformed payloads to receive partial credit.

## Status

The implementation follows the public Miner YAML and WASM ABI documentation checked on 2026-08-14. It still requires live dashboard sandbox validation, a production deployment, actual Miner registration, and an end-to-end Telegraph request before any live-performance claim.
