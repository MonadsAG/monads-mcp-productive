import { describe, it, expect, vi } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { deleteTimeEntryTool } from '../../src/tools/time-entry-delete.js';
import { ProductiveApiError } from '../../src/api/errors.js';

function mockEntry(attrs: Record<string, unknown> = {}) {
  return {
    id: '55',
    type: 'time_entries',
    attributes: {
      date: '2026-07-01',
      time: 120,
      note: 'Worked on feature',
      ...attrs,
    },
  };
}

function mockClient(overrides: Partial<ProductiveAPIClient> = {}) {
  return {
    getTimeEntry: vi.fn().mockResolvedValue({ data: mockEntry() }),
    deleteTimeEntry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ProductiveAPIClient;
}

/** Run a tool and hand back what it threw, so both code and message can be asserted. */
async function caught(promise: Promise<unknown>): Promise<McpError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(McpError);
  return error as McpError;
}

describe('deleteTimeEntryTool', () => {
  it('previews the entry and does not delete when confirm is missing', async () => {
    const client = mockClient();

    const result = await deleteTimeEntryTool(client, { time_entry_id: '55' });

    expect(client.deleteTimeEntry).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('2026-07-01');
    expect(result.content[0].text).toContain('2h');
    expect(result.content[0].text).toContain('Worked on feature');
    expect(result.content[0].text).toMatch(/no undo/i);
    expect(result.content[0].text).toContain('"confirm": true');
  });

  it('shows the approval state in the preview', async () => {
    const client = mockClient({
      getTimeEntry: vi.fn().mockResolvedValue({
        data: mockEntry({ approved: true, approved_at: '2026-07-02T10:00:00Z' }),
      }),
    });

    const result = await deleteTimeEntryTool(client, { time_entry_id: '55' });

    expect(result.content[0].text).toContain('Approval: Approved');
  });

  it('deletes once confirmed and says what went', async () => {
    const client = mockClient();

    const result = await deleteTimeEntryTool(client, { time_entry_id: '55', confirm: true });

    expect(client.deleteTimeEntry).toHaveBeenCalledWith('55');
    expect(result.content[0].text).toContain('has been deleted');
  });

  it('reports a missing time entry as a caller error, not an internal one', async () => {
    const client = mockClient({
      getTimeEntry: vi
        .fn()
        .mockRejectedValue(new ProductiveApiError('The requested record was not found', 404)),
    });

    const error = await caught(
      deleteTimeEntryTool(client, { time_entry_id: '999', confirm: true }),
    );

    expect(error.code).toBe(ErrorCode.InvalidParams);
    expect(client.deleteTimeEntry).not.toHaveBeenCalled();
  });

  it('throws InvalidParams when time_entry_id is missing', async () => {
    const client = mockClient();

    await expect(deleteTimeEntryTool(client, {})).rejects.toThrow(/Invalid parameters/);
    expect(client.getTimeEntry).not.toHaveBeenCalled();
  });
});
