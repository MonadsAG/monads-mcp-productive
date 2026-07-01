import { z } from 'zod';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ProductiveAPIClient } from '../api/client.js';
import type { Config } from '../config/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { findToolsetForName } from './toolsets.js';

// Tool imports
import { listProjectsTool, listProjectsDefinition } from './projects.js';
import {
  listTasksTool,
  getProjectTasksTool,
  getTaskTool,
  createTaskTool,
  updateTaskAssignmentTool,
  updateTaskDetailsTool,
  deleteTaskTool,
  listTasksDefinition,
  getProjectTasksDefinition,
  getTaskDefinition,
  createTaskDefinition,
  updateTaskAssignmentDefinition,
  updateTaskDetailsDefinition,
  deleteTaskDefinition,
} from './tasks.js';
import { listCompaniesTool, listCompaniesDefinition } from './companies.js';
import {
  listCustomFieldsTool,
  listCustomFieldsDefinition,
  listCustomFieldOptionsTool,
  listCustomFieldOptionsDefinition,
} from './custom-fields.js';
import { myTasksTool, myTasksDefinition } from './my-tasks.js';
import { listBoards, createBoard, listBoardsTool, createBoardTool } from './boards.js';
import {
  listTaskLists,
  createTaskList,
  listTaskListsTool,
  createTaskListTool,
  getTaskList,
  getTaskListDefinition,
  updateTaskList,
  updateTaskListDefinition,
  archiveTaskList,
  archiveTaskListDefinition,
  restoreTaskList,
  restoreTaskListDefinition,
  copyTaskList,
  copyTaskListDefinition,
  moveTaskList,
  moveTaskListDefinition,
  repositionTaskList,
  repositionTaskListDefinition,
} from './task-lists.js';
import { whoAmI, whoAmITool } from './whoami.js';
import { listActivities, listActivitiesTool } from './activities.js';
import { getRecentUpdates, getRecentUpdatesTool } from './recent-updates.js';
import {
  addTaskCommentTool,
  addTaskCommentDefinition,
  listCommentsTool,
  listCommentsDefinition,
  getCommentTool,
  getCommentDefinition,
  updateCommentTool,
  updateCommentDefinition,
  deleteCommentTool,
  deleteCommentDefinition,
  pinCommentTool,
  pinCommentDefinition,
  unpinCommentTool,
  unpinCommentDefinition,
  addCommentReactionTool,
  addCommentReactionDefinition,
} from './comments.js';
import { updateTaskStatusTool, updateTaskStatusDefinition } from './task-status.js';
import { listWorkflowStatusesTool, listWorkflowStatusesDefinition } from './workflow-statuses.js';
import {
  listTimeEntresTool,
  createTimeEntryTool,
  listServicesTool,
  getProjectServicesTool,
  listProjectDealsTool,
  listDealServicesTool,
  listTimeEntriesDefinition,
  createTimeEntryDefinition,
  listServicesDefinition,
  getProjectServicesDefinition,
  listProjectDealsDefinition,
  listDealServicesDefinition,
} from './time-entries.js';
import { updateTimeEntryTool, updateTimeEntryDefinition } from './time-entry-update.js';
import {
  approveTimeEntryTool,
  approveTimeEntryDefinition,
  unapproveTimeEntryTool,
  unapproveTimeEntryDefinition,
  rejectTimeEntryTool,
  rejectTimeEntryDefinition,
  unrejectTimeEntryTool,
  unrejectTimeEntryDefinition,
} from './time-entry-approval.js';
import {
  getTimerTool,
  getTimerDefinition,
  startTimerTool,
  startTimerDefinition,
  stopTimerTool,
  stopTimerDefinition,
} from './timers.js';
import { moveTaskToList, moveTaskToListTool } from './task-list-move.js';
import { addToBacklog, addToBacklogTool } from './task-backlog.js';
import {
  taskRepositionTool,
  taskRepositionDefinition,
  taskRepositionSchema,
} from './task-reposition.js';
import {
  listInvoicesTool,
  listInvoicesDefinition,
  listCompanyBudgetsTool,
  listCompanyBudgetsDefinition,
  getInvoiceTool,
  getInvoiceDefinition,
  createInvoiceTool,
  createInvoiceDefinition,
  updateInvoiceTool,
  updateInvoiceDefinition,
  generateLineItemsTool,
  generateLineItemsDefinition,
} from './invoices.js';
import {
  finalizeInvoiceTool,
  finalizeInvoiceDefinition,
  getInvoicePdfUrlTool,
  getInvoicePdfUrlDefinition,
  deleteInvoiceTool,
  deleteInvoiceDefinition,
  getTimesheetReportUrlTool,
  getTimesheetReportUrlDefinition,
  markInvoicePaidTool,
  markInvoicePaidDefinition,
} from './invoice-actions.js';
import {
  listFolders,
  listFoldersTool,
  getFolder,
  getFolderTool,
  createFolder,
  createFolderTool,
  updateFolder,
  updateFolderTool,
  archiveFolder,
  archiveFolderTool,
  restoreFolder,
  restoreFolderTool,
} from './folders.js';
import {
  listSubtasksTool,
  listSubtasksDefinition,
  createSubtaskTool,
  createSubtaskDefinition,
} from './subtasks.js';
import {
  listTodosTool,
  listTodosDefinition,
  getTodoTool,
  getTodoDefinition,
  createTodoTool,
  createTodoDefinition,
  updateTodoTool,
  updateTodoDefinition,
  deleteTodoTool,
  deleteTodoDefinition,
} from './todos.js';
import {
  listPagesTool,
  listPagesDefinition,
  getPageTool,
  getPageDefinition,
  createPageTool,
  createPageDefinition,
  updatePageTool,
  updatePageDefinition,
  deletePageTool,
  deletePageDefinition,
  movePageTool,
  movePageDefinition,
  copyPageTool,
  copyPageDefinition,
} from './pages.js';
import {
  listTaskDependenciesTool,
  listTaskDependenciesDefinition,
  getTaskDependencyTool,
  getTaskDependencyDefinition,
  createTaskDependencyTool,
  createTaskDependencyDefinition,
  deleteTaskDependencyTool,
  deleteTaskDependencyDefinition,
} from './task-dependencies.js';

/** All tool definitions for ListTools, optionally filtered to an enabled toolset. */
export function getToolDefinitions(enabledToolNames?: Set<string> | null) {
  const all = [
    whoAmITool,
    listCompaniesDefinition,
    listProjectsDefinition,
    listBoardsTool,
    createBoardTool,
    listTaskListsTool,
    createTaskListTool,
    getTaskListDefinition,
    updateTaskListDefinition,
    archiveTaskListDefinition,
    restoreTaskListDefinition,
    copyTaskListDefinition,
    moveTaskListDefinition,
    repositionTaskListDefinition,
    listTasksDefinition,
    getProjectTasksDefinition,
    getTaskDefinition,
    createTaskDefinition,
    updateTaskAssignmentDefinition,
    updateTaskDetailsDefinition,
    addTaskCommentDefinition,
    updateTaskStatusDefinition,
    listWorkflowStatusesDefinition,
    myTasksDefinition,
    listActivitiesTool,
    getRecentUpdatesTool,
    listTimeEntriesDefinition,
    createTimeEntryDefinition,
    listProjectDealsDefinition,
    listDealServicesDefinition,
    listServicesDefinition,
    getProjectServicesDefinition,
    updateTimeEntryDefinition,
    approveTimeEntryDefinition,
    unapproveTimeEntryDefinition,
    rejectTimeEntryDefinition,
    unrejectTimeEntryDefinition,
    getTimerDefinition,
    startTimerDefinition,
    stopTimerDefinition,
    listCustomFieldsDefinition,
    listCustomFieldOptionsDefinition,
    moveTaskToListTool,
    addToBacklogTool,
    taskRepositionDefinition,
    listInvoicesDefinition,
    listCompanyBudgetsDefinition,
    getInvoiceDefinition,
    createInvoiceDefinition,
    updateInvoiceDefinition,
    generateLineItemsDefinition,
    finalizeInvoiceDefinition,
    getInvoicePdfUrlDefinition,
    deleteInvoiceDefinition,
    getTimesheetReportUrlDefinition,
    markInvoicePaidDefinition,
    deleteTaskDefinition,
    listFoldersTool,
    getFolderTool,
    createFolderTool,
    updateFolderTool,
    archiveFolderTool,
    restoreFolderTool,
    listSubtasksDefinition,
    createSubtaskDefinition,
    listCommentsDefinition,
    getCommentDefinition,
    updateCommentDefinition,
    deleteCommentDefinition,
    pinCommentDefinition,
    unpinCommentDefinition,
    addCommentReactionDefinition,
    listTodosDefinition,
    getTodoDefinition,
    createTodoDefinition,
    updateTodoDefinition,
    deleteTodoDefinition,
    listPagesDefinition,
    getPageDefinition,
    createPageDefinition,
    updatePageDefinition,
    deletePageDefinition,
    movePageDefinition,
    copyPageDefinition,
    listTaskDependenciesDefinition,
    getTaskDependencyDefinition,
    createTaskDependencyDefinition,
    deleteTaskDependencyDefinition,
  ];

  if (!enabledToolNames) return all;
  return all.filter((def) => enabledToolNames.has(def.name));
}

/** Route a tool call to its handler */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown> | undefined,
  apiClient: ProductiveAPIClient,
  config: Config,
  enabledToolNames?: Set<string> | null,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  if (enabledToolNames && !enabledToolNames.has(name)) {
    const toolset = findToolsetForName(name);
    throw new Error(
      toolset
        ? `Tool "${name}" is not enabled in this deployment (belongs to the "${toolset}" toolset). Ask your administrator to add "${toolset}" to PRODUCTIVE_TOOLSETS.`
        : `Tool "${name}" is not enabled in this deployment.`,
    );
  }

  switch (name) {
    case 'whoami':
      return await whoAmI(apiClient, args, config);
    case 'list_companies':
      return await listCompaniesTool(apiClient, args);
    case 'list_projects':
      return await listProjectsTool(apiClient, args);
    case 'list_tasks':
      return await listTasksTool(apiClient, args);
    case 'get_project_tasks':
      return await getProjectTasksTool(apiClient, args);
    case 'get_task':
      return await getTaskTool(apiClient, args);
    case 'my_tasks':
      return await myTasksTool(apiClient, config, args);
    case 'list_boards':
      return await listBoards(apiClient, args);
    case 'create_board':
      return await createBoard(apiClient, args);
    case 'create_task':
      return await createTaskTool(apiClient, args, config);
    case 'update_task_assignment':
      return await updateTaskAssignmentTool(apiClient, args, config);
    case 'update_task_details':
      return await updateTaskDetailsTool(apiClient, args);
    case 'add_task_comment':
      return await addTaskCommentTool(apiClient, args);
    case 'update_task_status':
      return await updateTaskStatusTool(apiClient, args);
    case 'list_workflow_statuses':
      return await listWorkflowStatusesTool(apiClient, args);
    case 'list_task_lists':
      return await listTaskLists(apiClient, args);
    case 'create_task_list':
      return await createTaskList(apiClient, args);
    case 'get_task_list':
      return await getTaskList(apiClient, args);
    case 'update_task_list':
      return await updateTaskList(apiClient, args);
    case 'archive_task_list':
      return await archiveTaskList(apiClient, args);
    case 'restore_task_list':
      return await restoreTaskList(apiClient, args);
    case 'copy_task_list':
      return await copyTaskList(apiClient, args);
    case 'move_task_list':
      return await moveTaskList(apiClient, args);
    case 'reposition_task_list':
      return await repositionTaskList(apiClient, args);
    case 'list_activities':
      return await listActivities(apiClient, args);
    case 'get_recent_updates':
      return await getRecentUpdates(apiClient, args);
    case 'list_time_entries':
      return await listTimeEntresTool(apiClient, args, config);
    case 'create_time_entry':
      return await createTimeEntryTool(apiClient, args, config);
    case 'list_project_deals':
      return await listProjectDealsTool(apiClient, args);
    case 'list_deal_services':
      return await listDealServicesTool(apiClient, args);
    case 'list_services':
      return await listServicesTool(apiClient, args);
    case 'get_project_services':
      return await getProjectServicesTool(apiClient, args);
    case 'update_time_entry':
      return await updateTimeEntryTool(apiClient, args);
    case 'approve_time_entry':
      return await approveTimeEntryTool(apiClient, args);
    case 'unapprove_time_entry':
      return await unapproveTimeEntryTool(apiClient, args);
    case 'reject_time_entry':
      return await rejectTimeEntryTool(apiClient, args);
    case 'unreject_time_entry':
      return await unrejectTimeEntryTool(apiClient, args);
    case 'get_timer':
      return await getTimerTool(apiClient, args);
    case 'start_timer':
      return await startTimerTool(apiClient, args);
    case 'stop_timer':
      return await stopTimerTool(apiClient, args);
    case 'list_custom_fields':
      return await listCustomFieldsTool(apiClient, args);
    case 'list_custom_field_options':
      return await listCustomFieldOptionsTool(apiClient, args);
    case 'move_task_to_list':
      return await moveTaskToList(apiClient, args);
    case 'add_to_backlog':
      return await addToBacklog(apiClient, args);
    case 'reposition_task':
      if (!args?.taskId) {
        throw new Error('taskId is required for task repositioning');
      }
      return await taskRepositionTool(apiClient, args as z.infer<typeof taskRepositionSchema>);
    case 'list_invoices':
      return await listInvoicesTool(apiClient, args);
    case 'list_company_budgets':
      return await listCompanyBudgetsTool(apiClient, args);
    case 'get_invoice':
      return await getInvoiceTool(apiClient, args);
    case 'create_invoice':
      return await createInvoiceTool(apiClient, args);
    case 'update_invoice':
      return await updateInvoiceTool(apiClient, args);
    case 'generate_line_items':
      return await generateLineItemsTool(apiClient, args);
    case 'finalize_invoice':
      return await finalizeInvoiceTool(apiClient, args);
    case 'get_invoice_pdf_url':
      return await getInvoicePdfUrlTool(apiClient, args, config);
    case 'delete_invoice':
      return await deleteInvoiceTool(apiClient, args);
    case 'get_timesheet_report_url':
      return await getTimesheetReportUrlTool(apiClient, args, config);
    case 'mark_invoice_paid':
      return await markInvoicePaidTool(apiClient, args);
    case 'delete_task':
      return await deleteTaskTool(apiClient, args);
    case 'list_folders':
      return await listFolders(apiClient, args);
    case 'get_folder':
      return await getFolder(apiClient, args);
    case 'create_folder':
      return await createFolder(apiClient, args);
    case 'update_folder':
      return await updateFolder(apiClient, args);
    case 'archive_folder':
      return await archiveFolder(apiClient, args);
    case 'restore_folder':
      return await restoreFolder(apiClient, args);
    case 'list_subtasks':
      return await listSubtasksTool(apiClient, args);
    case 'create_subtask':
      return await createSubtaskTool(apiClient, args);
    case 'list_comments':
      return await listCommentsTool(apiClient, args);
    case 'get_comment':
      return await getCommentTool(apiClient, args);
    case 'update_comment':
      return await updateCommentTool(apiClient, args);
    case 'delete_comment':
      return await deleteCommentTool(apiClient, args);
    case 'pin_comment':
      return await pinCommentTool(apiClient, args);
    case 'unpin_comment':
      return await unpinCommentTool(apiClient, args);
    case 'add_comment_reaction':
      return await addCommentReactionTool(apiClient, args);
    case 'list_todos':
      return await listTodosTool(apiClient, args);
    case 'get_todo':
      return await getTodoTool(apiClient, args);
    case 'create_todo':
      return await createTodoTool(apiClient, args);
    case 'update_todo':
      return await updateTodoTool(apiClient, args);
    case 'delete_todo':
      return await deleteTodoTool(apiClient, args);
    case 'list_pages':
      return await listPagesTool(apiClient, args);
    case 'get_page':
      return await getPageTool(apiClient, args);
    case 'create_page':
      return await createPageTool(apiClient, args);
    case 'update_page':
      return await updatePageTool(apiClient, args);
    case 'delete_page':
      return await deletePageTool(apiClient, args);
    case 'move_page':
      return await movePageTool(apiClient, args);
    case 'copy_page':
      return await copyPageTool(apiClient, args);
    case 'list_task_dependencies':
      return await listTaskDependenciesTool(apiClient, args);
    case 'get_task_dependency':
      return await getTaskDependencyTool(apiClient, args);
    case 'create_task_dependency':
      return await createTaskDependencyTool(apiClient, args);
    case 'delete_task_dependency':
      return await deleteTaskDependencyTool(apiClient, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Register all tools and handlers on a low-level MCP Server instance (stdio transport).
 */
export function registerToolsOnServer(
  server: Server,
  apiClient: ProductiveAPIClient,
  config: Config,
  enabledToolNames?: Set<string> | null,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(enabledToolNames),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await handleToolCall(name, args, apiClient, config, enabledToolNames);
  });
}

/**
 * Register handlers for a request whose user has no Productive PAT stored (BYOT,
 * FR-9). Tool discovery (ListTools) still works so the connector shows the tools,
 * but every tool call returns a structured, non-fatal hint pointing at the
 * settings page instead of hitting Productive.
 */
export function registerNoTokenHandlers(
  server: Server,
  settingsUrl: string,
  enabledToolNames?: Set<string> | null,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(enabledToolNames),
  }));

  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [
      {
        type: 'text',
        text:
          'No Productive token is configured for your account. ' +
          `Please add your Productive personal access token at ${settingsUrl} and then try again.`,
      },
    ],
    isError: true,
  }));
}
