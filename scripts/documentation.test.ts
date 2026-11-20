import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import Fastify from "fastify";
import { protectedApplicationRoutePlugins } from "../server/applicationRoutes.js";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const historicalDocumentationDirectories = [
  "docs/adr/",
  "docs/operator-reviews/",
  "docs/release-notes/",
  "docs/release-smoke-tests/"
];

async function filesBelow(directory: string, extension: string): Promise<string[]> {
  const entries = await readdir(path.join(projectRoot, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(relativePath, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [relativePath] : [];
  }));
  return files.flat().sort();
}

async function allFilesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(projectRoot, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return allFilesBelow(relativePath);
    return entry.isFile() ? [relativePath] : [];
  }));
  return files.flat().sort();
}

async function currentMarkdownFiles(): Promise<string[]> {
  const files = ["README.md", "SECURITY.md", ...(await filesBelow("docs", ".md"))];
  return files.filter((file) =>
    !historicalDocumentationDirectories.some((directory) => file.startsWith(directory))
  );
}

function localLinkTargets(markdown: string): string[] {
  const markdownLinks = [...markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/u, 1)[0]);
  const htmlSources = [...markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1]);
  return [...markdownLinks, ...htmlSources]
    .map((target) => target.split("#", 1)[0].split("?", 1)[0])
    .filter((target) =>
      Boolean(target) &&
      !target.startsWith("/") &&
      !target.startsWith("#") &&
      !/^[a-z][a-z0-9+.-]*:/iu.test(target)
    );
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(path.join(projectRoot, file))).digest("hex");
}

test("current documentation contains no broken local links", async () => {
  const missing: string[] = [];
  for (const file of await currentMarkdownFiles()) {
    const markdown = await readFile(path.join(projectRoot, file), "utf8");
    for (const target of localLinkTargets(markdown)) {
      const resolved = path.resolve(projectRoot, path.dirname(file), decodeURIComponent(target));
      if (!resolved.startsWith(`${projectRoot}${path.sep}`)) {
        missing.push(`${file}: ${target} escapes the repository`);
        continue;
      }
      try {
        await stat(resolved);
      } catch {
        missing.push(`${file}: ${target}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("documented npm run commands exist", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, "package.json"), "utf8")
  ) as { scripts?: Record<string, string> };
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  const missing = new Set<string>();
  for (const file of await currentMarkdownFiles()) {
    const markdown = await readFile(path.join(projectRoot, file), "utf8");
    for (const match of markdown.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)) {
      if (!scripts.has(match[1])) missing.add(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual([...missing].sort(), []);
  assert.match(packageJson.scripts?.test ?? "", /\bnpm run test:docs\b/);
});

test("current operator artifacts do not restore the retired authentication proxy topology", async () => {
  const currentFiles = [
    ...(await currentMarkdownFiles()),
    ...(await allFilesBelow("deploy")),
    ".github/workflows/release.yml",
    "scripts/container-postgres-smoke.sh",
    "scripts/update.js"
  ];
  const obsoleteReferences: string[] = [];
  const pattern = /oauth2-proxy|compose\.oidc|\.env\.oidc/iu;

  for (const file of currentFiles) {
    const content = await readFile(path.join(projectRoot, file), "utf8");
    if (pattern.test(content)) obsoleteReferences.push(file);
  }

  assert.deepEqual(obsoleteReferences, []);
  assert.match(
    await readFile(path.join(projectRoot, "docs/adr/0001-post-1.0-auth-architecture.md"), "utf8"),
    pattern,
    "historical decision records must remain outside the current-contract scan"
  );
});

test("runtime and operational environment variables match the active configuration guide", async () => {
  const [configSource, configurationGuide] = await Promise.all([
    readFile(path.join(projectRoot, "server/config.ts"), "utf8"),
    readFile(path.join(projectRoot, "docs/configuration.md"), "utf8")
  ]);
  const runtimeVariables = new Set(
    [...configSource.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1])
  );
  const operationalVariables = new Set([
    "APP_COMPOSE_FILE",
    "APP_RELEASE_DIR",
    "APP_RELEASE_VERSION",
    "BACKUP_RETENTION_DAYS",
    "HEALTHCHECK_URL",
    "HOST_BIND_ADDRESS",
    "HOST_PORT",
    "POSTGRES_ADMIN_PASSWORD_FILE"
  ]);
  const supportedVariables = new Set([...runtimeVariables, ...operationalVariables]);
  const documentedVariables = new Set(
    [...configurationGuide.matchAll(/^\| `([A-Z][A-Z0-9_]*)` \|/gmu)].map((match) => match[1])
  );

  assert.ok(runtimeVariables.size > 50, "server/config.ts environment inventory is unexpectedly empty");
  assert.ok(documentedVariables.size > 70, "configuration guide environment inventory is unexpectedly empty");
  assert.deepEqual(
    [...supportedVariables].filter((name) => !documentedVariables.has(name)).sort(),
    [],
    "supported environment variables must be present in the configuration table"
  );
  assert.deepEqual(
    [...documentedVariables].filter((name) => !supportedVariables.has(name)).sort(),
    [],
    "configuration table variables must belong to the runtime or explicit operational contract"
  );
  assert.match(
    configurationGuide,
    /^\| `APP_RELEASE_VERSION` \|[^\n]*\| `X\.Y\.Z` \|/mu,
    "release version examples must use the maintained placeholder instead of a stale concrete release"
  );
});

test("release archive uses only explicit runtime and deployment inputs", async () => {
  const releaseWorkflow = await readFile(
    path.join(projectRoot, ".github/workflows/release.yml"),
    "utf8"
  );
  const { releaseArchiveUsesExplicitRuntimeInputs } = await import(
    pathToFileURL(path.join(projectRoot, "scripts/release-check.js")).href
  );
  assert.equal(
    releaseArchiveUsesExplicitRuntimeInputs(releaseWorkflow),
    true,
    "release archive inputs must be explicit and complete"
  );
  assert.doesNotMatch(
    releaseWorkflow,
    /\bdist dist-server scripts deploy charts\b/u,
    "release archives must not include the complete scripts and deploy directories"
  );
});

test("protected API permission inventory matches registered Fastify routes", async () => {
  const guide = await readFile(path.join(projectRoot, "docs/api-permissions.md"), "utf8");
  const block = /<!-- BEGIN PROTECTED API ROUTES -->\s*```text\s*([\s\S]*?)```\s*<!-- END PROTECTED API ROUTES -->/u.exec(guide)?.[1];
  assert.ok(block, "docs/api-permissions.md must contain the protected route inventory block");
  const documentedRoutes = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).sort();

  const app = Fastify({ logger: false });
  const registeredRoutes: string[] = [];
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD" || !route.url.startsWith("/api/")) continue;
      registeredRoutes.push(`${method} ${route.url} | ${route.config?.permission ?? "MISSING"}`);
    }
  });
  for (const { plugin } of protectedApplicationRoutePlugins) await app.register(plugin);
  await app.ready();
  await app.close();

  assert.deepEqual(documentedRoutes, registeredRoutes.sort());
});

test("README screenshots match their reviewed Linux references", async () => {
  const pairs = [
    [
      "docs/assets/screenshots/dashboard-desktop.png",
      "e2e/visual-regression.spec.ts-snapshots/dashboard-visual-1440-linux.png"
    ],
    [
      "docs/assets/screenshots/calendar-mobile.png",
      "e2e/visual-regression.spec.ts-snapshots/calendar-visual-390-linux.png"
    ]
  ] as const;
  for (const [documentationImage, referenceImage] of pairs) {
    assert.equal(await sha256(documentationImage), await sha256(referenceImage));
  }
});
