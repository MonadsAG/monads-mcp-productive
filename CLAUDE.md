# CLAUDE.md

MCP server for Productive.io API integration. TypeScript/Node.js, stdio transport.

## Commands

```bash
npm run build     # tsc + chmod, outputs to build/
npm run dev       # tsc --watch
npm start         # node build/index.js
npm run format    # prettier
```

## Project Structure

```
src/
├── index.ts          # Entry point
├── server.ts         # MCP server setup, tool + prompt registration
├── api/
│   ├── client.ts     # ProductiveAPIClient (fetch-based, JSON API)
│   └── types.ts      # TypeScript types for API entities
├── config/
│   └── index.ts      # Env validation with Zod (PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORG_ID)
├── tools/            # MCP tool implementations (one file per feature)
│   ├── tasks.ts      # CRUD + assignment + details
│   ├── time-entries.ts  # Time entries, services, deals
│   ├── timers.ts     # Start/stop/get timer
│   └── ...           # 20 tool files total
├── prompts/          # MCP prompt templates
│   └── timesheet.ts  # Guided timesheet workflow
docs/api-spec/        # Generated API specs (see below)
```

## Domain Hierarchies

- **Project:** Customers -> Projects -> Boards -> Task Lists -> Tasks
- **Timesheet:** Projects -> Deals/Budgets -> Services -> Tasks -> Time Entries

## MCP Protocol Constraints

- stdout is **RESERVED EXCLUSIVELY** for JSON-RPC messages
- ANY non-protocol stdout output **BREAKS** the connection
- ALL debug/log/error output **MUST** use stderr
- Messages are newline-delimited JSON, each on a single line

## Adding New Tools

1. Read API spec: `docs/api-spec/resources/_index.yaml` (endpoint overview)
2. Read resource detail: `docs/api-spec/resources/{resource}.yaml`
3. Create tool file in `src/tools/{resource}.ts`
4. Export tool definition + handler, register in `src/server.ts`
5. Follow existing patterns (Zod input schema, apiClient calls, JSON API format)

## API Spec

Generated docs in `docs/api-spec/`:

- `resources/_index.yaml` -- compact index of all 105 resources + endpoints
- `resources/{slug}.yaml` -- full OpenAPI spec per resource
- `productive-openapi.yaml` -- complete spec (for codegen only, don't read directly)
- `CHANGELOG.md` -- tracks API changes between scraper runs

Regenerate: `cd docs/api-spec && python productive_to_openapi.py`

## Environment Variables

```bash
PRODUCTIVE_API_TOKEN=...    # Required. Settings -> API integrations
PRODUCTIVE_ORG_ID=...       # Required
PRODUCTIVE_USER_ID=...      # Optional. For "my tasks" features
```

## Code Conventions

- **Strict TypeScript** (`strict: true`, no `any`)
- **Zod** for all external data validation (API responses, env vars, tool inputs)
- **No stdout** -- use `console.error()` for logging
- **JSON API spec** -- all requests/responses follow jsonapi.org format
- Max 500 lines per file, max 50 lines per function
- Semantic commits: `feat:`, `fix:`, `refactor:`, `chore:`
