import { ProductiveAPIClient } from '../api/client.js';
import { ProductiveTask } from '../api/types.js';

export interface CustomFieldValueInfo {
  name: string;
  options: Map<string, string>;
}

/**
 * Collects the distinct set of custom field IDs referenced as keys of
 * task.attributes.custom_fields across all given tasks. Tasks without a
 * custom_fields object (or with an empty one) are skipped.
 */
function collectCustomFieldIds(tasks: ProductiveTask[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    const customFields = task.attributes?.custom_fields;
    if (!customFields || typeof customFields !== 'object') continue;
    for (const key of Object.keys(customFields)) {
      ids.add(key);
    }
  }
  return ids;
}

/** Builds a lookup of custom field ID -> display name via a single API call. */
async function buildFieldNameMap(client: ProductiveAPIClient): Promise<Map<string, string>> {
  const response = await client.listCustomFields();
  const map = new Map<string, string>();
  for (const field of response.data ?? []) {
    if (!field) continue;
    map.set(field.id, field.attributes?.name || field.id);
  }
  return map;
}

/** Builds a lookup of option ID -> display label for a single custom field. */
async function buildOptionsMapForField(
  client: ProductiveAPIClient,
  fieldId: string,
): Promise<Map<string, string>> {
  const response = await client.listCustomFieldOptions({ customFieldId: fieldId });
  const map = new Map<string, string>();
  for (const option of response.data ?? []) {
    if (!option) continue;
    map.set(option.id, option.attributes?.name || option.id);
  }
  return map;
}

/**
 * Builds a resolver map for the custom fields referenced by the given task(s).
 * Costs zero API calls when no task has any custom_fields set. Otherwise:
 * one call to list all custom field definitions, plus one parallel call per
 * distinct custom field to list its options.
 */
export async function buildCustomFieldValueMap(
  client: ProductiveAPIClient,
  tasks: ProductiveTask | ProductiveTask[],
): Promise<Map<string, CustomFieldValueInfo>> {
  const taskArray = Array.isArray(tasks) ? tasks : [tasks];
  const fieldIds = Array.from(collectCustomFieldIds(taskArray));

  const result = new Map<string, CustomFieldValueInfo>();
  if (fieldIds.length === 0) {
    return result;
  }

  const nameMap = await buildFieldNameMap(client);
  const optionMaps = await Promise.all(fieldIds.map((id) => buildOptionsMapForField(client, id)));

  fieldIds.forEach((id, index) => {
    result.set(id, { name: nameMap.get(id) || id, options: optionMaps[index] });
  });

  return result;
}

/** Resolves a single raw custom field value (one array element) through the options map. */
function resolveSingleValue(options: Map<string, string>, value: unknown): string {
  if (typeof value === 'string' && options.has(value)) {
    return options.get(value)!;
  }
  return value === null || value === undefined ? 'null' : String(value);
}

/**
 * Formats a task's raw custom_fields into human-readable "name: value" lines,
 * resolving field names and dropdown/multi-select option IDs to display labels.
 */
export function resolveCustomFieldsText(
  map: Map<string, CustomFieldValueInfo>,
  rawCustomFields: Record<string, unknown> | null | undefined,
): string[] {
  if (!rawCustomFields) return [];

  const lines: string[] = [];
  for (const [fieldId, rawValue] of Object.entries(rawCustomFields)) {
    const info = map.get(fieldId);
    const fieldName = info?.name ?? fieldId;
    const options = info?.options ?? new Map<string, string>();

    let displayValue: string;
    if (Array.isArray(rawValue)) {
      displayValue = rawValue.map((item) => resolveSingleValue(options, item)).join(', ');
    } else if (typeof rawValue === 'string' && options.has(rawValue)) {
      displayValue = options.get(rawValue)!;
    } else {
      displayValue = rawValue === null || rawValue === undefined ? 'null' : String(rawValue);
    }

    lines.push(`${fieldName}: ${displayValue}`);
  }

  return lines;
}
