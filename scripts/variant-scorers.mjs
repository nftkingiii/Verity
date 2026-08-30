import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(root, "artifacts", "v0.3.1");
const outputDir = path.join(root, "artifacts", "v0.3.2");
const names = [
  "verity-onchain-scorer.wasm",
  "verity-weather-check-scorer.wasm",
  "verity-weather-forecast-scorer.wasm",
  "verity-news-search-scorer.wasm",
];

function uleb(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

function metadataSection(label) {
  const name = Buffer.from("telegraph-build", "utf8");
  const payload = Buffer.from(`v0.3.2/${label}`, "utf8");
  const body = Buffer.concat([uleb(name.length), name, payload]);
  return Buffer.concat([Buffer.from([0]), uleb(body.length), body]);
}

await mkdir(outputDir, { recursive: true });
const manifest = {};
for (const file of names) {
  const input = await readFile(path.join(sourceDir, file));
  const output = Buffer.concat([input, metadataSection(file)]);
  const module = new WebAssembly.Module(output);
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);
  if (imports.length || !["alloc", "dealloc", "rank_answer"].every((name) => exports.some((item) => item.name === name))) {
    throw new Error(`${file}: invalid module after variant metadata append`);
  }
  await writeFile(path.join(outputDir, file), output);
  manifest[file] = {
    bytes: output.length,
    sha256: createHash("sha256").update(output).digest("hex"),
    imports,
    exports,
  };
}
await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
