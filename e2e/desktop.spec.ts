import { expect, test } from "@playwright/test";
import {
  createChild,
  createEntry,
  createHoliday,
  dateInCurrentMonth,
  expectNoDocumentHorizontalOverflow,
  expectNoUnavailableModalOverflow,
  importExternalCalendar,
  navigate,
  openApp,
  resetApp
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("keeps application branding and sidebar footer controls aligned", async ({ page }) => {
  await openApp(page);

  const logo = page.getByTestId("desktop-app-logo");
  const settings = page.getByTestId("nav-settings");
  const collapse = page.getByTestId("sidebar-collapse-control");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", "/icons/app-icon.svg");
  await expect(collapse).toBeVisible();

  const footerOrder = await page.evaluate(() => {
    const top = (testId: string) => document.querySelector(`[data-testid="${testId}"]`)!
      .getBoundingClientRect().top;
    return {
      settings: top("nav-settings"),
      collapse: top("sidebar-collapse-control")
    };
  });
  expect(footerOrder.settings).toBeLessThan(footerOrder.collapse);

  await collapse.click();
  await expect(page.getByTestId("app-shell")).toHaveClass(/app-shell--sidebar-collapsed/);
  await expect(logo).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(collapse).toHaveAttribute("aria-pressed", "true");
});

test("offers PWA installation only after the browser reports availability", async ({
  page
}) => {
  await openApp(page);
  await expect(page.getByTestId("pwa-install-prompt")).toHaveCount(0);

  await page.evaluate(() => {
    const installEvent = new Event("beforeinstallprompt", { cancelable: true });
    const browserWindow = window as Window & { __pwaPromptCalls?: number };
    Object.defineProperties(installEvent, {
      prompt: {
        value: async () => {
          browserWindow.__pwaPromptCalls = (browserWindow.__pwaPromptCalls ?? 0) + 1;
        }
      },
      userChoice: {
        value: Promise.resolve({ outcome: "accepted", platform: "web" })
      }
    });
    window.dispatchEvent(installEvent);
  });

  await expect(page.getByTestId("pwa-install-prompt")).toBeVisible();
  await page.getByTestId("pwa-install-action").click();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __pwaPromptCalls?: number }
  ).__pwaPromptCalls)).toBe(1);
  await expect(page.getByTestId("pwa-install-prompt")).toHaveCount(0);
});

test("covers the core documentation and export flows", async ({ page }) => {
  const childName = "Alex Beispiel";
  await openApp(page);
  await createChild(page, childName);

  await createEntry(page, {
    childName,
    startDay: 8,
    startTime: "09:00",
    endDay: 8,
    endTime: "15:00",
    note: "Fiktiver regulärer Betreuungseintrag"
  });
  await createEntry(page, {
    childName,
    startDay: 10,
    startTime: "15:00",
    endDay: 10,
    endTime: "17:00",
    note: "Fiktive stundenweise Betreuung",
    withTripAndCost: true
  });
  await createEntry(page, {
    childName,
    startDay: 12,
    startTime: "17:00",
    endDay: 13,
    endTime: "08:00",
    note: "Fiktive Übernachtungsbetreuung",
    overnight: true
  });

  await navigate(page, "entries");
  await expect(page.getByText(childName).first()).toBeVisible();
  await createHoliday(page, childName);

  await navigate(page, "report");
  await expect(page.getByTestId("page-report")).toBeVisible();
  await expect(page.getByText(childName).first()).toBeVisible();
  await expect(page.locator('[data-testid="report-entry-trip-km"][data-value="18.5"]'))
    .toBeVisible();
  await expect(page.locator('[data-testid="report-entry-cost"][data-value="12.4"]'))
    .toBeVisible();

  await navigate(page, "backup");
  await expect(page.getByTestId("page-backup")).toBeVisible();
  await expect(page.getByTestId("csv-export-panel")).toBeVisible();
  await expect(page.getByTestId("export-entries-csv")).toBeVisible();
});

test("keeps holiday totals at calendar-day scope with primary-care fallback", async ({
  page,
  request
}) => {
  const partiesResponse = await request.get("/api/care-parties");
  const parties = await partiesResponse.json() as Array<{ id: string; name: string }>;
  const primary = parties.find((party) => party.name === "Hauptbetreuung");
  expect(primary).toBeTruthy();

  const fatherResponse = await request.post("/api/care-parties", {
    data: { name: "Vater Beispiel", kind: "father" }
  });
  expect(fatherResponse.ok()).toBeTruthy();
  const father = await fatherResponse.json() as { id: string };
  const settingsResponse = await request.put("/api/settings", {
    data: { primaryCarePartyId: primary!.id }
  });
  expect(settingsResponse.ok()).toBeTruthy();

  const childIds: string[] = [];
  for (const name of ["Ferienkind A", "Ferienkind B"]) {
    const response = await request.post("/api/children", {
      data: { name, birthMonth: 1, birthYear: 2018, color: "#0f8b83" }
    });
    expect(response.ok()).toBeTruthy();
    childIds.push(((await response.json()) as { id: string }).id);
  }

  const date = dateInCurrentMonth(18);
  const holidayResponse = await request.post("/api/holiday-periods", {
    data: {
      name: "Fiktiver gemeinsamer Ferientag",
      startDate: date,
      endDate: date,
      childIds,
      assignedTo: "shared"
    }
  });
  expect(holidayResponse.ok()).toBeTruthy();
  const entryResponse = await request.post("/api/care-entries", {
    data: {
      startDateTime: `${date}T08:00`,
      endDateTime: `${date}T18:00`,
      childIds: [childIds[0]],
      responsiblePartyId: father.id,
      status: "completed",
      careScope: "full_day",
      overnight: false,
      schoolHandover: false,
      holiday: false,
      weekend: false,
      additionalCare: false,
      location: "commuterApartment",
      handoverFrom: "mother",
      handoverTo: "mother",
      hasEvidence: false,
      trips: [],
      costs: []
    }
  });
  expect(entryResponse.ok()).toBeTruthy();

  await openApp(page);
  await navigate(page, "holidays");
  const summary = page.locator(".summary-strip--five");
  await expect(summary.locator(":scope > div").first()).toContainText("1");
  const shares = page.locator(".stats-grid");
  await expect(shares).toContainText("Hauptbetreuung");
  await expect(shares).toContainText("Vater Beispiel");
  await expect(shares.getByText("0.5 / 50 %")).toHaveCount(2);
});

test("switches to read-only mode when the API is unavailable", async ({
  context,
  page
}) => {
  await openApp(page);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  const banner = page.getByTestId("offline-banner");
  await expect(banner).toHaveAttribute("data-state", "readonly");
  await expect(page.getByTestId("dashboard-new-entry")).toBeDisabled();
  await expect(page.getByTestId("dashboard-close-month")).toBeDisabled();

  const cachedApiRequests = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const requests = (
      await Promise.all(
        cacheNames.map(async (cacheName) => {
          const cache = await caches.open(cacheName);
          return cache.keys();
        })
      )
    ).flat();
    return requests
      .map((request) => new URL(request.url).pathname)
      .filter((path) => path.startsWith("/api/"));
  });
  expect(cachedApiRequests).toEqual([]);

  await context.setOffline(false);
});

test("shows authenticated user and logout action when session metadata is available", async ({
  page
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      if (new URL(url, window.location.href).pathname === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify({
          authRequired: true,
          authenticated: true,
          user: {
            id: "user_e2e_parent",
            displayName: "parent",
            role: "parent",
            email: "parent@example.test"
          },
          logoutUrl: "/oauth2/sign_out"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await expect(page.getByTestId("auth-session")).toContainText("parent");
  await expect(page.getByTestId("auth-logout")).toHaveAttribute(
    "href",
    "/oauth2/sign_out"
  );
});

test("keeps desktop settings layout within the viewport", async ({ page }) => {
  await openApp(page);
  await navigate(page, "settings");
  await expect(page.getByTestId("page-settings")).toBeVisible();
  await expect(page.getByText("Standardwerte").first()).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
});

test("shows admin instance readiness information in settings", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      const pathname = new URL(url, window.location.href).pathname;
      if (pathname === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify({
          authRequired: true,
          authenticated: true,
          demoDatasetsEnabled: true,
          user: {
            id: "user-admin-e2e",
            displayName: "Admin",
            role: "admin"
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      if (pathname === "/api/instance-readiness") {
        return Promise.resolve(new Response(JSON.stringify({
          instanceId: "inst_e2e000000000000",
          version: "1.10.2",
          environment: "test",
          authMode: "native-oidc",
          requireAuth: true,
          serverTime: "2026-07-05T10:00:00.000Z",
          timezone: "Europe/Berlin",
          database: {
            reachable: true,
            migrationsApplied: 21,
            latestAppliedMigration: "021_recovery_admin",
            latestAvailableMigration: "021_recovery_admin",
            upToDate: true
          },
          setup: {
            complete: true,
            children: 1,
            careParties: 1,
            appUsers: 1
          },
          features: {
            demoDatasetsEnabled: true,
            nativeOidc: true,
            trustedProxy: false,
            recoveryAdminEnabled: false,
            pushConfigured: true
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await navigate(page, "settings");
  const readiness = page.getByTestId("instance-readiness");
  await expect(readiness).toBeVisible();
  await expect(readiness).toContainText("Version");
  await expect(readiness).toContainText("1.10.2");
  await expect(readiness).toContainText("Native OIDC");
  await expect(readiness).toContainText("Push konfiguriert");
  const readinessRows = await readiness.locator(".readiness-item").evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      return { top: Math.round(rect.top), width: Math.round(rect.width) };
    })
  );
  expect(readinessRows).toHaveLength(9);
  expect(new Set(readinessRows.slice(0, 4).map((item) => item.top)).size).toBe(1);
  expect(new Set(readinessRows.slice(6, 9).map((item) => item.top)).size).toBe(1);
  expect(readinessRows[6].width).toBeGreaterThan(readinessRows[7].width * 1.8);
  await expectNoDocumentHorizontalOverflow(page);
});

test("manages member invitations from settings", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as typeof window & { __copiedInvitationLink?: string })
            .__copiedInvitationLink = value;
        }
      }
    });
    type Member = {
      id: string;
      displayName: string;
      claimRole: "admin" | "parent" | "readonly";
      effectiveRole: "admin" | "editor" | "scheduler" | "viewer";
      owner: boolean;
      workspaceAccess: boolean;
      membershipRole?: "admin" | "editor" | "scheduler" | "viewer";
      email?: string;
      lastSeenAt?: string;
    };
    type Invitation = {
      id: string;
      role: "admin" | "editor" | "scheduler" | "viewer";
      expiresAt: string;
      createdAt: string;
      updatedAt: string;
      emailHint?: string;
      revokedAt?: string;
    };
    const now = new Date().toISOString();
    const existingInvitationExpiry = new Date(Date.now() + 14 * 86_400_000).toISOString();
    let members: Member[] = [
      {
        id: "user-owner-e2e",
        displayName: "Owner E2E",
        email: "owner@example.invalid",
        claimRole: "admin",
        effectiveRole: "admin",
        owner: true,
        workspaceAccess: true,
        lastSeenAt: now
      },
      {
        id: "user-member-e2e",
        displayName: "Member E2E",
        email: "member@example.invalid",
        claimRole: "readonly",
        effectiveRole: "editor",
        owner: false,
        workspaceAccess: true,
        membershipRole: "editor",
        lastSeenAt: now
      }
    ];
    let invitations: Invitation[] = [
      {
        id: "invitation-existing-e2e",
        role: "viewer",
        emailHint: "readonly@example.invalid",
        expiresAt: existingInvitationExpiry,
        createdAt: now,
        updatedAt: now
      }
    ];
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" }
      }));
    const readBody = (init?: RequestInit) => {
      if (typeof init?.body !== "string") return {};
      try {
        return JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const pathname = new URL(url, window.location.href).pathname;
      if (pathname === "/api/session") {
        return json({
          authRequired: true,
          authenticated: true,
          user: {
            id: "user-owner-e2e",
            displayName: "Owner E2E",
            role: "admin",
            email: "owner@example.invalid"
          },
          workspaceAccess: true,
          workspaceRole: "admin",
          isOwner: true,
          permissions: [
            "appointments:view", "appointments:create", "appointments:edit",
            "appointments:delete", "appointments:confirm", "children:view-basic",
            "children:view-sensitive", "children:manage", "notes:view",
            "planning:view", "planning:manage", "reports:view", "settings:view",
            "settings:manage", "notifications:manage-own", "feeds:manage-own",
            "audit:view", "instance:inspect", "members:manage", "exports:run",
            "admin:destructive"
          ]
        });
      }
      if (pathname === "/api/members" && method === "GET") {
        return json(members);
      }
      if (pathname === "/api/invitations" && method === "GET") {
        return json(invitations);
      }
      if (pathname === "/api/invitations/capabilities" && method === "GET") {
        return json({ emailDeliveryAvailable: true });
      }
      if (pathname === "/api/invitations" && method === "POST") {
        const body = readBody(init);
        (window as typeof window & { __lastInvitationRequest?: Record<string, unknown> })
          .__lastInvitationRequest = body;
        const invitation: Invitation = {
          id: "invitation-created-e2e",
          role: body.role === "admin" || body.role === "scheduler" || body.role === "viewer"
            ? body.role
            : "editor",
          emailHint: typeof body.emailHint === "string" ? body.emailHint : undefined,
          expiresAt: typeof body.expiresAt === "string"
            ? body.expiresAt
            : new Date(Date.now() + 7 * 86_400_000).toISOString(),
          createdAt: now,
          updatedAt: now
        };
        invitations = [invitation, ...invitations];
        return json({
          invitation,
          token: "invite_e2e_created_token",
          invitationUrl: "https://bk.example.invalid/invite?token=invite_e2e_created_token",
          emailDelivery: body.sendEmail
            ? { status: "sent" }
            : { status: "not_requested" }
        }, 201);
      }
      if (pathname === "/api/invitations/invitation-existing-e2e" && method === "DELETE") {
        invitations = invitations.map((invitation) =>
          invitation.id === "invitation-existing-e2e"
            ? { ...invitation, revokedAt: now, updatedAt: now }
            : invitation
        );
        return json(invitations.find((invitation) => invitation.id === "invitation-existing-e2e"));
      }
      if (pathname === "/api/members/user-member-e2e/role" && method === "PUT") {
        const body = readBody(init);
        members = members.map((member) =>
          member.id === "user-member-e2e"
            ? {
                ...member,
                effectiveRole: body.role === "admin" || body.role === "scheduler" || body.role === "viewer"
                  ? body.role
                  : "editor",
                membershipRole: body.role === "admin" || body.role === "scheduler" || body.role === "viewer"
                  ? body.role
                  : "editor"
              }
            : member
        );
        return json(members.find((member) => member.id === "user-member-e2e"));
      }
      if (pathname === "/api/members/user-member-e2e" && method === "DELETE") {
        members = members.map((member) =>
          member.id === "user-member-e2e"
            ? {
                ...member,
                effectiveRole: "viewer",
                workspaceAccess: false,
                membershipRole: undefined
              }
            : member
        );
        return json(members.find((member) => member.id === "user-member-e2e"));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await navigate(page, "settings");

  const manager = page.getByTestId("member-invitations");
  await expect(manager).toBeVisible();
  await expect(manager).toContainText("Member E2E");
  await expect(manager.getByTestId("invitation-accept-form")).toHaveCount(0);
  const invitationGrid = manager.locator(".member-management-grid");
  const invitationForm = manager.getByTestId("invitation-create-form");
  const initialWidths = await invitationGrid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const contentWidth = element.getBoundingClientRect().width
      - Number.parseFloat(style.paddingLeft)
      - Number.parseFloat(style.paddingRight);
    const form = element.querySelector('[data-testid="invitation-create-form"]');
    return {
      contentWidth,
      formWidth: form?.getBoundingClientRect().width ?? 0
    };
  });
  expect(Math.abs(initialWidths.contentWidth - initialWidths.formWidth)).toBeLessThanOrEqual(2);

  await manager.getByTestId("invitation-email-hint").fill("new-user@example.invalid");
  await manager.getByTestId("invitation-role").selectOption("scheduler");
  await manager.getByTestId("invitation-expires-days").fill("14");
  await expect(manager.getByTestId("invitation-send-email")).toBeChecked();
  await manager.getByTestId("invitation-send-email").uncheck();
  await manager.getByTestId("invitation-email-hint").fill("corrected-user@example.invalid");
  await expect(manager.getByTestId("invitation-send-email")).not.toBeChecked();
  await manager.getByRole("button", { name: "Einladung erstellen" }).click();
  await expect(manager).toContainText("Einladung wurde erstellt.");
  await expect(manager.getByTestId("invitation-created-link")).toHaveValue(
    "https://bk.example.invalid/invite?token=invite_e2e_created_token"
  );
  const splitCards = await manager.locator(".member-management-grid > *").evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      return { top: Math.round(rect.top), width: Math.round(rect.width) };
    })
  );
  expect(splitCards).toHaveLength(2);
  expect(splitCards[0].top).toBe(splitCards[1].top);
  expect(Math.abs(splitCards[0].width - splitCards[1].width)).toBeLessThanOrEqual(2);
  await manager.getByRole("button", { name: "Link kopieren" }).click();
  expect(await page.evaluate(() =>
    (window as typeof window & { __copiedInvitationLink?: string }).__copiedInvitationLink
  )).toBe("https://bk.example.invalid/invite?token=invite_e2e_created_token");
  await expect(manager).toContainText("Einladungslink kopiert.");
  await expect(manager.getByTestId("invitation-list")).toContainText("corrected-user@example.invalid");
  expect(await page.evaluate(() =>
    (window as typeof window & { __lastInvitationRequest?: { sendEmail?: boolean } })
      .__lastInvitationRequest?.sendEmail
  )).toBe(false);

  const memberRow = manager.getByTestId("member-row-user-member-e2e");
  await memberRow.getByTestId("member-role-select").selectOption("viewer");
  await expect(manager).toContainText("Rolle wurde aktualisiert.");
  await expect(memberRow).toContainText("Nur lesen");

  await memberRow.getByTestId("member-remove-role").click();
  await expect(manager).toContainText("App-Rolle wurde entfernt.");
  await expect(memberRow).toContainText("Externe Rolle");

  await manager.getByTestId("invitation-row-invitation-existing-e2e").getByTestId("invitation-revoke").click();
  await expect(manager).toContainText("Einladung wurde widerrufen.");
  await expect(manager.getByTestId("invitation-row-invitation-existing-e2e")).toContainText("Widerrufen");
  await expectNoDocumentHorizontalOverflow(page);
});

test("shows only capability-appropriate settings to restricted workspace roles", async ({
  page
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      if (new URL(url, window.location.href).pathname === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify({
          authRequired: true,
          authenticated: true,
          user: {
            id: "user-scheduler-e2e",
            displayName: "Scheduler E2E",
            role: "readonly"
          },
          workspaceAccess: true,
          workspaceRole: "scheduler",
          isOwner: false,
          permissions: [
            "appointments:view",
            "appointments:create",
            "appointments:edit",
            "children:view-basic",
            "notifications:manage-own"
          ]
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await expect(page.getByTestId("nav-contact")).toHaveCount(0);
  await expect(page.getByTestId("nav-report")).toHaveCount(0);
  await navigate(page, "settings");
  await expect(page.getByTestId("notification-preferences")).toBeVisible();
  await expect(page.getByTestId("instance-readiness")).toHaveCount(0);
  await expect(page.getByTestId("member-invitations")).toHaveCount(0);
  await expect(page.getByTestId("settings-add-child")).toHaveCount(0);
  await expect(page.getByTestId("external-calendar-manager")).toHaveCount(0);
  await expect(page.getByTestId("calendar-feed-manager")).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
});

test("shows a no-access page for a revoked workspace membership", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      if (new URL(url, window.location.href).pathname === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify({
          authRequired: true,
          authenticated: true,
          user: {
            id: "user-revoked-e2e",
            displayName: "Revoked E2E",
            role: "readonly"
          },
          workspaceAccess: false,
          isOwner: false,
          permissions: [],
          logoutUrl: "/auth/logout"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await page.goto("/");
  await expect(page.getByTestId("app-loading")).toBeHidden();
  await expect(page.getByTestId("workspace-no-access")).toBeVisible();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("button"))
    .toHaveCount(0);
  await expect(page.getByTestId("auth-logout")).toBeVisible();
});

test("shows open care confirmations in the notification center", async ({ page }) => {
  const end = new Date(Date.now() - 86_400_000);
  end.setHours(18, 0, 0, 0);
  const start = new Date(end);
  start.setHours(16, 0, 0, 0);
  const date = end.toISOString().slice(0, 10);
  const entry = {
    id: "entry_notification_e2e",
    date,
    startDateTime: start.toISOString().slice(0, 16),
    endDateTime: end.toISOString().slice(0, 16),
    childIds: ["child_notification_e2e"],
    status: "planned",
    confirmationState: "unconfirmed",
    additionalCare: false,
    overnight: false,
    schoolHandover: false,
    holiday: false,
    weekend: false,
    location: "other",
    handoverFrom: "father",
    handoverTo: "mother",
    hasEvidence: false,
    trips: [],
    costs: [],
    createdBy: "e2e",
    updatedBy: "e2e",
    createdAt: start.toISOString(),
    updatedAt: start.toISOString()
  };

  await page.addInitScript((confirmationEntry) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      if (new URL(url, window.location.href).pathname === "/api/care-confirmations/open") {
        return Promise.resolve(new Response(JSON.stringify([{
          id: "confirm_notification_e2e",
          careEntryId: confirmationEntry.id,
          userId: "local-dev",
          dueAt: new Date().toISOString(),
          status: "open",
          reminderCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          entry: confirmationEntry
        }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  }, entry);

  await openApp(page);
  await expect(page.getByTestId("sidebar-notification-center-badge")).toHaveText("1");
  await page.getByTestId("sidebar-notification-center-trigger").click();
  const popover = page.getByTestId("sidebar-notification-center-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Offene Bestätigungen");
  await expect(popover.getByTestId("confirmation-card")).toHaveCount(1);
  await popover.getByText("Geplante Betreuung nachträglich bestätigen").click();
  await expect(page.getByRole("dialog", { name: "Betreuungseintrag bearbeiten" })).toBeVisible();
});

test("shows native OIDC login action when authentication is required", async ({
  page
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      if (new URL(url, window.location.href).pathname === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify({
          authRequired: true,
          authenticated: false,
          loginUrl: "/auth/login"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await expect(page.getByTestId("auth-login")).toContainText("Nicht angemeldet");
  await expect(page.getByTestId("auth-login").getByRole("link", { name: "Anmelden" }))
    .toHaveAttribute("href", "/auth/login");
});

test("shows admin-only edge-case demo dataset action when enabled", async ({
  page
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      const path = new URL(url, window.location.href).pathname;
      const method = init?.method?.toUpperCase() ?? "GET";
      if (path === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify({
          authRequired: true,
          authenticated: true,
          demoDatasetsEnabled: true,
          user: {
            id: "user_e2e_admin",
            displayName: "admin",
            role: "admin",
            email: "admin.example.test"
          },
          logoutUrl: "/auth/logout"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      if (path === "/api/demo-data/edge-cases" && method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({
          dataset: "edge-cases"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await navigate(page, "settings");
  await expect(page.getByTestId("settings-load-edge-case-demo"))
    .toContainText("Grenzfall-Testdaten laden");
});

test("uses native OIDC POST logout and returns to unauthenticated state", async ({
  page
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let authenticated = true;
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      const path = new URL(url, window.location.href).pathname;
      const method = init?.method?.toUpperCase() ?? "GET";
      if (path === "/auth/logout" && method === "POST") {
        authenticated = false;
        return Promise.resolve(new Response(JSON.stringify({
          authenticated: false,
          loggedOut: true,
          logoutRedirectUrl: "/provider-logout-test"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      if (path === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify(authenticated
          ? {
              authRequired: true,
              authenticated: true,
              user: {
                id: "user_e2e_parent",
                displayName: "parent",
                role: "parent",
                email: "parent@example.test"
              },
              logoutUrl: "/auth/logout"
            }
          : {
              authRequired: true,
              authenticated: false,
              loginUrl: "/auth/login"
            }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      if (!authenticated && path.startsWith("/api/")) {
        return Promise.resolve(new Response(JSON.stringify({
          error: "authentication_required",
          message: "Authentifizierung erforderlich."
        }), {
          status: 401,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await expect(page.getByTestId("auth-session")).toContainText("parent");
  await page.getByTestId("auth-logout").click();
  await expect(page).toHaveURL(/\/provider-logout-test$/);
});

test("keeps the shell quiet in local development without authentication", async ({
  page
}) => {
  await openApp(page);
  await expect(page.getByTestId("auth-session")).toHaveCount(0);
});

test("exposes first-use setup state through the session endpoint", async ({
  page,
  request
}) => {
  await resetApp(request, { completeSetup: false });
  await openApp(page);
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/session", { cache: "no-store" });
    return response.json() as Promise<{
      setup?: { complete: boolean; required: boolean };
    }>;
  });

  expect(session.setup).toEqual({
    complete: false,
    required: true
  });
});

test("guides fresh installations through first-use setup before showing navigation", async ({
  page,
  request
}) => {
  await resetApp(request, { completeSetup: false });
  await openApp(page);

  await expect(page.getByTestId("setup-wizard")).toBeVisible();
  await expect(page.getByTestId("nav-calendar")).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  const setupLayout = await page.evaluate(() => {
    const wizard = document.querySelector('[data-testid="setup-wizard"]')!.getBoundingClientRect();
    const primary = document.querySelector('[data-testid="setup-primary-person-card"]')!.getBoundingClientRect();
    const secondary = document.querySelector('[data-testid="setup-secondary-person-card"]')!.getBoundingClientRect();
    const childFields = Array.from(document.querySelectorAll('[data-testid="setup-child-grid"] > .field'))
      .map((field) => field.getBoundingClientRect().top);
    return {
      wizardWidth: wizard.width,
      roleTopDifference: Math.abs(primary.top - secondary.top),
      roleWidthDifference: Math.abs(primary.width - secondary.width),
      childTopDifference: Math.max(...childFields) - Math.min(...childFields)
    };
  });
  expect(setupLayout.wizardWidth).toBeLessThanOrEqual(960);
  expect(setupLayout.roleTopDifference).toBeLessThanOrEqual(1);
  expect(setupLayout.roleWidthDifference).toBeLessThanOrEqual(1);
  expect(setupLayout.childTopDifference).toBeLessThanOrEqual(1);
  await page.getByTestId("setup-installation-label").fill("Testkalender");
  await page.getByTestId("setup-care-party-name").fill("Vater");
  await page.getByTestId("setup-care-party-kind").selectOption("father");
  await page.getByTestId("setup-secondary-care-party-kind").selectOption("mother");
  await page.getByTestId("setup-primary-care-party-secondary-toggle").click();
  await expect(page.getByTestId("setup-primary-care-party-secondary")).toBeChecked();
  await expect(page.getByTestId("setup-secondary-care-party-name")).toHaveValue("Mutter");
  await page.getByTestId("setup-child-name").fill("Setup Kind A");
  await page.getByTestId("setup-add-child").click();
  await page.getByTestId("setup-add-child").click();
  await expect(page.getByTestId("setup-child-card")).toHaveCount(3);
  await page.getByTestId("setup-child-name").nth(1).fill("Setup Kind B");
  await page.getByTestId("setup-child-name").nth(2).fill("Setup Kind C");
  await expect(page.getByTestId("setup-calendar-feed-discovery")).toContainText("Kalenderfeed");
  await expect(page.getByTestId("setup-calendar-import-discovery")).toContainText("Externe Kalender");
  await expect(page.getByTestId("setup-calendar-export-discovery")).toContainText("exportieren");
  await page.getByTestId("setup-wizard-submit").click();

  await expect(page.getByTestId("setup-wizard")).toHaveCount(0);
  await expect(page.getByTestId("nav-calendar")).toBeVisible();
  await expect(page.getByText("Setup Kind A", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Setup Kind B", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Setup Kind C", { exact: true }).first()).toBeVisible();

  const session = await page.evaluate(async () => {
    const response = await fetch("/api/session", { cache: "no-store" });
    return response.json() as Promise<{
      setup?: { complete: boolean; required: boolean };
    }>;
  });
  expect(session.setup).toEqual({
    complete: true,
    required: false
  });
  const members = await (await request.get("/api/members")).json() as Array<{
    displayName: string;
    effectiveRole: string;
    owner: boolean;
  }>;
  expect(members.some((member) =>
    member.displayName === "local-dev" &&
    member.effectiveRole === "admin" &&
    member.owner
  )).toBe(true);

  await navigate(page, "settings");
  await expect(page.getByTestId("settings-primary-care-party")).toHaveValue(/party_/);
  await expect(page.getByTestId("settings-primary-care-party")).toContainText("Mutter");
  await expect(page.getByTestId("settings-default-responsible-party")).toHaveValue(/party_/);
  await expect(page.getByTestId("settings-default-responsible-party")).toContainText("Vater");
});

test("shows useful empty states after first-use setup without domain data", async ({
  page,
  request
}) => {
  await resetApp(request, { completeSetup: false });
  await openApp(page);

  await page.getByTestId("setup-care-party-name").fill("Hauptbetreuung");
  await page.getByTestId("setup-wizard-submit").click();
  await expect(page.getByTestId("setup-wizard")).toHaveCount(0);

  await expect(page.getByTestId("dashboard-setup-child")).toBeVisible();
  await expect(page.getByText("Lege ein Kind oder Kürzel an", { exact: false }).first()).toBeVisible();

  await navigate(page, "calendar");
  await expect(page.getByTestId("calendar-empty-state")).toBeVisible();
  await expect(page.getByText("Der Kalender ist noch leer")).toBeVisible();

  await navigate(page, "entries");
  await expect(page.getByTestId("entries-empty-state")).toBeVisible();
  await expect(page.getByText("Beginne mit einem ersten Eintrag")).toBeVisible();

  await navigate(page, "analytics");
  await expect(page.getByTestId("analytics-empty-state")).toBeVisible();

  await navigate(page, "report");
  await expect(page.getByTestId("report-empty-state")).toBeVisible();

  await navigate(page, "settings");
  await expect(page.getByText("Noch kein Kind angelegt.", { exact: false })).toBeVisible();
});

test("creates a personal calendar feed URL from settings", async ({
  page,
  request
}) => {
  await openApp(page);
  await navigate(page, "settings");

  const manager = page.getByTestId("calendar-feed-manager");
  await expect(manager).toContainText("Für diese Auswahl ist noch kein Feed aktiv.");
  await manager.getByTestId("calendar-feed-rotate").click();
  await expect(manager).toContainText("Neue Feed-URL erzeugt");
  await expect(manager).toContainText("Feed aktiv seit");

  const feedUrl = await manager.getByTestId("calendar-feed-url").inputValue();
  expect(feedUrl).toMatch(/^http:\/\/127\.0\.0\.1:3100\/calendar\/[A-Za-z0-9_-]+\.ics$/);
  const feed = await request.get(new URL(feedUrl).pathname);
  expect(feed.ok()).toBeTruthy();
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  await expect(manager.getByTestId("calendar-feed-revoke")).toBeEnabled();
});

test("persists configured child colors and uses them in the calendar", async ({
  page,
  request
}) => {
  const childName = "Farbtest Kind";
  const selectedColor = "#c24170";
  await openApp(page);
  await createChild(page, childName);

  await navigate(page, "settings");
  await page.getByRole("button", { name: `${childName} bearbeiten` }).click();
  const form = page.getByTestId("child-form");
  await form.getByTestId("child-color-option-c24170").check({ force: true });
  await form.getByTestId("child-submit").click();
  await expect(form).toBeHidden();

  const childrenResponse = await request.get("/api/children");
  expect(childrenResponse.ok()).toBeTruthy();
  const children = await childrenResponse.json() as Array<{
    id: string;
    name: string;
    color: string;
  }>;
  const child = children.find((item) => item.name === childName);
  expect(child?.color).toBe(selectedColor);

  await createEntry(page, {
    childName,
    startDay: 11,
    startTime: "10:00",
    endDay: 11,
    endTime: "14:00",
    note: "Fiktiver Eintrag zur Farbprüfung"
  });

  const entriesResponse = await request.get("/api/care-entries");
  expect(entriesResponse.ok()).toBeTruthy();
  const [entry] = await entriesResponse.json() as Array<{ id: string }>;
  expect(entry?.id).toBeTruthy();

  await navigate(page, "calendar");
  if (await page.getByTestId("calendar-view-month").isVisible()) {
    await page.getByTestId("calendar-view-month").click();
  }
  const marker = page
    .getByTestId(`calendar-entry-${entry.id}`)
    .first()
    .getByTestId(`calendar-entry-child-color-${child!.id}`);
  await expect(marker).toBeVisible();
  await expect(marker).toHaveCSS("background-color", "rgb(194, 65, 112)");
});

test("manages care parties and assigns them to entries and contact rules", async ({
  page,
  request
}) => {
  const childName = "Sam Beispiel";
  const partyName = "Großeltern Beispiel";
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      if (new URL(url, window.location.href).pathname === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify({
          authRequired: true,
          authenticated: true,
          user: {
            id: "local-dev",
            displayName: "local-dev",
            role: "admin"
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });
  await openApp(page);
  await createChild(page, childName);

  await navigate(page, "settings");
  await page.getByTestId("settings-add-care-party").click();
  const partyForm = page.getByTestId("care-party-form");
  await partyForm.getByTestId("care-party-name").fill(partyName);
  await partyForm.getByTestId("care-party-kind").selectOption("grandparent");
  await partyForm.getByTestId("care-party-submit").click();
  await expect(partyForm).toBeHidden();
  await expect(page.getByTestId("care-party-list").getByText(partyName, { exact: true })).toBeVisible();

  const parties = await (await request.get("/api/care-parties")).json() as Array<{ id: string; name: string }>;
  const party = parties.find((item) => item.name === partyName);
  expect(party).toBeTruthy();
  await page.getByTestId("settings-default-responsible-party").selectOption(party!.id);

  await createEntry(page, {
    childName,
    startDay: 9,
    startTime: "15:00",
    endDay: 9,
    endTime: "18:00",
    note: "Fiktiver Termin mit betreuender Person"
  });

  const entries = await (await request.get("/api/care-entries")).json() as Array<{ responsiblePartyId?: string }>;
  expect(entries.some((entry) => entry.responsiblePartyId === party?.id)).toBe(true);

  await navigate(page, "contact");
  await page.getByTestId("contact-responsible-party").selectOption(party!.id);
  await page.getByTestId("contact-pattern-save").click();
  await expect(page.getByText(/Umgangsregel gespeichert/)).toBeVisible();

  const rules = await (await request.get("/api/contact-rules")).json() as Array<{ id: string; responsiblePartyId?: string }>;
  const assignedRule = rules.find((rule) => rule.responsiblePartyId === party?.id);
  expect(assignedRule).toBeTruthy();
  const generated = await (await request.get("/api/care-entries")).json() as Array<{
    contactRuleId?: string;
    responsiblePartyId?: string;
  }>;
  expect(generated.some((entry) =>
    entry.contactRuleId === assignedRule?.id && entry.responsiblePartyId === party?.id
  )).toBe(true);

  await navigate(page, "settings");
  const assignments = page.getByTestId("user-care-party-assignments");
  await expect(assignments).toContainText("local-dev");
  const partyAssignment = assignments.getByRole("checkbox", { name: partyName });
  if (!(await partyAssignment.isChecked())) {
    await partyAssignment.click();
  }
  await expect(partyAssignment).toBeChecked();
  const assignmentRows = await (await request.get("/api/user-care-party-assignments")).json() as Array<{
    userId: string;
    carePartyIds: string[];
  }>;
  expect(assignmentRows.some((assignment) =>
    assignment.userId === "local-dev" && assignment.carePartyIds.includes(party!.id)
  )).toBe(true);

  const manager = page.getByTestId("calendar-feed-manager");
  await manager.getByTestId("calendar-feed-scope").selectOption(`party:${party!.id}`);
  await manager.getByTestId("calendar-feed-rotate").click();
  const partyFeedUrl = await manager.getByTestId("calendar-feed-url").inputValue();
  const partyFeed = await (await request.get(new URL(partyFeedUrl).pathname)).text();
  expect(partyFeed).toContain("X-WR-CALNAME:Kinder bei Großeltern Beispiel");

  await manager.getByTestId("calendar-feed-scope").selectOption("all");
  await manager.getByTestId("calendar-feed-rotate").click();
  const allFeedUrl = await manager.getByTestId("calendar-feed-url").inputValue();
  const allFeed = await (await request.get(new URL(allFeedUrl).pathname)).text();
  expect(allFeed).toContain("X-WR-CALNAME:Betreuungskalender Gesamt");
});

test("persists the selected language and localizes the report surface", async ({
  page
}) => {
  await openApp(page);
  await navigate(page, "settings");

  const language = page.getByTestId("settings-language");
  await language.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("nav-report")).toContainText("Report");

  await navigate(page, "report");
  await expect(page.getByTestId("report-title")).toHaveText(
    "Report on documented care periods"
  );

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await navigate(page, "settings");
  await expect(page.getByTestId("settings-language")).toHaveValue("en");
});

test("can hide inline help icons while keeping the help page available", async ({
  page
}) => {
  await openApp(page);
  await navigate(page, "settings");

  await expect(page.getByTestId("nav-rules")).toContainText("Hilfe");
  await expect(page.locator(".field-help-button").first()).toBeVisible();
  await page.getByTestId("settings-help-icons-switch").click();
  await expect(page.getByTestId("settings-help-icons-toggle")).not.toBeChecked();
  await expect(page.locator(".field-help-button")).toHaveCount(0);

  await page.reload();
  await navigate(page, "settings");
  await expect(page.getByTestId("settings-help-icons-toggle")).not.toBeChecked();
  await expect(page.locator(".field-help-button")).toHaveCount(0);

  await navigate(page, "rules");
  await page.locator("details.field-help-group summary").first().click();
  await expect(page.locator(".field-help-list .field-help-button").first()).toBeVisible();
});

test("uses compact required-field markers in forms", async ({ page }) => {
  const childName = "Pflichtfeld Kind";
  await openApp(page);
  await createChild(page, childName);

  await navigate(page, "calendar");
  await page.getByTestId(`calendar-day-${dateInCurrentMonth(8)}`).click();
  const form = page.getByTestId("entry-form");
  await expect(form.locator(".requirement-badge")).toHaveCount(0);
  await expect(form.locator(".required-mark")).not.toHaveCount(0);
});

test("shows calendar overlays in the dashboard overview", async ({
  page,
  request
}) => {
  await openApp(page);
  await importExternalCalendar(page, "Synthetic Dashboard Calendar");

  const unavailableResponse = await request.post("/api/unavailable-periods", {
    data: {
      startDateTime: "2026-07-02T08:00:00.000Z",
      endDateTime: "2026-07-02T18:00:00.000Z",
      category: "duty",
      dutyRelated: true,
      affectsContact: true,
      affectsHolidays: false,
      location: "Synthetic service location",
      notes: "Synthetic documented unavailability",
      hasEvidence: false
    }
  });
  expect(unavailableResponse.ok()).toBeTruthy();
  const unavailable = await unavailableResponse.json() as { id: string };

  const eventsResponse = await request.get(
    "/api/external-calendar-events?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z"
  );
  expect(eventsResponse.ok()).toBeTruthy();
  const [event] = await eventsResponse.json() as Array<{ id: string }>;

  await page.reload();
  await expect(page.getByTestId("app-loading")).toBeHidden();
  await navigate(page, "dashboard");
  await page.getByTestId("month-picker").fill("2026-07");
  const dashboardCalendar = page.locator(".calendar-panel");
  await expect(dashboardCalendar.getByTestId(`external-calendar-event-${event?.id}`))
    .toHaveCount(3);
  await expect(dashboardCalendar.getByTestId(`calendar-unavailable-${unavailable.id}`))
    .toBeVisible();
});

test("explains empty entries caused by the selected month", async ({ page }) => {
  const childName = "Monatsliste Kind";
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const emptyMonth = [
    nextMonth.getFullYear(),
    String(nextMonth.getMonth() + 1).padStart(2, "0")
  ].join("-");
  await openApp(page);
  await createChild(page, childName);
  await createEntry(page, {
    childName,
    startDay: 8,
    startTime: "09:00",
    endDay: 8,
    endTime: "15:00",
    note: "Fiktiver Eintrag für die Monatsliste"
  });

  await navigate(page, "entries");
  await page.getByTestId("month-picker").fill(emptyMonth);
  const emptyState = page.getByTestId("entries-empty-state");
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText("Keine Einträge im ausgewählten Monat");
});

test("generates recurring weekend contact dates and shows them in the calendar", async ({
  page,
  request
}) => {
  const childName = "Rhythmus Kind";
  await openApp(page);
  await createChild(page, childName);

  await navigate(page, "contact");
  await expect(page.getByTestId("page-contact")).toBeVisible();
  await page.getByTestId("contact-pattern-start-date").fill("2026-07-03");
  await page.getByTestId("contact-pattern-end-date").fill("2026-07-31");
  await page.getByTestId("contact-pattern-friday-start-time").fill("16:00");
  await page.getByTestId("contact-pattern-sunday-end-time").fill("18:00");
  await page.getByTestId("contact-generation-start").fill("2026-07-01");
  await page.getByTestId("contact-generation-end").fill("2026-07-31");
  await expect(page.getByTestId("contact-generation-preview")).toContainText(
    "3 neue geplante Termine"
  );
  await expect(page.getByTestId("contact-preview-new-occurrence")).toHaveCount(3);
  await expect(page.getByTestId("contact-preview-day-2026-07-03").first())
    .toHaveClass(/contact-preview-day--active/);
  await expect(page.getByTestId("contact-preview-day-2026-07-02").first())
    .not.toHaveClass(/contact-preview-day--active/);

  await page.getByTestId("contact-pattern-save").click();
  await expect(page.getByTestId("contact-message")).toContainText(
    "Umgangsregel gespeichert"
  );
  await expect(page.getByTestId("contact-message")).toContainText(
    "geplante Termine"
  );
  await expect(page.getByTestId("contact-generated-entry")).toHaveCount(3);
  await expect(page.getByTestId("contact-preview-new-occurrence")).toHaveCount(0);
  await expect(page.getByTestId("contact-preview-existing-occurrence")).toHaveCount(3);
  await expect(page.getByTestId("contact-generation-preview")).toContainText(
    "bereits erzeugt"
  );

  const entriesResponse = await request.get("/api/care-entries");
  expect(entriesResponse.ok()).toBeTruthy();
  const generatedEntries = (await entriesResponse.json() as Array<{
    id: string;
    generatedByPatternId?: string;
    contactRuleSyncState?: string;
    startDateTime: string;
    status: string;
  }>).filter((entry) => entry.generatedByPatternId);
  const julyGeneratedEntries = generatedEntries.filter((entry) =>
    entry.startDateTime.startsWith("2026-07")
  );
  expect(generatedEntries).toHaveLength(3);
  expect(julyGeneratedEntries).toHaveLength(3);
  expect(generatedEntries.every((entry) => entry.status === "planned")).toBe(
    true
  );

  await navigate(page, "calendar");
  await page.getByTestId("month-picker").fill("2026-07");
  if (await page.getByTestId("calendar-view-month").isVisible()) {
    await page.getByTestId("calendar-view-month").click();
  }
  for (const entry of julyGeneratedEntries) {
    await expect(page.getByTestId(`calendar-entry-${entry.id}`).first())
      .toBeVisible();
  }

  const changedEntry = julyGeneratedEntries[0];
  await page.getByTestId(`calendar-entry-${changedEntry.id}`).first().click();
  await expect(page.getByTestId("entry-form")).toBeVisible();
  await expect(page.getByTestId("rule-entry-edit-choice")).toHaveCount(0);
  await page.getByTestId("entry-start-time").fill("17:00");
  await page.getByTestId("entry-submit").click();
  await expect(page.getByTestId("entry-form")).toBeHidden();
  await expect(page.getByTestId(`calendar-entry-${changedEntry.id}`).first())
    .toHaveClass(/calendar-event--exception/);
  await expect(page.getByTestId(`calendar-entry-${changedEntry.id}`).first())
    .toHaveAttribute("title", /Geänderter Regeltermin/);

  const changedResponse = await request.get("/api/care-entries");
  expect(changedResponse.ok()).toBeTruthy();
  const changedAfterEdit = (await changedResponse.json() as Array<{
    id: string;
    startDateTime: string;
    contactRuleSyncState?: string;
  }>).find((entry) => entry.id === changedEntry.id);
  expect(changedAfterEdit?.startDateTime).toContain("T17:00");
  expect(changedAfterEdit?.contactRuleSyncState).toBe("manual_override");

  await navigate(page, "contact");
  await expect(page.getByTestId("contact-generated-list")).toContainText(
    "geändert - bleibt beim Speichern der Regel erhalten"
  );
  await expect(page.getByTestId("contact-pattern-sync")).toBeVisible();
  await page.getByTestId("contact-pattern-sync").click();
  await expect(page.getByTestId("contact-message")).toContainText(
    "geplante Termine wurden"
  );

  const changedAfterResyncResponse = await request.get("/api/care-entries");
  expect(changedAfterResyncResponse.ok()).toBeTruthy();
  const changedAfterResync = (await changedAfterResyncResponse.json() as Array<{
    id: string;
    startDateTime: string;
    contactRuleSyncState?: string;
  }>).find((entry) => entry.id === changedEntry.id);
  expect(changedAfterResync?.startDateTime).toContain("T17:00");
  expect(changedAfterResync?.contactRuleSyncState).toBe("manual_override");

  await navigate(page, "calendar");
  await page.getByTestId("month-picker").fill("2026-07");
  await page.getByTestId(`calendar-entry-${julyGeneratedEntries[1].id}`).first().click();
  await expect(page.getByTestId("entry-form")).toBeVisible();
  await page.getByTestId("entry-form").getByRole("button", { name: "Abbrechen" }).click();
  await navigate(page, "contact");
  await expect(page.getByTestId("page-contact")).toBeVisible();
  await expect(page.getByTestId("contact-generated-entry").first().locator(".rule-entry__actions")).toHaveCount(0);
});

test("shows planned care conflicts consistently across care views", async ({
  page,
  request
}) => {
  const childResponse = await request.post("/api/children", {
    data: {
      name: "Konflikttest Kind",
      birthMonth: 1,
      birthYear: 2018,
      color: "#0f8b83"
    }
  });
  expect(childResponse.ok()).toBeTruthy();
  const child = await childResponse.json() as { id: string };
  const date = dateInCurrentMonth(22);
  const baseEntry = {
    childIds: [child.id],
    status: "planned",
    careScope: "hourly",
    overnight: false,
    schoolHandover: false,
    holiday: false,
    weekend: false,
    additionalCare: false,
    location: "other",
    handoverFrom: "mother",
    handoverTo: "mother",
    hasEvidence: false,
    trips: [],
    costs: []
  };
  const firstResponse = await request.post("/api/care-entries", {
    data: {
      ...baseEntry,
      startDateTime: `${date}T14:00`,
      endDateTime: `${date}T17:00`
    }
  });
  const secondResponse = await request.post("/api/care-entries", {
    data: {
      ...baseEntry,
      startDateTime: `${date}T16:00`,
      endDateTime: `${date}T19:00`
    }
  });
  expect(firstResponse.ok()).toBeTruthy();
  expect(secondResponse.ok()).toBeTruthy();
  const first = await firstResponse.json() as { id: string };

  await openApp(page);
  await navigate(page, "calendar");
  if (await page.getByTestId("calendar-view-month").isVisible()) {
    await page.getByTestId("calendar-view-month").click();
  }
  await expect(page.getByTestId(`calendar-entry-${first.id}`).first())
    .toHaveClass(/calendar-event--conflict-planned_warning/);

  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.getByTestId("calendar-view-agenda")).toBeVisible();
  await expect(page.getByTestId(`care-conflict-${first.id}`))
    .toContainText("Geplante Überschneidung");

  await navigate(page, "entries");
  await expect(page.getByTestId(`care-conflict-${first.id}`))
    .toContainText("Geplante Überschneidung");
  await page.getByTestId(`entry-row-${first.id}`).click();
  await expect(page.getByTestId("entry-form")).toBeVisible();
});

test("keeps care views usable when the conflict overview is incomplete", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, window.location.origin).pathname === "/api/care-conflicts") {
        return Promise.resolve(new Response(JSON.stringify({ items: [], complete: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });
  await openApp(page);
  await navigate(page, "calendar");
  await expect(page.getByTestId("page-calendar")).toBeVisible();
  await expect(page.getByTestId("care-conflicts-limited")).toBeVisible();

  await navigate(page, "entries");
  await expect(page.getByTestId("page-entries")).toBeVisible();
  await expect(page.getByTestId("care-conflicts-limited")).toBeVisible();
});

test("uses a weekly multi-day contact rule builder with calendar preview", async ({
  page,
  request
}) => {
  await openApp(page);
  await createChild(page, "Wochentage Kind");

  await navigate(page, "contact");
  await page.getByTestId("contact-recurrence-frequency").selectOption("weekly");
  await page.getByTestId("contact-recurrence-interval").fill("1");
  await page.getByTestId("contact-pattern-start-date").fill("2026-07-01");
  await page.getByTestId("contact-pattern-end-date").fill("2026-07-31");
  await page.getByTestId("contact-pattern-friday-start-time").fill("15:00");
  await page.getByTestId("contact-pattern-sunday-end-time").fill("18:00");
  const wednesday = page.getByTestId("contact-weekday-WE");
  if (!(await wednesday.locator("input").isChecked())) await wednesday.click();
  const friday = page.getByTestId("contact-weekday-FR");
  if (!(await friday.locator("input").isChecked())) await friday.click();
  await page.getByTestId("contact-generation-start").fill("2026-07-01");
  await page.getByTestId("contact-generation-end").fill("2026-07-10");

  await expect(page.getByTestId("contact-generation-preview")).toContainText(
    "4 neue geplante Termine"
  );
  await expect(page.getByTestId("contact-preview-day-2026-07-01").first())
    .toHaveClass(/contact-preview-day--active/);
  await expect(page.locator('[data-testid="contact-preview-day-2026-07-03"].contact-preview-day--active'))
    .toHaveCount(2);

  await page.getByTestId("contact-pattern-save").click();
  await expect(page.getByTestId("contact-message")).toContainText(
    "Umgangsregel gespeichert"
  );

  const entriesResponse = await request.get("/api/care-entries");
  expect(entriesResponse.ok()).toBeTruthy();
  const generatedEntries = (await entriesResponse.json() as Array<{
    id: string;
    contactRuleId?: string;
    startDateTime: string;
    status: string;
  }>).filter((entry) => entry.contactRuleId && entry.startDateTime.startsWith("2026-07"));
  expect(generatedEntries).toHaveLength(10);
  expect(generatedEntries.every((entry) => entry.status === "planned")).toBe(true);

  await navigate(page, "calendar");
  await page.getByTestId("month-picker").fill("2026-07");
  if (await page.getByTestId("calendar-view-month").isVisible()) {
    await page.getByTestId("calendar-view-month").click();
  }
  for (const entry of generatedEntries.slice(0, 4)) {
    await expect(page.getByTestId(`calendar-entry-${entry.id}`).first())
      .toBeVisible();
  }
});

test("derives unavailability impact hints from planned contact and holidays", async ({
  page,
  request
}) => {
  const childName = "Abwesenheit Kind";
  await openApp(page);
  await createChild(page, childName);

  const childrenResponse = await request.get("/api/children");
  expect(childrenResponse.ok()).toBeTruthy();
  const [child] = await childrenResponse.json() as Array<{ id: string }>;
  expect(child?.id).toBeTruthy();

  const entryResponse = await request.post("/api/care-entries", {
    data: {
      startDateTime: "2026-07-03T16:00:00.000Z",
      endDateTime: "2026-07-05T18:00:00.000Z",
      childIds: [child.id],
      generatedByPatternId: "pattern_synthetic_e2e",
      ruleOccurrenceDate: "2026-07-03",
      status: "planned",
      overnight: true,
      schoolHandover: false,
      holiday: false,
      weekend: true,
      additionalCare: false,
      location: "main_residence",
      hasEvidence: false,
      trips: [],
      costs: []
    }
  });
  expect(entryResponse.ok()).toBeTruthy();

  const holidayResponse = await request.post("/api/holiday-periods", {
    data: {
      name: "Fiktiver Ferienblock",
      startDate: "2026-07-01",
      endDate: "2026-07-10",
      childIds: [child.id],
      assignedTo: "father"
    }
  });
  expect(holidayResponse.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId("app-loading")).toBeHidden();
  await navigate(page, "unavailable");
  await expect(page.getByTestId("page-unavailable")).toBeVisible();
  await page.getByTestId("unavailable-add").click();
  const form = page.getByTestId("unavailable-form");
  await expectNoUnavailableModalOverflow(page);
  await form.getByTestId("unavailable-start-date").fill("2026-07-03");
  await form.getByTestId("unavailable-start-time").fill("15:00");
  await form.getByTestId("unavailable-end-date").fill("2026-07-03");
  await form.getByTestId("unavailable-end-time").fill("20:00");
  await expectNoUnavailableModalOverflow(page);

  await expect(form.getByTestId("unavailable-derived-impact")).toContainText(
    "geplanten Umgangstermin"
  );
  await expect(form.getByTestId("unavailable-derived-impact")).toContainText(
    "Ferienblock"
  );
  await expect(form).toContainText("Prüfe, ob „Betrifft Umgang“ markiert");
  await expect(form).toContainText("Prüfe, ob „Betrifft Ferien“ markiert");

  await form.getByTestId("unavailable-affects-contact").check({ force: true });
  await form.getByTestId("unavailable-affects-holidays").check({ force: true });
  await expectNoUnavailableModalOverflow(page);
  await expect(form.getByTestId("unavailable-derived-impact")).toContainText(
    "wird im Soll-Ist-Hinweis berücksichtigt"
  );
  await expect(form.getByTestId("unavailable-derived-impact")).toContainText(
    "wird in Ferienhinweisen berücksichtigt"
  );
});

test("downloads a complete JSON backup without raw calendar payloads", async ({
  page
}) => {
  const childName = "Export Kind";
  await openApp(page);
  await createChild(page, childName);
  await createEntry(page, {
    childName,
    startDay: 6,
    startTime: "09:00",
    endDay: 6,
    endTime: "15:00",
    note: "Synthetic export entry"
  });
  await importExternalCalendar(page, "Synthetic Export Calendar");

  await navigate(page, "backup");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-json").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  let raw = "";
  for await (const chunk of stream!) raw += chunk.toString();
  const backup = JSON.parse(raw) as {
    application: string;
    data: {
      children: Array<{ name: string }>;
      entries: Array<{ notes?: string }>;
      settings: Record<string, unknown>;
      externalCalendarSources: Array<{ id: string; name: string }>;
      externalCalendarEvents: Array<{ sourceId: string; title: string; rawHash: string }>;
    };
  };

  expect(backup.application).toBe("betreuungskalender");
  expect(backup.data.children).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: childName })
  ]));
  expect(backup.data.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ notes: "Synthetic export entry" })
  ]));
  expect(backup.data.settings).toEqual(expect.objectContaining({ kilometerRate: expect.any(Number) }));
  expect(backup.data.externalCalendarSources).toHaveLength(1);
  expect(backup.data.externalCalendarEvents).toEqual([
    expect.objectContaining({ title: "E2E Holiday", rawHash: expect.any(String) })
  ]);
  expect(backup.data.externalCalendarEvents[0]?.sourceId).toBe(
    backup.data.externalCalendarSources[0]?.id
  );
  expect(raw).not.toContain("BEGIN:VCALENDAR");
  expect(raw).not.toContain("NODE_ENV");
  expect(raw).not.toContain("DATABASE_PATH");
  expect(raw).not.toContain("process.env");
});

test("requires a successful dry run before importing a portable transfer", async ({
  page,
  request
}) => {
  const childName = "Transfer Kind";
  await openApp(page);
  await createChild(page, childName);

  await navigate(page, "backup");
  await expect(page.getByTestId("data-transfer-import")).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-json").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const transfer = Buffer.concat(chunks);

  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: "betreuungskalender-transfer-test.json",
    mimeType: "application/json",
    buffer: transfer
  });
  await expect(page.getByTestId("data-transfer-import")).toHaveCount(0);

  await page.getByTestId("data-transfer-dry-run").click();
  const result = page.getByTestId("data-transfer-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText(/ready|warnings/);
  await expect(result).toContainText("entries");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("data-transfer-import").click();
  await expect(page.getByTestId("transfer-actors")).toBeVisible();
  const childrenResponse = await request.get("/api/children");
  expect(childrenResponse.ok()).toBeTruthy();
  await expect(childrenResponse.json()).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining({ name: childName })
  ]));
});

test("records partial actual care details from the entry form", async ({
  page,
  request
}) => {
  const childAResponse = await request.post("/api/children", {
    data: {
      name: "Teilkind A",
      birthMonth: 5,
      birthYear: 2018,
      color: "#0f8b8d"
    }
  });
  expect(childAResponse.ok()).toBeTruthy();
  const childBResponse = await request.post("/api/children", {
    data: {
      name: "Teilkind B",
      birthMonth: 9,
      birthYear: 2020,
      color: "#6d5dfc"
    }
  });
  expect(childBResponse.ok()).toBeTruthy();
  await openApp(page);

  const childrenResponse = await request.get("/api/children");
  expect(childrenResponse.ok()).toBeTruthy();
  const children = await childrenResponse.json() as Array<{ id: string; name: string }>;
  const childA = children.find((child) => child.name === "Teilkind A");
  const childB = children.find((child) => child.name === "Teilkind B");
  expect(childA?.id).toBeTruthy();
  expect(childB?.id).toBeTruthy();
  const actualDate = dateInCurrentMonth(6);

  const createResponse = await request.post("/api/care-entries", {
    data: {
      startDateTime: `${actualDate}T08:00:00.000Z`,
      endDateTime: `${actualDate}T18:00:00.000Z`,
      childIds: [childA!.id, childB!.id],
      status: "planned",
      overnight: false,
      schoolHandover: false,
      holiday: false,
      weekend: false,
      additionalCare: false,
      location: "mainResidence",
      handoverFrom: "mother",
      handoverTo: "mother",
      hasEvidence: false,
      trips: [],
      costs: []
    }
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = await createResponse.json() as { id: string };
  await page.reload();
  await expect(page.getByTestId("app-loading")).toBeHidden();

  await navigate(page, "entries");
  await page.getByTestId(`entry-row-${created.id}`).click();
  const form = page.getByTestId("entry-form");
  await form.getByRole("radio", { name: "Teilweise", exact: true }).check({ force: true });
  await expect(form.getByText("Teilweise Durchführung erfassen")).toBeVisible();
  await form.getByTestId("entry-actual-child-choice")
    .filter({ hasText: "Teilkind B" })
    .getByTestId("entry-actual-child-option")
    .uncheck({ force: true });
  await form.getByTestId("entry-actual-start-time").fill("10:00");
  await form.getByTestId("entry-actual-end-time").fill("15:00");
  await form.getByTestId("entry-submit").click();
  await expect(form).toBeHidden();

  const entriesResponse = await request.get("/api/care-entries");
  expect(entriesResponse.ok()).toBeTruthy();
  const entries = await entriesResponse.json() as Array<{
    id: string;
    status: string;
    actualChildIds?: string[];
    actualStartDateTime?: string;
    actualEndDateTime?: string;
    plannedStartDateTime?: string;
    plannedEndDateTime?: string;
  }>;
  const changed = entries.find((entry) => entry.id === created.id);
  expect(changed).toEqual(expect.objectContaining({
    status: "partial",
    actualChildIds: [childA!.id],
    actualStartDateTime: `${actualDate}T10:00`,
    actualEndDateTime: `${actualDate}T15:00`,
    plannedStartDateTime: `${actualDate}T08:00:00.000Z`,
    plannedEndDateTime: `${actualDate}T18:00:00.000Z`
  }));
});
