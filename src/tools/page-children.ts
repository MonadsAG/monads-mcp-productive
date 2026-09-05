import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import type { ProductivePage } from '../api/types.js';
import {
  buildChildIndex,
  collectSubtree,
  countNodes,
  renderTree,
  UNTITLED,
} from '../api/pages-tree.js';
import { toMcpError } from '../utils/errors.js';

/** Largest page size the API accepts. */
const SWEEP_PAGE_SIZE = 200;

/** Ceiling on the sweep, so one enormous Doc cannot exhaust the Worker's subrequest budget. */
const MAX_SWEEP_PAGES = 10;

/**
 * Everything the tree needs, and nothing else.
 *
 * Without a sparse fieldset the collection response ships each page's full
 * `body` -- a whole document-format JSON document per row -- so a 200-page
 * sweep would move megabytes to render a list of titles.
 */
const SWEEP_FIELDS = [
  'title',
  'parent_page_id',
  'root_page_id',
  'position',
  'edited_at',
  'version_number',
];

const listPageChildrenSchema = z.object({
  page_id: z.string().min(1, 'Page ID is required'),
  max_depth: z.coerce.number().int().min(1).max(10).optional(),
});

interface SweepResult {
  pages: ProductivePage[];
  truncated: boolean;
}

/** Which slice of the hierarchy the sweep asks the API for. */
type SweepScope = { root_page_id: string } | { parent_page_id: string };

/**
 * Fetch every page in scope, one request per page of results.
 *
 * One sweep for the whole Doc rather than a request per level: the tree is
 * assembled from the `parent_page_id` links afterwards, so depth costs nothing
 * extra. Sequential on purpose -- whether page n+1 exists is only known after
 * page n, and serialising keeps the request rate flat.
 */
async function collectDocPages(
  client: ProductiveAPIClient,
  scope: SweepScope,
  maxPages = MAX_SWEEP_PAGES,
): Promise<SweepResult> {
  const pages: ProductivePage[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    // A fixed sort is what makes paging safe: without one the order across
    // pages is not guaranteed and rows duplicate or vanish at the boundaries.
    // `id` because `sort=position` is rejected by the API (400).
    const response = await client.listPages({
      ...scope,
      fields: SWEEP_FIELDS,
      limit: SWEEP_PAGE_SIZE,
      page,
      sort: 'id',
    });

    const rows = response.data ?? [];
    pages.push(...rows);

    const totalPages = response.meta?.total_pages;
    if (typeof totalPages === 'number' && page >= totalPages) break;
    // A short page is the last one, whether or not meta said so.
    if (rows.length < SWEEP_PAGE_SIZE) break;
    if (page === maxPages) return { pages, truncated: true };
  }

  return { pages, truncated: false };
}

export async function listPageChildrenTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listPageChildrenSchema.parse(args);

    // Also validates the id: an unknown page 404s here rather than coming back
    // as a silently empty tree. This one response carries a body we do not
    // need, and there is no way to decline it -- see getPage.
    const startResponse = await client.getPage(params.page_id);
    const start = startResponse.data;
    const startTitle = start.attributes?.title?.trim() || UNTITLED;

    // A root Doc carries no root_page_id -- it *is* the root. Every other page
    // names the top Doc, so one sweep covers the whole hierarchy either way.
    const rootId = start.attributes?.root_page_id
      ? String(start.attributes.root_page_id)
      : params.page_id;

    // `max_depth: 1` wants nothing but the direct children, and the API selects
    // those itself (verified live in the integration suite that the filter
    // really filters). Scoping to the Doc would page through every page in it
    // -- up to ten requests -- to then throw all but one level away.
    const scope: SweepScope =
      params.max_depth === 1 ? { parent_page_id: params.page_id } : { root_page_id: rootId };

    const { pages, truncated } = await collectDocPages(client, scope);
    const tree = collectSubtree(params.page_id, buildChildIndex(pages), params.max_depth);

    return {
      content: [{ type: 'text', text: format(startTitle, params.page_id, tree, truncated) }],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

function format(
  title: string,
  pageId: string,
  tree: ReturnType<typeof collectSubtree>,
  truncated: boolean,
): string {
  const header = `${title} (ID: ${pageId})`;

  if (tree.length === 0) {
    return truncated
      ? `${header}\n\nNo child pages found -- but the document exceeded ${MAX_SWEEP_PAGES * SWEEP_PAGE_SIZE} pages, so this is not conclusive.`
      : `${header}\n\nThis page has no child pages.`;
  }

  const total = countNodes(tree);
  const warning = truncated
    ? `\n\nIncomplete: the sweep stopped at ${MAX_SWEEP_PAGES * SWEEP_PAGE_SIZE} pages, so deeper or later pages may be missing.`
    : '';

  return `${header} — ${total} child page${total !== 1 ? 's' : ''}\n\n${renderTree(tree)}${warning}`;
}

export const listPageChildrenDefinition = {
  name: 'list_page_children',
  description:
    "List every page nested under one document page, as an indented tree. Recurses through the whole subtree by default -- children, grandchildren and deeper -- showing each page's title, ID, version number and last-edited date, but no body content. Works both for a top-level Doc and for a page in the middle of a hierarchy. The version number makes it possible to detect a concurrent edit across a whole document in one call, since update_page takes no version parameter. Use max_depth to stop at a given level (1 = direct children only), then get_page for the body of any page listed.",
  inputSchema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'ID of the page whose children to list (required)',
      },
      max_depth: {
        type: 'number',
        description:
          'How many levels below the page to include (1-10, default: the entire subtree). 1 returns only direct children.',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['page_id'],
  },
  annotations: {
    title: 'List page children',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};
