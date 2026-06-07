import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createDemoData, createEmptyData } from "../data/defaults";
import {
  auditEntryChange,
  auditHolidayChange,
  auditUnavailablePeriodChange,
  softDeleteMissing
} from "../lib/audit";
import { generatePatternEntries } from "../lib/contact";
import { makeId, nowIso } from "../lib/date";
import {
  buildMonthlyClosureSummary,
  monthKeysForRange
} from "../lib/monthClosure";
import { loadData, saveData } from "../lib/storage";
import type {
  AppData,
  AppSettings,
  AuditLogEntry,
  CareEntry,
  Child,
  ContactPattern,
  EntryStatus,
  HolidayPeriod,
  MonthlyClosure
  ,
  UnavailablePeriod
} from "../types";

interface ChildInput {
  id?: string;
  name: string;
  birthMonth: number;
  birthYear: number;
  color: string;
}

type EntryInput = Omit<CareEntry, "id" | "createdAt" | "updatedAt"> & { id?: string };
type HolidayInput = Omit<HolidayPeriod, "id"> & { id?: string };
type PatternInput = Omit<ContactPattern, "id"> & { id?: string };
type UnavailableInput = Omit<
  UnavailablePeriod,
  "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "deletedAt"
> & { id?: string };

interface AppStoreValue {
  data: AppData;
  saveChild: (input: ChildInput) => void;
  removeChild: (id: string) => void;
  saveEntry: (input: EntryInput) => boolean;
  removeEntry: (id: string) => boolean;
  updateEntryStatus: (id: string, status: EntryStatus, cancellationReason?: string) => boolean;
  saveHolidayPeriod: (input: HolidayInput) => boolean;
  removeHolidayPeriod: (id: string) => boolean;
  saveUnavailablePeriod: (input: UnavailableInput) => boolean;
  removeUnavailablePeriod: (id: string) => boolean;
  saveContactPattern: (input: PatternInput) => string;
  removeContactPattern: (id: string) => void;
  generateContactEntries: (patternId: string, startDate: string, endDate: string) => number;
  replaceData: (data: AppData) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  closeMonth: (monthKey: string) => MonthlyClosure;
  recordBackupExport: (timestamp: string) => void;
  loadDemo: () => void;
  clearAll: () => void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(loadData);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    saveData(data);
  }, [data]);

  const confirmClosedMonthChange = useCallback((monthKeys: string[]) => {
    const closed = dataRef.current.monthClosures.filter((closure) =>
      monthKeys.includes(closure.monthKey)
    );
    if (!closed.length) return true;
    return window.confirm(
      `Der betroffene Monat ${closed.map((closure) => closure.monthKey).join(", ")} ist bereits abgeschlossen. Die Änderung wird protokolliert und der Monatsabschluss als nachträglich geändert markiert. Änderung trotzdem speichern?`
    );
  }, []);

  const markClosuresChanged = (
    closures: MonthlyClosure[],
    monthKeys: string[],
    timestamp: string
  ) =>
    closures.map((closure) =>
      monthKeys.includes(closure.monthKey)
        ? { ...closure, changedAfterCloseAt: timestamp }
        : closure
    );

  const saveChild = useCallback((input: ChildInput) => {
    setData((current) => {
      const timestamp = nowIso();
      const existing = input.id
        ? current.children.find((child) => child.id === input.id)
        : undefined;
      const nextChild: Child = {
        id: existing?.id ?? makeId("child"),
        name: input.name.trim(),
        birthMonth: input.birthMonth,
        birthYear: input.birthYear,
        color: input.color,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      return {
        ...current,
        children: existing
          ? current.children.map((child) => (child.id === existing.id ? nextChild : child))
          : [...current.children, nextChild],
        updatedAt: timestamp
      };
    });
  }, []);

  const removeChild = useCallback((id: string) => {
    const current = dataRef.current;
    const affectedEntries = current.entries.filter(
      (entry) => !entry.deletedAt && entry.childIds.includes(id)
    );
    const affectedHolidays = current.holidayPeriods.filter(
      (period) => !period.deletedAt && period.childIds.includes(id)
    );
    const affectedMonths = new Set<string>();
    affectedEntries.forEach((entry) =>
      monthKeysForRange(
        entry.startDateTime.slice(0, 10),
        entry.endDateTime.slice(0, 10)
      ).forEach((month) => affectedMonths.add(month))
    );
    affectedHolidays.forEach((period) =>
      monthKeysForRange(period.startDate, period.endDate).forEach((month) =>
        affectedMonths.add(month)
      )
    );
    if (!confirmClosedMonthChange([...affectedMonths])) return;

    setData((latest) => {
      const timestamp = nowIso();
      const audit: AuditLogEntry[] = [];
      const entries = latest.entries.map((entry) => {
        if (entry.deletedAt || !entry.childIds.includes(id)) return entry;
        const childIds = entry.childIds.filter((childId) => childId !== id);
        const nextEntry: CareEntry = childIds.length
          ? { ...entry, childIds, updatedAt: timestamp }
          : {
              ...entry,
              childIds,
              deletedAt: timestamp,
              updatedAt: timestamp,
              trips: entry.trips.map((trip) =>
                trip.deletedAt ? trip : { ...trip, deletedAt: timestamp }
              ),
              costs: entry.costs.map((cost) =>
                cost.deletedAt ? cost : { ...cost, deletedAt: timestamp }
              )
            };
        audit.push(...auditEntryChange(entry, nextEntry, timestamp));
        return nextEntry;
      });
      const holidayPeriods = latest.holidayPeriods.map((period) => {
        if (period.deletedAt || !period.childIds.includes(id)) return period;
        const childIds = period.childIds.filter((childId) => childId !== id);
        const nextPeriod: HolidayPeriod = childIds.length
          ? { ...period, childIds }
          : { ...period, childIds, deletedAt: timestamp };
        audit.push(...auditHolidayChange(period, nextPeriod, timestamp));
        return nextPeriod;
      });
      const next = {
        ...latest,
        children: latest.children.filter((child) => child.id !== id),
        entries,
        holidayPeriods,
        contactPatterns: latest.contactPatterns
          .map((pattern) => ({
            ...pattern,
            childIds: pattern.childIds.filter((childId) => childId !== id)
          }))
          .filter((pattern) => pattern.childIds.length > 0),
        auditLog: [...latest.auditLog, ...audit],
        monthClosures: markClosuresChanged(
          latest.monthClosures,
          [...affectedMonths],
          timestamp
        ),
        updatedAt: timestamp
      };
      dataRef.current = next;
      return next;
    });
  }, [confirmClosedMonthChange]);

  const saveEntry = useCallback((input: EntryInput) => {
    const current = dataRef.current;
    const existing = input.id
      ? current.entries.find((entry) => entry.id === input.id)
      : undefined;
    const affectedMonths = new Set(
      monthKeysForRange(
        input.startDateTime.slice(0, 10),
        input.endDateTime.slice(0, 10)
      )
    );
    if (existing) {
      monthKeysForRange(
        existing.startDateTime.slice(0, 10),
        existing.endDateTime.slice(0, 10)
      ).forEach((month) => affectedMonths.add(month));
    }
    if (!confirmClosedMonthChange([...affectedMonths])) return false;

    setData((current) => {
      const timestamp = nowIso();
      const existing = input.id
        ? current.entries.find((entry) => entry.id === input.id)
        : undefined;
      const nextEntry: CareEntry = {
        ...input,
        id: existing?.id ?? makeId("entry"),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        deletedAt: undefined,
        trips: softDeleteMissing(existing?.trips ?? [], input.trips, timestamp),
        costs: softDeleteMissing(existing?.costs ?? [], input.costs, timestamp)
      };
      const next = {
        ...current,
        entries: existing
          ? current.entries.map((entry) => (entry.id === existing.id ? nextEntry : entry))
          : [...current.entries, nextEntry],
        auditLog: [
          ...current.auditLog,
          ...auditEntryChange(existing, nextEntry, timestamp)
        ],
        monthClosures: markClosuresChanged(
          current.monthClosures,
          [...affectedMonths],
          timestamp
        ),
        updatedAt: timestamp
      };
      dataRef.current = next;
      return next;
    });
    return true;
  }, [confirmClosedMonthChange]);

  const removeEntry = useCallback((id: string) => {
    const existing = dataRef.current.entries.find((entry) => entry.id === id);
    if (!existing || existing.deletedAt) return false;
    const affectedMonths = monthKeysForRange(
      existing.startDateTime.slice(0, 10),
      existing.endDateTime.slice(0, 10)
    );
    if (!confirmClosedMonthChange(affectedMonths)) return false;

    setData((current) => {
      const timestamp = nowIso();
      const before = current.entries.find((entry) => entry.id === id);
      if (!before) return current;
      const deleted: CareEntry = {
        ...before,
        deletedAt: timestamp,
        updatedAt: timestamp,
        trips: before.trips.map((trip) =>
          trip.deletedAt ? trip : { ...trip, deletedAt: timestamp }
        ),
        costs: before.costs.map((cost) =>
          cost.deletedAt ? cost : { ...cost, deletedAt: timestamp }
        )
      };
      const next = {
        ...current,
        entries: current.entries.map((entry) => (entry.id === id ? deleted : entry)),
        auditLog: [
          ...current.auditLog,
          ...auditEntryChange(before, deleted, timestamp)
        ],
        monthClosures: markClosuresChanged(
          current.monthClosures,
          affectedMonths,
          timestamp
        ),
        updatedAt: timestamp
      };
      dataRef.current = next;
      return next;
    });
    return true;
  }, [confirmClosedMonthChange]);

  const updateEntryStatus = useCallback(
    (id: string, status: EntryStatus, cancellationReason?: string) => {
      const entry = dataRef.current.entries.find(
        (item) => item.id === id && !item.deletedAt
      );
      if (!entry) return false;
      return saveEntry({
        ...entry,
        status,
        cancellationReason:
          status === "cancelled" ? cancellationReason?.trim() : undefined
      });
    },
    [saveEntry]
  );

  const saveHolidayPeriod = useCallback((input: HolidayInput) => {
    const current = dataRef.current;
    const existing = input.id
      ? current.holidayPeriods.find((period) => period.id === input.id)
      : undefined;
    const affectedMonths = new Set(
      monthKeysForRange(input.startDate, input.endDate)
    );
    if (existing) {
      monthKeysForRange(existing.startDate, existing.endDate).forEach((month) =>
        affectedMonths.add(month)
      );
    }
    if (!confirmClosedMonthChange([...affectedMonths])) return false;

    setData((current) => {
      const timestamp = nowIso();
      const nextPeriod: HolidayPeriod = {
        ...input,
        id: input.id ?? makeId("holiday"),
        deletedAt: undefined
      };
      const exists = current.holidayPeriods.some((period) => period.id === nextPeriod.id);
      const next = {
        ...current,
        holidayPeriods: exists
          ? current.holidayPeriods.map((period) =>
              period.id === nextPeriod.id ? nextPeriod : period
            )
          : [...current.holidayPeriods, nextPeriod],
        auditLog: [
          ...current.auditLog,
          ...auditHolidayChange(existing, nextPeriod, timestamp)
        ],
        monthClosures: markClosuresChanged(
          current.monthClosures,
          [...affectedMonths],
          timestamp
        ),
        updatedAt: timestamp
      };
      dataRef.current = next;
      return next;
    });
    return true;
  }, [confirmClosedMonthChange]);

  const removeHolidayPeriod = useCallback((id: string) => {
    const existing = dataRef.current.holidayPeriods.find(
      (period) => period.id === id && !period.deletedAt
    );
    if (!existing) return false;
    const affectedMonths = monthKeysForRange(existing.startDate, existing.endDate);
    if (!confirmClosedMonthChange(affectedMonths)) return false;

    setData((current) => {
      const timestamp = nowIso();
      const before = current.holidayPeriods.find((period) => period.id === id);
      if (!before) return current;
      const deleted = { ...before, deletedAt: timestamp };
      const next = {
        ...current,
        holidayPeriods: current.holidayPeriods.map((period) =>
          period.id === id ? deleted : period
        ),
        auditLog: [
          ...current.auditLog,
          ...auditHolidayChange(before, deleted, timestamp)
        ],
        monthClosures: markClosuresChanged(
          current.monthClosures,
          affectedMonths,
          timestamp
        ),
        updatedAt: timestamp
      };
      dataRef.current = next;
      return next;
    });
    return true;
  }, [confirmClosedMonthChange]);

  const saveUnavailablePeriod = useCallback((input: UnavailableInput) => {
    const existing = input.id
      ? dataRef.current.unavailablePeriods.find((period) => period.id === input.id)
      : undefined;
    const affectedMonths = new Set(
      monthKeysForRange(
        input.startDateTime.slice(0, 10),
        input.endDateTime.slice(0, 10)
      )
    );
    if (existing) {
      monthKeysForRange(
        existing.startDateTime.slice(0, 10),
        existing.endDateTime.slice(0, 10)
      ).forEach((month) => affectedMonths.add(month));
    }
    if (!confirmClosedMonthChange([...affectedMonths])) return false;

    setData((current) => {
      const timestamp = nowIso();
      const before = input.id
        ? current.unavailablePeriods.find((period) => period.id === input.id)
        : undefined;
      const nextPeriod: UnavailablePeriod = {
        ...input,
        id: before?.id ?? makeId("unavailable"),
        createdBy: before?.createdBy ?? "local-dev",
        updatedBy: "local-dev",
        createdAt: before?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      const next = {
        ...current,
        unavailablePeriods: before
          ? current.unavailablePeriods.map((period) =>
              period.id === before.id ? nextPeriod : period
            )
          : [...current.unavailablePeriods, nextPeriod],
        auditLog: [
          ...current.auditLog,
          ...auditUnavailablePeriodChange(before, nextPeriod, timestamp)
        ],
        monthClosures: markClosuresChanged(
          current.monthClosures,
          [...affectedMonths],
          timestamp
        ),
        updatedAt: timestamp
      };
      dataRef.current = next;
      return next;
    });
    return true;
  }, [confirmClosedMonthChange]);

  const removeUnavailablePeriod = useCallback((id: string) => {
    const existing = dataRef.current.unavailablePeriods.find(
      (period) => period.id === id && !period.deletedAt
    );
    if (!existing) return false;
    const affectedMonths = monthKeysForRange(
      existing.startDateTime.slice(0, 10),
      existing.endDateTime.slice(0, 10)
    );
    if (!confirmClosedMonthChange(affectedMonths)) return false;

    setData((current) => {
      const timestamp = nowIso();
      const before = current.unavailablePeriods.find((period) => period.id === id);
      if (!before) return current;
      const deleted: UnavailablePeriod = {
        ...before,
        deletedAt: timestamp,
        updatedBy: "local-dev",
        updatedAt: timestamp
      };
      const next = {
        ...current,
        unavailablePeriods: current.unavailablePeriods.map((period) =>
          period.id === id ? deleted : period
        ),
        auditLog: [
          ...current.auditLog,
          ...auditUnavailablePeriodChange(before, deleted, timestamp)
        ],
        monthClosures: markClosuresChanged(
          current.monthClosures,
          affectedMonths,
          timestamp
        ),
        updatedAt: timestamp
      };
      dataRef.current = next;
      return next;
    });
    return true;
  }, [confirmClosedMonthChange]);

  const saveContactPattern = useCallback((input: PatternInput) => {
    const id = input.id ?? makeId("pattern");
    setData((current) => {
      const nextPattern: ContactPattern = { ...input, id };
      const exists = current.contactPatterns.some((pattern) => pattern.id === id);
      return {
        ...current,
        contactPatterns: exists
          ? current.contactPatterns.map((pattern) =>
              pattern.id === id ? nextPattern : pattern
            )
          : [...current.contactPatterns, nextPattern],
        updatedAt: nowIso()
      };
    });
    return id;
  }, []);

  const removeContactPattern = useCallback((id: string) => {
    setData((current) => ({
      ...current,
      contactPatterns: current.contactPatterns.filter((pattern) => pattern.id !== id),
      updatedAt: nowIso()
    }));
  }, []);

  const generateContactEntries = useCallback(
    (patternId: string, startDate: string, endDate: string) => {
      const current = dataRef.current;
      const pattern = current.contactPatterns.find((item) => item.id === patternId);
      if (!pattern) return 0;
      const generated = generatePatternEntries(current, pattern, startDate, endDate);
      if (generated.length) {
        const affectedMonths = monthKeysForRange(startDate, endDate);
        if (!confirmClosedMonthChange(affectedMonths)) return -1;
        setData((current) => ({
          ...current,
          entries: [...current.entries, ...generated],
          auditLog: [
            ...current.auditLog,
            ...generated.flatMap((entry) =>
              auditEntryChange(undefined, entry, entry.createdAt)
            )
          ],
          monthClosures: markClosuresChanged(
            current.monthClosures,
            affectedMonths,
            generated[0].createdAt
          ),
          updatedAt: nowIso()
        }));
      }
      return generated.length;
    },
    [confirmClosedMonthChange]
  );

  const replaceData = useCallback((nextData: AppData) => {
    setData({ ...nextData, updatedAt: nowIso() });
  }, []);

  const updateSettings = useCallback((settings: Partial<AppSettings>) => {
    setData((current) => ({
      ...current,
      settings: { ...current.settings, ...settings },
      updatedAt: nowIso()
    }));
  }, []);

  const closeMonth = useCallback((monthKey: string) => {
    const current = dataRef.current;
    const existing = current.monthClosures.find(
      (closure) => closure.monthKey === monthKey
    );
    if (existing) return existing;
    const timestamp = nowIso();
    const closure: MonthlyClosure = {
      monthKey,
      closedAt: timestamp,
      dataUpdatedAt: current.updatedAt,
      summary: buildMonthlyClosureSummary(current, monthKey)
    };
    setData((latest) => {
      const next = {
        ...latest,
        monthClosures: [...latest.monthClosures, closure],
        updatedAt: timestamp
      };
      dataRef.current = next;
      return next;
    });
    return closure;
  }, []);

  const recordBackupExport = useCallback((timestamp: string) => {
    setData((current) => {
      const next = { ...current, lastJsonBackupAt: timestamp };
      dataRef.current = next;
      return next;
    });
  }, []);

  const loadDemo = useCallback(() => setData(createDemoData()), []);
  const clearAll = useCallback(() => setData(createEmptyData()), []);

  const value = useMemo(
    () => ({
      data,
      saveChild,
      removeChild,
      saveEntry,
      removeEntry,
      updateEntryStatus,
      saveHolidayPeriod,
      removeHolidayPeriod,
      saveUnavailablePeriod,
      removeUnavailablePeriod,
      saveContactPattern,
      removeContactPattern,
      generateContactEntries,
      replaceData,
      updateSettings,
      closeMonth,
      recordBackupExport,
      loadDemo,
      clearAll
    }),
    [
      clearAll,
      data,
      loadDemo,
      removeChild,
      removeEntry,
      updateEntryStatus,
      saveHolidayPeriod,
      removeHolidayPeriod,
      saveUnavailablePeriod,
      removeUnavailablePeriod,
      saveContactPattern,
      removeContactPattern,
      generateContactEntries,
      replaceData,
      closeMonth,
      recordBackupExport,
      saveChild,
      saveEntry,
      updateSettings
    ]
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error("useAppStore muss innerhalb des Providers verwendet werden.");
  return value;
}
