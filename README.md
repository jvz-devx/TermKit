# TermixKit

TermixKit is a SvelteKit rewrite of the connection-focused parts of Termix. V1 targets one Docker Compose deployment with the app, Postgres, and Devolutions Gateway wiring for browser-based RDP through the app's single public HTTP port.

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

## Application Navigation

TermixKit keeps the sidebar at the application-workflow level rather than listing individual hosts. Host records live under **Inventory**, reusable secrets live under **Credentials**, Termix data migration lives under **Import from Termix**, and all protocol launches start from the **Session workspace**. The session workspace has its own host search and protocol filters, so SSH, SFTP, RDP, VNC, and Telnet choices stay close to the actual session UI instead of becoming global sidebar destinations.

## Local Development

Enter the Nix dev shell before running project tooling:

```sh
nix develop
```

Install dependencies inside the shell:

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
- Microsoft app registration: configure a web redirect URI at `${ORIGIN}/auth/microsoft/callback` unless `MICROSOFT_REDIRECT_URI` is explicitly set. The auth flow uses authorization code + PKCE with `openid profile email` scopes by default.
- `TERMIXKIT_SSH_KNOWN_HOSTS_PATH`: JSON SSH/SFTP known-host trust store. Compose mounts `app-data` at `/var/lib/termixkit` and defaults this to `/var/lib/termixkit/ssh-known-hosts.json` so TOFU pins survive container rebuilds.
- `TERMIXKIT_SSH_TRUST_ON_FIRST_USE`: set to `1` only while enrolling trusted SSH/SFTP hosts. Leave unset or `0` for strict known-host checking.
- `TERMIXKIT_SSH_ALLOW_PRODUCTION_TOFU`: production-only override for TOFU enrollment. Prefer seeding `TERMIXKIT_SSH_KNOWN_HOSTS_PATH` and disabling TOFU after enrollment.
- `GATEWAY_URL`: internal Devolutions Gateway URL, defaulting to `http://gateway:7171` in Compose. Production startup requires an absolute `http://` or `https://` URL.
- `GATEWAY_PUBLIC_URL`: browser-reachable app proxy URL used by IronRDP, defaulting to `https://localhost:3000/gateway` in Compose. Production requires `https://`, requires the exact `/gateway` app proxy mount, and rejects internal Compose names such as `https://gateway`; direct local Compose can use `http://localhost:3000/gateway` only with `TERMIXKIT_INSECURE_LOCAL_HTTP=1`.
- `GATEWAY_PROVISIONER_KEY`: Gateway provisioning key shared with the app. Production startup requires this value before accepting traffic.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`: local Compose database settings.
- `DEVOLUTIONS_GATEWAY_TAG`: Gateway container tag. The Compose file currently pins `2026.1.1` by default.

## Termix Importer

The importer is a one-way service under `src/lib/server/import` with upload parsing, validation, import execution, and an `import_jobs` persistence interface. The current API surface is:

- `POST /api/import/validate`: accepts multipart `file` upload and persists a validation job.
- `GET /api/import/jobs`: lists persisted import jobs for the signed-in user.
- `POST /api/import/jobs`: accepts multipart `file` upload, imports mapped hosts and credentials, and persists the job result.

Importer uploads are capped at 10 MiB. SFTP uploads are capped at 50 MiB, and the Compose `BODY_SIZE_LIMIT` default is 55 MiB so oversized declared or chunked multipart requests are rejected with 413 before application parsing continues.

Supported uploads are JSON arrays, JSON objects with `records`, `connections`, or `hosts` arrays, and SQLite `.sqlite`, `.sqlite3`, or `.db` files with supported Termix host tables. Supported target protocols are SSH, RDP, VNC, and Telnet; SFTP is normalized to SSH. Plaintext passwords, SSH keys, `ip` host aliases, reusable SQLite `ssh_credentials` records, host `credential_id` links, and supported Termix AES-256-GCM/HKDF encrypted password/key fields can be imported. Encrypted source fields require a `sourceSecret` multipart field; missing secrets, unsupported encrypted formats, and failed decrypts are recorded as warnings.

Imported protocol metadata is preserved on host records. RDP `domain` values are carried through session tickets into the Devolutions Gateway bootstrap so Windows domain imports do not get dropped between import and launch.

RDP saved password credentials are resolved during the authenticated remote launch, staged only in the browser tab for the IronRDP connect call, and cleared by the RDP pane after the connect attempt is built. The Devolutions Gateway provisioning request receives only destination/session metadata and never receives the saved target password.

Current limitations are intentional and visible in validation results:

- SQLite parsing is intentionally bounded to supported Termix host and credential tables. Corrupt files, unsupported SQLite page shapes, and unsupported tables are rejected or surfaced as validation warnings instead of being guessed.
- Import jobs are persisted through the Drizzle-backed `import_jobs` repository.
- Imported hosts and credentials are persisted through the current Drizzle-backed service repository.
- Guacamole-only settings, snippets, server statistics, unsupported protocols, and unsupported encrypted credential formats are surfaced as warnings rather than imported as first-class records.

## Verification

Run the importer tests:

```sh
npm run test:unit -- --run src/lib/server/import/termix.spec.ts
```

Run the full unit suite:

```sh
nix develop -c npm test
```

Run static checks:

```sh
nix develop -c npm run check
nix develop -c npm run lint
```

Build the SvelteKit app and custom production server:

```sh
nix develop -c npm run build
```

Smoke-test the production WebSocket upgrade entrypoint:

```sh
nix develop -c npm run smoke:ws
```

Smoke-test Postgres migrations in a disposable container:

```sh
nix develop -c npm run smoke:postgres
```

Smoke-test local protocol loopbacks for Telnet, VNC banner negotiation, SSH, and SFTP:

```sh
nix develop -c npm run smoke:protocols
```

Smoke-test the production app boundary with disposable SSH/SFTP, Telnet, VNC, and mocked RDP Gateway fixtures. This builds the current production app, creates a temporary admin user, drives first-run/login through Chromium, creates hosts and credentials through the app APIs, opens WebSocket sessions through `/ws/*`, exercises SFTP list/download/upload through the authenticated HTTP API, and verifies that the RDP remote launch path stages a saved password without leaking it into Gateway provisioning:

```sh
nix develop -c npm run smoke:app-protocols
```

Smoke-test RDP Gateway bootstrapping. Without real Gateway env vars this runs a mocked Devolutions Gateway bootstrap; with `GATEWAY_URL`, `GATEWAY_PUBLIC_URL`, `GATEWAY_PROVISIONER_KEY`, and `TERMIXKIT_SMOKE_RDP_HOST` it provisions against a real Gateway target:

```sh
nix develop -c npm run smoke:rdp-gateway
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
