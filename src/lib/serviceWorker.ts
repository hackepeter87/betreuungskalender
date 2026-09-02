export const PWA_STORAGE_ACTIVATED_KEY = "betreuungskalender:ui:pwa-storage-activated:v1";
export const PWA_CACHE_PREFIX = "betreuungskalender-";

export interface OptionalServiceWorkerEnvironment {
  production?: boolean;
  serviceWorker?: Pick<ServiceWorkerContainer, "getRegistrations" | "register">;
  caches?: Pick<CacheStorage, "keys" | "delete">;
  storage?: Pick<Storage, "getItem" | "setItem">;
}

function browserEnvironment(): OptionalServiceWorkerEnvironment {
  return {
    production: import.meta.env?.PROD ?? false,
    serviceWorker: typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
    caches: typeof window !== "undefined" ? window.caches : undefined,
    storage: typeof window !== "undefined" ? window.localStorage : undefined
  };
}

function hasActivationMarker(storage: OptionalServiceWorkerEnvironment["storage"]): boolean {
  try {
    return storage?.getItem(PWA_STORAGE_ACTIVATED_KEY) === "true";
  } catch {
    return false;
  }
}

function storeActivationMarker(storage: OptionalServiceWorkerEnvironment["storage"]): void {
  try {
    storage?.setItem(PWA_STORAGE_ACTIVATED_KEY, "true");
  } catch {
    // Registration remains useful in restrictive storage modes.
  }
}

async function registrationHasPushSubscription(registration: ServiceWorkerRegistration): Promise<boolean> {
  try {
    return Boolean(await registration.pushManager?.getSubscription());
  } catch {
    return false;
  }
}

async function clearApplicationCaches(caches: OptionalServiceWorkerEnvironment["caches"]): Promise<void> {
  if (!caches) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(PWA_CACHE_PREFIX))
      .map((key) => caches.delete(key)));
  } catch {
    // Cache cleanup is best-effort and must not block the application.
  }
}

export async function activateOptionalServiceWorker(
  environment: OptionalServiceWorkerEnvironment = browserEnvironment()
): Promise<ServiceWorkerRegistration | undefined> {
  if (!environment.production || !environment.serviceWorker) return undefined;
  const registration = await environment.serviceWorker.register("/sw.js");
  storeActivationMarker(environment.storage);
  return registration;
}

export async function initializeOptionalServiceWorker(
  standalone: boolean,
  environment: OptionalServiceWorkerEnvironment = browserEnvironment()
): Promise<void> {
  const serviceWorker = environment.serviceWorker;
  if (!serviceWorker) return;

  if (!environment.production) {
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    await clearApplicationCaches(environment.caches);
    return;
  }

  if (standalone || hasActivationMarker(environment.storage)) {
    await activateOptionalServiceWorker(environment);
    return;
  }

  const registrations = await serviceWorker.getRegistrations();
  const pushStates = await Promise.all(registrations.map(registrationHasPushSubscription));
  if (pushStates.some(Boolean)) {
    storeActivationMarker(environment.storage);
    return;
  }

  await Promise.all(registrations.map((registration) => registration.unregister()));
  await clearApplicationCaches(environment.caches);
}

export const serviceWorkerTesting = { clearApplicationCaches, hasActivationMarker };
