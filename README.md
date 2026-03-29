# Productive.io MCP Server

[![npm version](https://badge.fury.io/js/productive-mcp.svg)](https://www.npmjs.com/package/productive-mcp)

An MCP (Model Context Protocol) server that enables Claude Desktop, Claude Code, and other MCP-compatible clients to interact with the Productive.io API.

## Features

- **Companies & Projects**: List companies and projects with status filtering
- **Task Management**: List, create, and get individual tasks with various filters
- **Task Operations**: Add comments to tasks and update task status via workflow statuses
- **Board & Task List Management**: Create and manage boards and task lists within projects
- **People Management**: List people in your organization with filtering options
- **Workflow Management**: List and work with workflow statuses for proper task status updates
- **User Context**: Supports "me" references when PRODUCTIVE_USER_ID is configured
- **Activity Tracking**: View activities and recent updates across your organization

## Installation

### Via npm (Recommended)

Install globally:
```bash
npm install -g productive-mcp
```

Or run directly with npx (no installation required):
```bash
npx productive-mcp
```

### From Source

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Configuration

### Getting Your Credentials

To obtain your Productive.io credentials:
1. Log in to Productive.io
2. Go to Settings → API integrations
3. Generate a new token (choose read-only for safety, or full access for task creation)
4. Copy the token and organization ID

To find your user ID:
- You can use the API to list people and find your ID
- Or check the URL when viewing your profile in Productive.io

### Environment Variables

The server requires the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `PRODUCTIVE_API_TOKEN` | Yes | Your Productive.io API token |
| `PRODUCTIVE_ORG_ID` | Yes | Your organization ID |
| `PRODUCTIVE_USER_ID` | No | Your user ID (required for `my_tasks` tool) |

## Usage with Claude Desktop

Add the server to your Claude Desktop configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Using npx (Recommended)

```json
{
  "mcpServers": {
    "productive": {
      "command": "npx",
      "args": ["-y", "productive-mcp"],
      "env": {
        "PRODUCTIVE_API_TOKEN": "your_api_token_here",
        "PRODUCTIVE_ORG_ID": "your_organization_id_here",
        "PRODUCTIVE_USER_ID": "your_user_id_here"
      }
    }
  }
}
```

### Using Global Installation

```json
{
  "mcpServers": {
    "productive": {
      "command": "productive-mcp",
      "env": {
        "PRODUCTIVE_API_TOKEN": "your_api_token_here",
        "PRODUCTIVE_ORG_ID": "your_organization_id_here",
        "PRODUCTIVE_USER_ID": "your_user_id_here"
      }
    }
  }
}
```

### Using Local Build

```json
{
  "mcpServers": {
    "productive": {
      "command": "node",
      "args": ["/path/to/productive-mcp/build/index.js"],
      "env": {
        "PRODUCTIVE_API_TOKEN": "your_api_token_here",
        "PRODUCTIVE_ORG_ID": "your_organization_id_here",
        "PRODUCTIVE_USER_ID": "your_user_id_here"
      }
    }
  }
}
```

**Note**: `PRODUCTIVE_USER_ID` is optional but required for the `my_tasks` tool to work.

After adding the configuration, restart Claude Desktop.

## Usage with Claude Code

Add the server to your Claude Code configuration using the CLI:

```bash
claude mcp add productive -- npx -y productive-mcp
```

Then set your environment variables. You can either:

**Option 1**: Add to your shell profile (`~/.zshrc` or `~/.bashrc`):
```bash
export PRODUCTIVE_API_TOKEN="your_api_token_here"
export PRODUCTIVE_ORG_ID="your_organization_id_here"
export PRODUCTIVE_USER_ID="your_user_id_here"
```

**Option 2**: Create a wrapper script and add it as an MCP server:

1. Create a script file (e.g., `~/scripts/productive-mcp.sh`):
   ```bash
   #!/bin/bash
   export PRODUCTIVE_API_TOKEN="your_api_token_here"
   export PRODUCTIVE_ORG_ID="your_organization_id_here"
   export PRODUCTIVE_USER_ID="your_user_id_here"
   npx -y productive-mcp
   ```

2. Make it executable:
   ```bash
   chmod +x ~/scripts/productive-mcp.sh
   ```

3. Add to Claude Code:
   ```bash
   claude mcp add productive ~/scripts/productive-mcp.sh
   ```

**Option 3**: Edit the Claude Code settings file directly at `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "productive": {
      "command": "npx",
      "args": ["-y", "productive-mcp"],
      "env": {
        "PRODUCTIVE_API_TOKEN": "your_api_token_here",
        "PRODUCTIVE_ORG_ID": "your_organization_id_here",
        "PRODUCTIVE_USER_ID": "your_user_id_here"
      }
    }
  }
}
```

Restart Claude Code after configuration.

## Available Tools

### User & Context Tools

#### whoami
Get the current user context and check which user ID is configured for "me" operations.

### Company & Project Tools

#### list_companies
Get a list of companies/customers from Productive.io

Parameters:
- `status` (optional): Filter by company status ('active' or 'archived')
- `limit` (optional): Number of companies to return (1-200, default: 30)

#### list_projects
Get a list of projects from Productive.io

Parameters:
- `status` (optional): Filter by project status ('active' or 'archived')
- `company_id` (optional): Filter projects by company ID
- `limit` (optional): Number of projects to return (1-200, default: 30)

### Board & Task List Tools

#### list_boards
Get a list of boards from projects

Parameters:
- `project_id` (optional): Filter boards by project ID
- `limit` (optional): Number of boards to return (max 200, default: 30)

#### create_board
Create a new board in a Productive.io project

Parameters:
- `project_id` (required): The ID of the project to create the board in
- `name` (required): Name of the board
- `description` (optional): Description of the board

#### list_task_lists
Get a list of task lists from boards

Parameters:
- `board_id` (optional): Filter task lists by board ID
- `limit` (optional): Number of task lists to return (max 200, default: 30)

#### create_task_list
Create a new task list in a board

Parameters:
- `board_id` (required): The ID of the board to create the task list in
- `project_id` (required): The ID of the project
- `name` (required): Name of the task list
- `description` (optional): Description of the task list

### Task Management Tools

#### list_tasks
Get a list of tasks from Productive.io

Parameters:
- `project_id` (optional): Filter tasks by project ID
- `assignee_id` (optional): Filter tasks by assignee ID
- `status` (optional): Filter by task status ('open' or 'closed')
- `limit` (optional): Number of tasks to return (1-200, default: 30)

#### get_project_tasks
Get all tasks for a specific project

Parameters:
- `project_id` (required): The ID of the project
- `status` (optional): Filter by task status ('open' or 'closed')

#### get_task
Get detailed information about a specific task

Parameters:
- `task_id` (required): The ID of the task to retrieve

#### create_task
Create a new task in Productive.io

Parameters:
- `title` (required): Task title
- `description` (optional): Task description
- `project_id` (optional): ID of the project to add the task to
- `board_id` (optional): ID of the board to add the task to
- `task_list_id` (optional): ID of the task list to add the task to
- `assignee_id` (optional): ID of the person to assign (use "me" for configured user)
- `due_date` (optional): Due date in YYYY-MM-DD format
- `status` (optional): Task status ('open' or 'closed', default: 'open')

#### update_task_assignment
Update the assignee of an existing task

Parameters:
- `task_id` (required): ID of the task to update
- `assignee_id` (required): ID of the person to assign (use "me" for configured user, "null" to unassign)

#### my_tasks
Get tasks assigned to you (requires PRODUCTIVE_USER_ID to be configured)

Parameters:
- `status` (optional): Filter by task status ('open' or 'closed')
- `limit` (optional): Number of tasks to return (1-200, default: 30)

### Task Operations Tools

#### add_task_comment
Add a comment to a task

Parameters:
- `task_id` (required): ID of the task to add the comment to
- `comment` (required): Text content of the comment

#### update_task_status
Update the status of a task using workflow status ID

Parameters:
- `task_id` (required): ID of the task to update
- `workflow_status_id` (required): ID of the workflow status to set

#### list_workflow_statuses
List workflow statuses available in Productive.io (used for task status updates)

Parameters:
- `workflow_id` (optional): Filter by workflow ID
- `category_id` (optional): Filter by category (1=Not Started, 2=Started, 3=Closed)
- `limit` (optional): Number of statuses to return (1-200, default: 50)

### People Management Tools

#### list_people
List people in the organization with optional filters

Parameters:
- `company_id` (optional): Filter people by company ID
- `project_id` (optional): Filter people assigned to a specific project
- `is_active` (optional): Filter by active status
- `email` (optional): Filter by email address
- `limit` (optional): Maximum number of people to return (default: 50, max: 100)
- `page` (optional): Page number for pagination (default: 1)

#### get_project_people
Get all people assigned to a specific project

Parameters:
- `project_id` (required): The project ID to get people for
- `is_active` (optional): Filter by active status (default: true)
- `limit` (optional): Maximum number of people to return (default: 50, max: 100)
- `page` (optional): Page number for pagination (default: 1)

### Time Management Tools

Time entries track work performed against projects and services. Each entry belongs to a person, a service (within a deal/budget), and optionally a task. Time entries follow an approval workflow: they can be approved, unapproved, rejected (with a reason), or unrejected. To create a time entry, you need to follow the hierarchy: Project -> Deal/Budget -> Service -> Time Entry.

#### list_time_entries
View existing time entries with detailed information including service and budget relationships.

Parameters:
- `date` (optional): Filter by specific date (YYYY-MM-DD format)
- `after` (optional): Filter entries after this date (YYYY-MM-DD format)
- `before` (optional): Filter entries before this date (YYYY-MM-DD format)
- `person_id` (optional): Filter by person ID (use "me" if PRODUCTIVE_USER_ID is configured)
- `project_id` (optional): Filter by project ID
- `task_id` (optional): Filter by task ID
- `service_id` (optional): Filter by service ID
- `limit` (optional): Number of time entries to return (1-200, default: 30)

#### create_time_entry
Create a time entry with detailed work description. Requires confirmation before creating.

Parameters:
- `date` (required): Date for the time entry ("today", "yesterday", or YYYY-MM-DD)
- `time` (required): Time duration ("2h", "120m", "2.5h", or "2.5")
- `person_id` (required): ID of the person logging time (use "me" if configured)
- `service_id` (required): ID of the service being performed
- `note` (required): Detailed description of work performed (minimum 10 characters)
- `task_id` (optional): ID of the task being worked on
- `billable_time` (optional): Billable time duration, same formats as time
- `confirm` (optional): Set to true to confirm and create the entry

#### update_time_entry
Update an existing time entry. All fields except time_entry_id are optional — only provided fields will be updated.

Parameters:
- `time_entry_id` (required): ID of the time entry to update
- `date` (optional): New date ("today", "yesterday", or YYYY-MM-DD)
- `time` (optional): New time duration ("2h", "120m", "2.5h", or "2.5")
- `billable_time` (optional): New billable time duration
- `note` (optional): Updated work description

#### approve_time_entry
Approve a time entry.

Parameters:
- `time_entry_id` (required): ID of the time entry to approve

#### unapprove_time_entry
Reverse approval of a time entry.

Parameters:
- `time_entry_id` (required): ID of the time entry to unapprove

#### reject_time_entry
Reject a time entry with an optional reason.

Parameters:
- `time_entry_id` (required): ID of the time entry to reject
- `rejected_reason` (optional): Reason for rejecting the time entry

#### unreject_time_entry
Reverse rejection of a time entry.

Parameters:
- `time_entry_id` (required): ID of the time entry to unreject

### Budget & Service Tools

#### list_project_deals
Get deals/budgets for a specific project. Step 2 of the timesheet workflow.

Parameters:
- `project_id` (required): The ID of the project
- `budget_type` (optional): Filter by budget type (1 = deal, 2 = budget)
- `limit` (optional): Number of deals/budgets to return (1-200, default: 30)

#### list_deal_services
Get services for a specific deal/budget. Step 3 of the timesheet workflow.

Parameters:
- `deal_id` (required): The ID of the deal/budget
- `limit` (optional): Number of services to return (1-200, default: 30)

#### list_services
List all services in the organization.

Parameters:
- `company_id` (optional): Filter services by company ID
- `limit` (optional): Number of services to return (1-200, default: 30)

#### start_timer
Start a new timer for real-time time tracking. Provide either a service_id (creates a new time entry automatically) or a time_entry_id (attaches to an existing time entry).

Parameters:
- `service_id` (optional): Service ID to track time against (required if no time_entry_id)
- `time_entry_id` (optional): Existing time entry ID to attach timer to (required if no service_id)

#### stop_timer
Stop a running timer. The tracked time will be added to the associated time entry.

Parameters:
- `timer_id` (required): ID of the timer to stop

#### get_timer
Get a timer's current status to check if it is still running.

Parameters:
- `timer_id` (required): ID of the timer to check

### Activity & Updates Tools

#### list_activities
List activities and changes across your organization

Parameters:
- `task_id` (optional): Filter activities by task ID
- `project_id` (optional): Filter activities by project ID
- `person_id` (optional): Filter activities by person ID
- `item_type` (optional): Filter by item type
- `event` (optional): Filter by event type
- `after` (optional): Filter activities after this date (ISO 8601 format)
- `before` (optional): Filter activities before this date (ISO 8601 format)
- `limit` (optional): Number of activities to return
- `page` (optional): Page number for pagination

#### get_recent_updates
Get recent updates and activities in a summarized format

Parameters:
- `limit` (optional): Number of recent updates to return (default: 20)
- `hours` (optional): Number of hours to look back (default: 24)

## Common Workflows

### Creating a Time Entry

To create a time entry, follow the hierarchy: Project -> Deal/Budget -> Service -> Time Entry.

1. **Find the project**: `list_projects`
2. **Get deals/budgets**: `list_project_deals { "project_id": "..." }`
3. **Get services**: `list_deal_services { "deal_id": "..." }`
4. **Optionally find a task**: `get_project_tasks { "project_id": "..." }`
5. **Create the entry**:
   ```
   create_time_entry {
     "date": "today",
     "time": "2h",
     "person_id": "me",
     "service_id": "...",
     "task_id": "...",
     "note": "Implemented feature X with unit tests"
   }
   ```

### Managing Time Entry Approvals

```
approve_time_entry { "time_entry_id": "123" }
unapprove_time_entry { "time_entry_id": "123" }
reject_time_entry { "time_entry_id": "123", "rejected_reason": "Wrong project" }
unreject_time_entry { "time_entry_id": "123" }
```

### Updating Task Status

To update a task's status, you need to use workflow status IDs rather than simple "open"/"closed" values:

1. **First, list available workflow statuses**:
   ```
   list_workflow_statuses
   ```
   This will show you all available statuses with their IDs and categories (Not Started=1, Started=2, Closed=3).

2. **Then update the task status**:
   ```
   update_task_status {
     "task_id": "12399194",
     "workflow_status_id": "specific_status_id_from_step_1"
   }
   ```

### Working with "me" Context

When `PRODUCTIVE_USER_ID` is configured, you can use "me" in several tools:
- `create_task` with `"assignee_id": "me"`
- `update_task_assignment` with `"assignee_id": "me"`
- `list_time_entries` with `"person_id": "me"`
- `create_time_entry` with `"person_id": "me"`
- `my_tasks` to get your assigned tasks
- `whoami` to verify your configured user context

### Creating Complete Task Workflows

1. **Create a board**: `create_board`
2. **Create task lists**: `create_task_list`
3. **Create tasks**: `create_task` 
4. **Add comments**: `add_task_comment`
5. **Update status**: Use `list_workflow_statuses` then `update_task_status`
6. **Track progress**: Use `list_activities` or `get_recent_updates`

## Development

- Run in development mode: `npm run dev`
- Build: `npm run build`
- Start built server: `npm start`

## License

ISC