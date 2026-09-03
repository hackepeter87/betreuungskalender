import postcss from "postcss";

export interface StyleSource {
  path: string;
  layer: string;
  source: string;
}

export type StyleGuardrailIssueType =
  | "layer-contract"
  | "unlayered-rule"
  | "raw-color"
  | "duplicate-declaration"
  | "missing-baseline"
  | "duplicate-baseline"
  | "misowned-baseline"
  | "misowned-breakpoint"
  | "unapproved-breakpoint";

export interface StyleGuardrailIssue {
  type: StyleGuardrailIssueType;
  file: string;
  detail: string;
}

export type RawColorBudget = Readonly<Record<string, Readonly<Record<string, number>>>>;
export type BaselineOwners = Readonly<Record<string, string>>;

const rawColorPattern = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/g;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeColor(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function topLevelSelectors(source: string): string[] {
  return postcss.parse(source).nodes.flatMap((node) =>
    node.type === "rule" ? node.selectors.map(normalizeWhitespace) : []);
}

export function findRawColorCounts(source: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of withoutComments(source).matchAll(rawColorPattern)) {
    const color = normalizeColor(match[0]);
    counts[color] = (counts[color] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function findOverriddenDeclarations(file: string, source: string): StyleGuardrailIssue[] {
  const issues: StyleGuardrailIssue[] = [];
  postcss.parse(source, { from: file }).walkRules((rule) => {
    const selector = normalizeWhitespace(rule.selector);
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const declaration of rule.nodes) {
      if (declaration.type !== "decl") continue;
      const property = declaration.prop.startsWith("--") ? declaration.prop : declaration.prop.toLowerCase();
      if (seen.has(property) && !reported.has(property)) {
        issues.push({
          type: "duplicate-declaration",
          file,
          detail: `${property} is declared more than once in ${selector}`
        });
        reported.add(property);
      }
      seen.add(property);
    }
  });
  return issues;
}

export function validateRawColorBudget(
  file: string,
  source: string,
  budget: Readonly<Record<string, number>>
): StyleGuardrailIssue[] {
  return Object.entries(findRawColorCounts(source))
    .filter(([color, count]) => count > (budget[color] ?? 0))
    .map(([color, count]) => ({
      type: "raw-color" as const,
      file,
      detail: `${color} exceeds reviewed count ${budget[color] ?? 0} (found ${count})`
    }));
}

export function validateLayerEntry(
  source: string,
  expectedLayers: readonly string[]
): StyleGuardrailIssue[] {
  const issues: StyleGuardrailIssue[] = [];
  const expectedDeclaration = `@layer ${expectedLayers.join(", ")};`;
  const layerDeclarations = withoutComments(source).match(/@layer\s+[^;{]+;/g) ?? [];
  if (layerDeclarations.length !== 1 || normalizeWhitespace(layerDeclarations[0]) !== expectedDeclaration) {
    issues.push({
      type: "layer-contract",
      file: "src/styles.css",
      detail: `expected ${expectedDeclaration}`
    });
  }

  const sourceWithoutComments = withoutComments(source);
  const allImports = sourceWithoutComments.match(/@import\s+[^;]+;/g) ?? [];
  const imports = [...sourceWithoutComments.matchAll(/@import\s+"\.\/styles\/([^."]+)\.css"\s+layer\(([^)]+)\);/g)]
    .map((match) => `${match[1]}:${match[2]}`);
  const expectedImports = expectedLayers.map((layer) => `${layer}:${layer}`);
  if (allImports.length !== imports.length || imports.join("\0") !== expectedImports.join("\0")) {
    issues.push({
      type: "layer-contract",
      file: "src/styles.css",
      detail: "layer imports do not match the declared order"
    });
  }

  for (const selector of topLevelSelectors(source)) {
    issues.push({ type: "unlayered-rule", file: "src/styles.css", detail: selector });
  }
  return issues;
}

export function validateBaselineOwnership(
  sources: readonly StyleSource[],
  owners: BaselineOwners
): StyleGuardrailIssue[] {
  const selectorsBySource = sources.map((source) => ({
    ...source,
    selectors: topLevelSelectors(source.source)
  }));
  const issues: StyleGuardrailIssue[] = [];

  for (const [selector, owner] of Object.entries(owners)) {
    const occurrences = selectorsBySource.flatMap((source) =>
      source.selectors.filter((candidate) => candidate === selector).map(() => source)
    );
    if (occurrences.length === 0) {
      issues.push({ type: "missing-baseline", file: owner, detail: selector });
      continue;
    }
    if (occurrences.length > 1) {
      issues.push({
        type: "duplicate-baseline",
        file: occurrences.map(({ path }) => path).join(", "),
        detail: `${selector} has ${occurrences.length} top-level definitions`
      });
    }
    for (const occurrence of occurrences.filter(({ layer }) => layer !== owner)) {
      issues.push({
        type: "misowned-baseline",
        file: occurrence.path,
        detail: `${selector} belongs to ${owner}, not ${occurrence.layer}`
      });
    }
  }
  return issues;
}

export function validateBreakpointOwnership(
  sources: readonly StyleSource[],
  approvedQueries: readonly string[]
): StyleGuardrailIssue[] {
  const approved = new Set(approvedQueries.map(normalizeWhitespace));
  const issues: StyleGuardrailIssue[] = [];

  for (const source of sources) {
    const queries = [...withoutComments(source.source).matchAll(/@media\s*([^{}]+)\{/g)]
      .map((match) => normalizeWhitespace(match[1]))
      .filter((query) => /\((?:min|max)-width\s*:/.test(query));
    for (const query of queries) {
      if (source.layer !== "responsive") {
        issues.push({
          type: "misowned-breakpoint",
          file: source.path,
          detail: `${query} belongs to responsive`
        });
      }
      if (!approved.has(query)) {
        issues.push({ type: "unapproved-breakpoint", file: source.path, detail: query });
      }
    }
  }
  return issues;
}
