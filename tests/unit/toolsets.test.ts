import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import type { Config } from '../../src/config/index.js';
import { TOOLSETS, getEnabledToolNames } from '../../src/tools/toolsets.js';
import { getToolDefinitions, handleToolCall } from '../../src/tools/registry.js';

describe('getEnabledToolNames', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each([undefined, '', '  ', 'all', 'ALL'])('returns null for %j (all tools)', (raw) => {
    expect(getEnabledToolNames(raw)).toBeNull();
  });

  it('returns the union of tool names across the requested toolsets', () => {
    const enabled = getEnabledToolNames('tasks,custom_fields');
    const expected = new Set([...TOOLSETS.tasks, ...TOOLSETS.custom_fields]);

    expect(enabled).toEqual(expected);
  });

  it('ignores unknown toolset names and logs a warning', () => {
    const enabled = getEnabledToolNames('tasks,bogus_toolset');

    expect(enabled).toEqual(new Set(TOOLSETS.tasks));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('bogus_toolset'));
  });

  it('fails open (returns null) when every requested toolset name is invalid', () => {
    expect(getEnabledToolNames('bogus_name')).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('TOOLSETS catalog completeness', () => {
  it('covers every tool from getToolDefinitions() exactly once, with no orphans or duplicates', () => {
    const allToolNames = getToolDefinitions(null).map((def) => def.name);
    const catalogNames = Object.values(TOOLSETS).flat();

    // No duplicate tool name across two different toolsets.
    expect(new Set(catalogNames).size).toBe(catalogNames.length);

    // Every real tool name is covered by the catalog, and the catalog contains
    // no names that don't correspond to a real, registered tool.
    expect(new Set(catalogNames)).toEqual(new Set(allToolNames));
  });
});

describe('getToolDefinitions filtering', () => {
  it('returns every tool when passed null', () => {
    expect(getToolDefinitions(null).length).toBe(getToolDefinitions().length);
  });

  it('returns no tools when passed an empty set', () => {
    expect(getToolDefinitions(new Set())).toEqual([]);
  });

  it('returns only tools in the enabled set', () => {
    const enabled = new Set(['whoami', 'list_companies']);
    const names = getToolDefinitions(enabled).map((def) => def.name);

    expect(names.sort()).toEqual(['list_companies', 'whoami']);
  });
});

describe('handleToolCall toolset enforcement', () => {
  it('rejects a call to a tool outside the enabled set without invoking its handler', async () => {
    const deleteTask = vi.fn();
    const apiClient = { deleteTask } as unknown as ProductiveAPIClient;
    const config = {} as Config;
    const enabledToolNames = new Set(['whoami']);

    await expect(
      handleToolCall('delete_task', { task_id: '123' }, apiClient, config, enabledToolNames),
    ).rejects.toThrow(/not enabled/i);

    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('mentions the owning toolset in the rejection message', async () => {
    const apiClient = {} as ProductiveAPIClient;
    const config = {} as Config;
    const enabledToolNames = new Set(['whoami']);

    await expect(
      handleToolCall('delete_task', { task_id: '123' }, apiClient, config, enabledToolNames),
    ).rejects.toThrow(/tasks/);
  });

  it('does not apply the toolset gate when enabledToolNames is omitted or null', async () => {
    const apiClient = {} as ProductiveAPIClient;
    const config = {} as Config;

    // client.deleteTask doesn't exist on this stub, so the call still fails --
    // but with the tool's own internal error, not the toolset-gate rejection.
    await expect(
      handleToolCall('delete_task', { task_id: '123' }, apiClient, config),
    ).rejects.not.toThrow(/not enabled/i);
    await expect(
      handleToolCall('delete_task', { task_id: '123' }, apiClient, config, null),
    ).rejects.not.toThrow(/not enabled/i);
  });
});
