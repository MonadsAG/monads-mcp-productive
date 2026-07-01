import { describe, it, expect, afterAll } from 'vitest';
import { getConfig } from '../../src/config/index.js';
import { ProductiveAPIClient } from '../../src/api/client.js';
import { createTaskTool, getTaskTool, deleteTaskTool } from '../../src/tools/tasks.js';
import type { ProductiveCustomField } from '../../src/api/types.js';

// This suite hits the REAL Productive.io API using local credentials from
// .dev.vars (loaded by tests/setup.ts). It is silently skipped for anyone
// without PRODUCTIVE_API_TOKEN set (CI, other contributors) via skipIf.
describe.skipIf(!process.env.PRODUCTIVE_API_TOKEN)(
  'custom fields integration (live Productive.io org)',
  () => {
    // Mirrors the stdio wiring in src/index.ts / src/server.ts: getConfig()
    // validates process.env, then the client is constructed directly from it.
    const config = getConfig();
    const client = new ProductiveAPIClient(config);

    let discoveredFields: ProductiveCustomField[] = [];
    let createdTaskId: string | null = null;

    afterAll(async () => {
      // Always clean up, even if earlier assertions in this file failed —
      // afterAll runs regardless of test outcome within the describe block.
      if (createdTaskId) {
        const idToDelete = createdTaskId;
        createdTaskId = null;
        await deleteTaskTool(client, { task_id: idToDelete });
      }
    });

    it('lists custom field definitions from the real API', async () => {
      const response = await client.listCustomFields();

      expect(response.data).toBeDefined();
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThan(0);

      discoveredFields = response.data;

      const first = response.data[0];
      // Ground truth check: earlier (pre-verification) code in this repo
      // assumed a `field_type` attribute existed on custom_fields. Log the
      // real keys so this output is useful evidence regardless of which way
      // it turns out.
      console.error(
        '[integration] real custom_fields attribute keys (first result):',
        Object.keys(first.attributes),
      );
      console.error(
        '[integration] real custom_fields first result attributes:',
        JSON.stringify(first.attributes),
      );

      if ('field_type' in first.attributes) {
        console.error('[integration] "field_type" IS present as a real attribute in this org.');
      } else {
        console.error(
          '[integration] CONFIRMED: "field_type" is NOT a real attribute on custom_fields in this ' +
            'org. The closest real attribute is `data_type_id` (a numeric, undocumented enum).',
        );
      }
    });

    it('lists options for a dropdown/select-like custom field with resolvable labels', async () => {
      expect(discoveredFields.length).toBeGreaterThan(0);

      let found: { field: ProductiveCustomField; optionId: string; optionLabel: string } | null =
        null;

      for (const field of discoveredFields) {
        const optionsResponse = await client.listCustomFieldOptions({ customFieldId: field.id });
        if (optionsResponse.data && optionsResponse.data.length > 0) {
          const firstOption = optionsResponse.data[0];
          found = {
            field,
            optionId: firstOption.id,
            optionLabel: firstOption.attributes?.name || firstOption.id,
          };
          break;
        }
      }

      expect(found).not.toBeNull();
      expect(found!.optionLabel.length).toBeGreaterThan(0);
      console.error(
        `[integration] dropdown-like field "${found!.field.attributes.name}" (id ${found!.field.id}) ` +
          `has option "${found!.optionLabel}" (id ${found!.optionId})`,
      );
    });

    it('creates a task with a custom field value and resolves both name and value through get_task', async () => {
      const projectsResponse = await client.listProjects({ status: 'active', limit: 20 });
      expect(projectsResponse.data.length).toBeGreaterThan(0);

      // A bare project_id is not sufficient to create a task in this org —
      // the API requires a task_list too (confirmed live: creating with only
      // a project relationship returns a 422 "task_list can't be blank").
      // Find the first active project that actually has a task list.
      let projectId: string | null = null;
      let taskListId: string | null = null;
      for (const project of projectsResponse.data) {
        const taskListsResponse = await client.listTaskLists({ project_id: project.id, limit: 5 });
        const activeTaskList = (taskListsResponse.data ?? []).find(
          (tl) => !tl.attributes.archived_at,
        );
        if (activeTaskList) {
          projectId = project.id;
          taskListId = activeTaskList.id;
          break;
        }
      }

      expect(projectId).not.toBeNull();
      expect(taskListId).not.toBeNull();

      // Prefer a real, currently-active custom field genuinely scoped to
      // tasks (discovered in test 1). Productive rejects custom_fields keyed
      // by a field scoped to a different customizable_type with a 422
      // custom_field_not_found error (confirmed live), so this must be a
      // real tasks-scoped field, not just any field.
      const taskScopedField = discoveredFields.find(
        (f) => f.attributes.customizable_type === 'tasks' && !f.attributes.archived_at,
      );
      expect(taskScopedField).toBeTruthy();

      const distinctiveValue = `integration-test-value-${Date.now()}`;
      let customFieldValue: string | string[] = distinctiveValue;
      let expectedResolvedValue: string = distinctiveValue;

      // If this task-scoped field happens to be a dropdown/select (has
      // options), use a real option id/label instead of a free-text value.
      const optionsResponse = await client.listCustomFieldOptions({
        customFieldId: taskScopedField!.id,
      });
      if (optionsResponse.data && optionsResponse.data.length > 0) {
        const option = optionsResponse.data[0];
        customFieldValue = [option.id];
        expectedResolvedValue = option.attributes?.name || option.id;
      }

      const createResult = await createTaskTool(
        client,
        {
          title: '[integration-test] custom fields probe',
          project_id: projectId,
          task_list_id: taskListId,
          custom_fields: { [taskScopedField!.id]: customFieldValue },
        },
        {},
      );

      const createText = (createResult.content[0] as { type: string; text: string }).text;
      const idMatch = createText.match(/\(ID:\s*(\d+)\)/);
      expect(idMatch).not.toBeNull();
      createdTaskId = idMatch![1];

      const getResult = await getTaskTool(client, { task_id: createdTaskId });
      const getText = (getResult.content[0] as { type: string; text: string }).text;

      // Core proof: the raw custom field ID and raw option ID are resolved
      // to their human-readable name/label in the tool output, not just
      // echoed back as opaque numbers.
      expect(getText).toContain(taskScopedField!.attributes.name);
      expect(getText).toContain(expectedResolvedValue);
    });
  },
);
