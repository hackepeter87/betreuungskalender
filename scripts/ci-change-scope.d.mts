export type ChangeScope = {
  application: boolean;
  automation: boolean;
  browser: boolean;
  container: boolean;
  database: boolean;
  dependencies: boolean;
  docs: boolean;
  helm: boolean;
  image: boolean;
  postgres_container: boolean;
  security: boolean;
  update: boolean;
  any: boolean;
  files: string[];
};

export function classifyChangedFiles(files: string[]): ChangeScope;
