import type { BaselineOwners, RawColorBudget } from "./style-guardrails";

// Existing raw colors are tracked as migration debt. Counts may decrease, but
// increases require a semantic token or an explicit contract review.
export const rawColorBudget = {
  "src/styles/pages.css": {
    "#17213a": 1, "#20304d": 1, "#294845": 1,
    "#344054": 2, "#475467": 2, "#4d7472": 1, "#5150ad": 1,
    "#52606f": 1, "#5451b8": 1, "#554b8c": 3, "#566175": 1, "#586174": 1,
    "#80530c": 3, "#83530b": 2, "#8a560a": 2,
    "#8a560f": 1, "#8f3340": 1, "#8fc9c6": 1,
    "#a9d8d5": 1, "#aab4c1": 1, "#acd8d5": 2, "#b9deda": 3,
    "#c8c1e8": 1, "#d69b32": 1, "#d6dce4": 1,
    "#d88c96": 1, "#e5b854": 1, "#e6a9af": 1, "#eeeafb": 1,
    "#eef5f4": 1, "#efd299": 1, "#f1f7f6": 1,
    "#f2f3f6": 1, "#fafbfc": 1, "#fbfbff": 1,
    "#fbfcfd": 8, "#fff": 6, "#fff0d5": 1, "#fffafa": 1,
    "rgba(13, 148, 136, 0.32)": 1,
    "rgba(18, 31, 52, 0.42)": 1, "rgba(29, 45, 73, 0.07)": 1
  },
  "src/styles/print.css": { "#fff": 1 },
  "src/styles/responsive.css": {
    "#344054": 1,
    "#b8ddd9": 1,
    "#eef2f6": 1,
    "#f2fbfa": 1
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
  ".button:disabled": "components",
  ".field": "components",
  ".field-label-row": "components",
  ".panel-form": "components",
  ".subsection-heading": "components",
  ".status-pill": "components",
  ".calendar-grid": "pages",
  ".list-toolbar": "components",
  ".summary-strip": "components",
  ".period-selector": "components",
  ".confirmation-card": "components",
  ".modal-backdrop": "components",
  ".choice-card": "components",
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
