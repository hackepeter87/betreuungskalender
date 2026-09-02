import { persistence } from "./connection.js";

export async function runMigrations(): Promise<void> {
  await persistence.migrate();
}
