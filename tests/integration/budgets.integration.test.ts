import { describe, it, expect, afterAll } from 'vitest';
import { getConfig } from '../../src/config/index.js';
import { ProductiveAPIClient } from '../../src/api/client.js';
import {
  createBudgetTool,
  updateBudgetTool,
  createBudgetFromDealTool,
} from '../../src/tools/budgets.js';

// This suite hits the REAL Productive.io API using local credentials from
// .dev.vars (loaded by tests/setup.ts). It is silently skipped for anyone
// without PRODUCTIVE_API_TOKEN set (CI, other contributors) via skipIf.
describe.skipIf(!process.env.PRODUCTIVE_API_TOKEN)(
  'budgets integration (live Productive.io org)',
  () => {
    const config = getConfig();
    const client = new ProductiveAPIClient(config);

    const createdDealIds: string[] = [];

    afterAll(async () => {
      // Always clean up, even if earlier assertions in this file failed —
      // afterAll runs regardless of test outcome within the describe block.
      const ids = [...createdDealIds];
      createdDealIds.length = 0;
      for (const id of ids) {
        await client.deleteDeal(id).catch(() => undefined);
      }
    });

    it('creates and updates a budget end-to-end', async () => {
      const companies = await client.listCompanies({ limit: 1 });
      expect(companies.data.length).toBeGreaterThan(0);
      const companyId = companies.data[0].id;

      expect(
        config.PRODUCTIVE_USER_ID,
        'PRODUCTIVE_USER_ID must be set for this test',
      ).toBeTruthy();

      const createResult = await createBudgetTool(
        client,
        { name: 'Integration Test Budget', company_id: companyId },
        { PRODUCTIVE_USER_ID: config.PRODUCTIVE_USER_ID },
      );
      const match = createResult.content[0].text.match(/Budget ID: (\d+)/);
      expect(match).not.toBeNull();
      const budgetId = match![1];
      createdDealIds.push(budgetId);

      const updateResult = await updateBudgetTool(client, {
        budget_id: budgetId,
        name: 'Integration Test Budget (renamed)',
      });
      expect(updateResult.content[0].text).toContain('renamed');
    });

    it('derives a budget from an origin deal and warns on a second derivation', async () => {
      // Find a real client company that actually has a project. Picking an
      // arbitrary company/project pair independently can mismatch (e.g. the
      // org's own internal company has projects that reject client-type
      // deals), so scan a handful of companies for one with >=1 project.
      const companies = await client.listCompanies({ limit: 10 });
      expect(companies.data.length).toBeGreaterThan(0);

      let companyId: string | undefined;
      let projectId: string | undefined;
      for (const company of companies.data) {
        const companyProjects = await client.listProjects({ company_id: company.id, limit: 1 });
        if (companyProjects.data.length > 0) {
          companyId = company.id;
          projectId = companyProjects.data[0].id;
          break;
        }
      }
      if (!companyId || !projectId) {
        throw new Error('no company with an existing project found among the first 10 companies');
      }

      // A plain deal (budget: false) is on the sales pipeline, so Productive
      // additionally requires `probability` + `deal_status` (budgets don't
      // need these — see the comment on ProductiveDealCreate). create_from_origin
      // also requires the origin deal to be "Won" (verified live — deriving
      // from an "Open" deal is rejected), so find that status by name rather
      // than a hardcoded, org-specific ID.
      const dealStatuses = await client.listDealStatuses();
      expect(dealStatuses.data.length).toBeGreaterThan(0);
      const wonStatus = dealStatuses.data.find(
        (s) => typeof s.attributes.name === 'string' && s.attributes.name.toLowerCase() === 'won',
      );
      if (!wonStatus) {
        throw new Error('no "Won" deal_status found in this org');
      }
      const dealStatusId = wonStatus.id;

      // Create our own origin deal (budget: false) so this test doesn't
      // depend on pre-existing org data.
      const originResponse = await client.createDeal({
        data: {
          type: 'deals',
          attributes: {
            name: 'Integration Test Origin Deal',
            deal_type_id: 2,
            date: new Date().toISOString().slice(0, 10),
            currency: 'CHF',
            budget: false,
            probability: 100,
          },
          relationships: {
            company: { data: { id: companyId, type: 'companies' } },
            responsible: { data: { id: config.PRODUCTIVE_USER_ID!, type: 'people' } },
            project: { data: { id: projectId, type: 'projects' } },
            deal_status: { data: { id: dealStatusId, type: 'deal_statuses' } },
          },
        },
      });
      const originDealId = originResponse.data.id;
      createdDealIds.push(originDealId);

      const firstDerived = await createBudgetFromDealTool(client, {
        origin_deal_id: originDealId,
        project_id: projectId,
      });
      const firstMatch = firstDerived.content[0].text.match(/Budget ID: (\d+)/);
      expect(firstMatch).not.toBeNull();
      createdDealIds.push(firstMatch![1]);
      expect(firstDerived.content[0].text).not.toContain('Warning');

      const secondDerived = await createBudgetFromDealTool(client, {
        origin_deal_id: originDealId,
        project_id: projectId,
      });
      const secondMatch = secondDerived.content[0].text.match(/Budget ID: (\d+)/);
      createdDealIds.push(secondMatch![1]);
      expect(secondDerived.content[0].text).toContain('Warning');
      expect(secondDerived.content[0].text).toContain(firstMatch![1]);
    });
  },
);
