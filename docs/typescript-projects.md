# TypeScript project coverage

Every maintained TypeScript source is checked by a named compiler project:

| Project | Ownership |
| --- | --- |
| `tsconfig.app.json` | Browser application under `src/` |
| `tsconfig.server.json` | Server and shared runtime contracts under `server/` and `shared/` |
| `tsconfig.node.json` | Vite configuration |
| `tsconfig.tools.json` | Playwright tests, E2E tests, and maintained TypeScript scripts |

All four projects use TypeScript strict mode. `npm run lint` runs the server
project and the referenced browser, Vite, and tools projects, then ESLint with
type information. Generated output, dependencies, tests, and release artifacts
are excluded from the ESLint production-source pass.

Type-aware unsafe-flow rules cover browser API and legacy-storage, Fastify
route, configuration, database, transfer, calendar-import, validation, and
maintained operational-script boundaries. The stricter narrowing-assertion gate
applies to the untrusted parser modules for configuration, native OIDC,
transfer, legacy storage, and schema validation. Values handled there from
JSON, request bodies, third-party parsers, or persistence adapters must remain
`unknown` until a schema or type guard validates the required shape. A type
assertion must not be used as validation.

The generic browser transport remains bound to endpoint-specific shared
response types. New or changed response shapes belong in the shared contract;
runtime validation is still required before untrusted values are used outside
that transport boundary.

An unavoidable assertion caused by an inaccurate third-party declaration may
be suppressed only on the affected line. The adjacent comment must state the
runtime invariant that makes the operation safe. File-wide and configuration-
wide suppressions are not accepted. Reviewers should reject changes that move
runtime validation behind an assertion or weaken a boundary merely to satisfy
lint.

Checked indexed access and exact optional-property semantics are separate
hardening steps. They are enabled only in the projects that already adopted
them and are not weakened by this project layout.
