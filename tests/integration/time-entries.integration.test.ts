import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { Config } from '../../src/config/index.js';
import { getConfig } from '../../src/config/index.js';
import { ProductiveAPIClient } from '../../src/api/client.js';
import { createTimeEntryTool } from '../../src/tools/time-entries.js';
import { updateTimeEntryTool } from '../../src/tools/time-entry-update.js';

// This suite hits the REAL Productive.io API using local credentials from
// .dev.vars (loaded by tests/setup.ts). It is silently skipped for anyone
// without PRODUCTIVE_API_TOKEN set (CI, other contributors) via skipIf.
describe.skipIf(!process.env.PRODUCTIVE_API_TOKEN)(
  'time entries integration (live Productive.io org)',
  () => {
    // Vitest still executes a describe body during collection even when
    // skipIf skips it, so getConfig() must not run at this level -- without
    // credentials it throws and the whole file fails instead of skipping.
    let config: Config;
    let client: ProductiveAPIClient;

    beforeAll(() => {
      config = getConfig();
      client = new ProductiveAPIClient(config);
    });

    const createdTimeEntryIds: string[] = [];

    afterAll(async () => {
      const ids = [...createdTimeEntryIds];
      createdTimeEntryIds.length = 0;
      for (const id of ids) {
        await client.deleteTimeEntry(id).catch((error) => {
          console.error(`[integration cleanup] failed to delete time entry ${id}:`, error);
        });
      }
    });

    it('reassigns a time entry from one service/budget to another', async () => {
      expect(
        config.PRODUCTIVE_USER_ID,
        'PRODUCTIVE_USER_ID must be set for this test',
      ).toBeTruthy();

      const services = await client.listServices({ limit: 2 });
      expect(services.data.length).toBeGreaterThanOrEqual(2);
      const [originService, targetService] = services.data;

      const createResult = await createTimeEntryTool(
        client,
        {
          date: 'today',
          time: '1h',
          person_id: config.PRODUCTIVE_USER_ID,
          service_id: originService.id,
          note: 'Integration test entry for service reassignment',
          confirm: true,
        },
        { PRODUCTIVE_USER_ID: config.PRODUCTIVE_USER_ID },
      );
      const match = createResult.content[0].text.match(/ID: (\d+)/);
      expect(match).not.toBeNull();
      const timeEntryId = match![1];
      createdTimeEntryIds.push(timeEntryId);

      const updateResult = await updateTimeEntryTool(client, {
        time_entry_id: timeEntryId,
        service_id: targetService.id,
      });
      expect(updateResult.content[0].text).toContain(
        `Reassigned to Service ID: ${targetService.id}`,
      );

      const fetched = await client.listTimeEntries({ service_id: targetService.id, limit: 200 });
      const entry = fetched.data.find((e) => e.id === timeEntryId);
      expect(entry).toBeDefined();
      expect(entry?.relationships?.service?.data?.id).toBe(targetService.id);
    });
  },
);
