import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { getRunningTimerTool } from '../../src/tools/timers.js';

afterEach(() => {
  vi.useRealTimers();
});

function timer(id: string, personId: number, stoppedAt: string | null) {
  return {
    id,
    type: 'timers',
    attributes: {
      person_id: personId,
      started_at: '2026-11-01T12:00:00Z',
      stopped_at: stoppedAt,
      total_time: 0,
    },
    relationships: { time_entry: { data: { id: '77', type: 'time_entries' } } },
  };
}

// Shape of the live response to include=time_entry,time_entry.service,time_entry.service.deal.
const included = [
  {
    id: '77',
    type: 'time_entries',
    attributes: { note: 'Timer-Lesetool bauen' },
    relationships: { service: { data: { id: '9', type: 'services' } } },
  },
  {
    id: '9',
    type: 'services',
    attributes: { name: 'Enablement / Research' },
    relationships: { deal: { data: { id: '89', type: 'deals' } } },
  },
  { id: '89', type: 'deals', attributes: { name: 'AI – Enablement & Innovation' } },
];

function makeClient(timers: unknown[], withIncluded = included) {
  return {
    listRunningTimers: vi.fn().mockResolvedValue({ data: timers, included: withIncluded }),
  } as unknown as ProductiveAPIClient;
}

async function text(client: ProductiveAPIClient, args: unknown) {
  const result = await getRunningTimerTool(client, args, { PRODUCTIVE_USER_ID: '42' });
  return result.content[0].text;
}

describe('getRunningTimerTool', () => {
  it('shows the running timer with start, elapsed time, note, service, budget and time entry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T13:30:00Z'));
    const client = makeClient([timer('56', 42, null)]);

    const out = await text(client, {});

    expect(out).toBe(
      [
        'Running timer for person 42 (me)',
        'ID: 56',
        'Started at: 2026-11-01T12:00:00Z',
        'Running for: 1h 30m',
        'Note: Timer-Lesetool bauen',
        'Service: Enablement / Research (ID: 9)',
        'Budget: AI – Enablement & Innovation (ID: 89)',
        'Time Entry ID: 77',
      ].join('\n'),
    );
    expect(client.listRunningTimers).toHaveBeenCalledWith('42');
  });

  it('shows no stopped timer and no timer of another person, should a filter stop working', async () => {
    const client = makeClient([
      timer('60', 7, null),
      timer('59', 42, '2026-11-01T11:00:00Z'),
      timer('58', 42, null),
    ]);

    const out = await text(client, { person_id: 'me' });

    expect(out).toContain('ID: 58');
    expect(out).not.toContain('ID: 60');
    expect(out).not.toContain('ID: 59');
  });

  it("refuses to answer when the response holds only other people's timers", async () => {
    await expect(text(makeClient([timer('60', 7, null)]), {})).rejects.toThrow(/person filter/);
  });

  it('says so when no timer of the person is running', async () => {
    const out = await text(makeClient([]), { person_id: '42' });

    expect(out).toBe('No running timer for person 42.');
  });

  it('leaves out what the response does not include', async () => {
    const out = await text(makeClient([timer('56', 42, null)], []), {});

    expect(out).toContain('ID: 56');
    expect(out).toContain('Time Entry ID: 77');
    expect(out).not.toContain('Service:');
    expect(out).not.toContain('Budget:');
    expect(out).not.toContain('Note:');
  });

  it('refuses "me" when no user is configured', async () => {
    await expect(getRunningTimerTool(makeClient([]), {}, {})).rejects.toThrow(/PRODUCTIVE_USER_ID/);
  });
});
