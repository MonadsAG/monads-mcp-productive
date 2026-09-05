import type { ProductivePage } from './types.js';

/**
 * Assembling a page hierarchy out of a flat list.
 *
 * The nesting comes from the `parent_page_id` links, never from the request
 * that fetched the rows: `filter[root_page_id]` narrows *which* pages are
 * fetched, but says nothing about how they sit relative to each other. Keeping
 * the two apart is what lets one sweep of a Doc answer for any page inside it.
 *
 * No API access here on purpose -- this is the part worth testing without mocks.
 */

export interface PageNode {
  id: string;
  title: string;
  /** ISO timestamp of the last edit, when the API reported one. */
  editedAt?: string;
  /**
   * The page's version number.
   *
   * Carried per line so a caller can spot a concurrent edit without fetching
   * each page: `update_page` takes no version parameter, so anything doing a
   * read-modify-write has to compare version numbers itself, and `get_page`
   * would drag the whole document-format body along just to read this one
   * integer. Note it counts *body* changes only -- adding a child page moves
   * the parent's `edited_at` but leaves its version alone.
   */
  version?: number;
  children: PageNode[];
}

/** A page with no title set still has to be nameable in the output. */
export const UNTITLED = '(untitled)';

/**
 * Group pages by their parent id.
 *
 * Siblings are ordered by `position`, falling back to the title. The fallback
 * is the common case rather than the exception: `position` comes back null on
 * every page in the live orgs checked so far, and `sort=position` is rejected
 * by the API (400 `sort_param_unsupported`), so this is the only ordering
 * available.
 */
export function buildChildIndex(pages: ProductivePage[]): Map<string, ProductivePage[]> {
  const index = new Map<string, ProductivePage[]>();

  for (const page of pages) {
    const parentId = page.attributes?.parent_page_id;
    if (parentId == null) continue;
    const key = String(parentId);
    const siblings = index.get(key);
    if (siblings) siblings.push(page);
    else index.set(key, [page]);
  }

  for (const siblings of index.values()) {
    siblings.sort(compareSiblings);
  }

  return index;
}

function compareSiblings(a: ProductivePage, b: ProductivePage): number {
  const posA = a.attributes?.position;
  const posB = b.attributes?.position;
  if (typeof posA === 'number' && typeof posB === 'number' && posA !== posB) {
    return posA - posB;
  }
  if ((typeof posA === 'number') !== (typeof posB === 'number')) {
    // A page with a position set sorts ahead of one without.
    return typeof posA === 'number' ? -1 : 1;
  }
  return titleOf(a).localeCompare(titleOf(b));
}

function titleOf(page: ProductivePage): string {
  const title = page.attributes?.title;
  return typeof title === 'string' && title.trim() !== '' ? title : UNTITLED;
}

/**
 * Walk down from `rootId`, deepest-first, into a nested tree.
 *
 * `visited` is not defensive dressing: the parent links come off the wire, and
 * a cycle in them would otherwise spin here forever rather than return a wrong
 * answer. `maxDepth` counts levels below the starting page -- 1 means direct
 * children only.
 */
export function collectSubtree(
  rootId: string,
  index: Map<string, ProductivePage[]>,
  maxDepth = Number.POSITIVE_INFINITY,
): PageNode[] {
  const visited = new Set<string>([rootId]);

  const descend = (parentId: string, depth: number): PageNode[] => {
    if (depth > maxDepth) return [];
    const children = index.get(parentId) ?? [];
    const nodes: PageNode[] = [];

    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      nodes.push({
        id: child.id,
        title: titleOf(child),
        editedAt:
          typeof child.attributes?.edited_at === 'string' ? child.attributes.edited_at : undefined,
        version:
          typeof child.attributes?.version_number === 'number'
            ? child.attributes.version_number
            : undefined,
        children: descend(child.id, depth + 1),
      });
    }

    return nodes;
  };

  return descend(rootId, 1);
}

/** Total pages in the tree, all levels counted. */
export function countNodes(nodes: PageNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

/**
 * Render the tree with box-drawing connectors, one page per line.
 *
 * The last child of a group gets the corner and its descendants are indented
 * with blank space; every earlier one keeps a trailing bar so the column stays
 * connected down the page.
 */
export function renderTree(nodes: PageNode[], prefix = ''): string {
  return nodes
    .map((node, i) => {
      const last = i === nodes.length - 1;
      const line = `${prefix}${last ? '└─' : '├─'} ${formatNode(node)}`;
      if (node.children.length === 0) return line;
      const childPrefix = `${prefix}${last ? '   ' : '│  '}`;
      return `${line}\n${renderTree(node.children, childPrefix)}`;
    })
    .join('\n');
}

function formatNode(node: PageNode): string {
  const version = node.version != null ? `, v${node.version}` : '';
  const edited = node.editedAt ? ` — edited ${node.editedAt.slice(0, 10)}` : '';
  return `${node.title} (ID: ${node.id}${version})${edited}`;
}
