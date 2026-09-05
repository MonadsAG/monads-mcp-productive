import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProductiveAPIClient } from '../../src/api/client.js';
import type { Config } from '../../src/config/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeClient(fetchImpl: typeof fetch): ProductiveAPIClient {
  const config = {
    PRODUCTIVE_API_TOKEN: 'token',
    PRODUCTIVE_ORG_ID: 'org',
    // Trailing slash matters: makeRequest() does `${base}${path}` with no
    // separator of its own -- the config layer is what guarantees the slash
    // (see src/config/worker-config.ts's `.replace(/\/?$/, '/')`).
    PRODUCTIVE_API_BASE_URL: 'https://api.productive.io/api/v2/',
  } as unknown as Config;
  const client = new ProductiveAPIClient(config);
  vi.stubGlobal('fetch', fetchImpl);
  return client;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
}

// Productive's REST API validates filter[...] keys against a fixed allowlist
// per resource and rejects unknown keys with a 422 ("Filter 'x' is not
// supported on this endpoint"). These tests pin the client to the documented
// filter keys (docs/api-spec/resources/*.yaml) instead of the JSON:API
// response *attribute* names that happen to share a resource's vocabulary.
describe('ProductiveAPIClient filter keys', () => {
  it('listPeople sends filter[status] (not filter[is_active]) for is_active:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listPeople({ is_active: true });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bstatus%5D=1');
    expect(url).not.toContain('is_active');
  });

  it('listPeople sends filter[status]=2 (not filter[is_active]) for is_active:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listPeople({ is_active: false });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bstatus%5D=2');
    expect(url).not.toContain('is_active');
  });

  it('listCompanyBudgets sends filter[budget_status] (not filter[status])', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listCompanyBudgets({ company_id: '1', status: 1 });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bbudget_status%5D=1');
    expect(url).not.toContain('filter%5Bstatus%5D=1');
  });

  it('listProjectDeals sends filter[type] (not filter[budget_type])', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listProjectDeals({ project_id: '1', budget_type: 2 });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Btype%5D=2');
    expect(url).not.toContain('budget_type');
  });

  // All three of these were live-verified as 422 before the fix: the API has no
  // board_id filter on task lists and no after/before filter on invoices.
  it('listTaskLists sends filter[folder_id] (not filter[board_id])', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listTaskLists({ board_id: '123' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bfolder_id%5D=123');
    expect(url).not.toContain('board_id');
  });

  it('listInvoices maps after/before onto filter[invoiced_on] bounds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listInvoices({ after: '2024-01-01', before: '2024-12-31' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Binvoiced_on%5D%5Bgt_eq%5D=2024-01-01');
    expect(url).toContain('filter%5Binvoiced_on%5D%5Blt_eq%5D=2024-12-31');
    expect(url).not.toContain('filter%5Bafter%5D');
    expect(url).not.toContain('filter%5Bbefore%5D');
  });

  // Live-verified against the sandbox: filter[approved]=true 422s ("not
  // supported on this endpoint"). The real filter is filter[status], an
  // undocumented enum where 1=approved (confirmed live).
  it('listTimeEntries sends filter[status]=1 (not filter[approved]) for approved:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listTimeEntries({ approved: true });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bstatus%5D=1');
    expect(url).not.toContain('filter%5Bapproved%5D');
  });

  it('listTimeEntries sends filter[status][not_eq]=1 for approved:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listTimeEntries({ approved: false });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bstatus%5D%5Bnot_eq%5D=1');
    expect(url).not.toContain('filter%5Bapproved%5D');
  });

  it('listTimeEntries sends filter[approver_id]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listTimeEntries({ approver_id: '42' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bapprover_id%5D=42');
  });

  // Verified against the live sandbox: filter[event_id] selects exactly the
  // absences (a comma-separated list of every event id returned the same 63
  // rows the client-side split produces), filter[project_id] narrows to one
  // project, and comma lists work on filter[person_id] as well.
  it('listBookings sends filter[event_id] and accepts a comma-separated list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listBookings({ event_id: '133714,139787' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bevent_id%5D=133714%2C139787');
  });

  it('listBookings sends filter[project_id] and filter[person_id]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listBookings({ project_id: '633049', person_id: '7,8' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bproject_id%5D=633049');
    expect(url).toContain('filter%5Bperson_id%5D=7%2C8');
  });

  // Paging the bookings endpoint without a fixed order silently duplicates and
  // drops rows at the page boundaries. `started_on` is a documented sort key --
  // an undocumented one answers 400 (verified live).
  it('listBookings sends the sort key it was given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listBookings({ sort: 'started_on', page: 2, limit: 200 });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('sort=started_on');
    expect(url).toContain('page%5Bnumber%5D=2');
  });

  // Live-verified to actually narrow the result (2582 rows unfiltered, 70 for
  // one invoice, 0 for an id that does not exist) -- a 200 alone would prove
  // only that the key passed the allowlist, as filter[booking_type] shows.
  it('listTimeEntries sends filter[invoice_id]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listTimeEntries({ invoice_id: '1476811' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Binvoice_id%5D=1476811');
    // not_eq matches only inside entries that already carry an attribution, so
    // it never means "uninvoiced" and must not creep into this filter.
    expect(url).not.toContain('not_eq');
  });

  it('listTimeEntries passes a comma-separated invoice list through unsplit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listTimeEntries({ invoice_id: '1476811,1477175' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Binvoice_id%5D=1476811%2C1477175');
  });

  // `date` and `-date` are the only sort keys this endpoint accepts; `id`,
  // `created_at` and the compound `date,id` all answer 400 (verified live).
  // spec:impact checks filter[...] keys only, so nothing else guards this.
  it('listTimeEntries sends the sort key and page it was given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listTimeEntries({ sort: 'date', page: 2, limit: 200 });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('sort=date');
    expect(url).toContain('page%5Bnumber%5D=2');
    expect(url).toContain('page%5Bsize%5D=200');
  });

  it('listInvoices sends filter[number] for an invoice number lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = makeClient(fetchMock);

    await client.listInvoices({ number: '20260035' });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('filter%5Bnumber%5D=20260035');
  });
});
