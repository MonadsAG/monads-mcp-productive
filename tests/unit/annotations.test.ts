import { describe, it, expect } from 'vitest';
import { getToolDefinitions } from '../../src/tools/registry.js';

const definitions = getToolDefinitions(null);

/** Reads Productive and changes nothing. */
function isRead(name: string): boolean {
  return (
    name.startsWith('list_') || name.startsWith('get_') || name === 'my_tasks' || name === 'whoami'
  );
}

// The `satisfies` clause in registry.ts already makes a missing `annotations`
// a compile error. What it cannot check is whether the hints say something
// *true*, which is what matters: a client gating confirmation on
// destructiveHint is actively misled by a wrong one, where a missing one would
// only have made it cautious.
describe('tool annotations', () => {
  it('gives every tool a title', () => {
    const untitled = definitions.filter((d) => !d.annotations.title?.trim()).map((d) => d.name);

    expect(untitled).toEqual([]);
  });

  it('marks every read-only tool readOnlyHint and nothing else', () => {
    const wrong = definitions
      .filter((d) => isRead(d.name))
      .filter((d) => d.annotations.readOnlyHint !== true || d.annotations.destructiveHint === true)
      .map((d) => d.name);

    expect(wrong).toEqual([]);
  });

  it('gives every writing tool the full set of hints', () => {
    const incomplete = definitions
      .filter((d) => !isRead(d.name))
      .filter(
        (d) =>
          d.annotations.readOnlyHint !== false ||
          typeof d.annotations.destructiveHint !== 'boolean' ||
          typeof d.annotations.idempotentHint !== 'boolean',
      )
      .map((d) => d.name);

    expect(incomplete).toEqual([]);
  });

  // Productive is shared: two identical calls can differ because of what
  // somebody else did in the meantime. No tool here is a closed world.
  it('marks every tool openWorldHint', () => {
    const closed = definitions
      .filter((d) => d.annotations.openWorldHint !== true)
      .map((d) => d.name);

    expect(closed).toEqual([]);
  });

  // Pinned as a literal list on purpose. Reclassifying one of these -- or
  // adding a delete tool and forgetting to -- should fail here, loudly, rather
  // than quietly changing what a client decides to confirm.
  it('marks exactly the irreversible tools destructive', () => {
    const destructive = definitions
      .filter((d) => d.annotations.destructiveHint === true)
      .map((d) => d.name)
      .sort();

    expect(destructive).toEqual([
      'archive_folder',
      'archive_task_list',
      'delete_comment',
      'delete_invoice',
      'delete_page',
      'delete_task',
      'delete_task_dependency',
      'delete_todo',
      'finalize_invoice',
      'mark_invoice_paid',
    ]);
  });

  // Every call to a create tool makes another object; every other write settles
  // on the same end state when repeated.
  it('marks creates non-idempotent and other writes idempotent', () => {
    const nonIdempotent = definitions
      .filter((d) => !isRead(d.name) && d.annotations.idempotentHint === false)
      .map((d) => d.name)
      .sort();

    expect(nonIdempotent).toEqual([
      'add_comment_reaction',
      'add_task_comment',
      'copy_folder',
      'copy_page',
      'copy_task_list',
      'create_budget',
      'create_budget_from_deal',
      'create_budget_service',
      'create_folder',
      'create_invoice',
      'create_page',
      'create_subtask',
      'create_task',
      'create_task_dependency',
      'create_task_list',
      'create_time_entry',
      'create_todo',
      'generate_line_items',
      'start_timer',
    ]);
  });
});
