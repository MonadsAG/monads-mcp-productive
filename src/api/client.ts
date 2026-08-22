import { Config } from '../config/index.js';
import {
  ProductiveCompany,
  ProductiveProject,
  ProductiveTask,
  ProductiveBoard,
  ProductiveTaskList,
  ProductivePerson,
  ProductiveActivity,
  ProductiveComment,
  ProductiveWorkflowStatus,
  ProductiveService,
  ProductiveTimeEntry,
  ProductiveDeal,
  ProductiveDealCreate,
  ProductiveDealUpdate,
  ProductiveDealFromOrigin,
  ProductiveServiceCreate,
  ProductiveServiceUpdate,
  ProductiveTodo,
  ProductivePage,
  ProductiveResponse,
  ProductiveSingleResponse,
  ProductiveTaskCreate,
  ProductiveTaskUpdate,
  ProductiveBoardCreate,
  ProductiveTaskListCreate,
  ProductiveTaskListUpdate,
  ProductiveCommentCreate,
  ProductiveCommentUpdate,
  ProductiveTimeEntryCreate,
  ProductiveTimeEntryUpdate,
  ProductiveTimer,
  ProductiveTimerCreate,
  ProductiveBoardUpdate,
  ProductiveTodoCreate,
  ProductiveTodoUpdate,
  ProductivePageCreate,
  ProductivePageUpdate,
  ProductiveTaskDependency,
  ProductiveTaskDependencyCreate,
  ProductiveError,
  ProductiveDocumentType,
  ProductiveTaxRate,
  ProductiveInvoice,
  ProductiveInvoiceCreate,
  ProductiveLineItemGenerate,
  ProductivePaymentCreate,
  ProductiveInvoiceUpdate,
  ProductiveIncludedResource,
  ProductiveLineItem,
  ProductiveCustomField,
  ProductiveCustomFieldOption,
} from './types.js';
import {
  ProductiveApiError,
  formatProductiveErrors,
  type ProductiveErrorDetail,
} from './errors.js';

export class ProductiveAPIClient {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private getHeaders(): HeadersInit {
    return {
      'X-Auth-Token': this.config.PRODUCTIVE_API_TOKEN,
      'X-Organization-Id': this.config.PRODUCTIVE_ORG_ID,
      'Content-Type': 'application/vnd.api+json',
    };
  }

  /**
   * Turn a failed response into a ProductiveApiError carrying its HTTP status.
   *
   * The JSON parse is guarded deliberately: a 502 from a proxy answers with an
   * HTML page and a throttled request can answer with nothing at all, and an
   * unguarded `response.json()` surfaces a SyntaxError instead of the failure
   * that actually happened.
   */
  private async errorFrom(response: Response): Promise<ProductiveApiError> {
    let errors: ProductiveErrorDetail[] = [];

    try {
      const body = (await response.json()) as ProductiveError;
      errors = body.errors ?? [];
    } catch {
      /* non-JSON error body -- the status still says what went wrong */
    }

    const message =
      formatProductiveErrors(errors) || `API request failed with status ${response.status}`;

    return new ProductiveApiError(message, response.status, errors);
  }

  private async makeRequest<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.PRODUCTIVE_API_BASE_URL}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw await this.errorFrom(response);
    }

    return (await response.json()) as T;
  }

  private async makeVoidRequest(path: string, options?: RequestInit): Promise<void> {
    const url = `${this.config.PRODUCTIVE_API_BASE_URL}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw await this.errorFrom(response);
    }
  }

  async listCompanies(params?: {
    status?: 'active' | 'archived';
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveCompany>> {
    const statusMap: Record<string, string> = { active: '1', archived: '2' };
    const queryParams = new URLSearchParams();

    if (params?.status) {
      queryParams.append('filter[status]', statusMap[params.status]);
    }

    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params?.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `companies${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveCompany>>(path);
  }

  async listProjects(params?: {
    status?: 'active' | 'archived';
    company_id?: string;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveProject>> {
    const queryParams = new URLSearchParams();

    queryParams.append('include', 'company');

    if (params?.status) {
      // Convert status string to integer: active = 1, archived = 2
      const statusValue = params.status === 'active' ? '1' : '2';
      queryParams.append('filter[status]', statusValue);
    }

    if (params?.company_id) {
      queryParams.append('filter[company_id]', params.company_id);
    }

    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params?.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `projects${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveProject>>(path);
  }

  async listTasks(params?: {
    project_id?: string;
    parent_task_id?: string;
    assignee_id?: string;
    status?: 'open' | 'closed';
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveTask>> {
    const queryParams = new URLSearchParams();

    // Include assignee and workflow status so we can resolve names
    queryParams.append('include', 'assignee,workflow_status,project');

    if (params?.project_id) {
      queryParams.append('filter[project_id]', params.project_id);
    }

    if (params?.parent_task_id) {
      queryParams.append('filter[parent_task_id]', params.parent_task_id);
    }

    if (params?.assignee_id) {
      queryParams.append('filter[assignee_id]', params.assignee_id);
    }

    if (params?.status) {
      // Convert status names to integers: open = 1, closed = 2
      const statusValue = params.status === 'open' ? '1' : '2';
      queryParams.append('filter[status]', statusValue);
    }

    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params?.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `tasks${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveTask>>(path);
  }

  async createTask(
    taskData: ProductiveTaskCreate,
  ): Promise<ProductiveSingleResponse<ProductiveTask>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTask>>('tasks', {
      method: 'POST',
      body: JSON.stringify(taskData),
    });
  }

  async listTaskLists(params?: {
    board_id?: string;
    project_id?: string;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveTaskList>> {
    const queryParams = new URLSearchParams();

    if (params?.board_id) {
      // The board/folder filter on task lists is `folder_id` -- `filter[board_id]`
      // is rejected with 422 (verified live), same folders-vs-boards split as the
      // `/api/v2/folders` route itself.
      queryParams.append('filter[folder_id]', params.board_id);
    }

    if (params?.project_id) {
      queryParams.append('filter[project_id]', params.project_id);
    }

    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params?.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `task_lists${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveTaskList>>(path);
  }

  async createTaskList(
    taskListData: ProductiveTaskListCreate,
  ): Promise<ProductiveSingleResponse<ProductiveTaskList>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTaskList>>('task_lists', {
      method: 'POST',
      body: JSON.stringify(taskListData),
    });
  }

  async listPeople(params?: {
    company_id?: string;
    project_id?: string;
    is_active?: boolean;
    email?: string;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductivePerson>> {
    const queryParams = new URLSearchParams();

    if (params?.company_id) {
      queryParams.append('filter[company_id]', params.company_id);
    }

    if (params?.project_id) {
      queryParams.append('filter[project_id]', params.project_id);
    }

    if (params?.is_active !== undefined) {
      // Productive's /people endpoint has no `is_active` filter -- there is no
      // such attribute at all (a person carries `deactivated_at`). The
      // documented filter is `filter[status]` (1: active, 2: deactivated).
      queryParams.append('filter[status]', params.is_active ? '1' : '2');
    }

    if (params?.email) {
      queryParams.append('filter[email]', params.email);
    }

    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params?.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `people${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductivePerson>>(path);
  }

  async getPerson(personId: string): Promise<ProductiveSingleResponse<ProductivePerson>> {
    return this.makeRequest<ProductiveSingleResponse<ProductivePerson>>(`people/${personId}`);
  }

  async getTask(taskId: string): Promise<ProductiveSingleResponse<ProductiveTask>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTask>>(
      `tasks/${taskId}?include=task_list,assignee,workflow_status,project`,
    );
  }

  async getProject(projectId: string): Promise<ProductiveSingleResponse<ProductiveProject>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveProject>>(
      `projects/${projectId}?include=workflow`,
    );
  }

  async updateTask(
    taskId: string,
    taskData: ProductiveTaskUpdate,
  ): Promise<ProductiveSingleResponse<ProductiveTask>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTask>>(`tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(taskData),
    });
  }

  async listActivities(params?: {
    task_id?: string;
    project_id?: string;
    person_id?: string;
    item_type?: string;
    event?: string;
    after?: string; // ISO 8601 date string
    before?: string; // ISO 8601 date string
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveActivity>> {
    const queryParams = new URLSearchParams();

    if (params?.task_id) {
      queryParams.append('filter[task_id]', params.task_id);
    }

    if (params?.project_id) {
      queryParams.append('filter[project_id]', params.project_id);
    }

    if (params?.person_id) {
      queryParams.append('filter[person_id]', params.person_id);
    }

    if (params?.item_type) {
      queryParams.append('filter[item_type]', params.item_type);
    }

    if (params?.event) {
      queryParams.append('filter[event]', params.event);
    }

    if (params?.after) {
      queryParams.append('filter[after]', params.after);
    }

    if (params?.before) {
      queryParams.append('filter[before]', params.before);
    }

    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params?.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `activities${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveActivity>>(path);
  }

  async createComment(
    commentData: ProductiveCommentCreate,
  ): Promise<ProductiveSingleResponse<ProductiveComment>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveComment>>('comments', {
      method: 'POST',
      body: JSON.stringify(commentData),
    });
  }

  async listWorkflowStatuses(params?: {
    workflow_id?: string;
    category_id?: number;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveWorkflowStatus>> {
    const queryParams = new URLSearchParams();

    if (params?.workflow_id) {
      queryParams.append('filter[workflow_id]', params.workflow_id);
    }

    if (params?.category_id) {
      queryParams.append('filter[category_id]', params.category_id.toString());
    }

    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params?.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `workflow_statuses${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveWorkflowStatus>>(path);
  }

  /**
   * List time entries with optional filters
   *
   * @param params - Filter parameters for time entries
   * @param params.date - Filter by specific date (ISO format: YYYY-MM-DD)
   * @param params.after - Filter entries after this date (ISO format: YYYY-MM-DD)
   * @param params.before - Filter entries before this date (ISO format: YYYY-MM-DD)
   * @param params.person_id - Filter by person ID
   * @param params.project_id - Filter by project ID
   * @param params.task_id - Filter by task ID
   * @param params.service_id - Filter by service ID
   * @param params.approved - Filter by approval state (true/false)
   * @param params.approver_id - Filter by the ID of the person who approved the entry
   * @param params.limit - Number of results per page
   * @param params.page - Page number for pagination
   * @returns Promise resolving to paginated time entries response
   *
   * @example
   * // Get time entries for a specific person and date range
   * const entries = await client.listTimeEntries({
   *   person_id: "123",
   *   after: "2023-01-01",
   *   before: "2023-01-31"
   * });
   */
  async listTimeEntries(params?: {
    date?: string;
    after?: string;
    before?: string;
    person_id?: string;
    project_id?: string;
    task_id?: string;
    service_id?: string;
    approved?: boolean;
    approver_id?: string;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveTimeEntry>> {
    const queryParams = new URLSearchParams();

    // Include relationships by default
    queryParams.append('include', 'person,service,task,approver');

    if (params?.date) {
      queryParams.append('filter[date]', params.date);
    }

    if (params?.after) {
      queryParams.append('filter[after]', params.after);
    }

    if (params?.before) {
      queryParams.append('filter[before]', params.before);
    }

    if (params?.person_id) {
      queryParams.append('filter[person_id]', params.person_id);
    }

    if (params?.project_id) {
      queryParams.append('filter[project_id]', params.project_id);
    }

    if (params?.task_id) {
      queryParams.append('filter[task_id]', params.task_id);
    }

    if (params?.service_id) {
      queryParams.append('filter[service_id]', params.service_id);
    }

    if (params?.approved !== undefined) {
      // approved/rejected/submitted are response attributes, not filter keys --
      // filter[approved]=true 422s live. The real filter is filter[status]
      // (undocumented enum, live-confirmed: 1=approved). not_eq robustly covers
      // every other code for approved:false, not just the confirmed value 2.
      if (params.approved) {
        queryParams.append('filter[status]', '1');
      } else {
        queryParams.append('filter[status][not_eq]', '1');
      }
    }

    if (params?.approver_id) {
      queryParams.append('filter[approver_id]', params.approver_id);
    }

    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params?.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `time_entries${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveTimeEntry>>(path);
  }

  /**
   * Create a new time entry
   *
   * @param timeEntryData - Time entry creation data
   * @returns Promise resolving to the created time entry
   *
   * @example
   * // Create a time entry for a task
   * const timeEntry = await client.createTimeEntry({
   *   data: {
   *     type: 'time_entries',
   *     attributes: {
   *       date: '2023-01-15',
   *       time: 120, // 2 hours in minutes
   *       note: 'Working on feature implementation'
   *     },
   *     relationships: {
   *       person: { data: { id: '123', type: 'people' } },
   *       service: { data: { id: '456', type: 'services' } },
   *       task: { data: { id: '789', type: 'tasks' } }
   *     }
   *   }
   * });
   */
  async createTimeEntry(
    timeEntryData: ProductiveTimeEntryCreate,
  ): Promise<ProductiveSingleResponse<ProductiveTimeEntry>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimeEntry>>('time_entries', {
      method: 'POST',
      body: JSON.stringify(timeEntryData),
    });
  }

  /**
   * List deals/budgets for a specific project
   *
   * @param params - Filter parameters for deals
   * @param params.project_id - Filter by project ID (required)
   * @param params.budget_type - Filter by budget type (1: deal, 2: budget)
   * @param params.limit - Number of results per page
   * @param params.page - Page number for pagination
   * @returns Promise resolving to paginated deals response
   *
   * @example
   * // Get all deals/budgets for a project
   * const deals = await client.listProjectDeals({
   *   project_id: '123',
   *   budget_type: 2 // Only budgets
   * });
   */
  async listProjectDeals(params: {
    project_id: string;
    budget_type?: number; // 1: deal, 2: budget
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveDeal>> {
    const queryParams = new URLSearchParams();

    // Include project relationship
    queryParams.append('include', 'project');

    // Filter by project - deals endpoint expects array format
    queryParams.append('filter[project_id]', params.project_id);

    if (params.budget_type) {
      // Productive's /deals endpoint has no `budget_type` filter -- `budget_type`
      // is only a response attribute. The documented filter is `filter[type]`
      // (1: deal, 2: budget).
      queryParams.append('filter[type]', params.budget_type.toString());
    }

    if (params.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `deals${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveDeal>>(path);
  }

  /**
   * List services available for a specific deal/budget
   *
   * @param params - Filter parameters for services
   * @param params.deal_id - Filter by deal/budget ID
   * @param params.limit - Number of results per page
   * @param params.page - Page number for pagination
   * @returns Promise resolving to paginated services response
   *
   * @example
   * // Get services for a specific deal/budget
   * const services = await client.listDealServices({
   *   deal_id: '456'
   * });
   */
  async listDealServices(params: {
    deal_id: string;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveService>> {
    const queryParams = new URLSearchParams();

    // Filter by deal/budget
    queryParams.append('filter[deal_id]', params.deal_id);

    if (params.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `services${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveService>>(path);
  }

  /**
   * List services available for time tracking
   *
   * @param params - Filter parameters for services
   * @param params.company_id - Filter by company ID
   * @param params.limit - Number of results per page
   * @param params.page - Page number for pagination
   * @returns Promise resolving to paginated services response
   *
   * @example
   * // Get all services
   * const services = await client.listServices({
   *   company_id: '123'
   * });
   */
  async listServices(params?: {
    company_id?: string;
    budget_status?: number;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveService>> {
    const queryParams = new URLSearchParams();

    if (params?.company_id) {
      queryParams.append('filter[company_id]', params.company_id);
    }

    if (params?.budget_status) {
      queryParams.append('filter[budget_status]', params.budget_status.toString());
    }

    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }

    if (params?.page) {
      queryParams.append('page[number]', params.page.toString());
    }

    const queryString = queryParams.toString();
    const path = `services${queryString ? `?${queryString}` : ''}`;

    return this.makeRequest<ProductiveResponse<ProductiveService>>(path);
  }

  /**
   * Get a specific time entry by ID
   *
   * @param timeEntryId - The ID of the time entry to retrieve
   * @returns Promise resolving to the time entry
   *
   * @example
   * const timeEntry = await client.getTimeEntry('123');
   */
  async getTimeEntry(timeEntryId: string): Promise<ProductiveSingleResponse<ProductiveTimeEntry>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimeEntry>>(
      `time_entries/${timeEntryId}`,
    );
  }

  /**
   * Update an existing time entry's attributes
   *
   * @param timeEntryId - The ID of the time entry to update
   * @param timeEntryData - The update payload
   * @returns Promise resolving to the updated time entry
   */
  async updateTimeEntry(
    timeEntryId: string,
    timeEntryData: ProductiveTimeEntryUpdate,
  ): Promise<ProductiveSingleResponse<ProductiveTimeEntry>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimeEntry>>(
      `time_entries/${timeEntryId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(timeEntryData),
      },
    );
  }

  async deleteTimeEntry(id: string): Promise<void> {
    return this.makeVoidRequest(`time_entries/${id}`, { method: 'DELETE' });
  }

  /**
   * Approve a time entry
   */
  async approveTimeEntry(
    timeEntryId: string,
  ): Promise<ProductiveSingleResponse<ProductiveTimeEntry>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimeEntry>>(
      `time_entries/${timeEntryId}/approve`,
      { method: 'PATCH' },
    );
  }

  /**
   * Unapprove a time entry (reverse approval)
   */
  async unapproveTimeEntry(
    timeEntryId: string,
  ): Promise<ProductiveSingleResponse<ProductiveTimeEntry>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimeEntry>>(
      `time_entries/${timeEntryId}/unapprove`,
      { method: 'PATCH' },
    );
  }

  /**
   * Reject a time entry
   */
  async rejectTimeEntry(
    timeEntryId: string,
    rejectedReason?: string,
  ): Promise<ProductiveSingleResponse<ProductiveTimeEntry>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimeEntry>>(
      `time_entries/${timeEntryId}/reject`,
      {
        method: 'PATCH',
        body: rejectedReason
          ? JSON.stringify({
              data: {
                type: 'time_entries',
                id: timeEntryId,
                attributes: { rejected_reason: rejectedReason },
              },
            })
          : undefined,
      },
    );
  }

  /**
   * Unreject a time entry (reverse rejection)
   */
  async unrejectTimeEntry(
    timeEntryId: string,
  ): Promise<ProductiveSingleResponse<ProductiveTimeEntry>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimeEntry>>(
      `time_entries/${timeEntryId}/unreject`,
      { method: 'PATCH' },
    );
  }

  /**
   * Get a timer by ID
   */
  async getTimer(timerId: string): Promise<ProductiveSingleResponse<ProductiveTimer>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimer>>(`timers/${timerId}`);
  }

  /**
   * Get a timer by ID with time_entry relationship included
   */
  async getTimerWithTimeEntry(timerId: string): Promise<ProductiveSingleResponse<ProductiveTimer>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimer>>(
      `timers/${timerId}?include=time_entry`,
    );
  }

  /**
   * Create and start a new timer
   */
  async createTimer(
    timerData: ProductiveTimerCreate,
  ): Promise<ProductiveSingleResponse<ProductiveTimer>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimer>>('timers', {
      method: 'POST',
      body: JSON.stringify(timerData),
    });
  }

  /**
   * Stop a running timer
   */
  async stopTimer(timerId: string): Promise<ProductiveSingleResponse<ProductiveTimer>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTimer>>(`timers/${timerId}/stop`, {
      method: 'PATCH',
    });
  }

  /**
   * Helper method to get time entries for a specific date range
   * Convenience wrapper around listTimeEntries with date filtering
   *
   * @param startDate - Start date in ISO format (YYYY-MM-DD)
   * @param endDate - End date in ISO format (YYYY-MM-DD)
   * @param additionalParams - Additional filter parameters
   * @returns Promise resolving to paginated time entries response
   *
   * @example
   * // Get all time entries for last week
   * const entries = await client.getTimeEntriesInDateRange(
   *   '2023-01-01',
   *   '2023-01-07',
   *   { person_id: '123' }
   * );
   */
  async getTimeEntriesInDateRange(
    startDate: string,
    endDate: string,
    additionalParams?: {
      person_id?: string;
      project_id?: string;
      task_id?: string;
      service_id?: string;
      limit?: number;
      page?: number;
    },
  ): Promise<ProductiveResponse<ProductiveTimeEntry>> {
    return this.listTimeEntries({
      after: startDate,
      before: endDate,
      ...additionalParams,
    });
  }

  /**
   * Helper method to get time entries for today
   * Convenience wrapper for getting current day's time entries
   *
   * @param additionalParams - Additional filter parameters
   * @returns Promise resolving to paginated time entries response
   *
   * @example
   * // Get today's time entries for a specific person
   * const todayEntries = await client.getTodayTimeEntries({
   *   person_id: '123'
   * });
   */
  async getTodayTimeEntries(additionalParams?: {
    person_id?: string;
    project_id?: string;
    task_id?: string;
    service_id?: string;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveTimeEntry>> {
    const today = new Date().toISOString().split('T')[0]; // Get YYYY-MM-DD format
    return this.listTimeEntries({
      date: today,
      ...additionalParams,
    });
  }

  async listDocumentTypes(params?: {
    limit?: number;
  }): Promise<ProductiveResponse<ProductiveDocumentType>> {
    const queryParams = new URLSearchParams();
    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }
    const queryString = queryParams.toString();
    const path = `document_types${queryString ? `?${queryString}` : ''}`;
    return this.makeRequest<ProductiveResponse<ProductiveDocumentType>>(path);
  }

  async listTaxRates(params?: { limit?: number }): Promise<ProductiveResponse<ProductiveTaxRate>> {
    const queryParams = new URLSearchParams();
    if (params?.limit) {
      queryParams.append('page[size]', params.limit.toString());
    }
    const queryString = queryParams.toString();
    const path = `tax_rates${queryString ? `?${queryString}` : ''}`;
    return this.makeRequest<ProductiveResponse<ProductiveTaxRate>>(path);
  }

  async listInvoices(params?: {
    company_id?: string;
    project_id?: string;
    deal_id?: string;
    invoice_state?: number;
    invoice_status?: number;
    payment_status?: number;
    after?: string;
    before?: string;
    full_query?: string;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveInvoice>> {
    const queryParams = new URLSearchParams();
    queryParams.append('include', 'company');
    if (params?.company_id) queryParams.append('filter[company_id]', params.company_id);
    if (params?.project_id) queryParams.append('filter[project_id]', params.project_id);
    if (params?.deal_id) queryParams.append('filter[deal_id]', params.deal_id);
    if (params?.invoice_state)
      queryParams.append('filter[invoice_state]', params.invoice_state.toString());
    if (params?.invoice_status)
      queryParams.append('filter[invoice_status]', params.invoice_status.toString());
    if (params?.payment_status)
      queryParams.append('filter[payment_status]', params.payment_status.toString());
    // Invoices have no `after`/`before` filter (both 422 live). The invoice date
    // is `invoiced_on` -- the same field this endpoint already sorts by. Bounds are
    // inclusive so a range covers its edge days.
    if (params?.after) queryParams.append('filter[invoiced_on][gt_eq]', params.after);
    if (params?.before) queryParams.append('filter[invoiced_on][lt_eq]', params.before);
    if (params?.full_query) queryParams.append('filter[full_query]', params.full_query);
    if (params?.limit) queryParams.append('page[size]', params.limit.toString());
    if (params?.page) queryParams.append('page[number]', params.page.toString());
    queryParams.append('sort', '-invoiced_on');
    const queryString = queryParams.toString();
    const path = `invoices${queryString ? `?${queryString}` : ''}`;
    return this.makeRequest<ProductiveResponse<ProductiveInvoice>>(path);
  }

  async getInvoice(id: string): Promise<ProductiveSingleResponse<ProductiveInvoice>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveInvoice>>(
      `invoices/${id}?include=company`,
    );
  }

  async listLineItems(params: {
    invoice_id: string;
    limit?: number;
  }): Promise<ProductiveResponse<ProductiveLineItem>> {
    const queryParams = new URLSearchParams();
    queryParams.append('filter[invoice_id]', params.invoice_id);
    if (params.limit) queryParams.append('page[size]', params.limit.toString());
    return this.makeRequest<ProductiveResponse<ProductiveLineItem>>(
      `line_items?${queryParams.toString()}`,
    );
  }

  async createInvoice(
    data: ProductiveInvoiceCreate,
  ): Promise<ProductiveSingleResponse<ProductiveInvoice>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveInvoice>>('invoices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateInvoice(
    id: string,
    data: ProductiveInvoiceUpdate,
  ): Promise<ProductiveSingleResponse<ProductiveInvoice>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveInvoice>>(`invoices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async generateLineItems(data: ProductiveLineItemGenerate): Promise<ProductiveResponse<unknown>> {
    return this.makeRequest<ProductiveResponse<unknown>>('line_items/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async finalizeInvoice(id: string): Promise<ProductiveSingleResponse<ProductiveInvoice>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveInvoice>>(
      `invoices/${id}/finalize`,
      {
        method: 'PATCH',
        body: JSON.stringify({ data: { type: 'invoices', attributes: {} } }),
      },
    );
  }

  async listSubsidiaries(): Promise<ProductiveResponse<ProductiveIncludedResource>> {
    return this.makeRequest<ProductiveResponse<ProductiveIncludedResource>>('subsidiaries');
  }

  async listDealStatuses(): Promise<ProductiveResponse<ProductiveIncludedResource>> {
    return this.makeRequest<ProductiveResponse<ProductiveIncludedResource>>('deal_statuses');
  }

  async listCompanyBudgets(params: {
    company_id: string;
    status?: number;
    limit?: number;
  }): Promise<ProductiveResponse<ProductiveDeal>> {
    const queryParams = new URLSearchParams();
    queryParams.append('filter[type]', '2');
    // Productive's /deals endpoint has no `status` filter for open/closed --
    // the documented filter is `filter[budget_status]` (1: open, 2: closed).
    if (params.status) queryParams.append('filter[budget_status]', params.status.toString());
    queryParams.append('filter[company_id]', params.company_id);
    queryParams.append('include', 'project');
    if (params.limit) queryParams.append('page[size]', params.limit.toString());
    return this.makeRequest<ProductiveResponse<ProductiveDeal>>(`deals?${queryParams.toString()}`);
  }

  async createDeal(data: ProductiveDealCreate): Promise<ProductiveSingleResponse<ProductiveDeal>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveDeal>>('deals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDeal(
    id: string,
    data: ProductiveDealUpdate,
  ): Promise<ProductiveSingleResponse<ProductiveDeal>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveDeal>>(`deals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async createDealFromOrigin(
    data: ProductiveDealFromOrigin,
  ): Promise<ProductiveSingleResponse<ProductiveDeal>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveDeal>>('deals/create_from_origin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listDealsByOriginId(originDealId: string): Promise<ProductiveResponse<ProductiveDeal>> {
    const queryParams = new URLSearchParams();
    queryParams.append('filter[origin_deal_id]', originDealId);
    queryParams.append('filter[type]', '2');
    return this.makeRequest<ProductiveResponse<ProductiveDeal>>(`deals?${queryParams.toString()}`);
  }

  async deleteDeal(id: string): Promise<void> {
    return this.makeVoidRequest(`deals/${id}`, { method: 'DELETE' });
  }

  async createService(
    data: ProductiveServiceCreate,
  ): Promise<ProductiveSingleResponse<ProductiveService>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveService>>('services', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateService(
    id: string,
    data: ProductiveServiceUpdate,
  ): Promise<ProductiveSingleResponse<ProductiveService>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveService>>(`services/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteService(id: string): Promise<void> {
    return this.makeVoidRequest(`services/${id}`, { method: 'DELETE' });
  }

  async deleteInvoice(id: string): Promise<void> {
    // Was a hand-rolled fetch carrying its own copy of the error parsing.
    return this.makeVoidRequest(`invoices/${id}`, { method: 'DELETE' });
  }

  async createPayment(data: ProductivePaymentCreate): Promise<ProductiveSingleResponse<unknown>> {
    return this.makeRequest<ProductiveSingleResponse<unknown>>('payments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Reposition a task in a task list
   *
   * @param taskId - ID of the task to reposition
   * @param attributes - Positioning attributes (move_before_id and/or move_after_id)
   * @returns Promise resolving to the task response
   *
   * @example
   * // Position task 1 after task 2
   * await client.repositionTask('1', { move_after_id: '2' });
   *
   * // Position task 3 between tasks 1 and 2
   * await client.repositionTask('3', { move_after_id: '1', move_before_id: '2' });
   */
  async repositionTask(
    taskId: string,
    attributes: {
      move_before_id?: string;
      move_after_id?: string;
      placement?: number;
    },
  ): Promise<any> {
    const requestBody = {
      data: {
        type: 'tasks',
        attributes: { ...attributes },
      },
    };

    // The reposition endpoint returns 204 No Content on success
    const url = `${this.config.PRODUCTIVE_API_BASE_URL}tasks/${taskId}/reposition`;

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        // getHeaders() rather than a hand-written copy: this method used to
        // rebuild the three headers itself and would silently miss any change
        // made there.
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const apiError = await this.errorFrom(response);

        // Productive's 404 here means either "no such task" or "this task cannot
        // be repositioned", and its own message says neither. Keep the clearer
        // wording, but as a ProductiveApiError so the status still maps.
        if (response.status === 404) {
          throw new ProductiveApiError(
            `Task ${taskId} not found or cannot be repositioned.`,
            404,
            apiError.errors,
          );
        }

        throw apiError;
      }

      // If 204 No Content (success), return a minimal success response
      if (response.status === 204) {
        return {
          success: true,
          taskId: taskId,
          message: `Task ${taskId} repositioned successfully`,
        };
      }

      // For any other success response with content, try to parse JSON
      try {
        return await response.json();
      } catch (e) {
        // If parsing fails but status was success, return a minimal success object
        return {
          success: true,
          taskId: taskId,
          message: `Task ${taskId} repositioned successfully`,
        };
      }
    } catch (error) {
      console.error('Error repositioning task:', error);
      throw error;
    }
  }

  // ---- Board methods ----
  // Productive's UI/tool-facing name for this resource is "folder" (see
  // src/tools/folders.ts). All nine methods below deliberately hit the
  // literal path "folders" -- this tenant's live API 404s on "boards"
  // (verified) despite that being the API's relationship-level vocabulary
  // (ProductiveTask.board / ProductiveTaskList.board both use type 'boards').

  async listBoards(params?: {
    project_id?: string;
    status?: number;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveBoard>> {
    const q = new URLSearchParams();
    q.append('include', 'project');
    if (params?.project_id) q.append('filter[project_id]', params.project_id);
    if (params?.status) q.append('filter[status]', params.status.toString());
    if (params?.limit) q.append('page[size]', params.limit.toString());
    if (params?.page) q.append('page[number]', params.page.toString());
    return this.makeRequest<ProductiveResponse<ProductiveBoard>>(`folders?${q.toString()}`);
  }

  async getBoard(boardId: string): Promise<ProductiveSingleResponse<ProductiveBoard>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveBoard>>(
      `folders/${boardId}?include=project`,
    );
  }

  async createBoard(
    data: ProductiveBoardCreate,
  ): Promise<ProductiveSingleResponse<ProductiveBoard>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveBoard>>('folders', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBoard(
    boardId: string,
    data: ProductiveBoardUpdate,
  ): Promise<ProductiveSingleResponse<ProductiveBoard>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveBoard>>(`folders/${boardId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async archiveBoard(boardId: string): Promise<void> {
    return this.makeVoidRequest(`folders/${boardId}/archive`, {
      method: 'PATCH',
      body: JSON.stringify({ data: { type: 'folders' } }),
    });
  }

  async restoreBoard(boardId: string): Promise<void> {
    return this.makeVoidRequest(`folders/${boardId}/restore`, {
      method: 'PATCH',
      body: JSON.stringify({ data: { type: 'folders' } }),
    });
  }

  async moveBoard(boardId: string, projectId: string): Promise<void> {
    return this.makeVoidRequest(`folders/${boardId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: { type: 'folders', attributes: { project_id: projectId } },
      }),
    });
  }

  async repositionBoard(boardId: string, moveBeforeId: string): Promise<void> {
    return this.makeVoidRequest(`folders/${boardId}/reposition`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: { type: 'folders', attributes: { move_before_id: moveBeforeId } },
      }),
    });
  }

  async copyBoard(params: {
    name: string;
    template_id: string;
    project_id: string;
  }): Promise<ProductiveSingleResponse<ProductiveBoard>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveBoard>>('folders/copy', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'folders',
          attributes: {
            name: params.name,
            template_id: params.template_id,
            project_id: params.project_id,
          },
        },
      }),
    });
  }

  // ---- Task List extended methods ----

  async getTaskList(taskListId: string): Promise<ProductiveSingleResponse<ProductiveTaskList>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTaskList>>(
      `task_lists/${taskListId}`,
    );
  }

  async updateTaskList(
    taskListId: string,
    data: ProductiveTaskListUpdate,
  ): Promise<ProductiveSingleResponse<ProductiveTaskList>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTaskList>>(
      `task_lists/${taskListId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
    );
  }

  async archiveTaskList(taskListId: string): Promise<void> {
    return this.makeVoidRequest(`task_lists/${taskListId}/archive`, { method: 'PATCH' });
  }

  async restoreTaskList(taskListId: string): Promise<void> {
    return this.makeVoidRequest(`task_lists/${taskListId}/restore`, { method: 'PATCH' });
  }

  async copyTaskList(params: {
    name: string;
    template_id: string;
    project_id: string;
    board_id: string;
    copy_open_tasks?: boolean;
    copy_assignees?: boolean;
  }): Promise<ProductiveSingleResponse<ProductiveTaskList>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTaskList>>('task_lists/copy', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'task_lists',
          attributes: {
            name: params.name,
            template_id: params.template_id,
            project_id: params.project_id,
            board_id: params.board_id,
            copy_open_tasks: params.copy_open_tasks,
            copy_assignees: params.copy_assignees,
          },
        },
      }),
    });
  }

  async moveTaskList(taskListId: string, boardId: string): Promise<void> {
    return this.makeVoidRequest(`task_lists/${taskListId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: { type: 'task_lists', attributes: { board_id: boardId } },
      }),
    });
  }

  async repositionTaskList(taskListId: string, moveBeforeId: string): Promise<void> {
    return this.makeVoidRequest(`task_lists/${taskListId}/reposition`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: { type: 'task_lists', attributes: { move_before_id: moveBeforeId } },
      }),
    });
  }

  // ---- Task extended methods ----

  async deleteTask(taskId: string): Promise<void> {
    return this.makeVoidRequest(`tasks/${taskId}`, { method: 'DELETE' });
  }

  // ---- Comment extended methods ----

  async listComments(params?: {
    task_id?: string;
    project_id?: string;
    discussion_id?: string;
    page_id?: string;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveComment>> {
    const q = new URLSearchParams();
    q.append('include', 'creator');
    if (params?.task_id) q.append('filter[task_id]', params.task_id);
    if (params?.project_id) q.append('filter[project_id]', params.project_id);
    if (params?.discussion_id) q.append('filter[discussion_id]', params.discussion_id);
    if (params?.page_id) q.append('filter[page_id]', params.page_id);
    if (params?.limit) q.append('page[size]', params.limit.toString());
    if (params?.page) q.append('page[number]', params.page.toString());
    const qs = q.toString();
    return this.makeRequest<ProductiveResponse<ProductiveComment>>(`comments${qs ? `?${qs}` : ''}`);
  }

  async getComment(commentId: string): Promise<ProductiveSingleResponse<ProductiveComment>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveComment>>(
      `comments/${commentId}?include=creator`,
    );
  }

  async updateComment(
    commentId: string,
    data: ProductiveCommentUpdate,
  ): Promise<ProductiveSingleResponse<ProductiveComment>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveComment>>(`comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteComment(commentId: string): Promise<void> {
    return this.makeVoidRequest(`comments/${commentId}`, { method: 'DELETE' });
  }

  async pinComment(commentId: string): Promise<void> {
    return this.makeVoidRequest(`comments/${commentId}/pin`, { method: 'PATCH' });
  }

  async unpinComment(commentId: string): Promise<void> {
    return this.makeVoidRequest(`comments/${commentId}/unpin`, { method: 'PATCH' });
  }

  async addCommentReaction(commentId: string, reaction: string): Promise<void> {
    return this.makeVoidRequest(`comments/${commentId}/add_reaction`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: { type: 'comments', attributes: { reaction } },
      }),
    });
  }

  // ---- Todo methods ----

  async listTodos(params?: {
    task_id?: string;
    deal_id?: string;
    assignee_id?: string;
    status?: number;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveTodo>> {
    const q = new URLSearchParams();
    q.append('include', 'assignee,task,deal');
    if (params?.task_id) q.append('filter[task_id]', params.task_id);
    if (params?.deal_id) q.append('filter[deal_id]', params.deal_id);
    if (params?.assignee_id) q.append('filter[assignee_id]', params.assignee_id);
    if (params?.status) q.append('filter[status]', params.status.toString());
    if (params?.limit) q.append('page[size]', params.limit.toString());
    if (params?.page) q.append('page[number]', params.page.toString());
    const qs = q.toString();
    return this.makeRequest<ProductiveResponse<ProductiveTodo>>(`todos${qs ? `?${qs}` : ''}`);
  }

  async getTodo(todoId: string): Promise<ProductiveSingleResponse<ProductiveTodo>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTodo>>(
      `todos/${todoId}?include=assignee,task,deal`,
    );
  }

  async createTodo(data: ProductiveTodoCreate): Promise<ProductiveSingleResponse<ProductiveTodo>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTodo>>('todos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTodo(
    todoId: string,
    data: ProductiveTodoUpdate,
  ): Promise<ProductiveSingleResponse<ProductiveTodo>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTodo>>(`todos/${todoId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteTodo(todoId: string): Promise<void> {
    return this.makeVoidRequest(`todos/${todoId}`, { method: 'DELETE' });
  }

  // ---- Page methods ----

  async listPages(params?: {
    project_id?: string;
    creator_id?: string;
    sort?: string;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductivePage>> {
    const q = new URLSearchParams();
    if (params?.project_id) q.append('filter[project_id]', params.project_id);
    if (params?.creator_id) q.append('filter[creator_id]', params.creator_id);
    if (params?.sort) q.append('sort', params.sort);
    if (params?.limit) q.append('page[size]', params.limit.toString());
    if (params?.page) q.append('page[number]', params.page.toString());
    const qs = q.toString();
    return this.makeRequest<ProductiveResponse<ProductivePage>>(`pages${qs ? `?${qs}` : ''}`);
  }

  async getPage(pageId: string): Promise<ProductiveSingleResponse<ProductivePage>> {
    return this.makeRequest<ProductiveSingleResponse<ProductivePage>>(
      `pages/${pageId}?include=creator,project`,
    );
  }

  /**
   * `POST /pages` returns a 500 when given a `body` string -- pages store a
   * Productive Document Format document, so content has to go through the
   * markdown proxy route.
   */
  async createPage(data: ProductivePageCreate): Promise<ProductiveSingleResponse<ProductivePage>> {
    return this.makeRequest<ProductiveSingleResponse<ProductivePage>>(
      'pages/create_with_markdown',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    );
  }

  /** Replaces a page's whole body. Flat payload -- no JSON:API envelope. */
  async replacePageBody(
    pageId: string,
    markdown: string,
  ): Promise<ProductiveSingleResponse<ProductivePage>> {
    return this.makeRequest<ProductiveSingleResponse<ProductivePage>>(
      `pages/${pageId}/replace_body_with_markdown`,
      { method: 'PATCH', body: JSON.stringify({ markdown }) },
    );
  }

  /** Appends to a page's body. Flat payload -- no JSON:API envelope. */
  async appendPageBody(
    pageId: string,
    markdown: string,
  ): Promise<ProductiveSingleResponse<ProductivePage>> {
    return this.makeRequest<ProductiveSingleResponse<ProductivePage>>(
      `pages/${pageId}/append_markdown`,
      { method: 'PATCH', body: JSON.stringify({ markdown }) },
    );
  }

  async updatePage(
    pageId: string,
    data: ProductivePageUpdate,
  ): Promise<ProductiveSingleResponse<ProductivePage>> {
    return this.makeRequest<ProductiveSingleResponse<ProductivePage>>(`pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deletePage(pageId: string): Promise<void> {
    return this.makeVoidRequest(`pages/${pageId}`, { method: 'DELETE' });
  }

  async movePage(pageId: string, targetDocId: string): Promise<void> {
    return this.makeVoidRequest(`pages/${pageId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: { type: 'pages', attributes: { target_doc_id: targetDocId } },
      }),
    });
  }

  async copyPage(
    templateId: string,
    projectId?: string,
  ): Promise<ProductiveSingleResponse<ProductivePage>> {
    const attributes: Record<string, string> = { template_id: templateId };
    if (projectId) attributes.project_id = projectId;
    return this.makeRequest<ProductiveSingleResponse<ProductivePage>>('pages/copy', {
      method: 'POST',
      body: JSON.stringify({
        data: { type: 'pages', attributes },
      }),
    });
  }

  // ---- Task Dependency methods ----

  async listTaskDependencies(params?: {
    task_id?: string;
    dependent_task_id?: string;
    type_id?: number;
    limit?: number;
    page?: number;
  }): Promise<ProductiveResponse<ProductiveTaskDependency>> {
    const q = new URLSearchParams();
    q.append('include', 'task,dependent_task');
    if (params?.task_id) q.append('filter[task_id]', params.task_id);
    if (params?.dependent_task_id) q.append('filter[dependent_task_id]', params.dependent_task_id);
    if (params?.type_id) q.append('filter[type_id]', params.type_id.toString());
    if (params?.limit) q.append('page[size]', params.limit.toString());
    if (params?.page) q.append('page[number]', params.page.toString());
    const qs = q.toString();
    return this.makeRequest<ProductiveResponse<ProductiveTaskDependency>>(
      `task_dependencies${qs ? `?${qs}` : ''}`,
    );
  }

  async getTaskDependency(
    dependencyId: string,
  ): Promise<ProductiveSingleResponse<ProductiveTaskDependency>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTaskDependency>>(
      `task_dependencies/${dependencyId}?include=task,dependent_task`,
    );
  }

  async createTaskDependency(
    data: ProductiveTaskDependencyCreate,
  ): Promise<ProductiveSingleResponse<ProductiveTaskDependency>> {
    return this.makeRequest<ProductiveSingleResponse<ProductiveTaskDependency>>(
      'task_dependencies',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    );
  }

  async deleteTaskDependency(dependencyId: string): Promise<void> {
    return this.makeVoidRequest(`task_dependencies/${dependencyId}`, { method: 'DELETE' });
  }

  // ---- Custom Field methods ----

  /**
   * List custom field definitions.
   *
   * NOTE: there is no documented id-based filter for this endpoint, so this
   * always fetches a page (default size 200) — callers should filter
   * client-side if they need to narrow down to specific IDs.
   */
  async listCustomFields(params?: {
    name?: string;
    projectId?: string;
    customizableType?: string;
    archived?: boolean;
    global?: boolean;
    limit?: number;
  }): Promise<ProductiveResponse<ProductiveCustomField>> {
    const q = new URLSearchParams();
    if (params?.name) q.append('filter[name]', params.name);
    if (params?.projectId) q.append('filter[project_id]', params.projectId);
    if (params?.customizableType) q.append('filter[customizable_type]', params.customizableType);
    if (params?.archived !== undefined) q.append('filter[archived]', params.archived.toString());
    if (params?.global !== undefined) q.append('filter[global]', params.global.toString());
    q.append('page[size]', (params?.limit ?? 200).toString());
    return this.makeRequest<ProductiveResponse<ProductiveCustomField>>(
      `custom_fields?${q.toString()}`,
    );
  }

  /**
   * List the options available for a given custom field (e.g. dropdown/multi-select choices).
   *
   * NOTE: the API defaults `page[size]` to 30 (max 200) for this endpoint if
   * unset, so — like listCustomFields — this always requests a full page
   * (default size 200) to avoid silently truncating fields with >30 options.
   */
  async listCustomFieldOptions(params: {
    customFieldId: string;
    archived?: boolean;
    limit?: number;
  }): Promise<ProductiveResponse<ProductiveCustomFieldOption>> {
    const q = new URLSearchParams();
    q.append('filter[custom_field_id]', params.customFieldId);
    if (params.archived !== undefined) q.append('filter[archived]', params.archived.toString());
    q.append('page[size]', (params.limit ?? 200).toString());
    return this.makeRequest<ProductiveResponse<ProductiveCustomFieldOption>>(
      `custom_field_options?${q.toString()}`,
    );
  }
}
