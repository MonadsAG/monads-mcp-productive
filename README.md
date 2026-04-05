# Productive.io Remote MCP Server

A **remote MCP server** for [Productive.io](https://productive.io) running on **Cloudflare Workers**. Connects Claude Desktop, Claude Code, and other MCP-compatible clients to your Productive.io workspace — no local installation, no API keys on client machines.

## Highlights

- **Remote-first** — runs on Cloudflare Workers, clients connect via URL
- **Microsoft Entra ID** — OAuth 2.1 with your organization's identity provider (SSO + MFA)
- **Auto user resolution** — maps Entra email to Productive user ID automatically
- **70+ tools** — projects, tasks, time tracking, invoicing, comments, pages, and more
- **Zero client setup** — just add one URL to Claude Desktop or Claude Code

## Quick Start

If someone in your organization has already deployed this server, you only need to configure your MCP client:

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "productive": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-worker>.<your-subdomain>.workers.dev/mcp"]
    }
  }
}
```

Restart Claude Desktop. A browser window opens for Entra ID login on first connect. The session persists — you only sign in once.

### Claude Code

```bash
claude mcp add productive -- npx -y mcp-remote https://<your-worker>.<your-subdomain>.workers.dev/mcp
```

## Deploy Your Own

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers (free tier works)
- [Microsoft Entra ID](https://entra.microsoft.com) tenant with App Registration rights
- Node.js 18+ and npm

### 1. Clone and install

```bash
git clone https://github.com/MonadsAG/monads-mcp-productive.git
cd monads-mcp-productive
npm install
```

### 2. Create Cloudflare KV namespaces

```bash
npx wrangler login
npx wrangler kv namespace create "OAUTH_KV"
npx wrangler kv namespace create "USER_MAPPING_KV"
```

Copy the namespace IDs into `wrangler.jsonc`.

### 3. Register an Entra ID application

```bash
# Login to your Entra tenant
az login --tenant <your-tenant-id> --allow-no-subscriptions

# Create the app registration (single tenant)
az ad app create \
  --display-name "Productive MCP" \
  --sign-in-audience "AzureADMyOrg" \
  --web-redirect-uris "https://<your-worker>.<your-subdomain>.workers.dev/callback"

# Note the appId from the output, then add API permissions
az ad app permission add \
  --id <app-id> \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions \
    37f7f235-527c-4136-accd-4a02d197296e=Scope \
    14dad69e-099b-42c9-810b-d002981feec1=Scope \
    64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0=Scope \
    e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope

# Grant admin consent
az ad app permission admin-consent --id <app-id>

# Generate a client secret (2-year expiry)
az ad app credential reset \
  --id <app-id> \
  --append \
  --display-name "Cloudflare Worker" \
  --years 2
```

The permission IDs correspond to: `openid`, `profile`, `email`, `User.Read` (delegated).

### 4. Set Cloudflare secrets

```bash
npx wrangler secret put PRODUCTIVE_API_TOKEN     # from Productive.io Settings → API integrations
npx wrangler secret put PRODUCTIVE_ORG_ID         # your org ID with slug (e.g. 12345-company-name)
npx wrangler secret put PRODUCTIVE_API_BASE_URL   # https://api.productive.io/api/v2/ (or sandbox URL)
npx wrangler secret put ENTRA_CLIENT_ID           # app (client) ID from step 3
npx wrangler secret put ENTRA_CLIENT_SECRET       # client secret from step 3
npx wrangler secret put ENTRA_TENANT_ID           # your Entra directory (tenant) ID
openssl rand -hex 32 | npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

### 5. Deploy

```bash
npm run worker:deploy
```

### 6. Connect

Configure Claude Desktop or Claude Code as shown in [Quick Start](#quick-start), replacing the placeholder URL with your Worker URL.

## Architecture

```
┌─────────────────┐    Streamable HTTP    ┌──────────────────────────────┐
│  Claude Desktop  │ ◄──────────────────► │  Cloudflare Worker           │
│  / Claude Code   │                      │                              │
│  (via mcp-remote)│                      │  OAuthProvider (OAuth 2.1)   │
└─────────────────┘                       │       ↓                      │
                                          │  Entra ID (OIDC login)       │
       Browser ←── login redirect ───────→│       ↓                      │
                                          │  McpAgent (Durable Object)   │
                                          │       ↓                      │
                                          │  ProductiveAPIClient         │
                                          └──────────────┬───────────────┘
                                                         ↓
                                                  Productive.io API
```

## Available Tools

### Company & Project

| Tool             | Description                         |
| ---------------- | ----------------------------------- |
| `whoami`         | Get current user context            |
| `list_companies` | List companies/customers            |
| `list_projects`  | List projects with status filtering |

### Folders, Boards & Task Lists

| Tool                                                                                                     | Description          |
| -------------------------------------------------------------------------------------------------------- | -------------------- |
| `list_folders` / `get_folder` / `create_folder` / `update_folder`                                        | Folder CRUD          |
| `archive_folder` / `restore_folder`                                                                      | Folder lifecycle     |
| `list_boards` / `create_board`                                                                           | Board management     |
| `list_task_lists` / `create_task_list` / `get_task_list` / `update_task_list`                            | Task list CRUD       |
| `archive_task_list` / `restore_task_list` / `copy_task_list` / `move_task_list` / `reposition_task_list` | Task list operations |

### Tasks

| Tool                                                                           | Description        |
| ------------------------------------------------------------------------------ | ------------------ |
| `list_tasks` / `get_task` / `get_project_tasks` / `my_tasks`                   | Query tasks        |
| `create_task` / `update_task_details` / `delete_task`                          | Task CRUD          |
| `update_task_assignment` / `update_task_status` / `update_task_sprint`         | Task state changes |
| `move_task_to_list` / `add_to_backlog` / `reposition_task`                     | Task positioning   |
| `list_subtasks` / `create_subtask`                                             | Subtask management |
| `list_task_dependencies` / `create_task_dependency` / `delete_task_dependency` | Dependencies       |

### Comments & Todos

| Tool                                                                                       | Description     |
| ------------------------------------------------------------------------------------------ | --------------- |
| `add_task_comment` / `list_comments` / `get_comment` / `update_comment` / `delete_comment` | Comment CRUD    |
| `pin_comment` / `unpin_comment` / `add_comment_reaction`                                   | Comment actions |
| `list_todos` / `get_todo` / `create_todo` / `update_todo` / `delete_todo`                  | Todo management |

### Pages & Documents

| Tool                                                                      | Description     |
| ------------------------------------------------------------------------- | --------------- |
| `list_pages` / `get_page` / `create_page` / `update_page` / `delete_page` | Page CRUD       |
| `move_page` / `copy_page`                                                 | Page operations |

### Time Tracking

| Tool                                                                                        | Description             |
| ------------------------------------------------------------------------------------------- | ----------------------- |
| `list_time_entries` / `create_time_entry` / `update_time_entry`                             | Time entry CRUD         |
| `approve_time_entry` / `unapprove_time_entry` / `reject_time_entry` / `unreject_time_entry` | Approval workflow       |
| `start_timer` / `stop_timer` / `get_timer`                                                  | Real-time timers        |
| `list_services` / `get_project_services` / `list_project_deals` / `list_deal_services`      | Budget & service lookup |

### Invoicing

| Tool                                                                                      | Description      |
| ----------------------------------------------------------------------------------------- | ---------------- |
| `list_invoices` / `get_invoice` / `create_invoice` / `update_invoice` / `delete_invoice`  | Invoice CRUD     |
| `list_company_budgets` / `generate_line_items` / `finalize_invoice` / `mark_invoice_paid` | Invoice workflow |
| `get_invoice_pdf_url` / `get_timesheet_report_url`                                        | Document URLs    |

### Activity & Workflow

| Tool                     | Description                  |
| ------------------------ | ---------------------------- |
| `list_activities`        | List activities with filters |
| `get_recent_updates`     | Get recent updates           |
| `list_workflow_statuses` | List workflow statuses       |

## Common Workflows

### Time Entry

Follow the hierarchy: Project → Deal/Budget → Service → Time Entry.

```
list_projects → list_project_deals → list_deal_services → create_time_entry
```

### Task Status Update

Update by name — no ID lookup needed:

```json
{ "task_id": "123", "status_name": "In Progress" }
```

### Invoice

```
list_companies → list_company_budgets → create_invoice → generate_line_items → finalize_invoice → mark_invoice_paid
```

## Development

```bash
npm run worker:dev     # local dev on port 8788 (requires .dev.vars with secrets)
npm run worker:deploy  # deploy to Cloudflare
npm run build          # compile TypeScript (for local stdio fallback)
npm run format         # prettier
```

Create a `.dev.vars` file (gitignored) with the same variables as the Cloudflare secrets for local development.

## License

[Apache 2.0](LICENSE)

Originally based on [productive-mcp](https://github.com/berwickgeek/productive-mcp) by [jayat3dn](https://github.com/berwickgeek) (ISC). See [NOTICE](NOTICE) for attribution details.

---

Maintained by [Monads AG](https://monads.ch)
