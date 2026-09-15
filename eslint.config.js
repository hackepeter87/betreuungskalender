import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const maintainedTypeScript = [
  "src/**/*.{ts,tsx}",
  "server/**/*.ts",
  "shared/**/*.ts",
  "scripts/**/*.ts",
  "e2e/**/*.ts",
  "playwright.config.ts",
  "vite.config.ts"
];

const externalBoundaryTypeScript = [
  "src/lib/api.ts",
  "src/lib/storage.ts",
  "src/migration/**/*.ts",
  "server/config.ts",
  "server/nativeOidc.ts",
  "server/db/**/*.ts",
  "server/routes/**/*.ts",
  "server/services/dataTransfer.ts",
  "server/services/externalCalendars.ts",
  "server/validation/**/*.ts",
  "scripts/**/*.ts"
];

const untrustedDataParsers = [
  "src/lib/storage.ts",
  "src/migration/**/*.ts",
  "server/config.ts",
  "server/nativeOidc.ts",
  "server/routes/dataTransfer.ts",
  "server/services/dataTransfer.ts",
  "server/validation/**/*.ts",
  "scripts/fixtures/eslint/**/*.ts"
];

const unsafeBoundaryRules = {
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error"
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-server/**",
      "node_modules/**",
      ".worktrees/**",
      "playwright-report/**",
      "test-results/**",
      "**/*.test.{js,ts}",
      "e2e/**/*.spec.ts",
      "scripts/fixtures/eslint/**"
    ]
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "vite.config.js"],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node
    },
    rules: {
      "no-regex-spaces": "off"
    }
  },
  {
    files: ["public/**/*.js"],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.serviceworker
      }
    }
  },
  {
    files: maintainedTypeScript,
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          "./tsconfig.app.json",
          "./tsconfig.server.json",
          "./tsconfig.tools.json",
          "./tsconfig.node.json"
        ],
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: externalBoundaryTypeScript,
    rules: unsafeBoundaryRules
  },
  {
    files: untrustedDataParsers,
    rules: {
      "@typescript-eslint/no-unsafe-type-assertion": "error"
    }
  }
);
