import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const built = path.join(root, "artifacts", "v0.3.0");
const cache = path.join(root, ".verity-cache");

const modules = {
  ONCHAIN_TX_LOOKUP: {
    upstream: "ONCHAIN_TX_LOOKUP.wasm",
    calibrated: "verity-onchain-scorer.wasm",
    cases: [
      ["Was transaction 0xabc successful?", "Transaction 0xabc succeeded in block 123 from 0x111 to 0x222 for 1.5 ETH.", "0xabc was successful in block 123, transferring 1.5 ETH from 0x111 to 0x222.", "Transaction 0xabc reverted in block 123 from 0x111 to 0x222 for 1.5 ETH."],
      ["Look up transaction 0xdef", "The confirmed transaction hash is 0xdef, block 900, sender 0xaaa, recipient 0xbbb, value 20 USDC.", "Confirmed: 0xdef at block 900 sent 20 USDC from 0xaaa to 0xbbb.", "Confirmed: 0x000 at block 901 sent 200 USDC from 0xaaa to 0xccc."],
      ["What is the status and value?", "Status: success. Value: 0.25 ETH. Confirmations: 42.", "It succeeded for 0.25 ETH and has 42 confirmations.", "It failed for 25 ETH and has 2 confirmations."],
    ],
  },
  WEATHER_CHECK: {
    upstream: "WEATHER_CHECK.wasm",
    calibrated: "verity-weather-check-scorer.wasm",
    cases: [
      ["Current weather in Lagos", "Lagos is 27 C with 82% humidity, wind 14 km/h, and light rain.", "Current Lagos conditions are 27 C, 82% humidity, 14 km/h wind, with light rain.", "Current Lagos conditions are 41 C, 22% humidity, 70 km/h wind, with no rain."],
      ["Weather at 40.7,-74.0", "At 40.7,-74.0 it is 18 C, feels like 17 C, wind 9 km/h, precipitation 0 mm.", "The coordinates report 18 C, feels 17 C, wind 9 km/h and no precipitation.", "The coordinates report -8 C, feels -17 C, wind 90 km/h and 40 mm precipitation."],
      ["Is it raining in Tokyo?", "Tokyo has moderate rain, 24 C, 91% humidity.", "Yes. Tokyo has moderate rain at 24 C and 91% humidity.", "No. Tokyo is clear at 34 C with 31% humidity."],
    ],
  },
  WEATHER_FORECAST: {
    upstream: "WEATHER_FORECAST.wasm",
    calibrated: "verity-weather-forecast-scorer.wasm",
    cases: [
      ["Three-day Paris forecast", "Monday 21 C rain; Tuesday 23 C cloudy; Wednesday 26 C sunny.", "Paris: rain and 21 C Monday, cloudy and 23 C Tuesday, sunny and 26 C Wednesday.", "Paris: sunny and 35 C Monday, snow and -2 C Tuesday, storms and 10 C Friday."],
      ["Will London rain tomorrow?", "Tomorrow London has an 80% rain chance with 12 mm precipitation and a high of 17 C.", "Yes, London has 80% rain probability, about 12 mm, high 17 C tomorrow.", "No, London has 0% rain, 0 mm, high 31 C next week."],
      ["Weekend forecast for Nairobi", "Saturday high 25 C low 14 C; Sunday high 24 C low 13 C.", "Nairobi reaches 25/14 C Saturday and 24/13 C Sunday.", "Nairobi reaches 40/30 C Sunday and 39/29 C Monday."],
    ],
  },
  NEWS_SEARCH: {
    upstream: "NEWS_SEARCH.wasm",
    calibrated: "verity-news-search-scorer.wasm",
    cases: [
      ["Latest OpenAI news this week", "OpenAI launched Model X on August 29, 2026, according to Reuters and the OpenAI blog.", "Reuters and OpenAI report that Model X launched August 29, 2026.", "A 2024 rumor says OpenAI cancelled Model X; source: anonymous social post."],
      ["Bitcoin ETF flow news today", "US spot Bitcoin ETFs recorded $420 million net inflows on August 30, led by IBIT.", "Today US spot Bitcoin ETFs saw $420M net inflows, with IBIT leading.", "US spot Bitcoin ETFs had $420M net outflows last month, led by an unrelated fund."],
      ["Find verified NVIDIA earnings headlines", "NVIDIA reported quarterly revenue of $46.7 billion; source: NVIDIA investor relations, August 2026.", "NVIDIA's August 2026 investor release reports $46.7B quarterly revenue.", "NVIDIA revenue was $4.67B according to an undated fan blog about gaming rumors."],
    ],
  },
};

function load(file) {
  const bytes = fs.readFileSync(file);
  const module = new WebAssembly.Module(bytes);
  return { bytes, module, instance: new WebAssembly.Instance(module) };
}

function score(instance, question, truth, answer) {
  const encoder = new TextEncoder();
  const args = [];
  for (const value of [question, truth, answer]) {
    const bytes = encoder.encode(value);
    const pointer = instance.exports.alloc(bytes.length);
    if (!pointer) throw new Error("allocation failed");
    new Uint8Array(instance.exports.memory.buffer, pointer, bytes.length).set(bytes);
    args.push(pointer, bytes.length);
  }
  return instance.exports.rank_answer(...args);
}

let failed = false;
for (const [intent, config] of Object.entries(modules)) {
  const raw = load(path.join(cache, config.upstream));
  const calibrated = load(path.join(built, config.calibrated));
  const imports = WebAssembly.Module.imports(calibrated.module);
  const exports = WebAssembly.Module.exports(calibrated.module).map(({ name, kind }) => `${name}:${kind}`);
  if (imports.length) throw new Error(`${intent}: imports are not allowed`);
  for (const required of ["memory:memory", "alloc:function", "dealloc:function", "rank_answer:function"]) {
    if (!exports.includes(required)) throw new Error(`${intent}: missing ${required}`);
  }

  const results = config.cases.map(([question, truth, good, bad]) => {
    const rawGood = score(raw.instance, question, truth, good);
    const rawBad = score(raw.instance, question, truth, bad);
    const goodScore = score(calibrated.instance, question, truth, good);
    const badScore = score(calibrated.instance, question, truth, bad);
    const selfScore = score(calibrated.instance, question, truth, truth);
    return { rawGood, rawBad, goodScore, badScore, margin: goodScore - badScore, selfScore };
  });
  const wins = results.filter((row) => row.goodScore > row.badScore).length;
  const averageMargin = results.reduce((sum, row) => sum + row.margin, 0) / results.length;
  const rawMargin = results.reduce((sum, row) => sum + row.rawGood - row.rawBad, 0) / results.length;
  const minSelf = Math.min(...results.map((row) => row.selfScore));
  if (wins !== results.length || averageMargin <= rawMargin || minSelf < 0.99) failed = true;
  console.log(JSON.stringify({ intent, wins, cases: results.length, rawMargin, averageMargin, minSelf, results }));
}

if (failed) process.exitCode = 1;
