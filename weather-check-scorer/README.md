# Verity Weather Check Scorer

Stateless Telegraph evaluator for `WEATHER_CHECK` canonical strings:

```text
latitude|longitude|observed_at|temperature_c|humidity_percent|apparent_temperature_c|precipitation_mm|weather_code|wind_speed_kmh
```

It exports only `alloc`, `dealloc`, and `rank_answer`.

```powershell
cd weather-check-scorer
cargo test
cargo build --release --target wasm32-unknown-unknown
```

Register `target/wasm32-unknown-unknown/release/verity_weather_check_scorer.wasm` against `WEATHER_CHECK`.
