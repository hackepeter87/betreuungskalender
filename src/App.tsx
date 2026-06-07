import { useState } from "react";
import { AppShell, type PageId } from "./components/AppShell";
import { EntryForm } from "./components/EntryForm";
import { Modal } from "./components/Modal";
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
import type { CareEntry } from "./types";

interface EntryDialogState {
  entry?: CareEntry;
  date?: string;
  additionalCare?: boolean;
}

export function App() {
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [monthKey, setMonthKey] = useState(() => toMonthKey(new Date()));
  const [entryDialog, setEntryDialog] = useState<EntryDialogState | null>(null);

  const openNewEntry = (date?: string, additionalCare = false) =>
    setEntryDialog({ date, additionalCare });
  const openEditEntry = (entry: CareEntry) => setEntryDialog({ entry });

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
          title={entryDialog.entry ? "Betreuungseintrag bearbeiten" : "Betreuungseintrag erfassen"}
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
    </>
  );
}
