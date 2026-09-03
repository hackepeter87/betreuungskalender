import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { inventoryStyles, repeatedStyleProperties } from "./style-inventory";
import { extractLegalStyles, validateStyleReduction } from "./style-reduction-contract";

const args = process.argv.slice(2);
const allowed = new Set(["--ref", "--build-dir", "--inventory", "--check"]);
const options = new Map<string, string>();
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  if (!allowed.has(flag) || options.has(flag)) throw new Error(`Unknown or repeated option: ${flag}`);
  if (flag === "--inventory" || flag === "--check") options.set(flag, "true");
  else {
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options.set(flag, value);
  }
}
const ref = options.get("--ref");
if (ref && options.has("--build-dir")) {
  throw new Error("Measure historical source and freshly built working-tree assets separately");
}
// Resolve to a commit first; never pass user-supplied revision syntax to git show.
const commit = ref ? execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { encoding: "utf8" }).trim() : undefined;
const files = commit
  ? execFileSync("git", ["ls-tree", "-r", "--name-only", commit, "--", "src/styles.css", "src/styles"], { encoding: "utf8" }).trim().split("\n")
  : ["src/styles.css", ...readdirSync("src/styles", { recursive: true, encoding: "utf8" }).map((file) => `src/styles/${file}`)];
const sources = files.filter((file) => file.endsWith(".css")).sort().map((file) => ({
  path: file,
  layer: file === "src/styles.css" ? "entry" : file.slice("src/styles/".length).split(/[/.]/)[0],
  source: commit ? execFileSync("git", ["show", `${commit}:${file}`], { encoding: "utf8" }) : readFileSync(file, "utf8")
}));
const inventory = inventoryStyles(sources);
const buildDir = options.get("--build-dir");
const assets = buildDir ? readdirSync(buildDir, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".css")).sort().map((file) => {
  const css = readFileSync(path.join(buildDir, file));
  return { file, bytes: css.length, gzipBytes: gzipSync(css).length };
}) : undefined;
if (buildDir && assets?.length === 0) throw new Error("No built CSS found; run the production build first");
const build = assets ? {
  assets,
  bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
  gzipBytes: assets.reduce((sum, asset) => sum + asset.gzipBytes, 0)
} : undefined;
const legalFile = "server/routes/legal.ts";
const legalCss = extractLegalStyles(commit
  ? execFileSync("git", ["show", `${commit}:${legalFile}`], { encoding: "utf8" })
  : readFileSync(legalFile, "utf8"));
const standaloneLegal = {
  metrics: inventoryStyles([{ path: legalFile, layer: "standalone-legal", source: legalCss }]).metrics,
  gzipBytes: gzipSync(legalCss).length
};
if (options.has("--check")) {
  if (!build || commit) throw new Error("Reduction checks require a fresh working-tree production build");
  const issues = validateStyleReduction(inventory.metrics, build, standaloneLegal);
  if (issues.length) throw new Error(`CSS reduction contract failed:\n${issues.join("\n")}`);
}
console.log(JSON.stringify({
  revision: commit ?? "working-tree",
  runtime: {
    node: process.version,
    postcss: JSON.parse(readFileSync("node_modules/postcss/package.json", "utf8")).version,
    vite: JSON.parse(readFileSync("node_modules/vite/package.json", "utf8")).version
  },
  metrics: inventory.metrics,
  build,
  standaloneLegal,
  totals: {
    sourceBytes: inventory.metrics.bytes + standaloneLegal.metrics.bytes,
    declarations: inventory.metrics.declarations + standaloneLegal.metrics.declarations,
    rules: inventory.metrics.rules + standaloneLegal.metrics.rules,
    deliveredStyleBytes: build ? build.bytes + standaloneLegal.metrics.bytes : undefined,
    isolatedGzipBytes: build ? build.gzipBytes + standaloneLegal.gzipBytes : undefined
  },
  ...(options.has("--inventory") ? { rules: inventory.rules, repeatedProperties: repeatedStyleProperties(inventory.rules) } : {})
}, null, 2));
