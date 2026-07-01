import { useEffect, useRef, useState } from "react";
import { AppShell, type PageId } from "./components/AppShell";
import { EntryForm } from "./components/EntryForm";
import { Modal } from "./components/Modal";
import { LegacyMigrationDialog } from "./components/LegacyMigrationDialog";
import { api } from "./lib/api";
import { useI18n } from "./i18n/I18nProvider";
import { copy } from "./i18n/catalog";
import {
  detectLegacyBrowserData,
  isLegacyFingerprintIgnored,
  type LegacyBrowserData
} from "./migration/legacyLocalStorage";
import { toMonthKey } from "./lib/date";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { BackupPage } from "./pages/BackupPage";
import { CalendarPage } from "./pages/CalendarPage";
import { ContactPage } from "./pages/ContactPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentationRulesPage } from "./pages/DocumentationRulesPage";
import { EntriesPage } from "./pages/EntriesPage";
import { HolidaysPage } from "./pages/HolidaysPage";
import { ReportPage } from "./pages/ReportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UnavailablePeriodsPage } from "./pages/UnavailablePeriodsPage";
import { Icon } from "./components/Icon";
import type { CareEntry } from "./types";
import type { LegacyDatabaseSummary } from "../shared/migration";
import { useAppStore } from "./store/AppStore";

interface EntryDialogState {
  entry?: CareEntry;
  date?: string;
  additionalCare?: boolean;
}

export function App() {
  const { locale } = useI18n();
  const { isLoading, serverStatus } = useAppStore();
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [monthKey, setMonthKey] = useState(() => toMonthKey(new Date()));
  const [entryDialog, setEntryDialog] = useState<EntryDialogState | null>(null);
  const [ruleEntryChoice, setRuleEntryChoice] = useState<CareEntry | null>(null);
  const [focusedContactRuleId, setFocusedContactRuleId] = useState<string | undefined>();
  const [legacyMigration, setLegacyMigration] = useState<{
    legacy: LegacyBrowserData;
    database: LegacyDatabaseSummary;
  } | null>(null);
  const migrationChecked = useRef(false);

  useEffect(() => {
    if (migrationChecked.current || isLoading || serverStatus !== "online") return;
    migrationChecked.current = true;
    const legacy = detectLegacyBrowserData();
    if (!legacy || isLegacyFingerprintIgnored(legacy.fingerprint)) return;
    void api.getLegacyMigrationSummary().then(async ({ database }) => {
      try {
        await api.recordLegacyDetected({
          fingerprint: legacy.fingerprint,
          counts: legacy.counts
        });
      } finally {
        setLegacyMigration({ legacy, database });
      }
    }).catch(() => {
      migrationChecked.current = false;
    });
  }, [isLoading, serverStatus]);

  const openNewEntry = (date?: string, additionalCare = false) =>
    setEntryDialog({ date, additionalCare });
  const openEditEntry = (entry: CareEntry) => {
    if (entry.contactRuleId || entry.generatedByPatternId) {
      setRuleEntryChoice(entry);
      return;
    }
    setEntryDialog({ entry });
  };
  const openSingleRuleEntry = () => {
    if (!ruleEntryChoice) return;
    setEntryDialog({ entry: ruleEntryChoice });
    setRuleEntryChoice(null);
  };
  const openRuleSeries = () => {
    if (!ruleEntryChoice) return;
    setFocusedContactRuleId(ruleEntryChoice.contactRuleId ?? ruleEntryChoice.generatedByPatternId);
    setRuleEntryChoice(null);
    setActivePage("contact");
  };

  let page;
  switch (activePage) {
    case "calendar":
      page = <CalendarPage monthKey={monthKey} onMonthChange={setMonthKey} onNewEntry={openNewEntry} onEditEntry={openEditEntry} />;
      break;
    case "entries":
      page = <EntriesPage monthKey={monthKey} onMonthChange={setMonthKey} onNewEntry={() => openNewEntry()} onEditEntry={openEditEntry} />;
      break;
    case "analytics":
      page = <AnalyticsPage monthKey={monthKey} />;
      break;
    case "contact":
      page = (
        <ContactPage
          key={focusedContactRuleId ?? "contact"}
          focusedRuleId={focusedContactRuleId}
          onEditEntry={openEditEntry}
          onNewEntry={() => openNewEntry(undefined, true)}
        />
      );
      break;
    case "holidays":
      page = <HolidaysPage />;
      break;
    case "unavailable":
      page = <UnavailablePeriodsPage />;
      break;
    case "report":
      page = <ReportPage />;
      break;
    case "backup":
      page = <BackupPage />;
      break;
    case "audit":
      page = <AuditLogPage />;
      break;
    case "rules":
      page = <DocumentationRulesPage />;
      break;
    case "settings":
      page = <SettingsPage />;
      break;
    default:
      page = (
        <DashboardPage
          monthKey={monthKey}
          onMonthChange={setMonthKey}
          onNewEntry={openNewEntry}
          onEditEntry={openEditEntry}
          onOpenSettings={() => setActivePage("settings")}
          onOpenCalendar={() => setActivePage("calendar")}
        />
      );
  }

  return (
    <>
      <AppShell activePage={activePage} onNavigate={setActivePage} onNewEntry={() => openNewEntry()}>
        {page}
      </AppShell>
      {entryDialog ? (
        <Modal
          title={
            entryDialog.entry
              ? copy(locale, "app", "editCareEntry")
              : copy(locale, "app", "createCareEntry")
          }
          size="large"
          onClose={() => setEntryDialog(null)}
        >
          <EntryForm
            entry={entryDialog.entry}
            initialDate={entryDialog.date}
            initialAdditionalCare={entryDialog.additionalCare}
            onSaved={() => setEntryDialog(null)}
            onCancel={() => setEntryDialog(null)}
          />
        </Modal>
      ) : null}
      {ruleEntryChoice ? (
        <Modal
          title={copy(locale, "app", "editRuleEntryTitle")}
          onClose={() => setRuleEntryChoice(null)}
        >
          <div className="choice-dialog" data-testid="rule-entry-edit-choice">
            <p>{copy(locale, "app", "editRuleEntryDescription")}</p>
            <div className="choice-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                data-testid="edit-rule-entry-single"
                onClick={openSingleRuleEntry}
              >
                <Icon name="edit" size={17} />
                {copy(locale, "app", "editSingleRuleEntry")}
              </button>
              <button
                className="button button--primary"
                type="button"
                data-testid="edit-rule-entry-series"
                onClick={openRuleSeries}
              >
                <Icon name="repeat" size={17} />
                {copy(locale, "app", "editRuleSeries")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {legacyMigration ? (
        <LegacyMigrationDialog
          legacy={legacyMigration.legacy}
          database={legacyMigration.database}
          onClose={() => setLegacyMigration(null)}
        />
      ) : null}
    </>
  );
}
