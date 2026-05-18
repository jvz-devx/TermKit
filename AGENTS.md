# Agent Instructions

TermKit is a SvelteKit/TypeScript app for remote access workflows. Keep changes small,
focused, and easy to review.

## Search first

- Prefer the `fff` MCP for repository discovery before opening files.
- Use `fff_find_files` for file-name search instead of broad directory listings.
- Use `fff_grep` for content search, route lookup, and symbol lookup.
- Use `fff_multi_grep` when checking several terms, naming variants, or related concepts at once.
- Fall back to `rg` only when `fff` is unavailable or a task specifically needs shell output.

## Project map

- App pages live in `src/routes/(app)`; auth and first-run pages live in `src/routes/(auth)`.
- HTTP endpoints live under `src/routes/api`; shared route helpers are in `src/routes/api/_helpers.ts`.
- Termix UI components live in `src/lib/components/termix`; shadcn-style primitives live in `src/lib/components/ui`.
- Server-only logic lives in `src/lib/server`, especially `auth`, `db`, `services`, `protocols`, and `ws`.
- Drizzle schema is in `src/lib/server/db/schema.ts`; migrations are in `drizzle/`.
- SvelteKit remote functions are in `src/lib/*.remote.ts` and should enforce auth via request locals before service calls.

## Coding guidelines

- Follow existing file structure and naming conventions.
- Avoid introducing new dependencies unless clearly justified.
- In Svelte, prefer event-driven updates, derived values, and guarded store writes; avoid `$effect` unless it is genuinely necessary.
- Keep UI, server logic, and data access concerns separated according to nearby patterns.
- Prefer service-layer changes in `src/lib/server/services` over putting business logic directly in routes.
- Add or update colocated `*.spec.ts` / `*.test.ts` coverage when changing behavior.

## Validation

- Run the smallest relevant check after changes: targeted `vitest`, `npm run check`, `npm run lint`, or `npm run test:e2e` when UI flows change.
- For database changes, update Drizzle schema and migrations together and consider `npm run db:generate` / `npm run db:migrate`.
- If a check cannot be run, mention why and what should be run next.
