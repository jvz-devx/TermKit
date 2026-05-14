# TermixKit

TermixKit is a SvelteKit rewrite of the connection-focused parts of Termix. The current V3 app keeps the V1 Docker Compose shape: one public app port, Postgres on the Compose network or loopback for local tooling, and Devolutions Gateway reached through the app's `/gateway` proxy for browser RDP.

## Milestones

- V1 wave 1: deployment skeleton, environment contract, import mapping skeleton, verification harness.
- V1 wave 2: core schema, auth/session flow, encrypted credential persistence.
- V1 wave 3: host and credential management UI.
- V1 wave 4: SSH/SFTP, Telnet, VNC, and RDP launch flows.
- V1 hardening: import job persistence, gateway provisioning, production runbook, backup/restore checks.
- V2 milestone 1: Microsoft Entra ID login with domain-allowlisted auto-provisioning.
- V2 milestone 2: app-owned live SSH sessions with attach tickets, session limits, idle cleanup, and stale-session reconciliation.
- V2 milestone 3: persistent SSH workspace tabs for opening, renaming, reattaching, and closing live SSH sessions.
- V2 milestone 4: Microsoft auth docs, live SSH docs, browser smokes, and continued V1 regression coverage.
- V3 milestone 1: shared workspaces for hosts and credentials with simple owner/member access.
- V3 milestone 2: first-class connection history with filters for user, workspace, protocol, host, status, and date range.
- V3 milestone 3: RDP clipboard controls, file clipboard transfer states, and session workspace polish.
- V3 milestone 4: central admin panel for users, workspaces, live sessions, connection history, and settings.
- V4 milestone 1: admin visibility for active SSH tunnels, FTP/FTPS activity, and structured protocol failure reasons.
- V5 terminal and transfer polish: terminal preferences, snippets, browser-side recording controls, file-manager transfer power tools, FTPS modes, and RDP host settings.
- V6 fleet operations: automation templates, reviewed bulk operations, job history, approvals, policy checks, and host health inventory.

## Application Navigation

TermixKit uses logical workspace navigation, not a host tree in the sidebar:

- **Inventory**: host records at `/hosts`, reusable secrets at `/credentials`, and the Termix importer at `/import`.
- **Connections**: the session workspace at `/sessions` and connection history at `/history`.
- **Workspaces**: shared host and credential scopes at `/workspaces`.
- **Fleet**: automation, reviewed bulk operations, approvals, job history, and host health inventory at `/fleet`.
- **Administration**: app defaults at `/settings` and the admin overview at `/admin`.

The session workspace is the launcher for every protocol. It stores the selected host and protocol in URL query parameters, provides host search and protocol filters, and only shows protocol tabs supported by the selected host. SSH hosts expose both SSH and SFTP tabs; RDP, VNC, and Telnet hosts expose their own protocol tab.

## Workspaces And Admin

V3 adds simple workspaces without full RBAC. Hosts and credentials can stay private to the signed-in user or belong to a shared workspace. Workspace members can use shared inventory, while workspace owners can manage inventory and membership. The `/workspaces` page provides create, rename, member management, and inventory assignment controls.

Connection history is available at `/history`. It records protocol, host, user, workspace, start/end times, duration, status, and structured error reason fields, with filters for common operator questions.

Admins can use `/admin` to view users, create local accounts, promote admins, disable users, inspect workspace inventory, terminate live SSH sessions and active SSH tunnels, review FTP/FTPS activity, inspect structured failure reasons for SSH tunnel/FTP/FTPS history, and jump into app settings. Disabling a user revokes their active app sessions and blocks future password/session authentication.

## Live SSH Sessions

V2 adds app-owned live SSH sessions behind `/ws/ssh/live/:ticket`. Remote functions create short-lived attach tickets, the production server consumes them after normal app-session authentication, and an in-process live SSH manager keeps the shell alive across browser websocket disconnects. Reattaching replays bounded in-memory scrollback and takes over the single active browser attachment for that live session.

The session workspace has an SSH tab strip for opening, renaming, reattaching, and closing live SSH sessions. Metadata is stored in Postgres through `ssh_live_sessions` and `ssh_attach_tickets`, but SSH processes and terminal output are not persisted. A live SSH tab can survive browser refreshes and reconnects while the TermixKit app process stays up; it does not survive app or container restart. Startup marks old metadata as `stale`, detached sessions expire after the default two-hour idle window, attach tickets default to 60 seconds, and each user is limited to 10 live SSH sessions. Recently ended or failed live SSH rows stay visible briefly so the workspace can show terminal states before the user dismisses them. VNC and Telnet continue to use the V1 launch-ticket websocket behavior; RDP launches through the Devolutions Gateway bootstrap and `/gateway` proxy; SFTP uses authenticated file-manager API routes plus a `connection_sessions` lifecycle row for the workspace launch.

## RDP Operator Controls

The settings page controls RDP clipboard policy separately for text payloads, file payloads, client-to-remote direction, remote-to-client direction, and file size limit. It also stores the default RDP quality preset and whether sessions should request audio redirection when the deployment and IronRDP support it. The RDP session pane includes operator controls for Ctrl+Alt+Del, Windows key, reconnect, local disconnect, fullscreen, focus, resize, display scale, and quality preset changes. Presets currently tune the supported desktop-size and resize behavior; frame/update knobs are only surfaced once the IronRDP API exposes them.

When file clipboard is enabled and the RDP session is connected, users can copy a local file into the remote clipboard or save the current remote clipboard payload back to the browser clipboard. The pane shows direction, size, state, and failure feedback without inspecting or logging clipboard payload contents. Multi-monitor and audio controls degrade to explicit readiness states when the current IronRDP/Gateway integration only exposes the single-monitor, no-audio path.

## V5 Protocol Polish

V5 adds checked-in migration support, isolated service repositories, and workspace UI/runtime polish for SSH, file-manager, FTP/FTPS, and RDP workflows. The new durable tables are:

- `terminal_preferences`: per-user, per-host terminal font, theme, scrollback, title, and initial size preferences.
- `command_snippets`: per-user snippets that can optionally scope to a workspace or host.
- `terminal_recordings`: recording metadata only, with status, storage key, retention timestamp, and optional connection/live-session references. Terminal output is not stored in normal connection metadata.
- `file_bookmarks`: per-user, per-host remote directory bookmarks for SFTP, FTP, and FTPS file managers.
- `ftps_host_settings`: explicit or implicit FTPS mode plus certificate-validation metadata.
- `rdp_host_settings`: per-host display, clipboard, audio, gateway, and extension metadata for RDP operator controls.

The `src/lib/server/services/v5-resources.ts` repository is intentionally UI-neutral so route and remote-function code can share the same migration contract.

Terminal recording is disabled by default and must be started explicitly from an active terminal. Recordings are captured in the browser as asciicast `.cast` files, downloaded on stop, and tracked only as local browser metadata with retention cleanup; terminal output is not stored in normal connection metadata.

## V6 Fleet Operations

V6 adds the `/fleet` workspace for multi-host operator work. The route stays slim and loads through remote functions in `src/lib/fleet.remote.ts`; the page is split into shadcn-svelte panels for automation templates, reviewed bulk operations, host health inventory, job history/reporting, and policy approvals.

Fleet data is backed by `src/lib/server/services/v6-resources.ts` and checked-in migrations for automation templates, background jobs, job targets, job events, job reports, workspace policies, approvals, operation reasons, host facts, and host health. Automation templates support SSH commands, file-transfer actions, SSH tunnels, RDP checklists, and operator notes with typed variables, private/workspace visibility, version metadata, and secret-safe previews.

Bulk operations require an explicit visible host selection before queueing. Server-side policy checks validate workspace membership, high-risk bulk-job policy, approval requirements, and operator reasons before a job record is created. Job metadata, target output, events, reports, and template previews are sanitized so secret-looking values and full terminal output are not persisted by default.

## Microsoft Entra Login

Local username/password auth remains available. Microsoft Entra login is enabled only when `MICROSOFT_AUTH_ENABLED` is truthy and the required tenant, client, secret, allowed-domain, and admin-email settings are present. Configure the Entra app registration as a web app with the redirect URI `${ORIGIN}/auth/microsoft/callback`, or set `MICROSOFT_REDIRECT_URI` to an absolute override.

The flow uses authorization code + PKCE and defaults to `openid profile email` scopes. `MICROSOFT_SCOPES` can override the scopes but must include `openid`. Tenant IDs must be tenant-specific UUIDs or verified tenant domains; shared authorities such as `common`, `organizations`, and `consumers` are rejected in production. New Microsoft users are auto-provisioned only when their normalized email domain is in `MICROSOFT_ALLOWED_DOMAINS`. If TermixKit has no users yet, the first Microsoft sign-in must match `MICROSOFT_ADMIN_EMAILS`; after setup, domain-allowed Microsoft users can provision normal sessions, and any listed admin email is promoted to a TermixKit admin on provisioning or subsequent login.

## Production Deployment

Run V2 live SSH deployments as a single TermixKit app replica unless the reverse proxy provides sticky websocket routing to the same app process for reconnects. Live SSH shell processes, active browser attachments, and bounded terminal scrollback live in the Node process; Postgres persists live-session metadata and attach tickets only. A container or app restart marks old metadata as `stale` and drops the running SSH processes and scrollback. The default live SSH limits are 10 sessions per user, 60-second attach tickets, and a two-hour detached-session idle window.

The public reverse proxy must expose the app origin and preserve HTTP upgrade headers for websocket paths. Route `/ws/*` to the TermixKit app for live SSH and V1 websocket launch flows, and route `/gateway/jet/*` through the app's `/gateway` proxy so browser RDP traffic reaches the internal Devolutions Gateway. `GATEWAY_PUBLIC_URL` should stay on the app origin with the `/gateway` mount, not on the internal Gateway container.

When Microsoft Entra login is enabled, configure the app registration redirect URI as `${ORIGIN}/auth/microsoft/callback` unless `MICROSOFT_REDIRECT_URI` is set to an absolute deployment-specific override. `MICROSOFT_SCOPES` is optional; leave it unset for `openid profile email` unless the deployment needs extra OIDC scopes, and keep `openid` included.

## Local Development

Enter the Nix dev shell before running interactive project tooling:

```sh
nix develop
```

One-shot commands should also run through the dev shell:

```sh
nix develop -c npm install
```

Install dependencies inside an already-entered shell:

```sh
npm install
```

Copy the environment template and fill in local secrets:

```sh
cp .env.example .env
```

The template is set up for direct local Compose: `ORIGIN` and `GATEWAY_PUBLIC_URL`
use `http://localhost` values and `TERMIXKIT_INSECURE_LOCAL_HTTP=1`. Production
deployments should remove that opt-in and set browser-reachable `https://`
origins. Keep `GATEWAY_PUBLIC_URL` on the app origin, for example
`https://termix.example/gateway`; the app reverse-proxies that path to the
internal Gateway container so reverse proxies only expose the app port.

Start Postgres, Gateway, the migration job, and the production app container:

```sh
docker compose up --build
```

Compose publishes only the app on `APP_PORT` and binds Postgres to loopback for
local tooling. Devolutions Gateway is reachable only on the Compose network; the
app proxies browser RDP traffic from `/gateway/jet/...` to the internal Gateway
container.

For SvelteKit development against a local Postgres database:

```sh
docker compose up -d postgres gateway
npm run dev
```

Run Drizzle migrations or schema pushes with `DATABASE_URL` set:

```sh
npm run db:migrate
```

Generate new checked-in migrations after schema changes:

```sh
DATABASE_URL=postgres://termixkit:termixkit@localhost:5432/termixkit npm run db:generate
```

## Developer Notes

- After each implement/review loop, commit and push the integrated changes.
- For SvelteKit app logic, prefer remote functions over `+page.server.ts` where possible.
- Use standalone `+server.ts` endpoints for real HTTP/API boundaries.
- Current verification gates should run inside `nix develop`.
- The dev shell sets `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to Nix Chromium and
  applies a Docker Compose DNS override (`1.1.1.1`, `8.8.8.8`) for builds and
  services on NixOS hosts where Docker DNS is unreliable.
- Validate Compose wiring with dummy secret values before changing deployment defaults:

```sh
POSTGRES_PASSWORD=dev-password \
ORIGIN=https://termix.example \
APP_SECRET=dev-app-secret-with-at-least-32-bytes \
CREDENTIAL_MASTER_KEY=dev-credential-master-key \
GATEWAY_PUBLIC_URL=https://termix.example/gateway \
GATEWAY_PROVISIONER_KEY=dev-gateway-key \
docker compose config
```

## Required Environment

Do not commit real values for any secret.

- `DATABASE_URL`: Postgres connection string used by the app and Drizzle.
- `ORIGIN`: public app origin. Compose defaults to `https://localhost:3000` so production cookies are secure by default; set the external `https://` origin behind a TLS-terminating reverse proxy.
- `TERMIXKIT_INSECURE_LOCAL_HTTP`: set to `1` only for direct local HTTP development with an `http://localhost` or loopback `ORIGIN` or `GATEWAY_PUBLIC_URL`. Production startup rejects non-local HTTP values.
- `APP_SECRET`: high-entropy session token hashing secret. Keep it stable across container restarts or existing sessions will be invalidated.
- `BODY_SIZE_LIMIT`: global SvelteKit/Node request body cap. Compose defaults to `55M`, which leaves multipart overhead above the 50 MiB SFTP upload cap while still returning 413 before oversized declared or chunked bodies are accepted.
- `CREDENTIAL_MASTER_KEY`: high-entropy key used to derive credential encryption material.
- `MICROSOFT_AUTH_ENABLED`: set to `1` or `true` to enable Microsoft Entra login alongside local username/password login.
- `MICROSOFT_TENANT_ID`: tenant-specific Entra tenant UUID or verified tenant domain. Production validation rejects shared authorities such as `common`, `organizations`, and `consumers`.
- `MICROSOFT_CLIENT_ID`: Entra application client UUID for the TermixKit app registration.
- `MICROSOFT_CLIENT_SECRET`: Entra application client secret. Keep it out of source control and rotate it through the deployment secret store.
- `MICROSOFT_ALLOWED_DOMAINS`: comma-separated bare email domains allowed to auto-provision through Microsoft login, for example `example.com,example.org`. Wildcards are rejected.
- `MICROSOFT_ADMIN_EMAILS`: comma-separated Microsoft account email addresses that should provision as TermixKit admins.
- `MICROSOFT_REDIRECT_URI`: optional absolute redirect URI override. Defaults to `${ORIGIN}/auth/microsoft/callback`.
- `MICROSOFT_SCOPES`: optional comma- or whitespace-separated OIDC scopes. Defaults to `openid profile email` and must include `openid`.
- Microsoft app registration: configure a web redirect URI at `${ORIGIN}/auth/microsoft/callback` unless `MICROSOFT_REDIRECT_URI` is explicitly set. The auth flow uses authorization code + PKCE with `openid profile email` scopes by default.
- `TERMIXKIT_IMPORT_SOURCE_SECRET`: optional server-side fallback decrypt secret for Termix imports with encrypted source password or SSH-key fields. Prefer the per-upload `sourceSecret` field for one-off imports; use this only when the deployment needs a managed environment-provided import secret.
- `TERMIXKIT_SSH_KNOWN_HOSTS_PATH`: JSON SSH/SFTP known-host trust store. Compose mounts `app-data` at `/var/lib/termixkit` and defaults this to `/var/lib/termixkit/ssh-known-hosts.json` so TOFU pins survive container rebuilds.
- `TERMIXKIT_SSH_TRUST_ON_FIRST_USE`: set to `1` only while enrolling trusted SSH/SFTP hosts. Leave unset or `0` for strict known-host checking.
- `TERMIXKIT_SSH_ALLOW_PRODUCTION_TOFU`: production-only override for TOFU enrollment. Prefer seeding `TERMIXKIT_SSH_KNOWN_HOSTS_PATH` and disabling TOFU after enrollment.
- `GATEWAY_URL`: internal Devolutions Gateway URL, defaulting to `http://gateway:7171` in Compose. Production startup requires an absolute `http://` or `https://` URL.
- `GATEWAY_PUBLIC_URL`: browser-reachable app proxy URL used by IronRDP, defaulting to `https://localhost:3000/gateway` in Compose. Production requires `https://`, requires the exact `/gateway` app proxy mount, and rejects internal Compose names such as `https://gateway`; direct local Compose can use `http://localhost:3000/gateway` only with `TERMIXKIT_INSECURE_LOCAL_HTTP=1`.
- `GATEWAY_PROVISIONER_KEY`: deployment guard for RDP Gateway provisioning. Production startup requires this value before accepting traffic. Compose keeps Devolutions Gateway internal-only, enables its standalone webapp token endpoint, and relies on TermixKit app authentication plus the `/gateway` proxy as the public boundary.
- `TERMIXKIT_RDP_DISABLE_AUDIO`: set to `1` or `true` to force browser RDP sessions to report audio redirection as deployment-disabled even if future IronRDP/Gateway releases expose audio support. `TERMIXKIT_RDP_AUDIO_REDIRECTION=0` is accepted as a legacy equivalent.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`: local Compose database settings.
- `DEVOLUTIONS_GATEWAY_TAG`: Gateway container tag. The Compose file currently pins `2026.1.1` by default.

## Termix Importer

The importer is a one-way service under `src/lib/server/import` with upload parsing, validation, import execution, and an `import_jobs` persistence interface. The current API surface is:

- `POST /api/import/validate`: accepts multipart `file` upload and persists a validation job.
- `GET /api/import/jobs`: lists persisted import jobs for the signed-in user.
- `POST /api/import/jobs`: accepts multipart `file` upload, imports mapped hosts and credentials, and persists the job result.

The import page loads the persisted job list on entry and refreshes it after both successful and failed validation/import attempts. The latest result panel shows expandable warning and failure lists so validation output is not silently truncated when a source file produces many notices.

Importer uploads are capped at 10 MiB. SFTP uploads are capped at 50 MiB, and the Compose `BODY_SIZE_LIMIT` default is 55 MiB so oversized declared or chunked multipart requests are rejected with 413 before application parsing continues.

Supported uploads are JSON arrays, JSON objects with `records`, `connections`, or `hosts` arrays, and SQLite `.sqlite`, `.sqlite3`, or `.db` files with supported Termix host tables. Supported target protocols are SSH, RDP, VNC, and Telnet; SFTP is normalized to SSH. Plaintext passwords, SSH keys, `ip` host aliases, reusable SQLite `ssh_credentials` records, host `credential_id` links, and supported Termix AES-256-GCM/HKDF encrypted password/key fields can be imported. Encrypted source fields use the per-upload `sourceSecret` multipart field first, then the optional `TERMIXKIT_IMPORT_SOURCE_SECRET` environment fallback; missing secrets, unsupported encrypted formats, and failed decrypts are recorded as warnings.

Imported protocol metadata is preserved on host records. RDP `domain` values are carried through session tickets into the Devolutions Gateway bootstrap so Windows domain imports do not get dropped between import and launch. Source owner hints such as owner/source user IDs and emails are retained as host metadata while V1 imports records into the current signed-in user. Source user account rows and incompatible password hashes are not imported into TermixKit auth; they are surfaced as warnings so the operator can recreate local users or use Microsoft Entra login.

RDP saved password credentials are resolved during the authenticated remote launch, staged only in the browser tab for the IronRDP connect call, and cleared by the RDP pane after the connect attempt is built. The Devolutions Gateway provisioning request receives only destination/session metadata and never receives the saved target password.

Current limitations are intentional and visible in validation results:

- SQLite parsing is intentionally bounded to supported Termix host and credential tables. Corrupt files, unsupported SQLite page shapes, and unsupported tables are rejected or surfaced as validation warnings instead of being guessed.
- Import jobs are persisted through the Drizzle-backed `import_jobs` repository.
- Imported hosts and credentials are persisted through the current Drizzle-backed service repository.
- Guacamole-only settings, snippets, dashboards, server statistics, Docker integration settings, SSH tunnels, RBAC, sharing, audit records, unsupported protocols, and unsupported encrypted credential formats are surfaced as warnings rather than imported as first-class records.

## Verification

Run the importer tests:

```sh
nix develop -c npm run test:unit -- --run src/lib/server/import/termix.spec.ts
```

Run the full unit suite:

```sh
nix develop -c npm test
```

Generate coverage reports:

```sh
nix develop -c npm run test:coverage
```

The coverage command prints a text summary and writes HTML, JSON, and lcov
reports under `coverage/`. Open `coverage/index.html` for local inspection, use
`coverage/coverage-final.json` for machine-readable detail, and use
`coverage/lcov.info` for CI/reporting integrations.

The initial V7 baseline and current ratchet gates are recorded in
`docs/coverage-baseline.md`. The current gates protect the first measured
baseline; they are not the final V7 targets from `spec.md`.

Coverage currently measures TermixKit-owned JavaScript and TypeScript source
under `src/`. The Vitest config intentionally excludes test files, test helper
folders, fixtures and mocks, generated SvelteKit output, shadcn-svelte UI
primitives under `src/lib/components/ui`, static assets, migration snapshots,
and route Svelte markup that should be covered by focused helper tests or
Playwright smokes instead of line coverage. New exclusions should name a
low-value/generated boundary or a better test surface; do not use exclusions to
hide reachable product logic.

Run static checks:

```sh
nix develop -c npm run check
nix develop -c npm run lint
```

Print the current acceptance evidence map and external proof blockers. This command does not run the local gates for you; run it after the listed checks, build, Playwright e2e test, and smokes. It exits with status `2` while required V1 real-target proof is blocked. Missing real Microsoft tenant/browser proof is reported as `external-blocked` instead of failing repo-owned V2 acceptance when the required tenant, app registration, and test users are not available:

```sh
nix develop -c npm run audit:acceptance
```

External acceptance is proof-file driven. `npm run audit:acceptance` ignores
environment sentinel variables and accepts only current-commit entries in
`acceptance-proof.local.json`. Use the proof recorders below instead of
hand-waving real-target or manual evidence.

Create a local proof file when real targets are available:

```sh
nix develop -c npm run acceptance:proof-template -- acceptance-proof.local.json
```

Fill each passed proof with the current commit SHA, timestamp, exact command, required redacted environment variable names, and pass output or notes. `acceptance-proof.local.json` is ignored by git, and `npm run audit:acceptance` only accepts it when the file commit matches the current `HEAD`.

For each external proof record, keep the commit SHA, timestamp, exact command, redacted environment variable names, and pass output. For browser-only Microsoft proof, keep screenshots or operator notes showing the allowed user, blocked-domain user, and admin-email result without recording secrets or tokens.

Build the SvelteKit app and custom production server:

```sh
nix develop -c npm run build
```

Smoke-test the production WebSocket upgrade entrypoint:

```sh
nix develop -c npm run smoke:ws
```

Smoke-test Microsoft Entra configuration. Without real Microsoft env vars this validates the parser fixture and skips live Entra calls; with `MICROSOFT_AUTH_ENABLED=1` plus the normal Microsoft env vars it fetches the tenant discovery document and JWKS. Set `TERMIXKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1` for the real acceptance run so missing Microsoft env fails instead of being reported as a skip. Set `TERMIXKIT_SMOKE_MICROSOFT_CLIENT_CREDENTIALS_SCOPE` to also verify a client-credentials token exchange when the app registration supports that flow. Microsoft client-credentials scopes must use the resource `.default` form, for example `https://graph.microsoft.com/.default`.

```sh
nix develop -c npm run smoke:microsoft
```

For the V2 Microsoft acceptance proof, run the smoke from an environment that already exports the real Microsoft settings. Do not store tenant secrets, authorization codes, access tokens, refresh tokens, ID tokens, or cookies in the proof file.

```sh
TERMIXKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1 npm run smoke:microsoft
```

To run that smoke and record the proof entry in `acceptance-proof.local.json` in one step, use:

```sh
npm run acceptance:record-microsoft-smoke
```

When the app registration also supports client credentials, run the stricter token-exchange variant and record that command/output instead:

```sh
TERMIXKIT_SMOKE_MICROSOFT_REQUIRE_REAL=1 \
	TERMIXKIT_SMOKE_MICROSOFT_CLIENT_CREDENTIALS_SCOPE=https://graph.microsoft.com/.default \
	npm run smoke:microsoft
```

The proof recorder also supports the client-credentials variant:

```sh
TERMIXKIT_SMOKE_MICROSOFT_CLIENT_CREDENTIALS_SCOPE=https://graph.microsoft.com/.default \
	npm run acceptance:record-microsoft-smoke
```

The same real discovery/JWKS smoke can be run from GitHub Actions with the manual
`Microsoft Acceptance Smoke` workflow. Configure these repository secrets first:
`MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
`MICROSOFT_ALLOWED_DOMAINS`, and `MICROSOFT_ADMIN_EMAILS`. Optionally set the
repository variable `MICROSOFT_ACCEPTANCE_ORIGIN` if the redirect origin should
not use the workflow default placeholder. The workflow never writes proof files
to the repository or prints secret values. When it passes, download the
`microsoft-smoke-proof` artifact and use its `microsoftSmoke` proof entry for the
current commit.

Check the repository-side setup before dispatching the workflow:

```sh
npm run acceptance:github-microsoft
```

If the Microsoft values are already exported in the current shell, sync the
required GitHub Actions secrets without printing their values:

```sh
npm run acceptance:github-microsoft -- --sync-secrets
```

Optionally sync the workflow origin variable from `MICROSOFT_ACCEPTANCE_ORIGIN`
or `ORIGIN`:

```sh
npm run acceptance:github-microsoft -- --sync-origin
```

After all required secrets are configured, dispatch it from the same preflight
script:

```sh
npm run acceptance:github-microsoft -- --dispatch
```

After the workflow passes, download and merge the proof artifact without
hand-editing the local proof JSON. The local proof file must already target the
current commit; the importer refuses to re-stamp older proof records.

```sh
npm run acceptance:github-microsoft -- --import-latest-proof
```

You can also download a specific run manually:

```sh
gh run download <run-id> --repo jvz-devx/TermixKit -n microsoft-smoke-proof -D microsoft-smoke-proof
npm run acceptance:import-microsoft-smoke
```

The browser-only V2 Microsoft proof is manual because it must use real tenant users. Start TermixKit with Microsoft auth enabled, then record operator notes or redacted screenshots proving that an allowed-domain user can sign in and receives a TermixKit session, a blocked-domain user is denied, a configured `MICROSOFT_ADMIN_EMAILS` account covers the admin-email provisioning or promotion case, and local login through username/password remains available. The proof narrative must include the exact fragments `allowed-domain`, `blocked-domain`, `admin-email`, and `local login` so `npm run audit:acceptance` can validate the local proof file.

Before starting the browser proof, check that the environment is ready and write
a local notes template:

```sh
npm run acceptance:microsoft-interactive-preflight -- --notes-template microsoft-interactive-notes.local.txt
```

After collecting that browser evidence, replace every template placeholder and
record the interactive proof with redacted notes:

```sh
TERMIXKIT_MICROSOFT_INTERACTIVE_NOTES='allowed-domain: redacted approved user received a TermixKit session; blocked-domain: redacted outside user was denied; admin-email: redacted configured admin became admin; local login: redacted local credential sign-in still works' \
	nix develop -c npm run acceptance:record-microsoft-interactive
```

For longer notes, put the redacted text in a local file and point the recorder at it:

```sh
TERMIXKIT_MICROSOFT_INTERACTIVE_NOTES_FILE=/path/to/redacted-microsoft-proof-notes.txt \
	npm run acceptance:record-microsoft-interactive
```

Smoke-test Postgres migrations in a disposable container:

```sh
nix develop -c npm run smoke:postgres
```

Smoke-test Docker Compose deployment with generated local secrets. This builds the Compose app image, starts `app`, `migrate`, `postgres`, and `gateway` under a unique project name, waits for the app through its public HTTP port, verifies that Postgres is loopback-only and Gateway has no published port, and tears the stack down with volumes removed:

```sh
nix develop -c npm run smoke:compose
```

Smoke-test local protocol loopbacks for Telnet, VNC banner negotiation, SSH, and SFTP:

```sh
nix develop -c npm run smoke:protocols
```

When real test targets are available, the same command can also verify an external SSH host and a real VNC framebuffer handshake. Configure SSH with `TERMIXKIT_SMOKE_SSH_HOST`, `TERMIXKIT_SMOKE_SSH_USERNAME`, `TERMIXKIT_SMOKE_SSH_HOST_FINGERPRINT_SHA256`, and either `TERMIXKIT_SMOKE_SSH_PASSWORD` or `TERMIXKIT_SMOKE_SSH_PRIVATE_KEY_PATH`; optional values are `TERMIXKIT_SMOKE_SSH_PORT`, `TERMIXKIT_SMOKE_SSH_PRIVATE_KEY_PASSPHRASE`, `TERMIXKIT_SMOKE_SSH_COMMAND`, `TERMIXKIT_SMOKE_SSH_SFTP_PATH`, `TERMIXKIT_SMOKE_SSH_SKIP_SFTP=1`, and `TERMIXKIT_SMOKE_PROTOCOL_TIMEOUT_MS`. The SSH fingerprint accepts OpenSSH `SHA256:<base64>` or a 64-character hex SHA256 digest and is required before credentials are sent. Configure VNC with `TERMIXKIT_SMOKE_VNC_HOST` and optional `TERMIXKIT_SMOKE_VNC_PORT`; the automated VNC target must allow no-auth RFB security so the smoke can reach `ServerInit` without storing a desktop password in the environment.

Record current-commit external SSH or VNC proof entries after those real-target
smokes pass:

```sh
npm run acceptance:record-real-ssh
npm run acceptance:record-real-vnc
```

On a local Nix dev shell with SSH on localhost, TigerVNC, Docker, the pinned
Gateway image, and a loopback RDP target, refresh all V1 external proof entries
sequentially with:

```sh
nix develop -c npm run acceptance:refresh-local-v1-proofs
```

Override the defaults with `TERMIXKIT_LOCAL_PROOF_SSH_HOST`,
`TERMIXKIT_LOCAL_PROOF_SSH_USERNAME`, `TERMIXKIT_LOCAL_PROOF_SSH_PRIVATE_KEY_PATH`,
`TERMIXKIT_LOCAL_PROOF_VNC_DISPLAY`, `TERMIXKIT_LOCAL_PROOF_VNC_PORT`,
`TERMIXKIT_LOCAL_PROOF_RDP_HOST`, `TERMIXKIT_LOCAL_PROOF_RDP_PORT`,
`TERMIXKIT_LOCAL_PROOF_GATEWAY_PORT`, and `TERMIXKIT_LOCAL_PROOF_GATEWAY_IMAGE`.

The Nix dev shell includes TigerVNC for reproducible local VNC proof runs. Start a temporary no-auth server in one shell, then run the smoke in another:

```sh
Xvnc :77 -localhost -SecurityTypes None -rfbport 5977 -geometry 1024x768 -depth 24
TERMIXKIT_SMOKE_VNC_HOST=127.0.0.1 TERMIXKIT_SMOKE_VNC_PORT=5977 npm run smoke:protocols
```

Smoke-test the production app boundary with disposable SSH/SFTP, Telnet, VNC, and mocked RDP Gateway fixtures. This builds the current production app, creates a temporary admin user, drives first-run/login through Chromium, creates hosts and credentials through the app APIs, opens WebSocket sessions through `/ws/*`, exercises SFTP list/download/upload plus mkdir, text read/write, rename/move, and delete through the authenticated HTTP API, and verifies that the RDP remote launch path stages a saved password without leaking it into Gateway provisioning:

```sh
nix develop -c npm run smoke:app-protocols
```

Smoke-test RDP Gateway bootstrapping. Without real Gateway env vars this runs a mocked Devolutions Gateway bootstrap; with `GATEWAY_URL`, `GATEWAY_PUBLIC_URL`, `GATEWAY_PROVISIONER_KEY`, and `TERMIXKIT_SMOKE_RDP_HOST` it provisions against a real Gateway target. Optional real-target inputs are `TERMIXKIT_SMOKE_RDP_PORT`, `TERMIXKIT_SMOKE_RDP_USERNAME`, `TERMIXKIT_SMOKE_RDP_PASSWORD`, `TERMIXKIT_SMOKE_RDP_DOMAIN`, `TERMIXKIT_SMOKE_RDP_USER_ID`, `TERMIXKIT_SMOKE_RDP_HOST_ID`, and `TERMIXKIT_SMOKE_RDP_GATEWAY_TIMEOUT_MS`:

```sh
nix develop -c npm run smoke:rdp-gateway
```

Record current-commit RDP proof after the real Gateway/RDP smoke passes:

```sh
npm run acceptance:record-real-rdp
```

Run the browser first-run/authentication smoke. The script selects Nix Chromium
inside `nix develop` and falls back to a system Chrome/Chromium when run outside
the shell:

```sh
nix develop -c npm run test:e2e
```

Build the app and migration images:

```sh
nix develop -c docker compose build app migrate
```

Run the production migration job used by Compose:

```sh
nix develop -c docker compose run --rm migrate
```
