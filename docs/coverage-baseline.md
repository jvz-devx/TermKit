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

Latest V7 ratchet measurement after the second coverage and workflow hardening wave:

| Metric     | Current |
| ---------- | ------: |
| Statements |  71.04% |
| Branches   |  65.60% |
| Functions  |  70.40% |
| Lines      |  73.86% |

The current global CI gate intentionally ratchets just below that measured floor:

| Metric     | Gate |
| ---------- | ---: |
| Statements |  70% |
| Branches   |  65% |
| Functions  |  70% |
| Lines      |  73% |

Additional scoped ratchets protect the owned surfaces that already clear higher local bars:

| Surface                                                   | Statements | Branches | Functions | Lines |
| --------------------------------------------------------- | ---------: | -------: | --------: | ----: |
| `src/lib/server/auth/**`                                  |        85% |      85% |       85% |   85% |
| `src/lib/server/crypto/**`                                |        86% |      84% |       95% |   91% |
| `src/lib/server/import/**`                                |        80% |      73% |       90% |   82% |
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
workflow coverage, and final reliability/performance budgets. The remaining
final target gaps from `spec.md` are:

These are the remaining final target gaps before V7 can be called complete:

- `src/lib/server/**` is still below the final 85% line and 75% branch target,
  with low or uneven coverage in database schema helpers, repository mapping,
  protocol adapters, websocket routing, and some service resources.
- Security-critical pure logic is not uniformly at 90% line coverage; auth,
  crypto, host-key trust, ticketing, route auth helpers, policy checks, and
  secret redaction need separate final-target review.
- Protocol-owned aggregate coverage now clears the 80% line target, but final
  V7 still needs per-boundary review for SSH connect, SSH tunnel, raw SSH
  adapter, TCP framing, websocket routing, and the external protocol fixture
  boundaries rather than relying on aggregate coverage alone.
- Repository, migration, settings, workspace policy, job orchestration, and
  acceptance-audit coverage are not uniformly at 75% line coverage. The
  executable audit-script tests exercise the scripts through child processes,
  but the scripts themselves are not yet first-class coverage include targets.
- Deterministic browser coverage now covers protected-route auth, credential and
  host CRUD, importer validation/import, session filtering, workspace launch
  shells for SSH/SFTP/RDP/VNC/Telnet/FTP/FTPS, FTP/FTPS file-manager shell
  states, fleet no-target and approval-required states, admin views, non-admin
  admin denial, and policy-visible disabled states. The remaining browser gap is
  successful fixture-backed protocol interaction for SSH live tabs, SFTP,
  FTP/FTPS, RDP, VNC, and Telnet plus deeper server-enforced policy-blocked
  execution paths.
- Remaining reliability/performance gaps include tunnel-limit concurrency,
  transfer cancellation beyond current helper coverage, protocol-adapter
  timeout/failure injection, background-job retry budgets, importer parsing
  budgets, and workspace rendering budgets.

Real Microsoft, RDP, VNC, SSH, FTP, and FTPS acceptance remains external proof
only. Local coverage gates must not require those live tenants or targets.
