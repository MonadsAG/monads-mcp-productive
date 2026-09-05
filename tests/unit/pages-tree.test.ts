import { describe, it, expect } from 'vitest';
import type { ProductivePage } from '../../src/api/types.js';
import {
  buildChildIndex,
  collectSubtree,
  countNodes,
  renderTree,
  UNTITLED,
} from '../../src/api/pages-tree.js';

function page(
  id: string,
  attrs: {
    title?: string;
    parent?: number;
    position?: number;
    edited?: string;
    version?: number;
  } = {},
): ProductivePage {
  return {
    id,
    type: 'pages',
    attributes: {
      title: attrs.title ?? `page ${id}`,
      parent_page_id: attrs.parent,
      position: attrs.position,
      edited_at: attrs.edited,
      version_number: attrs.version,
      created_at: '2026-01-01T00:00:00+00:00',
      updated_at: '2026-01-01T00:00:00+00:00',
    },
  } as ProductivePage;
}

describe('buildChildIndex', () => {
  it('groups pages under their parent and ignores root pages', () => {
    const index = buildChildIndex([page('1'), page('2', { parent: 1 }), page('3', { parent: 1 })]);

    expect([...index.keys()]).toEqual(['1']);
    expect(index.get('1')?.map((p) => p.id)).toEqual(['2', '3']);
  });

  it('orders siblings by position when it is set', () => {
    const index = buildChildIndex([
      page('9', { parent: 1, position: 30 }),
      page('7', { parent: 1, position: 10 }),
      page('8', { parent: 1, position: 20 }),
    ]);

    expect(index.get('1')?.map((p) => p.id)).toEqual(['7', '8', '9']);
  });

  it('falls back to the title when position is null -- the live default', () => {
    const index = buildChildIndex([
      page('9', { parent: 1, title: 'Zebra' }),
      page('7', { parent: 1, title: 'Apple' }),
    ]);

    expect(index.get('1')?.map((p) => p.id)).toEqual(['7', '9']);
  });

  it('sorts a positioned page ahead of an unpositioned one', () => {
    const index = buildChildIndex([
      page('9', { parent: 1, title: 'Apple' }),
      page('7', { parent: 1, title: 'Zebra', position: 5 }),
    ]);

    expect(index.get('1')?.map((p) => p.id)).toEqual(['7', '9']);
  });
});

describe('collectSubtree', () => {
  const doc = [
    page('2', { parent: 1, title: 'Child' }),
    page('3', { parent: 2, title: 'Grandchild' }),
    page('4', { parent: 3, title: 'Great-grandchild' }),
    page('5', { parent: 99, title: 'Elsewhere' }),
  ];

  it('nests the whole subtree by default', () => {
    const tree = collectSubtree('1', buildChildIndex(doc));

    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe('Child');
    expect(tree[0].children[0].title).toBe('Grandchild');
    expect(tree[0].children[0].children[0].title).toBe('Great-grandchild');
    expect(countNodes(tree)).toBe(3);
  });

  it('stops at max_depth, 1 meaning direct children only', () => {
    const tree = collectSubtree('1', buildChildIndex(doc), 1);

    expect(countNodes(tree)).toBe(1);
    expect(tree[0].children).toEqual([]);
  });

  it('starts from a page in the middle of the hierarchy', () => {
    const tree = collectSubtree('2', buildChildIndex(doc));

    expect(tree.map((n) => n.title)).toEqual(['Grandchild']);
    expect(countNodes(tree)).toBe(2);
  });

  it('returns nothing for a page with no children', () => {
    expect(collectSubtree('4', buildChildIndex(doc))).toEqual([]);
  });

  it('terminates on a cycle in the parent chain instead of recursing forever', () => {
    // 2 -> 3 -> 2: only reachable if the API hands back a broken chain, but it
    // must not hang the Worker if it does.
    const cyclic = [page('2', { parent: 3 }), page('3', { parent: 2 })];
    const tree = collectSubtree('2', buildChildIndex(cyclic));

    expect(countNodes(tree)).toBe(1);
    expect(tree[0].id).toBe('3');
  });

  it('names an untitled page rather than rendering a blank line', () => {
    const tree = collectSubtree('1', buildChildIndex([page('2', { parent: 1, title: '  ' })]));

    expect(tree[0].title).toBe(UNTITLED);
  });
});

describe('renderTree', () => {
  it('connects siblings and indents their descendants', () => {
    const tree = collectSubtree(
      '1',
      buildChildIndex([
        page('2', { parent: 1, title: 'First', position: 1 }),
        page('3', { parent: 2, title: 'Nested' }),
        page('4', { parent: 1, title: 'Last', position: 2 }),
      ]),
    );

    expect(renderTree(tree)).toBe(
      ['├─ First (ID: 2)', '│  └─ Nested (ID: 3)', '└─ Last (ID: 4)'].join('\n'),
    );
  });

  it('shows the edit date as a plain day', () => {
    const tree = collectSubtree(
      '1',
      buildChildIndex([
        page('2', { parent: 1, title: 'Seite 1', edited: '2026-09-05T22:45:01.862+02:00' }),
      ]),
    );

    expect(renderTree(tree)).toBe('└─ Seite 1 (ID: 2) — edited 2026-09-05');
  });

  // The version travels per line so a read-modify-write can spot a concurrent
  // edit across a whole document without a get_page (and its body) per page.
  it('carries the version number next to the id', () => {
    const tree = collectSubtree(
      '1',
      buildChildIndex([
        page('2', { parent: 1, title: 'Seite 1', version: 3, edited: '2026-09-05T22:45:01+02:00' }),
      ]),
    );

    expect(tree[0].version).toBe(3);
    expect(renderTree(tree)).toBe('└─ Seite 1 (ID: 2, v3) — edited 2026-09-05');
  });

  it('leaves the version out when the API reported none', () => {
    const tree = collectSubtree('1', buildChildIndex([page('2', { parent: 1, title: 'Seite 1' })]));

    expect(tree[0].version).toBeUndefined();
    expect(renderTree(tree)).toBe('└─ Seite 1 (ID: 2)');
  });
});
