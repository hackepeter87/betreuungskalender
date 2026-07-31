import { expect, test } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  navigate,
  openApp,
  resetApp
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("keeps the viewer experience read-only and free of administrative sections", async ({
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
            id: "user-viewer-browser",
            displayName: "Viewer Browser",
            role: "readonly"
          },
          workspaceAccess: true,
          workspaceRole: "viewer",
          isOwner: false,
          permissions: [
            "appointments:view",
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
  await navigate(page, "calendar");
  await expect(page.getByTestId("calendar-add-entry")).toHaveCount(0);
  await expect(page.getByTestId("calendar-add-unavailable")).toHaveCount(0);

  await navigate(page, "settings");
  await expect(page.getByTestId("notification-preferences")).toBeVisible();
  await expect(page.getByTestId("member-invitations")).toHaveCount(0);
  await expect(page.getByTestId("instance-readiness")).toHaveCount(0);
  await expect(page.getByTestId("settings-add-child")).toHaveCount(0);
  await expect(page.getByTestId("external-calendar-manager")).toHaveCount(0);
  await expect(page.getByTestId("calendar-feed-manager")).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
});

test("keeps admin settings available without owner-only controls", async ({ page }) => {
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
            id: "user-admin-browser",
            displayName: "Admin Browser",
            role: "admin"
          },
          workspaceAccess: true,
          workspaceRole: "admin",
          isOwner: false,
          permissions: [
            "appointments:view", "appointments:create", "appointments:edit",
            "appointments:delete", "appointments:confirm", "children:view-basic",
            "children:view-sensitive", "children:manage", "notes:view",
            "planning:view", "planning:manage", "reports:view", "settings:view",
            "settings:manage", "notifications:manage-own", "feeds:manage-own",
            "audit:view", "instance:inspect", "exports:run"
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
  await navigate(page, "settings");
  await expect(page.getByTestId("instance-readiness")).toBeVisible();
  await expect(page.getByTestId("settings-add-child")).toBeVisible();
  await expect(page.getByTestId("external-calendar-manager")).toBeVisible();
  await expect(page.getByTestId("member-invitations")).toHaveCount(0);
  await expect(page.getByTestId("settings-load-edge-case-demo")).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
});

test("keeps editor domain workflows available without administrative settings", async ({
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
            id: "user-editor-browser",
            displayName: "Editor Browser",
            role: "parent"
          },
          workspaceAccess: true,
          workspaceRole: "editor",
          isOwner: false,
          permissions: [
            "appointments:view", "appointments:create", "appointments:edit",
            "appointments:delete", "appointments:confirm", "children:view-basic",
            "children:view-sensitive", "children:manage", "notes:view",
            "planning:view", "planning:manage", "reports:view",
            "notifications:manage-own", "feeds:manage-own"
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
  await navigate(page, "contact");
  await expect(page.getByTestId("page-contact")).toBeVisible();
  await navigate(page, "report");
  await expect(page.getByTestId("page-report")).toBeVisible();
  await navigate(page, "settings");
  await expect(page.getByTestId("settings-add-child")).toBeVisible();
  await expect(page.getByTestId("external-calendar-manager")).toBeVisible();
  await expect(page.getByTestId("calendar-feed-manager")).toBeVisible();
  await expect(page.getByTestId("instance-readiness")).toHaveCount(0);
  await expect(page.getByTestId("member-invitations")).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
});
