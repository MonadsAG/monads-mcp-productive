import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { listPeopleTool, getPersonTool } from '../../src/tools/people.js';

function mockPerson(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'people',
    attributes: {
      email: `person${id}@example.com`,
      first_name: 'Ada',
      last_name: 'Lovelace',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    },
  };
}

function mockClient() {
  return {
    listPeople: vi.fn().mockResolvedValue({ data: [mockPerson('1'), mockPerson('2')] }),
    getPerson: vi.fn().mockResolvedValue({ data: mockPerson('1') }),
  } as unknown as ProductiveAPIClient;
}

describe('listPeopleTool', () => {
  it('lists people with resolved filters', async () => {
    const client = mockClient();

    const result = await listPeopleTool(client, { project_id: '99' });

    expect(client.listPeople).toHaveBeenCalledWith({
      company_id: undefined,
      project_id: '99',
      is_active: undefined,
      email: undefined,
      limit: undefined,
    });
    expect(result.content[0].text).toContain('Found 2 people');
    expect(result.content[0].text).toContain('Ada Lovelace (ID: 1)');
  });

  it('reports when no people match', async () => {
    const client = mockClient();
    (client.listPeople as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });

    const result = await listPeopleTool(client, {});

    expect(result.content[0].text).toContain('No people found');
  });
});

describe('getPersonTool', () => {
  it('fetches a person by ID', async () => {
    const client = mockClient();

    const result = await getPersonTool(client, { person_id: '1' });

    expect(client.getPerson).toHaveBeenCalledWith('1');
    expect(result.content[0].text).toContain('Ada Lovelace (ID: 1)');
    expect(result.content[0].text).toContain('Email: person1@example.com');
  });

  it('throws InvalidParams when person_id is missing', async () => {
    const client = mockClient();

    await expect(getPersonTool(client, {})).rejects.toThrow(/Invalid parameters/);
  });
});
