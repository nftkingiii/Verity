# Verity

Verity is a four-intent Telegraph miner suite with stateless WebAssembly scorers for `ONCHAIN_TX_LOOKUP`, `WEATHER_CHECK`, `WEATHER_FORECAST`, and `NEWS_SEARCH`.

**Live Miner:** https://verity-production-fcf5.up.railway.app/health
**Scoring modules:** https://github.com/nftkingiii/Verity/releases/tag/v0.3.0

The on-chain miner accepts an EVM chain plus transaction hash, checks archive-capable RPC providers with fallback, and returns both a direct answer and canonical evidence:

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

For production, set a comma-separated `RPC_ETHEREUM_URLS` list (or the legacy single `RPC_ETHEREUM_URL`) with a dedicated archive-capable endpoint first. The public defaults provide independent fallback but are not an uptime guarantee.

### Weather miner

`GET /v1/weather?location=Lagos` (or exact `latitude`/`longitude`) returns timestamped current conditions, C/F temperatures, condition, humidity, dew point, pressure, precipitation, wind, and canonical evidence from fixed Open-Meteo hosts.

### Weather Forecast miner

`GET /v1/forecast?location=Tokyo&forecast_days=7` (or exact coordinates) returns one to seven location-timezone daily forecasts plus up to 168 hourly temperature, dew-point, precipitation, condition, and wind observations. It never accepts a caller-supplied URL.

### News Search miner

`GET /v1/news?q=US+technology&max_results=5&recent_days=3&exclude_domains=techcrunch.com,theverge.com` queries a fixed Google News RSS host. It supports locale, recency, result-count, and domain-exclusion controls; returns descriptions with source/time provenance; and serves bounded stale cache data during brief upstream failures. It does not fetch returned article URLs.

## Telegraph configuration

`verity-miner.yaml` uses the exact uppercase canonical intent required by Telegraph:

```yaml
supported_intents:
  - ONCHAIN_TX_LOOKUP
```

Upload exactly the bytes you hash. The dashboard sandbox-tests the endpoint, pins the YAML, and registers the Miner. Do not put a private key, provider secret, or raw API key in the YAML.

## Scoring module

The scorer implements Telegraph's required WASM exports: `alloc`, `dealloc`, and `rank_answer`. It is intentionally stateless and has no network/filesystem capability.

The v0.3 scorers add a transparent calibration and factual-contradiction layer
to commit-pinned, MIT-licensed semantic modules from
`telegraph-salience-scorer`. The wrapper preserves semantic ordering, widens
good/bad separation, and penalizes decisive status, direction, rain, and
numeric contradictions. Exact upstream provenance and SHA-256 hashes are in
`artifacts/v0.3.0/manifest.json`; licensing is in `THIRD_PARTY_NOTICES.md`.

```powershell
npm run build:calibrated-scorers
npm run test:calibrated-scorers
```

```bash
cd scorer
rustup target add wasm32-unknown-unknown
cargo test
cargo build --release --target wasm32-unknown-unknown
```

Register the resulting `scorer/target/wasm32-unknown-unknown/release/verity_scorer.wasm` through the integration dashboard after hosting it at a durable public URL.

Build and validate a fresh binary from the current source before replacing any registered scorer; the older v0.1.3 release predates the heterogeneous-answer improvements.

### Weather Forecast evaluator

`weather-forecast-scorer` is a separate, stateless evaluator for
`WEATHER_FORECAST`. It scores canonical forecasts with per-field tolerances
and uses a bounded format-agnostic fallback for heterogeneous JSON or prose
answers. It exports
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
measurement with realistic time and numeric tolerances, plus a bounded fallback
for heterogeneous answers.

### News Search evaluator

`news-search-scorer` combines bounded ground-truth agreement with question
coverage so relevant, source-rich answers outrank unrelated or empty results.
It is format-agnostic and exports only `alloc`, `dealloc`, and `rank_answer`.

## Status

The current revision follows the public Miner YAML and WASM ABI documentation checked on 2026-08-30. Telegraph's public score-history endpoint no longer exposes question, ground-truth, or answer fields, so `npm run backtest:scorers` now fails closed instead of reporting meaningless agreement. Local adversarial results are pre-registration evidence only; Stage 2 dashboard acceptance remains the authoritative gate.
