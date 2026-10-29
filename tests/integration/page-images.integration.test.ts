import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getConfig } from '../../src/config/index.js';
import { ProductiveAPIClient } from '../../src/api/client.js';
import {
  pageImageMarkdown,
  uploadPageImage,
  type UploadedPageImage,
} from '../../src/api/page-images.js';

/**
 * Live cover for what `upload-page-images` assumes but no guide documents: that
 * `attachable_type: 'page'` with `page_id` is accepted on the create and links
 * the attachment to the page, that the guide's S3 bucket takes the bytes, and
 * that the attachment's `url` is what an `image` node needs as `src` once the
 * Markdown line is written into the body.
 *
 * One 1x1 PNG onto a scratch page, the body rewritten with the printed line,
 * then the stored document read back. Writes to the org and cleans up in
 * afterAll -- point .dev.vars at a sandbox. Client construction is deferred to
 * beforeAll, as in the other suites.
 */
const PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

function imageNodes(node: DocNode): DocNode[] {
  const own = node.type === 'image' ? [node] : [];
  return [...own, ...(node.content ?? []).flatMap(imageNodes)];
}

describe.skipIf(!process.env.PRODUCTIVE_API_TOKEN)(
  'page images integration (live Productive.io org)',
  () => {
    let client: ProductiveAPIClient;
    let pageId: string | undefined;
    let image: UploadedPageImage | undefined;

    beforeAll(async () => {
      client = new ProductiveAPIClient(getConfig());

      const projects = await client.listProjects({ limit: 1 });
      expect(projects.data.length).toBeGreaterThan(0);

      const page = await client.createPage({
        data: {
          type: 'pages',
          attributes: {
            title: 'Integration Test Page Images',
            markdown: 'before',
            project_id: Number(projects.data[0].id),
          },
        },
      });
      pageId = page.data.id;

      image = await uploadPageImage(client, pageId, {
        name: 'pixel.png',
        contentType: 'image/png',
        data: new Blob([PIXEL_PNG], { type: 'image/png' }),
      });
      await client.replacePageBody(pageId, `caption\n\n${pageImageMarkdown(image)}\n`);
    });

    afterAll(async () => {
      if (image) {
        await client.deleteAttachment(image.id).catch((error) => {
          console.error(`[integration cleanup] failed to delete attachment ${image?.id}:`, error);
        });
      }
      if (pageId) {
        await client.deletePage(pageId).catch((error) => {
          console.error(`[integration cleanup] failed to delete page ${pageId}:`, error);
        });
      }
    });

    // Exactly one: an ignored filter would return the org's attachments (see
    // `filter[booking_type]` in CLAUDE.md), and the scratch page has only this one.
    it('links the attachment to the page through page_id', async () => {
      const attached = await client.listPageAttachments(pageId!);

      expect(attached.data.map((a) => a.id)).toEqual([image?.id]);
    });

    it('returns a files.productive.io url for the uploaded image', () => {
      expect(image?.url).toMatch(/^https:\/\/files\.productive\.io\/attachments\/files\//);
    });

    it('stores the printed Markdown line as an image node whose src is that url', async () => {
      const page = await client.getPage(pageId!);
      const doc = JSON.parse(page.data.attributes.body ?? '{}') as DocNode;
      const images = imageNodes(doc);

      expect(images).toHaveLength(1);
      expect(images[0].attrs?.src).toBe(image?.url);
    });
  },
);
