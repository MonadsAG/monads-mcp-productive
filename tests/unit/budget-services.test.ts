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
