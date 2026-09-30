import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const scopeNames = [
  "application",
  "automation",
  "browser",
  "container",
  "database",
  "dependencies",
  "docs",
  "helm",
  "image",
  "postgres_container",
  "security",
  "update"
];

const rules = {
  application: [
    /^(?:e2e|public|server|shared|src)\//u,
    /^(?:eslint\.config\.|index\.html$|package(?:-lock)?\.json$|playwright\.config\.|tsconfig|vite\.config\.)/u,
    /^scripts\/(?!ci-change-scope\.mjs$|workflow-contracts\.test\.ts$)/u
  ],
  automation: [/^\.github\//u, /^scripts\/(?:ci-change-scope\.mjs|workflow-contracts\.test\.ts)$/u],
  browser: [
    /^(?:e2e|public|server|shared|src)\//u,
    /^(?:index\.html$|package(?:-lock)?\.json$|playwright\.config\.|tsconfig|vite\.config\.)/u,
    /^scripts\/(?:check-frontend-bundle|copy-migrations|e2e-server|style-report)/u
  ],
  container: [
    /^(?:deploy|public|server|shared|src)\//u,
    /^(?:compose\.yaml$|Dockerfile(?:\.release)?$|index\.html$|package(?:-lock)?\.json$|tsconfig|vite\.config\.)/u,
    /^scripts\//u,
    /^\.github\/(?:actions\/validate-container|workflows\/container\.yml)/u
  ],
  database: [
    /^(?:server|shared)\//u,
    /^package(?:-lock)?\.json$/u,
    /^scripts\/(?:copy-migrations|container-postgres-smoke|restore-check)/u
  ],
  dependencies: [
    /^package(?:-lock)?\.json$/u,
    /^Dockerfile(?:\.release)?$/u,
    /^\.github\/(?:actions|dependabot\.yml|workflows)\//u,
    /^charts\//u
  ],
  docs: [/^(?:CHANGELOG\.md$|README\.md$|SECURITY\.md$|docs\/)/u],
  helm: [/^charts\//u, /^deploy\//u, /^scripts\/helm-chart-test\.sh$/u],
  image: [
    /^(?:public|server|shared|src)\//u,
    /^(?:Dockerfile(?:\.release)?$|index\.html$|package(?:-lock)?\.json$|tsconfig|vite\.config\.)/u,
    /^scripts\//u
  ],
  postgres_container: [
    /^(?:deploy|server|shared)\//u,
    /^(?:compose\.yaml$|Dockerfile(?:\.release)?$|package(?:-lock)?\.json$|tsconfig\.server)/u,
    /^scripts\/(?:container-postgres-smoke|copy-migrations|restore-check)/u
  ],
  security: [
    /^(?:server|shared)\//u,
    /^package(?:-lock)?\.json$/u,
    /^scripts\/(?:runtime-security|security|release-check)/u
  ],
  update: [
    /^deploy\//u,
    /^(?:compose\.yaml$|Dockerfile(?:\.release)?$)/u,
    /^scripts\/update(?:\.test)?\.js$/u
  ]
};

export function classifyChangedFiles(files) {
  const normalized = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
  const scopes = Object.fromEntries(scopeNames.map((name) => [name, false]));

  for (const file of normalized) {
    for (const [scope, patterns] of Object.entries(rules)) {
      if (patterns.some((pattern) => pattern.test(file))) scopes[scope] = true;
    }
  }

  return { ...scopes, any: normalized.length > 0, files: normalized };
}

function allTrackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/u);
}

function changedFiles(base, head) {
  if (!base || /^0+$/u.test(base)) return allTrackedFiles();
  try {
    return execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACDMRTUXB", base, head],
      { encoding: "utf8" }
    ).split(/\r?\n/u);
  } catch {
    return allTrackedFiles();
  }
}

function run() {
  const result = classifyChangedFiles(changedFiles(process.env.CI_BASE_SHA, process.env.CI_HEAD_SHA ?? "HEAD"));
  const lines = scopeNames.map((name) => `${name}=${String(result[name])}`);
  lines.push(`any=${String(result.any)}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
