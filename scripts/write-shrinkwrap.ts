/**
 * Write npm-shrinkwrap.json for the npm package from package-lock.json.
 *
 *   npm run package:shrinkwrap        # write it
 *   npm run package:shrinkwrap -- --remove
 *
 * The MCP hub starts `npx @monadsag/productive-mcp@latest`, so without a
 * shrinkwrap every process start resolves the ^-ranges anew and runs a
 * dependency tree no CI run has seen. A published npm-shrinkwrap.json pins it
 * to the tree CI tested. Only the runtime entries are kept: the lock also
 * carries the Worker and tooling devDependencies, which the package never
 * installs.
 *
 * The file is not committed (.gitignore). While it exists, npm in this repo
 * reads it instead of package-lock.json -- write it right before pack/publish
 * and remove it afterwards.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SHRINKWRAP_FILE = join(ROOT, 'npm-shrinkwrap.json');

type LockEntry = { dev?: boolean; devDependencies?: Record<string, string> };
type Lockfile = { lockfileVersion: number; packages: Record<string, LockEntry> };

export function buildShrinkwrap(lock: Lockfile): Lockfile {
  if (lock.lockfileVersion < 2) throw new Error('package-lock.json v2 or newer expected');
  const { devDependencies: _, ...root } = lock.packages[''] ?? {};
  const runtime = Object.entries(lock.packages).filter(([path, entry]) => path && !entry.dev);
  return { ...lock, packages: { '': root, ...Object.fromEntries(runtime) } };
}

export function writeShrinkwrap(): number {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as Lockfile;
  const shrinkwrap = buildShrinkwrap(lock);
  writeFileSync(SHRINKWRAP_FILE, JSON.stringify(shrinkwrap, null, 2) + '\n');
  return Object.keys(shrinkwrap.packages).length - 1;
}

export function removeShrinkwrap(): void {
  rmSync(SHRINKWRAP_FILE, { force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--remove')) {
    removeShrinkwrap();
  } else {
    console.log(`npm-shrinkwrap.json: ${writeShrinkwrap()} runtime packages pinned`);
  }
}
