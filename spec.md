# TermixKit Specification

## Summary

TermixKit is a clean SvelteKit rewrite of the connection-focused parts of Termix. It will live as a sibling project at `/home/jens/Documents/source/TermixKit`; this repository remains the reference implementation and data source for migration work.

The goal is a single Docker-deployable web application for managing hosts and launching browser-based remote sessions without Guacamole or `guacd`.

V1 scope:

- Local username/password auth.
- Postgres-backed host and credential storage.
- Encrypted saved credentials using an application master key.
- SSH terminal sessions.
- SFTP file manager over SSH.
- RDP sessions via IronRDP WASM and embedded Devolutions Gateway.
- VNC sessions via noVNC and an authenticated WebSocket-to-TCP proxy.
- Telnet sessions via xterm.js and an authenticated Telnet bridge.
- Basic settings and a one-way Termix data importer.

Out of scope for V1:

- OIDC, TOTP, RBAC, sharing, and audit logs.
- Dashboards, server stats, Docker management, snippets, and SSH tunnels.
- Standalone FTP/FTPS.
- Desktop and mobile wrappers.
- Compatibility with the existing Termix database schema as the live schema.

## Runtime And Stack

- Framework: SvelteKit with Svelte 5 and TypeScript.
- Adapter: `@sveltejs/adapter-node`.
- Runtime: Node.js.
- Package manager: npm.
- Database: Postgres.
- ORM and migrations: Drizzle.
- Styling: Tailwind CSS plus shadcn-svelte components.
- Terminal UI: xterm.js.
- RDP UI: IronRDP WASM web client.
- VNC UI: noVNC.
- WebSocket server: custom Node server wrapping SvelteKit's `handler`.

The app should use one Node process for HTTP, SvelteKit routes, API routes, and WebSocket upgrades. Do not recreate Termix's fixed multi-port internal service layout.

## Deployment

V1 deployment target is a single Docker Compose stack:

- `app`: SvelteKit Node server.
- `postgres`: application database.
- `gateway`: Devolutions Gateway, packaged or managed by the compose stack for IronRDP.

The public app should expose one HTTP port. Reverse proxies should only need to forward normal HTTP and WebSocket upgrade traffic to that port.

Required environment:

- `DATABASE_URL`: Postgres connection string.
- `APP_SECRET`: cookie/session signing secret.
- `CREDENTIAL_MASTER_KEY`: key used for encrypting saved credentials.
- `GATEWAY_URL`: internal Devolutions Gateway URL.
- Gateway provisioner/key configuration required by Devolutions Gateway.

Secrets must be provided by environment variables or Docker secrets. They must not be committed.

## Data Model

Use a new schema optimized for the rewrite. Do not preserve old table names such as `ssh_data` except inside importer code.

Core tables:

- `users`
  - `id`, `username`, `passwordHash`, `isAdmin`, `createdAt`, `updatedAt`.
- `sessions`
  - `id`, `userId`, `tokenHash`, `expiresAt`, `createdAt`, `lastSeenAt`, `userAgent`, `ipAddress`.
- `hosts`
  - `id`, `userId`, `name`, `protocol`, `hostname`, `port`, `username`, `credentialId`, `folder`, `tags`, `notes`, `createdAt`, `updatedAt`.
  - `protocol` enum values: `ssh`, `rdp`, `vnc`, `telnet`.
- `credentials`
  - `id`, `userId`, `name`, `kind`, `username`, encrypted secret fields, metadata, `createdAt`, `updatedAt`.
  - `kind` enum values: `password`, `ssh_key`.
- `connection_sessions`
  - `id`, `userId`, `hostId`, `protocol`, `status`, `startedAt`, `endedAt`, `errorCode`.
- `session_tickets`
  - short-lived, single-use tickets for websocket session startup.
- `settings`
  - key/value settings for app-level options.
- `import_jobs`
  - tracks Termix import attempts, counts, warnings, and failures.

Credential encryption:

- Encrypt sensitive credential material before writing to Postgres.
- Use authenticated encryption.
- Derive encryption material from `CREDENTIAL_MASTER_KEY`.
- Store enough metadata for key versioning and future rotation.
- Never log decrypted credential values.

## Authentication

V1 uses local username/password auth only.

Requirements:

- First-run admin creation flow.
- Password hashing with a modern password hashing library.
- HTTP-only, secure cookie sessions.
- Server-side session lookup and revocation.
- `event.locals.user` populated in SvelteKit server hooks.
- Unauthenticated users redirected to login for app pages.
- API routes return `401` for unauthenticated requests.

Do not implement OIDC, TOTP, RBAC, sharing, or audit logs in V1. Keep table and service boundaries simple enough to add them later.

## Session Launch Flow

All protocols use the same high-level session launch pattern:

1. User selects a host.
2. Client calls a server route to start a protocol session.
3. Server validates auth, host ownership, protocol, and credential availability.
4. Server creates a short-lived single-use ticket scoped to user, host, protocol, and target.
5. Client opens the corresponding websocket URL with the ticket.
6. WebSocket upgrade validates and consumes the ticket.
7. Backend opens the protocol connection or gateway session.
8. Backend records lifecycle state in `connection_sessions`.

Tickets must expire quickly and must not contain plaintext credentials.

## Protocol Adapters

### SSH Terminal

Use `ssh2` on the server and xterm.js in the browser.

WebSocket path:

- `/ws/ssh/:ticket`

Behavior:

- Open an SSH shell using the resolved host and credential.
- Stream terminal bytes bidirectionally.
- Support terminal resize messages.
- Close the SSH channel when the websocket closes.
- Report connection failures with structured close/error messages.

### SFTP File Manager

Use SFTP over SSH, using the same host and credential model as SSH terminal sessions.

Server capabilities:

- List directories.
- Download files.
- Upload files.
- Create folders.
- Rename and move files.
- Delete files and folders.
- Read and write text files for editor workflows.

V1 does not include FTP or FTPS. If a host needs file transfer in V1, it must be reachable through SFTP.

### RDP

Use IronRDP WASM in the browser and Devolutions Gateway for the browser-to-RDP transport.

WebSocket path:

- `/ws/rdp/:ticket` or the gateway-compatible path required by the final IronRDP integration.

Behavior:

- Backend creates/authorizes an RDP session through the embedded Gateway.
- Client receives the information required by IronRDP: destination, proxy address, auth token, username, domain, and desktop size.
- Browser renders to canvas through IronRDP.
- Support keyboard, mouse, resize, disconnect, and basic clipboard if available through the chosen IronRDP/Gateway integration.

Do not build a custom RDP protocol proxy in V1 unless Devolutions Gateway proves unusable. A simple WebSocket-to-TCP bridge is not assumed to be sufficient for IronRDP.

### VNC

Use noVNC in the browser and a backend authenticated WebSocket-to-TCP proxy.

WebSocket path:

- `/ws/vnc/:ticket`

Behavior:

- Backend validates the ticket and opens a TCP socket to the configured VNC target.
- Browser connects noVNC to the websocket URL.
- Proxy bytes bidirectionally.
- Support password credentials where required by noVNC/RFB.
- Close target socket when the websocket closes.

### Telnet

Use xterm.js in the browser and a backend Telnet bridge.

WebSocket path:

- `/ws/telnet/:ticket`

Behavior:

- Backend validates the ticket and opens a Telnet connection to the target.
- Server handles Telnet option negotiation.
- Browser renders the terminal using xterm.js.
- Support resize messages where the Telnet server supports NAWS.
- Close target socket when the websocket closes.

## UI Requirements

The app should be operational and dense, not a marketing-style UI.

Primary screens:

- Login and first-run admin setup.
- Host list with search/filter.
- Host create/edit dialog.
- Credential manager.
- Active session workspace.
- SSH terminal tab.
- SFTP file manager tab.
- RDP canvas view.
- VNC canvas view.
- Telnet terminal view.
- Basic settings.
- Termix import page.

Design constraints:

- Use compact panels, tables, tabs, menus, and icon buttons.
- Avoid nested cards and decorative hero sections.
- Keep the session workspace full-height and keyboard friendly.
- Remote session canvases/terminals must use stable dimensions and respond to container resize.
- Provide clear connection, loading, error, and disconnected states.

## Termix Importer

The importer is one-way from existing Termix data to the new schema.

Supported inputs:

- Existing Termix SQLite database file when available.
- Termix export file if the existing export format is easier to support.

Importer behavior:

- Map users where possible, but require explicit handling for passwords if hashes are incompatible.
- Import hosts, folders/tags, connection type, hostname, port, username, domain, notes, and supported protocol settings.
- Import password and SSH key credentials only if they can be decrypted from the source with user-provided or environment-provided secrets.
- Convert Guacamole-specific host config only when there is a protocol-native equivalent.
- Record warnings for unsupported fields instead of failing the whole import.
- Produce an import summary with created, skipped, and failed counts.

Unsupported Termix data for V1 should be ignored with warnings:

- Guacamole server settings.
- Snippets.
- Dashboards.
- Server stats settings.
- Docker integration settings.
- SSH tunnels.
- RBAC/sharing/audit records.

## Testing And Verification

Required automated tests:

- Credential encryption/decryption tests.
- Auth session tests.
- Host CRUD validation tests.
- Session ticket expiration and single-use tests.
- WebSocket auth rejection tests.
- Termix import mapping tests.
- Drizzle migration tests against Postgres.

Required integration smoke tests:

- Create admin user.
- Create SSH host and open terminal.
- Browse SFTP directory and download a small file.
- Open Telnet session against a local test server.
- Open VNC session against a local test target.
- Open RDP session through Devolutions Gateway against a known Windows RDP target.

Required build checks:

- `npm run check`
- `npm run lint`
- `npm run test`
- `npm run build`
- `docker compose up` smoke test

## Milestones

### Milestone 1: Scaffold

- Create `/home/jens/Documents/source/TermixKit`.
- Scaffold SvelteKit with TypeScript, adapter-node, Tailwind, shadcn-svelte, ESLint, Prettier, Vitest, and Playwright.
- Add custom Node server that delegates HTTP to SvelteKit and owns websocket upgrades.
- Add Docker Compose with app and Postgres.

### Milestone 2: Data And Auth

- Add Drizzle Postgres schema and migrations.
- Add local auth, sessions, first-run admin setup, and protected routes.
- Add encrypted credential storage.

### Milestone 3: Host Management

- Add host and credential CRUD.
- Add connection launch ticket service.
- Add base session workspace UI.

### Milestone 4: SSH And SFTP

- Add SSH terminal adapter and xterm.js UI.
- Add SFTP file manager endpoints and UI.
- Verify against at least one real SSH host.

### Milestone 5: Telnet And VNC

- Add Telnet bridge and terminal UI.
- Add VNC bridge and noVNC UI.
- Verify websocket lifecycle and error handling.

### Milestone 6: RDP

- Add embedded Devolutions Gateway deployment.
- Add IronRDP WASM frontend integration.
- Add RDP session bootstrap route.
- Verify login, resize, keyboard, mouse, clipboard if available, and disconnect.

### Milestone 7: Import And Polish

- Add Termix importer.
- Add settings page.
- Add Playwright coverage for primary flows.
- Complete README and deployment docs.

## Acceptance Criteria

V1 is complete when:

- The app deploys from Docker Compose with one public web port.
- A new admin can be created from the first-run flow.
- Hosts and credentials can be created and edited.
- Saved secrets are encrypted in Postgres.
- SSH terminal works in the browser.
- SFTP file browsing and download/upload work.
- Telnet works in the browser.
- VNC works in the browser without Guacamole.
- RDP works in the browser through IronRDP and Devolutions Gateway without Guacamole.
- A Termix import can bring over supported host and credential data with a clear summary.
- Tests and production build pass.
