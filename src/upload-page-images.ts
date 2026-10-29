import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { getConfig } from './config/index.js';
import { ProductiveAPIClient } from './api/client.js';
import { pageImageMarkdown, uploadPageImage, type PageImageFile } from './api/page-images.js';

/**
 * `productive-mcp upload-page-images --page <page_id> <image>...`
 *
 * Uploads local images onto a doc page and prints one Markdown line per image, for update_page
 * to place in the body. A command rather than a tool: the server runs remotely (MCP hub,
 * Worker) and cannot read the caller's files, and a model cannot pass large images as tool
 * arguments. Same environment as the server: PRODUCTIVE_API_TOKEN and PRODUCTIVE_ORG_ID.
 */

export const USAGE =
  'Usage: npx -y @monadsag/productive-mcp@latest upload-page-images --page <page_id> <image>...';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Runs the command and returns the process exit code. */
export async function uploadPageImagesCommand(args: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { page: { type: 'string' } },
      allowPositionals: true,
    });
    const page = z.string().regex(/^\d+$/).safeParse(values.page);
    if (!page.success || positionals.length === 0) {
      console.error(USAGE);
      return 1;
    }
    // Read every file before uploading any, so a typo in the last path uploads nothing.
    const files = await Promise.all(positionals.map(readImage));
    const client = new ProductiveAPIClient(getConfig());
    for (const file of files) {
      const image = await uploadPageImage(client, page.data, file);
      // The lines are the result, not a log, and no MCP server runs in this mode: stdout is free.
      process.stdout.write(`${pageImageMarkdown(image)}\n`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A network failure says only "fetch failed"; the reason is in `cause`.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    console.error(cause ? `${message} (${cause})` : message);
    return 1;
  }
}

async function readImage(path: string): Promise<PageImageFile> {
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()];
  if (!contentType) throw new Error(`Not a PNG, JPEG, GIF or WebP image: ${path}`);
  const data = new Blob([await readFile(path)], { type: contentType });
  return { name: basename(path), contentType, data };
}
