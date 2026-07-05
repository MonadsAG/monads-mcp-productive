import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import {
  extractMentionTokens,
  buildMentionReplacement,
  resolveMentions,
} from '../../src/utils/mentions.js';

function person(id: string, first: string, last: string) {
  return {
    id,
    type: 'people' as const,
    attributes: {
      email: `${first}.${last}@example.com`,
      first_name: first,
      last_name: last,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  };
}

function mockClientWithPeople(people: ReturnType<typeof person>[]) {
  return {
    listPeople: vi.fn().mockResolvedValue({ data: people }),
  } as unknown as ProductiveAPIClient;
}

describe('extractMentionTokens', () => {
  it('returns no tokens for a body with no mentions', () => {
    expect(extractMentionTokens('Just a plain comment, no mentions here.')).toEqual([]);
  });

  it('extracts a single-word mention', () => {
    const tokens = extractMentionTokens('Hey @Ada can you look at this?');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ raw: '@Ada', name: 'Ada' });
  });

  it('extracts a full-name mention', () => {
    const tokens = extractMentionTokens('cc @Ada Lovelace for review');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ raw: '@Ada Lovelace', name: 'Ada Lovelace' });
  });

  it('extracts multiple mentions', () => {
    const tokens = extractMentionTokens('@Ada Lovelace and @Grace Hopper should both see this');
    expect(tokens.map((t) => t.name)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('extracts a mention at the very start and end of the body', () => {
    const tokens = extractMentionTokens('@Ada start, middle text, end @Grace');
    expect(tokens.map((t) => t.raw)).toEqual(['@Ada', '@Grace']);
  });

  it('extracts a mention embedded inside HTML', () => {
    const tokens = extractMentionTokens('<p>Hey @Ada, please review</p>');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].name).toBe('Ada');
  });

  it('does not match an already-resolved mention pattern', () => {
    const tokens = extractMentionTokens('@[{"type":"person","id":"1","label":"Ada Lovelace"}]');
    expect(tokens).toEqual([]);
  });

  it('does not match a lowercase @handle', () => {
    expect(extractMentionTokens('email me @ada.example.com')).toEqual([]);
  });

  it('extracts a name with an internal apostrophe', () => {
    const tokens = extractMentionTokens("cc @O'Brien for review");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ raw: "@O'Brien", name: "O'Brien" });
  });

  it('extracts a hyphenated name without truncating it', () => {
    const tokens = extractMentionTokens('cc @Anne-Marie for review');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ raw: '@Anne-Marie', name: 'Anne-Marie' });
  });
});

describe('buildMentionReplacement', () => {
  it('builds a ProseMirror-style mention payload', () => {
    const replacement = buildMentionReplacement(person('42', 'Ada', 'Lovelace'));
    expect(replacement).toContain('"type":"person"');
    expect(replacement).toContain('"id":"42"');
    expect(replacement).toContain('"label":"Ada Lovelace"');
  });
});

describe('resolveMentions', () => {
  it('returns the body unchanged when there are no mentions', async () => {
    const client = mockClientWithPeople([person('1', 'Ada', 'Lovelace')]);
    const result = await resolveMentions('no mentions here', client);

    expect(result.resolvedBody).toBe('no mentions here');
    expect(result.resolved).toEqual([]);
    expect(client.listPeople).not.toHaveBeenCalled();
  });

  it('resolves a single unambiguous full-name mention', async () => {
    const client = mockClientWithPeople([
      person('1', 'Ada', 'Lovelace'),
      person('2', 'Grace', 'Hopper'),
    ]);
    const result = await resolveMentions('cc @Ada Lovelace', client);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].person.id).toBe('1');
    expect(result.unresolved).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.resolvedBody).toContain('"id":"1"');
  });

  it('resolves a first-name-only mention when unique', async () => {
    const client = mockClientWithPeople([
      person('1', 'Ada', 'Lovelace'),
      person('2', 'Grace', 'Hopper'),
    ]);
    const result = await resolveMentions('hey @Ada', client);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].person.id).toBe('1');
  });

  it('matches case-insensitively', async () => {
    const client = mockClientWithPeople([person('1', 'Ada', 'Lovelace')]);
    const result = await resolveMentions('cc @Ada Lovelace', client);

    expect(result.resolved).toHaveLength(1);
  });

  it('reports ambiguous matches without rewriting the body', async () => {
    const client = mockClientWithPeople([
      person('1', 'Ada', 'Lovelace'),
      person('2', 'Ada', 'Byron'),
    ]);
    const result = await resolveMentions('hey @Ada', client);

    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates).toHaveLength(2);
    expect(result.resolvedBody).toBe('hey @Ada');
    expect(result.resolved).toEqual([]);
  });

  it('leaves unresolved names as plain text with a warning', async () => {
    const client = mockClientWithPeople([person('1', 'Ada', 'Lovelace')]);
    const result = await resolveMentions('cc @Nobody Here', client);

    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].raw).toBe('@Nobody Here');
    expect(result.resolvedBody).toContain('@Nobody Here');
  });

  it('resolves multiple distinct mentions in one body', async () => {
    const client = mockClientWithPeople([
      person('1', 'Ada', 'Lovelace'),
      person('2', 'Grace', 'Hopper'),
    ]);
    const result = await resolveMentions('@Ada Lovelace and @Grace Hopper, please review', client);

    expect(result.resolved).toHaveLength(2);
    expect(result.resolvedBody).toContain('"id":"1"');
    expect(result.resolvedBody).toContain('"id":"2"');
  });

  it('resolves a name with an internal apostrophe', async () => {
    const client = mockClientWithPeople([person('1', 'Conan', "O'Brien")]);
    const result = await resolveMentions("cc @Conan O'Brien for review", client);

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].person.id).toBe('1');
  });

  it('paginates through listPeople to find a person past the first page', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => person(`p${i}`, 'Filler', `Person${i}`));
    const target = person('999', 'Grace', 'Hopper');
    const client = {
      listPeople: vi
        .fn()
        .mockResolvedValueOnce({ data: page1, meta: { current_page: 1, total_pages: 2 } })
        .mockResolvedValueOnce({ data: [target], meta: { current_page: 2, total_pages: 2 } }),
    } as unknown as ProductiveAPIClient;

    const result = await resolveMentions('cc @Grace Hopper', client);

    expect(client.listPeople).toHaveBeenCalledTimes(2);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].person.id).toBe('999');
  });
});
