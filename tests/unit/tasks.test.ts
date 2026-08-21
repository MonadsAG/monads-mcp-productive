import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { updateTaskTool } from '../../src/tools/tasks.js';

function mockClient(overrides: Partial<ProductiveAPIClient> = {}) {
  return {
    updateTask: vi.fn().mockResolvedValue({
      data: {
        id: '42',
        type: 'tasks',
        attributes: { title: 'Ship the feature', updated_at: '2026-07-05T10:00:00Z' },
      },
    }),
    // updateTaskTool reads the task before writing custom fields, so that a
    // partial hash does not wipe the values it does not mention.
    getTask: vi.fn().mockResolvedValue({
      data: { id: '42', type: 'tasks', attributes: { title: 'Ship the feature' } },
    }),
    listCustomFields: vi.fn().mockResolvedValue({ data: [] }),
    listCustomFieldOptions: vi.fn().mockResolvedValue({ data: [] }),
    ...overrides,
  } as unknown as ProductiveAPIClient;
}

describe('updateTaskTool', () => {
  it('updates only the assignee (relationships-only payload)', async () => {
    const client = mockClient();

    const result = await updateTaskTool(client, { task_id: '42', assignee_id: '7' });

    expect(client.updateTask).toHaveBeenCalledWith('42', {
      data: {
        type: 'tasks',
        id: '42',
        relationships: { assignee: { data: { id: '7', type: 'people' } } },
      },
    });
    expect(result.content[0].text).toContain('Assigned to: Person ID 7');
  });

  it('updates only the details (attributes-only payload)', async () => {
    const client = mockClient();

    const result = await updateTaskTool(client, { task_id: '42', title: 'New title' });

    expect(client.updateTask).toHaveBeenCalledWith('42', {
      data: {
        type: 'tasks',
        id: '42',
        attributes: { title: 'New title' },
      },
    });
    expect(result.content[0].text).toContain('Title updated to');
  });

  it('combines assignment and details into a single client.updateTask call', async () => {
    const client = mockClient();

    await updateTaskTool(client, { task_id: '42', title: 'New title', assignee_id: '7' });

    expect(client.updateTask).toHaveBeenCalledTimes(1);
    expect(client.updateTask).toHaveBeenCalledWith('42', {
      data: {
        type: 'tasks',
        id: '42',
        attributes: { title: 'New title' },
        relationships: { assignee: { data: { id: '7', type: 'people' } } },
      },
    });
  });

  it('resolves "me" to PRODUCTIVE_USER_ID', async () => {
    const client = mockClient();

    await updateTaskTool(
      client,
      { task_id: '42', assignee_id: 'me' },
      { PRODUCTIVE_USER_ID: '99' },
    );

    expect(client.updateTask).toHaveBeenCalledWith('42', {
      data: {
        type: 'tasks',
        id: '42',
        relationships: { assignee: { data: { id: '99', type: 'people' } } },
      },
    });
  });

  it('throws InvalidParams when "me" is used without PRODUCTIVE_USER_ID configured', async () => {
    const client = mockClient();

    await expect(updateTaskTool(client, { task_id: '42', assignee_id: 'me' })).rejects.toThrow(
      /PRODUCTIVE_USER_ID/,
    );
    expect(client.updateTask).not.toHaveBeenCalled();
  });

  it('unassigns the task when assignee_id is null', async () => {
    const client = mockClient();

    const result = await updateTaskTool(client, { task_id: '42', assignee_id: null });

    expect(client.updateTask).toHaveBeenCalledWith('42', {
      data: {
        type: 'tasks',
        id: '42',
        relationships: { assignee: { data: null } },
      },
    });
    expect(result.content[0].text).toContain('unassigned');
  });

  it('combines custom_fields with other details in one call', async () => {
    const client = mockClient();

    await updateTaskTool(client, {
      task_id: '42',
      description: 'Updated body',
      custom_fields: { '10': 'text value', '20': ['101', '102'] },
    });

    expect(client.updateTask).toHaveBeenCalledWith('42', {
      data: {
        type: 'tasks',
        id: '42',
        attributes: {
          description: 'Updated body',
          custom_fields: { '10': 'text value', '20': ['101', '102'] },
        },
      },
    });
  });

  it('throws InvalidParams when no fields are provided', async () => {
    const client = mockClient();

    await expect(updateTaskTool(client, { task_id: '42' })).rejects.toThrow(/At least one field/);
    expect(client.updateTask).not.toHaveBeenCalled();
  });

  it('throws InvalidParams when task_id is missing', async () => {
    const client = mockClient();

    await expect(updateTaskTool(client, { title: 'New title' })).rejects.toThrow(
      /Invalid parameters/,
    );
    expect(client.updateTask).not.toHaveBeenCalled();
  });

  // Productive replaces the whole custom_fields hash on PATCH, so a partial hash
  // silently wipes the other fields. Verified against the live API before the fix.
  it('merges custom_fields onto the values already stored on the task', async () => {
    const getTask = vi.fn().mockResolvedValue({
      data: {
        id: '42',
        type: 'tasks',
        attributes: { title: 'Ship the feature', custom_fields: { '100': 'keep', '200': 'old' } },
      },
    });
    const client = mockClient({ getTask } as never);

    await updateTaskTool(client, { task_id: '42', custom_fields: { '200': 'new' } });

    expect(getTask).toHaveBeenCalledWith('42');
    expect(client.updateTask).toHaveBeenCalledWith('42', {
      data: {
        type: 'tasks',
        id: '42',
        attributes: { custom_fields: { '100': 'keep', '200': 'new' } },
      },
    });
  });

  it('does not read the task when no custom fields are being written', async () => {
    const getTask = vi.fn();
    const client = mockClient({ getTask } as never);

    await updateTaskTool(client, { task_id: '42', title: 'New title' });

    expect(getTask).not.toHaveBeenCalled();
  });
});
