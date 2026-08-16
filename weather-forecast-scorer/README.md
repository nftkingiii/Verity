# Verity Weather Forecast Scorer

Stateless Telegraph evaluator for `WEATHER_FORECAST` canonical strings:

```text
latitude|longitude|forecast_days|YYYY-MM-DD,weather_code,max_c,min_c,rain_percent,wind_kmh|...
```

It exports only the current evaluator ABI: `alloc`, `dealloc`, and `rank_answer`.

```powershell
cd weather-forecast-scorer
cargo test
cargo build --release --target wasm32-unknown-unknown
```

Register `target/wasm32-unknown-unknown/release/verity_weather_forecast_scorer.wasm` against `WEATHER_FORECAST`.
