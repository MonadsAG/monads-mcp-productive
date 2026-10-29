import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ATTACHMENT_UPLOAD_URL } from '../../src/api/page-images.js';
import { USAGE, uploadPageImagesCommand } from '../../src/upload-page-images.js';

let dir: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'page-images-'));
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(console, 'error').mockImplementation((message) => {
    stderr.push(String(message));
  });
  vi.stubEnv('PRODUCTIVE_API_TOKEN', 'token');
  vi.stubEnv('PRODUCTIVE_ORG_ID', 'org');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function file(name: string): string {
  const path = join(dir, name);
  writeFileSync(path, new Uint8Array([137, 80, 78, 71]));
  return path;
}

/** Every upload succeeds; the attachment id counts up per create call. */
function stubFetch() {
  let id = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === ATTACHMENT_UPLOAD_URL)
      return new Response('<Location>https://s3.test/x</Location>', { status: 201 });
    const name =
      init?.method === 'POST' ? JSON.parse(init.body as string).data.attributes.name : '';
    const attributes =
      init?.method === 'POST'
        ? { name, aws_policy: { key: 'k' } }
        : { name: 'x', url: `https://files.productive.io/${id}` };
    if (init?.method === 'POST') id += 1;
    return new Response(
      JSON.stringify({ data: { id: String(id), type: 'attachments', attributes } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('upload-page-images command', () => {
  it('uploads each image and prints one Markdown line per image, in argument order', async () => {
    stubFetch();

    const code = await uploadPageImagesCommand([
      '--page',
      '725358',
      file('one.png'),
      file('two.JPG'),
    ]);

    expect(code).toBe(0);
    expect(stdout).toEqual([
      '![one](https://files.productive.io/1)\n',
      '![two](https://files.productive.io/2)\n',
    ]);
  });

  it.each([
    ['no page', ['a.png']],
    ['a page id that is not a number', ['--page', 'abc', 'a.png']],
    ['no image', ['--page', '1']],
  ])('prints the usage for %s', async (_, args) => {
    const fetchMock = stubFetch();

    expect(await uploadPageImagesCommand(args)).toBe(1);
    expect(stderr).toEqual([USAGE]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads nothing when one of the files is not an image it handles', async () => {
    const fetchMock = stubFetch();

    const code = await uploadPageImagesCommand(['--page', '1', file('a.png'), file('b.svg')]);

    expect(code).toBe(1);
    expect(stderr[0]).toContain('Not a PNG, JPEG, GIF or WebP image');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads nothing when one of the files is missing', async () => {
    const fetchMock = stubFetch();

    const code = await uploadPageImagesCommand(['--page', '1', file('a.png'), join(dir, 'b.png')]);

    expect(code).toBe(1);
    expect(stderr[0]).toContain('ENOENT');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
