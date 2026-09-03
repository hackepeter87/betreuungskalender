import postcss from "postcss";
import type { StyleSource } from "./style-guardrails";

export interface StyleRuleRecord {
  file: string;
  line: number;
  layer: string;
  conditions: string[];
  selectors: string[];
  declarations: Array<{ property: string; value: string; important: boolean }>;
}

// Structural evidence only: specificity, shorthands and overlapping conditions
// still require computed-style checks in a browser before removing a rule.
export function inventoryStyles(sources: readonly StyleSource[]) {
  const rules: StyleRuleRecord[] = [];
  let declarations = 0;
  for (const source of sources) {
    const root = postcss.parse(source.source, { from: source.path });
    root.walkDecls(() => { declarations += 1; });
    root.walkRules((rule) => {
      const conditions: string[] = [];
      for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
        if (parent.type === "atrule") conditions.unshift(`@${parent.name} ${parent.params}`);
        if (parent.type === "rule") conditions.unshift(parent.selector);
      }
      rules.push({
        file: source.path,
        line: rule.source?.start?.line ?? 1,
        layer: source.layer,
        conditions,
        selectors: rule.selectors,
        declarations: rule.nodes.filter((node) => node.type === "decl").map((node) => ({
          property: node.prop,
          value: node.value,
          important: Boolean(node.important)
        }))
      });
    });
  }
  return {
    metrics: {
      files: sources.length,
      lines: sources.reduce((sum, { source }) => sum + (source.match(/\n/g)?.length ?? 0) +
        (source.length > 0 && !source.endsWith("\n") ? 1 : 0), 0),
      bytes: sources.reduce((sum, { source }) => sum + Buffer.byteLength(source), 0),
      declarations,
      rules: rules.length
    },
    rules
  };
}

export function repeatedStyleProperties(rules: readonly StyleRuleRecord[]) {
  const properties = new Map<string, { selector: string; property: string; occurrences: StyleRuleRecord[] }>();
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      for (const { property } of rule.declarations) {
        const key = JSON.stringify([rule.layer, rule.conditions, selector, property]);
        const group = properties.get(key) ?? { selector, property, occurrences: [] };
        group.occurrences.push(rule);
        properties.set(key, group);
      }
    }
  }
  return [...properties.values()].filter(({ occurrences }) => occurrences.length > 1);
}
