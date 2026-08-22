import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { setTimeEntryApprovalTool } from '../../src/tools/time-entry-approval.js';

function mockEntry(attributeOverrides: Record<string, unknown> = {}) {
  return {
    id: '55',
    type: 'time_entries',
    attributes: {
      date: '2026-07-01',
      time: 120,
      note: 'Worked on feature',
      updated_at: '2026-07-05T10:00:00Z',
      ...attributeOverrides,
    },
  };
}

function mockClient(attributeOverrides: Record<string, unknown> = {}) {
  return {
    approveTimeEntry: vi.fn().mockResolvedValue({ data: mockEntry(attributeOverrides) }),
    unapproveTimeEntry: vi.fn().mockResolvedValue({ data: mockEntry(attributeOverrides) }),
    rejectTimeEntry: vi.fn().mockResolvedValue({ data: mockEntry(attributeOverrides) }),
    unrejectTimeEntry: vi.fn().mockResolvedValue({ data: mockEntry(attributeOverrides) }),
  } as unknown as ProductiveAPIClient;
}

describe('setTimeEntryApprovalTool', () => {
  it('approves a time entry', async () => {
    const client = mockClient({ approved: true, approved_at: '2026-07-05T10:00:00Z' });

    const result = await setTimeEntryApprovalTool(client, {
      time_entry_id: '55',
      action: 'approve',
    });

    expect(client.approveTimeEntry).toHaveBeenCalledWith('55');
    expect(result.content[0].text).toContain('approved');
    expect(result.content[0].text).toContain('Approval: Approved');
  });

  it('unapproves a time entry', async () => {
    const client = mockClient();

    const result = await setTimeEntryApprovalTool(client, {
      time_entry_id: '55',
      action: 'unapprove',
    });

    expect(client.unapproveTimeEntry).toHaveBeenCalledWith('55');
    expect(result.content[0].text).toContain('unapproved');
  });

  it('rejects a time entry with a reason', async () => {
    const client = mockClient({ rejected: true, rejected_reason: 'Wrong project' });

    const result = await setTimeEntryApprovalTool(client, {
      time_entry_id: '55',
      action: 'reject',
      rejected_reason: 'Wrong project',
    });

    expect(client.rejectTimeEntry).toHaveBeenCalledWith('55', 'Wrong project');
    expect(result.content[0].text).toContain('rejected');
    expect(result.content[0].text).toContain('Wrong project');
    expect(result.content[0].text).toContain('Approval: Rejected (Wrong project)');
  });

  it('rejects a time entry without a reason', async () => {
    const client = mockClient();

    await setTimeEntryApprovalTool(client, { time_entry_id: '55', action: 'reject' });

    expect(client.rejectTimeEntry).toHaveBeenCalledWith('55', undefined);
  });

  it('unrejects a time entry', async () => {
    const client = mockClient();

    const result = await setTimeEntryApprovalTool(client, {
      time_entry_id: '55',
      action: 'unreject',
    });

    expect(client.unrejectTimeEntry).toHaveBeenCalledWith('55');
    expect(result.content[0].text).toContain('unrejected');
  });

  it('throws InvalidParams when rejected_reason is provided with a non-reject action', async () => {
    const client = mockClient();

    await expect(
      setTimeEntryApprovalTool(client, {
        time_entry_id: '55',
        action: 'approve',
        rejected_reason: 'Should not be allowed',
      }),
    ).rejects.toThrow(/rejected_reason/);
    expect(client.approveTimeEntry).not.toHaveBeenCalled();
  });

  it('throws InvalidParams for an invalid action', async () => {
    const client = mockClient();

    await expect(
      setTimeEntryApprovalTool(client, { time_entry_id: '55', action: 'bogus' }),
    ).rejects.toThrow(/Invalid parameters/);
  });

  it('throws InvalidParams when time_entry_id is missing', async () => {
    const client = mockClient();

    await expect(setTimeEntryApprovalTool(client, { action: 'approve' })).rejects.toThrow(
      /Invalid parameters/,
    );
  });
});
