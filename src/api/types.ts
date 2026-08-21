export interface ProductiveCompany {
  id: string;
  type: 'companies';
  attributes: {
    name: string;
    billing_name?: string;
    vat?: string;
    default_currency?: string;
    company_code?: string;
    domain?: string;
    tag_list?: string[];
    created_at: string;
    [key: string]: any;
  };
  relationships?: {
    [key: string]: any;
  };
}

export interface ProductiveProject {
  id: string;
  type: 'projects';
  attributes: {
    name: string;
    status: 'active' | 'archived';
    created_at: string;
    [key: string]: any;
  };
  relationships?: {
    company?: {
      data: {
        id: string;
        type: 'companies';
      };
    };
    [key: string]: any;
  };
}

export interface ProductiveTask {
  id: string;
  type: 'tasks';
  attributes: {
    title: string;
    description?: string;
    status?: number; // 1 = open, 2 = closed (for API requests)
    closed?: boolean; // false = open, true = closed (from API responses)
    due_date?: string;
    created_at: string;
    updated_at: string;
    [key: string]: any;
  };
  relationships?: {
    project?: {
      data: {
        id: string;
        type: 'projects';
      };
    };
    assignee?: {
      data: {
        id: string;
        type: 'people';
      };
    };
    [key: string]: any;
  };
}

export interface ProductiveIncludedResource {
  id: string;
  type: string;
  attributes: Record<string, any>;
  relationships?: Record<string, any>;
}

export interface ProductiveResponse<T> {
  data: T[];
  included?: ProductiveIncludedResource[];
  links?: {
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
  };
  meta?: {
    current_page?: number;
    total_pages?: number;
    total_count?: number;
  };
}

export interface ProductiveBoard {
  id: string;
  // Wire value is 'folders' -- this tenant's REST route for this resource is
  // /api/v2/folders (verified working), even though the API's relationship
  // type for a board reference elsewhere (ProductiveTask.board,
  // ProductiveTaskList.board) is 'boards'. Do not "fix" this to 'boards'.
  type: 'folders';
  attributes: {
    name: string;
    position?: number;
    placement?: number;
    archived_at?: string | null;
    hidden?: boolean;
    [key: string]: any;
  };
  relationships?: {
    project?: {
      data: {
        id: string;
        type: 'projects';
      };
    };
    [key: string]: any;
  };
}

export interface ProductiveTaskCreate {
  data: {
    type: 'tasks';
    attributes: {
      title: string;
      description?: string;
      due_date?: string;
      status?: number;
      custom_fields?: Record<string, string | number | boolean | string[] | null>;
    };
    relationships?: {
      project?: {
        data: {
          id: string;
          type: 'projects';
        };
      };
      board?: {
        data: {
          id: string;
          type: 'boards';
        };
      };
      task_list?: {
        data: {
          id: string;
          type: 'task_lists';
        };
      };
      assignee?: {
        data: {
          id: string;
          type: 'people';
        };
      };
    };
  };
}

export interface ProductiveTaskList {
  id: string;
  type: 'task_lists';
  attributes: {
    name: string;
    position?: number;
    [key: string]: any;
  };
  relationships?: {
    board?: {
      data: {
        id: string;
        type: 'boards';
      };
    };
    [key: string]: any;
  };
}

export interface ProductiveTaskListCreate {
  data: {
    type: 'task_lists';
    attributes: {
      name: string;
      description?: string;
      position?: number;
      project_id: string;
    };
    relationships: {
      board: {
        data: {
          id: string;
          type: 'boards';
        };
      };
    };
  };
}

export interface ProductiveTaskUpdate {
  data: {
    type: 'tasks';
    id: string;
    attributes?: {
      title?: string;
      description?: string;
      due_date?: string;
      status?: number;
      custom_fields?: Record<string, string | number | boolean | string[] | null>;
    };
    relationships?: {
      assignee?: {
        data: {
          id: string;
          type: 'people';
        } | null;
      };
      workflow_status?: {
        data: {
          id: string;
          type: 'workflow_statuses';
        };
      };
      task_list?: {
        data: {
          id: string;
          type: 'task_lists';
        };
      };
    };
  };
}

export interface ProductiveSingleResponse<T> {
  data: T;
  included?: ProductiveIncludedResource[];
}

export interface ProductivePerson {
  id: string;
  type: 'people';
  attributes: {
    email: string;
    first_name: string;
    last_name: string;
    title?: string;
    avatar_url?: string;
    created_at: string;
    /** null while the person is active. There is no `is_active` attribute. */
    deactivated_at?: string | null;
    [key: string]: any;
  };
  relationships?: {
    company?: {
      data: {
        id: string;
        type: 'companies';
      };
    };
    [key: string]: any;
  };
}

export interface ProductiveActivity {
  id: string;
  type: 'activities';
  attributes: {
    event: string; // 'create', 'update', 'delete', etc.
    item_type: string; // 'Task', 'Project', 'Workspace', etc.
    item_id: string;
    created_at: string;
    /** Changed fields as `[before, after]` pairs -- see formatChangeset(). */
    changeset?: Array<Record<string, unknown>>;
    [key: string]: any;
  };
  relationships?: {
    organization?: {
      data: {
        id: string;
        type: 'organizations';
      };
    };
    creator?: {
      data: {
        id: string;
        type: 'people';
      };
    };
    [key: string]: any;
  };
}

export interface ProductiveComment {
  id: string;
  type: 'comments';
  attributes: {
    /** Comment body HTML; null for body-less comments (e.g. attachment-only or system-generated). */
    body: string | null;
    commentable_type: string;
    created_at: string;
    updated_at: string;
    deleted_at?: string;
    draft?: boolean;
    edited_at?: string;
    hidden?: boolean;
    pinned_at?: string;
    reactions?: Record<string, any>;
    version_number?: number;
    [key: string]: any;
  };
  relationships?: {
    creator?: {
      data: {
        id: string;
        type: 'people';
      };
    };
    task?: {
      data: {
        id: string;
        type: 'tasks';
      };
    };
    [key: string]: any;
  };
}

export interface ProductiveCommentCreate {
  data: {
    type: 'comments';
    attributes: {
      body: string;
      hidden?: boolean;
    };
    relationships: {
      task: {
        data: {
          id: string;
          type: 'tasks';
        };
      };
    };
  };
}

export interface ProductiveWorkflowStatus {
  id: string;
  type: 'workflow_statuses';
  attributes: {
    name: string;
    color_id: number;
    position: number;
    category_id: number; // 1=not started, 2=started, 3=closed
    [key: string]: any;
  };
  relationships?: {
    workflow?: {
      data: {
        id: string;
        type: 'workflows';
      };
    };
    [key: string]: any;
  };
}

/**
 * Service entity interface for Productive API
 * Services represent billable activities/work types in Productive
 */
export interface ProductiveService {
  id: string;
  type: 'services';
  attributes: {
    name: string;
    description?: string;
    updated_at: string;
    [key: string]: any;
  };
  relationships?: {
    company?: {
      data: {
        id: string;
        type: 'companies';
      };
    };
    [key: string]: any;
  };
}

/**
 * Time entry entity interface for Productive API
 * Represents logged time against tasks or projects
 */
export interface ProductiveTimeEntry {
  id: string;
  type: 'time_entries';
  attributes: {
    date: string; // ISO date format (YYYY-MM-DD)
    time: number; // Time in minutes
    billable_time?: number; // Billable time in minutes, defaults to time value
    note?: string; // Description of work performed
    created_at: string;
    updated_at: string;
    [key: string]: any;
  };
  relationships?: {
    person?: {
      data: {
        id: string;
        type: 'people';
      };
    };
    service?: {
      data: {
        id: string;
        type: 'services';
      };
    };
    task?: {
      data: {
        id: string;
        type: 'tasks';
      };
    };
    project?: {
      data: {
        id: string;
        type: 'projects';
      };
    };
    [key: string]: any;
  };
}

/**
 * Deal/Budget entity representing project budgets or deals
 */
export interface ProductiveDeal {
  id: string;
  type: 'deals';
  attributes: {
    name: string;
    created_at?: string;
    /** true = production budget, false = sales deal. Replaces `budget_type`. */
    budget?: boolean;
    /** Total value in cents -- a number here, though other resources send amounts as strings. `deal_value` is unreliable (usually "0.0"). */
    deal_value_total?: number | string;
    currency?: string;
    [key: string]: any;
  };
  relationships?: {
    project?: {
      data?: {
        id: string;
        type: 'projects';
      };
    };
    services?: {
      data?: Array<{
        id: string;
        type: 'services';
      }>;
    };
    [key: string]: any;
  };
}

export interface ProductiveDealCreate {
  data: {
    type: 'deals';
    attributes: {
      name: string;
      deal_type_id: number;
      date: string;
      currency: string;
      budget: boolean; // createBudgetTool always passes true; kept boolean so
      // test setup can create a plain (budget:false) origin deal
      end_date?: string;
      deal_value?: number;
      purchase_order_number?: string;
      budget_warning?: number;
      // Only required by Productive when budget:false (a plain deal is on
      // the sales pipeline) — budgets skip this validation.
      probability?: number;
    };
    relationships: {
      company: { data: { id: string; type: 'companies' } };
      responsible: { data: { id: string; type: 'people' } };
      project?: { data: { id: string; type: 'projects' } };
      // Only required alongside `probability` when budget:false.
      deal_status?: { data: { id: string; type: 'deal_statuses' } };
    };
  };
}

export interface ProductiveDealUpdate {
  data: {
    type: 'deals';
    id: string;
    attributes?: {
      name?: string;
      date?: string;
      end_date?: string;
      currency?: string;
      deal_value?: number;
      purchase_order_number?: string;
      budget_warning?: number;
    };
  };
}

export interface ProductiveDealFromOrigin {
  data: {
    type: 'deals';
    attributes: {
      origin_deal_id: number;
      name?: string;
      date?: string;
      end_date?: string;
    };
    relationships: {
      project: { data: { id: string; type: 'projects' } };
    };
  };
}

export interface ProductiveServiceCreate {
  data: {
    type: 'services';
    attributes: {
      name: string;
      unit_id: number;
      billing_type_id: number;
      description?: string;
      price?: number;
      quantity?: number;
      budgeted_time?: number;
    };
    relationships: {
      // A Service references its parent budget/deal via `deal`, not `budget_id` --
      // verified live, since Services and Budgets share the deals resource.
      deal: { data: { id: string; type: 'deals' } };
    };
  };
}

export interface ProductiveServiceUpdate {
  data: {
    type: 'services';
    id: string;
    attributes?: {
      name?: string;
      description?: string;
      price?: number;
      quantity?: number;
      unit_id?: number;
      billing_type_id?: number;
      budgeted_time?: number;
    };
  };
}

/**
 * Time entry creation interface for Productive API
 * Used when creating new time entries via POST requests
 */
export interface ProductiveTimeEntryCreate {
  data: {
    type: 'time_entries';
    attributes: {
      date: string; // ISO date format (YYYY-MM-DD)
      time: number; // Time in minutes (required)
      billable_time?: number; // Billable time in minutes, defaults to time value
      note?: string; // Description of work performed
    };
    relationships: {
      person: {
        data: {
          id: string;
          type: 'people';
        };
      };
      service: {
        data: {
          id: string;
          type: 'services';
        };
      };
      task?: {
        data: {
          id: string;
          type: 'tasks';
        };
      };
    };
  };
}

/**
 * Time entry update interface for Productive API
 * Used for PATCH requests to update time entry attributes
 */
export interface ProductiveTimeEntryUpdate {
  data: {
    type: 'time_entries';
    id: string;
    attributes?: {
      date?: string;
      time?: number;
      billable_time?: number;
      note?: string;
    };
    relationships?: {
      service?: {
        data: {
          id: string;
          type: 'services';
        };
      };
    };
  };
}

/**
 * Timer entity interface for Productive API
 * Represents a time tracking session on a time entry
 */
export interface ProductiveTimer {
  id: string;
  type: 'timers';
  attributes: {
    person_id: number;
    started_at: string;
    stopped_at: string | null;
    total_time: number;
  };
  relationships?: {
    organization?: {
      data: {
        id: string;
        type: 'organizations';
      };
    };
    time_entry?: {
      meta?: { included: boolean };
      data?: {
        id: string;
        type: 'time_entries';
      };
    };
  };
}

/**
 * Timer creation interface for Productive API
 * Requires either a time_entry or service relationship
 */
export interface ProductiveTimerCreate {
  data: {
    type: 'timers';
    attributes: Record<string, never>;
    relationships: {
      time_entry?: {
        data: {
          id: string;
          type: 'time_entries';
        };
      };
      service?: {
        data: {
          id: string;
          type: 'services';
        };
      };
    };
  };
}

// ---- Board types ----
// (Productive's UI/tool-facing name for this resource is "folder"; see
// src/tools/folders.ts. The API relationship type is "boards".)

export interface ProductiveBoardCreate {
  data: {
    type: 'folders';
    attributes: { name: string };
    relationships: {
      project: { data: { id: string; type: 'projects' } };
    };
  };
}

export interface ProductiveBoardUpdate {
  data: {
    type: 'folders';
    id: string;
    attributes?: { name?: string };
  };
}

// ---- Task List Update ----

export interface ProductiveTaskListUpdate {
  data: {
    type: 'task_lists';
    id: string;
    attributes?: { name?: string };
  };
}

// ---- Todo types ----

export interface ProductiveTodo {
  id: string;
  type: 'todos';
  attributes: {
    description: string;
    closed?: boolean;
    closed_at?: string;
    due_date?: string;
    due_time?: string;
    created_at: string;
    todoable_type?: string;
    position?: number;
    [key: string]: unknown;
  };
  relationships?: {
    task?: { data: { id: string; type: 'tasks' } };
    deal?: { data: { id: string; type: 'deals' } };
    assignee?: { data: { id: string; type: 'people' } };
    [key: string]: unknown;
  };
}

export interface ProductiveTodoCreate {
  data: {
    type: 'todos';
    attributes: {
      description: string;
      due_date?: string;
    };
    relationships: {
      task?: { data: { id: string; type: 'tasks' } };
      deal?: { data: { id: string; type: 'deals' } };
      assignee?: { data: { id: string; type: 'people' } };
    };
  };
}

export interface ProductiveTodoUpdate {
  data: {
    type: 'todos';
    id: string;
    attributes?: {
      description?: string;
      closed?: boolean;
      due_date?: string;
    };
  };
}

// ---- Page types ----

export interface ProductivePage {
  id: string;
  type: 'pages';
  attributes: {
    title: string;
    /** JSON string holding a Productive Document Format document (`{"type":"doc","content":[...]}`). */
    body?: string;
    public_access?: boolean;
    version_number?: number;
    parent_page_id?: number;
    root_page_id?: number;
    created_at: string;
    updated_at: string;
    edited_at?: string;
    last_activity_at?: string;
    [key: string]: unknown;
  };
  relationships?: {
    project?: { data: { id: string; type: 'projects' } };
    parent_page?: { data: { id: string; type: 'pages' } };
    creator?: { data: { id: string; type: 'people' } };
    [key: string]: unknown;
  };
}

/**
 * Pages are created through `pages/create_with_markdown`: the body is written as
 * `markdown` (never as `body`, which is a Productive Document Format document,
 * not text), and `project_id` is an attribute rather than a relationship. It may
 * only be set on root pages -- combining it with parent_page_id/root_page_id is
 * rejected with `page_project_root_page_only`.
 */
export interface ProductivePageCreate {
  data: {
    type: 'pages';
    attributes: {
      title: string;
      markdown?: string;
      project_id?: number;
      parent_page_id?: number;
      root_page_id?: number;
    };
  };
}

/** Only the title goes through the plain PATCH; the body has its own routes. */
export interface ProductivePageUpdate {
  data: {
    type: 'pages';
    id: string;
    attributes?: {
      title?: string;
    };
  };
}

// ---- Comment Update ----

export interface ProductiveCommentUpdate {
  data: {
    type: 'comments';
    id: string;
    attributes?: {
      body?: string;
    };
  };
}

// ---- Task Dependency types ----

export interface ProductiveTaskDependency {
  id: string;
  type: 'task_dependencies';
  attributes: {
    type_id: number;
    created_at?: string;
    updated_at?: string;
    [key: string]: unknown;
  };
  relationships?: {
    task?: { data: { id: string; type: 'tasks' } };
    dependent_task?: { data: { id: string; type: 'tasks' } };
    reverse_dependency?: { data: { id: string; type: 'task_dependencies' } };
    [key: string]: unknown;
  };
}

export interface ProductiveTaskDependencyCreate {
  data: {
    type: 'task_dependencies';
    attributes: {
      task_id: string;
      dependent_task_id: string;
      type_id: string;
    };
  };
}

// ---- Custom Field types ----

/**
 * Custom field definition for Productive API.
 *
 * NOTE: the generated OpenAPI spec for this resource does not document exact
 * attribute names. Verified against a live organization (2026-07) — there is
 * NO `field_type` or plain `archived` boolean attribute; the real keys are
 * `data_type_id` (numeric, undocumented enum) and `archived_at` (nullable
 * timestamp; `filter[archived]=true|false` still works server-side even
 * though the attribute itself is a timestamp). `customizable_type` values
 * observed in the wild are lowercase plural, e.g. "tasks", "employees",
 * "project_expenses", "invoices" — NOT "Task".
 * Observed (unconfirmed/inferred) `data_type_id` values: 1 = text, 3 = single
 * select (has custom_field_options), 4 = date, 7 = file attachment.
 */
export interface ProductiveCustomField {
  id: string;
  type: 'custom_fields';
  attributes: {
    name: string;
    data_type_id?: number;
    formatting_type_id?: number | null;
    aggregation_type_id?: number | null;
    customizable_type?: string;
    required?: boolean;
    description?: string | null;
    global?: boolean;
    archived_at?: string | null;
    position?: number;
    show_in_add_edit_views?: boolean;
    sensitive?: boolean;
    quick_add_enabled?: boolean;
    created_at?: string;
    updated_at?: string;
    [key: string]: any;
  };
}

/**
 * Custom field option (e.g. one dropdown/multi-select choice) for Productive API.
 * Verified against a live organization (2026-07): `name`, `archived_at`
 * (nullable timestamp), `position`, and `color_id` are the real attributes.
 */
export interface ProductiveCustomFieldOption {
  id: string;
  type: 'custom_field_options';
  attributes: {
    name?: string;
    archived_at?: string | null;
    position?: number;
    color_id?: string | null;
    [key: string]: any;
  };
  relationships?: {
    custom_field?: {
      data: {
        id: string;
        type: string;
      };
    };
  };
}

// ---- Error types ----

export interface ProductiveError {
  errors: Array<{
    status?: string;
    title?: string;
    detail?: string;
    source?: {
      pointer?: string;
      parameter?: string;
    };
  }>;
}

/**
 * Task reposition interface for Productive API
 * Used when repositioning tasks in a task list
 */
export interface TaskReposition {
  move_before_id?: string; // Move task before specified task ID
  move_after_id?: string; // Move task after specified task ID
  placement?: number; // Legacy parameter, not recommended
}

export interface ProductiveDocumentType {
  id: string;
  type: 'document_types';
  attributes: {
    name: string;
    status?: string;
    [key: string]: any;
  };
}

export interface ProductiveTaxRate {
  id: string;
  type: 'tax_rates';
  attributes: {
    name: string;
    primary_component_value: string;
    primary_component_name?: string;
    secondary_component_value?: string | null;
    secondary_component_name?: string | null;
    archived_at?: string | null;
    [key: string]: any;
  };
}

export interface ProductiveInvoice {
  id: string;
  type: 'invoices';
  attributes: {
    number?: string;
    subject?: string;
    invoiced_on?: string;
    pay_on?: string;
    delivery_on?: string;
    paid_on?: string;
    finalized_at?: string;
    currency?: string;
    amount?: string;
    amount_with_tax?: string;
    amount_paid?: string;
    amount_unpaid?: string;
    amount_tax?: string;
    invoice_type_id?: number;
    note?: string;
    footer?: string;
    payment_terms?: number;
    export_invoice_url?: string;
    exported?: boolean;
    created_at: string;
    updated_at: string;
    [key: string]: any;
  };
  relationships?: {
    company?: { data: { id: string; type: 'companies' } };
    document_type?: { data: { id: string; type: 'document_types' } };
    [key: string]: any;
  };
}

export interface ProductiveInvoiceCreate {
  data: {
    type: 'invoices';
    attributes: {
      invoiced_on: string;
      currency: string;
      pay_on?: string;
      delivery_on?: string;
      subject?: string;
      note?: string;
      footer?: string;
      payment_terms?: number;
      purchase_order_number?: string;
    };
    relationships: {
      company: { data: { id: string; type: 'companies' } };
      document_type: { data: { id: string; type: 'document_types' } };
      subsidiary?: { data: { id: string; type: 'subsidiaries' } };
    };
  };
}

export interface ProductiveLineItem {
  id: string;
  type: 'line_items';
  attributes: {
    description?: string;
    quantity?: number;
    unit_price?: string;
    amount?: string;
    discount?: string;
    position?: number;
    [key: string]: any;
  };
}

/** Flat payload — this endpoint does NOT use JSON API envelope */
export interface ProductiveLineItemGenerate {
  data: {
    invoice_id: number;
    budget_ids: number[];
    tax_rate_id: number;
    invoicing_method: string;
    display_format: string;
    date_from?: string;
    date_to?: string;
    invoicing_by?: string;
    locale?: string;
  };
}

export interface ProductiveInvoiceUpdate {
  data: {
    type: 'invoices';
    id: string;
    attributes?: {
      subject?: string;
      note?: string;
      footer?: string;
      invoiced_on?: string;
      pay_on?: string;
      delivery_on?: string;
      currency?: string;
      payment_terms?: number;
      number?: string;
      purchase_order_number?: string;
    };
  };
}

export interface ProductivePaymentCreate {
  data: {
    type: 'payments';
    attributes: {
      amount: string;
      paid_on: string;
      note?: string;
    };
    relationships: {
      invoice: { data: { id: string; type: 'invoices' } };
    };
  };
}
