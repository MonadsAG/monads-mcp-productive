import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import type {
  ProductiveTask,
  ProductiveResponse,
  ProductiveCustomField,
  ProductiveCustomFieldOption,
} from '../../src/api/types.js';
import {
  buildCustomFieldValueMap,
  resolveCustomFieldsText,
} from '../../src/tools/custom-field-resolver.js';

function makeTask(id: string, customFields?: Record<string, unknown> | null): ProductiveTask {
  return {
    id,
    type: 'tasks',
    attributes: {
      title: `Task ${id}`,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      ...(customFields !== undefined ? { custom_fields: customFields as any } : {}),
    },
  };
}

function makeCustomFieldsResponse(
  fields: Array<{ id: string; name: string }>,
): ProductiveResponse<ProductiveCustomField> {
  return {
    data: fields.map((f) => ({
      id: f.id,
      type: 'custom_fields',
      attributes: { name: f.name },
    })),
  };
}

function makeOptionsResponse(
  options: Array<{ id: string; name: string }>,
): ProductiveResponse<ProductiveCustomFieldOption> {
  return {
    data: options.map((o) => ({
      id: o.id,
      type: 'custom_field_options',
      attributes: { name: o.name },
    })),
  };
}

function makeMockClient() {
  return {
    listCustomFields: vi.fn(),
    listCustomFieldOptions: vi.fn(),
  } as unknown as ProductiveAPIClient & {
    listCustomFields: ReturnType<typeof vi.fn>;
    listCustomFieldOptions: ReturnType<typeof vi.fn>;
  };
}

describe('buildCustomFieldValueMap', () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
  });

  it('does not call the API at all when no task has custom_fields', async () => {
    const tasks = [makeTask('1'), makeTask('2', null), makeTask('3', {})];

    const map = await buildCustomFieldValueMap(client, tasks);

    expect(client.listCustomFields).not.toHaveBeenCalled();
    expect(client.listCustomFieldOptions).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  it('calls listCustomFields once total and listCustomFieldOptions once per distinct field id', async () => {
    client.listCustomFields.mockResolvedValue(
      makeCustomFieldsResponse([
        { id: 'f1', name: 'Sprint' },
        { id: 'f2', name: 'Priority Tag' },
      ]),
    );
    client.listCustomFieldOptions.mockImplementation(
      async ({ customFieldId }: { customFieldId: string }) => {
        if (customFieldId === 'f1') {
          return makeOptionsResponse([
            { id: 'o1', name: 'Sprint 1' },
            { id: 'o2', name: 'Sprint 2' },
          ]);
        }
        return makeOptionsResponse([{ id: 'o3', name: 'High' }]);
      },
    );

    // Three tasks share overlapping field ids: f1 appears in tasks 1 & 2 (with
    // different option values), f2 appears in tasks 2 & 3.
    const tasks = [
      makeTask('1', { f1: ['o1'] }),
      makeTask('2', { f1: ['o2'], f2: ['o3'] }),
      makeTask('3', { f2: ['o3'] }),
    ];

    const map = await buildCustomFieldValueMap(client, tasks);

    expect(client.listCustomFields).toHaveBeenCalledTimes(1);
    expect(client.listCustomFieldOptions).toHaveBeenCalledTimes(2);

    const calledFieldIds = client.listCustomFieldOptions.mock.calls
      .map((call: any[]) => call[0].customFieldId)
      .sort();
    expect(calledFieldIds).toEqual(['f1', 'f2']);

    expect(map.get('f1')?.name).toBe('Sprint');
    expect(map.get('f2')?.name).toBe('Priority Tag');
    expect(map.get('f1')?.options.get('o1')).toBe('Sprint 1');
    expect(map.get('f2')?.options.get('o3')).toBe('High');
  });
});

describe('resolveCustomFieldsText', () => {
  it('falls back to the raw field id when the field is missing from the map', () => {
    const map = new Map<string, { name: string; options: Map<string, string> }>();

    const lines = resolveCustomFieldsText(map, { 'unknown-field': 'some value' });

    expect(lines).toEqual(['unknown-field: some value']);
  });

  it('falls back to the raw option id when the option is missing from the map', () => {
    const map = new Map<string, { name: string; options: Map<string, string> }>([
      ['f1', { name: 'Sprint', options: new Map([['o1', 'Sprint 1']]) }],
    ]);

    const lines = resolveCustomFieldsText(map, { f1: ['o1', 'unknown-option'] });

    expect(lines).toEqual(['Sprint: Sprint 1, unknown-option']);
  });

  it('falls back to both raw field id and raw option id when neither is found', () => {
    const map = new Map<string, { name: string; options: Map<string, string> }>();

    const lines = resolveCustomFieldsText(map, { 'missing-field': ['missing-option'] });

    expect(lines).toEqual(['missing-field: missing-option']);
  });
});
