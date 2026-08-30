import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const release = path.join(root, "artifacts", "v0.3.1");
const modules = [
  ["ONCHAIN_TX_LOOKUP", "scorer", "verity_scorer.wasm", "verity-onchain-scorer.wasm"],
  ["WEATHER_CHECK", "weather-check-scorer", "verity_weather_check_scorer.wasm", "verity-weather-check-scorer.wasm"],
  ["WEATHER_FORECAST", "weather-forecast-scorer", "verity_weather_forecast_scorer.wasm", "verity-weather-forecast-scorer.wasm"],
  ["NEWS_SEARCH", "news-search-scorer", "verity_news_search_scorer.wasm", "verity-news-search-scorer.wasm"],
];
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";

await mkdir(release, { recursive: true });
const manifest = {};
for (const [intent, directory, builtName, publishedName] of modules) {
  const crate = path.join(root, directory);
  const result = spawnSync(cargo, ["build", "--manifest-path", path.join(crate, "Cargo.toml"), "--release", "--target", "wasm32-unknown-unknown"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`${intent} build failed:\n${result.stdout}\n${result.stderr}`);

  const source = path.join(crate, "target", "wasm32-unknown-unknown", "release", builtName);
  const target = path.join(release, publishedName);
  await cp(source, target);
  const bytes = await readFile(target);
  const module = new WebAssembly.Module(bytes);
  const exports = WebAssembly.Module.exports(module).map(({ name, kind }) => `${name}:${kind}`);
  const imports = WebAssembly.Module.imports(module);
  for (const required of ["memory:memory", "alloc:function", "dealloc:function", "rank_answer:function"]) {
    if (!exports.includes(required)) throw new Error(`${intent} missing required export ${required}`);
  }
  if (imports.length) throw new Error(`${intent} has imports, which Telegraph does not accept`);
  if (bytes.length > 512 * 1024) throw new Error(`${intent} is ${bytes.length} bytes; scorer modules must stay below 512 KiB`);
  manifest[intent] = {
    file: publishedName,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    imports,
    exports: WebAssembly.Module.exports(module),
  };
}
await writeFile(path.join(release, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
