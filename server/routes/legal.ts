import type { FastifyInstance, FastifyReply } from "fastify";
import { open } from "node:fs/promises";
import { join } from "node:path";

const MAX_LEGAL_CONTENT_BYTES = 256 * 1024;

const legalDocuments = {
  "/impressum": { filename: "impressum.txt", title: "Impressum" },
  "/datenschutz": { filename: "datenschutz.txt", title: "Datenschutzerklärung" }
} as const;

type LegalPath = keyof typeof legalDocuments;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

export function publicLegalLinksHtml(): string {
  return `<nav class="legal-links" aria-label="Rechtliche Informationen">
    <a href="/impressum">Impressum</a>
    <a href="/datenschutz">Datenschutz</a>
  </nav>`;
}

async function readLegalDocument(directory: string, filename: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(join(directory, filename), "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_LEGAL_CONTENT_BYTES) return undefined;

    const buffer = Buffer.alloc(MAX_LEGAL_CONTENT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_LEGAL_CONTENT_BYTES) return undefined;

    const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    if (content.includes("\0")) return undefined;
    return content;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function legalPage(title: string, content: string): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Betreuungskalender</title>
  <meta name="theme-color" content="#087f7b">
  <script src="/appearance.js"></script>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: light-dark(#14213d, #edf0f2); background: light-dark(#f4f7f8, #191d20); }
    :root[data-appearance="light"] { color-scheme: light; }
    :root[data-appearance="dark"] { color-scheme: dark; }
    @media print { :root { color-scheme: only light !important; } }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; padding: clamp(16px, 4vw, 48px); }
    main { width: min(100%, 880px); margin: 0 auto; background: light-dark(#fff, #24292e); border: 1px solid light-dark(#d8e0e7, #59636c); border-radius: 8px; padding: clamp(24px, 5vw, 48px); box-shadow: 0 10px 30px rgba(20, 33, 61, .08); }
    .brand { display: inline-flex; align-items: center; gap: 12px; color: inherit; text-decoration: none; font-weight: 750; }
    .brand img { width: 42px; height: 42px; }
    h1 { margin: 32px 0 20px; font-size: 2.5rem; line-height: 1.15; overflow-wrap: anywhere; }
    @media (max-width: 767px) { h1 { font-size: 1.75rem; } }
    @media (max-width: 430px) { h1 { font-size: 1.375rem; } }
    .legal-content { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.65; color: inherit; }
    .legal-links { display: flex; flex-wrap: wrap; gap: 12px 20px; margin-top: 40px; padding-top: 20px; border-top: 1px solid light-dark(#d8e0e7, #59636c); }
    .legal-links a { color: light-dark(#087f7a, #73d5cc); font-weight: 700; }
  </style>
</head>
<body>
  <main data-legal-page>
    <a class="brand" href="/"><img src="/icons/app-logo-nav.svg" alt=""><span>Betreuungskalender</span></a>
    <h1>${escapeHtml(title)}</h1>
    <pre class="legal-content">${escapeHtml(content)}</pre>
    ${publicLegalLinksHtml()}
  </main>
</body>
</html>`;
}

function notFound(reply: FastifyReply) {
  return reply
    .header("cache-control", "no-store, max-age=0")
    .code(404)
    .send({ error: "not_found", message: "Ressource nicht gefunden." });
}

export async function legalRoutes(
  app: FastifyInstance,
  options: { legalContentDir: string }
): Promise<void> {
  for (const [path, document] of Object.entries(legalDocuments) as Array<[
    LegalPath,
    (typeof legalDocuments)[LegalPath]
  ]>) {
    app.get(path, async (_request, reply) => {
      const content = await readLegalDocument(options.legalContentDir, document.filename);
      if (content === undefined) return notFound(reply);
      return reply
        .header("cache-control", "no-store, max-age=0")
        .header("pragma", "no-cache")
        .header("expires", "0")
        .type("text/html; charset=utf-8")
        .send(legalPage(document.title, content));
    });
  }
}

export const legalRouteTesting = { MAX_LEGAL_CONTENT_BYTES, readLegalDocument };
