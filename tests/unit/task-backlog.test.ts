import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { addToBacklog } from '../../src/tools/task-backlog.js';

describe('addToBacklog', () => {
  it('looks up boards via client.listBoards (the working /folders-backed method)', async () => {
    const listBoards = vi.fn().mockResolvedValue({ data: [{ id: '1' }] });
    const listTaskLists = vi.fn().mockResolvedValue({
      data: [{ id: '10', attributes: { name: 'Backlog' } }],
    });
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const client = {
      listBoards,
      listTaskLists,
      updateTask,
    } as unknown as ProductiveAPIClient;

    await addToBacklog(client, { task_id: '99', project_id: '5' });

    expect(listBoards).toHaveBeenCalledWith({ project_id: '5' });
    expect(updateTask).toHaveBeenCalledWith(
      '99',
      expect.objectContaining({
        data: expect.objectContaining({
          relationships: { task_list: { data: { type: 'task_lists', id: '10' } } },
        }),
      }),
    );
  });
});
