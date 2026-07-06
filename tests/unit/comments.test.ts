import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import {
  addTaskCommentTool,
  listCommentsTool,
  getCommentTool,
  updateCommentTool,
} from '../../src/tools/comments.js';

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

function comment(id: string, body: string | null, extraAttrs: Record<string, unknown> = {}) {
  return {
    id,
    type: 'comments',
    attributes: {
      body,
      commentable_type: 'task',
      created_at: '2026-07-01T10:00:00Z',
      updated_at: '2026-07-01T10:00:00Z',
      ...extraAttrs,
    },
  };
}

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    listPeople: vi.fn().mockResolvedValue({ data: [person('1', 'Ada', 'Lovelace')] }),
    createComment: vi.fn().mockResolvedValue({ data: comment('99', 'Hi there') }),
    listComments: vi.fn().mockResolvedValue({ data: [comment('1', 'A real comment')] }),
    getComment: vi.fn().mockResolvedValue({ data: comment('1', 'A real comment') }),
    updateComment: vi.fn().mockResolvedValue({ data: comment('1', 'Updated body') }),
    ...overrides,
  } as unknown as ProductiveAPIClient;
}

describe('addTaskCommentTool', () => {
  it('posts a plain comment with no mentions or hidden flag', async () => {
    const client = mockClient();

    const result = await addTaskCommentTool(client, { task_id: '42', comment: 'Hi there' });

    expect(client.createComment).toHaveBeenCalledWith({
      data: {
        type: 'comments',
        attributes: { body: 'Hi there' },
        relationships: { task: { data: { id: '42', type: 'tasks' } } },
      },
    });
    expect(result.content[0].text).toContain('Comment added successfully');
  });

  it('resolves an unambiguous @mention and reports it', async () => {
    const client = mockClient({
      createComment: vi.fn().mockResolvedValue({ data: comment('99', 'resolved body') }),
    });

    const result = await addTaskCommentTool(client, {
      task_id: '42',
      comment: 'cc @Ada Lovelace please review',
    });

    const sentBody = (client.createComment as ReturnType<typeof vi.fn>).mock.calls[0][0].data
      .attributes.body;
    expect(sentBody).toContain('"id":"1"');
    expect(result.content[0].text).toContain('Mentions resolved: @Ada Lovelace');
  });

  it('throws InvalidParams on ambiguous mentions without posting', async () => {
    const client = mockClient({
      listPeople: vi
        .fn()
        .mockResolvedValue({ data: [person('1', 'Ada', 'Lovelace'), person('2', 'Ada', 'Byron')] }),
    });

    await expect(
      addTaskCommentTool(client, { task_id: '42', comment: 'cc @Ada please check' }),
    ).rejects.toThrow(/Ambiguous mentions/);
    expect(client.createComment).not.toHaveBeenCalled();
  });

  it('passes hidden:true through and reflects it in the response text', async () => {
    const client = mockClient({
      createComment: vi
        .fn()
        .mockResolvedValue({ data: comment('99', 'internal note', { hidden: true }) }),
    });

    const result = await addTaskCommentTool(client, {
      task_id: '42',
      comment: 'internal note',
      hidden: true,
    });

    expect(client.createComment).toHaveBeenCalledWith({
      data: {
        type: 'comments',
        attributes: { body: 'internal note', hidden: true },
        relationships: { task: { data: { id: '42', type: 'tasks' } } },
      },
    });
    expect(result.content[0].text).toContain('Hidden comment added successfully');
    expect(result.content[0].text).toContain('Hidden: true');
  });

  it('omits the hidden attribute entirely when not provided', async () => {
    const client = mockClient();

    await addTaskCommentTool(client, { task_id: '42', comment: 'no hidden field here' });

    const sentAttrs = (client.createComment as ReturnType<typeof vi.fn>).mock.calls[0][0].data
      .attributes;
    expect(sentAttrs).not.toHaveProperty('hidden');
  });
});

describe('listCommentsTool - null comment bodies', () => {
  it('renders a null body as (no content) instead of throwing', async () => {
    const client = mockClient({
      listComments: vi
        .fn()
        .mockResolvedValue({ data: [comment('1', 'A real comment'), comment('2', null)] }),
    });

    const result = await listCommentsTool(client, { task_id: '18263163' });

    const text = result.content[0].text;
    expect(text).toContain('Comments (2)');
    expect(text).toContain('A real comment');
    expect(text).toContain('(no content)');
  });
});

describe('getCommentTool - null comment body', () => {
  it('renders a null body as (no content) instead of throwing', async () => {
    const client = mockClient({
      getComment: vi.fn().mockResolvedValue({ data: comment('2', null) }),
    });

    const result = await getCommentTool(client, { comment_id: '2' });

    expect(result.content[0].text).toContain('Body: (no content)');
  });
});

describe('updateCommentTool', () => {
  it('resolves @mentions in the updated body', async () => {
    const client = mockClient({
      updateComment: vi.fn().mockResolvedValue({ data: comment('1', 'resolved') }),
    });

    const result = await updateCommentTool(client, {
      comment_id: '1',
      body: 'cc @Ada Lovelace',
    });

    const sentBody = (client.updateComment as ReturnType<typeof vi.fn>).mock.calls[0][1].data
      .attributes.body;
    expect(sentBody).toContain('"id":"1"');
    expect(result.content[0].text).toContain('Mentions resolved: @Ada Lovelace');
  });
});
