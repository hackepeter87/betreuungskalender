import { Counter, Gauge, Histogram, Registry } from "@prometheus-io/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { PersistenceRuntime } from "./db/runtime.js";
import { normalizedRequestRoute } from "./logging.js";

export interface MetricsListenerConfig {
  enabled: boolean;
  host: string;
  port: number;
  bearerTokenFile?: string;
}

export interface MetricsListener {
  close(): Promise<void>;
}

const requestMethods = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);

function boundedMethod(method: string): string {
  const normalized = method.toUpperCase();
  return requestMethods.has(normalized) ? normalized : "OTHER";
}

function statusClass(statusCode: number): string {
  return statusCode >= 100 && statusCode <= 599
    ? `${Math.floor(statusCode / 100)}xx`
    : "unknown";
}

function bearerToken(path: string | undefined): string {
  if (!path) throw Object.assign(new Error("Metrics secret is unavailable."), {
    code: "metrics_secret_unavailable"
  });
  try {
    const token = readFileSync(path, "utf8").trim();
    if (token.length >= 32 && token.length <= 4096 && !/\s/.test(token)) return token;
  } catch {
    // The operator-controlled path is intentionally omitted from the error.
  }
  throw Object.assign(new Error("Metrics secret is unavailable."), {
    code: "metrics_secret_unavailable"
  });
}

function matchesBearer(value: string | undefined, token: string): boolean {
  if (!value?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(value.slice(7));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export class RuntimeMetrics {
  readonly registry = new Registry();
  readonly #persistence: PersistenceRuntime;
  readonly #requests: Counter<"method" | "route" | "status_class">;
  readonly #requestDuration: Histogram<"method" | "route" | "status_class">;
  readonly #databaseReachable: Gauge;
  readonly #migrationsApplied: Gauge;
  readonly #backgroundJobs: Counter<"job" | "outcome">;

  constructor(persistence: PersistenceRuntime) {
    this.#persistence = persistence;
    const registers = [this.registry];
    new Gauge({
      name: "betreuungskalender_process_uptime_seconds",
      help: "Application process uptime in seconds.",
      registers,
      collect() {
        this.set(process.uptime());
      }
    });
    this.#requests = new Counter({
      name: "betreuungskalender_http_requests_total",
      help: "Completed application HTTP requests.",
      labelNames: ["method", "route", "status_class"] as const,
      registers
    });
    this.#requestDuration = new Histogram({
      name: "betreuungskalender_http_request_duration_seconds",
      help: "Application HTTP request duration in seconds.",
      labelNames: ["method", "route", "status_class"] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers
    });
    this.#databaseReachable = new Gauge({
      name: "betreuungskalender_database_reachable",
      help: "Whether the selected application database is reachable.",
      registers
    });
    this.#migrationsApplied = new Gauge({
      name: "betreuungskalender_database_migrations_applied",
      help: "Whether application database migrations are applied.",
      registers
    });
    this.#backgroundJobs = new Counter({
      name: "betreuungskalender_background_job_runs_total",
      help: "Completed bounded background jobs.",
      labelNames: ["job", "outcome"] as const,
      registers
    });
  }

  install(app: FastifyInstance): void {
    app.addHook("onResponse", (request, reply, done) => {
      const labels = {
        method: boundedMethod(request.method),
        route: normalizedRequestRoute(request),
        status_class: statusClass(reply.statusCode)
      };
      this.#requests.inc(labels);
      this.#requestDuration.observe(labels, reply.elapsedTime / 1000);
      done();
    });
  }

  recordBackgroundJob(outcome: "success" | "failure"): void {
    this.#backgroundJobs.inc({ job: "care_confirmation_sweep", outcome });
  }

  async render(): Promise<string> {
    const database = await this.#persistence.status();
    this.#databaseReachable.set(database.reachable ? 1 : 0);
    this.#migrationsApplied.set(database.migrationsApplied ? 1 : 0);
    return this.registry.metrics();
  }
}

export async function startMetricsListener(
  config: MetricsListenerConfig,
  metrics: RuntimeMetrics
): Promise<MetricsListener | undefined> {
  if (!config.enabled) return undefined;
  const token = bearerToken(config.bearerTokenFile);
  const server = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    if (request.method !== "GET" || request.url !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    if (!matchesBearer(request.headers.authorization, token)) {
      response.writeHead(401, {
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": "Bearer"
      });
      response.end("Unauthorized\n");
      return;
    }
    try {
      const body = await metrics.render();
      response.writeHead(200, { "content-type": metrics.registry.contentType });
      response.end(body);
    } catch {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("Unavailable\n");
    }
  });
  await listen(server, config.host, config.port);
  let closed = false;
  return {
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return close(server);
    }
  };
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
