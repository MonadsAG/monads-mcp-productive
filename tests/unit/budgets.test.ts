import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import {
  createBudgetTool,
  updateBudgetTool,
  createBudgetFromDealTool,
} from '../../src/tools/budgets.js';

function mockClient(overrides: Partial<ProductiveAPIClient> = {}): ProductiveAPIClient {
  return {
    createDeal: vi.fn().mockResolvedValue({
      data: { id: '999', type: 'deals', attributes: { name: 'Test Budget' } },
    }),
    ...overrides,
  } as unknown as ProductiveAPIClient;
}

describe('createBudgetTool', () => {
  it('creates a budget with defaults applied (deal_type_id, currency, date, budget:true)', async () => {
    const client = mockClient();

    const result = await createBudgetTool(
      client,
      { name: 'Q3 Budget', company_id: '123', responsible_id: '456' },
      undefined,
    );

    expect(client.createDeal).toHaveBeenCalledTimes(1);
    const payload = (client.createDeal as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.attributes.name).toBe('Q3 Budget');
    expect(payload.data.attributes.budget).toBe(true);
    expect(payload.data.attributes.deal_type_id).toBe(2);
    expect(payload.data.attributes.currency).toBe('CHF');
    expect(payload.data.attributes.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.data.relationships.company).toEqual({ data: { id: '123', type: 'companies' } });
    expect(payload.data.relationships.responsible).toEqual({
      data: { id: '456', type: 'people' },
    });
    expect(result.content[0].text).toContain('999');
  });

  it('auto-resolves responsible_id from config.PRODUCTIVE_USER_ID when omitted', async () => {
    const client = mockClient();

    await createBudgetTool(
      client,
      { name: 'Q3 Budget', company_id: '123' },
      { PRODUCTIVE_USER_ID: '789' },
    );

    const payload = (client.createDeal as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.relationships.responsible).toEqual({
      data: { id: '789', type: 'people' },
    });
  });

  it('treats responsible_id: "me" the same as omitting it', async () => {
    const client = mockClient();

    await createBudgetTool(
      client,
      { name: 'Q3 Budget', company_id: '123', responsible_id: 'me' },
      { PRODUCTIVE_USER_ID: '789' },
    );

    const payload = (client.createDeal as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.relationships.responsible).toEqual({
      data: { id: '789', type: 'people' },
    });
  });

  it('throws InvalidParams when responsible_id is omitted and no PRODUCTIVE_USER_ID is configured', async () => {
    const client = mockClient();

    await expect(
      createBudgetTool(client, { name: 'Q3 Budget', company_id: '123' }, undefined),
    ).rejects.toThrow(/responsible_id/);
  });

  it('throws InvalidParams when a required field is missing', async () => {
    const client = mockClient();

    await expect(
      createBudgetTool(client, { company_id: '123', responsible_id: '456' }, undefined),
    ).rejects.toThrow(/Invalid parameters/);
  });
});

describe('updateBudgetTool', () => {
  it('sends only the provided fields as a flat attributes diff', async () => {
    const client = {
      updateDeal: vi.fn().mockResolvedValue({
        data: { id: '999', type: 'deals', attributes: { name: 'Renamed', end_date: '2026-12-31' } },
      }),
    } as unknown as ProductiveAPIClient;

    const result = await updateBudgetTool(client, {
      budget_id: '999',
      name: 'Renamed',
      end_date: '2026-12-31',
    });

    expect(client.updateDeal).toHaveBeenCalledWith('999', {
      data: {
        type: 'deals',
        id: '999',
        attributes: { name: 'Renamed', end_date: '2026-12-31' },
      },
    });
    expect(result.content[0].text).toContain('999');
  });

  it('throws InvalidParams when no fields to update are provided', async () => {
    const client = { updateDeal: vi.fn() } as unknown as ProductiveAPIClient;

    await expect(updateBudgetTool(client, { budget_id: '999' })).rejects.toThrow(
      /No fields to update/,
    );
    expect(client.updateDeal).not.toHaveBeenCalled();
  });
});

describe('createBudgetFromDealTool', () => {
  it('derives a budget from an origin deal with no warning when none exist yet', async () => {
    const client = {
      listDealsByOriginId: vi.fn().mockResolvedValue({ data: [] }),
      createDealFromOrigin: vi.fn().mockResolvedValue({
        data: { id: '999', type: 'deals', attributes: { name: 'Derived Budget' } },
      }),
    } as unknown as ProductiveAPIClient;

    const result = await createBudgetFromDealTool(client, {
      origin_deal_id: '2516475',
      project_id: '633047',
    });

    expect(client.listDealsByOriginId).toHaveBeenCalledWith('2516475');
    expect(client.createDealFromOrigin).toHaveBeenCalledWith({
      data: {
        type: 'deals',
        attributes: { origin_deal_id: 2516475 },
        relationships: { project: { data: { id: '633047', type: 'projects' } } },
      },
    });
    expect(result.content[0].text).toContain('999');
    expect(result.content[0].text).not.toContain('Warning');
  });

  it('warns when a budget was already derived from this origin deal', async () => {
    const client = {
      listDealsByOriginId: vi.fn().mockResolvedValue({
        data: [{ id: '2550272', type: 'deals', attributes: {} }],
      }),
      createDealFromOrigin: vi.fn().mockResolvedValue({
        data: { id: '999', type: 'deals', attributes: { name: 'Derived Budget' } },
      }),
    } as unknown as ProductiveAPIClient;

    const result = await createBudgetFromDealTool(client, {
      origin_deal_id: '2516475',
      project_id: '633047',
    });

    expect(result.content[0].text).toContain('Warning');
    expect(result.content[0].text).toContain('2550272');
  });

  it('throws InvalidParams when project_id is missing', async () => {
    const client = {
      listDealsByOriginId: vi.fn(),
      createDealFromOrigin: vi.fn(),
    } as unknown as ProductiveAPIClient;

    await expect(createBudgetFromDealTool(client, { origin_deal_id: '2516475' })).rejects.toThrow(
      /Invalid parameters/,
    );
    expect(client.createDealFromOrigin).not.toHaveBeenCalled();
  });

  it('still creates the budget when the advisory duplicate-check itself fails', async () => {
    const client = {
      listDealsByOriginId: vi.fn().mockRejectedValue(new Error('transient 500')),
      createDealFromOrigin: vi.fn().mockResolvedValue({
        data: { id: '999', type: 'deals', attributes: { name: 'Derived Budget' } },
      }),
    } as unknown as ProductiveAPIClient;

    const result = await createBudgetFromDealTool(client, {
      origin_deal_id: '2516475',
      project_id: '633047',
    });

    expect(client.createDealFromOrigin).toHaveBeenCalledTimes(1);
    expect(result.content[0].text).toContain('999');
    expect(result.content[0].text).not.toContain('Warning');
  });
});
