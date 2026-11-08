import type {
  DatabaseExecutor,
  PersistenceRuntime
} from "../db/runtime.js";
import {
  insertChild,
  insertContactRule,
  insertEntry,
  insertExternalCalendarEvent,
  insertExternalCalendarSource,
  insertHoliday,
  insertMonthClosure,
  insertPattern,
  insertUnavailable
} from "../routes/appData.js";
import {
  CONTROLLED_DEMO_SEED_VERSION,
  createControlledDemoData
} from "./demoFixtures.js";

export const DEMO_SEED_VERSION_SETTING = "demo.mode.seedVersion";
export const DEMO_RESET_STATE_SETTING = "demo.mode.resetState";

export interface DemoResetState {
  seedVersion: string;
  sessionGeneration: number;
  status: "ready" | "running" | "failed";
  nextResetAt: string;
  lastSuccessfulResetAt?: string;
  startedAt?: string;
  errorCode?: "demo_reset_failed";
}

type ControlledDemoData = ReturnType<typeof createControlledDemoData>["data"];

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parsedState(value: unknown): DemoResetState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  if (
    typeof state.seedVersion !== "string" ||
    !Number.isSafeInteger(state.sessionGeneration) ||
    Number(state.sessionGeneration) < 0 ||
    !["ready", "running", "failed"].includes(String(state.status)) ||
    !isIsoDate(state.nextResetAt)
  ) return undefined;
  if (state.lastSuccessfulResetAt !== undefined && !isIsoDate(state.lastSuccessfulResetAt)) {
    return undefined;
  }
  if (state.startedAt !== undefined && !isIsoDate(state.startedAt)) return undefined;
  if (state.errorCode !== undefined && state.errorCode !== "demo_reset_failed") return undefined;
  return {
    seedVersion: state.seedVersion,
    sessionGeneration: Number(state.sessionGeneration),
    status: state.status as DemoResetState["status"],
    nextResetAt: state.nextResetAt,
    ...(typeof state.lastSuccessfulResetAt === "string"
      ? { lastSuccessfulResetAt: state.lastSuccessfulResetAt }
      : {}),
    ...(typeof state.startedAt === "string" ? { startedAt: state.startedAt } : {}),
    ...(state.errorCode === "demo_reset_failed" ? { errorCode: state.errorCode } : {})
  };
}

export async function readDemoResetState(
  database: DatabaseExecutor
): Promise<DemoResetState | undefined> {
  const row = await database.selectFrom("settings")
    .select("value_json")
    .where("key", "=", DEMO_RESET_STATE_SETTING)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!row) return undefined;
  try {
    return parsedState(JSON.parse(row.value_json));
  } catch {
    return undefined;
  }
}

export function demoResetStateIsReadable(
  state: DemoResetState | undefined,
  seedVersion: string | undefined,
  now = new Date()
): boolean {
  return Boolean(
    state?.status === "ready" &&
    seedVersion &&
    state.seedVersion === seedVersion &&
    Date.parse(state.nextResetAt) > now.getTime()
  );
}

export class DemoWriteGate {
  private activeWrites = 0;
  private blocked = false;
  private drainWaiters: Array<() => void> = [];

  constructor(private readonly enabled: boolean) {}

  enter(method: string, path: string): () => void {
    if (!this.enabled || !this.isWrite(method, path)) return () => undefined;
    if (this.blocked) {
      throw Object.assign(new Error("Demo writes are blocked."), {
        code: "demo_writes_blocked",
        statusCode: 503
      });
    }
    this.activeWrites += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeWrites -= 1;
      if (this.activeWrites === 0) {
        for (const resolve of this.drainWaiters.splice(0)) resolve();
      }
    };
  }

  async blockAndDrain(): Promise<void> {
    if (!this.enabled) return;
    this.blocked = true;
    if (this.activeWrites === 0) return;
    await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
  }

  unblock(): void {
    if (this.enabled) this.blocked = false;
  }

  private isWrite(method: string, path: string): boolean {
    return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase()) ||
      (method.toUpperCase() === "GET" && [
        "/auth/login",
        "/auth/callback",
        "/auth/logout"
      ].includes(path));
  }
}

async function writeSetting(
  database: DatabaseExecutor,
  key: string,
  value: unknown,
  timestamp: string
): Promise<void> {
  await database.insertInto("settings").values({
    key,
    value_json: JSON.stringify(value),
    created_by: "demo-system",
    updated_by: "demo-system",
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).onConflict((conflict) => conflict.column("key").doUpdateSet({
    value_json: JSON.stringify(value),
    updated_by: "demo-system",
    updated_at: timestamp,
    deleted_at: null
  })).execute();
}

async function writeDemoResetState(
  database: DatabaseExecutor,
  state: DemoResetState,
  timestamp: string
): Promise<void> {
  await writeSetting(database, DEMO_RESET_STATE_SETTING, state, timestamp);
}

export function nextUtcHour(reference: Date): string {
  const next = new Date(reference);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.toISOString();
}

function sameIds(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const sortedExpected = expected.slice().sort();
  return actual.slice().sort().every((value, index) => value === sortedExpected[index]);
}

function requiredText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) throw new Error("demo_seed_invalid");
  return value;
}

async function assertControlledSeedIdentity(
  database: DatabaseExecutor,
  data: ControlledDemoData
): Promise<void> {
  const children = await database.selectFrom("children")
    .select("id")
    .where("deleted_at", "is", null)
    .execute();
  const careParties = await database.selectFrom("care_parties")
    .select("id")
    .where("deleted_at", "is", null)
    .execute();
  if (
    !sameIds(children.map((item) => item.id), data.children.map((item) => requiredText(item, "id"))) ||
    !sameIds(careParties.map((item) => item.id), data.careParties.map((item) => requiredText(item, "id")))
  ) {
    throw new Error("demo_seed_identity_mismatch");
  }
}

const resetDomainTables = [
  "care_confirmation_email_deliveries",
  "care_confirmation_requests",
  "care_entry_actual_children",
  "care_entry_children",
  "trips",
  "costs",
  "care_entries",
  "holiday_period_children",
  "holiday_periods",
  "contact_rule_children",
  "contact_rules",
  "contact_pattern_children",
  "contact_patterns",
  "unavailable_period_children",
  "unavailable_periods",
  "external_calendar_events",
  "external_calendar_sources",
  "monthly_closings",
  "children"
] as const;

export async function replaceControlledDemoDomainData(
  database: DatabaseExecutor,
  data: ControlledDemoData,
  timestamp: string
): Promise<void> {
  await assertControlledSeedIdentity(database, data);
  for (const table of resetDomainTables) {
    await database.deleteFrom(table).execute();
  }
  for (const party of data.careParties) {
    await database.updateTable("care_parties").set({
      name: requiredText(party, "name"),
      kind: requiredText(party, "kind"),
      updated_by: "demo-system",
      updated_at: timestamp,
      deleted_at: null
    }).where("id", "=", requiredText(party, "id")).executeTakeFirstOrThrow();
  }
  for (const child of data.children) {
    await insertChild(child, timestamp, "demo-system", database);
  }
  const fallbackResponsiblePartyId = "demo-party-primary";
  for (const entry of data.entries) {
    await insertEntry(entry, timestamp, "demo-system", fallbackResponsiblePartyId, database);
  }
  for (const holiday of data.holidayPeriods) {
    await insertHoliday(holiday, timestamp, "demo-system", database);
  }
  for (const pattern of data.contactPatterns) {
    await insertPattern(pattern, timestamp, "demo-system", fallbackResponsiblePartyId, database);
  }
  for (const rule of data.contactRules) {
    await insertContactRule(rule, timestamp, "demo-system", fallbackResponsiblePartyId, database);
  }
  for (const period of data.unavailablePeriods) {
    await insertUnavailable(period, timestamp, "demo-system", database);
  }
  for (const source of data.externalCalendarSources) {
    await insertExternalCalendarSource(source, timestamp, database);
  }
  for (const event of data.externalCalendarEvents) {
    await insertExternalCalendarEvent(event, timestamp, database);
  }
  for (const closure of data.monthClosures) {
    await insertMonthClosure(closure, data.updatedAt, timestamp, "demo-system", database);
  }
}

export interface DemoResetCoordinatorOptions {
  enabled: boolean;
  persistence: PersistenceRuntime;
  now?: () => Date;
  beforeReplace?: () => Promise<void>;
  writeGate?: DemoWriteGate;
  replaceDomain?: (
    database: DatabaseExecutor,
    data: ControlledDemoData,
    timestamp: string
  ) => Promise<void>;
}

export class DemoResetCoordinator {
  private activeReset: Promise<DemoResetState | undefined> | undefined;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(private readonly options: DemoResetCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  initialize(): Promise<DemoResetState | undefined> {
    return this.runIfDue(this.now());
  }

  runIfDue(referenceTime = this.now()): Promise<DemoResetState | undefined> {
    if (!this.options.enabled) return Promise.resolve(undefined);
    if (this.activeReset) return this.activeReset;
    const reset = this.performIfDue(referenceTime).finally(() => {
      if (this.activeReset === reset) this.activeReset = undefined;
    });
    this.activeReset = reset;
    return reset;
  }

  async startScheduler(onError: (error: unknown) => void): Promise<void> {
    if (!this.options.enabled || this.closed) return;
    const state = await readDemoResetState(this.options.persistence.query);
    if (state?.status !== "ready") return;
    this.schedule(state.nextResetAt, onError);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(nextResetAt: string, onError: (error: unknown) => void): void {
    if (this.closed) return;
    const delay = Math.max(0, Date.parse(nextResetAt) - this.now().getTime());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runIfDue(this.now()).then((state) => {
        if (state?.status === "ready") this.schedule(state.nextResetAt, onError);
      }).catch(onError);
    }, delay);
    this.timer.unref();
  }

  private async performIfDue(referenceTime: Date): Promise<DemoResetState> {
    const current = await readDemoResetState(this.options.persistence.query);
    if (
      current?.status === "ready" &&
      current.seedVersion === CONTROLLED_DEMO_SEED_VERSION &&
      Date.parse(current.nextResetAt) > referenceTime.getTime()
    ) return current;

    await this.options.writeGate?.blockAndDrain();
    const timestamp = referenceTime.toISOString();
    const generation = current?.sessionGeneration ?? 0;
    const running: DemoResetState = {
      seedVersion: CONTROLLED_DEMO_SEED_VERSION,
      sessionGeneration: generation,
      status: "running",
      nextResetAt: current?.nextResetAt ?? timestamp,
      startedAt: timestamp,
      ...(current?.lastSuccessfulResetAt
        ? { lastSuccessfulResetAt: current.lastSuccessfulResetAt }
        : {})
    };
    await writeDemoResetState(this.options.persistence.query, running, timestamp);

    try {
      const seeded = createControlledDemoData(referenceTime);
      const ready = await this.options.persistence.transaction(async (database) => {
        await this.options.beforeReplace?.();
        await (this.options.replaceDomain ?? replaceControlledDemoDomainData)(
          database,
          seeded.data,
          timestamp
        );
        await database.updateTable("native_oidc_sessions").set({
          revoked_at: timestamp
        }).where("revoked_at", "is", null).execute();
        const state: DemoResetState = {
          seedVersion: seeded.seedVersion,
          sessionGeneration: generation + 1,
          status: "ready",
          lastSuccessfulResetAt: timestamp,
          nextResetAt: nextUtcHour(referenceTime)
        };
        await writeSetting(
          database,
          DEMO_SEED_VERSION_SETTING,
          seeded.seedVersion,
          timestamp
        );
        await writeDemoResetState(database, state, timestamp);
        return state;
      });
      this.options.writeGate?.unblock();
      return ready;
    } catch {
      const failed: DemoResetState = {
        seedVersion: CONTROLLED_DEMO_SEED_VERSION,
        sessionGeneration: generation,
        status: "failed",
        nextResetAt: running.nextResetAt,
        startedAt: timestamp,
        errorCode: "demo_reset_failed",
        ...(current?.lastSuccessfulResetAt
          ? { lastSuccessfulResetAt: current.lastSuccessfulResetAt }
          : {})
      };
      await writeDemoResetState(this.options.persistence.query, failed, timestamp);
      throw Object.assign(new Error("demo_reset_failed"), {
        code: "demo_reset_failed"
      });
    }
  }
}
