import type { AppLocale } from "./resources";

export const contactSyncMessages = {
  de: {
    action: "Termine synchronisieren",
    completed: "{count} geplante Termine wurden bis {to} synchronisiert.",
    noChanges: "Die Regeltermine sind bereits vollständig synchronisiert.",
    flow: "Mit Enddatum wird der vollständige Regelzeitraum von bis zu 36 Monaten synchronisiert. Ohne Enddatum plant die App weiterhin die nächsten 12 Monate. Manuell geänderte oder abgesagte Termine bleiben erhalten."
  },
  en: {
    action: "Synchronize dates",
    completed: "{count} planned dates were synchronized through {to}.",
    noChanges: "The recurring dates are already fully synchronized.",
    flow: "With an end date, the complete rule period of up to 36 months is synchronized. Without an end date, the app continues to plan the next 12 months. Manually changed or cancelled dates are preserved."
  }
} as const satisfies Record<AppLocale, Record<string, string>>;

export function contactSyncMessage(
  locale: AppLocale,
  key: keyof (typeof contactSyncMessages)["de"],
  values: Record<string, string | number> = {}
): string {
  let message: string = contactSyncMessages[locale][key];
  for (const [name, value] of Object.entries(values)) {
    message = message.replaceAll(`{${name}}`, String(value));
  }
  return message;
}
