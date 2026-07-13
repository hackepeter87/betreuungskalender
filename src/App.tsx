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
import { SetupWizardPage } from "./pages/SetupWizardPage";
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

type OnboardingNotice = "owner-setup" | "invitation";

export function App() {
  const { locale } = useI18n();
  const { data, isLoading, serverStatus, openConfirmations, session } = useAppStore();
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [monthKey, setMonthKey] = useState(() => toMonthKey(new Date()));
  const [entryDialog, setEntryDialog] = useState<EntryDialogState | null>(null);
  const [onboardingNotice, setOnboardingNotice] = useState<OnboardingNotice | null>(() => {
    const value = new URLSearchParams(window.location.search).get("onboarding");
    return value === "owner-setup" || value === "invitation" ? value : null;
  });
  const [legacyMigration, setLegacyMigration] = useState<{
    legacy: LegacyBrowserData;
    database: LegacyDatabaseSummary;
  } | null>(null);
  const migrationChecked = useRef(false);

  useEffect(() => {
    if (!onboardingNotice) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("onboarding");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
  }, [onboardingNotice]);

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

  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const confirmationId = params.get("confirmation");
    if (!confirmationId) return;
    const confirmation = openConfirmations.find((item) => item.id === confirmationId);
    const entry = confirmation
      ? data.entries.find((item) => item.id === confirmation.careEntryId) ?? confirmation.entry
      : undefined;
    if (!entry) return;
    setActivePage("dashboard");
    setEntryDialog({ entry });
    params.delete("confirmation");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
  }, [data.entries, isLoading, openConfirmations]);

  const openNewEntry = (date?: string, additionalCare = false) =>
    setEntryDialog({ date, additionalCare });
  const openEditEntry = (entry: CareEntry) => setEntryDialog({ entry });

  const setupMode = Boolean(
    session.setup?.required &&
    (!session.authRequired || session.authenticated)
  );

  let page;
  if (setupMode) {
    page = <SetupWizardPage />;
  } else switch (activePage) {
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
          onOpenEntries={() => setActivePage("entries")}
        />
      );
  }

  return (
    <>
      <AppShell
        activePage={activePage}
        onNavigate={setActivePage}
        onNewEntry={() => openNewEntry()}
        onOpenEntry={openEditEntry}
        setupMode={setupMode}
      >
        {onboardingNotice ? (
          <div className="notice notice--success app-onboarding-notice" role="status" data-testid="onboarding-completion-notice">
            <Icon name="check" size={18} />
            <div>
              <strong>{copy(locale, "app", onboardingNotice === "owner-setup" ? "ownerSetupComplete" : "invitationComplete")}</strong>
              <p>{copy(locale, "app", onboardingNotice === "owner-setup" ? "ownerSetupNext" : "invitationNext")}</p>
            </div>
            <button className="icon-button" type="button" onClick={() => setOnboardingNotice(null)} aria-label={copy(locale, "common", "close")}>
              <Icon name="close" size={17} />
            </button>
          </div>
        ) : null}
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
