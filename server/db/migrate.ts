import { persistence } from "./connection.js";
import {
  classifyDatabaseError,
  type PersistenceRuntime
} from "./runtime.js";

export async function runPersistenceMigrations(
  runtime: Pick<PersistenceRuntime, "migrate">
): Promise<void> {
  try {
    await runtime.migrate();
  } catch (error) {
    const classified = classifyDatabaseError(error);
    throw Object.assign(new Error("Database startup failed."), {
      code: classified.code
    });
  }
}

export async function runMigrations(): Promise<void> {
  await runPersistenceMigrations(persistence);
}
