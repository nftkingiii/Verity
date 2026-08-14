# Project State — Verity

## Objective

Compete in Telegraph Hackathon Season I with a high-reliability `ONCHAIN_TX_LOOKUP` Miner and a deterministic evaluator that independently verifies returned transaction facts.

## Current decision

- **Working name:** Verity (one-word; do not publish or register until availability is checked).
- **Tracks:** Miner Track as the primary entry; Script Author Track if the early-access rules permit the same participant to enter both.
- **Thesis:** Transaction lookups should return normalized, chain-aware evidence—not a raw RPC passthrough. The evaluator should score exactness, provenance, and resistance to fabricated / mismatched-chain responses.

## Confirmed program facts — checked 2026-08-14

- The public site shows Track 1 and Track 2 opening 2026-08-17 at 12:00 UTC; early registrants receive task specifications and private Discord support before then.
- Public intents include `ONCHAIN_TX_LOOKUP` (Tier A) and `WALLET_BALANCE_CHECK`.
- Miner YAML requires `version`, `kind`, `id`, `slug`, `name`, and `base_url`; `semantics.supported_intents` is case-sensitive and must include `ONCHAIN_TX_LOOKUP` exactly.
- The integration dashboard sandbox-tests endpoints, pins YAML, and submits the Base Sepolia registration. A scoring module is a <=32 MB stateless WASM binary exporting `alloc`, `dealloc`, and `rank_answer`.
- Public judging emphasizes Miner performance, applications, requests, X updates, and engagement; evaluator judging emphasizes automated script evaluation, ranking accuracy, and resistance to gaming.

## Proof matrix

| Requirement | Planned implementation | Evidence | Status |
| --- | --- | --- | --- |
| Telegraph Miner | GET `/v1/lookup?chain=&tx_hash=` behind the public YAML mapping | 3 passing Node endpoint tests; registered miner ID and live requests | Implemented locally; registration pending |
| Correct transaction evidence | Multi-RPC lookup with canonical receipt, block, and chain metadata | Unit fixtures plus independent RPC read-back | Planned |
| Deterministic evaluator | Rust/WASM canonical-payload scorer, including forged-result tests | 3 passing Rust tests; verified `alloc`, `dealloc`, `rank_answer` WASM exports; dashboard acceptance | Built locally; registration pending |
| Production availability | Health, latency, rate-limit, and error-safe service behavior | Public health URL and logs | Planned |
| Track 3 demand | Application that uses the Miner rather than mocking it | Live integration and request ledger | Deferred until Track 3 |
| Submission | Repository, demo, X updates, and exact proof links | Final evidence ledger | Planned |

## Immediate next actions

1. Run local Node and Rust/WASM verification.
2. Deploy the Miner with dedicated RPC URLs and preserve the deployment revision/health evidence.
3. Replace YAML placeholders and use the integration dashboard sandbox test.
4. Recheck `ONCHAIN_TX_LOOKUP` from the live canonical set immediately before registration.
5. Register the Miner and WASM scorer, then preserve transaction hashes, miner ID, and endpoint read-back.

## Local verification — 2026-08-14

- `npm test` passed: health, unsupported-chain rejection, and malformed-hash rejection (3/3).
- `cargo test --offline` passed: exact payload, blank/malformed answers, and copied-hash anti-gaming cases (3/3).
- A release WASM module was compiled with the installed `wasm32v1-none` target (7,546 bytes) and inspected with Node's WebAssembly runtime. It exported `memory`, `alloc`, `dealloc`, and `rank_answer`.
- The documented `wasm32-unknown-unknown` target was not installed; `rustup target add wasm32-unknown-unknown` did not complete before the command timeout. The source is target-gated for `wasm32`, but final dashboard upload should use the documented target or first confirm acceptance of the verified compatible artifact.

## Evidence ledger

- Hackathon: https://hackathon.telegraphprotocol.com/
- Rules: https://hackathon.telegraphprotocol.com/rules
- Intent catalog: https://hackathon.telegraphprotocol.com/supported-intents
- Public examples: https://github.com/telegraphprotocol/telegraph-usecases

## Unknowns

- Dashboard availability and whether `id: 9001` is available.
- Exact hidden-question distribution and ground-truth canonicalization for `ONCHAIN_TX_LOOKUP`.
- Production RPC provider selection, deployment URL, wallet/fee address, and registration transaction.
- Whether the early-access submission endpoints are available in the user's registered account.
