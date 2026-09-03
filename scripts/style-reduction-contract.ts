import type { inventoryStyles } from "./style-inventory";

type Metrics = ReturnType<typeof inventoryStyles>["metrics"];
type BuildSize = { bytes: number; gzipBytes: number };

// Accepted package 3, f58a71e. The final package must improve source complexity
// and must not grow either the application asset or total delivered styles.
export const styleReductionCeilings = {
  bytes: 155920,
  declarations: 4092,
  rules: 1297,
  buildBytes: 126657,
  gzipBytes: 23219,
  totalBytes: 156976,
  totalDeclarations: 4132,
  totalRules: 1307,
  totalBuildBytes: 127713,
  totalGzipBytes: 23779
} as const;

export function validateStyleReduction(
  metrics: Metrics,
  build: BuildSize,
  legal: { metrics: Metrics; gzipBytes: number }
): string[] {
  const values: Record<keyof typeof styleReductionCeilings, number> = {
    bytes: metrics.bytes,
    declarations: metrics.declarations,
    rules: metrics.rules,
    buildBytes: build.bytes,
    gzipBytes: build.gzipBytes,
    totalBytes: metrics.bytes + legal.metrics.bytes,
    totalDeclarations: metrics.declarations + legal.metrics.declarations,
    totalRules: metrics.rules + legal.metrics.rules,
    totalBuildBytes: build.bytes + legal.metrics.bytes,
    totalGzipBytes: build.gzipBytes + legal.gzipBytes
  };
  return (Object.keys(values) as Array<keyof typeof values>).flatMap((key) => {
    const value = values[key];
    const ceiling = styleReductionCeilings[key];
    return !Number.isFinite(value) || value <= 0 || value > ceiling
      ? [`${key}: ${value} exceeds or does not satisfy the reviewed ceiling ${ceiling}`]
      : [];
  });
}

export function extractLegalStyles(source: string): string {
  const blocks = [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  if (blocks.length !== 1 || blocks[0][1].includes("${")) {
    throw new Error("Expected one static, reviewable legal-page stylesheet");
  }
  return blocks[0][1];
}
