import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { legalRoutes, legalRouteTesting } from "./routes/legal.js";

async function withLegalApp(
  files: Record<string, string | Buffer>,
  run: (app: ReturnType<typeof Fastify>) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), "betreuungskalender-legal-"));
  try {
    await Promise.all(Object.entries(files).map(([filename, content]) =>
      writeFile(join(directory, filename), content)
    ));
    const app = Fastify();
    await app.register(legalRoutes, { legalContentDir: directory });
    await run(app);
    await app.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("legal pages render escaped UTF-8 text without caching or cookies", async () => {
  await withLegalApp({
    "impressum.txt": "Verantwortlich: Beispiel <script>alert('x')</script>\nKontakt: test@example.invalid"
  }, async (app) => {
    const response = await app.inject({ method: "GET", url: "/impressum?source=footer" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /text\/html; charset=utf-8/);
    assert.equal(response.headers["cache-control"], "no-store, max-age=0");
    assert.equal(response.headers["set-cookie"], undefined);
    assert.match(response.body, /Verantwortlich: Beispiel &lt;script&gt;/);
    assert.doesNotMatch(response.body, /<script>alert/);
    assert.match(response.body, /href="\/datenschutz"/);
  });
});

test("legal pages support HEAD and expose no response body", async () => {
  await withLegalApp({ "datenschutz.txt": "Datenschutz für eine Beispielinstallation" }, async (app) => {
    const response = await app.inject({ method: "HEAD", url: "/datenschutz" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "");
    assert.equal(response.headers["cache-control"], "no-store, max-age=0");
  });
});

test("missing, oversized, malformed, and unexpected legal resources fail generically", async () => {
  const oversized = Buffer.alloc(legalRouteTesting.MAX_LEGAL_CONTENT_BYTES + 1, "a");
  await withLegalApp({
    "impressum.txt": oversized,
    "datenschutz.txt": Buffer.from([0xc3, 0x28])
  }, async (app) => {
    for (const url of ["/impressum", "/datenschutz", "/impressum/extra", "/legal"]) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 404);
      assert.doesNotMatch(response.body, /impressum\.txt|datenschutz\.txt|legalContentDir/);
    }
  });
});
