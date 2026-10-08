import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import {
  readLinkage,
  listBudgetSectionsTool,
  createBudgetSectionTool,
  updateBudgetSectionTool,
  deleteBudgetSectionTool,
} from '../../src/tools/budget-sections.js';

const STUB = { meta: { included: false } };

function section(id: string | number, name: string, dealId: string | null, position?: number) {
  return {
    id,
    type: 'sections',
    attributes: { name, position },
    relationships: { deal: dealId ? { data: { id: dealId, type: 'deals' } } : STUB },
  };
}

function service(id: string, name: string, sectionLink: unknown) {
  return { id, type: 'services', attributes: { name }, relationships: { section: sectionLink } };
}

const inSection = (id: string | number) => ({ data: { id, type: 'sections' } });

/** A single, complete page: Productive's reported total matches the rows. */
function page(rows: unknown[]) {
  return { data: rows, meta: { total_pages: 1, total_count: rows.length } };
}

function fillers(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => service(`${prefix}${i}`, 'Filler', { data: null }));
}

function mockClient(overrides: Record<string, unknown>): ProductiveAPIClient {
  return overrides as unknown as ProductiveAPIClient;
}

describe('readLinkage', () => {
  it('tells a linked, an empty and an unreported relationship apart', () => {
    expect(readLinkage(inSection('7'))).toEqual({ kind: 'linked', id: '7' });
    expect(readLinkage(inSection(7))).toEqual({ kind: 'linked', id: '7' });
    expect(readLinkage({ data: null })).toEqual({ kind: 'none' });
    expect(readLinkage(STUB)).toEqual({ kind: 'unknown' });
    expect(readLinkage(undefined)).toEqual({ kind: 'unknown' });
    // An id-less linkage must not read as a section called "undefined".
    expect(readLinkage({ data: {} })).toEqual({ kind: 'unknown' });
    // A stub stays unknown even with `data: null` -- "empty" would let a delete through.
    expect(readLinkage({ data: null, meta: { included: false } })).toEqual({ kind: 'unknown' });
  });
});

describe('listBudgetSectionsTool', () => {
  it('groups the services under their sections in position order', async () => {
    const client = mockClient({
      listSections: vi
        .fn()
        .mockResolvedValue(
          page([section('12', 'Operations', '123', 2), section('11', 'Discovery', '123', 1)]),
        ),
      listDealServices: vi
        .fn()
        .mockResolvedValue(
          page([
            service('501', 'Concept', inSection('11')),
            service('502', 'Monitoring', inSection(12)),
            service('510', 'Project management', { data: null }),
            service('520', 'Legacy', STUB),
          ]),
        ),
    });

    const text = (await listBudgetSectionsTool(client, { budget_id: '123' })).content[0].text;

    expect(client.listSections).toHaveBeenCalledWith('123', 1);
    for (const projectless of [false, true]) {
      expect(client.listDealServices).toHaveBeenCalledWith({
        deal_id: '123',
        include: 'section',
        limit: 200,
        page: 1,
        projectless_budgets: projectless,
      });
    }
    expect(text.indexOf('Section 11: Discovery')).toBeLessThan(
      text.indexOf('Section 12: Operations'),
    );
    expect(text).toMatch(/Section 11: Discovery \(1 service\)\n {2}- Service 501: Concept/);
    expect(text).toMatch(/Section 12: Operations \(1 service\)\n {2}- Service 502: Monitoring/);
    expect(text).toMatch(/Not in any section \(1 service\)\n {2}- Service 510: Project management/);
    expect(text).toMatch(/Section unknown \(Productive did not report it\) \(1 service\)/);
    expect(text).not.toContain('may be incomplete');
  });

  it('includes a service that only the projectless-budgets lookup returns', async () => {
    const client = mockClient({
      listSections: vi.fn().mockResolvedValue(page([section('11', 'Discovery', '123')])),
      listDealServices: vi.fn((p: { projectless_budgets: boolean }) =>
        Promise.resolve(
          page(p.projectless_budgets ? [service('501', 'Concept', inSection('11'))] : []),
        ),
      ),
    });

    const text = (await listBudgetSectionsTool(client, { budget_id: '123' })).content[0].text;

    expect(text).toMatch(/Section 11: Discovery \(1 service\)\n {2}- Service 501: Concept/);
  });

  it('pages through the sections', async () => {
    const listSections = vi.fn((_budget: string, n: number) =>
      Promise.resolve(
        n === 1
          ? {
              data: Array.from({ length: 200 }, (_, i) => section(`${1000 + i}`, 'S', '123', i)),
              meta: { total_pages: 2, total_count: 201 },
            }
          : { data: [section('11', 'Last one', '123', 999)], meta: { total_count: 201 } },
      ),
    );
    const client = mockClient({
      listSections,
      listDealServices: vi.fn().mockResolvedValue(page([])),
    });

    const text = (await listBudgetSectionsTool(client, { budget_id: '123' })).content[0].text;

    expect(listSections).toHaveBeenCalledWith('123', 2);
    expect(text).toContain('Section 11: Last one');
    expect(text).not.toContain('may be incomplete');
  });

  it('drops sections of other budgets, labels unreported ones and names the gaps', async () => {
    const client = mockClient({
      listSections: vi.fn().mockResolvedValue({
        data: [
          section('11', 'Discovery', '123'),
          section('99', 'Foreign phase', '456'),
          section('13', 'Unclear', null),
        ],
        // Productive claims more sections than it returned.
        meta: { total_pages: 1, total_count: 5 },
      }),
      listDealServices: vi.fn().mockResolvedValue({ data: [], meta: { total_pages: 1 } }),
    });

    const text = (await listBudgetSectionsTool(client, { budget_id: '123' })).content[0].text;

    expect(text).toContain('Section 11: Discovery (no services)');
    expect(text).toContain('Section 13: Unclear (no services, budget not reported)');
    expect(text).not.toContain('Foreign phase');
    expect(text).toContain('Left out 1 section(s) that belong to other budgets.');
    expect(text).toContain('The section list may be incomplete: 3 of 5 reported rows were read.');
    // No total reported for the services: nothing proves that list complete either.
    expect(text).toMatch(
      /The service list may be incomplete: plain lookup: Productive reported no total/,
    );
  });

  it('marks a section without a name instead of printing a blank', async () => {
    const client = mockClient({
      listSections: vi.fn().mockResolvedValue(page([section('11', '', '123')])),
      listDealServices: vi
        .fn()
        .mockResolvedValue(page([service('501', 'Concept', inSection('11'))])),
    });

    const text = (await listBudgetSectionsTool(client, { budget_id: '123' })).content[0].text;

    expect(text).toMatch(/Section 11 \(unnamed, 1 service\)\n {2}- Service 501: Concept/);
  });

  it('rejects a non-numeric budget id before calling the API', async () => {
    const client = mockClient({ listSections: vi.fn(), listDealServices: vi.fn() });

    await expect(listBudgetSectionsTool(client, { budget_id: '123/../5' })).rejects.toThrow(
      /budget_id must be a numeric Productive ID/,
    );
    expect(client.listSections).not.toHaveBeenCalled();
  });
});

describe('createBudgetSectionTool', () => {
  it('sends the budget as a numeric deal_id attribute', async () => {
    const client = mockClient({
      createSection: vi.fn().mockResolvedValue({ data: section('11', 'Discovery phase', null) }),
    });

    const text = (
      await createBudgetSectionTool(client, { budget_id: '123', name: ' Discovery phase ' })
    ).content[0].text;

    expect(client.createSection).toHaveBeenCalledWith({
      data: { type: 'sections', attributes: { name: 'Discovery phase', deal_id: 123 } },
    });
    expect(text).toContain('Section ID: 11 (Discovery phase) on budget 123');
  });

  it('rejects a non-numeric budget id before calling the API', async () => {
    const client = mockClient({ createSection: vi.fn() });

    await expect(createBudgetSectionTool(client, { budget_id: 'abc', name: 'X' })).rejects.toThrow(
      /budget_id must be a numeric Productive ID/,
    );
    expect(client.createSection).not.toHaveBeenCalled();
  });
});

describe('updateBudgetSectionTool', () => {
  it('renames the section and reports the name Productive stored', async () => {
    const client = mockClient({
      updateSection: vi.fn().mockResolvedValue({ data: section('11', 'Operations phase', null) }),
    });

    const text = (
      await updateBudgetSectionTool(client, { section_id: '11', name: 'Operations phase' })
    ).content[0].text;

    expect(client.updateSection).toHaveBeenCalledWith('11', {
      data: { type: 'sections', id: '11', attributes: { name: 'Operations phase' } },
    });
    expect(text).toContain('renamed to "Operations phase"');
  });

  it('rejects a section id that is not a number', async () => {
    const client = mockClient({ updateSection: vi.fn() });

    await expect(
      updateBudgetSectionTool(client, { section_id: '../deals/5', name: 'X' }),
    ).rejects.toThrow(/section_id must be a numeric Productive ID/);
    expect(client.updateSection).not.toHaveBeenCalled();
  });
});

describe('deleteBudgetSectionTool', () => {
  type ServicePage = (page: number, projectless: boolean) => unknown;

  function deleteClient(sectionRow: unknown, servicePage: ServicePage) {
    return mockClient({
      getSection: vi.fn().mockResolvedValue({ data: sectionRow }),
      listServicesInSection: vi.fn((_id: string, n: number, projectless: boolean) =>
        Promise.resolve(servicePage(n, projectless)),
      ),
      deleteSection: vi.fn().mockResolvedValue(undefined),
    });
  }

  async function expectRefusal(client: ProductiveAPIClient, message: RegExp) {
    await expect(deleteBudgetSectionTool(client, { section_id: '11' })).rejects.toThrow(message);
    expect(client.deleteSection).not.toHaveBeenCalled();
  }

  it('deletes a section once both lookups by section prove it empty', async () => {
    const client = deleteClient(section('11', 'Discovery', '123'), () => page([]));

    const text = (await deleteBudgetSectionTool(client, { section_id: '11' })).content[0].text;

    expect(client.listServicesInSection).toHaveBeenCalledWith('11', 1, false);
    expect(client.listServicesInSection).toHaveBeenCalledWith('11', 1, true);
    expect(client.deleteSection).toHaveBeenCalledWith('11');
    expect(text).toBe('Section 11 (Discovery) deleted from budget 123.');
  });

  it('marks a section without a name in its messages', async () => {
    const empty = deleteClient(section('11', ' ', '123'), () => page([]));
    const text = (await deleteBudgetSectionTool(empty, { section_id: '11' })).content[0].text;
    expect(text).toBe('Section 11 (unnamed) deleted from budget 123.');

    const full = deleteClient(section('11', '', '123'), () =>
      page([service('501', 'Concept', inSection('11'))]),
    );
    await expectRefusal(full, /Section 11 \(unnamed\) still contains 1 service/);
  });

  it('uses the normalised id for every request', async () => {
    const client = deleteClient(section('11', 'Discovery', '123'), () => page([]));

    await deleteBudgetSectionTool(client, { section_id: ' 011' });

    expect(client.getSection).toHaveBeenCalledWith('11');
    expect(client.listServicesInSection).toHaveBeenCalledWith('11', 1, false);
    expect(client.deleteSection).toHaveBeenCalledWith('11');
  });

  it('refuses while services are in the section and names them', async () => {
    const client = deleteClient(section('11', 'Discovery', '123'), () =>
      page([service('501', 'Concept', inSection('11'))]),
    );

    await expectRefusal(client, /still contains 1 service:\n {2}- Service 501: Concept/);
  });

  it('refuses for a service that only the projectless-budgets lookup returns', async () => {
    const client = deleteClient(section('11', 'Discovery', '123'), (_n, projectless) =>
      page(projectless ? [service('601', 'No project', inSection('11'))] : []),
    );

    await expectRefusal(client, /Service 601: No project/);
  });

  it('refuses for a service of another budget that sits in the section', async () => {
    // The lookup is by section, so it does not matter which budget 777 is on.
    const client = deleteClient(section('11', 'Discovery', '123'), () =>
      page([service('777', 'Elsewhere', inSection('11'))]),
    );

    await expectRefusal(client, /Service 777: Elsewhere/);
  });

  it('checks every row when Productive ignores the section filter', async () => {
    // An ignored filter returns other services too; the one in the section still blocks.
    const client = deleteClient(section('11', 'Discovery', '123'), () =>
      page([...fillers('f', 3), service('501', 'Concept', inSection('11'))]),
    );

    await expectRefusal(client, /still contains 1 service/);
  });

  it('matches ids that Productive sends as numbers', async () => {
    const client = deleteClient(section(11, 'Discovery', '123'), () =>
      page([service('501', 'Concept', inSection(11))]),
    );

    await expectRefusal(client, /still contains 1 service/);
  });

  it('refuses when a service does not report its section', async () => {
    const client = deleteClient(section('11', 'Discovery', '123'), () =>
      page([service('520', 'Legacy', { data: null, meta: { included: false } })]),
    );

    await expectRefusal(client, /did not report the section of 1 service/);
  });

  it('finds a service on a later page', async () => {
    const client = deleteClient(section('11', 'Discovery', '123'), (n) =>
      n === 1
        ? { data: fillers('f', 200), meta: { total_pages: 2, total_count: 201 } }
        : { data: [service('501', 'Concept', inSection('11'))], meta: { total_count: 201 } },
    );

    await expectRefusal(client, /Service 501: Concept/);
    expect(client.listServicesInSection).toHaveBeenCalledWith('11', 2, false);
  });

  it('refuses when fewer services came back than Productive reported', async () => {
    // A short first page ends the sweep although a second page was announced.
    const client = deleteClient(section('11', 'Discovery', '123'), () => ({
      data: fillers('f', 150),
      meta: { total_pages: 2, total_count: 250 },
    }));

    await expectRefusal(client, /plain lookup: 150 of 250 reported rows were read/);
  });

  it('refuses when Productive reports no total', async () => {
    const client = deleteClient(section('11', 'Discovery', '123'), () => ({ data: [], meta: {} }));

    await expectRefusal(client, /Productive reported no total/);
  });

  it('refuses when the page ceiling cuts the sweep short', async () => {
    const client = deleteClient(section('11', 'Discovery', '123'), (n) => ({
      data: fillers(`p${n}-`, 200),
      meta: { total_pages: 99, total_count: 19800 },
    }));

    await expectRefusal(client, /more than 2000 rows came back/);
  });

  it('refuses when Productive returns something other than the section', async () => {
    const client = deleteClient({ ...section('11', 'Concept', '123'), type: 'services' }, () =>
      page([]),
    );

    await expectRefusal(client, /did not return section 11/);
  });

  it('refuses when Productive returns a different section', async () => {
    const client = deleteClient(section('12', 'Other', '123'), () => page([]));

    await expectRefusal(client, /did not return section 11/);
  });

  it('rejects a section id that is not a number before calling the API', async () => {
    const client = deleteClient(section('11', 'Discovery', '123'), () => page([]));

    await expect(deleteBudgetSectionTool(client, { section_id: '../services/5' })).rejects.toThrow(
      /section_id must be a numeric Productive ID/,
    );
    expect(client.getSection).not.toHaveBeenCalled();
    expect(client.deleteSection).not.toHaveBeenCalled();
  });
});
