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

V2 scope:

- Microsoft Entra ID login through OIDC, alongside the V1 local login flow.
- Domain-allowlisted Microsoft auto-provisioning for new users.
- Persistent SSH workspace tabs.
- App-owned live SSH sessions that can detach when a browser disconnects and reattach from another browser session while the TermixKit app process remains alive.
- Per-user live SSH session limits and detached-session idle cleanup.
- Recent in-memory terminal scrollback for reattached SSH sessions.
- SSH workspace UI for listing, opening, renaming, reattaching, and closing live SSH tabs.

Out of scope for V2:

- Generic provider-neutral OIDC beyond the Microsoft Entra integration.
- RBAC, host sharing, and audit logs.
- TOTP.
- SSH tunnels, jump hosts, snippets, command history, and bulk command execution.
- Persisting live SSH processes across app/container restart.
- Persisting terminal output to Postgres.
- Dashboards, server stats, Docker management, FTP/FTPS, and desktop/mobile wrappers.

V3 scope:

- Workspaces for sharing hosts and credentials without introducing full RBAC complexity.
- Connection history for understanding who connected, when, to what, and why failures happened.
- RDP clipboard controls for safer copy/paste behavior.
- RDP file copy/paste through IronRDP clipboard file transfer.
- Admin Panel for users, workspaces, live sessions, connection history, and app settings.
- Session workspace polish so the core app feels complete and production-ready.

Out of scope for V3:

- Full role/permission builder or organization-wide RBAC.
- Audit-log compliance exports beyond practical connection history.
- Docker management, server dashboards, SSH tunnels, FTP/FTPS, and desktop/mobile wrappers.
- Persisting live SSH sessions across app/container restart.

V4 scope:

- SSH tunnels for browser-accessible access to private TCP services through saved SSH hosts.
- FTP and FTPS hosts as first-class connection types, separate from SFTP-over-SSH.
- Window tiling in the session workspace so operators can run multiple sessions side by side.
- Admin visibility and termination controls for active tunnels and long-running transfer/session activity.
- Connection history coverage for SSH tunnels, FTP/FTPS sessions, and tiled workspace launches.

Out of scope for V4:

- Docker management and server monitoring dashboards.
- Full role/permission builder or organization-wide RBAC.
- Persisting live SSH sessions across app/container restart.
- Terminal session recording or terminal-output persistence.
- Secret templating inside commands or snippets.
- Browser-native FTP URL handling; FTP/FTPS must go through TermixKit's authenticated file manager.
- Desktop and mobile wrappers.

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
- FTP/FTPS client: server-side Node library selected during V4 implementation.
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
  - V1 `protocol` enum values: `ssh`, `rdp`, `vnc`, `telnet`.
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

V2 tables:

- `auth_identities`
  - Links local users to external login providers.
  - Fields: `id`, `userId`, `provider`, `providerSubject`, `tenantId`, `email`, `displayName`, `createdAt`, `updatedAt`.
  - V2 provider enum values: `microsoft`.
- `ssh_live_sessions`
  - Persists live SSH workspace metadata, not terminal output.
  - Fields: `id`, `userId`, `hostId`, `title`, `status`, `startedAt`, `lastAttachedAt`, `detachedAt`, `expiresAt`, `endedAt`, `terminalCols`, `terminalRows`, `createdAt`, `updatedAt`.
  - Status enum values: `starting`, `attached`, `detached`, `ended`, `failed`, `stale`.
- `ssh_attach_tickets`
  - Short-lived, single-use tickets for attaching a websocket to an existing live SSH session.
  - Fields: `id`, `userId`, `sshLiveSessionId`, `ticketHash`, `expiresAt`, `consumedAt`, `createdAt`.

V4 tables and schema updates:

- `hosts.protocol` adds `ftp` and `ftps`.
- `ssh_tunnel_profiles`
  - Saved tunnel definitions tied to SSH hosts.
  - Fields: `id`, `userId`, `workspaceId`, `sshHostId`, `name`, `targetHost`, `targetPort`, `description`, `createdAt`, `updatedAt`.
- `ssh_tunnel_sessions`
  - Runtime metadata for active or recently ended SSH tunnels.
  - Fields: `id`, `profileId`, `userId`, `workspaceId`, `sshHostId`, `targetHost`, `targetPort`, `publicPath`, `status`, `startedAt`, `endedAt`, `lastSeenAt`, `errorCode`, `errorMessage`.
  - Status enum values: `starting`, `active`, `ended`, `failed`, `expired`.
- `workspace_layouts`
  - Per-user session workspace layout metadata.
  - Fields: `id`, `userId`, `workspaceId`, `layoutKind`, `panes`, `createdAt`, `updatedAt`.
  - Persist pane host/protocol/session references and layout shape, not terminal output or remote screen contents.

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

V2 adds Microsoft Entra ID login:

- Keep local username/password login available unless explicitly disabled by configuration.
- Add Microsoft login and callback routes.
- Validate OIDC state, nonce, issuer, audience, expiration, and signature.
- Require the Microsoft account email or preferred username to match a configured allowed domain.
- Auto-provision a local user only after the domain allowlist passes.
- Link Microsoft identities through `auth_identities`; do not key users only by email.
- Map configured admin email addresses to `isAdmin = true` during provisioning.
- Create the same HTTP-only secure cookie sessions used by local login.
- Required environment:
  - `MICROSOFT_AUTH_ENABLED`
  - `MICROSOFT_TENANT_ID`
  - `MICROSOFT_CLIENT_ID`
  - `MICROSOFT_CLIENT_SECRET`
  - `MICROSOFT_ALLOWED_DOMAINS`
  - `MICROSOFT_ADMIN_EMAILS`

Microsoft Entra verification boundary:

- Repo-owned V2 work must include deterministic local tests for configuration parsing, OIDC claim validation, route behavior, domain allowlisting, auto-provisioning, admin-email promotion, identity linking, and V1 session cookie reuse.
- Real Microsoft Entra discovery, JWKS validation, real app-registration behavior, and browser login with real tenant users require externally supplied Microsoft tenant/client configuration and test accounts.
- If no Microsoft tenant, client credentials, allowed-domain user, blocked-domain user, and admin-email user are available, V2 implementation may be considered repo-owned complete while the real Microsoft smoke and interactive browser acceptance proofs remain explicitly blocked.
- The blocked proof state must be documented in the acceptance audit and must not be represented as a passing real Microsoft acceptance result.

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

V2 persistent SSH launch flow:

1. User opens an SSH host in the session workspace.
2. Server validates auth, host ownership, protocol, credential availability, and per-user live session limits.
3. Server creates or reuses an `ssh_live_sessions` record.
4. Server starts an app-owned SSH client and shell stream for new live sessions.
5. Server creates a short-lived, single-use attach ticket scoped to user and live SSH session.
6. Client opens `/ws/ssh/live/:ticket`.
7. WebSocket upgrade validates cookie auth and consumes the attach ticket.
8. Backend attaches the websocket to the live SSH stream and sends recent in-memory scrollback.
9. Browser disconnect detaches the websocket but leaves the SSH shell alive until explicit close, remote shell exit, app shutdown, or idle expiry.
10. Explicit close terminates the SSH shell, closes any attached websocket, and marks the live session ended.

Only SSH uses V2 live reattach semantics. SFTP, RDP, VNC, and Telnet keep the V1 launch-ticket behavior.

V4 SSH tunnel launch flow:

1. User opens a tunnel profile tied to a saved SSH host.
2. Server validates auth, workspace access, SSH host access, target host/port, credential availability, and per-user tunnel limits.
3. Server starts an app-owned SSH forwarding connection and records an `ssh_tunnel_sessions` row.
4. Server exposes the tunnel through an authenticated app-local route or websocket boundary, depending on the target protocol and UI.
5. User can copy the browser-accessible tunnel endpoint, inspect tunnel state, and terminate the tunnel.
6. Browser disconnect does not immediately close the tunnel, but detached tunnels expire after a configured idle timeout.
7. Admins can see and terminate active tunnels from the Admin Panel.

V4 tiled workspace flow:

1. User chooses a layout such as single pane, two columns, two rows, or 2x2 grid.
2. Each pane can launch or attach to a supported protocol view.
3. Layout metadata is persisted per user and workspace.
4. Refreshing the browser restores pane arrangement and reconnectable session references where the protocol supports reconnect.
5. Closing a pane removes the pane from the layout; it only terminates a live SSH session, tunnel, or protocol session when the user explicitly chooses the destructive close action.

## Protocol Adapters

### SSH Terminal

Use `ssh2` on the server and xterm.js in the browser.

WebSocket path:

- `/ws/ssh/:ticket`
- `/ws/ssh/live/:ticket` for V2 persistent SSH workspace tabs.

Behavior:

- Open an SSH shell using the resolved host and credential.
- Stream terminal bytes bidirectionally.
- Support terminal resize messages.
- Close the SSH channel when the websocket closes.
- Report connection failures with structured close/error messages.

V2 live SSH behavior:

- Keep the SSH channel open when a websocket disconnects from a persistent tab.
- Allow one active websocket attachment per live SSH session; a new attachment takes over from an older attachment.
- Store recent terminal output in a bounded in-memory ring buffer for reattach.
- Do not write terminal output or decrypted credential values to Postgres or logs.
- Default limits: 10 live SSH sessions per user, 2 hour detached idle timeout, and a bounded 5000-line or size-limited scrollback buffer.
- On app startup, mark any database live sessions without an in-memory owner as `stale`.

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

### SSH Tunnels

V4 adds SSH tunnels through saved SSH hosts.

Behavior:

- Use the same SSH credential resolution and known-host trust policy as SSH and SFTP.
- Support local-forward style TCP targets for private services such as databases, dashboards, internal APIs, and admin consoles.
- Expose the tunnel through an authenticated browser-accessible endpoint owned by TermixKit.
- Show active, starting, failed, expired, and ended states.
- Enforce per-user and app-level active tunnel limits.
- Record lifecycle metadata and structured failure reasons in connection history.
- Let users terminate their own tunnels and admins terminate any active tunnel.
- Do not log decrypted credentials or raw tunneled payloads.
- Do not persist tunneled traffic or terminal output to Postgres.

### FTP And FTPS File Manager

V4 adds FTP and FTPS as first-class host protocols separate from SFTP-over-SSH.

Server capabilities:

- List directories.
- Download files.
- Upload files.
- Create folders.
- Rename and move files.
- Delete files and folders.
- Read and write text files for editor workflows when the server supports the needed operations.

Behavior:

- FTP uses plaintext FTP only when the host protocol is explicitly `ftp`.
- FTPS uses TLS and should support explicit TLS first; implicit TLS is optional if library support is clean.
- Reuse saved password credentials. SSH key credentials do not apply to FTP/FTPS.
- Respect workspace host and credential authorization.
- Record lifecycle state and structured failures in `connection_sessions`.
- Keep all FTP/FTPS traffic server-side behind authenticated TermixKit routes; do not rely on browser-native FTP URL handling.

### RDP

Use IronRDP WASM in the browser and Devolutions Gateway for the browser-to-RDP transport.

Launch path:

- Authenticated remote launch command returns a Devolutions Gateway bootstrap for IronRDP.
- Browser-facing Gateway transport uses the app proxy URL, for example `/gateway/jet/rdp?...`, not a custom app-owned `/ws/rdp/:ticket` bridge.

Behavior:

- Backend validates the user, host ownership, RDP protocol, credential availability, and Gateway configuration.
- Backend creates/authorizes an RDP session through the embedded Gateway and records the connection session lifecycle.
- Client receives the information required by IronRDP: destination, proxy address, auth token, username, domain, and desktop size.
- Saved password credentials are decrypted only during the authenticated launch, staged in browser memory for the IronRDP connect call, and cleared after the connect attempt is built.
- Gateway provisioning must not receive target passwords; it receives only destination/session metadata and Gateway authorization.
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
- FTP/FTPS file manager tab.
- SSH tunnel manager/detail view.
- Tiled session workspace layouts.
- Basic settings.
- Termix import page.

Design constraints:

- Use compact panels, tables, tabs, menus, and icon buttons.
- Avoid nested cards and decorative hero sections.
- Keep the session workspace full-height and keyboard friendly.
- Support single-pane, two-column, two-row, and 2x2 tiled layouts in the session workspace.
- Let users replace, detach, close, and focus panes without losing the whole workspace.
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

### V2 Milestone 1: Microsoft Entra Auth

- Add Microsoft Entra OIDC configuration validation.
- Add Microsoft login and callback routes.
- Add `auth_identities` schema and migrations.
- Add domain-allowlisted auto-provisioning.
- Reuse the V1 session cookie/session table after Microsoft login.
- Add login UI affordance for Microsoft when enabled.

### V2 Milestone 2: Live SSH Session Backend

- Add `ssh_live_sessions` and `ssh_attach_tickets` schema and migrations.
- Add an in-process live SSH session manager.
- Add live SSH create, list, rename, attach-ticket, and close services.
- Add `/ws/ssh/live/:ticket` upgrade handling.
- Add detached idle cleanup and startup stale-session reconciliation.

### V2 Milestone 3: Persistent SSH Workspace UI

- Add SSH tab strip in the session workspace.
- Support opening multiple SSH tabs, renaming tabs, reattaching detached tabs, and closing live tabs.
- Show attached, detached, connecting, failed, stale, and ended states.
- Preserve V1 protocol tabs for SFTP, RDP, VNC, and Telnet.

### V2 Milestone 4: Verification And Docs

- Add Microsoft auth tests and configuration docs.
- Add live SSH manager, websocket, and browser smoke tests.
- Document V2 persistence limits, especially that live SSH sessions do not survive app/container restart.
- Keep all V1 verification gates passing.

### V3.1: Workspaces

- Add workspace records owned by admins or creators.
- Allow hosts and credentials to belong to a workspace or a private user scope.
- Allow users to be added to workspaces with simple membership levels such as owner and member.
- Keep authorization simple: workspace members can use shared hosts and credentials; workspace owners can manage workspace inventory and members.
- Avoid full custom RBAC in V3.

### V3.2: Connection History

- Expand connection history into a first-class screen.
- Show protocol, host, user, workspace, start time, end time, duration, status, and failure reason.
- Preserve structured error codes from SSH, SFTP, Telnet, VNC, and RDP launches.
- Add filters for user, workspace, protocol, host, status, and date range.
- Keep history useful for operators without turning it into a compliance-grade audit system.

### V3.3: RDP Clipboard Controls

- Add app-level and per-session controls for RDP clipboard sync.
- Support separate toggles for text clipboard, file clipboard, client-to-remote, and remote-to-client where IronRDP exposes the distinction.
- Surface clipboard disabled/restricted states clearly in the RDP session UI.
- Default to conservative behavior when deployment settings disable clipboard features.

### V3.4: RDP File Copy/Paste

- Add RDP file transfer through IronRDP clipboard file transfer when supported.
- Support uploading local files into the RDP session through clipboard file copy/paste.
- Support downloading remote files exposed through clipboard file copy/paste.
- Enforce size limits and show transfer progress, completion, cancellation, and failure states.
- Do not add a separate Guacamole-style RDP file drive in V3.

### V3.5: Admin Panel

- Add a central admin area for users, workspaces, live sessions, connection history, and app settings.
- Let admins view, create, disable, and promote users.
- Let admins inspect workspace membership and shared inventory.
- Let admins view and terminate live sessions.
- Let admins review connection failures and adjust relevant settings without editing the database.

### V3.6: Session Workspace Polish

- Improve session workspace ergonomics for multi-tab SSH, SFTP, RDP, VNC, and Telnet use.
- Add stronger empty, loading, reconnecting, detached, failed, and closed states.
- Improve keyboard navigation, focus handling, fullscreen behavior, and responsive layout.
- Make reconnect and close behavior consistent across protocols where the protocol allows it.
- Finish visual and interaction details without adding new major product areas.

### V4.1: SSH Tunnels

- Add saved SSH tunnel profiles tied to SSH hosts.
- Support local-forward style target host and port configuration.
- Add tunnel start, inspect, copy endpoint, and terminate flows.
- Add active tunnel limits and detached tunnel idle expiry.
- Show active tunnel state in the session workspace and Admin Panel.
- Record tunnel lifecycle and structured failures in history.

### V4.2: FTP And FTPS

- Add `ftp` and `ftps` host protocols.
- Add FTP/FTPS connection services using saved password credentials.
- Reuse the file manager interaction model for list, download, upload, mkdir, rename/move, delete, and text edit flows.
- Support explicit FTPS first; add implicit FTPS only if the selected library supports it cleanly.
- Add FTP/FTPS session history, failure states, and browser smoke coverage.

### V4.3: Window Tiling

- Add tiled session workspace layouts: single pane, two columns, two rows, and 2x2 grid.
- Allow panes to hold SSH, SFTP, RDP, VNC, Telnet, FTP/FTPS, or SSH tunnel views.
- Persist layout metadata per user and workspace without persisting terminal output or remote screen contents.
- Let users focus, replace, close, and reconnect panes without losing the whole workspace.
- Keep route files slim by implementing tiling as session workspace components.

### V4.4: Admin And Verification

- Add admin visibility for active SSH tunnels and long-running FTP/FTPS transfer/session activity.
- Let admins terminate active tunnels.
- Add V4 acceptance audit rows and local smoke coverage.
- Keep V1, V2, and V3 verification gates passing.
- Keep real Microsoft Entra proof external-blocked unless tenant/client/test-user configuration is supplied.

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

V2 repo-owned implementation is complete when:

- Microsoft Entra configuration, login routes, callback routes, OIDC validation, allowlist checks, auto-provisioning, identity linking, admin-email promotion, and V1 session reuse are implemented and covered by deterministic local tests.
- A user can open multiple live SSH tabs.
- Refreshing the browser or signing in from another browser can reattach to a still-running SSH tab while the app process is alive.
- Browser disconnect does not kill a persistent SSH tab.
- Explicit tab close terminates the SSH shell.
- Detached sessions expire after the configured idle timeout.
- App restart marks old live SSH metadata as stale rather than pretending sessions are still alive.
- Terminal output is not persisted to Postgres.
- V1 SSH, SFTP, Telnet, VNC, RDP, importer, tests, and production build still pass.

V2 real Microsoft acceptance proof is complete when:

- Real Microsoft Entra login works with an externally supplied tenant, client credentials, and allowed domains.
- A real domain-allowed Microsoft user can be auto-provisioned and receives a normal TermixKit session.
- A real blocked-domain Microsoft user cannot sign in.
- A real configured Microsoft admin email becomes admin on first provisioning or subsequent Microsoft login.
- Local username/password login remains available alongside the real Microsoft flow.

If the required Microsoft tenant, client credentials, allowed-domain user, blocked-domain user, or admin-email user are not available, these real Microsoft proof items remain blocked external acceptance items rather than repo-owned implementation gaps.

V3 is complete when:

- Users can organize shared hosts and credentials into workspaces without full RBAC configuration.
- Workspace members can use shared inventory and workspace owners can manage membership.
- Connection history explains successful and failed sessions with useful timestamps, status, and error reasons.
- RDP clipboard policy can be controlled by admins and understood by users in-session.
- RDP file copy/paste works through IronRDP clipboard file transfer with limits and transfer states.
- Admins have one central panel for users, workspaces, live sessions, connection history, and app settings.
- Admins can terminate live sessions from the Admin Panel.
- The session workspace feels complete across reconnect, close, fullscreen, detached, failure, and responsive states.
- V1 and V2 acceptance criteria still pass.

V4 is complete when:

- Users can create saved SSH tunnel profiles tied to saved SSH hosts.
- Users can open an SSH tunnel, use the browser-accessible endpoint, inspect status, and terminate it.
- SSH tunnels enforce configured limits and expire idle detached tunnels.
- Admins can view and terminate active SSH tunnels from the Admin Panel.
- FTP and FTPS hosts can be created, connected, and used through the authenticated file manager.
- FTP/FTPS support list, download, upload, mkdir, rename/move, delete, and text edit workflows where the server supports them.
- The session workspace supports single-pane, two-column, two-row, and 2x2 tiled layouts.
- Tiled layout metadata survives browser refresh without persisting terminal output or remote screen contents.
- Panes can host SSH, SFTP, RDP, VNC, Telnet, FTP/FTPS, and SSH tunnel views.
- Connection history includes SSH tunnel, FTP/FTPS, and tiled workspace launch metadata with structured failure reasons.
- V1, V2, and V3 acceptance criteria still pass.
- Real Microsoft Entra login proof remains an external-blocked item unless the required tenant, client credentials, allowed-domain user, blocked-domain user, and admin-email user are available.
