# TypeScript project coverage

Every maintained TypeScript source is checked by a named compiler project:

| Project | Ownership |
| --- | --- |
| `tsconfig.app.json` | Browser application under `src/` |
| `tsconfig.server.json` | Server and shared runtime contracts under `server/` and `shared/` |
| `tsconfig.node.json` | Vite configuration |
| `tsconfig.tools.json` | Playwright tests, E2E tests, and maintained TypeScript scripts |

All four projects use TypeScript strict mode. `npm run lint` runs the server
project and the referenced browser, Vite, and tools projects deterministically.
Generated output, dependencies, JavaScript compatibility scripts, and release
artifacts are not TypeScript compiler inputs.

Checked indexed access and exact optional-property semantics are separate
hardening steps. They are enabled only in the projects that already adopted
them and are not weakened by this project layout.
