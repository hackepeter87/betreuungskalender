import type { BaselineOwners, RawColorBudget } from "./style-guardrails";

// Existing raw colors are tracked as migration debt. Counts may decrease, but
// increases require a semantic token or an explicit contract review.
export const rawColorBudget = {
  "src/styles/components.css": {
    "#344054": 1, "#3730a3": 1, "#41516b": 1, "#475467": 3, "#4d7472": 1,
    "#554b8c": 3, "#566168": 1, "#604713": 1, "#785712": 1, "#8175bb": 1,
    "#8f3028": 1, "#8f3540": 1, "#9a5c06": 1, "#9aa4b2": 1, "#9bcfcd": 1,
    "#9d3945": 1, "#9da9b7": 1, "#a23845": 1, "#a23d48": 1, "#b9deda": 2,
    "#c8d5e2": 1, "#cfd6df": 1, "#d5d9dc": 1, "#d8d1ee": 2, "#ead39a": 1,
    "#eeeafb": 1, "#eef2ff": 1, "#efc5c9": 1, "#efd299": 1, "#f0c1ba": 1,
    "#f3f4f5": 1, "#f4f7fa": 1, "#f7f5fd": 2, "#fafbfc": 1, "#fff": 4,
    "#fff0ee": 1, "#fff8e7": 1, "rgb(20 31 35 / 25%)": 1,
    "rgb(20 31 35 / 45%)": 1, "rgb(22 111 103 / 18%)": 2,
    "rgba(196, 63, 82, 0.18)": 1, "rgba(20, 33, 61, 0.25)": 1,
    "rgba(8, 127, 123, 0.18)": 1
  },
  "src/styles/pages.css": {
    "#17213a": 1, "#20304d": 1, "#264653": 1, "#294845": 1, "#33245d": 1,
    "#344054": 3, "#475467": 4, "#4d7472": 1, "#514783": 1, "#5150ad": 1,
    "#52606f": 1, "#5451b8": 1, "#554b8c": 5, "#566175": 1, "#586174": 1,
    "#7a4b00": 1, "#80530c": 3, "#8175bb": 2, "#83530b": 2, "#8a560a": 2,
    "#8a560f": 2, "#8f3340": 1, "#8f3540": 1, "#8fc9c6": 1, "#9b8bdc": 1,
    "#a5b4fc": 1, "#a9d8d5": 1, "#aab4c1": 1, "#acd8d5": 2, "#b9deda": 3,
    "#c44f5d": 1, "#c8c1e8": 2, "#cbdedc": 1, "#d69b32": 1, "#d6dce4": 1,
    "#d88c96": 1, "#d89b23": 1, "#d97706": 2, "#e3def6": 1, "#e5b24b": 1,
    "#e5b854": 1, "#e6a9af": 1, "#eab308": 1, "#eeeafb": 2, "#eef2ff": 1,
    "#eef5f4": 1, "#efb9be": 1, "#efd299": 1, "#f0f9f8": 1, "#f1f7f6": 1,
    "#f2c98f": 1, "#f2f3f6": 1, "#f2f5f9": 1, "#f3f1fb": 1, "#f5c56b": 1,
    "#f5f2ff": 1, "#f8fafc": 1, "#fafbfc": 2, "#fbfaff": 1, "#fbfbff": 1,
    "#fbfcfd": 9, "#fff": 6, "#fff0d5": 1, "#fff7e6": 1, "#fff7e8": 2,
    "#fff8e8": 1, "#fffafa": 2, "#fffbeb": 1, "#fffdf7": 1,
    "rgb(15 23 42 / 18%)": 1, "rgba(13, 148, 136, 0.32)": 1,
    "rgba(18, 31, 52, 0.42)": 1, "rgba(29, 45, 73, 0.07)": 1
  },
  "src/styles/print.css": { "#fff": 1 },
  "src/styles/responsive.css": {
    "#344054": 1, "#36556e": 1, "#9bcfcd": 1, "#b8ddd9": 1, "#c7dbec": 1,
    "#eef2f6": 1, "#f2fbfa": 1, "#f3f8fc": 1, "#fff": 1,
    "rgb(15 23 42 / 28%)": 1, "rgba(18, 31, 52, 0.36)": 1,
    "rgba(255, 255, 255, 0.96)": 1, "rgba(255, 255, 255, 0.97)": 2,
    "rgba(255, 255, 255, 0.98)": 3, "rgba(29, 45, 73, 0.08)": 3
  },
  "src/styles/shell.css": {
    "#23324a": 1, "#344054": 1, "#516079": 1, "#80560b": 1, "#9bcfcd": 2,
    "#a9d8d5": 1, "#b9deda": 1, "#efd299": 1, "#fff": 2,
    "rgba(15, 137, 128, 0.35)": 1, "rgba(20, 33, 61, 0.08)": 2,
    "rgba(29, 45, 73, 0.08)": 1
  }
} as const satisfies RawColorBudget;

export const baselineOwners = {
  ":root": "tokens",
  "*": "base",
  "html": "base",
  "body": "base",
  ".app-shell": "shell",
  ".sidebar": "shell",
  ".page": "components",
  ".panel": "components",
  ".panel__header": "components",
  ".calendar-grid": "pages",
  ".list-toolbar": "pages",
  ".settings-section": "pages",
  ".settings-form-grid": "pages"
} as const satisfies BaselineOwners;

export const approvedViewportQueries = [
  "(max-width: 430px)",
  "(max-width: 560px)",
  "(max-width: 640px)",
  "(max-width: 720px)",
  "(max-width: 767px)",
  "(max-width: 900px)",
  "(max-width: 1050px)",
  "(max-width: 1199px)",
  "(min-width: 768px)",
  "(min-width: 721px) and (max-width: 1199px)",
  "(min-width: 768px) and (max-width: 1199px)",
  "(min-width: 1024px) and (max-width: 1199px)"
] as const;
