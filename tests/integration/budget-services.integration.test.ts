import { describe, it, expect, afterAll } from 'vitest';
import { getConfig } from '../../src/config/index.js';
import { ProductiveAPIClient } from '../../src/api/client.js';
import { createBudgetTool } from '../../src/tools/budgets.js';
import {
  createBudgetServiceTool,
  updateBudgetServiceTool,
} from '../../src/tools/budget-services.js';

// This suite hits the REAL Productive.io API using local credentials from
// .dev.vars (loaded by tests/setup.ts). It is silently skipped for anyone
// without PRODUCTIVE_API_TOKEN set (CI, other contributors) via skipIf.
describe.skipIf(!process.env.PRODUCTIVE_API_TOKEN)(
  'budget services integration (live Productive.io org)',
  () => {
    const config = getConfig();
    const client = new ProductiveAPIClient(config);

    const createdServiceIds: string[] = [];
    const createdDealIds: string[] = [];

    afterAll(async () => {
      // Always clean up, even if earlier assertions in this file failed —
      // afterAll runs regardless of test outcome within the describe block.
      // Delete services before their parent budget/deal.
      const serviceIds = [...createdServiceIds];
      createdServiceIds.length = 0;
      for (const id of serviceIds) {
        await client.deleteService(id).catch((error) => {
          console.error(`[integration cleanup] failed to delete service ${id}:`, error);
        });
      }

      const dealIds = [...createdDealIds];
      createdDealIds.length = 0;
      for (const id of dealIds) {
        await client.deleteDeal(id).catch((error) => {
          console.error(`[integration cleanup] failed to delete deal ${id}:`, error);
        });
      }
    });

    it('creates and updates a service attached to a real budget end-to-end', async () => {
      const companies = await client.listCompanies({ limit: 1 });
      expect(companies.data.length).toBeGreaterThan(0);
      const companyId = companies.data[0].id;

      expect(
        config.PRODUCTIVE_USER_ID,
        'PRODUCTIVE_USER_ID must be set for this test',
      ).toBeTruthy();

      const budgetResult = await createBudgetTool(
        client,
        { name: 'Integration Test Budget For Services', company_id: companyId },
        { PRODUCTIVE_USER_ID: config.PRODUCTIVE_USER_ID },
      );
      const budgetMatch = budgetResult.content[0].text.match(/Budget ID: (\d+)/);
      expect(budgetMatch).not.toBeNull();
      const budgetId = budgetMatch![1];
      createdDealIds.push(budgetId);

      const serviceResult = await createBudgetServiceTool(client, {
        budget_id: budgetId,
        name: 'Integration Test Service',
        price: 100,
        quantity: 5,
      });
      const serviceMatch = serviceResult.content[0].text.match(/Service ID: (\d+)/);
      expect(serviceMatch).not.toBeNull();
      const serviceId = serviceMatch![1];
      createdServiceIds.push(serviceId);

      const updateResult = await updateBudgetServiceTool(client, {
        service_id: serviceId,
        name: 'Integration Test Service (renamed)',
        price: 150,
      });
      expect(updateResult.content[0].text).toContain('renamed');
    });

    it('fails clearly when budget_id does not reference an existing deal', async () => {
      // If Productive's validation behavior ever changes such that this
      // unexpectedly succeeds, capture the created service id so afterAll
      // still cleans it up instead of leaking it into the sandbox.
      let threw = false;
      try {
        const result = await createBudgetServiceTool(client, {
          budget_id: '999999999',
          name: 'Service On Nonexistent Budget',
        });
        const match = result.content[0].text.match(/Service ID: (\d+)/);
        if (match) createdServiceIds.push(match[1]);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  },
);
