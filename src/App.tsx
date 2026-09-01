import { useEffect, useRef, useState } from "react";
import { AppShell, canAccessPage, type PageId } from "./components/AppShell";
import { DeferredDialogContent, DeferredPage } from "./components/DeferredPage";
import { EntryForm } from "./components/EntryForm";
import { Modal } from "./components/Modal";
import { api } from "./lib/api";
import { useI18n } from "./i18n/I18nProvider";
import { copy } from "./i18n/catalog";
import {
  detectLegacyBrowserData,
  isLegacyFingerprintIgnored,
  type LegacyBrowserData
} from "./migration/legacyLocalStorage";
import { toMonthKey } from "./lib/date";
import { DashboardPage } from "./pages/DashboardPage";
import { SetupWizardPage } from "./pages/SetupWizardPage";
import { Icon } from "./components/Icon";
import { PwaInstallPrompt } from "./components/PwaInstallPrompt";
import type { CareEntry } from "./types";
import type { LegacyDatabaseSummary } from "../shared/migration";
import { useAppStore } from "./store/AppStore";

interface EntryDialogState {
  entry?: CareEntry;
  date?: string;
  additionalCare?: boolean;
}

type OnboardingNotice = "owner-setup" | "invitation";

const loadAnalyticsPage = () => import("./pages/AnalyticsPage")
  .then(({ AnalyticsPage }) => ({ default: AnalyticsPage }));
const loadAuditLogPage = () => import("./pages/AuditLogPage")
  .then(({ AuditLogPage }) => ({ default: AuditLogPage }));
const loadBackupPage = () => import("./pages/BackupPage")
  .then(({ BackupPage }) => ({ default: BackupPage }));
const loadCalendarPage = () => import("./pages/CalendarPage")
  .then(({ CalendarPage }) => ({ default: CalendarPage }));
const loadContactPage = () => import("./pages/ContactPage")
  .then(({ ContactPage }) => ({ default: ContactPage }));
const loadDocumentationRulesPage = () => import("./pages/DocumentationRulesPage")
  .then(({ DocumentationRulesPage }) => ({ default: DocumentationRulesPage }));
const loadEntriesPage = () => import("./pages/EntriesPage")
  .then(({ EntriesPage }) => ({ default: EntriesPage }));
const loadHolidaysPage = () => import("./pages/HolidaysPage")
  .then(({ HolidaysPage }) => ({ default: HolidaysPage }));
const loadReportPage = () => import("./pages/ReportPage")
  .then(({ ReportPage }) => ({ default: ReportPage }));
const loadSettingsPage = () => import("./pages/SettingsPage")
  .then(({ SettingsPage }) => ({ default: SettingsPage }));
const loadUnavailablePeriodsPage = () => import("./pages/UnavailablePeriodsPage")
  .then(({ UnavailablePeriodsPage }) => ({ default: UnavailablePeriodsPage }));
const loadLegacyMigrationDialog = () => import("./components/LegacyMigrationDialog")
  .then(({ LegacyMigrationDialog }) => ({ default: LegacyMigrationDialog }));

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
    if (
      migrationChecked.current ||
      isLoading ||
      serverStatus !== "online" ||
      !session.permissions?.includes("admin:destructive")
    ) return;
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
  }, [isLoading, serverStatus, session.permissions]);

  useEffect(() => {
    if (isLoading || !session.permissions || session.workspaceAccess === false) return;
    if (!canAccessPage(session, activePage)) setActivePage("dashboard");
  }, [activePage, isLoading, session]);

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

  const canCreateAppointments = session.permissions?.includes("appointments:create") ?? true;
  const canEditAppointments = session.permissions?.includes("appointments:edit") ?? true;
  const openNewEntry = (date?: string, additionalCare = false) => {
    if (canCreateAppointments) setEntryDialog({ date, additionalCare });
  };
  const openEditEntry = (entry: CareEntry) => {
    if (canEditAppointments) setEntryDialog({ entry });
  };

  const setupMode = Boolean(
    session.setup?.required &&
    (!session.authRequired || session.authenticated)
  );

  let page;
  if (session.authenticated && session.workspaceAccess === false) {
    page = (
      <section className="panel empty-state" data-testid="workspace-no-access">
        <Icon name="lock" size={28} />
        <h1>Kein Zugriff auf diesen Betreuungskalender</h1>
        <p>Dein Login ist gültig, aber dir ist keine aktive Mitgliedschaft zugeordnet. Bitte wende dich an den Owner dieser Installation.</p>
      </section>
    );
  } else if (setupMode) {
    page = <SetupWizardPage />;
  } else switch (activePage) {
    case "calendar":
      page = (
        <DeferredPage
          pageId="calendar"
          loader={loadCalendarPage}
          componentProps={{
            monthKey,
            onMonthChange: setMonthKey,
            onNewEntry: openNewEntry,
            onEditEntry: openEditEntry
          }}
        />
      );
      break;
    case "entries":
      page = (
        <DeferredPage
          pageId="entries"
          loader={loadEntriesPage}
          componentProps={{
            monthKey,
            onMonthChange: setMonthKey,
            onNewEntry: () => openNewEntry(),
            onEditEntry: openEditEntry
          }}
        />
      );
      break;
    case "analytics":
      page = (
        <DeferredPage
          pageId="analytics"
          loader={loadAnalyticsPage}
          componentProps={{ monthKey }}
        />
      );
      break;
    case "contact":
      page = (
        <DeferredPage
          pageId="contact"
          loader={loadContactPage}
          componentProps={{
            onEditEntry: openEditEntry,
            onNewEntry: () => openNewEntry(undefined, true)
          }}
        />
      );
      break;
    case "holidays":
      page = <DeferredPage pageId="holidays" loader={loadHolidaysPage} componentProps={{}} />;
      break;
    case "unavailable":
      page = (
        <DeferredPage
          pageId="unavailable"
          loader={loadUnavailablePeriodsPage}
          componentProps={{}}
        />
      );
      break;
    case "report":
      page = <DeferredPage pageId="report" loader={loadReportPage} componentProps={{}} />;
      break;
    case "backup":
      page = <DeferredPage pageId="backup" loader={loadBackupPage} componentProps={{}} />;
      break;
    case "audit":
      page = <DeferredPage pageId="audit" loader={loadAuditLogPage} componentProps={{}} />;
      break;
    case "rules":
      page = (
        <DeferredPage
          pageId="rules"
          loader={loadDocumentationRulesPage}
          componentProps={{}}
        />
      );
      break;
    case "settings":
      page = <DeferredPage pageId="settings" loader={loadSettingsPage} componentProps={{}} />;
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
        {!setupMode && !onboardingNotice && (session.authenticated || !session.authRequired) ? (
          <PwaInstallPrompt />
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
        <DeferredDialogContent
          pageId="legacy-migration"
          loader={loadLegacyMigrationDialog}
          componentProps={{
            legacy: legacyMigration.legacy,
            database: legacyMigration.database,
            onClose: () => setLegacyMigration(null)
          }}
        />
      ) : null}
    </>
  );
}
