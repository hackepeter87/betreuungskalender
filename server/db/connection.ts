import { config } from "../config.js";
import { createPersistenceRuntime } from "./runtime.js";

export const persistence = config.databaseDriver === "sqlite"
  ? createPersistenceRuntime({
      driver: "sqlite",
      databasePath: config.databasePath
    })
  : createPersistenceRuntime({
      driver: "postgres",
      host: config.postgresHost!,
      port: config.postgresPort,
      database: config.postgresDatabase!,
      user: config.postgresUser!,
      passwordFile: config.postgresPasswordFile!,
      tlsMode: config.postgresTlsMode,
      caFile: config.postgresCaFile
    });
