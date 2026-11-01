import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { listProjectsTool } from '../../src/tools/projects.js';

// Shaped like the live response: no `status` attribute, only `archived_at`.
function mockProject(id: string, archivedAt: string | null) {
  return {
    id,
    type: 'projects',
    attributes: {
      name: `Project ${id}`,
      archived_at: archivedAt,
      created_at: '2026-01-01T09:00:00.000+00:00',
    },
  };
}

async function listProjectsText(projects: unknown[]): Promise<string> {
  const client = {
    listProjects: vi.fn().mockResolvedValue({ data: projects }),
  } as unknown as ProductiveAPIClient;

  const result = await listProjectsTool(client, {});
  return result.content[0].text;
}

describe('listProjectsTool', () => {
  it('derives the status from archived_at instead of printing undefined', async () => {
    const text = await listProjectsText([
      mockProject('1', null),
      mockProject('2', '2026-03-15T10:30:00.000+00:00'),
    ]);

    expect(text).toContain('• Project 1 (ID: 1)\n  Status: active');
    expect(text).toContain('• Project 2 (ID: 2)\n  Status: archived');
    expect(text).not.toContain('undefined');
  });

  it('also honours the documented status attribute, should a response carry it', async () => {
    const project = {
      ...mockProject('1', null),
      attributes: { ...mockProject('1', null).attributes, status: 2 },
    };

    expect(await listProjectsText([project])).toContain('Status: archived');
  });

  it('treats a project without archived_at as active', async () => {
    const project = mockProject('1', null);
    delete (project.attributes as { archived_at?: string | null }).archived_at;

    expect(await listProjectsText([project])).toContain('Status: active');
  });
});
