import Database from "better-sqlite3";
import {
  CompiledQuery,
  Kysely,
  SqliteDialect,
  sql,
  type Transaction
} from "kysely";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrateDatabase } from "./migrationRunner.js";

export type DatabaseDriver = "sqlite";
export type PersistenceSchema = Record<string, never>;
type QueryExecutor = Kysely<PersistenceSchema> | Transaction<PersistenceSchema>;

export type PersistenceValue = string | number | bigint | boolean | null | Uint8Array;

export interface PersistenceMutationResult {
  affectedRows: number;
  insertId?: bigint;
}

export interface PersistenceExecutor {
  one<T>(statement: string, parameters?: readonly PersistenceValue[]): Promise<T | undefined>;
  all<T>(statement: string, parameters?: readonly PersistenceValue[]): Promise<T[]>;
  run(
    statement: string,
    parameters?: readonly PersistenceValue[]
  ): Promise<PersistenceMutationResult>;
}

export interface PersistenceStatus {
  reachable: boolean;
  migrationsApplied: boolean;
  migrationCount: number;
}

export type DatabaseErrorKind = "constraint" | "unavailable" | "unknown";

export interface ClassifiedDatabaseError {
  kind: DatabaseErrorKind;
  code: string;
}

export interface PersistenceRuntime extends PersistenceExecutor {
  readonly driver: DatabaseDriver;
  readonly query: Kysely<PersistenceSchema>;
  migrate(): Promise<void>;
  status(): Promise<PersistenceStatus>;
  transaction<T>(work: (transaction: PersistenceExecutor) => Promise<T>): Promise<T>;
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
];

export function classifyDatabaseError(error: unknown): ClassifiedDatabaseError {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "database_error";
  if (code.startsWith("SQLITE_CONSTRAINT")) {
    return { kind: "constraint", code: "constraint_violation" };
  }
  if (sqliteUnavailableCodes.some((candidate) => code.startsWith(candidate))) {
    return { kind: "unavailable", code: "database_unavailable" };
  }
  return { kind: "unknown", code: "database_error" };
}

export class SqlitePersistenceRuntime implements PersistenceRuntime {
  readonly driver = "sqlite" as const;
  readonly query: Kysely<PersistenceSchema>;
  readonly legacyDatabase: Database.Database;
  private closed = false;

  constructor(
    databasePath: string | Database.Database,
    private readonly migrationsDirectory?: string
  ) {
    if (typeof databasePath === "string" && databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.legacyDatabase = typeof databasePath === "string"
      ? new Database(databasePath)
      : databasePath;
    this.legacyDatabase.pragma("journal_mode = WAL");
    this.legacyDatabase.pragma("foreign_keys = ON");
    this.legacyDatabase.pragma("busy_timeout = 5000");
    this.query = new Kysely<PersistenceSchema>({
      dialect: new SqliteDialect({ database: this.legacyDatabase })
    });
  }

  async migrate(): Promise<void> {
    this.assertOpen();
    migrateDatabase(this.legacyDatabase, this.migrationsDirectory);
  }

  async status(): Promise<PersistenceStatus> {
    if (this.closed) return { reachable: false, migrationsApplied: false, migrationCount: 0 };
    try {
      await sql`SELECT 1 AS ok`.execute(this.query);
    } catch {
      return { reachable: false, migrationsApplied: false, migrationCount: 0 };
    }
    try {
      const result = await sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM schema_migrations
      `.execute(this.query);
      const migrationCount = Number(result.rows[0]?.count ?? 0);
      return {
        reachable: true,
        migrationsApplied: migrationCount > 0,
        migrationCount
      };
    } catch {
      return { reachable: true, migrationsApplied: false, migrationCount: 0 };
    }
  }

  async one<T>(
    statement: string,
    parameters: readonly PersistenceValue[] = []
  ): Promise<T | undefined> {
    this.assertOpen();
    return executeOne<T>(this.query, statement, parameters);
  }

  async all<T>(
    statement: string,
    parameters: readonly PersistenceValue[] = []
  ): Promise<T[]> {
    this.assertOpen();
    return executeAll<T>(this.query, statement, parameters);
  }

  async run(
    statement: string,
    parameters: readonly PersistenceValue[] = []
  ): Promise<PersistenceMutationResult> {
    this.assertOpen();
    return executeMutation(this.query, statement, parameters);
  }

  async transaction<T>(
    work: (transaction: PersistenceExecutor) => Promise<T>
  ): Promise<T> {
    this.assertOpen();
    return this.query.transaction().execute((transaction) => work(
      persistenceExecutor(transaction)
    ));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.query.destroy();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw Object.assign(new Error("Persistence runtime is closed."), {
        code: "database_runtime_closed"
      });
    }
  }
}

function compiledQuery(
  statement: string,
  parameters: readonly PersistenceValue[]
): CompiledQuery<unknown> {
  return CompiledQuery.raw(statement, [...parameters]);
}

async function executeOne<T>(
  executor: QueryExecutor,
  statement: string,
  parameters: readonly PersistenceValue[]
): Promise<T | undefined> {
  const result = await executor.executeQuery(compiledQuery(statement, parameters));
  return result.rows[0] as T | undefined;
}

async function executeAll<T>(
  executor: QueryExecutor,
  statement: string,
  parameters: readonly PersistenceValue[]
): Promise<T[]> {
  const result = await executor.executeQuery(compiledQuery(statement, parameters));
  return result.rows as T[];
}

async function executeMutation(
  executor: QueryExecutor,
  statement: string,
  parameters: readonly PersistenceValue[]
): Promise<PersistenceMutationResult> {
  const result = await executor.executeQuery(compiledQuery(statement, parameters));
  return {
    affectedRows: Number(result.numAffectedRows ?? 0),
    ...(result.insertId === undefined ? {} : { insertId: result.insertId })
  };
}

function persistenceExecutor(executor: QueryExecutor): PersistenceExecutor {
  return {
    one: <T>(statement: string, parameters: readonly PersistenceValue[] = []) =>
      executeOne<T>(executor, statement, parameters),
    all: <T>(statement: string, parameters: readonly PersistenceValue[] = []) =>
      executeAll<T>(executor, statement, parameters),
    run: (statement: string, parameters: readonly PersistenceValue[] = []) =>
      executeMutation(executor, statement, parameters)
  };
}

export function createSqlitePersistenceRuntime(
  databasePath: string | Database.Database,
  migrationsDirectory?: string
): SqlitePersistenceRuntime {
  return new SqlitePersistenceRuntime(databasePath, migrationsDirectory);
}
