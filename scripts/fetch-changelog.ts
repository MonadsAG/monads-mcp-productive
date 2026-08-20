/**
 * List the dates of official changelog entries since a given day.
 *
 *   npm run --silent spec:changelog -- --since 2026-08-13
 *
 * Enrichment only: Productive publishes no feed (changelog.json/.rss/.atom all
 * return the HTML page), so this scrapes the entry headings and nothing else.
 * The authoritative change signal is our own spec diff, so any failure here
 * prints nothing and still exits 0.
 */

const CHANGELOG_URL = 'https://developer.productive.io/reference/changelog';
const HEADING = /<h2[^>]*>\s*([A-Z][a-z]+ \d{1,2}, \d{4})\s*<\/h2>/g;
const DEFAULT_WINDOW_DAYS = 8;

function sinceDate(): Date {
  const index = process.argv.indexOf('--since');
  const explicit = index === -1 ? undefined : process.argv[index + 1];
  if (explicit) return new Date(`${explicit}T00:00:00Z`);
  const fallback = new Date();
  fallback.setUTCDate(fallback.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return fallback;
}

async function main(): Promise<void> {
  const since = sinceDate();
  const response = await fetch(CHANGELOG_URL);
  if (!response.ok) return;
  const html = await response.text();

  const entries: string[] = [];
  for (const match of html.matchAll(HEADING)) {
    const label = match[1];
    const date = new Date(`${label} UTC`);
    if (Number.isNaN(date.getTime()) || date < since) continue;
    if (!entries.includes(label)) entries.push(label);
  }
  if (entries.length === 0) return;

  console.log(
    `### 📋 Official changelog (${entries.length} entries since ${since.toISOString().slice(0, 10)})`,
  );
  console.log('');
  for (const entry of entries) console.log(`- ${entry}`);
  console.log('');
  console.log(`Full text: <${CHANGELOG_URL}>`);
}

main().catch(() => {
  /* enrichment only -- never fail the sync over the changelog page */
});
