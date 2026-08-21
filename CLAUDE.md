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
npm run spec:sync                # download the official OpenAPI spec, regenerate docs/api-spec/
npm run spec:impact              # check src/api against the spec (endpoints, filters, attributes)
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
scripts/                  # spec sync + impact analysis (tsx, see API Spec)
docs/api-spec/            # Official OpenAPI spec + per-resource split (see below)
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

`list_custom_fields` -> `list_custom_field_options` -> `update_task` / `create_task` with a `custom_fields` object keyed by field ID.

Generic mechanism (`src/tools/custom-fields.ts`, `src/tools/custom-field-resolver.ts`) replacing the old hardcoded per-field `update_task_sprint` tool -- works for any custom field on any task, not just one specific field.

## Budget Workflow

`create_budget` (direct) or `create_budget_from_deal` (derived from an existing deal/contract via `origin_deal_id` -- the origin deal must be in a "Won" status) -> `update_budget` for edits.

Budgets are Deals with `budget: true` (`src/tools/budgets.ts`) -- same underlying resource as `list_company_budgets` and `list_project_deals`, distinguished by the `budget` attribute (not the `type` filter value used when listing). A plain deal (`budget: false`) additionally requires `probability` + `deal_status` on creation; budgets don't.

Services (line items) attach to a budget via `create_budget_service`/`update_budget_service` (`src/tools/budget-services.ts`) -- a Service references its parent via a `deal` relationship (not a `budget_id` attribute), since Services attach identically to plain deals or budgets at the API level; there is no server-side distinction to validate against, so the tool doesn't attempt one. `unit_id` (1=Hour/2=Piece/3=Day) and `billing_type_id` (1=Fixed/2=Actuals/3=None/4=Percentage) are required by the API but default to `1` and `2` respectively.

## Toolsets

`PRODUCTIVE_TOOLSETS` (optional, comma-separated) restricts which domain groups of tools a deployment exposes -- unset/`all` means every tool, same as before this feature existed. Catalog lives in `src/tools/toolsets.ts`; `registry.ts`'s `getToolDefinitions`/`handleToolCall` filter `ListTools` and reject `CallTool` for disabled tools (not just hide them).

| Toolset         | Covers                                                                             |
| --------------- | ---------------------------------------------------------------------------------- |
| `core`          | whoami, companies, projects, people, activities, recent updates, workflow statuses |
| `tasks`         | tasks, task lists, subtasks, dependencies, backlog, reposition, my-tasks           |
| `custom_fields` | custom field discovery + generic get/set                                           |
| `comments`      | task comments, pins, reactions                                                     |
| `time_tracking` | time entries, timers, approvals, deals/services                                    |
| `invoicing`     | invoices, company budgets, line items, PDF/timesheet URLs                          |
| `docs`          | folders (boards) + pages                                                           |
| `todos`         | todos                                                                              |

## Adding New Tools

1. Read API spec: `docs/api-spec/resources/_index.yaml` (endpoint overview)
2. Read resource detail: `docs/api-spec/resources/{resource}.yaml` -- `x-filters` lists the valid
   filter keys, `components.schemas.resource_*` the response attributes
3. Create tool file in `src/tools/{resource}.ts`
4. Export tool definition + handler, add to `src/tools/registry.ts`
5. Follow existing patterns (Zod input schema, apiClient calls, JSON API format). Errors: let them
   out and end the handler with `catch (error) { throw toMcpError(error); }` -- do not hand-roll a
   `new McpError(...)` mapping
6. Add the new tool's name to the matching toolset in `src/tools/toolsets.ts` (or a new toolset) -- `tests/unit/toolsets.test.ts` asserts every registered tool is covered, and it will fail otherwise
7. Give the definition `annotations` (see below) -- the `satisfies` clause in `getToolDefinitions()` makes this a compile error if you forget
8. Ship: merge to `main` (auto-deploys — see Git Workflow), or `npm run worker:deploy` for a manual deploy

### Tool annotations

Every definition carries MCP `annotations`, in the tool file next to `inputSchema`. They are the only
way a client can tell `delete_task` from `list_tasks`, so a wrong hint is worse than a missing one --
it makes a client actively confident instead of cautious. The policy, enforced by
`tests/unit/annotations.test.ts`:

| Hint              | Rule                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`           | Human-readable name, always set                                                                                                                                                          |
| `readOnlyHint`    | `true` when the call changes nothing in Productive (the 38 `list_*`/`get_*`, `whoami`, `my_tasks`)                                                                                       |
| `destructiveHint` | `true` only for what is not easily undone: the six `delete_*`, the two `archive_*`, plus `finalize_invoice` and `mark_invoice_paid`. An `update_*` that replaces one field stays `false` |
| `idempotentHint`  | `false` for creates (each call makes another object), `true` for every other write                                                                                                       |
| `openWorldHint`   | `true` throughout -- Productive is shared, so two identical calls can differ because of what someone else did                                                                            |

The destructive and non-idempotent sets are pinned as literal lists in that test: reclassifying a
tool, or adding a `delete_*` and forgetting the hint, fails there rather than silently changing what
a client decides to confirm.

## API Spec

The **official** OpenAPI 3.1 spec from <https://developer.productive.io/reference/download_spec>,
split per resource. It is no longer scraped from HTML -- Productive publishes the spec itself.

- `resources/_index.yaml` -- index of all resources: file, description, endpoints
- `resources/{slug}.yaml` -- self-contained spec per resource; `x-filters` = valid filter keys,
  `components.schemas.resource_*` = response attributes
- `resources/reports/*.yaml` -- the `Reports` tag is too big for one file, split per endpoint
- `productive-openapi.yaml` -- the official spec verbatim (codegen + diff baseline, don't read directly)
- `CHANGELOG.md` -- semantic diff per sync: paths, methods, filter keys, attributes
- `guides/*.md` -- Productive's own API guides, mirrored as Markdown. They carry rules the spec
  does not: how custom-field hashes and page bodies behave, filter operators, rate limits
- `impact-baseline.json` -- known, accepted deviations between `src/api` and the spec

Regenerate: `npm run spec:sync` (sends the stored ETag; a `304` means nothing changed, but the
guides sync either way; `npm run spec:guides` does only the guides)
Check our code against it: `npm run spec:impact`

`.github/workflows/api-spec-sync.yml` runs this weekly and opens a PR on `chore/api-spec-sync`
when the spec moved, with the impact analysis in the PR body.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and on every PR: both typechecks, the stdio
build, `prettier --check`, `npm test` and `npm run spec:impact`. Run the same set locally before
pushing — nothing else gates a merge.

The integration suites under `tests/integration/` skip themselves when `PRODUCTIVE_API_TOKEN` is
unset, so CI runs the unit tests only. Locally they use the credentials in `.dev.vars` — copy
`.dev.vars.example` and fill it in. If they fail with `You are not authenticated`, that token is
stale — replace it rather than ignoring the red.

**Check `.dev.vars` before trusting a green test run.** A missing file fails nothing: the suites skip
and `npm test` reports `Test Files 5 skipped (5)` / `Tests 12 skipped (12)` in green, having verified
nothing that talks to Productive. `tests/setup.ts` warns on stderr in that case (suppressed under
`CI`, where the token is absent by design), but the skip line is what to read. Pre-flight:

```bash
test -f .dev.vars && grep -q '^PRODUCTIVE_API_TOKEN=.' .dev.vars \
  && echo "integration suites will run" || echo "integration suites will SKIP"
```

The other direction matters just as much: **with valid credentials `npm test` writes to the live
org** — the suites create deals, budgets and folders and remove them again in `afterAll`. Point
`.dev.vars` at a sandbox org, never at production.

Because `skipIf` still executes a describe body during collection, an integration suite must build
its client inside `beforeAll`, never at describe level: a top-level `getConfig()` throws without
credentials and fails the file instead of skipping it.

## Gotchas

- **Amounts in cents**: API returns amounts as integer strings (e.g. "2506569" = 25065.69). Divide by 100 for display, send cents to API.
- **Org ID for PDF URLs**: `PRODUCTIVE_ORG_ID` must include the slug (e.g. `12345-company-name`, not just `12345`) for PDF URL generation.
- **Folders = Boards, one tool set only**: Productive's project→folder→task-list→task hierarchy is a single API resource. The API's own relationship/attribute vocabulary calls it a "board" (`board_id` on tasks and task lists, `type: 'boards'`), but this tenant's live REST route is `/api/v2/folders` -- `/api/v2/boards` 404s ("route not found", verified both against production and against a sandbox org). `src/tools/folders.ts` is the only tool set for it (`list_folders`, `get_folder`, `create_folder`, `update_folder`, `archive_folder`, `restore_folder`, `copy_folder`, `move_folder`, `reposition_folder`); `src/api/client.ts`'s `Board`-named methods (`listBoards`, `createBoard`, ...) are the only client implementation, and they deliberately hit the `folders` path. Do not add a parallel `boards.ts` tool file or a client method that hits `/boards` directly -- that was tried, always 404s, and was removed for exactly this reason.
- **Relationship linkage needs `?include=`**: a plain (non-`include`) GET on a resource with a relationship (e.g. `folders/{id}`) returns that relationship as a stub (`{ "meta": { "included": false } }`, no `data`/id) -- not the linked resource's ID. `get_folder`'s "Project ID:" line is therefore always blank unless the request adds `?include=project` and reads the ID from the response's top-level `included` array (verified live against the sandbox API). This affects any tool reading a relationship ID off a plain GET response, not just folders.
- **generate_line_items**: Uses a FLAT payload, not JSON API envelope. `invoicing_method` is hardcoded to `uninvoiced_time_and_expenses`.
- **Line items not includable**: `get_invoice` cannot use `?include=line_items`. Fetch separately via `listLineItems`.
- **McpServer vs Server**: The Worker uses the low-level `Server` class (not `McpServer`) because tool definitions use raw JSON Schema, which `McpServer.registerTool()` does not accept.
- **Streamable HTTP transport**: The Worker uses `createMcpHandler` (stateless, no Durable Object). Each request creates a fresh `Server` instance. Do NOT use `McpAgent` — it requires persistent SSE connections that get killed by Worker timeouts.
- **Two tsconfigs**: `tsconfig.worker.json` type-checks everything (with CF types); the stdio `tsconfig.json` **excludes** every Worker-only file. A new file that uses the edge runtime (`crypto.subtle`, `KVNamespace`, `btoa`/`atob` — most of `src/auth/`) **must be added to `tsconfig.json`'s `exclude`**, or the stdio `npm run build` fails.
- **`custom_fields` is replaced, not merged**: a PATCH sends the whole hash, so writing one field with a partial hash silently deletes every other custom field on that object (reproduced live). `update_task` therefore reads the task and merges before writing -- do the same for any new tool that writes `custom_fields`. Documented in `docs/api-spec/guides/working-with-custom-fields.md`.
- **Page bodies are documents, not text**: `pages.body` holds a Productive Document Format document (`{"type":"doc","content":[...]}`). Sending a plain string returns **HTTP 500**, not a validation error. Create via `pages/create_with_markdown` (with `project_id` as an _attribute_, and only on root pages) and write the body via `pages/{id}/replace_body_with_markdown` or `/append_markdown`, both of which take a **flat** `{"markdown": "..."}` payload without the JSON:API envelope. See `docs/api-spec/guides/document-format.md`.
- **Custom field value shapes**: a `custom_fields` entry's value shape depends on the field's data type — an array of option ID strings for dropdown/multi-select fields, an ISO date string for date fields, or the raw value for text/number/checkbox fields. The official spec documents the `custom_fields`/`custom_field_options` attributes (the type attribute is `data_type_id`, **not** `field_type`), but not which enum value means which type, and `resource_*.custom_fields` is only `type: object` — so the value shape per field type is still only confirmed by a live API test.
- **New tool, new toolset entry**: added a tool to `registry.ts` without adding its name to `src/tools/toolsets.ts`? It silently disappears for any deployment with a restrictive `PRODUCTIVE_TOOLSETS` set (still works when unset, since that means "no filtering"). `tests/unit/toolsets.test.ts` has a completeness check that catches this at test time, not just in production.
- **`filter[...]` keys can differ from the matching response attribute name**: Productive 422s on unrecognized filter keys ("Filter 'x' is not supported on this endpoint"). Confirmed traps: person `is_active` attribute → filter is `filter[status]` (1: active/2: deactivated); deal `budget_type` attribute → filter is `filter[type]` (1: deal/2: budget); deal open/closed → `filter[budget_status]` (not `filter[status]`, which means something unrelated — `status_id`, a pipeline-stage relationship). Verify against the `x-filters` block in `docs/api-spec/resources/{resource}.yaml` before adding a new filter to `client.ts` — don't assume the attribute name is the filter name. `npm run spec:impact` checks every `filter[...]` key in `client.ts` against that list and fails on an unknown one.
- **Unknown filters answer 422, not 400**: `docs/api-spec/guides/filtering.md` documents a 400 for an unsupported filter, but the live API returns **422** with `Filter 'x' is not supported on this endpoint`. Match on the message, not the status code.
- **Tool-level tests don't catch wrong `filter[...]` keys**: tests like `tests/unit/people.test.ts` typically assert only on the params passed into a _mocked_ `client.ts` method, not the actual request URL — the bug above shipped invisibly for exactly this reason. When you touch filter-building code in `client.ts`, add/extend a `client-*.test.ts` test (pattern: `tests/unit/client-boards.test.ts`, `client-filters.test.ts`) that stubs `global.fetch` and asserts on the real query string.

- **Some breaking changes are announced only by email**: the 422 error `code` switches from `invalid_attribute` to `invalid_attribute_value` on **2026-09-15** (opt in early with the `X-Feature-Flags: invalidAttributeValueCode` header). We are not affected -- `makeRequest` reads `detail || title` and never branches on `code` -- but note that this never appeared in the public changelog, so the weekly spec sync could not have caught it. Watch the Productive emails for this class of change.

- **Never branch on the error `code`, branch on the HTTP status**: `src/utils/errors.ts` maps Productive failures onto MCP error codes using `ProductiveApiError.httpStatus` only. The JSON:API `code` field appears in neither the OpenAPI spec nor any guide, and its 422 values change on 2026-09-15 (see above) -- reading the status keeps us out of that. Caller-fault statuses are `400/404/409/422`; `409` is in the set because `pin_comment`, `unpin_comment`, `reject_time_entry` and `unreject_time_entry` hit endpoints where the spec documents it, and "already pinned" is a caller problem, not a server one.

- **`spec:impact` fails silently if you reshape `makeRequest`**: `scripts/lib/client-usage.ts` walks the AST looking for `this.makeRequest(path, options)` -- exact method name, `this` receiver, path as argument 0, HTTP method from a string literal in argument 1. Rename it, or move to an options object, and the analyzer finds **zero** calls and `npm run spec:impact` exits **0 having checked nothing**. `tests/unit/client-usage.test.ts` pins a floor (`usages.length >= 75`) so that shows up as a red test instead. Note the standing blind spot: the ~20 `this.makeVoidRequest` calls and the raw `fetch` in `repositionTask` are not analysed at all.

## Environment Variables

All secrets are set via `wrangler secret put` (production) or `.dev.vars` (local dev). See [README.md](README.md#deploy-your-own) for the full deployment guide.

| Variable                  | Description                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| `PRODUCTIVE_API_TOKEN`    | Legacy stdio fallback only — NOT used by the Worker (per-user PATs replace it)   |
| `PRODUCTIVE_ORG_ID`       | Organization ID with slug (shared across users)                                  |
| `PRODUCTIVE_API_BASE_URL` | API base URL (default: production)                                               |
| `PRODUCTIVE_TOOLSETS`     | Optional, comma-separated toolset names to enable (default: all — see Toolsets)  |
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
- **Upstream**: `berwickgeek/productive-mcp` — the fork source, kept as a **harvest source, not a merge source**. `git merge upstream/main` is not viable: the Worker/BYOT/toolsets rewrite diverged so far that (as of 2026-08-21) not one of our 53 `src/` files is byte-identical with upstream. Port individual features by hand instead, the way PR #19 did, and note in the commit what you deliberately did _not_ adopt. Never open PRs there.
- **Surveying upstream**: `git fetch upstream && git log --no-merges $(git merge-base main upstream/main)..upstream/main`. Upstream is still actively developed, so this is worth a look before building something it may already have. Anything filesystem-based (e.g. its attachment tools) is out — it does not run on the Workers runtime.
- **The GitHub fork relationship stays** for as long as we harvest from upstream. Detaching it is the option once we stop, not a cleanup task.
- **`gh` default repo**: `remote.origin.gh-resolved=base` is set (via `gh repo set-default MonadsAG/monads-mcp-productive`), so `gh` targets origin, not the parent. If `gh` ever prompts for a repo or aims at `berwickgeek/...`, that config was lost — re-run `gh repo set-default` instead of pasting `--repo` into every command.
- **Deploy**: the repo is connected to **Cloudflare Workers Builds** — merging to `main` **auto-deploys** to production. Neither `.github/workflows` entry deploys: `ci.yml` checks, `api-spec-sync.yml` syncs the spec. `npm run worker:deploy` is only for deliberate out-of-band/test deploys.
- **PRs are squash-merged** (`gh pr merge --squash --delete-branch`) — confirmed by `main`'s single-commit-per-PR history. Afterward, local feature branches need `git branch -D` (not `-d`) to clean up, since git doesn't recognize a squash commit as merged via ancestry.
