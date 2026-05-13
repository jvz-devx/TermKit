# TermixKit

TermixKit is a SvelteKit rewrite of the connection-focused parts of Termix. V1 targets one Docker Compose deployment with the app, Postgres, and Devolutions Gateway wiring for browser-based RDP.

## Milestones

- V1 wave 1: deployment skeleton, environment contract, import mapping skeleton, verification harness.
- V1 wave 2: core schema, auth/session flow, encrypted credential persistence.
- V1 wave 3: host and credential management UI.
- V1 wave 4: SSH/SFTP, Telnet, VNC, and RDP launch flows.
- V1 hardening: import job persistence, gateway provisioning, production runbook, backup/restore checks.

## Local Development

Install dependencies:

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
npm run db:push
```

## Developer Notes

- After each implement/review loop, commit and push the integrated changes.
- For SvelteKit app logic, prefer remote functions over `+page.server.ts` where possible.
- Use standalone `+server.ts` endpoints for real HTTP/API boundaries.

## Required Environment

Do not commit real values for any secret.

- `DATABASE_URL`: Postgres connection string used by the app and Drizzle.
- `ORIGIN`: public app origin, for example `http://localhost:3000`.
- `BETTER_AUTH_SECRET`: Better Auth signing secret.
- `APP_SECRET`: app-level cookie/session signing secret reserved by the V1 spec.
- `CREDENTIAL_MASTER_KEY`: high-entropy key used to derive credential encryption material.
- `GATEWAY_URL`: internal Devolutions Gateway URL, defaulting to `http://gateway:7171` in Compose.
- `GATEWAY_PROVISIONER_KEY`: Gateway provisioning key shared with the app.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`: local Compose database settings.
- `DEVOLUTIONS_GATEWAY_TAG`: Gateway container tag. The Compose file currently pins `2026.1.1` by default.

## Termix Importer

The current importer is a one-way mapping skeleton under `src/lib/server/import`. It accepts representative SQLite/export-like records and maps supported values into new host and credential DTOs. It records warnings for unsupported protocols, encrypted source credentials without a decryption hook, Guacamole-only settings, snippets, and server statistics.

The skeleton does not read SQLite files or write to Postgres yet. Those pieces should be layered around the pure mapper so import behavior remains easy to test.

## Verification

Run the importer tests:

```sh
npm run test:unit -- --run src/lib/server/import/termix.spec.ts
```

Run the full unit suite:

```sh
npm test
```

Run static checks:

```sh
npm run check
npm run lint
```

Build the app image:

```sh
docker compose build app
```
