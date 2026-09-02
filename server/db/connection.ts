import { config } from "../config.js";
import { createSqlitePersistenceRuntime } from "./runtime.js";

export const persistence = createSqlitePersistenceRuntime(config.databasePath);

/** @deprecated Migrate callers to the injected persistence runtime. */
export const db = persistence.sqliteDatabase;
