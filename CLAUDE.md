# CLAUDE.md

Remote MCP server for Productive.io API integration. Runs on **Cloudflare Workers** with **Microsoft Entra ID** authentication.

## Commands

```bash
npm run worker:dev               # wrangler dev (local Worker on port 8788)
npm run worker:deploy            # wrangler deploy (manual/out-of-band only — main auto-deploys, see Git Workflow)
npm run worker:types             # wrangler types (generate CF type defs — NOT a typecheck)
npx tsc -p tsconfig.worker.json  # typecheck the Worker (no npm script for this)
npm run build                    # tsc + chmod (stdio build, legacy fallback)
npx prettier --write .           # format (there is no `npm run format` script)
```

## Project Structure

```
src/
├── worker.ts             # Cloudflare Worker entry point (createMcpHandler + OAuthProvider)
├── index.ts              # Stdio entry point (legacy fallback)
├── server.ts             # Stdio server setup (uses shared registry)
├── api/
│   ├── client.ts         # ProductiveAPIClient (fetch-based, JSON API)
│   └── types.ts          # TypeScript types for API entities
├── auth/
│   ├── entra-handler.ts  # Entra ID OAuth handler (OIDC flow); mounts /settings
│   ├── entra-oidc.ts     # Shared Entra OIDC primitives (authorize URL, token exchange, JWT decode)
│   ├── i18n.ts           # detectLang (Accept-Language → de/en, ?lang override) for the HTML pages
│   ├── settings-handler.ts  # BYOT settings page (/settings: set/rotate/delete PAT), DE/EN
│   ├── pat-crypto.ts     # AES-256-GCM encrypt/decrypt for per-user PATs
│   ├── pat-store.ts      # Per-user PAT storage in USER_PAT_KV (keyed by Entra oid)
│   ├── user-resolver.ts  # Entra oid → Productive person ID (KV-cached, uses the user's PAT)
│   └── workers-oauth-utils.ts  # OAuth utilities (CSRF, state, cookies, HMAC signing)
├── config/
│   ├── index.ts          # Stdio env validation (dotenv + Zod)
│   └── worker-config.ts  # Worker env validation (CF bindings + Zod)
├── tools/
│   ├── registry.ts       # Shared tool registry (used by both entry points)
│   ├── tasks.ts          # CRUD + assignment + details
│   └── ...               # 29 tool files total
├── prompts/
│   └── timesheet.ts      # Guided timesheet workflow
docs/api-spec/            # Generated API specs (see below)
wrangler.jsonc            # Cloudflare Worker config (KV bindings)
tsconfig.json             # Stdio TypeScript config (excludes worker files)
tsconfig.worker.json      # Worker TypeScript config (all files)
```

## Domain Hierarchies

- **Project:** Customers -> Projects -> Boards -> Task Lists -> Tasks
- **Timesheet:** Projects -> Deals/Budgets -> Services -> Tasks -> Time Entries
- **Invoice:** Company -> Budgets -> Invoice -> Line Items -> Finalize -> Pay

## Per-User Tokens (BYOT)

Each `/mcp` request authenticates with the **calling user's own Productive PAT** — there is no shared admin token on the tool path.

- Users set/rotate/delete their PAT at `/settings` (Entra-gated). It uses its own short-lived HMAC-signed session cookie `__Host-SETTINGS_SESSION` (signed with `COOKIE_ENCRYPTION_KEY`), **independent of the MCP OAuth grant** — adding it does not trigger MCP re-login.
- PATs are AES-256-GCM encrypted with `PAT_ENC_KEY` and stored in `USER_PAT_KV`, keyed by the stable Entra `oid` (`pat-store.ts` + `pat-crypto.ts`).
- `worker.ts` loads + decrypts the PAT per request and injects it via `getWorkerConfig(env, userId, userToken)`. If none is stored, `tools/list` still works but every `tools/call` returns a structured hint pointing at `/settings` (`registerNoTokenHandlers`).
- The settings login uses a dedicated callback `/settings/callback` — it **must be registered as a redirect URI** in the Entra App Registration (in addition to `/callback`).
- **Never** log, echo, or return a PAT (no `console.*`, no tool output, no model context).
- The `/settings` page and the OAuth consent dialog are localized **DE/EN**, auto-selected from the browser's `Accept-Language` (default English; `?lang=de|en` override) via `src/auth/i18n.ts`.

## Invoice Workflow

`list_companies` -> `list_company_budgets` -> `create_invoice` -> `generate_line_items` -> `finalize_invoice` -> `mark_invoice_paid`

Smart Defaults: `document_type_id`, `tax_rate_id`, `subsidiary_id` are auto-resolved if only one active option exists.

## Custom Fields Workflow

`list_custom_fields` -> `list_custom_field_options` -> `update_task_details` / `create_task` with a `custom_fields` object keyed by field ID.

Generic mechanism (`src/tools/custom-fields.ts`, `src/tools/custom-field-resolver.ts`) replacing the old hardcoded per-field `update_task_sprint` tool -- works for any custom field on any task, not just one specific field.

## Adding New Tools

1. Read API spec: `docs/api-spec/resources/_index.yaml` (endpoint overview)
2. Read resource detail: `docs/api-spec/resources/{resource}.yaml`
3. Create tool file in `src/tools/{resource}.ts`
4. Export tool definition + handler, add to `src/tools/registry.ts`
5. Follow existing patterns (Zod input schema, apiClient calls, JSON API format)
6. Ship: merge to `main` (auto-deploys — see Git Workflow), or `npm run worker:deploy` for a manual deploy

## API Spec

Generated docs in `docs/api-spec/`:

- `resources/_index.yaml` -- compact index of all 105 resources + endpoints
- `resources/{slug}.yaml` -- full OpenAPI spec per resource
- `productive-openapi.yaml` -- complete spec (for codegen only, don't read directly)
- `CHANGELOG.md` -- tracks API changes between scraper runs

Regenerate: `cd docs/api-spec && python productive_to_openapi.py`
Lint scraper: `pylint --rcfile=docs/api-spec/.pylintrc docs/api-spec/productive_to_openapi.py`

## Gotchas

- **Amounts in cents**: API returns amounts as integer strings (e.g. "2506569" = 25065.69). Divide by 100 for display, send cents to API.
- **Org ID for PDF URLs**: `PRODUCTIVE_ORG_ID` must include the slug (e.g. `12345-company-name`, not just `12345`) for PDF URL generation.
- **generate_line_items**: Uses a FLAT payload, not JSON API envelope. `invoicing_method` is hardcoded to `uninvoiced_time_and_expenses`.
- **Line items not includable**: `get_invoice` cannot use `?include=line_items`. Fetch separately via `listLineItems`.
- **McpServer vs Server**: The Worker uses the low-level `Server` class (not `McpServer`) because tool definitions use raw JSON Schema, which `McpServer.registerTool()` does not accept.
- **Streamable HTTP transport**: The Worker uses `createMcpHandler` (stateless, no Durable Object). Each request creates a fresh `Server` instance. Do NOT use `McpAgent` — it requires persistent SSE connections that get killed by Worker timeouts.
- **Two tsconfigs**: `tsconfig.worker.json` type-checks everything (with CF types); the stdio `tsconfig.json` **excludes** every Worker-only file. A new file that uses the edge runtime (`crypto.subtle`, `KVNamespace`, `btoa`/`atob` — most of `src/auth/`) **must be added to `tsconfig.json`'s `exclude`**, or the stdio `npm run build` fails.
- **Custom field value shapes**: a `custom_fields` entry's value shape depends on the field's `field_type` — an array of option ID strings for dropdown/multi-select fields, an ISO date string for date fields, or the raw value for text/number/checkbox fields. The generated OpenAPI spec for the `custom_fields`/`custom_field_options` resources does not document exact attribute names -- real attribute keys were only confirmed via a live API test.

## Environment Variables

All secrets are set via `wrangler secret put` (production) or `.dev.vars` (local dev). See [README.md](README.md#deploy-your-own) for the full deployment guide.

| Variable                  | Description                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| `PRODUCTIVE_API_TOKEN`    | Legacy stdio fallback only — NOT used by the Worker (per-user PATs replace it)   |
| `PRODUCTIVE_ORG_ID`       | Organization ID with slug (shared across users)                                  |
| `PRODUCTIVE_API_BASE_URL` | API base URL (default: production)                                               |
| `ENTRA_CLIENT_ID`         | Entra App Registration client ID                                                 |
| `ENTRA_CLIENT_SECRET`     | Entra App Registration client secret                                             |
| `ENTRA_TENANT_ID`         | Entra directory (tenant) ID                                                      |
| `COOKIE_ENCRYPTION_KEY`   | Random hex key for cookie signing (HMAC)                                         |
| `PAT_ENC_KEY`             | Hex 32-byte key (`openssl rand -hex 32`) for AES-256-GCM per-user PAT encryption |

KV namespaces (`wrangler.jsonc`): `OAUTH_KV`, `USER_MAPPING_KV` (oid → person ID cache), `USER_PAT_KV` (encrypted per-user PATs, keyed by Entra oid).

## Code Conventions

- **Strict TypeScript** (`strict: true`, no `any`)
- **Zod** for all external data validation (API responses, env vars, tool inputs)
- **No stdout** -- use `console.error()` for logging
- **JSON API spec** -- all requests/responses follow jsonapi.org format
- Max 500 lines per file, max 50 lines per function
- Semantic commits: `feat:`, `fix:`, `refactor:`, `chore:`

## Git Workflow

- **Origin**: `MonadsAG/monads-mcp-productive` — all PRs go here
- **Upstream**: `berwickgeek/productive-mcp` — fork source, **NEVER create PRs here**
- **CRITICAL**: Always use `--repo MonadsAG/monads-mcp-productive` when running `gh pr create`. The `gh` CLI defaults to the upstream fork (`berwickgeek/productive-mcp`) which is wrong.
- **Deploy**: the repo is connected to **Cloudflare Workers Builds** — merging to `main` **auto-deploys** to production (there is no `.github/workflows` CI, so don't assume deploys are manual). `npm run worker:deploy` is only for deliberate out-of-band/test deploys.
