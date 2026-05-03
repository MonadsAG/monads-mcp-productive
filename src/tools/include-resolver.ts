import { ProductiveIncludedResource } from '../api/types.js';

/**
 * Builds a lookup map from a JSON API included[] array.
 * Key format: "type:id" → human-readable name
 * Supported types: people, companies, projects, tasks, deals, task_lists, boards
 */
export function buildIncludeMap(included?: ProductiveIncludedResource[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!included) return map;

  for (const resource of included) {
    const key = `${resource.type}:${resource.id}`;
    const attrs = resource.attributes;

    let name: string | undefined;
    if (resource.type === 'people') {
      const first = typeof attrs.first_name === 'string' ? attrs.first_name : '';
      const last = typeof attrs.last_name === 'string' ? attrs.last_name : '';
      name = `${first} ${last}`.trim() || undefined;
    } else {
      name = typeof attrs.name === 'string' ? attrs.name : undefined;
    }

    if (name) map.set(key, name);
  }

  return map;
}

/**
 * Resolves an entity ID to a name using the include map.
 * Falls back to the raw ID if the name is not found.
 */
export function resolveName(
  map: Map<string, string>,
  type: string,
  id: string | undefined,
): string | undefined {
  if (!id) return undefined;
  return map.get(`${type}:${id}`) ?? id;
}
