import { randomUUID } from "node:crypto";

export function makeId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function bool(value: unknown): boolean {
  return value === 1 || value === true;
}
