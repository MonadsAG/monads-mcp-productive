import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Say out loud when the integration suites are about to skip themselves.
 *
 * Every suite under tests/integration/ is wrapped in
 * `describe.skipIf(!process.env.PRODUCTIVE_API_TOKEN)`, and tests/setup.ts loads
 * .dev.vars through dotenv, which reports a missing file only via a return value
 * nobody reads. Without credentials `npm test` therefore passes with
 * "Test Files 5 skipped (5)" and has verified nothing that talks to Productive.
 * Breaking that silent green is this file's only job.
 *
 * It lives in `globalSetup` rather than `setupFiles` deliberately: setup files
 * run once per test file (five identical warnings) inside workers whose console
 * output Vitest swallows when every test in the file is skipped. globalSetup
 * runs exactly once, in the main process, where the warning actually surfaces.
 */
export default function globalSetup(): void {
  // ci.yml never sets the token on purpose, so warning there would fire on every
  // run and mean nothing.
  if (process.env.CI) return;

  const devVarsPath = path.resolve(process.cwd(), '.dev.vars');
  const exists = existsSync(devVarsPath);

  // Parsed, not loaded: this only needs to know whether a token is configured,
  // and globalSetup has no business mutating the env the workers will build.
  // An already-set variable wins, mirroring dotenv's own precedence.
  const fromFile = exists ? parse(readFileSync(devVarsPath)) : {};
  const token = process.env.PRODUCTIVE_API_TOKEN || fromFile.PRODUCTIVE_API_TOKEN;

  if (token) return;

  const reason = exists ? '.dev.vars sets no PRODUCTIVE_API_TOKEN' : 'no .dev.vars found';

  // console.error, never stdout -- project convention (see CLAUDE.md).
  // The token itself is never read, printed or logged; only its presence.
  console.error(
    `\n[tests] ${reason} -- the integration suites under tests/integration/ will skip.\n` +
      '        A green run verifies nothing against the Productive API.\n' +
      '        Copy .dev.vars.example to .dev.vars to run them; see CLAUDE.md (CI).\n',
  );
}
