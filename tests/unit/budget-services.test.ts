import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import {
  createBudgetServiceTool,
  updateBudgetServiceTool,
} from '../../src/tools/budget-services.js';

describe('createBudgetServiceTool', () => {
  it('creates a service with defaults applied (unit_id=1, billing_type_id=2)', async () => {
    const client = {
      createService: vi.fn().mockResolvedValue({
        data: { id: '999', type: 'services', attributes: { name: 'Consulting Hours' } },
      }),
    } as unknown as ProductiveAPIClient;

    const result = await createBudgetServiceTool(client, {
      budget_id: '123',
      name: 'Consulting Hours',
    });

    expect(client.createService).toHaveBeenCalledTimes(1);
    const payload = (client.createService as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.attributes.name).toBe('Consulting Hours');
    expect(payload.data.attributes.unit_id).toBe(1);
    expect(payload.data.attributes.billing_type_id).toBe(2);
    expect(payload.data.relationships.deal).toEqual({ data: { id: '123', type: 'deals' } });
    expect(result.content[0].text).toContain('999');
  });

  it('respects explicit unit_id, billing_type_id, price, quantity, description, budgeted_time', async () => {
    const client = {
      createService: vi.fn().mockResolvedValue({
        data: { id: '999', type: 'services', attributes: { name: 'Design Work' } },
      }),
    } as unknown as ProductiveAPIClient;

    await createBudgetServiceTool(client, {
      budget_id: '123',
      name: 'Design Work',
      unit_id: 3,
      billing_type_id: 1,
      price: 150.5,
      quantity: 10,
      description: 'UX design services',
      budgeted_time: 600,
    });

    const payload = (client.createService as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.attributes).toMatchObject({
      unit_id: 3,
      billing_type_id: 1,
      price: 150.5,
      quantity: 10,
      description: 'UX design services',
      budgeted_time: 600,
    });
  });

  it('throws InvalidParams when budget_id is missing', async () => {
    const client = { createService: vi.fn() } as unknown as ProductiveAPIClient;

    await expect(createBudgetServiceTool(client, { name: 'No Budget' })).rejects.toThrow(
      /Invalid parameters/,
    );
    expect(client.createService).not.toHaveBeenCalled();
  });

  it('throws InvalidParams when name is missing', async () => {
    const client = { createService: vi.fn() } as unknown as ProductiveAPIClient;

    await expect(createBudgetServiceTool(client, { budget_id: '123' })).rejects.toThrow(
      /Invalid parameters/,
    );
    expect(client.createService).not.toHaveBeenCalled();
  });
});

describe('updateBudgetServiceTool', () => {
  it('sends only the provided fields as a flat attributes diff', async () => {
    const client = {
      updateService: vi.fn().mockResolvedValue({
        data: { id: '999', type: 'services', attributes: { name: 'Renamed', price: 200 } },
      }),
    } as unknown as ProductiveAPIClient;

    const result = await updateBudgetServiceTool(client, {
      service_id: '999',
      name: 'Renamed',
      price: 200,
    });

    expect(client.updateService).toHaveBeenCalledWith('999', {
      data: {
        type: 'services',
        id: '999',
        attributes: { name: 'Renamed', price: 200 },
      },
    });
    expect(result.content[0].text).toContain('999');
  });

  it('retains falsy-but-defined values like price: 0 in the attributes diff', async () => {
    const client = {
      updateService: vi.fn().mockResolvedValue({
        data: { id: '999', type: 'services', attributes: { name: 'Renamed', price: 0 } },
      }),
    } as unknown as ProductiveAPIClient;

    await updateBudgetServiceTool(client, {
      service_id: '999',
      price: 0,
      quantity: 0,
    });

    expect(client.updateService).toHaveBeenCalledWith('999', {
      data: {
        type: 'services',
        id: '999',
        attributes: { price: 0, quantity: 0 },
      },
    });
  });

  it('throws InvalidParams when service_id is missing', async () => {
    const client = { updateService: vi.fn() } as unknown as ProductiveAPIClient;

    await expect(updateBudgetServiceTool(client, { name: 'Renamed' })).rejects.toThrow(
      /Invalid parameters/,
    );
    expect(client.updateService).not.toHaveBeenCalled();
  });

  it('throws InvalidParams when no fields to update are provided', async () => {
    const client = { updateService: vi.fn() } as unknown as ProductiveAPIClient;

    await expect(updateBudgetServiceTool(client, { service_id: '999' })).rejects.toThrow(
      /No fields to update/,
    );
    expect(client.updateService).not.toHaveBeenCalled();
  });
});

// The section is sent as a flat `section_id` attribute (per the spec) and the
// service is read back, because an API that ignored the field would otherwise
// look exactly like one that applied it.
describe('section_id on budget services', () => {
  const SERVICE = { data: { id: '999', type: 'services', attributes: { name: 'Concept' } } };

  function readBack(section: unknown) {
    return vi.fn().mockResolvedValue({
      data: { ...SERVICE.data, relationships: { section } },
    });
  }

  it('create sends section_id as a number and confirms it by reading back', async () => {
    const client = {
      createService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: readBack({ data: { id: '11', type: 'sections' } }),
    } as unknown as ProductiveAPIClient;

    const result = await createBudgetServiceTool(client, {
      budget_id: '123',
      name: 'Concept',
      section_id: '11',
    });

    const payload = (client.createService as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.attributes.section_id).toBe(11);
    expect(client.getServiceWithSection).toHaveBeenCalledWith('999');
    expect(result.content[0].text).toContain('Section: 11 (confirmed by reading the service back)');
  });

  it('create without section_id does not read the service back', async () => {
    const client = {
      createService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: vi.fn(),
    } as unknown as ProductiveAPIClient;

    await createBudgetServiceTool(client, { budget_id: '123', name: 'Concept' });

    const payload = (client.createService as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.attributes).not.toHaveProperty('section_id');
    expect(client.getServiceWithSection).not.toHaveBeenCalled();
  });

  it('create fails loudly, and warns against a duplicate, when the section was ignored', async () => {
    const client = {
      createService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: readBack({ data: null }),
    } as unknown as ProductiveAPIClient;

    await expect(
      createBudgetServiceTool(client, { budget_id: '123', name: 'Concept', section_id: '11' }),
    ).rejects.toThrow(
      /Service 999 was created, but Productive did not put it into section 11 \(it reports no section\)\. The service exists, do not create it again\./,
    );
  });

  it('create says the service exists when the read-back itself fails', async () => {
    const client = {
      createService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: vi.fn().mockRejectedValue(new Error('Too Many Requests')),
    } as unknown as ProductiveAPIClient;

    await expect(
      createBudgetServiceTool(client, { budget_id: '123', name: 'Concept', section_id: '11' }),
    ).rejects.toThrow(
      /Service 999 was created, but reading it back to check its section \(11\) failed \(Too Many Requests\)\. The service exists, do not create it again\./,
    );
  });

  it('normalises the section id once, so the read-back compares like with like', async () => {
    const client = {
      createService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: readBack({ data: { id: '11', type: 'sections' } }),
    } as unknown as ProductiveAPIClient;

    const result = await createBudgetServiceTool(client, {
      budget_id: '123',
      name: 'Concept',
      section_id: ' 011',
    });

    const payload = (client.createService as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.attributes.section_id).toBe(11);
    expect(result.content[0].text).toContain('Section: 11 (confirmed');
  });

  it('update says the change happened when the read-back fails, without a duplicate warning', async () => {
    const client = {
      updateService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: vi.fn().mockRejectedValue(new Error('Too Many Requests')),
    } as unknown as ProductiveAPIClient;

    const call = updateBudgetServiceTool(client, { service_id: '999', section_id: '11' });

    await expect(call).rejects.toThrow(
      /Service 999 was updated, but reading it back to check its section \(11\) failed \(Too Many Requests\)\.$/,
    );
  });

  it('update reports a different section instead of claiming success', async () => {
    const client = {
      updateService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: readBack({ data: { id: '12', type: 'sections' } }),
    } as unknown as ProductiveAPIClient;

    await expect(
      updateBudgetServiceTool(client, { service_id: '999', section_id: '11' }),
    ).rejects.toThrow(
      /was updated, but Productive did not put it into section 11 \(it reports section 12\)/,
    );
  });

  it('update with only section_id sends it as the whole attributes diff', async () => {
    const client = {
      updateService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: readBack({ meta: { included: false } }),
    } as unknown as ProductiveAPIClient;

    const result = await updateBudgetServiceTool(client, { service_id: '999', section_id: '11' });

    expect(client.updateService).toHaveBeenCalledWith('999', {
      data: { type: 'services', id: '999', attributes: { section_id: 11 } },
    });
    // A stub cannot confirm anything, and the output must not pretend it did.
    expect(result.content[0].text).toContain(
      'Section: 11 requested, but Productive did not report',
    );
  });

  it('rejects a non-numeric section_id before calling the API', async () => {
    const client = { updateService: vi.fn() } as unknown as ProductiveAPIClient;

    await expect(
      updateBudgetServiceTool(client, { service_id: '999', section_id: 'Discovery' }),
    ).rejects.toThrow(/section_id must be a numeric Productive ID/);
    expect(client.updateService).not.toHaveBeenCalled();
  });

  it('update with section_id "none" sends null and confirms the service is in no section', async () => {
    const client = {
      updateService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: readBack({ data: null }),
    } as unknown as ProductiveAPIClient;

    const result = await updateBudgetServiceTool(client, {
      service_id: '999',
      section_id: ' None ',
    });

    expect(client.updateService).toHaveBeenCalledWith('999', {
      data: { type: 'services', id: '999', attributes: { section_id: null } },
    });
    expect(result.content[0].text).toContain(
      'Section: none (confirmed by reading the service back)',
    );
  });

  it('update with "none" fails when the service is still in a section', async () => {
    const client = {
      updateService: vi.fn().mockResolvedValue(SERVICE),
      getServiceWithSection: readBack({ data: { id: '11', type: 'sections' } }),
    } as unknown as ProductiveAPIClient;

    await expect(
      updateBudgetServiceTool(client, { service_id: '999', section_id: 'none' }),
    ).rejects.toThrow(
      /was updated, but Productive did not take it out of its section \(it reports section 11\)/,
    );
  });

  it('create does not accept "none": a new service has no section unless one is given', async () => {
    const client = { createService: vi.fn() } as unknown as ProductiveAPIClient;

    await expect(
      createBudgetServiceTool(client, { budget_id: '123', name: 'Concept', section_id: 'none' }),
    ).rejects.toThrow(/section_id must be a numeric Productive ID/);
    expect(client.createService).not.toHaveBeenCalled();
  });
});
