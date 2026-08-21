import { describe, it, expect } from 'vitest';
import { extractEndpointUsage } from '../../scripts/lib/client-usage.ts';

// `npm run spec:impact` can only validate the filter keys this extractor finds.
// A key it silently drops is a key nobody checks -- which is how the wrong
// filter names in PR #20 reached production in the first place.
describe('extractEndpointUsage', () => {
  const usages = extractEndpointUsage('src/api/client.ts');
  const byMember = (name: string) => usages.find((usage) => usage.member === name);

  // The extractor is pinned to `this.makeRequest(path, options)` by method name,
  // `this` receiver and argument position. Rename the helper or move it to an
  // options object and it matches nothing -- at which point `npm run spec:impact`
  // exits 0 having checked no endpoint, no filter key and no attribute at all.
  // A green check that verified nothing is worse than a red one, so pin a floor.
  it('still finds the whole client, not an empty list', () => {
    expect(usages.length).toBeGreaterThanOrEqual(75);
  });

  it('resolves a path built from a nested template literal', () => {
    expect(byMember('listPeople')?.path).toBe('/api/v2/people');
  });

  it('turns an interpolated id into the spec path shape', () => {
    expect(byMember('getPerson')?.path).toBe('/api/v2/people/{id}');
  });

  it('picks up the HTTP method from the request options', () => {
    expect(byMember('createTask')?.httpMethod).toBe('post');
  });

  it('extracts the key from an operator filter like filter[invoiced_on][gt_eq]', () => {
    expect(byMember('listInvoices')?.filters).toContain('invoiced_on');
  });

  it('reports the filter key, never the operator suffix', () => {
    const filters = usages.flatMap((usage) => usage.filters);
    expect(filters.some((filter) => filter.includes('['))).toBe(false);
    expect(filters).not.toContain('gt_eq');
  });
});
