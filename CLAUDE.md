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
│   └── ...               # 40 tool files total
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

| Toolset               | Covers                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `core`                | whoami, companies, projects, people, activities, recent updates, workflow statuses                       |
| `tasks`               | tasks, task lists, subtasks, dependencies, backlog, reposition, my-tasks                                 |
| `custom_fields`       | custom field discovery + generic get/set                                                                 |
| `comments`            | task comments, pins, reactions                                                                           |
| `time_tracking`       | time entries, timers, approvals, deals/services                                                          |
| `invoicing`           | invoices, company budgets, line items, PDF/timesheet URLs                                                |
| `docs`                | folders (boards) + pages, incl. `list_page_children` (page hierarchy)                                    |
| `todos`               | todos                                                                                                    |
| `resource_management` | absences (types, create, list), project capacity bookings (create/update/delete/list), capacity overview |

## Resource Management (Absences & Capacity)

Bookings are _planned_ assignments, not logged time (that's `time_entries`). One
resource, two flavours, told apart by which relationship is set:

- **Absence** -> `event_id` set. Tools: `list_absence_types`, `create_absence`, `list_absences`
- **Project capacity** -> `service_id` set. Tools: `create_booking`, `update_booking`, `list_bookings` (its `project_id` filters server-side)
- **Either kind** can be removed with `delete_booking` (confirm-gated, names the person and the kind first -- a booking id shows neither)
- **Utilisation**: `get_capacity_overview`

Only one direction of that split is server-side. `list_absences` passes
`filter[event_id]` with every event id (the filter takes comma-separated lists),
so what comes back is already the right kind. Nothing selects the inverse, which
leaves exactly one case that still has to be filtered after the fact: project
bookings without a `project_id` (pass one and the API excludes absences by
itself, since an absence has no project). That case asks for a **whole page**
(`MAX_PAGE_SIZE`, 200 rows), not a multiple of `limit` -- a window can hold
nothing but absences for far longer than a few rows (the test org's 2026 holds
25 bookings, every one of them an absence), and a narrow over-fetch then reports
"no project bookings" for a window that has them just below the cut. Same single
request either way; only the payload grows.

`get_capacity_overview` does **not** ask once per person. It pages through the
window in one sweep (`collectBookings`, with `sort=started_on` so the page
boundaries hold still), scoped to exactly the people being reported on by
passing their ids as a comma-separated `filter[person_id]`, and buckets the rows
per person afterwards -- 2-11 requests instead of up to 201, which is what keeps
it inside the rate limit and the Worker's subrequest budget. The sweep stops at
`MAX_BOOKING_PAGES` (10 x 200 rows) and says so in its output: from there on
every figure is partial, so "free" is an upper bound rather than what is
actually left.

Five things that bite if you don't know them:

- **`POST /bookings` breaks the JSON:API convention used everywhere else here.**
  `person_id`, `event_id` and `service_id` go in `data.attributes` as flat
  values; sending them under `relationships` fails with `422 Invalid Attribute`.
- **The API takes an overlapping absence without a word.** Booking the same week
  twice is what a repeated `confirm` produces, and `get_capacity_overview` then
  reports 80h of absence in a 40h week and calls the person overbooked on the
  strength of a duplicate. `create_absence` therefore looks for absences in the
  period first and refuses, unless `allow_overlap` says the clash is intended
  (half days, or two types on one day). Cancelled and rejected entries do not
  count as a clash -- they freed the period up again -- and neither does a
  remote-work booking, which is presence and is never counted against capacity.
- **Never hardcode absence categories.** Names and IDs are org-specific and are
  read at runtime via `GET /events` (`client.listEvents()`). Same reasoning as
  the `update_task_sprint` removal above.
- **Remote work is booked like an absence but is not one.** The absence category
  (the _event_) carries `absence_type: time_off | remote_work`, and working from
  home means the person is present and working. It therefore goes into its own
  `remoteMinutes` bucket, is never subtracted from capacity, and `list_absences`
  leaves it out unless `include_remote_work` is passed. Classifying it needs the
  event sideloaded: if that is missing, or carries no `absence_type`, the booking
  counts as time off -- over-reporting an absence is the safer error. Such a type
  is always unpaid, enforced by the API: `POST /events` with
  `absence_type: remote_work` and a paid `event_type_id` answers `422 must be
unpaid for remote work absence`, which is why `list_absence_types` prints no
  paid/unpaid segment for one.
- **Contracted hours come from `availabilities` on the person, not from
  entitlements** (those are absence quotas). Two shapes are in circulation: the
  live API sends a JSON _string_ of time-sliced two-week patterns
  (`[from, to, pattern, calendarId]`), while the spec's own example
  (`docs/api-spec/resources/people.yaml`) shows a nested array of bare patterns.
  `parseAvailabilities` takes both, and `hasUnreadableAvailabilities` separates
  "no pattern on file" from "pattern there, shape not understood" -- reporting
  the second as the first hides a bug behind a plausible number. See
  `src/api/capacity.ts`.
- **Hours and days must come from the same source.** Anything that multiplies
  hours by days (booking method 3) has to count days with
  `personWorkingDays`/`workingDaysInRange`, not `countWorkingDays`. Mixing the
  person's pattern with the calendar charges a Mon-Thu contract for the Friday:
  a plain week of leave is written as 40h against 32h contracted and then read
  back out of `get_capacity_overview` as OVERBOOKED. `countWorkingDays` is only
  the fallback for someone with no pattern on file. The same rule applies when
  _reading_: `bookedMinutes` prorates a `total_time` booking onto the queried
  window, and numerator and denominator both have to come from
  `workingDaysInRange`. Taking the API's `total_working_days` as the denominator
  mixes two calendars, and a booking that lies entirely inside the window then
  stops adding up to its own `total_time` as soon as a public holiday falls in
  its period. The same reason is why `update_booking` rescales a `total_time`
  booking when only its dates move: leaving the total alone turns a stretched
  week of leave into half days without saying so.

Shared, API-free logic lives in `src/api/bookings-client.ts` (query/payload
building, classification, type resolution) and `src/api/capacity.ts` (the
arithmetic), so all three tool files build on one implementation and the maths
is unit-testable without mocks.

Full specification: `docs/resource-management-spec.md`; evidence and rejected
assumptions: `docs/resource-management-journal.md`.

## Adding New Tools

1. Read API spec: `docs/api-spec/resources/_index.yaml` (endpoint overview)
2. Read resource detail: `docs/api-spec/resources/{resource}.yaml` -- `x-filters` lists the valid
   filter keys, `components.schemas.resource_*` the response attributes
3. Create tool file in `src/tools/{resource}.ts`
4. Export tool definition + handler, add to `src/tools/registry.ts`
5. Follow existing patterns (Zod input schema, apiClient calls, JSON API format). Errors: let them
   out and end the handler with `catch (error) { throw toMcpError(error); }` -- do not hand-roll a
   `new McpError(...)` mapping. The resource-management tools call `rethrowToolError`
   (`src/tools/tool-helpers.ts`) instead: it rewrites two booking-specific API messages into
   something a caller can act on and hands everything else to `toMcpError`. That is a wrapper, not
   an exception to the rule -- rolling the status mapping by hand again is exactly the bug that
   wrapper fixed
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
| `idempotentHint`  | `false` for creates (each call makes another object) and for `update_page` (its `append: true` mode writes again), `true` for every other write                                          |
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
nothing that talks to Productive. `tests/global-setup.ts` warns on stderr in that case (suppressed under
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
- **Page hierarchy: one sweep, not one request per level**: a page's place in a Doc is carried by two attributes, `parent_page_id` (its direct parent) and `root_page_id` (the top-level Doc). Both are also filter keys, and both were measured against the sandbox rather than taken from the spec — a documented filter can be inert (see `filter[booking_type]`). What holds: `filter[root_page_id]=<doc>` returns **every** page in that Doc at **any** depth, because a grandchild still names the top Doc and not its parent (verified with a three-level fixture); it does **not** return the Doc itself, whose own `root_page_id` is null. `filter[parent_page_id]` returns direct children and accepts comma-separated lists. That is why `list_page_children` (`src/tools/page-children.ts`) sweeps a whole Doc once and builds the tree from the `parent_page_id` links in `src/api/pages-tree.ts` — depth costs no extra requests. `tests/integration/pages-hierarchy.integration.test.ts` pins the grandchild behaviour, since losing it would silently truncate every tree below level two.
- **`sort=position` is rejected on `/pages`**: HTTP **400**, `sort_param_unsupported`, "Sort by 'position' is not supported on this endpoint" -- even though `position` is a real attribute. Siblings therefore have to be ordered client-side, and `position` comes back `null` on every page in both live orgs, so the title fallback is the normal case rather than the edge one.
- **A page's `version_number` is null until its body is edited**: a page created through `pages/create_with_markdown` reports `version_number: null` — in the collection response _and_ in the single GET, so it is not an artefact of a sparse fieldset. It becomes a number only after a real body write (`replace_body_with_markdown`/`append_markdown`). Anything treating "no version" as "version 1" is wrong. Note also that adding a child page bumps the parent's `edited_at` but **not** its `version_number`, so version is the reliable signal for a body change and `edited_at` is not.
- **Listing pages ships every body unless you narrow the fields — and the sparse fieldset only works on the collection**: `GET /pages` returns `body` (a whole document-format JSON document) for every row, so pass `fields[pages]=title,parent_page_id,...` whenever listing more than a handful. That is what `listPages`' `fields` param does, and why `list_page_children`'s sweep does not move megabytes to render a list of titles. **`GET /pages/{id}` ignores the same parameter**: all 18 attributes including `body` come back regardless, with or without `include`, and it answers 200 either way (measured against the sandbox). Same lesson as the filter bullets above — an accepted parameter is not an effective one, and here the same key is honoured on one endpoint and silently dropped on the other. `getPage` therefore deliberately offers no `fields` argument; adding one would promise an optimisation it cannot deliver.
- **Page bodies are documents, not text**: `pages.body` holds a Productive Document Format document (`{"type":"doc","content":[...]}`). Sending a plain string returns **HTTP 500**, not a validation error. Create via `pages/create_with_markdown` (with `project_id` as an _attribute_, and only on root pages) and write the body via `pages/{id}/replace_body_with_markdown` or `/append_markdown`, both of which take a **flat** `{"markdown": "..."}` payload without the JSON:API envelope. See `docs/api-spec/guides/document-format.md`.
- **Custom field value shapes**: a `custom_fields` entry's value shape depends on the field's data type — an array of option ID strings for dropdown/multi-select fields, an ISO date string for date fields, or the raw value for text/number/checkbox fields. The official spec documents the `custom_fields`/`custom_field_options` attributes (the type attribute is `data_type_id`, **not** `field_type`), but not which enum value means which type, and `resource_*.custom_fields` is only `type: object` — so the value shape per field type is still only confirmed by a live API test.
- **New tool, new toolset entry**: added a tool to `registry.ts` without adding its name to `src/tools/toolsets.ts`? It silently disappears for any deployment with a restrictive `PRODUCTIVE_TOOLSETS` set (still works when unset, since that means "no filtering"). `tests/unit/toolsets.test.ts` has a completeness check that catches this at test time, not just in production.
- **`filter[...]` keys can differ from the matching response attribute name**: Productive rejects unrecognized filter keys with "Filter 'x' is not supported on this endpoint" (on a 400 or a 422 — see the next bullet). Confirmed traps: person `is_active` attribute → filter is `filter[status]` (1: active/2: deactivated); deal `budget_type` attribute → filter is `filter[type]` (1: deal/2: budget); deal open/closed → `filter[budget_status]` (not `filter[status]`, which means something unrelated — `status_id`, a pipeline-stage relationship); time entry `approved`/`rejected`/`submitted` attributes → not filterable directly (422 live) — the real filter is `filter[status]` (undocumented enum `1`-`6`; live-confirmed against the sandbox: `1`=approved, `2`=no decision yet, `3`-`6` unconfirmed, no matching rows existed to verify — `list_time_entries`' `approved` boolean param maps `true`→`filter[status]=1` and `false`→`filter[status][not_eq]=1` to stay correct regardless of what the unconfirmed codes turn out to mean). Verify against the `x-filters` block in `docs/api-spec/resources/{resource}.yaml` before adding a new filter to `client.ts` — don't assume the attribute name is the filter name. `npm run spec:impact` checks every `filter[...]` key in `client.ts` against that list and fails on an unknown one.
- **An unknown filter's status is not something to branch on**: `docs/api-spec/guides/filtering.md` documents 400, and both statuses have been seen live for the same class of failure — an earlier run got **422**, a later probe against the sandbox got **400** whose body then said `"code": "unsupported_filter"` with `"status": "unprocessable_content"` (the JSON:API status contradicting the HTTP line). What stayed constant across every observation is the message, `Filter 'x' is not supported on this endpoint` — match on that, not on the status code.
- **A documented filter can be accepted and still do nothing**: `filter[booking_type]` is in `x-filters` for `/bookings`, answers HTTP 200, and ignores every value — plain or in `[eq]` form, each one returns the unfiltered set (verified live). A 200 therefore proves only that the key passed the whitelist, never that it filtered: check a new filter against a count you did yourself, not against the absence of an error. Two more findings from the same probe: `filter[person_id]` and `filter[event_id]` accept comma-separated lists (`a,b` returns exactly the union), and `filter[event_id][not_eq]` matches only inside the bookings that _have_ an event, so negating every event id answers 0 rows rather than "all the project bookings". The probe is `tests/integration/bookings-filters.integration.test.ts`.
- **An event has to be archived before it can be deleted**: `DELETE /api/v2/events/{id}` answers `409 record_not_archived` while the absence type is still active. `PATCH /api/v2/events/{id}/archive` first, then the same DELETE returns 204. This bites integration tests hardest — a cleanup path that only deletes leaves its fixture behind in the org (it did), so archive-then-delete in `afterAll`.
- **Tool-level tests don't catch wrong `filter[...]` keys**: tests like `tests/unit/people.test.ts` typically assert only on the params passed into a _mocked_ `client.ts` method, not the actual request URL — the bug above shipped invisibly for exactly this reason. When you touch filter-building code in `client.ts`, add/extend a `client-*.test.ts` test (pattern: `tests/unit/client-boards.test.ts`, `client-filters.test.ts`) that stubs `global.fetch` and asserts on the real query string.

- **Some breaking changes are announced only by email**: the 422 error `code` switches from `invalid_attribute` to `invalid_attribute_value` on **2026-09-15** (opt in early with the `X-Feature-Flags: invalidAttributeValueCode` header). We are not affected -- `makeRequest` reads `detail || title` and never branches on `code` -- but note that this never appeared in the public changelog, so the weekly spec sync could not have caught it. Watch the Productive emails for this class of change.

- **Never branch on the error `code`, branch on the HTTP status**: `src/utils/errors.ts` maps Productive failures onto MCP error codes using `ProductiveApiError.httpStatus` only. The JSON:API `code` field appears in neither the OpenAPI spec nor any guide, and its 422 values change on 2026-09-15 (see above) -- reading the status keeps us out of that. Caller-fault statuses are `400/404/409/422`; `409` is in the set because `pin_comment`, `unpin_comment`, `reject_time_entry` and `unreject_time_entry` hit endpoints where the spec documents it, and "already pinned" is a caller problem, not a server one.

- **`spec:impact` fails silently if you reshape `makeRequest`**: `scripts/lib/client-usage.ts` walks the AST looking for `this.makeRequest(path, options)` -- exact method name, `this` receiver, path as argument 0, HTTP method from a string literal in argument 1. Rename it, or move to an options object, and the analyzer finds **zero** calls and `npm run spec:impact` exits **0 having checked nothing**. `tests/unit/client-usage.test.ts` pins a floor (`usages.length >= 75`) so that shows up as a red test instead. Note the standing blind spot: the ~20 `this.makeVoidRequest` calls and the raw `fetch` in `repositionTask` are not analysed at all.

- **There is no API route to an invoice PDF, and there cannot be one**: the PDF is rendered on demand, never stored. Productive's own [E-Invoicing FAQ](https://help.productive.io/en/articles/13334696-e-invoicing-faq) calls it a "Downloadable PDF: Generated for records or sharing". Everything that looks like a way in is a dead end, all four verified live against the sandbox (org 43059): (a) **no endpoint returns a PDF** -- all 390 paths in `productive-openapi.yaml` grepped for `application/pdf`, the only hit is the description of `attachment.content_type`; `Accept: application/pdf` on `invoices/{id}` is ignored and still answers JSON:API. (b) The `attachment` **relationship is empty on every invoice** -- all 86 sandbox invoices fetched with `?include=attachment` returned `{"data": null}`, finalized/sent/paid ones included (e.g. 830456, `finalized_on` 2025-04-06, `paid_on` 2025-06-20). Finalizing does **not** generate it. (c) `invoices/{id}/preview` is a line-item **simulation**, not a document preview -- it 422s with `data/attributes/budget_ids: can't be blank`. (d) The exporter URL from `buildPdfUrl` (`src/tools/invoice-actions.ts`) answers `401 "Invalid request: authentication failed"` with **and** without the PAT; it needs a browser session cookie, exactly as `get_invoice_pdf_url`'s description already says. The only programmatic path to the bytes is `PATCH invoices/{id}/send`, which renders the PDF and mails it as an attachment -- but that endpoint takes **no request body**, so the recipient is not selectable (it comes from the document template or the previous invoice to that client) and calling it mails a real client. `send_einvoice` is not an alternative: it emits XML (XRechnung/KSeF/PEPPOL, `format_id` 1/3/4/5), and the file itself is again only downloadable from the UI. Do not build a tool that scrapes a session cookie to drive the exporter URL -- undocumented, and it breaks whenever Productive touches its login.

- **Attachment `url`/`temp_url` are not fetchable with a PAT, and `temp_url` is an upload field**: `docs/api-spec/guides/working-with-attachments.md` documents downloads as `GET https://files.productive.io/...?token=<API token>`, but that did not work in any form tested -- 4 attachments (`attachable_type` `expense` and `task`) x 5 auth variants (`?token=`, `?auth_token=`, `?api_token=`, `X-Auth-Token` header, header + `X-Organization-Id`) all answered **302 to `app.productive.io/public/login`** and a 16 KB HTML login page. A nonexistent path answers 404, so the host resolves the file and then refuses to serve it. Unresolved: the file host is `files.productive.io` (production) even for sandbox records, and only a sandbox PAT was available -- "valid token behaves like a bogus one" may just mean production does not know sandbox tokens. Settling it needs the same test with a production PAT; note that it would still not help for invoices, which have no attachment row at all. Separately, the OpenAPI description of `temp_url` ("temporary pre-signed URL for accessing the file") is **wrong**: the guide's own upload flow has the client PATCH the S3 `Location` into `temp_url` after a direct upload, so it is write-side plumbing. Live it was byte-identical to `url`.

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
