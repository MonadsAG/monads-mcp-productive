/**
 * Download the official Productive.io OpenAPI spec and split it into the
 * per-resource files under `docs/api-spec/`.
 *
 *   npm run spec:sync
 *   npm run spec:sync -- --summary-out /tmp/summary.md
 *
 * Replaces the old HTML scraper: Productive publishes the real spec at
 * `/reference/download_spec`, so there is nothing left to scrape.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import {
  API_PREFIX,
  HTTP_METHODS,
  type OpenApiSpec,
  SPEC_URL,
  compactFilters,
  dumpYaml,
  loadSpec,
  normalisePath,
  refClosure,
  resourceKeyByPath,
  tagToSlug,
} from './lib/spec.ts';
import { syncGuides } from './sync-guides.ts';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'api-spec');
const SPEC_FILE = join(SPEC_DIR, 'productive-openapi.yaml');
const RESOURCES_DIR = join(SPEC_DIR, 'resources');
const ETAG_FILE = join(SPEC_DIR, '.spec-etag');
const CHANGELOG_FILE = join(SPEC_DIR, 'CHANGELOG.md');

/** `Reports` bundles 25 endpoints and 181 schemas -- one file per report instead. */
const SPLIT_PER_PATH = new Set(['Reports']);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

// --- download ---------------------------------------------------------------

async function download(): Promise<{ body: Buffer; etag: string | null } | 'unchanged'> {
  const headers: Record<string, string> = {};
  if (existsSync(ETAG_FILE)) headers['If-None-Match'] = readFileSync(ETAG_FILE, 'utf8').trim();

  const response = await fetch(SPEC_URL, { headers });
  if (response.status === 304) return 'unchanged';
  if (!response.ok) throw new Error(`${SPEC_URL} returned HTTP ${response.status}`);

  return {
    body: Buffer.from(await response.arrayBuffer()),
    etag: response.headers.get('etag'),
  };
}

// --- splitting --------------------------------------------------------------

type PathItem = Record<string, unknown>;

function groupByTag(spec: OpenApiSpec): Map<string, Record<string, PathItem>> {
  const groups = new Map<string, Record<string, PathItem>>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method] as { tags?: string[] } | undefined;
      if (!operation || typeof operation !== 'object') continue;
      for (const tag of operation.tags ?? ['untagged']) {
        const group = groups.get(tag) ?? {};
        group[path] = { ...(group[path] ?? {}), [method]: operation };
        groups.set(tag, group);
      }
    }
  }
  return groups;
}

const isFilterSchema = (name: string): boolean =>
  name.startsWith('filter_') || name.startsWith('_filter_root_');

/**
 * Build one self-contained resource document: the operations, a compact
 * `x-filters` block, and the transitive schema closure minus the filter
 * schemas that `x-filters` replaces.
 */
function buildResourceDoc(
  spec: OpenApiSpec,
  title: string,
  description: string | undefined,
  paths: Record<string, PathItem>,
  resourceKeys: Map<string, string>,
): Record<string, unknown> {
  const closure = refClosure(Object.values(paths), spec.components);

  const components: Record<string, Record<string, unknown>> = {};
  for (const { section, name } of closure) {
    if (section === 'schemas' && isFilterSchema(name)) continue;
    const value = spec.components[section]?.[name];
    if (value === undefined) continue;
    components[section] ??= {};
    components[section][name] = value;
  }

  // Collect the filter keys for every resource this file covers.
  const filters: Record<string, unknown> = {};
  for (const path of Object.keys(paths)) {
    const key = resourceKeys.get(normalisePath(path));
    if (!key || filters[key]) continue;
    const compact = compactFilters(spec.components.schemas?.[`filter_${key}`]);
    if (Object.keys(compact).length > 0) filters[key] = compact;
  }

  // `parameters/filter_*` still points at the schemas we just dropped -- swap in
  // a pointer to x-filters so no ref dangles.
  for (const name of Object.keys(components.parameters ?? {})) {
    if (!name.startsWith('filter_')) continue;
    const param = components.parameters[name] as Record<string, unknown>;
    components.parameters[name] = {
      ...param,
      schema: {
        type: 'object',
        description: `Filter keys and their operators are listed under x-filters.${name.slice('filter_'.length)} at the top of this file.`,
      },
    };
  }

  const doc: Record<string, unknown> = {
    openapi: spec.openapi,
    info: { title: `Productive.io API – ${title}`, version: '2.0.0' },
  };
  if (description) doc.description = description;
  if (Object.keys(filters).length > 0) doc['x-filters'] = filters;
  doc.paths = paths;
  doc.components = components;
  return doc;
}

function operationList(paths: Record<string, PathItem>): string[] {
  const out: string[] = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      if (item[method]) out.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return out.sort();
}

interface IndexEntry {
  file: string;
  description?: string;
  operations: string[];
}

function writeResources(spec: OpenApiSpec): { index: Record<string, IndexEntry>; files: number } {
  rmSync(RESOURCES_DIR, { recursive: true, force: true });
  mkdirSync(RESOURCES_DIR, { recursive: true });

  const tagDescriptions = new Map((spec.tags ?? []).map((t) => [t.name, t.description]));
  const resourceKeys = resourceKeyByPath(spec);
  const index: Record<string, IndexEntry> = {};
  let files = 0;

  for (const [tag, paths] of [...groupByTag(spec)].sort(([a], [b]) => a.localeCompare(b))) {
    const slug = tagToSlug(tag);

    if (SPLIT_PER_PATH.has(tag)) {
      mkdirSync(join(RESOURCES_DIR, slug), { recursive: true });
      for (const [path, item] of Object.entries(paths)) {
        const leaf = normalisePath(path).replace(`${API_PREFIX}/${slug}/`, '').replace(/\//g, '_');
        const doc = buildResourceDoc(
          spec,
          `${tag} – ${leaf}`,
          undefined,
          { [path]: item },
          resourceKeys,
        );
        writeFileSync(join(RESOURCES_DIR, slug, `${leaf}.yaml`), dumpYaml(doc));
        index[`${slug}/${leaf}`] = {
          file: `${slug}/${leaf}.yaml`,
          operations: operationList({ [path]: item }),
        };
        files += 1;
      }
      continue;
    }

    const doc = buildResourceDoc(spec, tag, tagDescriptions.get(tag), paths, resourceKeys);
    writeFileSync(join(RESOURCES_DIR, `${slug}.yaml`), dumpYaml(doc));
    const entry: IndexEntry = { file: `${slug}.yaml`, operations: operationList(paths) };
    const description = tagDescriptions.get(tag);
    if (description) entry.description = description.split('\n')[0].trim();
    index[slug] = entry;
    files += 1;
  }
  return { index, files };
}

function writeIndex(index: Record<string, IndexEntry>, spec: OpenApiSpec): void {
  const operations = Object.values(index).reduce((sum, e) => sum + e.operations.length, 0);
  const header = [
    '# Productive.io API – Resource Index',
    '# Read this first, then read resources/{slug}.yaml for details.',
    '#',
    `# ${Object.keys(index).length} files, ${Object.keys(spec.paths).length} paths, ${operations} operations`,
    '# Generated by scripts/sync-spec.ts -- do not edit by hand.',
    '',
    '',
  ].join('\n');
  writeFileSync(join(RESOURCES_DIR, '_index.yaml'), header + dumpYaml(index));
}

// --- changelog --------------------------------------------------------------

function methodsOf(spec: OpenApiSpec): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [path, item] of Object.entries(spec.paths)) {
    out.set(
      normalisePath(path),
      new Set(HTTP_METHODS.filter((m) => item[m] && typeof item[m] === 'object')),
    );
  }
  return out;
}

function propertiesOf(spec: OpenApiSpec, prefix: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
    if (!name.startsWith(prefix)) continue;
    const props = (schema as { properties?: object }).properties ?? {};
    out.set(name.slice(prefix.length), new Set(Object.keys(props)));
  }
  return out;
}

function diffSets(before: Set<string>, after: Set<string>): { added: string[]; removed: string[] } {
  return {
    added: [...after].filter((x) => !before.has(x)).sort(),
    removed: [...before].filter((x) => !after.has(x)).sort(),
  };
}

function diffKeyed(
  before: Map<string, Set<string>>,
  after: Map<string, Set<string>>,
): Array<{ key: string; added: string[]; removed: string[] }> {
  const out: Array<{ key: string; added: string[]; removed: string[] }> = [];
  for (const [key, afterSet] of after) {
    const beforeSet = before.get(key);
    if (!beforeSet) continue; // brand-new resource: already covered by the path diff
    const { added, removed } = diffSets(beforeSet, afterSet);
    if (added.length > 0 || removed.length > 0) out.push({ key, added, removed });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function section(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : [`### ${title}`, '', ...lines, ''];
}

const MIGRATION_NOTE = [
  'Migrated to the official OpenAPI spec published at',
  '`https://developer.productive.io/reference/download_spec`. The previous spec was',
  'scraped from the old HTML documentation and is not comparable operation by',
  'operation, so no diff is shown for this entry.',
  '',
];

function methodChanges(previous: OpenApiSpec, next: OpenApiSpec): string[] {
  const before = methodsOf(previous);
  const changes: string[] = [];
  for (const [path, afterMethods] of methodsOf(next)) {
    const beforeMethods = before.get(path);
    if (!beforeMethods) continue;
    const { added, removed } = diffSets(beforeMethods, afterMethods);
    if (added.length > 0) changes.push(`- \`${path}\`: +${added.join(', +').toUpperCase()}`);
    if (removed.length > 0) changes.push(`- \`${path}\`: −${removed.join(', −').toUpperCase()}`);
  }
  return changes;
}

function formatPropertyChange(change: { key: string; added: string[]; removed: string[] }): string {
  const quote = (values: string[]): string => values.map((v) => `\`${v}\``).join(', ');
  const parts = [
    change.removed.length > 0 ? `removed ${quote(change.removed)}` : '',
    change.added.length > 0 ? `added ${quote(change.added)}` : '',
  ].filter(Boolean);
  return `- **${change.key}**: ${parts.join('; ')}`;
}

function structuralDiff(previous: OpenApiSpec, next: OpenApiSpec): string[] {
  const pathDiff = diffSets(new Set(methodsOf(previous).keys()), new Set(methodsOf(next).keys()));
  const quotePaths = (paths: string[]): string[] => paths.map((path) => `- \`${path}\``);
  const body = [
    ...section('Removed paths', quotePaths(pathDiff.removed)),
    ...section('New paths', quotePaths(pathDiff.added)),
    ...section('Changed methods', methodChanges(previous, next)),
    ...section(
      'Filter keys',
      diffKeyed(propertiesOf(previous, 'filter_'), propertiesOf(next, 'filter_')).map(
        formatPropertyChange,
      ),
    ),
    ...section(
      'Resource attributes',
      diffKeyed(propertiesOf(previous, 'resource_'), propertiesOf(next, 'resource_')).map(
        formatPropertyChange,
      ),
    ),
  ];
  return body.length === 0 ? ['No structural changes.', ''] : body;
}

function buildChangelogEntry(previous: OpenApiSpec | null, next: OpenApiSpec): string {
  const today = new Date().toISOString().slice(0, 10);
  const paths = Object.keys(next.paths).length;
  const operations = [...methodsOf(next).values()].reduce((n, s) => n + s.size, 0);
  const head = [
    `## ${today}`,
    '',
    `**Spec:** OpenAPI ${next.openapi}, ${paths} paths, ${operations} operations`,
    '',
  ];
  // The old spec was scraped from HTML -- not comparable operation by operation.
  const body =
    previous && previous.components?.schemas ? structuralDiff(previous, next) : MIGRATION_NOTE;
  return [...head, ...body, '---', ''].join('\n');
}

function prependChangelog(entry: string): void {
  const existing = existsSync(CHANGELOG_FILE) ? readFileSync(CHANGELOG_FILE, 'utf8') : '';
  const marker = '# Productive.io API Changelog\n\n';
  const rest = existing.startsWith(marker) ? existing.slice(marker.length) : existing;
  writeFileSync(CHANGELOG_FILE, marker + entry + '\n' + rest.trimStart());
}

// --- main -------------------------------------------------------------------

async function syncSpec(): Promise<void> {
  const result = await download();
  const summaryOut = arg('--summary-out');

  if (result === 'unchanged') {
    console.log('Spec unchanged (HTTP 304).');
    if (summaryOut) writeFileSync(summaryOut, '');
    return;
  }

  const previous = existsSync(SPEC_FILE) ? loadSpec(SPEC_FILE) : null;
  const next = load(result.body.toString('utf8')) as OpenApiSpec;
  if (!next?.paths) throw new Error('Downloaded file is not an OpenAPI document');

  // Verbatim: this file is the diff baseline and the codegen source.
  writeFileSync(SPEC_FILE, result.body);
  if (result.etag) writeFileSync(ETAG_FILE, `${result.etag}\n`);

  const { index, files } = writeResources(next);
  writeIndex(index, next);

  const entry = buildChangelogEntry(previous, next);
  prependChangelog(entry);
  if (summaryOut) writeFileSync(summaryOut, entry);

  const operations = Object.values(index).reduce((sum, e) => sum + e.operations.length, 0);
  console.log(
    `Synced OpenAPI ${next.openapi}: ${Object.keys(next.paths).length} paths, ` +
      `${operations} operations, ${files} resource files.`,
  );
}

async function main(): Promise<void> {
  await syncSpec();
  // Guides move independently of the spec, so they sync even on a 304.
  console.log(`Synced ${await syncGuides()} guides.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
