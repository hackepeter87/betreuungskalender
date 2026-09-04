import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { join } from "node:path";

// Test-only TLS termination keeps the production CSP intact in WebKit.
const port = Number(process.env.PORT ?? 3100);
if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_PATH) throw Error("E2E environment required");
if (!Number.isInteger(port) || port < 1024 || port > 65534) throw Error("Invalid E2E port");
const directory = process.env.E2E_TLS_DIRECTORY;
if (!directory) throw Error("Test runner certificate required");

const application = spawn(process.execPath, ["dist-server/server/index.js"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port + 1) },
  stdio: "inherit"
});
const server = createServer({
  key: readFileSync(join(directory, "key.pem")),
  cert: readFileSync(join(directory, "cert.pem"))
}, (incoming, outgoing) => {
  const upstream = request({
    hostname: "127.0.0.1", port: port + 1, method: incoming.method,
    path: incoming.url, headers: incoming.headers
  }, response => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.on("error", () => outgoing.destroy());
    response.pipe(outgoing);
  });
  upstream.on("error", () => {
    if (outgoing.headersSent) outgoing.destroy();
    else outgoing.writeHead(503).end();
  });
  incoming.on("aborted", () => upstream.destroy());
  outgoing.on("close", () => upstream.destroy());
  incoming.pipe(upstream);
});

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  server.close();
  application.kill("SIGTERM");
  application.once("close", () => process.exit(code));
  setTimeout(() => { application.kill("SIGKILL"); process.exit(code); }, 5000).unref();
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
application.once("error", () => stop(1));
application.once("exit", code => {
  if (!stopping) { server.closeAllConnections(); server.close(); process.exit(code ?? 1); }
});
server.once("error", () => stop(1));
server.listen(port, "127.0.0.1");
