import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(process.cwd(), "server/migrations");
const destination = resolve(process.cwd(), "dist-server/server/migrations");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
