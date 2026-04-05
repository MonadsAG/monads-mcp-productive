# CLAUDE.md

Remote MCP server for Productive.io API integration. Runs on **Cloudflare Workers** with **Microsoft Entra ID** authentication.

## Commands

```bash
npm run worker:dev         # wrangler dev (local Worker on port 8788)
npm run worker:deploy      # wrangler deploy (production)
npm run worker:types       # wrangler types (generate CF type defs)
npm run build              # tsc + chmod (stdio build, legacy fallback)
npm run format             # prettier
```

## Project Structure

```
src/
├── worker.ts             # Cloudflare Worker entry point (McpAgent + OAuthProvider)
├── index.ts              # Stdio entry point (legacy fallback)
├── server.ts             # Stdio server setup (uses shared registry)
├── api/
│   ├── client.ts         # ProductiveAPIClient (fetch-based, JSON API)
│   └── types.ts          # TypeScript types for API entities
├── auth/
│   ├── entra-handler.ts  # Entra ID OAuth handler (OIDC flow)
│   ├── user-resolver.ts  # Email → Productive User ID (KV-cached)
│   └── workers-oauth-utils.ts  # OAuth utilities (CSRF, state, cookies)
├── config/
│   ├── index.ts          # Stdio env validation (dotenv + Zod)
│   └── worker-config.ts  # Worker env validation (CF bindings + Zod)
├── tools/
│   ├── registry.ts       # Shared tool registry (used by both entry points)
│   ├── tasks.ts          # CRUD + assignment + details
│   └── ...               # 28 tool files total
├── prompts/
│   └── timesheet.ts      # Guided timesheet workflow
docs/api-spec/            # Generated API specs (see below)
wrangler.jsonc            # Cloudflare Worker config (DO, KV bindings)
tsconfig.json             # Stdio TypeScript config (excludes worker files)
tsconfig.worker.json      # Worker TypeScript config (all files)
```

## Domain Hierarchies

- **Project:** Customers -> Projects -> Boards -> Task Lists -> Tasks
- **Timesheet:** Projects -> Deals/Budgets -> Services -> Tasks -> Time Entries
- **Invoice:** Company -> Budgets -> Invoice -> Line Items -> Finalize -> Pay

## Invoice Workflow

`list_companies` -> `list_company_budgets` -> `create_invoice` -> `generate_line_items` -> `finalize_invoice` -> `mark_invoice_paid`

Smart Defaults: `document_type_id`, `tax_rate_id`, `subsidiary_id` are auto-resolved if only one active option exists.

## Adding New Tools

1. Read API spec: `docs/api-spec/resources/_index.yaml` (endpoint overview)
2. Read resource detail: `docs/api-spec/resources/{resource}.yaml`
3. Create tool file in `src/tools/{resource}.ts`
4. Export tool definition + handler, add to `src/tools/registry.ts`
5. Follow existing patterns (Zod input schema, apiClient calls, JSON API format)
6. Deploy: `npm run worker:deploy`

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

## Environment Variables

All secrets are set via `wrangler secret put` (production) or `.dev.vars` (local dev). See [README.md](README.md#deploy-your-own) for the full deployment guide.

| Variable                  | Description                          |
| ------------------------- | ------------------------------------ |
| `PRODUCTIVE_API_TOKEN`    | Productive.io API token              |
| `PRODUCTIVE_ORG_ID`       | Organization ID with slug            |
| `PRODUCTIVE_API_BASE_URL` | API base URL (default: production)   |
| `ENTRA_CLIENT_ID`         | Entra App Registration client ID     |
| `ENTRA_CLIENT_SECRET`     | Entra App Registration client secret |
| `ENTRA_TENANT_ID`         | Entra directory (tenant) ID          |
| `COOKIE_ENCRYPTION_KEY`   | Random hex key for cookie signing    |

## Code Conventions

- **Strict TypeScript** (`strict: true`, no `any`)
- **Zod** for all external data validation (API responses, env vars, tool inputs)
- **No stdout** -- use `console.error()` for logging
- **JSON API spec** -- all requests/responses follow jsonapi.org format
- Max 500 lines per file, max 50 lines per function
- Semantic commits: `feat:`, `fix:`, `refactor:`, `chore:`
