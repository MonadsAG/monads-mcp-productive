import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getConfig } from '../../src/config/index.js';
import { ProductiveAPIClient } from '../../src/api/client.js';
import { listPageChildrenTool } from '../../src/tools/page-children.js';

/**
 * Live cover for the one assumption `list_page_children` is built on.
 *
 * The tool sweeps a whole Doc with a single `filter[root_page_id]` request and
 * assembles the nesting from the `parent_page_id` links afterwards. That only
 * works if a *grandchild* carries the top Doc's id in `root_page_id` rather
 * than its own parent's. Both live orgs happened to hold nothing but two-level
 * documents, where root and parent coincide and the question cannot be
 * answered by observation -- so this file builds a three-level document and
 * checks it directly. A probe on 2026-09-05 (sandbox) confirmed it; this is
 * what notices if Productive ever changes it, since the tool would then
 * silently drop every page below the second level.
 *
 * It also pins the two facts measured alongside it: `filter[root_page_id]`
 * really filters (an accepted filter is not necessarily an effective one --
 * see `filter[booking_type]` in CLAUDE.md), and the root page is not part of
 * its own result.
 *
 * Writes to the org and cleans up in afterAll -- point .dev.vars at a sandbox.
 * Client construction is deferred to beforeAll on purpose: describe.skipIf
 * still runs the describe body during collection, so an eager getConfig()
 * would fail the file instead of skipping it.
 */
describe.skipIf(!process.env.PRODUCTIVE_API_TOKEN)(
  'page hierarchy integration (live Productive.io org)',
  () => {
    let client: ProductiveAPIClient;
    const createdPageIds: string[] = [];

    let rootId: string;
    let childId: string;
    let grandchildId: string;

    beforeAll(async () => {
      client = new ProductiveAPIClient(getConfig());

      const projects = await client.listProjects({ limit: 1 });
      expect(projects.data.length).toBeGreaterThan(0);

      const root = await client.createPage({
        data: {
          type: 'pages',
          attributes: {
            title: 'Integration Test Doc',
            markdown: 'root',
            project_id: Number(projects.data[0].id),
          },
        },
      });
      rootId = root.data.id;
      createdPageIds.push(rootId);

      const child = await client.createPage({
        data: {
          type: 'pages',
          attributes: {
            title: 'Integration Test Child',
            markdown: 'child',
            parent_page_id: Number(rootId),
            root_page_id: Number(rootId),
          },
        },
      });
      childId = child.data.id;
      createdPageIds.push(childId);

      const grandchild = await client.createPage({
        data: {
          type: 'pages',
          attributes: {
            title: 'Integration Test Grandchild',
            markdown: 'grandchild',
            parent_page_id: Number(childId),
            root_page_id: Number(rootId),
          },
        },
      });
      grandchildId = grandchild.data.id;
      createdPageIds.push(grandchildId);
    });

    afterAll(async () => {
      // Deepest first -- a parent that still has children may refuse to go.
      const ids = [...createdPageIds].reverse();
      createdPageIds.length = 0;
      for (const id of ids) {
        await client.deletePage(id).catch((error) => {
          console.error(`[integration cleanup] failed to delete page ${id}:`, error);
        });
      }
    });

    it('gives a grandchild the top Doc as its root_page_id, not its parent', async () => {
      const grandchild = await client.getPage(grandchildId);

      expect(String(grandchild.data.attributes.root_page_id)).toBe(rootId);
      expect(String(grandchild.data.attributes.parent_page_id)).toBe(childId);
    });

    it('returns every level from one filter[root_page_id] request, excluding the root', async () => {
      const response = await client.listPages({ root_page_id: rootId, limit: 200, sort: 'id' });
      const ids = response.data.map((p) => p.id);

      expect(ids).toContain(childId);
      expect(ids).toContain(grandchildId);
      // The root Doc has root_page_id: null, so it never matches its own filter.
      expect(ids).not.toContain(rootId);
    });

    // An accepted filter is not necessarily an effective one (see
    // `filter[booking_type]` in CLAUDE.md), and `max_depth: 1` relies on this
    // one to answer in a single request instead of sweeping the whole Doc.
    // Asserting the exact set rather than "contains the child" is what makes
    // the test fail if the filter were ignored: an unfiltered response would
    // come back with the whole org's pages.
    it('returns only the direct children from a filter[parent_page_id] request', async () => {
      const response = await client.listPages({ parent_page_id: rootId, limit: 200, sort: 'id' });

      expect(response.data.map((p) => p.id)).toEqual([childId]);
    });

    it('renders the full subtree from the root Doc', async () => {
      const result = await listPageChildrenTool(client, { page_id: rootId });
      const text = result.content[0].text;

      expect(text).toContain('2 child pages');
      expect(text).toContain(`Integration Test Child (ID: ${childId}`);
      expect(text).toContain(`Integration Test Grandchild (ID: ${grandchildId}`);
      // The grandchild is indented under the child, not listed as a sibling.
      expect(text).toMatch(
        new RegExp(`\\n\\s+└─ Integration Test Grandchild \\(ID: ${grandchildId}`),
      );
    });

    it('reports the version straight from the list response once a page has one', async () => {
      // A page created through create_with_markdown has version_number: null
      // until its body is actually edited -- confirmed live, and true of the
      // single GET too, so it is not an artefact of the sparse fieldset.
      const before = await listPageChildrenTool(client, { page_id: rootId });
      expect(before.content[0].text).toContain(`Integration Test Child (ID: ${childId})`);

      await client.replacePageBody(childId, 'edited once');

      const after = await listPageChildrenTool(client, { page_id: rootId });
      // The number comes out of the sweep, not a get_page per row: that is the
      // whole point of carrying it, so a caller can check a document for
      // concurrent edits in one call.
      expect(after.content[0].text).toMatch(
        new RegExp(`Integration Test Child \\(ID: ${childId}, v\\d+\\)`),
      );
    });

    it('stops at max_depth', async () => {
      const result = await listPageChildrenTool(client, { page_id: rootId, max_depth: 1 });
      const text = result.content[0].text;

      expect(text).toContain('1 child page');
      expect(text).toContain(`Integration Test Child (ID: ${childId}`);
      expect(text).not.toContain('Integration Test Grandchild');
    });

    it('works from a page in the middle of the hierarchy', async () => {
      const result = await listPageChildrenTool(client, { page_id: childId });
      const text = result.content[0].text;

      expect(text).toContain('1 child page');
      expect(text).toContain(`Integration Test Grandchild (ID: ${grandchildId}`);
    });

    it('reports a leaf page as having no children', async () => {
      const result = await listPageChildrenTool(client, { page_id: grandchildId });

      expect(result.content[0].text).toContain('no child pages');
    });
  },
);
