import fs from "node:fs";
import path from "node:path";

const API = "https://explorer.telegraphprotocol.com/api/scores";
const wasmRoot = process.env.WASM_DIR ?? path.resolve("target", "wasm32-unknown-unknown", "release");
const modules = {
  ONCHAIN_TX_LOOKUP: "verity_scorer.wasm",
  WEATHER_CHECK: "verity_weather_check_scorer.wasm",
  WEATHER_FORECAST: "verity_weather_forecast_scorer.wasm",
  NEWS_SEARCH: "verity_news_search_scorer.wasm",
};

function scoreWith(module, question, groundTruth, answer) {
  const instance = new WebAssembly.Instance(module);
  const encoder = new TextEncoder();
  const values = [question, groundTruth, answer].map((value) => encoder.encode(String(value ?? "")));
  const args = [];
  for (const value of values) {
    const pointer = instance.exports.alloc(value.length);
    if (!pointer) throw new Error("WASM allocation failed");
    new Uint8Array(instance.exports.memory.buffer, pointer, value.length).set(value);
    args.push(pointer, value.length);
  }
  return instance.exports.rank_answer(...args);
}

function deviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

for (const [intent, filename] of Object.entries(modules)) {
  const file = path.join(wasmRoot, filename);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}; build the release WASMs or set WASM_DIR.`);
  const module = new WebAssembly.Module(fs.readFileSync(file));
  const response = await fetch(`${API}?intent=${intent}`);
  if (!response.ok) throw new Error(`${intent} score fetch failed: HTTP ${response.status}`);
  const body = await response.json();
  const rows = Array.isArray(body) ? body : body.data ?? body.scores ?? [];
  const evaluated = rows.map((row) => ({
    ...row,
    candidate_score: scoreWith(module, row.question, row.ground_truth, row.miner_answer),
    self_score: scoreWith(module, row.question, row.ground_truth, row.ground_truth),
  }));
  const groups = new Map();
  for (const row of evaluated) {
    const key = `${row.epoch_id}|${row.question}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let agreed = 0;
  let compared = 0;
  for (const group of groups.values()) {
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        const official = Math.sign(Number(group[left].score) - Number(group[right].score));
        const candidate = Math.sign(group[left].candidate_score - group[right].candidate_score);
        if (official === 0) continue;
        compared += 1;
        if (official === candidate) agreed += 1;
      }
    }
  }
  const candidateScores = evaluated.map((row) => row.candidate_score);
  console.log(JSON.stringify({
    intent,
    rows: evaluated.length,
    groups: groups.size,
    pairwise_rank_agreement: compared ? Number((agreed / compared).toFixed(4)) : null,
    compared_pairs: compared,
    candidate_score_stdev: Number(deviation(candidateScores).toFixed(4)),
    min_self_match: Number(Math.min(...evaluated.map((row) => row.self_score)).toFixed(4)),
    empty_answer_scores_zero: evaluated.filter((row) => !String(row.miner_answer ?? "").trim()).every((row) => row.candidate_score === 0),
  }));
}
