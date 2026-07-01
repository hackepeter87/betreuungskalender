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
  api,
  ApiError,
  checkServer,
  loadAppData,
  loadSession,
  SERVER_UNAVAILABLE_MESSAGE
} from "../lib/api";
import type { ApiSession } from "../../shared/api";
import { generatePatternEntries } from "../lib/contact";
import { buildMonthlyClosureSummary, monthKeysForRange } from "../lib/monthClosure";
import type {
  AppData,
  AppSettings,
  CareEntry,
  ContactPattern,
  EntryStatus,
  HolidayPeriod,
  MonthlyClosure,
  UnavailablePeriod
} from "../types";

interface ChildInput {
  id?: string;
  name: string;
  birthMonth: number;
  birthYear: number;
  color: string;
}

type EntryInput = Omit<CareEntry, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt"> & {
  id?: string;
};
type HolidayInput = Omit<HolidayPeriod, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "deletedAt"> & { id?: string };
type PatternInput = Omit<ContactPattern, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt"> & { id?: string };
type PatternSaveResult = Pick<ContactPattern, "id" | "syncSummary">;
type UnavailableInput = Omit<
  UnavailablePeriod,
  "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "deletedAt"
> & { id?: string };
export type ServerStatus = "checking" | "online" | "offline";

interface AppStoreValue {
  data: AppData;
  session: ApiSession;
  serverStatus: ServerStatus;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  canWrite: boolean;
  reload: () => Promise<boolean>;
  clearError: () => void;
  saveChild: (input: ChildInput) => Promise<boolean>;
  removeChild: (id: string) => Promise<boolean>;
  saveEntry: (input: EntryInput) => Promise<boolean>;
  removeEntry: (id: string) => Promise<boolean>;
  updateEntryStatus: (
    id: string,
    status: EntryStatus,
    cancellationReason?: string
  ) => Promise<boolean>;
  saveHolidayPeriod: (input: HolidayInput) => Promise<boolean>;
  removeHolidayPeriod: (id: string) => Promise<boolean>;
  saveUnavailablePeriod: (input: UnavailableInput) => Promise<boolean>;
  removeUnavailablePeriod: (id: string) => Promise<boolean>;
  saveContactPattern: (input: PatternInput) => Promise<PatternSaveResult | null>;
  removeContactPattern: (id: string) => Promise<boolean>;
  generateContactEntries: (
    patternId: string,
    startDate: string,
    endDate: string
  ) => Promise<number>;
  replaceData: (data: AppData) => Promise<boolean>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<boolean>;
  closeMonth: (monthKey: string) => Promise<MonthlyClosure | null>;
  recordBackupExport: (timestamp: string) => Promise<boolean>;
  loadDemo: () => Promise<boolean>;
  loadEdgeCaseDemo: () => Promise<boolean>;
  clearAll: () => Promise<boolean>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

const defaultSession: ApiSession = {
  authRequired: false,
  authenticated: false
};

function requiresLogin(session: ApiSession): boolean {
  return session.authRequired && !session.authenticated;
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(createEmptyData);
  const [session, setSession] = useState<ApiSession>(defaultSession);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  const serverStatusRef = useRef(serverStatus);
  dataRef.current = data;
  serverStatusRef.current = serverStatus;

  const handleError = useCallback((reason: unknown) => {
    const unavailable = reason instanceof ApiError && reason.unavailable;
    if (unavailable) {
      setServerStatus("offline");
      setError(SERVER_UNAVAILABLE_MESSAGE);
      return;
    }
    setError(
      reason instanceof Error
        ? reason.message
        : "Die Serveranfrage konnte nicht abgeschlossen werden."
    );
  }, []);

  const setUnauthenticatedState = useCallback((nextSession: ApiSession) => {
    const empty = createEmptyData();
    dataRef.current = empty;
    setData(empty);
    setSession(nextSession);
    setServerStatus("online");
    setError(null);
  }, []);

  const reloadInternal = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!silent) setIsLoading(true);
      try {
        const nextSession = await loadSession();
        setSession(nextSession);
        if (requiresLogin(nextSession)) {
          setUnauthenticatedState(nextSession);
          return true;
        }

        const next = await loadAppData();
        dataRef.current = next;
        setData(next);
        setServerStatus("online");
        setError(null);
        return true;
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          try {
            const nextSession = await loadSession();
            setSession(nextSession);
            if (requiresLogin(nextSession)) {
              setUnauthenticatedState(nextSession);
              return true;
            }
          } catch {
            // Keep the original API error; it carries the failed domain request.
          }
        }
        handleError(reason);
        return false;
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [handleError, setUnauthenticatedState]
  );

  const reload = useCallback(() => reloadInternal(false), [reloadInternal]);

  useEffect(() => {
    void reloadInternal(false);
    const online = () => void reloadInternal(false);
    const offline = () => {
      setServerStatus("offline");
      setError(SERVER_UNAVAILABLE_MESSAGE);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    const interval = window.setInterval(async () => {
      const available = await checkServer();
      if (!available) {
        setServerStatus("offline");
        setError(SERVER_UNAVAILABLE_MESSAGE);
      } else if (serverStatusRef.current === "offline") {
        await reloadInternal(true);
      }
    }, 30_000);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.clearInterval(interval);
    };
  }, [reloadInternal]);

  const performWrite = useCallback(
    async <T,>(operation: () => Promise<T>, failureValue: T): Promise<T> => {
      if (serverStatusRef.current !== "online") {
        setError(SERVER_UNAVAILABLE_MESSAGE);
        return failureValue;
      }
      setIsSaving(true);
      setError(null);
      try {
        const result = await operation();
        await reloadInternal(true);
        return result;
      } catch (reason) {
        handleError(reason);
        return failureValue;
      } finally {
        setIsSaving(false);
      }
    },
    [handleError, reloadInternal]
  );

  const confirmClosedMonthChange = useCallback((monthKeys: string[]) => {
    const closed = dataRef.current.monthClosures.filter((closure) =>
      monthKeys.includes(closure.monthKey)
    );
    if (!closed.length) return true;
    return window.confirm(
      `Der betroffene Monat ${closed.map((closure) => closure.monthKey).join(", ")} ist bereits abgeschlossen. Die Änderung wird protokolliert und der Monatsabschluss als nachträglich geändert markiert. Änderung trotzdem speichern?`
    );
  }, []);

  const saveChild = useCallback(
    async (input: ChildInput) =>
      performWrite(async () => {
        const payload = {
          name: input.name.trim(),
          birthMonth: input.birthMonth,
          birthYear: input.birthYear,
          color: input.color
        };
        if (input.id) await api.updateChild(input.id, payload);
        else await api.createChild(payload);
        return true;
      }, false),
    [performWrite]
  );

  const removeChild = useCallback(
    async (id: string) => {
      const current = dataRef.current;
      const months = new Set<string>();
      current.entries
        .filter((entry) => entry.childIds.includes(id))
        .forEach((entry) =>
          monthKeysForRange(
            entry.startDateTime.slice(0, 10),
            entry.endDateTime.slice(0, 10)
          ).forEach((month) => months.add(month))
        );
      current.holidayPeriods
        .filter((period) => period.childIds.includes(id))
        .forEach((period) =>
          monthKeysForRange(period.startDate, period.endDate).forEach((month) =>
            months.add(month)
          )
        );
      if (!confirmClosedMonthChange([...months])) return false;
      return performWrite(async () => {
        await api.deleteChild(id);
        return true;
      }, false);
    },
    [confirmClosedMonthChange, performWrite]
  );

  const saveEntry = useCallback(
    async (input: EntryInput) => {
      const current = dataRef.current;
      const existing = input.id
        ? current.entries.find((entry) => entry.id === input.id)
        : undefined;
      const months = new Set(
        monthKeysForRange(
          input.startDateTime.slice(0, 10),
          input.endDateTime.slice(0, 10)
        )
      );
      if (existing) {
        monthKeysForRange(
          existing.startDateTime.slice(0, 10),
          existing.endDateTime.slice(0, 10)
        ).forEach((month) => months.add(month));
      }
      if (!confirmClosedMonthChange([...months])) return false;
      return performWrite(async () => {
        const { id, ...payload } = input;
        if (id) await api.updateEntry(id, payload);
        else await api.createEntry(payload);
        return true;
      }, false);
    },
    [confirmClosedMonthChange, performWrite]
  );

  const removeEntry = useCallback(
    async (id: string) => {
      const existing = dataRef.current.entries.find((entry) => entry.id === id);
      if (!existing) return false;
      const months = monthKeysForRange(
        existing.startDateTime.slice(0, 10),
        existing.endDateTime.slice(0, 10)
      );
      if (!confirmClosedMonthChange(months)) return false;
      return performWrite(async () => {
        await api.deleteEntry(id);
        return true;
      }, false);
    },
    [confirmClosedMonthChange, performWrite]
  );

  const updateEntryStatus = useCallback(
    async (id: string, status: EntryStatus, cancellationReason?: string) => {
      const entry = dataRef.current.entries.find((item) => item.id === id);
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

  const saveHolidayPeriod = useCallback(
    async (input: HolidayInput) => {
      const existing = input.id
        ? dataRef.current.holidayPeriods.find((period) => period.id === input.id)
        : undefined;
      const months = new Set(monthKeysForRange(input.startDate, input.endDate));
      if (existing) {
        monthKeysForRange(existing.startDate, existing.endDate).forEach((month) =>
          months.add(month)
        );
      }
      if (!confirmClosedMonthChange([...months])) return false;
      return performWrite(async () => {
        const { id, ...payload } = input;
        if (id) await api.updateHoliday(id, payload);
        else await api.createHoliday(payload);
        return true;
      }, false);
    },
    [confirmClosedMonthChange, performWrite]
  );

  const removeHolidayPeriod = useCallback(
    async (id: string) => {
      const existing = dataRef.current.holidayPeriods.find(
        (period) => period.id === id
      );
      if (!existing) return false;
      if (
        !confirmClosedMonthChange(
          monthKeysForRange(existing.startDate, existing.endDate)
        )
      ) {
        return false;
      }
      return performWrite(async () => {
        await api.deleteHoliday(id);
        return true;
      }, false);
    },
    [confirmClosedMonthChange, performWrite]
  );

  const saveUnavailablePeriod = useCallback(
    async (input: UnavailableInput) => {
      const existing = input.id
        ? dataRef.current.unavailablePeriods.find(
            (period) => period.id === input.id
          )
        : undefined;
      const months = new Set(
        monthKeysForRange(
          input.startDateTime.slice(0, 10),
          input.endDateTime.slice(0, 10)
        )
      );
      if (existing) {
        monthKeysForRange(
          existing.startDateTime.slice(0, 10),
          existing.endDateTime.slice(0, 10)
        ).forEach((month) => months.add(month));
      }
      if (!confirmClosedMonthChange([...months])) return false;
      return performWrite(async () => {
        const { id, ...payload } = input;
        if (id) await api.updateUnavailable(id, payload);
        else await api.createUnavailable(payload);
        return true;
      }, false);
    },
    [confirmClosedMonthChange, performWrite]
  );

  const removeUnavailablePeriod = useCallback(
    async (id: string) => {
      const existing = dataRef.current.unavailablePeriods.find(
        (period) => period.id === id
      );
      if (!existing) return false;
      if (
        !confirmClosedMonthChange(
          monthKeysForRange(
            existing.startDateTime.slice(0, 10),
            existing.endDateTime.slice(0, 10)
          )
        )
      ) {
        return false;
      }
      return performWrite(async () => {
        await api.deleteUnavailable(id);
        return true;
      }, false);
    },
    [confirmClosedMonthChange, performWrite]
  );

  const saveContactPattern = useCallback(
    async (input: PatternInput) =>
      performWrite(async () => {
        const { id, ...payload } = input;
        const saved = id
          ? await api.updatePattern(id, payload)
          : await api.createPattern(payload);
        return { id: saved.id, syncSummary: saved.syncSummary };
      }, null),
    [performWrite]
  );

  const removeContactPattern = useCallback(
    async (id: string) =>
      performWrite(async () => {
        await api.deletePattern(id);
        return true;
      }, false),
    [performWrite]
  );

  const generateContactEntries = useCallback(
    async (patternId: string, startDate: string, endDate: string) => {
      const current = dataRef.current;
      const pattern = current.contactPatterns.find((item) => item.id === patternId);
      if (!pattern) return 0;
      const generated = generatePatternEntries(current, pattern, startDate, endDate);
      if (!generated.length) return 0;
      if (!confirmClosedMonthChange(monthKeysForRange(startDate, endDate))) return -1;
      return performWrite(async () => {
        await Promise.all(
          generated.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...entry }) =>
            api.createEntry(entry)
          )
        );
        return generated.length;
      }, -1);
    },
    [confirmClosedMonthChange, performWrite]
  );

  const replaceData = useCallback(
    async (nextData: AppData) =>
      performWrite(async () => {
        await api.replaceData(nextData);
        return true;
      }, false),
    [performWrite]
  );

  const updateSettings = useCallback(
    async (settings: Partial<AppSettings>) =>
      performWrite(async () => {
        await api.updateSettings(settings);
        return true;
      }, false),
    [performWrite]
  );

  const closeMonth = useCallback(
    async (monthKey: string) => {
      const current = dataRef.current;
      const existing = current.monthClosures.find(
        (closure) => closure.monthKey === monthKey
      );
      if (existing) return existing;
      return performWrite(async () => {
        const saved = await api.closeMonth({
          monthKey,
          dataUpdatedAt: current.updatedAt,
          summary: buildMonthlyClosureSummary(current, monthKey)
        });
        return saved as MonthlyClosure;
      }, null);
    },
    [performWrite]
  );

  const recordBackupExport = useCallback(
    async (timestamp: string) =>
      performWrite(async () => {
        await api.updateSettings({ lastJsonBackupAt: timestamp });
        return true;
      }, false),
    [performWrite]
  );

  const loadDemo = useCallback(
    async () =>
      performWrite(async () => {
        await api.replaceData(createDemoData());
        return true;
      }, false),
    [performWrite]
  );

  const loadEdgeCaseDemo = useCallback(
    async () =>
      performWrite(async () => {
        await api.loadEdgeCaseDemoData();
        return true;
      }, false),
    [performWrite]
  );

  const clearAll = useCallback(
    async () =>
      performWrite(async () => {
        await api.clearData();
        return true;
      }, false),
    [performWrite]
  );

  const value = useMemo<AppStoreValue>(
    () => ({
      data,
      session,
      serverStatus,
      isLoading,
      isSaving,
      error,
      canWrite:
        serverStatus === "online" &&
        !isLoading &&
        !isSaving &&
        (!session.authRequired || session.authenticated),
      reload,
      clearError: () => setError(null),
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
      loadEdgeCaseDemo,
      clearAll
    }),
    [
      clearAll,
      closeMonth,
      data,
      error,
      generateContactEntries,
      isLoading,
      isSaving,
      loadDemo,
      loadEdgeCaseDemo,
      recordBackupExport,
      reload,
      removeChild,
      removeContactPattern,
      removeEntry,
      removeHolidayPeriod,
      removeUnavailablePeriod,
      replaceData,
      saveChild,
      saveContactPattern,
      saveEntry,
      saveHolidayPeriod,
      saveUnavailablePeriod,
      session,
      serverStatus,
      updateEntryStatus,
      updateSettings
    ]
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext);
  if (!value) {
    throw new Error("useAppStore muss innerhalb des Providers verwendet werden.");
  }
  return value;
}
