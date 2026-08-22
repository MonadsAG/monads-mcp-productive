import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { listTimeEntresTool } from '../../src/tools/time-entries.js';

function baseEntry(id: string, attributeOverrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'time_entries',
    attributes: {
      date: '2026-07-01',
      time: 120,
      note: 'Worked on feature',
      created_at: '2026-07-01T10:00:00Z',
      updated_at: '2026-07-01T10:00:00Z',
      ...attributeOverrides,
    },
    relationships: {
      person: { data: { id: '9', type: 'people' } },
    },
  };
}

function mockClient(response: unknown) {
  return {
    listTimeEntries: vi.fn().mockResolvedValue(response),
  } as unknown as ProductiveAPIClient;
}

describe('listTimeEntresTool', () => {
  it('shows the approver name for an approved entry', async () => {
    const entry = baseEntry('1', { approved: true, approved_at: '2026-07-02T09:00:00Z' });
    entry.relationships = {
      ...entry.relationships,
      approver: { data: { id: '9', type: 'people' } },
    } as typeof entry.relationships;

    const client = mockClient({
      data: [entry],
      included: [
        {
          id: '9',
          type: 'people',
          attributes: { first_name: 'Ada', last_name: 'Bauer' },
        },
      ],
    });

    const result = await listTimeEntresTool(client, {});

    expect(result.content[0].text).toContain('Approval: Approved by Ada Bauer');
  });

  it('shows the rejection reason for a rejected entry', async () => {
    const entry = baseEntry('2', { rejected: true, rejected_reason: 'Wrong project' });

    const client = mockClient({ data: [entry] });

    const result = await listTimeEntresTool(client, {});

    expect(result.content[0].text).toContain('Approval: Rejected (Wrong project)');
  });

  it('shows "Not submitted" for an entry with no approval decision', async () => {
    const entry = baseEntry('3');

    const client = mockClient({ data: [entry] });

    const result = await listTimeEntresTool(client, {});

    expect(result.content[0].text).toContain('Approval: Not submitted');
  });

  it('forwards approved and approver_id filters to the client', async () => {
    const client = mockClient({ data: [] });

    await listTimeEntresTool(client, { approved: true, approver_id: '9' });

    expect(client.listTimeEntries).toHaveBeenCalledWith(
      expect.objectContaining({ approved: true, approver_id: '9' }),
    );
  });
});
