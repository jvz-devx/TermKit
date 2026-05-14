# Coverage Baseline

Initial V7 coverage baseline captured with:

```sh
nix develop -c npm run test:coverage
```

Baseline from the integrated V7 foundation wave:

| Metric     | Current |
| ---------- | ------: |
| Statements |  60.44% |
| Branches   |  57.25% |
| Functions  |  58.77% |
| Lines      |  63.05% |

Latest V7 ratchet measurement after the focused helper and protocol hardening wave:

| Metric     | Current |
| ---------- | ------: |
| Statements |  63.11% |
| Branches   |  60.74% |
| Functions  |  62.52% |
| Lines      |  65.46% |

The current global CI gate intentionally ratchets just below that measured floor:

| Metric     | Gate |
| ---------- | ---: |
| Statements |  63% |
| Branches   |  60% |
| Functions  |  62% |
| Lines      |  65% |

Additional scoped ratchets protect the owned surfaces that already clear higher local bars:

| Surface                    | Statements | Branches | Functions | Lines |
| -------------------------- | ---------: | -------: | --------: | ----: |
| `src/lib/server/auth/**`   |        85% |      85% |       85% |   85% |
| `src/lib/server/crypto/**` |        86% |      84% |       95% |   91% |
| `src/lib/server/import/**` |        80% |      73% |       90% |   82% |
| `src/lib/termix/**`        |        86% |      76% |       96% |   89% |

Coverage includes TermixKit-owned JavaScript and TypeScript under these measured
surfaces: `src/hooks.server.ts`, `src/lib/**/*.{js,ts}`, API route handlers, and
the Microsoft OAuth route helper. It intentionally excludes declaration files,
test files, test-only folders, fixtures, mocks, generated output, shadcn-svelte
UI primitives, static assets, migration snapshots, Svelte route markup, and
`.svelte.ts` UI wrappers. Remote functions remain in scope because they are
server-owned command/query boundaries, even though several are still at 0% and
need follow-up tests.

V7 is not complete at this baseline. The remaining milestone target is to raise meaningful owned surfaces toward the thresholds in `spec.md`: server code first, then protocol and websocket-owned logic, then broader route and workflow coverage where tests catch real regressions.
