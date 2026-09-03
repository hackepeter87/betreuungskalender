import Database from "better-sqlite3";
import {
  Kysely,
  PostgresDialect,
  SqliteDialect,
  type Transaction
} from "kysely";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { Pool } from "pg";
import { migrateDatabase } from "./migrationRunner.js";
import {
  migratePostgresDatabase,
  postgresMigrationVersions
} from "./postgresMigrationRunner.js";
import type { DatabaseSchema } from "./schema.js";

export type DatabaseDriver = "sqlite" | "postgres";
export type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;
export type PersistenceTransaction = Transaction<DatabaseSchema>;

export interface PersistenceStatus {
  reachable: boolean;
  migrationsApplied: boolean;
  migrationCount: number;
}

export interface PersistenceIntegrity {
  valid: boolean;
  foreignKeyViolations: number;
}

export type DatabaseErrorKind = "constraint" | "unavailable" | "unknown";

export interface ClassifiedDatabaseError {
  kind: DatabaseErrorKind;
  code: "constraint_violation" | "database_unavailable" | "database_error";
}

export interface PersistenceRuntime {
  readonly driver: DatabaseDriver;
  readonly query: Kysely<DatabaseSchema>;
  migrate(): Promise<void>;
  status(): Promise<PersistenceStatus>;
  integrity(): Promise<PersistenceIntegrity>;
  transaction<T>(work: (transaction: PersistenceTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const sqliteUnavailableCodes = [
  "SQLITE_BUSY",
  "SQLITE_CANTOPEN",
  "SQLITE_CORRUPT",
  "SQLITE_FULL",
  "SQLITE_IOERR",
  "SQLITE_LOCKED",
  "SQLITE_NOTADB",
  "SQLITE_READONLY"
] as const;

const postgresUnavailableCodes = new Set([
  "53300",
  "53400",
  "57P01",
  "57P02",
  "57P03"
]);

export function classifyDatabaseError(error: unknown): ClassifiedDatabaseError {
  const driverCode = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (driverCode.startsWith("SQLITE_CONSTRAINT")) {
    return { kind: "constraint", code: "constraint_violation" };
  }
  if (driverCode.startsWith("23")) {
    return { kind: "constraint", code: "constraint_violation" };
  }
  if (sqliteUnavailableCodes.some((candidate) => driverCode.startsWith(candidate))) {
    return { kind: "unavailable", code: "database_unavailable" };
  }
  if (driverCode.startsWith("08") || postgresUnavailableCodes.has(driverCode)) {
    return { kind: "unavailable", code: "database_unavailable" };
  }
  return { kind: "unknown", code: "database_error" };
}

export interface SqlitePersistenceOptions {
  driver: "sqlite";
  databasePath: string | Database.Database;
  migrationsDirectory?: string;
}

export interface PostgresPersistenceOptions {
  driver: "postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  passwordFile: string;
  tlsMode: "disable" | "verify-full";
  caFile?: string;
  migrationsDirectory?: string;
}

export type PersistenceRuntimeOptions =
  | SqlitePersistenceOptions
  | PostgresPersistenceOptions;

export class SqlitePersistenceRuntime implements PersistenceRuntime {
  readonly driver = "sqlite" as const;
  readonly query: Kysely<DatabaseSchema>;
  readonly sqliteDatabase: Database.Database;
  #closed = false;

  constructor(
    databasePath: string | Database.Database,
    private readonly migrationsDirectory?: string
  ) {
    if (typeof databasePath === "string" && databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.sqliteDatabase = typeof databasePath === "string"
      ? new Database(databasePath)
      : databasePath;
    this.sqliteDatabase.pragma("journal_mode = WAL");
    this.sqliteDatabase.pragma("foreign_keys = ON");
    this.sqliteDatabase.pragma("busy_timeout = 5000");
    this.query = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: this.sqliteDatabase })
    });
  }

  async migrate(): Promise<void> {
    this.#assertOpen();
    migrateDatabase(this.sqliteDatabase, this.migrationsDirectory);
  }

  async status(): Promise<PersistenceStatus> {
    if (this.#closed) {
      return { reachable: false, migrationsApplied: false, migrationCount: 0 };
    }
    try {
      await this.query.selectNoFrom((expression) => expression.lit(1).as("ok")).executeTakeFirst();
    } catch {
      return { reachable: false, migrationsApplied: false, migrationCount: 0 };
    }
    try {
      const row = await this.query
        .selectFrom("schema_migrations")
        .select(({ fn }) => fn.count<number>("version").as("count"))
        .executeTakeFirst();
      const migrationCount = Number(row?.count ?? 0);
      return {
        reachable: true,
        migrationsApplied: migrationCount > 0,
        migrationCount
      };
    } catch {
      return { reachable: true, migrationsApplied: false, migrationCount: 0 };
    }
  }

  async integrity(): Promise<PersistenceIntegrity> {
    this.#assertOpen();
    const foreignKeys = this.sqliteDatabase.pragma("foreign_key_check") as unknown[];
    const rows = this.sqliteDatabase.pragma("integrity_check") as Array<{ integrity_check: string }>;
    return {
      valid: foreignKeys.length === 0 && rows.every((row) => row.integrity_check === "ok"),
      foreignKeyViolations: foreignKeys.length
    };
  }

  async transaction<T>(
    work: (transaction: PersistenceTransaction) => Promise<T>
  ): Promise<T> {
    this.#assertOpen();
    return this.query.transaction().execute(work);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.query.destroy();
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw Object.assign(new Error("Persistence runtime is closed."), {
        code: "database_runtime_closed"
      });
    }
  }
}

function readSecretFile(path: string): string {
  try {
    const value = readFileSync(path, "utf8").trim();
    if (value) return value;
  } catch {
    // The public error intentionally omits the operator-controlled path.
  }
  throw Object.assign(new Error("Database secret is unavailable."), {
    code: "database_secret_unavailable"
  });
}

export class PostgresPersistenceRuntime implements PersistenceRuntime {
  readonly driver = "postgres" as const;
  readonly query: Kysely<DatabaseSchema>;
  readonly pool: Pool;
  #closed = false;

  constructor(private readonly options: PostgresPersistenceOptions) {
    const password = readSecretFile(options.passwordFile);
    const ssl = options.tlsMode === "verify-full"
      ? {
          ca: readSecretFile(options.caFile ?? ""),
          rejectUnauthorized: true
        }
      : false;
    this.pool = new Pool({
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password,
      ssl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });
    // An idle-client error must not become an unhandled EventEmitter failure.
    // Readiness and subsequent queries still report the unavailable database.
    this.pool.on("error", () => undefined);
    this.query = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool: this.pool })
    });
  }

  async migrate(): Promise<void> {
    this.#assertOpen();
    await migratePostgresDatabase(this.pool, this.options.migrationsDirectory);
  }

  async status(): Promise<PersistenceStatus> {
    if (this.#closed) {
      return { reachable: false, migrationsApplied: false, migrationCount: 0 };
    }
    try {
      await this.query.selectNoFrom((expression) => expression.lit(1).as("ok"))
        .executeTakeFirst();
    } catch {
      return { reachable: false, migrationsApplied: false, migrationCount: 0 };
    }
    try {
      const row = await this.query
        .selectFrom("schema_migrations")
        .select(({ fn }) => fn.count<number>("version").as("count"))
        .executeTakeFirst();
      const migrationCount = Number(row?.count ?? 0);
      const expectedMigrationCount = postgresMigrationVersions(
        this.options.migrationsDirectory
      ).length;
      return {
        reachable: true,
        migrationsApplied: expectedMigrationCount > 0 &&
          migrationCount === expectedMigrationCount,
        migrationCount
      };
    } catch {
      return { reachable: true, migrationsApplied: false, migrationCount: 0 };
    }
  }

  async integrity(): Promise<PersistenceIntegrity> {
    this.#assertOpen();
    const invalidConstraints = await this.pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_catalog.pg_constraint AS constraint_entry
      JOIN pg_catalog.pg_class AS relation
        ON relation.oid = constraint_entry.conrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE constraint_entry.convalidated = FALSE
        AND namespace.nspname = current_schema()
    `);
    const violations = Number(invalidConstraints.rows[0]?.count ?? 0);
    return {
      valid: violations === 0,
      foreignKeyViolations: violations
    };
  }

  async transaction<T>(
    work: (transaction: PersistenceTransaction) => Promise<T>
  ): Promise<T> {
    this.#assertOpen();
    return this.query.transaction().execute(work);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.query.destroy();
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw Object.assign(new Error("Persistence runtime is closed."), {
        code: "database_runtime_closed"
      });
    }
  }
}

export function createSqlitePersistenceRuntime(
  databasePath: string | Database.Database,
  migrationsDirectory?: string
): SqlitePersistenceRuntime {
  return new SqlitePersistenceRuntime(databasePath, migrationsDirectory);
}

export function requireSqlitePersistenceRuntime(
  runtime: PersistenceRuntime
): SqlitePersistenceRuntime {
  if (runtime instanceof SqlitePersistenceRuntime) return runtime;
  throw Object.assign(
    new Error("This operation requires the SQLite database backend."),
    { code: "sqlite_operation_unavailable" }
  );
}

export function createPersistenceRuntime(
  options: PersistenceRuntimeOptions
): PersistenceRuntime {
  if (options.driver === "sqlite") {
    return createSqlitePersistenceRuntime(
      options.databasePath,
      options.migrationsDirectory
    );
  }
  return new PostgresPersistenceRuntime(options);
}
