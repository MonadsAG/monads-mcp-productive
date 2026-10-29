import type { ProductiveAPIClient } from './client.js';
import type { AttachmentUploadPolicy } from './types.js';

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
    const policy = created.data.attributes.aws_policy;
    if (!policy) throw new Error(`Productive returned no upload policy for ${file.name}`);
    const location = await postToStorage(policy, file);
    const updated = await client.setAttachmentTempUrl(id, location);
    const url = updated.data.attributes.url;
    if (!url) throw new Error(`Productive returned no URL for ${file.name} after the upload`);
    return { id, name: file.name, url };
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
 * OPEN POINT, not verified live: that the image node's `src` should be the attachment's `url`.
 * Documented is only the syntax -- the Markdown proxy turns `![alt](url)` into an `image` node
 * (docs/api-spec/guides/document-format.md). Which URL an uploaded file needs there is not
 * documented; `url` is the only one the API returns for it. Change it here if the live check
 * shows the editor stores something else.
 */
export function pageImageMarkdown(image: UploadedPageImage): string {
  const alt = image.name.replace(/\.[^.]+$/, '').replace(/[[\]\\]/g, '\\$&');
  // These three would end or break a Markdown link destination.
  const url = image.url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `![${alt}](${url})`;
}
