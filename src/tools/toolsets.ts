/**
 * Toolsets group the server's tools into domains so a deployment can enable
 * only a subset via PRODUCTIVE_TOOLSETS (see config/worker-config.ts,
 * config/index.ts). Adding a new tool to registry.ts? Add its name here too --
 * tests/unit/toolsets.test.ts asserts every tool in getToolDefinitions()
 * belongs to exactly one toolset.
 */
export const TOOLSETS: Record<string, string[]> = {
  core: [
    'whoami',
    'list_companies',
    'list_projects',
    'list_workflow_statuses',
    'list_activities',
    'get_recent_updates',
  ],
  tasks: [
    'list_boards',
    'create_board',
    'list_task_lists',
    'create_task_list',
    'get_task_list',
    'update_task_list',
    'archive_task_list',
    'restore_task_list',
    'copy_task_list',
    'move_task_list',
    'reposition_task_list',
    'list_tasks',
    'get_project_tasks',
    'get_task',
    'create_task',
    'update_task_assignment',
    'update_task_details',
    'update_task_status',
    'my_tasks',
    'move_task_to_list',
    'add_to_backlog',
    'reposition_task',
    'delete_task',
    'list_subtasks',
    'create_subtask',
    'list_task_dependencies',
    'get_task_dependency',
    'create_task_dependency',
    'delete_task_dependency',
  ],
  custom_fields: ['list_custom_fields', 'list_custom_field_options'],
  comments: [
    'add_task_comment',
    'list_comments',
    'get_comment',
    'update_comment',
    'delete_comment',
    'pin_comment',
    'unpin_comment',
    'add_comment_reaction',
  ],
  time_tracking: [
    'list_time_entries',
    'create_time_entry',
    'list_project_deals',
    'list_deal_services',
    'list_services',
    'get_project_services',
    'update_time_entry',
    'approve_time_entry',
    'unapprove_time_entry',
    'reject_time_entry',
    'unreject_time_entry',
    'get_timer',
    'start_timer',
    'stop_timer',
  ],
  invoicing: [
    'list_invoices',
    'list_company_budgets',
    'get_invoice',
    'create_invoice',
    'update_invoice',
    'generate_line_items',
    'finalize_invoice',
    'get_invoice_pdf_url',
    'delete_invoice',
    'get_timesheet_report_url',
    'mark_invoice_paid',
  ],
  docs: [
    'list_folders',
    'get_folder',
    'create_folder',
    'update_folder',
    'archive_folder',
    'restore_folder',
    'list_pages',
    'get_page',
    'create_page',
    'update_page',
    'delete_page',
    'move_page',
    'copy_page',
  ],
  todos: ['list_todos', 'get_todo', 'create_todo', 'update_todo', 'delete_todo'],
};

/**
 * Resolves PRODUCTIVE_TOOLSETS into the set of enabled tool names.
 * Returns null to mean "no filtering -- all tools" (unset, empty, 'all', or
 * every provided name being invalid -- fail open rather than exposing zero tools).
 */
export function getEnabledToolNames(raw: string | undefined): Set<string> | null {
  if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'all') {
    return null;
  }

  const requested = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const enabled = new Set<string>();
  for (const toolset of requested) {
    const names = TOOLSETS[toolset];
    if (!names) {
      console.error(`Unknown toolset "${toolset}" in PRODUCTIVE_TOOLSETS -- ignoring it.`);
      continue;
    }
    names.forEach((name) => enabled.add(name));
  }

  if (enabled.size === 0) {
    console.error('PRODUCTIVE_TOOLSETS contained no valid toolset names -- enabling all tools.');
    return null;
  }

  return enabled;
}

/** Reverse lookup used to give a helpful hint when a disabled tool is called. */
export function findToolsetForName(name: string): string | undefined {
  return Object.entries(TOOLSETS).find(([, names]) => names.includes(name))?.[0];
}
