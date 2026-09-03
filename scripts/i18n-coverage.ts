import ts from "typescript";

type CatalogLeaf = string | readonly string[];
type CatalogTree = Record<string, unknown>;

export type TranslationCoverageIssueType =
  | "missing"
  | "unknown"
  | "invalid"
  | "placeholder"
  | "inherited"
  | "invalid-dynamic"
  | "invalid-exemption"
  | "unnecessary-exemption";

export interface TranslationCoverageIssue {
  locale: string;
  key: string;
  type: TranslationCoverageIssueType;
  detail?: string;
}

interface TranslationCoverageOptions {
  dynamicKeys?: readonly string[];
  exemptions?: Readonly<Record<string, readonly string[]>>;
  inheritedKeys?: Readonly<Record<string, readonly string[]>>;
}

function isCatalogLeaf(value: unknown): value is CatalogLeaf {
  return typeof value === "string"
    || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

export function flattenCatalog(value: CatalogTree, prefix = ""): Map<string, CatalogLeaf | unknown> {
  const entries = new Map<string, CatalogLeaf | unknown>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isCatalogLeaf(child) || child === null || typeof child !== "object") {
      entries.set(path, child);
      continue;
    }
    for (const [childPath, leaf] of flattenCatalog(child as CatalogTree, path)) {
      entries.set(childPath, leaf);
    }
  }
  return entries;
}

function placeholders(value: CatalogLeaf): string[] {
  const messages = typeof value === "string" ? [value] : value;
  return [...new Set(messages.flatMap((message) =>
    [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
  ))].sort();
}

function compareIssues(left: TranslationCoverageIssue, right: TranslationCoverageIssue) {
  return left.locale.localeCompare(right.locale)
    || left.type.localeCompare(right.type)
    || left.key.localeCompare(right.key);
}

export function validateTranslationCoverage(
  referenceLocale: string,
  reference: CatalogTree,
  locales: Readonly<Record<string, CatalogTree>>,
  options: TranslationCoverageOptions = {}
): TranslationCoverageIssue[] {
  const referenceEntries = flattenCatalog(reference);
  const referenceKeys = new Set(referenceEntries.keys());
  const issues: TranslationCoverageIssue[] = [];

  for (const dynamicKey of options.dynamicKeys ?? []) {
    if (!referenceKeys.has(dynamicKey)) {
      issues.push({ locale: referenceLocale, key: dynamicKey, type: "invalid-dynamic" });
    }
  }

  for (const [locale, localeCatalog] of Object.entries(locales)) {
    const localeEntries = flattenCatalog(localeCatalog);
    const exemptions = new Set(options.exemptions?.[locale] ?? []);

    for (const exemption of exemptions) {
      if (!referenceKeys.has(exemption)) {
        issues.push({ locale, key: exemption, type: "invalid-exemption" });
      } else if (localeEntries.has(exemption)) {
        issues.push({ locale, key: exemption, type: "unnecessary-exemption" });
      }
    }

    for (const key of referenceKeys) {
      const referenceValue = referenceEntries.get(key);
      const localeValue = localeEntries.get(key);
      if (localeValue === undefined) {
        if (!exemptions.has(key)) issues.push({ locale, key, type: "missing" });
        continue;
      }
      if (!isCatalogLeaf(localeValue)) {
        issues.push({ locale, key, type: "invalid" });
        continue;
      }
      if (!isCatalogLeaf(referenceValue)) continue;
      if (Array.isArray(referenceValue) !== Array.isArray(localeValue)) {
        issues.push({ locale, key, type: "invalid", detail: "value shape differs" });
        continue;
      }
      if (Array.isArray(referenceValue) && Array.isArray(localeValue)
        && referenceValue.length !== localeValue.length) {
        issues.push({ locale, key, type: "invalid", detail: "list length differs" });
      }
      const expectedPlaceholders = placeholders(referenceValue);
      const actualPlaceholders = placeholders(localeValue);
      if (expectedPlaceholders.join("\0") !== actualPlaceholders.join("\0")) {
        issues.push({
          locale,
          key,
          type: "placeholder",
          detail: `expected {${expectedPlaceholders.join("}, {")}}, received {${actualPlaceholders.join("}, {")}}`
        });
      }
    }

    for (const key of localeEntries.keys()) {
      if (!referenceKeys.has(key)) issues.push({ locale, key, type: "unknown" });
    }

    for (const key of options.inheritedKeys?.[locale] ?? []) {
      issues.push({ locale, key, type: "inherited" });
    }
  }

  return issues.sort(compareIssues);
}

export function formatTranslationCoverageIssues(issues: readonly TranslationCoverageIssue[]): string {
  return issues
    .map((issue) => `${issue.locale} ${issue.type}: ${issue.key}${issue.detail ? ` (${issue.detail})` : ""}`)
    .join("\n");
}

export function findLocaleSpreadAssignments(source: string, localeVariable: string): string[] {
  const sourceFile = ts.createSourceFile(
    "locale.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const spreads: string[] = [];

  function collectSpreads(node: ts.Node) {
    if (ts.isSpreadAssignment(node)) spreads.push(node.expression.getText(sourceFile));
    ts.forEachChild(node, collectSpreads);
  }

  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)
        && declaration.name.text === localeVariable
        && declaration.initializer) {
        collectSpreads(declaration.initializer);
      }
    }
  });

  return spreads.sort();
}

export function findUnregisteredDynamicCatalogCalls(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const findings: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === "copy" || node.expression.text === "copyList")) {
      const key = node.arguments[2];
      const registered = key && (
        ts.isStringLiteral(key)
        || (ts.isCallExpression(key)
          && ts.isIdentifier(key.expression)
          && key.expression.text === "catalogKey")
      );
      if (key && !registered) {
        const position = sourceFile.getLineAndCharacterOfPosition(key.getStart(sourceFile));
        findings.push(`${position.line + 1}:${position.character + 1} ${key.getText(sourceFile)}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}
