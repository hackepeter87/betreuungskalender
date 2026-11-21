export const RELEASE_ARCHIVE_INPUTS: readonly string[];

export function collectReleaseArchiveEntries(cwd: string): string[];

export function validateReleaseArchiveEntries(
  entries: string[],
  expectedEntries: string[],
  releaseTag: string
): {
  missing: string[];
  unexpected: string[];
  duplicates: string[];
  releaseNotesPath: string;
  releaseNotesPresent: boolean;
};

export function createReleaseArchive(options: {
  cwd: string;
  output: string;
  releaseTag: string;
}): Promise<void>;
