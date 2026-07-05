import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { updateTimeEntryTool } from '../../src/tools/time-entry-update.js';

function mockEntry() {
  return {
    id: '55',
    type: 'time_entries',
    attributes: {
      date: '2026-07-01',
      time: 120,
      note: 'Worked on feature',
      updated_at: '2026-07-05T10:00:00Z',
    },
  };
}

function mockClient() {
  return {
    updateTimeEntry: vi.fn().mockResolvedValue({ data: mockEntry() }),
  } as unknown as ProductiveAPIClient;
}

describe('updateTimeEntryTool', () => {
  it('updates a plain attribute without sending relationships', async () => {
    const client = mockClient();

    const result = await updateTimeEntryTool(client, {
      time_entry_id: '55',
      note: 'Updated note',
    });

    expect(client.updateTimeEntry).toHaveBeenCalledWith('55', {
      data: {
        type: 'time_entries',
        id: '55',
        attributes: { note: 'Updated note' },
      },
    });
    expect(result.content[0].text).toContain('updated successfully');
  });

  it('reassigns the entry to a different service', async () => {
    const client = mockClient();

    const result = await updateTimeEntryTool(client, {
      time_entry_id: '55',
      service_id: '999',
    });

    expect(client.updateTimeEntry).toHaveBeenCalledWith('55', {
      data: {
        type: 'time_entries',
        id: '55',
        attributes: {},
        relationships: {
          service: { data: { id: '999', type: 'services' } },
        },
      },
    });
    expect(result.content[0].text).toContain('Reassigned to Service ID: 999');
  });

  it('combines attribute edits with a service reassignment', async () => {
    const client = mockClient();

    await updateTimeEntryTool(client, {
      time_entry_id: '55',
      note: 'Moved to new budget',
      service_id: '999',
    });

    expect(client.updateTimeEntry).toHaveBeenCalledWith('55', {
      data: {
        type: 'time_entries',
        id: '55',
        attributes: { note: 'Moved to new budget' },
        relationships: {
          service: { data: { id: '999', type: 'services' } },
        },
      },
    });
  });

  it('throws InvalidParams when no fields are provided', async () => {
    const client = mockClient();

    await expect(updateTimeEntryTool(client, { time_entry_id: '55' })).rejects.toThrow(
      /At least one field to update/,
    );
    expect(client.updateTimeEntry).not.toHaveBeenCalled();
  });

  it('throws InvalidParams when time_entry_id is missing', async () => {
    const client = mockClient();

    await expect(updateTimeEntryTool(client, { note: 'x' })).rejects.toThrow(/Invalid parameters/);
  });
});
