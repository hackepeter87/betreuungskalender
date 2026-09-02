import { sql } from "kysely";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import {
  createSqlitePersistenceRuntime,
  type DatabaseExecutor,
  type PersistenceRuntime
} from "../db/runtime.js";
import { appDataImportSchema } from "../validation/schemas.js";
import { importData } from "../routes/appData.js";
import type { WorkspaceRole } from "../auth.js";
import { getClientSettings } from "./settings.js";

const FORMAT_VERSION = 1;
const MAX_RECORDS = 100_000;
const MAX_STRUCTURE_DEPTH = 24;
const MAX_STRING_LENGTH = 250_000;
const MAX_OBJECT_KEYS = 2_000;
const DRY_RUN_RECEIPT_TTL_MS = 15 * 60 * 1000;
const dryRunReceiptSecret = randomBytes(32);

type DataRecord = Record<string, unknown>;
type ImportData = ReturnType<typeof appDataImportSchema.parse>;

export interface PortableActor {
  sourceRef: string;
  displayName: string;
  email?: string;
  suggestedRole?: WorkspaceRole;
  carePartyIds: string[];
}

export interface PortableTransferEnvelope {
  application: "betreuungskalender";
  formatVersion: 1;
  sourceVersion: string;
  exportedAt: string;
  data: ImportData;
  actors: PortableActor[];
  checksum: string;
}

export interface TransferCounts {
  [key: string]: number;
}

export interface TransferDryRunResult {
  fingerprint: string;
  formatVersion: number;
  sourceVersion: string;
  exportedAt?: string;
  result: "ready" | "warnings" | "blocked";
  counts: TransferCounts;
  comparison: TransferComparison[];
  checks: TransferCheck[];
  summary: TransferSummary;
  skippedRuntimeCodes: string[];
  skippedRuntimeData: string[];
  missingReferences: string[];
  warnings: string[];
  actors: Array<PortableActor & { mappingRequired: true }>;
  dryRunReceipt?: string;
}

interface NormalizedTransfer {
  fingerprint: string;
  formatVersion: number;
  sourceVersion: string;
  exportedAt?: string;
  data: ImportData;
  actors: PortableActor[];
  warnings: string[];
}

export type TransferCategoryCode =
  | "children"
  | "care_parties"
  | "care_entries"
  | "holiday_periods"
  | "unavailable_periods"
  | "external_calendar_sources"
  | "external_calendar_events"
  | "contact_patterns"
  | "contact_rules"
  | "audit_records"
  | "month_closures";

export interface TransferComparison {
  category: TransferCategoryCode;
  current: number;
  incoming: number;
  afterImport: number;
}

export interface TransferCheck {
  code: "checksum" | "format" | "schema" | "references" | "sqlite_foreign_keys" | "sqlite_integrity";
  status: "passed" | "warning" | "failed" | "not_run";
}

export interface TransferSummary {
  currentRecords: number;
  incomingRecords: number;
  replacedRecords: number;
  warnings: number;
  actorMappingsRequired: number;
}

const transferCategories: Array<{ code: TransferCategoryCode; key: string }> = [
  { code: "children", key: "children" },
  { code: "care_parties", key: "careParties" },
  { code: "care_entries", key: "entries" },
  { code: "holiday_periods", key: "holidayPeriods" },
  { code: "unavailable_periods", key: "unavailablePeriods" },
  { code: "external_calendar_sources", key: "externalCalendarSources" },
  { code: "external_calendar_events", key: "externalCalendarEvents" },
  { code: "contact_patterns", key: "contactPatterns" },
  { code: "contact_rules", key: "contactRules" },
  { code: "audit_records", key: "auditLog" },
  { code: "month_closures", key: "monthClosures" }
];

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as DataRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function dryRunReceipt(fingerprint: string, result: "ready" | "warnings"): string {
  const expiresAt = Date.now() + DRY_RUN_RECEIPT_TTL_MS;
  const payload = `${fingerprint}:${result}:${expiresAt}`;
  const signature = createHmac("sha256", dryRunReceiptSecret).update(payload).digest("hex");
  return `${expiresAt}.${signature}`;
}

function verifyDryRunReceipt(receipt: string, fingerprint: string, result: "ready" | "warnings"): boolean {
  const [expiresText, signature, ...rest] = receipt.split(".");
  const expiresAt = Number(expiresText);
  if (rest.length || !Number.isSafeInteger(expiresAt) || expiresAt < Date.now() || !signature || !/^[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  const expected = createHmac("sha256", dryRunReceiptSecret)
    .update(`${fingerprint}:${result}:${expiresAt}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

function validateStructure(value: unknown, depth = 0): void {
  if (depth > MAX_STRUCTURE_DEPTH) throw new Error("Transfer package structure is too deeply nested.");
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    throw new Error("Transfer package contains an oversized text value.");
  }
  if (Array.isArray(value)) {
    for (const item of value) validateStructure(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const entries = Object.entries(value as DataRecord);
  if (entries.length > MAX_OBJECT_KEYS) throw new Error("Transfer package object contains too many fields.");
  for (const [key, item] of entries) {
    if (key.length > 200) throw new Error("Transfer package contains an oversized field name.");
    validateStructure(item, depth + 1);
  }
}

function envelopePayload(envelope: Omit<PortableTransferEnvelope, "checksum">): string {
  return canonicalJson(envelope);
}

function toCamel(key: string): string {
  return key
    .replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
    .replace(/Datetime/g, "DateTime");
}

function camelRecord(row: DataRecord): DataRecord {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [toCamel(key), value]));
}

type ActiveDomainTable =
  | "children"
  | "care_parties"
  | "care_entries"
  | "trips"
  | "costs"
  | "holiday_periods"
  | "unavailable_periods"
  | "contact_patterns"
  | "contact_rules";

async function activeRows(
  database: DatabaseExecutor,
  table: ActiveDomainTable
): Promise<DataRecord[]> {
  const rows = await database.selectFrom(table)
    .selectAll()
    .where("deleted_at", "is", null)
    .execute();
  return (rows as DataRecord[]).map(camelRecord);
}

type ChildJunction =
  | { table: "care_entry_children"; parentColumn: "care_entry_id" }
  | { table: "care_entry_actual_children"; parentColumn: "care_entry_id" }
  | { table: "holiday_period_children"; parentColumn: "holiday_period_id" }
  | { table: "contact_pattern_children"; parentColumn: "contact_pattern_id" }
  | { table: "contact_rule_children"; parentColumn: "contact_rule_id" }
  | { table: "unavailable_period_children"; parentColumn: "unavailable_period_id" };

async function junctionMap(
  database: DatabaseExecutor,
  junction: ChildJunction
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const rows = await database.selectFrom(junction.table)
    .select([
      sql.ref(junction.parentColumn).as("parentId"),
      "child_id as childId"
    ])
    .where("deleted_at", "is", null)
    .orderBy("child_id")
    .execute() as Array<{ parentId: string; childId: string }>;
  for (const row of rows) result.set(row.parentId, [...(result.get(row.parentId) ?? []), row.childId]);
  return result;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function boolFields(record: DataRecord, fields: string[]): DataRecord {
  for (const field of fields) record[field] = Boolean(record[field]);
  return record;
}

async function exportedSettings(database: DatabaseExecutor): Promise<Record<string, unknown>> {
  return { ...await getClientSettings(database) };
}

export async function exportDomainData(
  database: DatabaseExecutor
): Promise<ImportData> {
  const [
    entryChildren,
    actualChildren,
    holidayChildren,
    patternChildren,
    ruleChildren,
    unavailableChildren
  ] = await Promise.all([
    junctionMap(database, { table: "care_entry_children", parentColumn: "care_entry_id" }),
    junctionMap(database, { table: "care_entry_actual_children", parentColumn: "care_entry_id" }),
    junctionMap(database, { table: "holiday_period_children", parentColumn: "holiday_period_id" }),
    junctionMap(database, { table: "contact_pattern_children", parentColumn: "contact_pattern_id" }),
    junctionMap(database, { table: "contact_rule_children", parentColumn: "contact_rule_id" }),
    junctionMap(database, { table: "unavailable_period_children", parentColumn: "unavailable_period_id" })
  ]);

  const tripsByEntry = new Map<string, DataRecord[]>();
  for (const trip of await activeRows(database, "trips")) {
    const entryId = String(trip.careEntryId ?? "");
    delete trip.careEntryId;
    boolFields(trip, ["ownCar", "reimbursed"]);
    tripsByEntry.set(entryId, [...(tripsByEntry.get(entryId) ?? []), trip]);
  }
  const costsByEntry = new Map<string, DataRecord[]>();
  for (const cost of await activeRows(database, "costs")) {
    const entryId = String(cost.careEntryId ?? "");
    delete cost.careEntryId;
    costsByEntry.set(entryId, [...(costsByEntry.get(entryId) ?? []), cost]);
  }

  const entries = (await activeRows(database, "care_entries")).map((entry) => {
    const id = String(entry.id);
    return {
      ...boolFields(entry, [
        "overnight", "schoolHandover", "holiday", "weekend", "additionalCare", "hasEvidence"
      ]),
      childIds: entryChildren.get(id) ?? [],
      actualChildIds: actualChildren.get(id) ?? [],
      trips: tripsByEntry.get(id) ?? [],
      costs: costsByEntry.get(id) ?? []
    };
  });

  const settings = await exportedSettings(database);
  const [childrenUpdated, entriesUpdated, settingsUpdated] = await Promise.all([
    database.selectFrom("children").select(({ fn }) => fn.max<string>("updated_at").as("value")).executeTakeFirst(),
    database.selectFrom("care_entries").select(({ fn }) => fn.max<string>("updated_at").as("value")).executeTakeFirst(),
    database.selectFrom("settings").select(({ fn }) => fn.max<string>("updated_at").as("value")).executeTakeFirst()
  ]);
  const updatedAt = [childrenUpdated?.value, entriesUpdated?.value, settingsUpdated?.value]
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);
  const [
    children,
    careParties,
    holidayPeriods,
    unavailablePeriods,
    externalCalendarSources,
    externalCalendarEvents,
    contactPatterns,
    contactRules,
    auditRows,
    closingRows
  ] = await Promise.all([
    activeRows(database, "children"),
    activeRows(database, "care_parties"),
    activeRows(database, "holiday_periods"),
    activeRows(database, "unavailable_periods"),
    database.selectFrom("external_calendar_sources")
      .select([
        "id", "name", "color", "visible", "source_type", "source_kind",
        "last_imported_at", "last_refresh_at", "last_refresh_error", "created_at", "updated_at"
      ])
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    database.selectFrom("external_calendar_events")
      .select([
        "id", "source_id", "ical_uid", "recurrence_id", "title", "description",
        "start_datetime", "end_datetime", "all_day", "location", "raw_hash", "created_at", "updated_at"
      ])
      .orderBy("start_datetime")
      .orderBy("id")
      .execute(),
    activeRows(database, "contact_patterns"),
    activeRows(database, "contact_rules"),
    database.selectFrom("audit_log as audit")
      .leftJoin("app_users as users", "users.id", "audit.user_email")
      .leftJoin("data_transfer_actors as actors", "actors.id", "audit.user_email")
      .select([
        "audit.id", "audit.timestamp", "audit.user_email as userId",
        (expression) => expression.fn.coalesce("users.display_name", "actors.display_name").as("userDisplayName"),
        "audit.entity_type as objectType", "audit.entity_id as objectId",
        "audit.field_name as fieldName", "audit.old_value as oldValue",
        "audit.new_value as newValue", "audit.action"
      ])
      .where("audit.deleted_at", "is", null)
      .orderBy("audit.timestamp")
      .orderBy("audit.id")
      .execute(),
    database.selectFrom("monthly_closings")
      .select([
        "month_key", "created_at as closed_at", "closed_by", "summary_json",
        "changed_after_close_at", "updated_by", "updated_at"
      ])
      .where("deleted_at", "is", null)
      .orderBy("month_key")
      .execute()
  ]);

  return appDataImportSchema.parse({
    schemaVersion: 6,
    children,
    careParties,
    entries,
    holidayPeriods: holidayPeriods.map((item) => ({
      ...item,
      childIds: holidayChildren.get(String(item.id)) ?? []
    })),
    unavailablePeriods: unavailablePeriods.map((item) => ({
      ...boolFields(item, ["dutyRelated", "affectsContact", "affectsHolidays", "hasEvidence"]),
      childIds: unavailableChildren.get(String(item.id)) ?? []
    })),
    externalCalendarSources: (externalCalendarSources as DataRecord[])
      .map((row) => boolFields(camelRecord(row), ["visible"])),
    externalCalendarEvents: (externalCalendarEvents as DataRecord[])
      .map((row) => boolFields(camelRecord(row), ["allDay"])),
    contactPatterns: contactPatterns.map((item) => ({
      ...boolFields(item, ["active"]),
      childIds: patternChildren.get(String(item.id)) ?? []
    })),
    contactRules: contactRules.map((item) => ({
      ...boolFields(item, ["active"]),
      recurrence: parseJson(item.recurrenceJson, {}),
      segments: parseJson(item.segmentsJson, []),
      childIds: ruleChildren.get(String(item.id)) ?? []
    })),
    auditLog: auditRows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      userId: row.userId,
      userDisplayName: row.userDisplayName ?? undefined,
      objectType: row.objectType,
      objectId: row.objectId,
      objectLabel: `${row.objectType} ${row.objectId}`,
      field: row.fieldName ?? row.action,
      oldValue: row.oldValue ?? "",
      newValue: row.newValue ?? "",
      action: row.action
    })),
    monthClosures: closingRows.map((row) => {
      const item = camelRecord(row as DataRecord);
      const summary = parseJson(item.summaryJson, {}) as DataRecord;
      return {
        monthKey: item.monthKey,
        closedAt: item.closedAt,
        closedBy: item.closedBy,
        dataUpdatedAt: summary.dataUpdatedAt ?? item.updatedAt,
        summary: summary.summary ?? summary,
        changedAfterCloseAt: item.changedAfterCloseAt,
        updatedBy: item.updatedBy
      };
    }),
    lastJsonBackupAt: settings.lastJsonBackupAt,
    settings,
    updatedAt: updatedAt ?? new Date().toISOString()
  });
}

function referencedActorIds(data: ImportData): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) ids.add(value);
  };
  for (const collection of [
    data.children, data.careParties, data.entries, data.holidayPeriods,
    data.unavailablePeriods, data.contactPatterns, data.contactRules, data.auditLog,
    data.monthClosures
  ]) {
    for (const record of collection) {
      add(record.createdBy);
      add(record.updatedBy);
      add(record.confirmedBy);
      add(record.userId);
      add(record.closedBy);
      for (const nested of [record.trips, record.costs]) {
        if (!Array.isArray(nested)) continue;
        for (const item of nested) {
          if (item && typeof item === "object") {
            add((item as DataRecord).createdBy);
            add((item as DataRecord).updatedBy);
          }
        }
      }
    }
  }
  return ids;
}

async function exportActors(
  data: ImportData,
  database: DatabaseExecutor
): Promise<PortableActor[]> {
  const actors: PortableActor[] = [];
  for (const sourceRef of referencedActorIds(data)) {
    const [row, assignments] = await Promise.all([
      database.selectFrom("app_users as users")
        .leftJoin("app_memberships as memberships", (join) => join
          .onRef("memberships.user_id", "=", "users.id")
          .on("memberships.deleted_at", "is", null))
        .select([
          "users.display_name as displayName",
          "users.email",
          "memberships.role"
        ])
        .where("users.id", "=", sourceRef)
        .executeTakeFirst(),
      database.selectFrom("app_user_care_party_assignments")
        .select("care_party_id as carePartyId")
        .where("user_id", "=", sourceRef)
        .where("deleted_at", "is", null)
        .orderBy("care_party_id")
        .execute()
    ]);
    const role = row?.role as WorkspaceRole | null | undefined;
    actors.push({
      sourceRef,
      displayName: row?.displayName ?? sourceRef,
      ...(row?.email ? { email: row.email } : {}),
      ...(role ? { suggestedRole: role } : {}),
      carePartyIds: assignments.map((item) => item.carePartyId)
    });
  }
  return actors.sort((left, right) => left.sourceRef.localeCompare(right.sourceRef));
}

export async function createPortableTransfer(
  runtime: PersistenceRuntime
): Promise<PortableTransferEnvelope> {
  return runtime.transaction(async (database) => {
    const withoutChecksum = {
      application: "betreuungskalender" as const,
      formatVersion: FORMAT_VERSION as 1,
      sourceVersion: config.version,
      exportedAt: new Date().toISOString(),
      data: await exportDomainData(database),
      actors: [] as PortableActor[]
    };
    withoutChecksum.actors = await exportActors(withoutChecksum.data, database);
    return { ...withoutChecksum, checksum: sha256(envelopePayload(withoutChecksum)) };
  });
}

function countRecords(data: ImportData): TransferCounts {
  return {
    children: data.children.length,
    careParties: data.careParties.length,
    entries: data.entries.length,
    holidayPeriods: data.holidayPeriods.length,
    unavailablePeriods: data.unavailablePeriods.length,
    externalCalendarSources: data.externalCalendarSources.length,
    externalCalendarEvents: data.externalCalendarEvents.length,
    contactPatterns: data.contactPatterns.length,
    contactRules: data.contactRules.length,
    auditLog: data.auditLog.length,
    monthClosures: data.monthClosures.length
  };
}

function normalizeTransfer(input: unknown): NormalizedTransfer {
  validateStructure(input);
  const serialized = JSON.stringify(input);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > config.dataTransferMaxBytes) throw new Error("Transfer package exceeds the configured size limit.");
  if (!input || typeof input !== "object") throw new Error("Transfer package is invalid.");
  const record = input as DataRecord;
  if (record.application === "betreuungskalender" && record.formatVersion === FORMAT_VERSION) {
    const checksum = typeof record.checksum === "string" ? record.checksum : "";
    const withoutChecksum = { ...record };
    delete withoutChecksum.checksum;
    const expected = sha256(envelopePayload(withoutChecksum as Omit<PortableTransferEnvelope, "checksum">));
    if (checksum !== expected) throw new Error("Transfer package checksum is invalid.");
    const data = appDataImportSchema.parse(record.data);
    const actors = Array.isArray(record.actors)
      ? record.actors.map((actor) => {
          if (!actor || typeof actor !== "object") throw new Error("Transfer actor is invalid.");
          const item = actor as DataRecord;
          const sourceRef = String(item.sourceRef ?? "").trim();
          const displayName = String(item.displayName ?? "").trim();
          if (!sourceRef || !displayName) throw new Error("Transfer actor is incomplete.");
          const role = item.suggestedRole;
          return {
            sourceRef,
            displayName,
            ...(typeof item.email === "string" && item.email.trim() ? { email: item.email.trim() } : {}),
            ...(role === "admin" || role === "editor" || role === "scheduler" || role === "viewer"
              ? { suggestedRole: role }
              : {}),
            carePartyIds: Array.isArray(item.carePartyIds)
              ? item.carePartyIds.filter((value): value is string => typeof value === "string")
              : []
          } satisfies PortableActor;
        })
      : [];
    return {
      fingerprint: checksum,
      formatVersion: FORMAT_VERSION,
      sourceVersion: String(record.sourceVersion ?? "unknown"),
      ...(typeof record.exportedAt === "string" ? { exportedAt: record.exportedAt } : {}),
      data,
      actors,
      warnings: []
    };
  }

  if (record.application === "betreuungskalender" && record.data && record.formatVersion !== undefined) {
    throw new Error("Transfer package format version is incompatible.");
  }

  const legacyData = record.application === "betreuungskalender" && record.data
    ? record.data
    : record;
  const data = appDataImportSchema.parse(legacyData);
  return {
    fingerprint: sha256(canonicalJson(data)),
    formatVersion: 0,
    sourceVersion: "legacy-json",
    data,
    actors: [],
    warnings: ["Legacy JSON package has no portable actor snapshots."]
  };
}

function transferComparison(incoming: TransferCounts, current: TransferCounts): TransferComparison[] {
  return transferCategories.map(({ code, key }) => ({
    category: code,
    current: current[key] ?? 0,
    incoming: incoming[key] ?? 0,
    afterImport: incoming[key] ?? 0
  }));
}

function transferSummary(
  comparison: TransferComparison[],
  warnings: number,
  actorMappingsRequired: number
): TransferSummary {
  return {
    currentRecords: comparison.reduce((sum, item) => sum + item.current, 0),
    incomingRecords: comparison.reduce((sum, item) => sum + item.incoming, 0),
    replacedRecords: comparison.reduce((sum, item) => sum + item.current, 0),
    warnings,
    actorMappingsRequired
  };
}

function baseChecks(normalized: NormalizedTransfer): TransferCheck[] {
  return [
    { code: "checksum", status: normalized.formatVersion === FORMAT_VERSION ? "passed" : "warning" },
    { code: "format", status: normalized.formatVersion === FORMAT_VERSION ? "passed" : "warning" },
    { code: "schema", status: "passed" },
    { code: "references", status: "passed" },
    { code: "sqlite_foreign_keys", status: "not_run" },
    { code: "sqlite_integrity", status: "not_run" }
  ];
}

function missingReferences(data: ImportData): string[] {
  const missing = new Set<string>();
  const children = new Set(data.children.map((item) => String(item.id)));
  const parties = new Set(data.careParties.map((item) => String(item.id)));
  const sources = new Set(data.externalCalendarSources.map((item) => String(item.id)));
  const requireChildren = (record: DataRecord, label: string) => {
    const values = Array.isArray(record.childIds) ? record.childIds : [];
    for (const id of values) if (typeof id === "string" && !children.has(id)) missing.add(`${label}:child`);
  };
  for (const entry of data.entries) {
    requireChildren(entry, "entry");
    for (const key of ["responsiblePartyId", "actualResponsiblePartyId"]) {
      const value = entry[key];
      if (typeof value === "string" && value && !parties.has(value)) missing.add(`entry:${key}`);
    }
  }
  for (const item of [...data.holidayPeriods, ...data.contactPatterns, ...data.contactRules, ...data.unavailablePeriods]) {
    requireChildren(item, "domain-record");
  }
  for (const event of data.externalCalendarEvents) {
    const sourceId = event.sourceId;
    if (typeof sourceId === "string" && !sources.has(sourceId)) missing.add("external-event:source");
  }
  return [...missing].sort();
}

function mappedActorId(fingerprint: string, sourceRef: string): string {
  return `transfer_actor_${sha256(`${fingerprint}:${sourceRef}`).slice(0, 24)}`;
}

function remapActorReferences(data: ImportData, actors: PortableActor[], fingerprint: string): ImportData {
  const mapping = new Map(actors.map((actor) => [actor.sourceRef, mappedActorId(fingerprint, actor.sourceRef)]));
  const actorKeys = new Set(["createdBy", "updatedBy", "confirmedBy", "userId", "closedBy"]);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as DataRecord).map(([key, entry]) => [
      key,
      actorKeys.has(key) && typeof entry === "string" ? mapping.get(entry) ?? entry : visit(entry)
    ]));
  };
  return appDataImportSchema.parse(visit(data));
}

export async function dryRunPortableTransfer(
  input: unknown,
  targetRuntime: PersistenceRuntime
): Promise<TransferDryRunResult> {
  const normalized = normalizeTransfer(input);
  const counts = countRecords(normalized.data);
  const currentData = await targetRuntime.transaction((database) => exportDomainData(database));
  const currentCounts = countRecords(currentData);
  const comparison = transferComparison(counts, currentCounts);
  const checks = baseChecks(normalized);
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) > MAX_RECORDS) {
    throw new Error("Transfer package contains too many records.");
  }
  const references = missingReferences(normalized.data);
  if (references.length) {
    checks.find((check) => check.code === "references")!.status = "failed";
    return {
      fingerprint: normalized.fingerprint,
      formatVersion: normalized.formatVersion,
      sourceVersion: normalized.sourceVersion,
      ...(normalized.exportedAt ? { exportedAt: normalized.exportedAt } : {}),
      result: "blocked",
      counts,
      comparison,
      checks,
      summary: transferSummary(comparison, normalized.warnings.length, normalized.actors.length),
      skippedRuntimeCodes: skippedRuntimeCodes(),
      skippedRuntimeData: skippedRuntimeData(),
      missingReferences: references,
      warnings: normalized.warnings,
      actors: normalized.actors.map((actor) => ({ ...actor, mappingRequired: true as const }))
    };
  }

  const temporary = createSqlitePersistenceRuntime(":memory:");
  try {
    await temporary.migrate();
    const data = remapActorReferences(normalized.data, normalized.actors, normalized.fingerprint);
    await temporary.transaction((database) => importData(data, "transfer-validation", database));
    const integrity = await temporary.integrity();
    checks.find((check) => check.code === "sqlite_foreign_keys")!.status = integrity.foreignKeyViolations ? "failed" : "passed";
    checks.find((check) => check.code === "sqlite_integrity")!.status = integrity.valid ? "passed" : "failed";
    if (!integrity.valid) {
      throw new Error("Transfer package failed database integrity validation.");
    }
  } finally {
    await temporary.close();
  }

  const result = normalized.warnings.length ? "warnings" : "ready";
  return {
    fingerprint: normalized.fingerprint,
    formatVersion: normalized.formatVersion,
    sourceVersion: normalized.sourceVersion,
    ...(normalized.exportedAt ? { exportedAt: normalized.exportedAt } : {}),
    result,
    counts,
    comparison,
    checks,
    summary: transferSummary(comparison, normalized.warnings.length, normalized.actors.length),
    skippedRuntimeCodes: skippedRuntimeCodes(),
    skippedRuntimeData: skippedRuntimeData(),
    missingReferences: [],
    warnings: normalized.warnings,
    actors: normalized.actors.map((actor) => ({ ...actor, mappingRequired: true as const })),
    dryRunReceipt: dryRunReceipt(normalized.fingerprint, result)
  };
}

function skippedRuntimeCodes(): string[] {
  return ["identity", "sessions", "feeds_push", "credentials", "external_urls"];
}

function skippedRuntimeData(): string[] {
  return [
    "identity-provider subjects and claims",
    "sessions and onboarding tokens",
    "calendar feed tokens and push subscriptions",
    "recovery credentials and runtime secrets",
    "external calendar feed URLs"
  ];
}

async function insertImportedActors(
  database: DatabaseExecutor,
  runId: string,
  fingerprint: string,
  actors: PortableActor[],
  actorId: string,
  timestamp: string
): Promise<void> {
  for (const actor of actors) {
    const id = mappedActorId(fingerprint, actor.sourceRef);
    await database.insertInto("data_transfer_actors").values({
      id,
      transfer_run_id: runId,
      source_ref: actor.sourceRef,
      display_name: actor.displayName,
      email_hint: actor.email ?? null,
      suggested_role: actor.suggestedRole ?? null,
      mapped_user_id: null,
      invitation_id: null,
      created_by: actorId,
      updated_by: actorId,
      created_at: timestamp,
      updated_at: timestamp
    }).execute();
    for (const carePartyId of actor.carePartyIds) {
      const exists = await database.selectFrom("care_parties")
        .select("id")
        .where("id", "=", carePartyId)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      await database.insertInto("data_transfer_actor_care_parties").values({
        actor_id: id,
        source_care_party_id: carePartyId,
        target_care_party_id: exists ? carePartyId : null,
        created_at: timestamp,
        updated_at: timestamp
      }).execute();
    }
  }
}

export async function importPortableTransfer(input: {
  package: unknown;
  fingerprint: string;
  dryRunReceipt: string;
  confirmWarnings: boolean;
  actorId: string;
}, runtime: PersistenceRuntime): Promise<TransferDryRunResult> {
  const result = await dryRunPortableTransfer(input.package, runtime);
  if (result.result === "blocked") throw new Error("Transfer package is blocked.");
  if (result.fingerprint !== input.fingerprint) throw new Error("Transfer package differs from the tested package.");
  if (!verifyDryRunReceipt(input.dryRunReceipt, result.fingerprint, result.result)) {
    throw new Error("Transfer package requires a current successful dry run.");
  }
  if (result.result === "warnings" && !input.confirmWarnings) {
    throw new Error("Transfer warnings must be confirmed before import.");
  }
  const normalized = normalizeTransfer(input.package);
  const timestamp = new Date().toISOString();
  const runId = randomUUID();
  const data = remapActorReferences(normalized.data, normalized.actors, normalized.fingerprint);
  await runtime.transaction(async (database) => {
    await database.updateTable("app_invitations")
      .set({ data_transfer_actor_id: null })
      .where("data_transfer_actor_id", "is not", null)
      .execute();
    await database.deleteFrom("data_transfer_actor_care_parties").execute();
    await database.deleteFrom("data_transfer_actors").execute();
    await database.deleteFrom("data_transfer_runs").execute();
    await importData(data, input.actorId, database);
    await database.insertInto("data_transfer_runs").values({
      id: runId,
      package_fingerprint: result.fingerprint,
      format_version: result.formatVersion,
      source_version: result.sourceVersion,
      result: "imported",
      counts_json: JSON.stringify(result.counts),
      warnings_json: JSON.stringify(result.warnings),
      created_by: input.actorId,
      created_at: timestamp,
      imported_at: timestamp
    }).execute();
    await insertImportedActors(database, runId, result.fingerprint, normalized.actors, input.actorId, timestamp);
  });
  return result;
}

export async function listTransferActors(
  database: DatabaseExecutor
): Promise<Array<DataRecord>> {
  const [actors, assignments] = await Promise.all([
    database.selectFrom("data_transfer_actors as actors")
      .innerJoin("data_transfer_runs as runs", "runs.id", "actors.transfer_run_id")
      .select([
        "actors.id", "actors.display_name as displayName", "actors.email_hint as email",
        "actors.suggested_role as suggestedRole", "actors.mapped_user_id as mappedUserId",
        "actors.invitation_id as invitationId", "runs.package_fingerprint as packageFingerprint"
      ])
      .orderBy("actors.display_name")
      .orderBy("actors.id")
      .execute(),
    database.selectFrom("data_transfer_actor_care_parties")
      .select(["actor_id", "target_care_party_id"])
      .where("target_care_party_id", "is not", null)
      .orderBy("target_care_party_id")
      .execute()
  ]);
  const carePartiesByActor = new Map<string, string[]>();
  for (const assignment of assignments) {
    if (!assignment.target_care_party_id) continue;
    carePartiesByActor.set(assignment.actor_id, [
      ...(carePartiesByActor.get(assignment.actor_id) ?? []),
      assignment.target_care_party_id
    ]);
  }
  return actors.map((actor) => ({
    ...actor,
    carePartyIds: carePartiesByActor.get(actor.id) ?? []
  }));
}
