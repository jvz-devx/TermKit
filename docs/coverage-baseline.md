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

Latest V7 ratchet measurement after the third coverage, workflow, and reliability hardening wave:

| Metric     | Current |
| ---------- | ------: |
| Statements |  73.46% |
| Branches   |  66.87% |
| Functions  |  72.26% |
| Lines      |  76.41% |

The current global CI gate intentionally ratchets just below that measured floor:

| Metric     | Gate |
| ---------- | ---: |
| Statements |  73% |
| Branches   |  66% |
| Functions  |  72% |
| Lines      |  76% |

Additional scoped ratchets protect the owned surfaces that already clear higher local bars:

| Surface                                                   | Statements | Branches | Functions | Lines |
| --------------------------------------------------------- | ---------: | -------: | --------: | ----: |
| `src/lib/server/auth/**`                                  |        91% |      87% |       96% |   91% |
| `src/lib/server/crypto/**`                                |        86% |      84% |       95% |   91% |
| `src/lib/server/import/**`                                |        80% |      73% |       90% |   82% |
| `src/lib/server/protocols/**`                             |        89% |      83% |       89% |   91% |
| `src/routes/api/**`                                       |        90% |      72% |       86% |   94% |
| `src/lib/termix/**`                                       |        86% |      76% |       96% |   89% |
| `src/lib/server/ssh-live/**`                              |        65% |      63% |       61% |   68% |
| `src/lib/server/services/bulk-job-runner.ts`              |        82% |      71% |       88% |   88% |
| `src/lib/components/termix/session/file-manager-state.ts` |        87% |      72% |      100% |   91% |

Coverage includes TermixKit-owned JavaScript and TypeScript under these measured
surfaces: `src/hooks.server.ts`, `src/lib/**/*.{js,ts}`, API route handlers, and
the Microsoft OAuth route helper. It intentionally excludes declaration files,
test files, test-only folders, fixtures, mocks, generated output, shadcn-svelte
UI primitives, static assets, migration snapshots, Svelte route markup, and
`.svelte.ts` UI wrappers. Remote functions remain in scope because they are
server-owned command/query boundaries, even though several are still at 0% and
need follow-up tests.

V7 is not complete at this baseline. The current audit treats coverage ratchets
as repo-owned local evidence, not final V7 completion. `audit:acceptance` keeps
separate pending rows for final coverage target achievement, full browser/protocol
workflow coverage, and final reliability/performance budgets. Browser/protocol
workflow coverage has stronger local evidence through deterministic Playwright
plus smoke workflows, but it is not complete browser-level proof for all file and
remote-desktop workflows. The remaining final target gaps from `spec.md` are:

These are the remaining final target gaps before V7 can be called complete:

- `src/lib/server/**` is still below the final 85% line and 75% branch target,
  with low or uneven coverage in database schema helpers, repository mapping,
  protocol adapters, websocket routing, and some service resources.
- Security-critical pure logic is not uniformly at 90% line coverage; auth,
  crypto, host-key trust, ticketing, route auth helpers, policy checks, and
  secret redaction need separate final-target review.
- Protocol-owned aggregate coverage now clears the 80% line target, and scoped
  protocol gates protect the current floor. Remaining protocol work is mainly
  deeper per-boundary review for host-trust internals, VNC function coverage,
  RDP helper failures, and external-target proof boundaries.
- Repository, migration, settings, workspace policy, job orchestration, and
  acceptance-audit coverage are not uniformly at 75% line coverage. The
  executable audit-script tests exercise the scripts through child processes,
  but the scripts themselves are not yet first-class coverage include targets.
- Deterministic browser coverage now covers protected-route auth, credential and
  host CRUD, importer validation/import, session filtering, workspace launch
  shells for SSH/SFTP/RDP/VNC/Telnet/FTP/FTPS, FTP/FTPS file-manager shell
  states, fleet no-target and approval-required states, admin views, non-admin
  admin denial, server-enforced protocol API denial, and policy-visible disabled
  states. Smoke coverage now exercises successful fixture-backed SSH, SFTP,
  FTP/FTPS API workflows, FTP/FTPS workspace listing, Telnet, VNC banner/auth
  staging, and mock RDP gateway boundary workflows without real external targets.
  Remaining browser workflow gaps are browser-level SFTP/FTP/FTPS file actions
  and deeper RDP/VNC/Telnet interaction coverage.
- Remaining reliability/performance gaps include broader protocol-adapter
  timeout/failure injection, browser-level transfer abort behavior, importer
  parsing budgets, and workspace rendering budgets. Current local tests cover
  bulk-job timeout/retry/cancellation/concurrency behavior, large fan-out
  planning, file-manager transfer completion/cancellation progress, and large
  file-list transforms.

Real Microsoft, RDP, VNC, SSH, FTP, and FTPS acceptance remains external proof
only. Local coverage gates must not require those live tenants or targets.
