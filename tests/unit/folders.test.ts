import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
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

function mockClient(overrides: Partial<ProductiveAPIClient> = {}): ProductiveAPIClient {
  return { ...overrides } as unknown as ProductiveAPIClient;
}

describe('folder tools call the Board-named client methods', () => {
  it('listFolders calls client.listBoards', async () => {
    const listBoards = vi.fn().mockResolvedValue({ data: [] });
    const client = mockClient({ listBoards });

    await listFolders(client, { project_id: '1' });

    expect(listBoards).toHaveBeenCalledWith({ project_id: '1', status: undefined, limit: 30 });
  });

  it('getFolder calls client.getBoard', async () => {
    const getBoard = vi.fn().mockResolvedValue({
      data: { id: '5', attributes: { name: 'Sprint 1' } },
    });
    const client = mockClient({ getBoard });

    const result = await getFolder(client, { folder_id: '5' });

    expect(getBoard).toHaveBeenCalledWith('5');
    expect(result.content[0].text).toContain('Sprint 1');
  });

  it('createFolder calls client.createBoard with type "folders"', async () => {
    const createBoard = vi.fn().mockResolvedValue({
      data: { id: '6', attributes: { name: 'New Folder' } },
    });
    const client = mockClient({ createBoard });

    await createFolder(client, { project_id: '9', name: 'New Folder' });

    const payload = createBoard.mock.calls[0][0];
    expect(payload.data.type).toBe('folders');
    expect(payload.data.attributes.name).toBe('New Folder');
    expect(payload.data.relationships.project.data.id).toBe('9');
  });

  it('updateFolder calls client.updateBoard', async () => {
    const updateBoard = vi.fn().mockResolvedValue({
      data: { id: '5', attributes: { name: 'Renamed' } },
    });
    const client = mockClient({ updateBoard });

    await updateFolder(client, { folder_id: '5', name: 'Renamed' });

    expect(updateBoard).toHaveBeenCalledWith(
      '5',
      expect.objectContaining({ data: expect.objectContaining({ id: '5' }) }),
    );
  });

  it('archiveFolder calls client.archiveBoard', async () => {
    const archiveBoard = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({ archiveBoard });

    await archiveFolder(client, { folder_id: '5' });

    expect(archiveBoard).toHaveBeenCalledWith('5');
  });

  it('restoreFolder calls client.restoreBoard', async () => {
    const restoreBoard = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({ restoreBoard });

    await restoreFolder(client, { folder_id: '5' });

    expect(restoreBoard).toHaveBeenCalledWith('5');
  });

  it('copyFolder calls client.copyBoard with name/template_id/project_id', async () => {
    const copyBoard = vi.fn().mockResolvedValue({
      data: { id: '7', attributes: { name: 'Copy of Sprint 1' } },
    });
    const client = mockClient({ copyBoard });

    await copyFolder(client, { name: 'Copy of Sprint 1', template_id: '5', project_id: '9' });

    expect(copyBoard).toHaveBeenCalledWith({
      name: 'Copy of Sprint 1',
      template_id: '5',
      project_id: '9',
    });
  });

  it('moveFolder calls client.moveBoard with folder_id and project_id', async () => {
    const moveBoard = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({ moveBoard });

    await moveFolder(client, { folder_id: '5', project_id: '9' });

    expect(moveBoard).toHaveBeenCalledWith('5', '9');
  });

  it('repositionFolder calls client.repositionBoard with folder_id and move_before_id', async () => {
    const repositionBoard = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({ repositionBoard });

    await repositionFolder(client, { folder_id: '5', move_before_id: '6' });

    expect(repositionBoard).toHaveBeenCalledWith('5', '6');
  });
});
