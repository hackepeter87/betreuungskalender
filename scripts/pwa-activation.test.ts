import assert from "node:assert/strict";
import test from "node:test";
import {
  activateOptionalServiceWorker,
  initializeOptionalServiceWorker,
  PWA_STORAGE_ACTIVATED_KEY,
  type OptionalServiceWorkerEnvironment
} from "../src/lib/serviceWorker.js";

function environment(input: { marker?: boolean; push?: boolean; registrations?: number } = {}) {
  const values = new Map<string, string>();
  if (input.marker) values.set(PWA_STORAGE_ACTIVATED_KEY, "true");
  const unregistered: number[] = [];
  const registrations = Array.from({ length: input.registrations ?? 1 }, (_, index) => ({
    unregister: async () => { unregistered.push(index); return true; },
    pushManager: { getSubscription: async () => input.push ? ({ endpoint: "https://push.invalid" }) : null }
  })) as unknown as ServiceWorkerRegistration[];
  let registerCalls = 0;
  const deletedCaches: string[] = [];
  const env: OptionalServiceWorkerEnvironment = {
    production: true,
    serviceWorker: {
      getRegistrations: async () => registrations,
      register: async () => {
        registerCalls += 1;
        return registrations[0] ?? ({} as ServiceWorkerRegistration);
      }
    } as Pick<ServiceWorkerContainer, "getRegistrations" | "register">,
    caches: {
      keys: async () => ["betreuungskalender-v4", "unrelated-cache"],
      delete: async (key) => { deletedCaches.push(key); return true; }
    },
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); }
    }
  };
  return { env, values, unregistered, deletedCaches, registerCalls: () => registerCalls };
}

test("ordinary browser visits remove legacy optional storage without touching unrelated caches", async () => {
  const state = environment({ registrations: 2 });
  await initializeOptionalServiceWorker(false, state.env);
  assert.deepEqual(state.unregistered, [0, 1]);
  assert.deepEqual(state.deletedCaches, ["betreuungskalender-v4"]);
  assert.equal(state.registerCalls(), 0);
  assert.equal(state.values.has(PWA_STORAGE_ACTIVATED_KEY), false);
});

test("standalone and previously activated use register the service worker idempotently", async () => {
  for (const input of [{ standalone: true, marker: false }, { standalone: false, marker: true }]) {
    const state = environment({ marker: input.marker });
    await initializeOptionalServiceWorker(input.standalone, state.env);
    assert.equal(state.registerCalls(), 1);
    assert.equal(state.values.get(PWA_STORAGE_ACTIVATED_KEY), "true");
    assert.deepEqual(state.unregistered, []);
  }
});

test("an existing push subscription preserves registration and records activation", async () => {
  const state = environment({ push: true });
  await initializeOptionalServiceWorker(false, state.env);
  assert.equal(state.registerCalls(), 0);
  assert.deepEqual(state.unregistered, []);
  assert.equal(state.values.get(PWA_STORAGE_ACTIVATED_KEY), "true");
});

test("explicit activation registers before storing the activation marker", async () => {
  const state = environment({ registrations: 0 });
  const registration = await activateOptionalServiceWorker(state.env);
  assert.ok(registration);
  assert.equal(state.registerCalls(), 1);
  assert.equal(state.values.get(PWA_STORAGE_ACTIVATED_KEY), "true");
});
