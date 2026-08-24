# Verity News Search Scorer

Stateless, deterministic Telegraph evaluator for `NEWS_SEARCH`. It combines
bounded ground-truth token agreement with question coverage, so relevant,
source-rich answers outrank unrelated or empty responses without depending on
one miner's JSON format.

It exports only `alloc`, `dealloc`, and `rank_answer`.

```powershell
cd news-search-scorer
cargo test
cargo build --release --target wasm32-unknown-unknown
```

Register `target/wasm32-unknown-unknown/release/verity_news_search_scorer.wasm`
against `NEWS_SEARCH` only after comparing it with the incumbent on held-out
public score rows.
