import Database from "better-sqlite3";
import {
  Kysely,
  SqliteDialect,
  type Transaction
} from "kysely";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrateDatabase } from "./migrationRunner.js";
import type { DatabaseSchema } from "./schema.js";

export type DatabaseDriver = "sqlite";
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

export function classifyDatabaseError(error: unknown): ClassifiedDatabaseError {
  const driverCode = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (driverCode.startsWith("SQLITE_CONSTRAINT")) {
    return { kind: "constraint", code: "constraint_violation" };
  }
  if (sqliteUnavailableCodes.some((candidate) => driverCode.startsWith(candidate))) {
    return { kind: "unavailable", code: "database_unavailable" };
  }
  return { kind: "unknown", code: "database_error" };
}

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

export function createSqlitePersistenceRuntime(
  databasePath: string | Database.Database,
  migrationsDirectory?: string
): SqlitePersistenceRuntime {
  return new SqlitePersistenceRuntime(databasePath, migrationsDirectory);
}
