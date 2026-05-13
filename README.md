# TermixKit

TermixKit is a SvelteKit rewrite of the connection-focused parts of Termix. V1 targets one Docker Compose deployment with the app, Postgres, and Devolutions Gateway wiring for browser-based RDP.

## Milestones

- V1 wave 1: deployment skeleton, environment contract, import mapping skeleton, verification harness.
- V1 wave 2: core schema, auth/session flow, encrypted credential persistence.
- V1 wave 3: host and credential management UI.
- V1 wave 4: SSH/SFTP, Telnet, VNC, and RDP launch flows.
- V1 hardening: import job persistence, gateway provisioning, production runbook, backup/restore checks.

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

Start Postgres, Gateway, and the production app container:

```sh
docker compose up --build
```

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
- Validate Compose wiring with dummy secret values before changing deployment defaults:

```sh
POSTGRES_PASSWORD=dev-password \
ORIGIN=https://termix.example \
CREDENTIAL_MASTER_KEY=dev-credential-master-key \
GATEWAY_PROVISIONER_KEY=dev-gateway-key \
docker compose config
```

## Required Environment

Do not commit real values for any secret.

- `DATABASE_URL`: Postgres connection string used by the app and Drizzle.
- `ORIGIN`: public app origin. Compose defaults to `https://localhost:3000` so production cookies are secure by default; set the external `https://` origin behind a TLS-terminating reverse proxy.
- `TERMIXKIT_INSECURE_LOCAL_HTTP`: set to `1` only for direct local HTTP development with an `http://localhost` or loopback `ORIGIN`. Production startup rejects other HTTP origins.
- `CREDENTIAL_MASTER_KEY`: high-entropy key used to derive credential encryption material.
- `GATEWAY_URL`: internal Devolutions Gateway URL, defaulting to `http://gateway:7171` in Compose.
- `GATEWAY_PROVISIONER_KEY`: Gateway provisioning key shared with the app.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`: local Compose database settings.
- `DEVOLUTIONS_GATEWAY_TAG`: Gateway container tag. The Compose file currently pins `2026.1.1` by default.

## Termix Importer

The importer is a one-way service under `src/lib/server/import` with upload parsing, validation, import execution, and an `import_jobs` persistence interface. The current API surface is:

- `POST /api/import/validate`: accepts multipart `file` upload and persists a validation job.
- `GET /api/import/jobs`: lists persisted import jobs for the signed-in user.
- `POST /api/import/jobs`: accepts multipart `file` upload, imports mapped hosts and credentials, and persists the job result.

Supported uploads are JSON arrays or JSON objects with `records`, `connections`, or `hosts` arrays. Supported target protocols are SSH, RDP, VNC, and Telnet; SFTP is normalized to SSH. The importer records warnings for unsupported protocols, encrypted source credentials without a decryption hook, Guacamole-only settings, snippets, and server statistics.

Current limitations are intentional and visible in validation results:

- SQLite files are detected but not parsed yet.
- Import jobs are persisted through the Drizzle-backed `import_jobs` repository.
- Imported hosts and credentials are persisted through the current Drizzle-backed service repository.
- The source decrypt secret field is reserved; encrypted Termix source credentials are still skipped.

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

Build the app image:

```sh
docker compose build app
```

Run the production migration job used by Compose:

```sh
docker compose run --rm migrate
```
