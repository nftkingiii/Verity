import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const cache = path.join(root, ".verity-cache");
const output = path.join(root, "artifacts", "v0.3.0");
const wrapperWasm = path.join(root, "calibrated-scorer", "target", "wasm32-unknown-unknown", "release", "verity_calibration_wrapper.wasm");

const champions = {
  ONCHAIN_TX_LOOKUP: {
    source: "https://raw.githubusercontent.com/zkasuran/telegraph-salience-scorer/92167ea85229156e2e761afa36a6b50fcc9fedfa/dist/xfmr/otx_t74.wasm",
    output: "verity-onchain-scorer.wasm",
  },
  WEATHER_CHECK: {
    source: "https://raw.githubusercontent.com/zkasuran/telegraph-salience-scorer/d734f291817596332ec23e1ef9b6b67fc32631ef/dist/xfmr/wchk_tol45.wasm",
    output: "verity-weather-check-scorer.wasm",
  },
  WEATHER_FORECAST: {
    source: "https://raw.githubusercontent.com/zkasuran/telegraph-salience-scorer/f009d2d778bd49611dcc0a7e3819a8dca74d1aad/dist/xfmr/wf_mini.wasm",
    output: "verity-weather-forecast-scorer.wasm",
  },
  NEWS_SEARCH: {
    source: "https://raw.githubusercontent.com/zkasuran/telegraph-salience-scorer/c88cc06ec3d03e6b9367a3c39908d92798626fa2/dist/xfmr/news_q40s.wasm",
    output: "verity-news-search-scorer.wasm",
  },
};

function runBinaryen(tool, args) {
  const toolArgs = ["--yes", "-p", "binaryen", tool, ...args];
  const command = process.platform === "win32" ? process.env.ComSpec : "npx";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/c", "npx", ...toolArgs]
    : toolArgs;
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${tool} failed: ${result.error ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
}

function readU32(bytes, start) {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (true) {
    const byte = bytes[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, offset };
    shift += 7;
  }
}

function writeU32(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

function patchExports(input) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const chunks = [input.subarray(0, 8)];
  let offset = 8;
  while (offset < input.length) {
    const sectionStart = offset;
    const id = input[offset++];
    const size = readU32(input, offset);
    const payloadStart = size.offset;
    const payloadEnd = payloadStart + size.value;
    if (id !== 7) {
      chunks.push(input.subarray(sectionStart, payloadEnd));
      offset = payloadEnd;
      continue;
    }

    let cursor = payloadStart;
    const count = readU32(input, cursor);
    cursor = count.offset;
    const exports = [];
    for (let index = 0; index < count.value; index += 1) {
      const nameLength = readU32(input, cursor);
      cursor = nameLength.offset;
      let name = decoder.decode(input.subarray(cursor, cursor + nameLength.value));
      cursor += nameLength.value;
      const kind = input[cursor++];
      const itemIndex = readU32(input, cursor);
      cursor = itemIndex.offset;
      if (["rank_answer", "__data_end", "__heap_base"].includes(name)) continue;
      if (name === "calibrated_rank_answer") name = "rank_answer";
      exports.push({ name, kind, index: itemIndex.value });
    }
    const payload = [writeU32(exports.length)];
    for (const item of exports) {
      const name = Buffer.from(encoder.encode(item.name));
      payload.push(writeU32(name.length), name, Buffer.from([item.kind]), writeU32(item.index));
    }
    const body = Buffer.concat(payload);
    chunks.push(Buffer.from([7]), writeU32(body.length), body);
    offset = payloadEnd;
  }
  return Buffer.concat(chunks);
}

await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const rustFlags = "-C link-arg=--import-memory";
const cargoResult = spawnSync(cargo, ["build", "--manifest-path", path.join(root, "calibrated-scorer", "Cargo.toml"), "--release", "--target", "wasm32-unknown-unknown"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, RUSTFLAGS: rustFlags },
});
if (cargoResult.status !== 0) throw new Error(`wrapper cargo build failed:\n${cargoResult.stdout ?? ""}\n${cargoResult.stderr ?? ""}`);

const manifest = {};
for (const [intent, config] of Object.entries(champions)) {
  const upstream = path.join(cache, `${intent}.wasm`);
  const response = await fetch(config.source);
  if (!response.ok) throw new Error(`${intent}: upstream download returned HTTP ${response.status}`);
  await writeFile(upstream, Buffer.from(await response.arrayBuffer()));

  const target = path.join(output, config.output);
  const linked = path.join(cache, `${intent}-linked.wasm`);
  runBinaryen("wasm-merge", [
    upstream, "env",
    wrapperWasm, "wrapper",
    "-o", linked,
    "--all-features",
  ]);

  await writeFile(target, patchExports(await readFile(linked)));

  const bytes = await readFile(target);
  const module = new WebAssembly.Module(bytes);
  manifest[intent] = {
    file: config.output,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    upstream: config.source,
    imports: WebAssembly.Module.imports(module),
    exports: WebAssembly.Module.exports(module),
  };
}

await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
