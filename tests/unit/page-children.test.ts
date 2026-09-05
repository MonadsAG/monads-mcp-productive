import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { listPageChildrenTool } from '../../src/tools/page-children.js';

function mockClient(overrides: Partial<ProductiveAPIClient> = {}): ProductiveAPIClient {
  return { ...overrides } as unknown as ProductiveAPIClient;
}

function pageRow(id: string, title: string, parent: number, root: number, version?: number) {
  return {
    id,
    type: 'pages',
    attributes: {
      title,
      parent_page_id: parent,
      root_page_id: root,
      version_number: version,
      created_at: '2026-01-01T00:00:00+00:00',
      updated_at: '2026-01-01T00:00:00+00:00',
    },
  };
}

function startPage(id: string, title: string, rootPageId?: number) {
  return {
    data: {
      id,
      type: 'pages',
      attributes: {
        title,
        root_page_id: rootPageId,
        created_at: '2026-01-01T00:00:00+00:00',
        updated_at: '2026-01-01T00:00:00+00:00',
      },
    },
  };
}

describe('list_page_children', () => {
  it('sweeps the document by root id when the page is itself a root Doc', async () => {
    const getPage = vi.fn().mockResolvedValue(startPage('725358', 'Beispieldokument'));
    const listPages = vi.fn().mockResolvedValue({
      data: [pageRow('725359', 'Seite 1', 725358, 725358)],
      meta: { total_pages: 1 },
    });

    const result = await listPageChildrenTool(mockClient({ getPage, listPages }), {
      page_id: '725358',
    });

    // A root Doc has no root_page_id of its own, so its own id scopes the sweep.
    // The sparse fieldset keeps each page's body out of the response.
    expect(listPages).toHaveBeenCalledWith({
      root_page_id: '725358',
      fields: [
        'title',
        'parent_page_id',
        'root_page_id',
        'position',
        'edited_at',
        'version_number',
      ],
      limit: 200,
      page: 1,
      sort: 'id',
    });
    expect(listPages.mock.calls[0][0].fields).not.toContain('body');
    // The start page is fetched plainly: the single-page endpoint ignores
    // fields[pages], so there is no fieldset worth passing.
    expect(getPage).toHaveBeenCalledWith('725358');
    expect(result.content[0].text).toContain('Beispieldokument (ID: 725358) — 1 child page');
    expect(result.content[0].text).toContain('└─ Seite 1 (ID: 725359)');
  });

  it('scopes the sweep to the top Doc when starting mid-hierarchy', async () => {
    const getPage = vi.fn().mockResolvedValue(startPage('725359', 'Seite 1', 725358));
    const listPages = vi.fn().mockResolvedValue({
      data: [
        pageRow('725359', 'Seite 1', 725358, 725358),
        pageRow('725360', 'Unterseite', 725359, 725358),
        pageRow('725370', 'Seite 2', 725358, 725358),
      ],
      meta: { total_pages: 1 },
    });

    const result = await listPageChildrenTool(mockClient({ getPage, listPages }), {
      page_id: '725359',
    });

    expect(listPages).toHaveBeenCalledWith(expect.objectContaining({ root_page_id: '725358' }));
    // Only the subtree below 725359 -- the sibling 725370 is fetched but not shown.
    expect(result.content[0].text).toContain('└─ Unterseite (ID: 725360)');
    expect(result.content[0].text).not.toContain('Seite 2');
    expect(result.content[0].text).toContain('— 1 child page');
  });

  it('nests grandchildren, which is what the single sweep buys', async () => {
    const getPage = vi.fn().mockResolvedValue(startPage('1', 'Doc'));
    const listPages = vi.fn().mockResolvedValue({
      data: [pageRow('2', 'Child', 1, 1), pageRow('3', 'Grandchild', 2, 1)],
      meta: { total_pages: 1 },
    });

    const result = await listPageChildrenTool(mockClient({ getPage, listPages }), { page_id: '1' });

    expect(listPages).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('└─ Child (ID: 2)');
    expect(result.content[0].text).toContain('   └─ Grandchild (ID: 3)');
    expect(result.content[0].text).toContain('— 2 child pages');
  });

  it('honours max_depth', async () => {
    const getPage = vi.fn().mockResolvedValue(startPage('1', 'Doc'));
    const listPages = vi.fn().mockResolvedValue({
      data: [pageRow('2', 'Child', 1, 1)],
      meta: { total_pages: 1 },
    });

    const result = await listPageChildrenTool(mockClient({ getPage, listPages }), {
      page_id: '1',
      max_depth: 1,
    });

    // One level is what filter[parent_page_id] answers directly -- no reason to
    // page through the whole Doc and discard everything below the first level.
    expect(listPages).toHaveBeenCalledWith(expect.objectContaining({ parent_page_id: '1' }));
    expect(listPages.mock.calls[0][0]).not.toHaveProperty('root_page_id');
    expect(result.content[0].text).toContain('— 1 child page');
  });

  it('still cuts deeper levels off if the API returns them anyway', async () => {
    const getPage = vi.fn().mockResolvedValue(startPage('1', 'Doc'));
    const listPages = vi.fn().mockResolvedValue({
      data: [pageRow('2', 'Child', 1, 1), pageRow('3', 'Grandchild', 2, 1)],
      meta: { total_pages: 1 },
    });

    const result = await listPageChildrenTool(mockClient({ getPage, listPages }), {
      page_id: '1',
      max_depth: 1,
    });

    expect(result.content[0].text).toContain('— 1 child page');
    expect(result.content[0].text).not.toContain('Grandchild');
  });

  it('pages through a document that spans more than one response', async () => {
    const firstPage = Array.from({ length: 200 }, (_, i) =>
      pageRow(String(i + 100), `Bulk ${i}`, 1, 1),
    );
    const getPage = vi.fn().mockResolvedValue(startPage('1', 'Doc'));
    const listPages = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, meta: { total_pages: 2 } })
      .mockResolvedValueOnce({ data: [pageRow('999', 'Tail', 1, 1)], meta: { total_pages: 2 } });

    const result = await listPageChildrenTool(mockClient({ getPage, listPages }), { page_id: '1' });

    expect(listPages).toHaveBeenCalledTimes(2);
    expect(listPages).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(result.content[0].text).toContain('— 201 child pages');
    expect(result.content[0].text).toContain('Tail (ID: 999)');
  });

  it('says so when the sweep hits its ceiling instead of implying a complete tree', async () => {
    const full = Array.from({ length: 200 }, (_, i) => pageRow(String(i + 100), `Bulk ${i}`, 1, 1));
    const getPage = vi.fn().mockResolvedValue(startPage('1', 'Doc'));
    // No total_pages and always a full page: the sweep can only stop at its cap.
    const listPages = vi.fn().mockResolvedValue({ data: full });

    const result = await listPageChildrenTool(mockClient({ getPage, listPages }), { page_id: '1' });

    expect(listPages).toHaveBeenCalledTimes(10);
    expect(result.content[0].text).toContain('Incomplete');
  });

  it('carries each version number, so one call covers a whole document', async () => {
    const getPage = vi.fn().mockResolvedValue(startPage('1', 'Doc'));
    const listPages = vi.fn().mockResolvedValue({
      data: [pageRow('2', 'Mandat A', 1, 1, 4), pageRow('3', 'Mandat B', 1, 1, 1)],
      meta: { total_pages: 1 },
    });

    const result = await listPageChildrenTool(mockClient({ getPage, listPages }), { page_id: '1' });

    expect(getPage).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('Mandat A (ID: 2, v4)');
    expect(result.content[0].text).toContain('Mandat B (ID: 3, v1)');
  });

  it('reports a page with no children in words', async () => {
    const getPage = vi.fn().mockResolvedValue(startPage('1', 'Doc'));
    const listPages = vi.fn().mockResolvedValue({ data: [], meta: { total_pages: 1 } });

    const result = await listPageChildrenTool(mockClient({ getPage, listPages }), { page_id: '1' });

    expect(result.content[0].text).toContain('This page has no child pages.');
  });

  it('rejects a missing page_id before making a request', async () => {
    const getPage = vi.fn();
    const listPages = vi.fn();

    await expect(listPageChildrenTool(mockClient({ getPage, listPages }), {})).rejects.toThrow();
    expect(getPage).not.toHaveBeenCalled();
  });
});
