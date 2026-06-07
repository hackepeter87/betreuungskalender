const url = process.env.HEALTHCHECK_URL ?? "http://127.0.0.1:3000/api/health";

try {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(4_000)
  });
  const body = await response.json();
  if (
    !response.ok ||
    body.status !== "ok" ||
    body.databaseReachable !== true
  ) {
    throw new Error(`Healthcheck meldet HTTP ${response.status}.`);
  }
  console.log(`Healthcheck erfolgreich, Version ${body.version ?? "unbekannt"}.`);
} catch (error) {
  console.error(
    `Healthcheck fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`
  );
  process.exitCode = 1;
}
