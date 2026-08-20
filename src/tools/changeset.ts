/**
 * Formatting for an activity's `changeset`.
 *
 * Productive returns the changed fields as an array of objects whose values are
 * `[before, after]` pairs -- not the flat `changes` object this code used to
 * assume (that attribute does not exist, so nothing was ever rendered):
 *
 *   [{ "used": [{ "value": "0.0", "unit": "days" }, { "value": "1.0", "unit": "days" }] }]
 */

/**
 * Values arrive wrapped as `{ value: … }`, often with extra keys (`id`,
 * `avatar_url`, `unit`). Unwrap one level so a change reads
 * `person_id: null → Igor Kretov` instead of a JSON blob.
 */
function renderValue(value: unknown, unwrap = true): string {
  if (typeof value === 'string') return value;
  if (unwrap && value !== null && typeof value === 'object' && 'value' in value) {
    return renderValue((value as { value: unknown }).value, false);
  }
  return JSON.stringify(value);
}

/** One `field: before → after` line per changed field. */
export function formatChangeset(changeset: unknown): string[] {
  if (!Array.isArray(changeset)) return [];

  const lines: string[] = [];
  for (const entry of changeset) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [field, change] of Object.entries(entry as Record<string, unknown>)) {
      if (Array.isArray(change) && change.length === 2) {
        lines.push(`${field}: ${renderValue(change[0])} → ${renderValue(change[1])}`);
      } else {
        lines.push(`${field}: ${renderValue(change)}`);
      }
    }
  }
  return lines;
}
