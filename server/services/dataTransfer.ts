import Database from "better-sqlite3";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { migrateDatabase } from "../db/migrationRunner.js";
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
  result: "ready" | "warnings" | "blocked";
  counts: TransferCounts;
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
  data: ImportData;
  actors: PortableActor[];
  warnings: string[];
}

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

function activeRows(database: Database.Database, table: string): DataRecord[] {
  return (database.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL`).all() as DataRecord[])
    .map(camelRecord);
}

function junctionMap(
  database: Database.Database,
  table: string,
  parentColumn: string
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const rows = database.prepare(`
    SELECT ${parentColumn} AS parentId, child_id AS childId
    FROM ${table}
    WHERE deleted_at IS NULL
    ORDER BY child_id
  `).all() as Array<{ parentId: string; childId: string }>;
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

function exportedSettings(database: Database.Database): Record<string, unknown> {
  return getClientSettings(database);
}

export function exportDomainData(database: Database.Database = db): ImportData {
  const entryChildren = junctionMap(database, "care_entry_children", "care_entry_id");
  const actualChildren = junctionMap(database, "care_entry_actual_children", "care_entry_id");
  const holidayChildren = junctionMap(database, "holiday_period_children", "holiday_period_id");
  const patternChildren = junctionMap(database, "contact_pattern_children", "contact_pattern_id");
  const ruleChildren = junctionMap(database, "contact_rule_children", "contact_rule_id");
  const unavailableChildren = junctionMap(database, "unavailable_period_children", "unavailable_period_id");

  const tripsByEntry = new Map<string, DataRecord[]>();
  for (const trip of activeRows(database, "trips")) {
    const entryId = String(trip.careEntryId ?? "");
    delete trip.careEntryId;
    boolFields(trip, ["ownCar", "reimbursed"]);
    tripsByEntry.set(entryId, [...(tripsByEntry.get(entryId) ?? []), trip]);
  }
  const costsByEntry = new Map<string, DataRecord[]>();
  for (const cost of activeRows(database, "costs")) {
    const entryId = String(cost.careEntryId ?? "");
    delete cost.careEntryId;
    costsByEntry.set(entryId, [...(costsByEntry.get(entryId) ?? []), cost]);
  }

  const entries = activeRows(database, "care_entries").map((entry) => {
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

  const settings = exportedSettings(database);
  const updatedAt = database.prepare(`
    SELECT MAX(value) AS value FROM (
      SELECT MAX(updated_at) AS value FROM children
      UNION ALL SELECT MAX(updated_at) FROM care_entries
      UNION ALL SELECT MAX(updated_at) FROM settings
    )
  `).get() as { value: string | null };

  return appDataImportSchema.parse({
    schemaVersion: 6,
    children: activeRows(database, "children"),
    careParties: activeRows(database, "care_parties"),
    entries,
    holidayPeriods: activeRows(database, "holiday_periods").map((item) => ({
      ...item,
      childIds: holidayChildren.get(String(item.id)) ?? []
    })),
    unavailablePeriods: activeRows(database, "unavailable_periods").map((item) => ({
      ...boolFields(item, ["dutyRelated", "affectsContact", "affectsHolidays", "hasEvidence"]),
      childIds: unavailableChildren.get(String(item.id)) ?? []
    })),
    externalCalendarSources: (database.prepare(`
      SELECT id, name, color, visible, source_type, source_kind,
        last_imported_at, last_refresh_at, last_refresh_error, created_at, updated_at
      FROM external_calendar_sources
      ORDER BY created_at, id
    `).all() as DataRecord[]).map((row) => boolFields(camelRecord(row), ["visible"])),
    externalCalendarEvents: (database.prepare(`
      SELECT id, source_id, ical_uid, recurrence_id, title, description,
        start_datetime, end_datetime, all_day, location, raw_hash, created_at, updated_at
      FROM external_calendar_events
      ORDER BY start_datetime, id
    `).all() as DataRecord[]).map((row) => boolFields(camelRecord(row), ["allDay"])),
    contactPatterns: activeRows(database, "contact_patterns").map((item) => ({
      ...boolFields(item, ["active"]),
      childIds: patternChildren.get(String(item.id)) ?? []
    })),
    contactRules: activeRows(database, "contact_rules").map((item) => ({
      ...boolFields(item, ["active"]),
      recurrence: parseJson(item.recurrenceJson, {}),
      segments: parseJson(item.segmentsJson, []),
      childIds: ruleChildren.get(String(item.id)) ?? []
    })),
    auditLog: (database.prepare(`
      SELECT audit.id, audit.timestamp, audit.user_email AS userId,
        COALESCE(users.display_name, actors.display_name) AS userDisplayName,
        audit.entity_type AS objectType, audit.entity_id AS objectId,
        audit.entity_type || ' ' || audit.entity_id AS objectLabel,
        COALESCE(audit.field_name, audit.action) AS field,
        COALESCE(audit.old_value, '') AS oldValue,
        COALESCE(audit.new_value, '') AS newValue,
        audit.action
      FROM audit_log audit
      LEFT JOIN app_users users ON users.id = audit.user_email
      LEFT JOIN data_transfer_actors actors ON actors.id = audit.user_email
      WHERE audit.deleted_at IS NULL
      ORDER BY audit.timestamp, audit.id
    `).all() as DataRecord[]).map(camelRecord),
    monthClosures: (database.prepare(`
      SELECT month_key, created_at AS closed_at, closed_by,
        summary_json, changed_after_close_at, updated_by, updated_at
      FROM monthly_closings
      WHERE deleted_at IS NULL
      ORDER BY month_key
    `).all() as DataRecord[]).map((row) => {
      const item = camelRecord(row);
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
    updatedAt: updatedAt.value ?? new Date().toISOString()
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

function exportActors(data: ImportData, database: Database.Database): PortableActor[] {
  const actors: PortableActor[] = [];
  const user = database.prepare(`
    SELECT users.display_name AS displayName, users.email,
      memberships.role AS role
    FROM app_users users
    LEFT JOIN app_memberships memberships
      ON memberships.user_id = users.id AND memberships.deleted_at IS NULL
    WHERE users.id = ?
  `);
  const assignments = database.prepare(`
    SELECT care_party_id AS carePartyId
    FROM app_user_care_party_assignments
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY care_party_id
  `);
  for (const sourceRef of referencedActorIds(data)) {
    const row = user.get(sourceRef) as {
      displayName: string;
      email: string | null;
      role: WorkspaceRole | null;
    } | undefined;
    actors.push({
      sourceRef,
      displayName: row?.displayName ?? sourceRef,
      ...(row?.email ? { email: row.email } : {}),
      ...(row?.role ? { suggestedRole: row.role } : {}),
      carePartyIds: (assignments.all(sourceRef) as Array<{ carePartyId: string }>).map((item) => item.carePartyId)
    });
  }
  return actors.sort((left, right) => left.sourceRef.localeCompare(right.sourceRef));
}

export function createPortableTransfer(database: Database.Database = db): PortableTransferEnvelope {
  const withoutChecksum = {
    application: "betreuungskalender" as const,
    formatVersion: FORMAT_VERSION as 1,
    sourceVersion: config.version,
    exportedAt: new Date().toISOString(),
    data: exportDomainData(database),
    actors: [] as PortableActor[]
  };
  withoutChecksum.actors = exportActors(withoutChecksum.data, database);
  return { ...withoutChecksum, checksum: sha256(envelopePayload(withoutChecksum)) };
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
      data,
      actors,
      warnings: []
    };
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

export function dryRunPortableTransfer(input: unknown): TransferDryRunResult {
  const normalized = normalizeTransfer(input);
  const counts = countRecords(normalized.data);
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) > MAX_RECORDS) {
    throw new Error("Transfer package contains too many records.");
  }
  const references = missingReferences(normalized.data);
  if (references.length) {
    return {
      fingerprint: normalized.fingerprint,
      formatVersion: normalized.formatVersion,
      sourceVersion: normalized.sourceVersion,
      result: "blocked",
      counts,
      skippedRuntimeData: skippedRuntimeData(),
      missingReferences: references,
      warnings: normalized.warnings,
      actors: normalized.actors.map((actor) => ({ ...actor, mappingRequired: true as const }))
    };
  }

  const temporary = new Database(":memory:");
  try {
    temporary.pragma("foreign_keys = ON");
    migrateDatabase(temporary);
    const data = remapActorReferences(normalized.data, normalized.actors, normalized.fingerprint);
    temporary.transaction(() => importData(data, "transfer-validation", temporary))();
    const foreignKeys = temporary.pragma("foreign_key_check") as unknown[];
    const integrity = temporary.pragma("integrity_check") as Array<{ integrity_check: string }>;
    if (foreignKeys.length || integrity.some((row) => row.integrity_check !== "ok")) {
      throw new Error("Transfer package failed database integrity validation.");
    }
  } finally {
    temporary.close();
  }

  const result = normalized.warnings.length ? "warnings" : "ready";
  return {
    fingerprint: normalized.fingerprint,
    formatVersion: normalized.formatVersion,
    sourceVersion: normalized.sourceVersion,
    result,
    counts,
    skippedRuntimeData: skippedRuntimeData(),
    missingReferences: [],
    warnings: normalized.warnings,
    actors: normalized.actors.map((actor) => ({ ...actor, mappingRequired: true as const })),
    dryRunReceipt: dryRunReceipt(normalized.fingerprint, result)
  };
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

function insertImportedActors(
  database: Database.Database,
  runId: string,
  fingerprint: string,
  actors: PortableActor[],
  actorId: string,
  timestamp: string
): void {
  const actorInsert = database.prepare(`
    INSERT INTO data_transfer_actors (
      id, transfer_run_id, source_ref, display_name, email_hint, suggested_role,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const carePartyInsert = database.prepare(`
    INSERT INTO data_transfer_actor_care_parties (
      actor_id, source_care_party_id, target_care_party_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const actor of actors) {
    const id = mappedActorId(fingerprint, actor.sourceRef);
    actorInsert.run(
      id, runId, actor.sourceRef, actor.displayName, actor.email ?? null,
      actor.suggestedRole ?? null, actorId, actorId, timestamp, timestamp
    );
    for (const carePartyId of actor.carePartyIds) {
      const exists = database.prepare("SELECT 1 FROM care_parties WHERE id = ? AND deleted_at IS NULL").get(carePartyId);
      carePartyInsert.run(id, carePartyId, exists ? carePartyId : null, timestamp, timestamp);
    }
  }
}

export function importPortableTransfer(input: {
  package: unknown;
  fingerprint: string;
  dryRunReceipt: string;
  confirmWarnings: boolean;
  actorId: string;
}, database: Database.Database = db): TransferDryRunResult {
  const result = dryRunPortableTransfer(input.package);
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
  database.transaction(() => {
    database.prepare("UPDATE app_invitations SET data_transfer_actor_id = NULL WHERE data_transfer_actor_id IS NOT NULL").run();
    database.prepare("DELETE FROM data_transfer_actor_care_parties").run();
    database.prepare("DELETE FROM data_transfer_actors").run();
    database.prepare("DELETE FROM data_transfer_runs").run();
    importData(data, input.actorId, database);
    database.prepare(`
      INSERT INTO data_transfer_runs (
        id, package_fingerprint, format_version, source_version, result,
        counts_json, warnings_json, created_by, created_at, imported_at
      ) VALUES (?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?)
    `).run(
      runId, result.fingerprint, result.formatVersion, result.sourceVersion,
      JSON.stringify(result.counts), JSON.stringify(result.warnings), input.actorId, timestamp, timestamp
    );
    insertImportedActors(database, runId, result.fingerprint, normalized.actors, input.actorId, timestamp);
  })();
  return result;
}

export function listTransferActors(database: Database.Database = db): Array<DataRecord> {
  return database.prepare(`
    SELECT actors.id, actors.display_name AS displayName, actors.email_hint AS email,
      actors.suggested_role AS suggestedRole, actors.mapped_user_id AS mappedUserId,
      actors.invitation_id AS invitationId, runs.package_fingerprint AS packageFingerprint,
      COALESCE(json_group_array(assignments.target_care_party_id)
        FILTER (WHERE assignments.target_care_party_id IS NOT NULL), '[]') AS carePartyIdsJson
    FROM data_transfer_actors actors
    JOIN data_transfer_runs runs ON runs.id = actors.transfer_run_id
    LEFT JOIN data_transfer_actor_care_parties assignments ON assignments.actor_id = actors.id
    GROUP BY actors.id
    ORDER BY actors.display_name, actors.id
  `).all().map((row) => {
    const item = row as DataRecord;
    const { carePartyIdsJson, ...actor } = item;
    return { ...actor, carePartyIds: parseJson(carePartyIdsJson, []) };
  });
}
