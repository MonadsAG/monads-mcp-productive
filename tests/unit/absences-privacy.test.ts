import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * `people_custom_fields` is populated by the API with the booked person's custom
 * field values -- date of birth, gender, a bank-account-like field. It must never
 * reach a tool response, where it would land in the model context.
 */
describe('personal data is not leaked into tool output', () => {
  const toolFiles = [
    'src/tools/absences.ts',
    'src/tools/bookings.ts',
    'src/tools/capacity.ts',
    'src/api/bookings-client.ts',
  ];

  it.each(toolFiles)('%s never reads people_custom_fields', (file) => {
    expect(readFileSync(file, 'utf8')).not.toContain('people_custom_fields');
  });

  it.each(toolFiles)('%s never dumps a raw API payload', (file) => {
    // JSON.stringify of a response object would carry every attribute along.
    expect(readFileSync(file, 'utf8')).not.toMatch(/JSON\.stringify\((response|booking|created)/);
  });
});
