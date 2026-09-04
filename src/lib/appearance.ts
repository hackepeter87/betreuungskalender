import { useSyncExternalStore } from "react";

export type AppearancePreference = "system" | "light" | "dark";

function subscribe(listener: () => void) {
  window.addEventListener("appearance-change", listener);
  return () => window.removeEventListener("appearance-change", listener);
}

function readPreference(): AppearancePreference {
  const value = document.documentElement.dataset.appearancePreference;
  return value === "light" || value === "dark" ? value : "system";
}

export function useAppearance() {
  return useSyncExternalStore(subscribe, readPreference);
}

export function setAppearance(preference: AppearancePreference) {
  window.dispatchEvent(new CustomEvent("appearance-preference-change", { detail: preference }));
}
