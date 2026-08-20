/**
 * Mirror Productive's API guides into `docs/api-spec/guides/`.
 *
 *   npm run spec:guides
 *
 * The guides carry rules the OpenAPI spec does not: the custom-fields hash is
 * replaced rather than merged, how page bodies are written, the filtering
 * operators and header flags. Every guide is published as clean Markdown at
 * `{slug}.md`, so this is a copy, not a scrape.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUIDES_BASE = 'https://developer.productive.io/guides';
const SIDEBAR_URL = `${GUIDES_BASE}/sidebar`;
const GUIDES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'api-spec', 'guides');

/** Read the slugs off the sidebar so new guides show up on their own. */
async function fetchSlugs(): Promise<string[]> {
  const response = await fetch(SIDEBAR_URL);
  if (!response.ok) throw new Error(`${SIDEBAR_URL} returned HTTP ${response.status}`);
  const html = await response.text();
  const slugs = [...html.matchAll(/href="\/guides\/([a-z0-9-]+)"/g)].map((match) => match[1]);
  return [...new Set(slugs)].sort();
}

async function fetchGuide(slug: string): Promise<string> {
  const response = await fetch(`${GUIDES_BASE}/${slug}.md`);
  if (!response.ok) throw new Error(`${slug}: HTTP ${response.status}`);
  return await response.text();
}

export async function syncGuides(): Promise<number> {
  const slugs = await fetchSlugs();
  if (slugs.length === 0) throw new Error('No guide slugs found -- the sidebar markup changed');

  // Download everything before touching the directory, so a failure midway
  // cannot leave a half-emptied docs/api-spec/guides behind.
  const guides = new Map<string, string>();
  for (const slug of slugs) guides.set(slug, await fetchGuide(slug));

  rmSync(GUIDES_DIR, { recursive: true, force: true });
  mkdirSync(GUIDES_DIR, { recursive: true });
  for (const [slug, markdown] of guides) {
    const header = `<!-- Mirrored from ${GUIDES_BASE}/${slug} -- regenerate with \`npm run spec:guides\` -->\n\n`;
    writeFileSync(join(GUIDES_DIR, `${slug}.md`), header + markdown.trimEnd() + '\n');
  }
  return guides.size;
}

// Only run when invoked directly, not when sync-spec imports syncGuides().
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncGuides()
    .then((count) => console.log(`Synced ${count} guides.`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
