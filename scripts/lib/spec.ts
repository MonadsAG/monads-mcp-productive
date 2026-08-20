/**
 * Shared helpers for the Productive.io OpenAPI tooling.
 *
 * Both `sync-spec.ts` (download + split) and `analyze-impact.ts` (drift check)
 * read the official spec through these functions.
 */

import { readFileSync } from 'node:fs';
import { dump, load } from 'js-yaml';

export const SPEC_URL = 'https://developer.productive.io/reference/download_spec';
export const API_PREFIX = '/api/v2';

export const HTTP_METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface OpenApiSpec {
  openapi: string;
  info?: Record<string, unknown>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, Record<string, unknown>>;
}

/** A `#/components/<section>/<name>` target, ignoring any deeper sub-path. */
export interface ComponentRef {
  section: string;
  name: string;
}

const REF_PATTERN = /^#\/components\/([^/]+)\/([^/]+)/;

export function loadSpec(path: string): OpenApiSpec {
  return load(readFileSync(path, 'utf8')) as OpenApiSpec;
}

export function dumpYaml(value: unknown): string {
  // noRefs: emit duplicated nodes instead of YAML anchors -- the files are read
  // by humans and by Claude, and `*ref_012` is unreadable in both cases.
  return dump(value, { sortKeys: false, lineWidth: -1, noRefs: true });
}

/** Every `$ref` string anywhere below `node`. */
export function* iterRefs(node: unknown): Generator<string> {
  if (Array.isArray(node)) {
    for (const item of node) yield* iterRefs(item);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') yield value;
      else yield* iterRefs(value);
    }
  }
}

export function parseRef(ref: string): ComponentRef | null {
  const match = REF_PATTERN.exec(ref);
  return match ? { section: match[1], name: match[2] } : null;
}

const refKey = (ref: ComponentRef): string => `${ref.section}/${ref.name}`;

/**
 * Transitive closure of the components reachable from `roots`.
 *
 * Sub-path refs (`.../resource_person/properties/team`) resolve to their owning
 * component, so pulling one property drags in the schema that defines it.
 */
export function refClosure(
  roots: unknown[],
  components: OpenApiSpec['components'],
): ComponentRef[] {
  const seen = new Map<string, ComponentRef>();
  const queue: string[] = [];
  for (const root of roots) queue.push(...iterRefs(root));

  while (queue.length > 0) {
    const ref = parseRef(queue.pop() as string);
    if (!ref || seen.has(refKey(ref))) continue;
    seen.set(refKey(ref), ref);
    const target = components[ref.section]?.[ref.name];
    if (target !== undefined) queue.push(...iterRefs(target));
  }
  return [...seen.values()];
}

export interface CompactFilter {
  description?: string;
  operators?: string[];
}

/**
 * Collapse a `filter_<resource>` schema to `key -> {description, operators}`.
 *
 * The raw schemas repeat a four-operator `oneOf` block per property, which is
 * 61% of the spec's schema weight and tells a reader nothing the compact form
 * does not.
 */
export function compactFilters(filterSchema: unknown): Record<string, CompactFilter> {
  const properties = (filterSchema as { properties?: Record<string, unknown> })?.properties;
  if (!properties) return {};

  const out: Record<string, CompactFilter> = {};
  for (const [key, raw] of Object.entries(properties)) {
    const prop = raw as { description?: string; oneOf?: Array<Record<string, unknown>> };
    const entry: CompactFilter = {};
    if (prop.description) entry.description = prop.description.trim();

    const operation = prop.oneOf?.find((branch) => branch.title === 'Operation');
    const operators = Object.keys((operation?.properties as object) ?? {});
    if (operators.length > 0) entry.operators = operators.sort();

    out[key] = entry;
  }
  return out;
}

/** `Time Entries` -> `time_entries` */
export function tagToSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Map a collection path to its singular resource key, e.g. `/api/v2/people` ->
 * `person`, which in turn names `filter_person` / `resource_person`.
 *
 * The mapping is read off the spec's own `filter_<key>` parameter and
 * `collection_<key>` response refs rather than guessed by de-pluralising.
 */
export function resourceKeyByPath(spec: OpenApiSpec): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation || typeof operation !== 'object') continue;
      for (const ref of iterRefs(operation)) {
        const match = /\/(?:filter|collection|resource)_([a-z0-9_]+)$/.exec(ref);
        if (match) {
          mapping.set(normalisePath(path), match[1]);
          break;
        }
      }
    }
  }
  return mapping;
}

/** Trailing slashes are noise -- the spec is inconsistent about them. */
export function normalisePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Every `METHOD /path` pair in the spec, normalised. */
export function specOperations(spec: OpenApiSpec): Map<string, Set<HttpMethod>> {
  const out = new Map<string, Set<HttpMethod>>();
  for (const [path, item] of Object.entries(spec.paths)) {
    const key = normalisePath(path);
    const methods = out.get(key) ?? new Set<HttpMethod>();
    for (const method of HTTP_METHODS) {
      if (item[method] && typeof item[method] === 'object') methods.add(method);
    }
    out.set(key, methods);
  }
  return out;
}
