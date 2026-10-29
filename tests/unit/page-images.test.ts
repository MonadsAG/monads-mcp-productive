import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProductiveAPIClient } from '../../src/api/client.js';
import {
  ATTACHMENT_UPLOAD_URL,
  pageImageMarkdown,
  uploadPageImage,
} from '../../src/api/page-images.js';
import type { Config } from '../../src/config/index.js';

const API = 'https://api.productive.io/api/v2/';
const POLICY = {
  key: 'attachments/files/1/original/a.png',
  policy: 'cG9saWN5',
  'x-amz-signature': 'sig',
};
const LOCATION_XML =
  '<PostResponse><Location>https://productive-files-production.s3.amazonaws.com/a.png?x=1&amp;y=2</Location></PostResponse>';
const STORED_URL = 'https://files.productive.io/attachments/files/1/original/a.png?1';

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function attachment(attributes: Record<string, unknown>) {
  return { data: { id: '55', type: 'attachments', attributes: { name: 'a.png', ...attributes } } };
}

/** Answers like Productive and S3 do on the happy path; `overrides` replaces single steps. */
function stubFetch(overrides: { storage?: Response; create?: Response } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === ATTACHMENT_UPLOAD_URL)
      return overrides.storage ?? new Response(LOCATION_XML, { status: 201 });
    if (url === `${API}attachments` && init?.method === 'POST')
      return overrides.create ?? json(attachment({ aws_policy: POLICY }), 201);
    if (url === `${API}attachments/55` && init?.method === 'PATCH')
      return json(attachment({ url: STORED_URL }));
    if (url === `${API}attachments/55` && init?.method === 'DELETE')
      return new Response(null, { status: 204 });
    throw new Error(`unexpected ${init?.method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeClient(): ProductiveAPIClient {
  return new ProductiveAPIClient({
    PRODUCTIVE_API_TOKEN: 'token',
    PRODUCTIVE_ORG_ID: 'org',
    PRODUCTIVE_API_BASE_URL: API,
  } as unknown as Config);
}

const png = () => ({
  name: 'a.png',
  contentType: 'image/png',
  data: new Blob([new Uint8Array(3)]),
});

const calls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${url.replace(API, '')}`);

describe('uploadPageImage', () => {
  it('creates the attachment on the page, posts the bytes to S3 and records the location', async () => {
    const fetchMock = stubFetch();

    const image = await uploadPageImage(makeClient(), '725358', png());

    expect(image).toEqual({ id: '55', name: 'a.png', url: STORED_URL });
    expect(calls(fetchMock)).toEqual([
      'POST attachments',
      `POST ${ATTACHMENT_UPLOAD_URL}`,
      'PATCH attachments/55',
    ]);
    const created = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(created.data.attributes).toEqual({
      name: 'a.png',
      content_type: 'image/png',
      size: 3,
      attachable_type: 'page',
      page_id: 725358,
    });
    const patched = JSON.parse(fetchMock.mock.calls[2][1]?.body as string);
    expect(patched.data.attributes.temp_url).toBe(
      'https://productive-files-production.s3.amazonaws.com/a.png?x=1&y=2',
    );
  });

  it('sends every policy field verbatim, the file last and no Productive headers to S3', async () => {
    const fetchMock = stubFetch();

    await uploadPageImage(makeClient(), '1', png());

    const init = fetchMock.mock.calls[1][1];
    const form = init?.body as FormData;
    expect([...form.keys()]).toEqual(['key', 'policy', 'x-amz-signature', 'File']);
    expect(form.get('x-amz-signature')).toBe('sig');
    expect((form.get('File') as File).name).toBe('a.png');
    expect(init?.headers).toBeUndefined();
  });

  it('deletes the attachment again when S3 refuses the upload', async () => {
    const refused = new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    const fetchMock = stubFetch({ storage: refused });

    await expect(uploadPageImage(makeClient(), '1', png())).rejects.toThrow(
      'Upload of a.png to storage failed with status 403 (AccessDenied)',
    );
    expect(calls(fetchMock).at(-1)).toBe('DELETE attachments/55');
  });

  it('deletes the attachment again when the create response carries no upload policy', async () => {
    const fetchMock = stubFetch({ create: json(attachment({}), 201) });

    await expect(uploadPageImage(makeClient(), '1', png())).rejects.toThrow(
      'no usable upload policy',
    );
    expect(calls(fetchMock)).toEqual(['POST attachments', 'DELETE attachments/55']);
  });
});

describe('pageImageMarkdown', () => {
  it('uses the file name without extension as alt text and the attachment URL as source', () => {
    expect(pageImageMarkdown({ id: '1', name: 'heute-wege.png', url: STORED_URL })).toBe(
      `![heute-wege](${STORED_URL})`,
    );
  });

  it('escapes what would break the Markdown image syntax and keeps balanced parentheses', () => {
    const image = { id: '1', name: 'a [b].png', url: 'https://x.test/a (1).png' };
    expect(pageImageMarkdown(image)).toBe('![a \\[b\\]](https://x.test/a%20(1).png)');
  });

  it('encodes unbalanced parentheses, which would end the link early', () => {
    expect(pageImageMarkdown({ id: '1', name: 'a).png', url: 'https://x.test/a).png' })).toBe(
      '![a)](https://x.test/a%29.png)',
    );
    expect(pageImageMarkdown({ id: '1', name: 'b.png', url: 'https://x.test/)b(.png' })).toBe(
      '![b](https://x.test/%29b%28.png)',
    );
  });
});
