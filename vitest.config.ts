import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Runs once in the main process; warns when the integration suites are
    // about to skip for want of credentials. See tests/global-setup.ts.
    globalSetup: ['./tests/global-setup.ts'],
  },
});
