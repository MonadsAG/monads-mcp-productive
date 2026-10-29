import { z } from 'zod';
import type { ProductiveAPIClient } from './client.js';
import type { AttachmentUploadPolicy } from './types.js';

// Coerced: every policy field goes back verbatim as a form value, whatever type the API sends.
const CreatedAttachmentSchema = z.object({
  data: z.object({ attributes: z.object({ aws_policy: z.record(z.coerce.string()) }) }),
});
const UploadedAttachmentSchema = z.object({
  data: z.object({ attributes: z.object({ url: z.string().url() }) }),
});

/**
 * Images on doc pages, in two halves: upload the bytes as an attachment of the page, then
 * reference the attachment from the page body as Markdown. Runtime-neutral (fetch, FormData,
 * Blob), so the Worker could use it as well as the stdio package.
 */

/** From docs/api-spec/guides/working-with-attachments.md -- the signed policy names no bucket. */
export const ATTACHMENT_UPLOAD_URL =
  'https://productive-files-production.s3.eu-west-1.amazonaws.com';

export interface PageImageFile {
  name: string;
  contentType: string;
  data: Blob;
}

export interface UploadedPageImage {
  id: string;
  name: string;
  url: string;
}

/**
 * Steps 1-3 of the documented upload flow (create, S3 POST, `temp_url`), with the page as
 * the attachment's parent. A failure after step 1 deletes the record again rather than leave
 * an attachment without bytes on the page.
 */
export async function uploadPageImage(
  client: ProductiveAPIClient,
  pageId: string,
  file: PageImageFile,
): Promise<UploadedPageImage> {
  const created = await client.createPageAttachment(pageId, {
    name: file.name,
    contentType: file.contentType,
    size: file.data.size,
  });
  const id = created.data.id;

  try {
    const policy = CreatedAttachmentSchema.safeParse(created);
    if (!policy.success) {
      const reason = policy.error.issues[0]?.message ?? 'unexpected shape';
      throw new Error(`Productive returned no usable upload policy for ${file.name}: ${reason}`);
    }
    const location = await postToStorage(policy.data.data.attributes.aws_policy, file);
    const updated = UploadedAttachmentSchema.safeParse(
      await client.setAttachmentTempUrl(id, location),
    );
    if (!updated.success) {
      throw new Error(`Productive returned no URL for ${file.name} after the upload`);
    }
    return { id, name: file.name, url: updated.data.data.attributes.url };
  } catch (error) {
    await client
      .deleteAttachment(id)
      .catch(() => console.error(`Could not remove attachment ${id} after the failed upload`));
    throw error;
  }
}

/** Step 2: the form POST to S3. The signed policy is the authorisation, no Productive headers. */
async function postToStorage(policy: AttachmentUploadPolicy, file: PageImageFile): Promise<string> {
  const form = new FormData();
  for (const [field, value] of Object.entries(policy)) form.append(field, value);
  // S3 ignores every field after the file, so it goes last.
  form.append('File', file.data, file.name);

  const response = await fetch(ATTACHMENT_UPLOAD_URL, { method: 'POST', body: form });
  const xml = await response.text();
  if (!response.ok) {
    const code = /<Code>([^<]*)<\/Code>/.exec(xml)?.[1];
    throw new Error(
      `Upload of ${file.name} to storage failed with status ${response.status}${code ? ` (${code})` : ''}`,
    );
  }
  const location = /<Location>([^<]+)<\/Location>/.exec(xml)?.[1];
  if (!location) throw new Error(`Storage accepted ${file.name} but returned no Location`);
  return location.replace(/&amp;/g, '&');
}

/**
 * The Markdown that puts an uploaded image into a page body.
 *
 * OPEN POINT, not verified live for this upload path: that the image node's `src` should be the
 * attachment's `url`. Documented is only the syntax -- the Markdown proxy turns `![alt](url)` into
 * an `image` node (docs/api-spec/guides/document-format.md). Seen live (production org,
 * 2026-10-29): images pasted into a page in the web editor are stored with
 * `src: https://files.productive.io/attachments/files/<id>/original/<file>`, and writing that URL
 * back as `![alt](...)` through the proxy gave an `image` node with the same `src`. That an
 * attachment's `url` has this form is what tests/integration/page-images.integration.test.ts
 * checks; change it here if that test fails.
 */
export function pageImageMarkdown(image: UploadedPageImage): string {
  const alt = image.name.replace(/\.[^.]+$/, '').replace(/[[\]\\]/g, '\\$&');
  const spaced = image.url.replace(/ /g, '%20');
  // Balanced parentheses pass the proxy unchanged (seen live: image(1).png), so src stays the
  // attachment url; only unbalanced ones would end the link destination early.
  const url = balancedParentheses(spaced)
    ? spaced
    : spaced.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `![${alt}](${url})`;
}

function balancedParentheses(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth++;
    else if (char === ')' && --depth < 0) return false;
  }
  return depth === 0;
}
