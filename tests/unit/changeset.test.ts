import { describe, it, expect } from 'vitest';
import { formatChangeset } from '../../src/tools/changeset.js';

// The old code read a `changes` object that does not exist on activities, so it
// never rendered anything. The real attribute is `changeset`: an array of
// objects whose values are [before, after] pairs.
describe('formatChangeset', () => {
  it('renders a before/after pair per changed field', () => {
    const changeset = [
      {
        used: [
          { value: '0.0', unit: 'days' },
          { value: '1.0', unit: 'days' },
        ],
      },
    ];

    expect(formatChangeset(changeset)).toEqual(['used: 0.0 → 1.0']);
  });

  it('keeps strings unquoted so the common case stays readable', () => {
    expect(formatChangeset([{ title: ['Old title', 'New title'] }])).toEqual([
      'title: Old title → New title',
    ]);
  });

  it('handles several fields across several entries', () => {
    const changeset = [{ title: ['a', 'b'] }, { status: [1, 2], due_date: [null, '2026-09-01'] }];

    expect(formatChangeset(changeset)).toEqual([
      'title: a → b',
      'status: 1 → 2',
      'due_date: null → 2026-09-01',
    ]);
  });

  it('unwraps the { value } envelope Productive puts around change values', () => {
    const changeset = [{ person_id: [null, { value: 'Igor Kretov', id: 1413908 }] }];

    expect(formatChangeset(changeset)).toEqual(['person_id: null → Igor Kretov']);
  });

  it('falls back to the raw value when it is not a before/after pair', () => {
    expect(formatChangeset([{ note: 'single value' }])).toEqual(['note: single value']);
  });

  it('returns nothing for a missing or non-array changeset', () => {
    expect(formatChangeset(undefined)).toEqual([]);
    expect(formatChangeset({ title: ['a', 'b'] })).toEqual([]);
  });
});
