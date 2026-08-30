import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const release = path.join(root, "artifacts", "v0.3.1");
const cases = [
  ["verity-onchain-scorer.wasm", "tx", "transaction confirmed success value 2", "transaction confirmed success value 2", "transaction reverted value 99"],
  ["verity-weather-check-scorer.wasm", "weather", "Lagos 27 C rain humidity 80", "Lagos 27 C rain humidity 80", "Lagos 42 C clear humidity 10"],
  ["verity-weather-forecast-scorer.wasm", "forecast", "Monday rain 21 C Tuesday cloudy 23 C", "Monday rain 21 C Tuesday cloudy 23 C", "Monday sunny 39 C Friday snow -2 C"],
  ["verity-news-search-scorer.wasm", "news", "OpenAI released Model X on August 29 according to Reuters", "Reuters reports OpenAI released Model X on August 29", "Football recipes and an unrelated 2024 rumor"],
];

function call(instance, question, truth, answer) {
  const encoder = new TextEncoder();
  const argumentsList = [];
  for (const input of [question, truth, answer]) {
    const bytes = encoder.encode(input);
    const pointer = instance.exports.alloc(bytes.length);
    if (!pointer) throw new Error("allocation failed");
    new Uint8Array(instance.exports.memory.buffer, pointer, bytes.length).set(bytes);
    argumentsList.push(pointer, bytes.length);
  }
  return instance.exports.rank_answer(...argumentsList);
}

for (const [file, question, truth, good, bad] of cases) {
  const bytes = await readFile(path.join(release, file));
  const started = performance.now();
  const module = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(module);
  const loadMs = performance.now() - started;
  const goodScore = call(instance, question, truth, good);
  const badScore = call(instance, question, truth, bad);
  const startedCalls = performance.now();
  for (let index = 0; index < 1000; index += 1) call(instance, question, truth, good);
  const callsMs = performance.now() - startedCalls;
  if (!(goodScore > badScore) || loadMs > 1000 || callsMs > 1000) {
    throw new Error(`${file} failed quality/runtime gate: ${JSON.stringify({ goodScore, badScore, loadMs, callsMs })}`);
  }
  console.log(JSON.stringify({ file, bytes: bytes.length, goodScore, badScore, loadMs: Number(loadMs.toFixed(2)), thousandCallsMs: Number(callsMs.toFixed(2)) }));
}
