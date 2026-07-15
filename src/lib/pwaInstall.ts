export const PWA_INSTALL_DISMISS_KEY = "betreuungskalender:ui:pwa-install-dismissed-at:v1";
export const PWA_INSTALL_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

export type PwaInstallAvailability = "browser" | "ios" | "none";
export type PwaInstallOutcome = "accepted" | "dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: PwaInstallOutcome; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let dismissedForSession = false;
let revision = 0;
const listeners = new Set<() => void>();

function emitChange() {
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function isIosDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number
): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
}

export function isStandaloneDisplay(
  displayModeStandalone: boolean,
  navigatorStandalone: boolean
): boolean {
  return displayModeStandalone || navigatorStandalone;
}

export function isInstallPromptDismissed(
  storedAt: string | null,
  now = Date.now(),
  dismissDuration = PWA_INSTALL_DISMISS_MS
): boolean {
  if (!storedAt) return false;
  const timestamp = Number(storedAt);
  return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp < dismissDuration;
}

function isRunningStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return isStandaloneDisplay(
    window.matchMedia?.("(display-mode: standalone)").matches ?? false,
    navigatorWithStandalone.standalone === true
  );
}

function wasDismissed(): boolean {
  if (dismissedForSession) return true;
  if (typeof window === "undefined") return false;
  try {
    return isInstallPromptDismissed(window.localStorage.getItem(PWA_INSTALL_DISMISS_KEY));
  } catch {
    return false;
  }
}

export function getPwaInstallAvailability(): PwaInstallAvailability {
  if (typeof navigator === "undefined" || isRunningStandalone() || wasDismissed()) return "none";
  if (deferredPrompt) return "browser";
  return isIosDevice(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints
  ) ? "ios" : "none";
}

export function dismissPwaInstallPrompt(): void {
  dismissedForSession = true;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PWA_INSTALL_DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage can be unavailable in strict privacy modes; hiding still works for this page.
    }
  }
  deferredPrompt = null;
  emitChange();
}

export async function promptPwaInstall(): Promise<PwaInstallOutcome | null> {
  const prompt = deferredPrompt;
  if (!prompt) return null;
  deferredPrompt = null;
  emitChange();
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === "dismissed") dismissPwaInstallPrompt();
  return choice.outcome;
}

export function subscribePwaInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaInstallRevision(): number {
  return revision;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    if (isRunningStandalone() || wasDismissed()) return;
    deferredPrompt = event as BeforeInstallPromptEvent;
    emitChange();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    emitChange();
  });
}
