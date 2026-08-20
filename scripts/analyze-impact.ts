/**
 * Check `src/api/` against the official spec and report what we have to change.
 *
 *   npm run spec:impact
 *   npm run spec:impact -- --markdown --previous /tmp/prev.yaml
 *   npm run spec:impact -- --update-baseline
 *
 * Exits 1 when a breaking finding is not covered by the baseline, so the
 * weekly sync PR gets a red check instead of a paragraph nobody reads.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HTTP_METHODS,
  type OpenApiSpec,
  loadSpec,
  normalisePath,
  resourceKeyByPath,
  specOperations,
} from './lib/spec.ts';
import { type EndpointUsage, extractEndpointUsage, extractTypeUsage } from './lib/client-usage.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_FILE = join(ROOT, 'docs', 'api-spec', 'productive-openapi.yaml');
const BASELINE_FILE = join(ROOT, 'docs', 'api-spec', 'impact-baseline.json');
const CLIENT_FILE = join(ROOT, 'src', 'api', 'client.ts');
const TYPES_FILE = join(ROOT, 'src', 'api', 'types.ts');

interface Baseline {
  $comment?: string;
  accepted: string[];
  ignoreNewEndpoints: string[];
}

interface Finding {
  id: string;
  severity: 'breaking' | 'info';
  message: string;
}

const flag = (name: string): boolean => process.argv.includes(name);
const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE_FILE)) return { accepted: [], ignoreNewEndpoints: [] };
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
}

function propertiesOf(spec: OpenApiSpec, schema: string): Set<string> {
  const properties = (spec.components?.schemas?.[schema] as { properties?: object })?.properties;
  return new Set(Object.keys(properties ?? {}));
}

/** The collection path a filter belongs to -- `/people/{id}` filters live on `/people`. */
function collectionPath(path: string): string {
  return path.replace(/\/\{id\}$/, '');
}

// --- checks -----------------------------------------------------------------

function checkEndpoints(spec: OpenApiSpec, usages: EndpointUsage[]): Finding[] {
  const operations = specOperations(spec);
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const usage of usages) {
    const id = `endpoint:${usage.httpMethod.toUpperCase()} ${usage.path}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const methods = operations.get(normalisePath(usage.path));
    if (!methods) {
      findings.push({
        id,
        severity: 'breaking',
        message: `\`${usage.httpMethod.toUpperCase()} ${usage.path}\` is not in the spec — used by \`client.ts:${usage.member}\` (line ${usage.line})`,
      });
    } else if (!methods.has(usage.httpMethod)) {
      findings.push({
        id,
        severity: 'breaking',
        message: `\`${usage.path}\` no longer accepts \`${usage.httpMethod.toUpperCase()}\` (spec has ${[...methods].map((m) => m.toUpperCase()).join(', ')}) — used by \`client.ts:${usage.member}\` (line ${usage.line})`,
      });
    }
  }
  return findings;
}

function checkFilters(spec: OpenApiSpec, usages: EndpointUsage[]): Finding[] {
  const resourceKeys = resourceKeyByPath(spec);
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const usage of usages) {
    if (usage.filters.length === 0) continue;
    const key =
      resourceKeys.get(normalisePath(usage.path)) ?? resourceKeys.get(collectionPath(usage.path));
    if (!key) continue; // no filter schema to judge against

    const known = propertiesOf(spec, `filter_${key}`);
    if (known.size === 0) continue;

    for (const filter of usage.filters) {
      const id = `filter:${key}:${filter}`;
      if (known.has(filter) || seen.has(id)) continue;
      seen.add(id);
      findings.push({
        id,
        severity: 'breaking',
        message: `\`filter[${filter}]\` is not a valid filter on \`${key}\` — used by \`client.ts:${usage.member}\` (line ${usage.line})`,
      });
    }
  }
  return findings;
}

function checkAttributes(spec: OpenApiSpec): Finding[] {
  const resourceKeys = resourceKeyByPath(spec);
  const findings: Finding[] = [];

  for (const usage of extractTypeUsage(TYPES_FILE)) {
    const key = resourceKeys.get(`/api/v2/${usage.jsonApiType}`);
    if (!key) continue;
    const known = propertiesOf(spec, `resource_${key}`);
    if (known.size === 0) continue;

    for (const attribute of usage.attributes) {
      if (known.has(attribute)) continue;
      findings.push({
        id: `attribute:${key}:${attribute}`,
        severity: 'breaking',
        message: `\`${usage.interfaceName}.attributes.${attribute}\` is not in \`resource_${key}\` — \`types.ts\` line ${usage.line}`,
      });
    }
  }
  return findings;
}

function tagsOf(spec: OpenApiSpec, path: string): string[] {
  const item = spec.paths[path] ?? {};
  const tags = new Set<string>();
  for (const method of HTTP_METHODS) {
    for (const tag of (item[method] as { tags?: string[] } | undefined)?.tags ?? []) tags.add(tag);
  }
  return [...tags];
}

/** New endpoints in areas we already cover -- opportunities, not problems. */
function checkNewEndpoints(
  spec: OpenApiSpec,
  previous: OpenApiSpec,
  usages: EndpointUsage[],
  ignored: string[],
): Finding[] {
  const usedPaths = new Set(usages.map((u) => normalisePath(u.path)));
  const coveredTags = new Set([...usedPaths].flatMap((path) => tagsOf(spec, path)));
  const before = new Set(Object.keys(previous.paths).map(normalisePath));
  const findings: Finding[] = [];

  for (const path of Object.keys(spec.paths)) {
    const normalised = normalisePath(path);
    if (before.has(normalised) || usedPaths.has(normalised) || ignored.includes(normalised))
      continue;
    const tags = tagsOf(spec, path).filter((tag) => coveredTags.has(tag));
    if (tags.length === 0) continue;
    findings.push({
      id: `new-endpoint:${normalised}`,
      severity: 'info',
      message: `\`${normalised}\` (${tags.join(', ')})`,
    });
  }
  return findings;
}

// --- reporting --------------------------------------------------------------

function render(breaking: Finding[], accepted: Finding[], opportunities: Finding[]): string {
  const lines: string[] = [];

  if (breaking.length > 0) {
    lines.push(`### ⚠️ We need to react (${breaking.length})`, '');
    lines.push(...breaking.map((f) => `- ${f.message}`), '');
  } else {
    lines.push(
      '### ✅ No action needed',
      '',
      'Every endpoint, filter key and attribute we use still exists.',
      '',
    );
  }

  if (opportunities.length > 0) {
    lines.push(`### 💡 Newly available in areas we already cover (${opportunities.length})`, '');
    lines.push(...opportunities.map((f) => `- ${f.message}`), '');
  }

  if (accepted.length > 0) {
    lines.push(
      '<details><summary>' + `${accepted.length} known deviations (baselined)</summary>`,
      '',
      ...accepted.map((f) => `- ${f.message}`),
      '',
      '</details>',
      '',
    );
  }
  return lines.join('\n');
}

function collectFindings(
  spec: OpenApiSpec,
  baseline: Baseline,
  usages: EndpointUsage[],
): Finding[] {
  const findings = [
    ...checkEndpoints(spec, usages),
    ...checkFilters(spec, usages),
    ...checkAttributes(spec),
  ];
  const previousFile = option('--previous');
  if (previousFile && existsSync(previousFile)) {
    findings.push(
      ...checkNewEndpoints(spec, loadSpec(previousFile), usages, baseline.ignoreNewEndpoints),
    );
  }
  return findings;
}

function writeBaseline(findings: Finding[], baseline: Baseline): void {
  const accepted = findings
    .filter((finding) => finding.severity === 'breaking')
    .map((finding) => finding.id)
    .sort();
  const next: Baseline = {
    $comment:
      'Known, accepted deviations between src/api and the official spec. Only findings NOT ' +
      'listed here fail `npm run spec:impact`; this list should shrink over time. Most entries ' +
      'are spec documentation gaps rather than real API changes: the official schemas omit ' +
      'attributes the API does return (updated_at, is_active, description on several resources). ' +
      'ignoreNewEndpoints: /api/v2/boards is documented but 404s on our tenant -- we use /api/v2/folders.',
    accepted,
    ignoreNewEndpoints: baseline.ignoreNewEndpoints,
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Baseline updated: ${accepted.length} accepted deviations.`);
}

function printSummary(
  spec: OpenApiSpec,
  usages: EndpointUsage[],
  breaking: Finding[],
  accepted: Finding[],
  opportunities: Finding[],
): void {
  console.log(`Checked ${usages.length} client calls against OpenAPI ${spec.openapi}.`);
  console.log(
    `  breaking: ${breaking.length}   baselined: ${accepted.length}   new endpoints: ${opportunities.length}`,
  );
  for (const finding of breaking) console.log(`  BREAKING  ${finding.id}`);
}

function main(): void {
  if (!existsSync(SPEC_FILE)) {
    throw new Error(`${SPEC_FILE} is missing — run \`npm run spec:sync\` first`);
  }
  const spec = loadSpec(SPEC_FILE);
  const baseline = loadBaseline();
  const usages = extractEndpointUsage(CLIENT_FILE);
  const findings = collectFindings(spec, baseline, usages);

  if (flag('--update-baseline')) {
    writeBaseline(findings, baseline);
    return;
  }

  const known = new Set(baseline.accepted);
  const isBreaking = (f: Finding): boolean => f.severity === 'breaking';
  const breaking = findings.filter((f) => isBreaking(f) && !known.has(f.id));
  const accepted = findings.filter((f) => isBreaking(f) && known.has(f.id));
  const opportunities = findings.filter((f) => f.severity === 'info');

  if (flag('--markdown')) console.log(render(breaking, accepted, opportunities));
  else printSummary(spec, usages, breaking, accepted, opportunities);

  if (breaking.length > 0) process.exit(1);
}

main();
