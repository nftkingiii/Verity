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
- The integration dashboard sandbox-tests endpoints, pins YAML, and submits the Base Sepolia registration. Its current WASM intake requires a <=32 MB stateless binary exporting `memory`, `alloc`, `dealloc`, `rank_answer`, and `breakdown_answer`.
- Public judging emphasizes Miner performance, applications, requests, X updates, and engagement; evaluator judging emphasizes automated script evaluation, ranking accuracy, and resistance to gaming.

## Proof matrix

| Requirement | Planned implementation | Evidence | Status |
| --- | --- | --- | --- |
| Telegraph Miner | GET `/v1/lookup?chain=&tx_hash=` behind the public YAML mapping | Base Sepolia transaction `0x78c57b20b67c489bcf4d64b495d8c62939dc4daca67ce5dc77a4631be6db4d85`; IPFS YAML `QmTKzFcBYYuMEGvMPjv5trVqpHiaiKiuWw5HL5EtqUgyMq` | Registered; pending epoch activation |
| Correct transaction evidence | Multi-RPC lookup with canonical receipt, block, and chain metadata | Unit fixtures plus independent RPC read-back | Planned |
| Deterministic evaluator | Rust/WASM canonical-payload scorer, including forged-result tests | Generic self-match regression plus canonical/forged-answer tests; verify `memory`, `alloc`, `dealloc`, and `rank_answer` exports before upload | v0.1.3 built against the team's updated ABI; wait for contract deployment before registration |
| Production availability | Railway public HTTPS service | Health/revision read-back and adversarial request | Verified |
| Weather Check miner | GET `/v1/weather?latitude=&longitude=` backed by a fixed Open-Meteo HTTPS host | Local tests plus direct dashboard validation API read-back (`valid: true`, 2026-08-16) | Ready to upload and register |
| Weather Forecast miner | GET `/v1/forecast?latitude=&longitude=&forecast_days=` backed by fixed Open-Meteo HTTPS | Bounded horizon, deterministic fixtures, public YAML | Active (direct user report, 2026-08-16) |
| Weather Forecast evaluator | Stateless WASM scorer for coordinate, horizon, and complete daily-record agreement | `weather-forecast-scorer` tests plus WASM runtime read-back | Built locally; needs dashboard registration |
| News Search miner | GET `/v1/news?q=&max_results=` backed by fixed Google News RSS HTTPS | Bounded query/result count, no article fetching, deterministic RSS fixture | Built; deployment and registration pending |
| Track 3 demand | Application that uses the Miner rather than mocking it | Live integration and request ledger | Deferred until Track 3 |
| Submission | Repository, demo, X updates, and exact proof links | Final evidence ledger | Planned |

## Immediate next actions

1. Upload and register the Weather Forecast evaluator against `WEATHER_FORECAST`.
2. Check the existing ONCHAIN scorer dashboard status; submitted is not the same as active.
3. Keep active Miner endpoints healthy and periodically inspect their leaderboard records.

## Local verification — 2026-08-14

- `npm test` passed: health, unsupported-chain rejection, and malformed-hash rejection (3/3).
- `cargo test --offline` passed: exact payload, blank/malformed answers, and copied-hash anti-gaming cases (3/3).
- A release WASM module was compiled with the installed `wasm32v1-none` target (7,546 bytes) and inspected with Node's WebAssembly runtime. It exported `memory`, `alloc`, `dealloc`, and `rank_answer`.
- The documented `wasm32-unknown-unknown` target was not installed; `rustup target add wasm32-unknown-unknown` did not complete before the command timeout. The source is target-gated for `wasm32`, but final dashboard upload should use the documented target or first confirm acceptance of the verified compatible artifact.
- Railway health: https://verity-production-fcf5.up.railway.app/health returned HTTP 200 with deployed revision `29b4b5d35e714e95d9ec58e0fe972d1c53ef3983`; an unsupported-chain request returned HTTP 400 and the expected security headers.
- Scorer release: https://github.com/nftkingiii/Verity/releases/tag/v0.1.0 (the uploaded binary is 7,546 bytes).

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
