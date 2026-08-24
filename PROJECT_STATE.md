# Project State — Verity

## Objective

Compete in Telegraph Hackathon Season I with a high-reliability `ONCHAIN_TX_LOOKUP` Miner and a deterministic evaluator that independently verifies returned transaction facts.

## Current decision

- **Working name:** Verity (one-word; do not publish or register until availability is checked).
- **Tracks:** Miner Track as the primary entry; Script Author Track if the early-access rules permit the same participant to enter both.
- **Second miner:** `WEATHER_CHECK`, not `GAS_PRICE`: the live canonical catalog reported four Weather miners and zero Gas Price miners on 2026-08-14. The latter cannot presently satisfy the three-active-miner prize guardrail.
- **Third miner:** `WEATHER_FORECAST`: direct user report confirms it became active on 2026-08-16. It is intentionally separate from current-conditions Weather Check.
- **Fourth miner:** `NEWS_SEARCH`: the live leaderboard showed exactly three ranked miners on 2026-08-16; GDELT was rejected after persistent upstream rate limits, and the user approved a fixed Google News RSS implementation instead.
- **Thesis:** Transaction lookups should return normalized, chain-aware evidence—not a raw RPC passthrough. The evaluator should score exactness, provenance, and resistance to fabricated / mismatched-chain responses.

## Confirmed program facts — checked 2026-08-14

- The public site shows Track 1 and Track 2 opening 2026-08-17 at 12:00 UTC; early registrants receive task specifications and private Discord support before then.
- Public intents include `ONCHAIN_TX_LOOKUP` (Tier A) and `WALLET_BALANCE_CHECK`.
- Miner YAML requires `version`, `kind`, `id`, `slug`, `name`, and `base_url`; `semantics.supported_intents` is case-sensitive and must include `ONCHAIN_TX_LOOKUP` exactly.
- The integration dashboard sandbox-tests endpoints, pins YAML, and submits the registration. The current WASM ABI requires a stateless binary exporting `memory`, `alloc`, `dealloc`, and `rank_answer`; `breakdown_answer` is deprecated and removed.
- Public judging emphasizes Miner performance, applications, requests, X updates, and engagement; evaluator judging emphasizes automated script evaluation, ranking accuracy, and resistance to gaming.

## Proof matrix

| Requirement | Planned implementation | Evidence | Status |
| --- | --- | --- | --- |
| Telegraph Miner | GET `/v1/lookup?chain=&tx_hash=` behind the public YAML mapping | Base Sepolia transaction `0x78c57b20b67c489bcf4d64b495d8c62939dc4daca67ce5dc77a4631be6db4d85`; IPFS YAML `QmTKzFcBYYuMEGvMPjv5trVqpHiaiKiuWw5HL5EtqUgyMq` | Registered; pending epoch activation |
| Correct transaction evidence | Archive-capable multi-RPC lookup with canonical receipt, value, selector, fee, block, and chain metadata | False-null fallback regression plus exact failed epoch-269 transaction read-back | Implemented locally; deployment pending |
| Deterministic evaluator | Rust/WASM canonical-payload scorer, including forged-result tests | Generic self-match regression plus canonical/forged-answer tests; verify `memory`, `alloc`, `dealloc`, and `rank_answer` exports before upload | v0.1.3 built against the team's updated ABI; wait for contract deployment before registration |
| Production availability | Railway public HTTPS service | Health/revision read-back and adversarial request | Verified |
| Weather Check miner | GET `/v1/weather?location=` or exact coordinates, backed by fixed Open-Meteo HTTPS hosts | Local tests and direct Lagos read-back | Richer revision implemented locally; deployment pending |
| Weather Forecast miner | GET `/v1/forecast?location=&forecast_days=` or exact coordinates, backed by fixed Open-Meteo HTTPS | Tokyo 7-day/168-hour read-back plus deterministic fixtures | Richer revision implemented locally; deployment pending |
| Weather Forecast evaluator | Stateless WASM scorer for coordinate, horizon, and complete daily-record agreement | `weather-forecast-scorer` tests plus WASM runtime read-back | Built locally; needs dashboard registration |
| Weather Check evaluator | Stateless WASM scorer for coordinate, observation time, and current-condition agreement | `weather-check-scorer` tests plus WASM runtime read-back | Built locally; needs dashboard registration |
| News Search miner | Filterable GET `/v1/news` backed by fixed Google News RSS HTTPS | Recency/exclusion fixture, stale-cache behavior, and direct five-result read-back | Richer revision implemented locally; deployment pending |
| News Search evaluator | Stateless bounded scorer for ground-truth agreement and question coverage | Four unit tests plus WASM build/export inspection | Implemented locally; registration pending |
| Track 3 demand | Application that uses the Miner rather than mocking it | Live integration and request ledger | Deferred until Track 3 |
| Submission | Repository, demo, X updates, and exact proof links | Final evidence ledger | Planned |

## Immediate next actions

1. Complete the ship gate, deploy the audited revision, and prove the live revision plus all four public flows.
2. Update miner registrations one at a time in this order: On-chain, Forecast, News, Weather Check; verify each new registration before moving on.
3. Ask Telegraph why `verity-current-weather` is visible in scores but absent from current integration catalogs.
4. Backtest each scorer against held-out public rows and the incumbent before registering; do not replace all scorers simultaneously.
5. Confirm whether the current registry lost prior scorer #9 during the contract migration and obtain the supported deregistration path for rejected #11.

## Competitive audit — 2026-08-24

- Verified epoch 269: On-chain #4/0.000749, Weather Check #3/0.013261, Forecast #4/0; News Search last appeared #4/0 in epoch 268.
- Root cause for On-chain: Verity returned `not_found` for a valid Ethereum transaction because `https://cloudflare-eth.com` returned null for both transaction and receipt while the top three miners resolved it.
- Latest-20 empty-answer counts: On-chain 1, Weather Check 3, Forecast 5, News Search 7.
- Fresh live probe succeeded 21/21 requests, proving current reachability but not historical tournament reliability.
- Current WASM registry shows only rejected Weather Check #11 for the registered wallet; no active Verity scorer is visible.
- Full findings and remediation order: `AUDIT_2026-08-24.md`.

## Local verification — 2026-08-14

- `npm test` passed: health, unsupported-chain rejection, and malformed-hash rejection (3/3).
- `cargo test --offline` passed: exact payload, blank/malformed answers, and copied-hash anti-gaming cases (3/3).
- A release WASM module was compiled with the installed `wasm32v1-none` target (7,546 bytes) and inspected with Node's WebAssembly runtime. It exported `memory`, `alloc`, `dealloc`, and `rank_answer`.
- The documented `wasm32-unknown-unknown` target was not installed; `rustup target add wasm32-unknown-unknown` did not complete before the command timeout. The source is target-gated for `wasm32`, but final dashboard upload should use the documented target or first confirm acceptance of the verified compatible artifact.
- Railway health: https://verity-production-fcf5.up.railway.app/health returned HTTP 200 with deployed revision `29b4b5d35e714e95d9ec58e0fe972d1c53ef3983`; an unsupported-chain request returned HTTP 400 and the expected security headers.
- Scorer release: https://github.com/nftkingiii/Verity/releases/tag/v0.1.0 (the uploaded binary is 7,546 bytes).

## Audited revision verification — 2026-08-24

- Node miner suite: 13/13 passing, including false-null RPC fallback, location-aware forecast, news filters, and stale-cache recovery.
- Rust scorer suites: 16/16 passing across On-chain, Weather Check, Weather Forecast, and the new News Search scorer.
- Four optimized `wasm32-unknown-unknown` modules build with zero imports and only `memory`, `alloc`, `dealloc`, `rank_answer`, plus Rust internal heap-boundary exports.
- Fresh Explorer-row pairwise ordering agreement: On-chain 0.7794, Weather Check 0.7333, Forecast 0.7535, News 0.6667; every minimum self-match was 1.0 and every observed empty answer scored zero.
- Direct upstream read-back: the failed epoch-269 Ethereum transaction resolved to the expected sender and `0.1049719 ETH`; Lagos current weather resolved; Tokyo returned seven daily and 168 hourly forecast points; filtered Google News returned five articles.
- YAML syntax and closed endpoint-key checks passed for all four miner files; dependency audit reported zero known vulnerabilities.
- Production revision and Telegraph registration updates remain pending until the commit is deployed and the live `/health` revision plus all four public flows are read back.

## Evidence ledger

- Hackathon: https://hackathon.telegraphprotocol.com/
- Rules: https://hackathon.telegraphprotocol.com/rules
- Intent catalog: https://hackathon.telegraphprotocol.com/supported-intents
- Public examples: https://github.com/telegraphprotocol/telegraph-usecases

## Unknowns

- Dashboard availability and whether `id: 9001` is available.
- Exact hidden-question distribution and ground-truth canonicalization for `ONCHAIN_TX_LOOKUP`.
- Production RPC provider selection, wallet/fee address, and registration transaction.
- Whether the early-access submission endpoints are available in the user's registered account.
