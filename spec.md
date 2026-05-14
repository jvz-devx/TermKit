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

V5 scope:

- Protocol power-user polish for SSH, SFTP, FTP, FTPS, and RDP after the V4 wiring is complete.
- A richer browser terminal experience with search, snippets, command history helpers, per-host terminal preferences, and optional session recording controls.
- Advanced file-transfer workflows across SFTP, FTP, and FTPS: progress, cancellation, retry, bulk operations, recursive folder transfers, drag-and-drop, bookmarks, and file search.
- Completed FTP/FTPS workspace integration with explicit FTPS settings, certificate/error handling, session lifecycle history, and browser smoke coverage.
- RDP operator controls: shortcut toolbar, fullscreen ergonomics, reconnect UX, quality/performance presets, multi-monitor readiness where supported, audio redirection where supported, and richer clipboard/file-transfer feedback.
- SSH jump host and bastion support for SSH, SFTP, and SSH tunnel flows using the same credential and known-host trust model.

Out of scope for V5:

- A full managed-file-transfer product with queues, scheduled transfers, cross-server sync jobs, or compliance export requirements.
- Persisting live SSH processes across app/container restart.
- Storing terminal output, remote desktop pixels, or raw transferred file contents in Postgres by default.
- A Guacamole-style mounted RDP file drive unless IronRDP/Gateway exposes a clean supported path.
- Native desktop and mobile wrappers.

V6 scope:

- Fleet operations and collaboration once V5 has made each protocol strong individually.
- Reusable automation templates for SSH commands, file-transfer workflows, RDP session checklists, and operator notes.
- Controlled bulk operations across selected hosts with explicit confirmation, concurrency limits, cancellation, retry, and per-host status.
- Background jobs for long-running commands and transfers with progress, history, reports, and retention controls.
- Workspace-level sharing and governance for hosts, credentials, snippets, job templates, policies, and sensitive workflows.
- Optional SSH-based host facts and health checks without requiring a target-side agent.
- Access policies for clipboard, file transfer, terminal recording, RDP audio, SSH tunnels, and bulk jobs.

Out of scope for V6:

- A general CI/CD or configuration-management system.
- Always-on target agents or daemon installation on managed hosts.
- Fully custom organization-wide RBAC, SAML/SCIM enterprise governance, or compliance-grade audit exports.
- Autonomous remediation that runs without an explicit operator action or scheduled policy.
- Secret exposure in generated commands, job logs, reports, or templates.
- Storing full terminal output by default for bulk command jobs.

V7 scope:

- Deep, realistic test coverage across the TermixKit codebase after the V1-V6 product surface exists.
- Bug-seeking tests that deliberately look for incomplete wiring, missing route-to-service connections, stale UI affordances, and cross-layer contract drift.
- Coverage tooling, coverage reports, and CI gates for the parts of the repo where automated coverage is meaningful.
- High-confidence unit and integration coverage for server services, protocol adapters, auth, import, migrations, repository mapping, policy enforcement, and job orchestration.
- Browser and smoke coverage for session workspace workflows, protocol launch paths, file-manager behavior, RDP behavior, and admin/operator flows.
- Regression suites for security-sensitive behavior: credential encryption, host-key trust, auth boundaries, websocket ticketing, clipboard/file-transfer policy, tunnel access, and secret redaction.
- Mutation, fuzz/property-style, and fixture-based tests where they catch real classes of bugs without making the suite too slow to run.

Out of scope for V7:

- Chasing 100% global line coverage across Svelte UI wrappers, generated shadcn-svelte components, or purely visual markup.
- Testing third-party libraries such as xterm.js, noVNC, IronRDP, ssh2, or basic-ftp beyond TermixKit integration contracts.
- Requiring real Microsoft, RDP, VNC, SSH, FTP, or FTPS infrastructure for ordinary local test success.
- Storing secrets, terminal output, remote desktop frames, or transferred file contents in test artifacts.
- Turning external proof-only checks into mandatory local gates when real tenant or target infrastructure is unavailable.

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

V5 tables and schema updates:

- `terminal_preferences`
  - Per-user, per-host SSH terminal preferences.
  - Fields: `id`, `userId`, `hostId`, `fontSize`, `theme`, `scrollbackLines`, `shellTitle`, `initialCols`, `initialRows`, `metadata`, `createdAt`, `updatedAt`.
- `command_snippets`
  - Per-user command snippets, optionally scoped to a workspace or host.
  - Fields: `id`, `userId`, `workspaceId`, `hostId`, `name`, `command`, `description`, `tags`, `metadata`, `createdAt`, `updatedAt`.
- `terminal_recordings`
  - Recording metadata and retention state only; recording payloads live outside normal connection metadata.
  - Fields: `id`, `userId`, `hostId`, `connectionSessionId`, `sshLiveSessionId`, `status`, `storageKey`, `startedAt`, `endedAt`, `retentionExpiresAt`, `metadata`, `createdAt`, `updatedAt`.
  - Status enum values: `recording`, `completed`, `failed`, `expired`.
  - V5 ships explicit browser-side recording controls, disabled-by-default behavior, asciicast download, and local retention cleanup; terminal output is not stored in normal connection metadata.
- `file_bookmarks`
  - Per-user, per-host remote directory bookmarks for SFTP, FTP, and FTPS.
  - Fields: `id`, `userId`, `hostId`, `protocol`, `label`, `remotePath`, `metadata`, `createdAt`, `updatedAt`.
- `ftps_host_settings`
  - Per-user, per-host FTPS mode and certificate-validation settings.
  - Fields: `id`, `userId`, `hostId`, `mode`, `rejectUnauthorized`, `certificateHostname`, `metadata`, `createdAt`, `updatedAt`.
  - Mode enum values: `explicit`, `implicit`.
- `rdp_host_settings`
  - Per-user, per-host RDP display, clipboard, audio, gateway, and extension settings.
  - Fields: `id`, `userId`, `hostId`, `display`, `clipboard`, `audio`, `gateway`, `metadata`, `createdAt`, `updatedAt`.

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

V5 file-transfer polish:

- Show transfer progress, throughput, remaining size, completion, cancellation, and failure states for SFTP, FTP, and FTPS uploads and downloads.
- Support cancel and retry for long-running transfers where the underlying protocol/client can safely stop and restart the operation.
- Support bulk file actions: multi-select download, upload, move, rename where practical, delete, and mkdir workflows.
- Support recursive folder upload and download with clear limits, confirmation, partial-failure reporting, and no silent overwrite behavior.
- Add drag-and-drop upload into the active remote directory.
- Add remote file search within the current folder tree with bounded depth and clear loading/cancel states.
- Add bookmarks or favorites for frequently used remote directories per host and user.
- Add symlink-aware listing and action labels so users can distinguish files, folders, links, and unsupported entry types.
- Add optional chmod/chown-style metadata actions only where the protocol server exposes reliable support.
- Stream large downloads and uploads instead of buffering whole files in memory where SvelteKit and the selected protocol client allow it.
- Add browser smoke coverage for SFTP, FTP, and FTPS file-manager flows, including progress/error states.

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

V5 RDP polish:

- Add a session toolbar for common remote shortcuts, including Ctrl+Alt+Del, Windows key, reconnect, disconnect, fullscreen, and display resize actions where IronRDP exposes support.
- Add reconnect UX that distinguishes Gateway/session expiration, remote disconnect, client error, and credential failure.
- Add quality and performance presets for remote desktop size, resize behavior, frame/update behavior, and bandwidth-sensitive operation where the IronRDP API supports the setting.
- Improve fullscreen focus handling so keyboard capture, pointer focus, and exit states are predictable.
- Add multi-monitor readiness where supported by IronRDP/Gateway, with a graceful single-monitor fallback.
- Add audio redirection where supported by IronRDP/Gateway and expose a deployment-level setting to disable it.
- Keep RDP file transfer based on clipboard file transfer unless a clean supported drive-redirection API becomes available.
- Add richer clipboard and file-transfer telemetry in the pane without logging remote clipboard payload contents.
- Add real-target acceptance proof for login, resize, keyboard/mouse, clipboard policy, file clipboard transfer, disconnect, and reconnect behavior.

### V5 SSH And Terminal Polish

V5 improves SSH from a working terminal into an operator-grade terminal workspace.

Behavior:

- Add terminal search over visible scrollback and the bounded in-memory reattach buffer.
- Add command snippets and per-user command history helpers without logging arbitrary terminal output by default.
- Add per-host terminal preferences for font size, theme, scrollback size, shell title, and initial terminal dimensions.
- Add optional terminal session recording with explicit admin/user controls, retention settings, and clear warnings before enabling it.
- Keep terminal recording disabled by default and store recordings outside normal connection metadata with retention-aware cleanup.
- Current implementation note: terminal recording is disabled by default and uses explicit browser controls to capture asciicast output outside normal connection metadata with local retention cleanup.
- Add SSH jump host and bastion configuration for SSH terminal, SFTP, and SSH tunnel flows.
- Reuse the same credential resolution and known-host trust policy for every hop in a jump-host chain.
- Add clearer host-key trust enrollment UX and warnings for changed or untrusted keys.
- Add terminal copy/paste controls where deployment policy needs to restrict browser clipboard interaction.
- Add browser smoke coverage for terminal search, snippets, per-host preferences, and jump-host launch validation using disposable SSH fixtures where practical.

### V6 Fleet Operations And Collaboration

V6 turns the single-session operator workspace into a controlled multi-host operations layer.

Automation templates:

- Support reusable snippets for SSH commands, file-transfer actions, tunnel launches, and RDP operator checklists.
- Allow template variables with typed inputs, defaults, required flags, and preview before execution.
- Allow secret-backed variables only through saved credentials or explicit secret references; generated previews and logs must never print secret values.
- Allow workspace owners to share approved templates with workspace members.
- Track template version, author, last editor, and last-used metadata.

Bulk jobs:

- Support bulk SSH command execution across selected hosts with explicit confirmation before fan-out.
- Support bulk SFTP/FTP/FTPS transfers across selected hosts where credentials and protocols allow the action.
- Support concurrency limits, per-host status, cancellation, retry, and partial-failure reporting.
- Keep per-host stdout/stderr capture bounded and disabled or redacted by policy where needed.
- Never run a bulk job against hidden hosts; the selected host set must be visible and reviewable before start.

Job history:

- Persist job metadata, status, timing, target host list, template version, actor, and structured failure reasons.
- Keep sensitive output and transferred file contents out of default job history.
- Provide downloadable job reports that summarize per-host outcomes without embedding secrets.
- Add retention controls for job metadata and optional captured output.

Workspace governance:

- Add lightweight roles beyond owner/member where needed: viewer, operator, and maintainer.
- Let workspace policies control who can launch sessions, transfer files, run tunnels, record terminals, use RDP clipboard/audio, and start bulk jobs.
- Allow approval gates for dangerous templates or large bulk jobs.
- Require optional reason/comment prompts for sensitive hosts or privileged operations when policy enables them.

Host intelligence:

- Add optional SSH-based host fact collection for OS, uptime, kernel, disk, memory, service hints, and last successful connection.
- Track stale hosts, failing credentials, recent connection failures, and hosts that have not been used recently.
- Keep fact collection on-demand or scheduled by TermixKit; do not require a target-side agent.
- Let users search inventory by workspace, tags, OS/facts, health state, last-seen state, and failure reason.

### V7 Deep Test And Bug-Seeking Program

V7 makes the repo measurably hard to regress without pretending every file should have the same kind of test. It should actively seek bugs and improper wiring, not merely raise coverage percentages.

Current baseline to preserve and expand:

- Unit tests run through Vitest with `src/**/*.{test,spec}.{js,ts}`.
- The current checkout has 52 unit test files under `src`, 1 Playwright e2e file, and 318 discovered unit tests.
- Existing unit coverage is concentrated in server services, protocol helpers, route helpers, auth, import, repository mapping, websocket upgrades, SSH live sessions, and selected component state helpers.
- Existing smoke coverage includes Postgres migrations, Docker Compose, protocol loopbacks, production websocket rejection, app protocol workflows, Microsoft parser fixtures, and RDP Gateway bootstrap.
- Coverage reporting is not wired yet; `npm run test:unit -- --run --coverage` currently requires adding `@vitest/coverage-v8` or an equivalent provider before real percentages can be measured.

Coverage targets:

- Capture an initial coverage baseline before enforcing thresholds.
- After baseline capture, target at least 85% line coverage and 75% branch coverage for `src/lib/server/**`, excluding generated snapshots and test fixtures.
- Target at least 90% line coverage for security-critical pure logic: credential encryption, host-key trust, session tickets, auth/OIDC validation, route auth helpers, policy checks, and secret redaction helpers.
- Target at least 80% line coverage for protocol adapter logic owned by TermixKit: SSH, SFTP, FTP/FTPS, Telnet negotiation, VNC proxy setup, RDP Gateway bootstrap, SSH tunnels, websocket upgrade routing, and TCP frame parsing.
- Target at least 75% line coverage for importer, migration helpers, repository mapping, settings validation, workspace policy, job orchestration, and acceptance-audit scripts.
- Use focused component/helper tests and Playwright coverage for Svelte UI behavior instead of forcing high line coverage on markup-heavy route files.
- Keep global coverage thresholds lower at first, around 70% lines and 60% branches, then ratchet upward only after flaky and low-value files are excluded intentionally.

Test types:

- Unit tests for validation, normalization, permissions, policy decisions, serialization, parsing, and deterministic state machines.
- Repository tests for Drizzle row mapping, enum migrations, cascade/set-null behavior, workspace scoping, and backwards-compatible metadata.
- Route tests for authentication, authorization, input validation, HTTP status mapping, upload limits, download headers, and secret-safe error responses.
- Wiring tests that prove user-visible controls reach the intended remote function, route, service, repository method, protocol adapter, lifecycle recorder, and history/admin surface.
- Protocol fixture tests using disposable in-process SSH/SFTP/Telnet/VNC/FTP/FTPS fixtures where practical.
- Browser smoke tests for first-run auth, host/credential CRUD, workspace launch, SSH live tabs, SFTP/FTP/FTPS file workflows, RDP launch, admin controls, and policy-blocked states.
- Production-boundary smoke tests for Docker Compose, migrations, websocket upgrade rejection, Gateway proxying, environment validation, and startup failure modes.
- Acceptance-proof tests that keep repo-owned requirements deterministic while real Microsoft/RDP/VNC/SSH proofs remain external-proof items.

Hardening tests:

- Add mismatch tests for every feature that has both UI affordances and backend capability, so queued, disabled, or partially implemented features cannot be presented as working.
- Add table-driven tests for every public validation schema and every structured error code surfaced to users or admins.
- Add fuzz or property-style tests for path normalization, file-transfer selection, terminal control frames, websocket route parsing, import parsing, and metadata normalization.
- Add concurrency tests for live SSH session limits, attach-ticket consumption, tunnel limits, bulk jobs, transfer cancellation, and background job retries.
- Add security regression tests that prove secrets do not appear in logs, job reports, acceptance proof files, route errors, or generated previews.
- Add migration smoke tests from representative old schemas and dirty metadata shapes for V1 through V6.
- Add visual or screenshot smoke coverage only where layout regressions can break real workflows, not for every cosmetic component.

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

### V5.1: SSH Power-User Terminal

- Add terminal scrollback search.
- Add command snippets and command history helpers that do not require persisting arbitrary terminal output.
- Add per-host terminal preferences for font size, theme, scrollback, shell title, and initial dimensions.
- Add optional terminal session recording with explicit controls, warnings, retention, and cleanup.
- Keep terminal recording disabled by default.
- Cover explicit terminal recording controls, capture, disabled-by-default behavior, retention cleanup, and proof in acceptance.
- Add SSH jump host and bastion support for SSH terminal sessions.
- Add stronger host-key enrollment and changed-key warnings.
- Add browser smoke coverage for terminal search, preferences, and jump-host validation.

### V5.2: File Manager Power Tools

- Add transfer progress, throughput, remaining size, completion, cancellation, retry, and failure states.
- Add bulk selection and bulk actions for downloads, uploads, moves, deletes, and folder creation.
- Add recursive folder upload and download with confirmation, limits, partial-failure reporting, and overwrite protection.
- Add drag-and-drop uploads into the active remote directory.
- Add remote file search with bounded depth and cancel/loading states.
- Add per-host and per-user remote directory bookmarks.
- Add symlink-aware listing and optional chmod/chown metadata actions where supported.
- Stream large file transfers where the runtime and protocol clients allow it.
- Verify the same file-manager behavior across SFTP, FTP, and FTPS.

### V5.3: FTP And FTPS Completion

- Wire FTP and FTPS hosts into the session workspace as first-class panes.
- Reuse the shared file browser with FTP/FTPS-specific labels, failure states, and lifecycle events.
- Expose explicit FTPS mode settings and support implicit FTPS only where the selected client handles it cleanly.
- Add clear TLS and certificate error handling for FTPS.
- Record FTP/FTPS session lifecycle and structured failures from real workspace actions.
- Add local and browser smoke coverage for FTP and FTPS list, download, upload, mkdir, rename/move, delete, text edit, and transfer error states.

### V5.4: RDP Operator Controls

- Add a toolbar for common remote shortcuts, reconnect, disconnect, fullscreen, and display actions.
- Improve reconnect UX for Gateway expiration, remote disconnect, client error, and credential failure.
- Add quality/performance presets where IronRDP exposes useful controls.
- Improve fullscreen keyboard and pointer focus behavior.
- Add multi-monitor readiness with graceful single-monitor fallback.
- Add audio redirection where IronRDP/Gateway supports it and expose a deployment setting to disable it.
- Improve clipboard and file-transfer feedback without logging remote clipboard payload contents.
- Add real-target acceptance proof for login, resize, keyboard/mouse, clipboard policy, file clipboard transfer, disconnect, and reconnect behavior.

### V5.5: Verification And Migration

- Keep V1, V2, V3, and V4 acceptance criteria passing.
- Add acceptance audit rows for V5 SSH, file-manager, FTP/FTPS, and RDP polish.
- Add migration compatibility checks for V5 tables, enums, unique indexes, and set-null/cascade foreign keys.
- Document any deployment settings added for terminal recording, transfer limits, clipboard restrictions, audio redirection, and FTPS modes.
- Keep existing hosts, credentials, connection history, workspace layouts, and live SSH metadata compatible through migration.

### V6.1: Automation Library

- Add reusable templates for SSH commands, file-transfer actions, SSH tunnel launches, and RDP operator checklists.
- Support typed template variables, defaults, required fields, validation, and preview.
- Support secret references without printing secret values in previews, generated commands, logs, or reports.
- Allow per-user private templates and workspace-shared templates.
- Track template author, last editor, version, usage count, and last-used timestamp.

### V6.2: Bulk Operations

- Add controlled bulk SSH command execution across selected hosts.
- Add controlled bulk SFTP/FTP/FTPS upload and download operations across selected hosts.
- Add bulk host edits for tags, folders, workspace assignment, and credential assignment.
- Require explicit confirmation that shows the target host set before any fan-out starts.
- Add concurrency limits, cancellation, retry, per-host status, and partial-failure reporting.
- Prevent bulk operations from silently including hosts outside the user's visible selection.

### V6.3: Jobs And Run History

- Add a background job model for long-running commands, transfers, and inventory checks.
- Show job progress, current stage, target host counts, per-host status, duration, actor, and structured failure reasons.
- Persist job metadata and bounded per-host output according to workspace policy.
- Add downloadable job reports that summarize outcomes without exposing secrets.
- Add retention settings for job metadata and optional output.
- Add local and browser smoke coverage for successful, cancelled, partially failed, and retried jobs.

### V6.4: Sharing And Governance

- Add lightweight workspace roles for viewer, operator, maintainer, and owner.
- Let policies control session launch, file transfer, tunnel launch, terminal recording, RDP clipboard, RDP audio, automation template use, and bulk job execution.
- Add approval gates for dangerous templates, sensitive hosts, high host counts, and high-risk file-transfer actions.
- Add optional reason/comment prompts before opening sensitive hosts or running privileged operations.
- Keep governance practical and avoid a full organization-wide RBAC builder.

### V6.5: Host Health And Inventory Intelligence

- Add optional SSH-based host fact collection for OS, uptime, kernel, disk, memory, service hints, and last successful connection.
- Add health states for stale hosts, broken credentials, repeated connection failures, and never-used hosts.
- Add inventory search and filters for workspace, tags, OS/facts, health state, last-seen state, and failure reason.
- Add scheduled or on-demand fact collection without installing a target-side agent.
- Add verification fixtures for fact parsing and health-state transitions.

### V6.6: Secure Access Policies

- Add per-workspace policy settings for clipboard, file transfer, terminal recording, RDP audio, SSH tunnels, automation templates, and bulk operations.
- Support time-limited access windows for sensitive hosts, credentials, and job templates.
- Add policy-aware UI states so blocked actions explain which policy blocked them.
- Ensure policy checks are enforced server-side, not only hidden in the client UI.
- Add acceptance audit rows for V6 automation, bulk jobs, governance, host intelligence, and policy enforcement.

### V7.1: Coverage Tooling And Baseline

- Add Vitest coverage tooling and a `test:coverage` script.
- Generate text, HTML, JSON, and CI-friendly coverage reports.
- Establish explicit coverage include/exclude rules for source files, generated files, shadcn-svelte UI primitives, migration snapshots, fixtures, and test helpers.
- Capture the first baseline without failing CI on thresholds.
- Add ratcheting thresholds after the baseline is known: server code first, then protocol adapters, then global coverage.
- Document how to read coverage reports and how to justify intentional exclusions.

### V7.2: Server And Security Deep Tests

- Expand tests for auth, Microsoft OIDC, local sessions, cookies, route auth helpers, credential encryption, host-key trust, session tickets, and policy enforcement.
- Add table-driven tests for every structured error code and user/admin-visible failure reason.
- Add secret-redaction tests for logs, route errors, acceptance proofs, job reports, previews, and generated commands.
- Add repository and migration tests for row mapping, enum changes, metadata compatibility, cascade deletes, set-null behavior, and old-schema upgrade paths.
- Keep coverage targets high for security-critical pure logic: 90% lines where practical, with branch coverage tracked separately.

### V7.3: Wiring And Contract Tests

- Add route-to-service tests for every API route, remote function, lifecycle endpoint, websocket upgrade path, and admin action.
- Add UI-to-capability tests that prove visible protocol tabs, buttons, filters, menus, and admin controls are backed by working handlers or clearly marked unavailable states.
- Add feature-flag and policy wiring tests so blocked actions are enforced server-side and shown consistently in the UI.
- Add data-model contract tests that prove host protocols, connection protocols, workspace layouts, session history, and admin visibility agree on enum values and status names.
- Add regression tests for the exact class of bug where backend/API support exists but the session workspace pane or launcher is still disabled.
- Add acceptance-audit checks that fail when spec claims, README claims, UI affordances, and implemented routes drift apart.

### V7.4: Protocol And WebSocket Deep Tests

- Expand fixture-backed protocol tests for SSH, SFTP, FTP, FTPS, Telnet, VNC, RDP Gateway bootstrap, SSH tunnels, and websocket upgrades.
- Add tests for ticket single-use behavior, origin checks, cross-protocol ticket rejection, malformed frames, resize frames, close/detach frames, and idle expiry.
- Add FTP/FTPS fixture tests for explicit TLS, implicit TLS where supported, certificate failures, auth failures, large transfers, and streamed download failures.
- Add SFTP fixture tests for symlinks, permissions metadata, recursive operations, upload limits, path traversal rejection, and host-key failures.
- Add RDP Gateway tests for provisioning failures, saved-password staging, domain handling, audio/clipboard policy, and Gateway proxy hardening.

### V7.5: Browser And Workflow Tests

- Expand Playwright coverage beyond first-run into core operator workflows.
- Cover host and credential CRUD, importer validation/import, workspace membership, session workspace host selection, SSH live tabs, SFTP/FTP/FTPS file manager actions, RDP launch states, VNC/Telnet launch states, admin views, and policy-blocked UI.
- Add focused accessibility checks for forms, dialogs, protocol panes, file tables, terminal controls, and admin controls.
- Add screenshot or visual smoke coverage for dense session workspace layouts only where layout breakage blocks real use.
- Keep browser tests deterministic with mocked or disposable protocol fixtures instead of real external infrastructure.

### V7.6: Smoke, Acceptance, And External Proof

- Keep local smoke tests for Compose, Postgres migrations, production websocket rejection, app protocol workflows, protocol loopbacks, Microsoft parser fixtures, and RDP Gateway bootstrap.
- Add smoke coverage for V5 and V6 workflows: FTP/FTPS workspace file manager, terminal recording controls, SSH jump-host validation, bulk job lifecycle, host facts, and policy enforcement.
- Keep real Microsoft, real RDP, real VNC, real SSH, and real FTP/FTPS target verification as external proof items when infrastructure is not available locally.
- Ensure acceptance-audit output names the exact local command or external proof required for every V1 through V7 requirement.
- Add proof-file validation that rejects skipped output, placeholder proof, and secret-looking content.

### V7.7: Reliability And Performance Test Budget

- Add concurrency tests for live SSH attach takeover, ticket consumption, detached cleanup, tunnel limits, transfer cancellation, and bulk job retries.
- Add timeout and failure-injection tests for protocol adapters and background jobs.
- Add lightweight performance budgets for importer parsing, file listing transforms, job fan-out scheduling, and workspace rendering helpers.
- Separate fast local gates from slower smoke and external-proof gates.
- Keep the default local gate practical: `npm run check`, `npm run lint`, `npm test`, `npm run test:coverage`, and targeted smoke scripts for changed areas.

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

V5 is complete when:

- SSH terminals support scrollback search, snippets/history helpers, per-host terminal preferences, and stronger host-key enrollment UX.
- SSH jump host or bastion configuration works for SSH terminal, SFTP, and SSH tunnel flows using the same credential and known-host trust model.
- Optional terminal session recording is implemented with explicit controls, disabled-by-default behavior, retention, and cleanup.
- SFTP, FTP, and FTPS file managers show transfer progress, cancellation, retry, and clear partial-failure states.
- SFTP, FTP, and FTPS support bulk actions, recursive folder transfer, drag-and-drop uploads, remote file search, bookmarks, and symlink-aware listing.
- FTP and FTPS are fully usable from the session workspace, not only through backend routes.
- FTPS exposes explicit mode settings, clean implicit-mode behavior where supported, and clear TLS/certificate failures.
- RDP has a session toolbar, reconnect UX, fullscreen focus improvements, quality/performance controls where supported, and richer clipboard/file-transfer feedback.
- RDP real-target proof covers login, resize, keyboard/mouse, clipboard policy, file clipboard transfer, disconnect, and reconnect behavior.
- V1, V2, V3, and V4 acceptance criteria still pass.

V6 is complete when:

- Users can create private and workspace-shared automation templates for SSH commands, file-transfer actions, SSH tunnels, and RDP operator checklists.
- Templates support typed variables, preview, versioning, and secret references that never print secret values.
- Operators can run controlled bulk SSH command jobs and SFTP/FTP/FTPS transfer jobs against an explicitly reviewed host set.
- Bulk jobs support concurrency limits, cancellation, retry, per-host status, partial-failure reporting, and downloadable reports.
- Background job history records useful metadata, timing, actor, target hosts, status, and structured failure reasons without storing secrets or full terminal output by default.
- Workspace roles and policies control who can view, launch, transfer, tunnel, record, use clipboard/audio, run templates, and start bulk jobs.
- Sensitive hosts and dangerous templates can require approval or a reason/comment before execution.
- Optional SSH-based host facts and health checks expose stale hosts, broken credentials, recent failures, OS/fact filters, and last successful connection state without a target-side agent.
- Server-side policy enforcement matches the visible UI state for blocked actions.
- V1, V2, V3, V4, and V5 acceptance criteria still pass.

V7 is complete when:

- Vitest coverage tooling is installed, `test:coverage` exists, and coverage reports are generated in local and CI-friendly formats.
- The repo has documented coverage include/exclude rules and a recorded baseline before threshold enforcement.
- Wiring and contract tests catch incomplete feature wiring across UI, remote functions, API routes, services, repositories, protocol adapters, lifecycle recording, history, and admin visibility.
- Features with visible UI affordances are either proven usable end-to-end or explicitly tested as disabled/queued states.
- Server-side code reaches at least 85% line coverage and 75% branch coverage, excluding intentional low-value/generated files.
- Security-critical pure logic reaches at least 90% line coverage where practical: credential encryption, auth/OIDC validation, host-key trust, session tickets, route auth, policy checks, and secret redaction.
- Protocol adapter and websocket-owned logic reaches at least 80% line coverage where practical, with fixture-backed tests for failure and edge cases.
- Import, repository, migration, settings, workspace, policy, job, and acceptance-audit logic reaches at least 75% line coverage where practical.
- Browser tests cover core operator workflows across auth, inventory, workspace launch, SSH, SFTP, FTP/FTPS, RDP, admin, and policy-blocked states.
- Smoke tests cover production boundaries and protocol workflows without requiring real external infrastructure for local success.
- External-proof requirements remain explicit for real Microsoft, RDP, VNC, SSH, FTP, and FTPS targets when local fixtures are not enough.
- Test artifacts, logs, reports, coverage output, and proof files do not contain secrets, terminal output dumps, remote desktop frames, or transferred file contents.
- V1, V2, V3, V4, V5, and V6 acceptance criteria still pass.
