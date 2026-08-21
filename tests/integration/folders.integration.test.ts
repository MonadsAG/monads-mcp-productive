import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getConfig } from '../../src/config/index.js';
import { ProductiveAPIClient } from '../../src/api/client.js';
import {
  listFolders,
  getFolder,
  createFolder,
  updateFolder,
  archiveFolder,
  restoreFolder,
  copyFolder,
  moveFolder,
  repositionFolder,
} from '../../src/tools/folders.js';

// This suite hits the REAL Productive.io API using local credentials from
// .dev.vars (loaded by tests/setup.ts). It is silently skipped for anyone
// without PRODUCTIVE_API_TOKEN set (CI, other contributors) via skipIf.
//
// This is the empirical check for two things the rest of this refactor could
// only infer: (1) that /api/v2/folders -- not /api/v2/boards -- is really the
// working route for this tenant, and (2) that the inferred move/reposition/
// copy attribute names (project_id, move_before_id, name/template_id/
// project_id) are correct. A failure here means the corresponding attribute
// name in src/tools/folders.ts / src/api/client.ts needs correcting -- check
// the API error message first, since a rejection could also mean a business
// rule (e.g. move permissions) rather than a wrong field name.
//
// Client/config construction is deliberately deferred to beforeAll (not a
// top-level `const` in the describe body) -- Vitest's describe.skipIf still
// executes the describe callback body during test collection even when
// skipped, so an eager getConfig() call there throws instead of skipping
// (this is a pre-existing gap in this repo's other two integration suites --
// out of scope to fix here, but not one to repeat).
describe.skipIf(!process.env.PRODUCTIVE_API_TOKEN)(
  'folders (boards) integration (live Productive.io org)',
  () => {
    let client: ProductiveAPIClient;
    const createdFolderIds: string[] = [];

    beforeAll(() => {
      client = new ProductiveAPIClient(getConfig());
    });

    afterAll(async () => {
      // Boards/folders have no DELETE endpoint in the official API (verified
      // against docs/api-spec/resources/boards.yaml -- only GET/POST/PATCH
      // operations exist). Best-effort cleanup is to archive what we created.
      const ids = [...createdFolderIds];
      createdFolderIds.length = 0;
      for (const id of ids) {
        await client.archiveBoard(id).catch((error) => {
          console.error(`[integration cleanup] failed to archive folder ${id}:`, error);
        });
      }
    });

    it('creates, lists, gets, updates, archives and restores a folder end-to-end', async () => {
      const projects = await client.listProjects({ limit: 1 });
      expect(projects.data.length).toBeGreaterThan(0);
      const projectId = projects.data[0].id;

      const createResult = await createFolder(client, {
        project_id: projectId,
        name: 'Integration Test Folder',
      });
      const createMatch = createResult.content[0].text.match(/ID: (\d+)/);
      expect(createMatch).not.toBeNull();
      const folderId = createMatch![1];
      createdFolderIds.push(folderId);

      // status: 1 (active) is load-bearing, not decoration. Folders have no
      // DELETE endpoint, so afterAll can only archive what a run creates and
      // list_folders returns archived folders too -- this project already holds
      // 80 of them against a single active one. Without the filter the default
      // page of 30 is all leftovers and the folder just created never appears,
      // which is exactly how this test started failing.
      const listResult = await listFolders(client, { project_id: projectId, status: 1 });
      expect(listResult.content[0].text).toContain(folderId);

      const getResult = await getFolder(client, { folder_id: folderId });
      expect(getResult.content[0].text).toContain('Integration Test Folder');

      const updateResult = await updateFolder(client, {
        folder_id: folderId,
        name: 'Integration Test Folder (renamed)',
      });
      expect(updateResult.content[0].text).toContain('renamed');

      const archiveResult = await archiveFolder(client, { folder_id: folderId });
      expect(archiveResult.content[0].text).toContain('archived successfully');

      const restoreResult = await restoreFolder(client, { folder_id: folderId });
      expect(restoreResult.content[0].text).toContain('restored successfully');
    });

    it('repositions a folder before another folder', async () => {
      const projects = await client.listProjects({ limit: 1 });
      const projectId = projects.data[0].id;

      const first = await createFolder(client, { project_id: projectId, name: 'Folder A' });
      const firstId = first.content[0].text.match(/ID: (\d+)/)![1];
      createdFolderIds.push(firstId);

      const second = await createFolder(client, { project_id: projectId, name: 'Folder B' });
      const secondId = second.content[0].text.match(/ID: (\d+)/)![1];
      createdFolderIds.push(secondId);

      const repositionResult = await repositionFolder(client, {
        folder_id: secondId,
        move_before_id: firstId,
      });
      expect(repositionResult.content[0].text).toContain('repositioned');
    });

    it('copies a folder from a template', async () => {
      const projects = await client.listProjects({ limit: 1 });
      const projectId = projects.data[0].id;

      const template = await createFolder(client, {
        project_id: projectId,
        name: 'Copy Template Folder',
      });
      const templateId = template.content[0].text.match(/ID: (\d+)/)![1];
      createdFolderIds.push(templateId);

      const copyResult = await copyFolder(client, {
        name: 'Copied Folder',
        template_id: templateId,
        project_id: projectId,
      });
      expect(copyResult.content[0].text).toContain('copied successfully');
      const copyMatch = copyResult.content[0].text.match(/ID: (\d+)/);
      expect(copyMatch).not.toBeNull();
      createdFolderIds.push(copyMatch![1]);
    });

    it('moves a folder to a different project', async () => {
      const projects = await client.listProjects({ limit: 10 });
      expect(
        projects.data.length,
        'need at least 2 distinct projects in this org to test move_folder',
      ).toBeGreaterThanOrEqual(2);
      const [sourceProject, destProject] = projects.data;

      const created = await createFolder(client, {
        project_id: sourceProject.id,
        name: 'Move Test Folder',
      });
      const folderId = created.content[0].text.match(/ID: (\d+)/)![1];
      createdFolderIds.push(folderId);

      const moveResult = await moveFolder(client, {
        folder_id: folderId,
        project_id: destProject.id,
      });
      expect(moveResult.content[0].text).toContain('moved');

      // client.getBoard() now requests ?include=project (see src/api/client.ts),
      // so get_folder's Project ID line is reliably populated -- confirm the
      // move landed on the destination project directly.
      const getResult = await getFolder(client, { folder_id: folderId });
      expect(getResult.content[0].text).toContain(`Project ID: ${destProject.id}`);

      const afterMove = await listFolders(client, { project_id: destProject.id, status: 1 });
      expect(afterMove.content[0].text).toContain(folderId);
    });
  },
);
