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

Latest V7 ratchet measurement after the sixth coverage, workflow, and reliability hardening wave:

| Metric     | Current |
| ---------- | ------: |
| Statements |  81.70% |
| Branches   |  75.55% |
| Functions  |  79.83% |
| Lines      |  84.55% |

The current global CI gate intentionally ratchets just below that measured floor:

| Metric     | Gate |
| ---------- | ---: |
| Statements |  81% |
| Branches   |  75% |
| Functions  |  79% |
| Lines      |  84% |

Additional scoped ratchets protect the owned surfaces that already clear higher local bars:

| Surface                                                   | Statements | Branches | Functions | Lines |
| --------------------------------------------------------- | ---------: | -------: | --------: | ----: |
| `src/lib/admin.remote.ts`                                 |        91% |      76% |       97% |   91% |
| `src/lib/server/auth/**`                                  |        91% |      87% |       96% |   91% |
| `src/lib/server/crypto/**`                                |        86% |      84% |       95% |   91% |
| `src/lib/server/import/**`                                |        80% |      73% |       90% |   82% |
| `src/lib/server/protocols/**`                             |        89% |      84% |       90% |   92% |
| `src/lib/server/rdp/**`                                   |        92% |      80% |       90% |   93% |
| `src/lib/server/ws/**`                                    |        79% |      77% |       68% |   82% |
| `src/routes/api/**`                                       |        95% |      81% |       92% |   98% |
| `src/lib/termix/**`                                       |        86% |      76% |       96% |   89% |
| `src/lib/server/ssh-live/**`                              |        65% |      63% |       61% |   68% |
| `src/lib/server/services/**`                              |        73% |      69% |       71% |   77% |
| `src/lib/server/services/bulk-job-runner.ts`              |        82% |      71% |       88% |   88% |
| `src/lib/components/termix/session/file-manager-state.ts` |        87% |      72% |      100% |   91% |

Coverage includes TermixKit-owned JavaScript and TypeScript under these measured
surfaces: `src/hooks.server.ts`, `src/lib/**/*.{js,ts}`, API route handlers, and
the Microsoft OAuth route helper. It intentionally excludes declaration files,
test files, test-only folders, fixtures, mocks, generated output, shadcn-svelte
UI primitives, static assets, migration snapshots, Svelte route markup, and
`.svelte.ts` UI wrappers. Remote functions remain in scope because they are
server-owned command/query boundaries, and the current ratchet now protects the
admin remote boundary while the fleet, workspace, auth, and Termix remote
boundaries have direct branch tests that raised the global measured floor.

V7 is not complete at this baseline. The current audit treats coverage ratchets
and full local browser/protocol workflow coverage as repo-owned local evidence,
not final V7 completion. `audit:acceptance` keeps separate pending rows for
final coverage target achievement and final reliability/performance budgets
until the measured coverage and performance proof reach the `spec.md` target
surfaces.

These are the remaining final target gaps before V7 can be called complete:

- The measured global line floor is still just below the final 85% target, and
  `src/lib/server/**` still has low or uneven coverage in database schema
  helpers, repository mapping, websocket routing, and some service resources.
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
  shells for SSH/SFTP/RDP/VNC/Telnet/FTP/FTPS, browser-level SFTP/FTP/FTPS UI
  actions against mocked protocol API fixtures, fleet no-target and
  approval-required states, admin views, non-admin admin denial, server-enforced
  protocol API denial, policy-visible disabled states, and local RDP/VNC/Telnet
  reconnect/close states. Smoke coverage now also exercises browser-level
  SFTP/FTP/FTPS list/search/navigation, mkdir, upload, text read/write,
  rename, download, and delete against disposable real local protocol
  endpoints without route interception. The production smoke adds deeper local
  protocol browser proof for Telnet xterm input and NAWS resize negotiation
  plus close/reconnect, VNC noVNC launch to a disposable RFB fixture plus forced
  disconnect/reconnect, and mocked RDP Gateway launch, clipboard-policy display,
  reconnect controls, and the server-side JET proxy route. The RDP local proof
  does not assert browser-driven JET traffic or real target pixels; real RDP
  remains external proof.
- Reliability/performance budgets now have deterministic boundedness coverage for
  protocol-adapter failure boundaries, adapter upload-size limits, transfer
  completion/cancellation/progress helpers, importer parsing, workspace layout
  normalization, bulk-job fan-out, retry, timeout, and cancellation behavior.
  Route-level multipart uploads now preflight `Content-Length` and bound
  missing/dishonest-length streams before `formData()` parsing. Browser tests
  now cover cancelling in-flight SFTP/FTP/FTPS file-manager transfers, request
  abort observation, and partial-progress state without false completion.
  Remaining reliability gaps are measurable final
  workspace/importer performance budgets.

Real Microsoft, RDP, VNC, SSH, FTP, and FTPS acceptance remains external proof
only. Local coverage gates must not require those live tenants or targets.
