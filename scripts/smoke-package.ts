/**
 * Install the npm package the way the MCP hub gets it and start it over stdio.
 *
 *   npm run build && npm run package:smoke
 *
 * Packs the package (with npm-shrinkwrap.json), checks the tarball contents and
 * serves it from a throwaway local registry for the @monadsag scope. Then
 * `npx -y --prefer-online @monadsag/productive-mcp@<version>` installs and starts
 * it, exactly like the hub does, and the script speaks MCP to it. Catches what
 * the unit tests cannot: a runtime import that only resolves because
 * devDependencies are installed in the repo, a file missing from `files`, a
 * shrinkwrap npm ignores, a log line on stdout (the MCP channel), or the token
 * leaking to stderr.
 *
 * Two runs, neither calls Productive: one with PRODUCTIVE_USER_ID set, and the
 * hub case with only token and org, where the "me" lookup goes to a closed
 * local port and has to degrade instead of stopping the server.
 */

import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { removeShrinkwrap, writeShrinkwrap } from './write-shrinkwrap.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'smoke-dummy-token-7f3a';
// The first run includes the npx install.
const RUN_TIMEOUT_MS = 180_000;
const REQUIRED_FILES = [
  'build/index.js',
  'LICENSE',
  'NOTICE',
  'README.md',
  'npm-shrinkwrap.json',
  'package.json',
];
const shell = process.platform === 'win32';

type JsonRpc = { jsonrpc?: string; id?: number; result?: Record<string, unknown> };
type Manifest = { name: string; version: string };
type LockEntry = { version?: string };

function fail(message: string): never {
  console.error(`package smoke test failed: ${message}`);
  process.exit(1);
}

/** Pack with a fresh shrinkwrap, check what went in, return the tarball path. */
function pack(dir: string): string {
  writeShrinkwrap();
  try {
    const output = execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
      cwd: ROOT,
      encoding: 'utf8',
      shell,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const [result] = JSON.parse(output) as { filename: string; files: { path: string }[] }[];
    const files = result.files.map((file) => file.path);
    const missing = REQUIRED_FILES.filter((file) => !files.includes(file));
    const extra = files.filter((f) => !REQUIRED_FILES.includes(f) && !/^build\/.+\.js$/.test(f));
    if (missing.length || extra.length) {
      fail(
        `package contents: missing ${missing.join(', ') || '-'}; unexpected ${extra.join(', ') || '-'}`,
      );
    }
    return join(dir, result.filename);
  } finally {
    removeShrinkwrap();
  }
}

/**
 * Serve one package version like the npm registry does. `_hasShrinkwrap` is what
 * the registry sets for a tarball that contains npm-shrinkwrap.json, and the
 * only thing that makes npm honour it -- a plain `npm install <tarball>` does not.
 */
async function serveRegistry(tarball: string, manifest: Manifest): Promise<string> {
  const bytes = readFileSync(tarball);
  const server = createServer((req, res) => {
    if (req.url?.endsWith('.tgz')) return void res.end(bytes);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const dist = {
      tarball: `${base}/package.tgz`,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      shasum: createHash('sha1').update(bytes).digest('hex'),
    };
    const version = { ...manifest, _hasShrinkwrap: true, dist };
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        name: manifest.name,
        'dist-tags': { latest: manifest.version },
        versions: { [manifest.version]: version },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

/** Start the package the way the hub does: npx from the registry, hub-style env. */
function startNpx(dir: string, registry: string, manifest: Manifest, env: object) {
  const scope = manifest.name.split('/')[0];
  const args = ['-y', '--prefer-online', '--cache', join(dir, 'cache')];
  args.push(`--${scope}:registry=${registry}`, `${manifest.name}@${manifest.version}`);
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('PRODUCTIVE_')),
  );
  return spawn('npx', args, { cwd: dir, shell, env: { ...baseEnv, ...env } });
}

/** JSON-RPC over the child's stdio; any stdout line that is not JSON-RPC fails the run. */
function jsonRpc(child: ChildProcessWithoutNullStreams, label: string) {
  const pending = new Map<number, (message: JsonRpc) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message: JsonRpc;
    try {
      message = JSON.parse(line) as JsonRpc;
    } catch {
      fail(`${label}: non-JSON line on stdout: ${line.slice(0, 200)}`);
    }
    if (message.jsonrpc !== '2.0')
      fail(`${label}: non-JSON-RPC line on stdout: ${line.slice(0, 200)}`);
    if (message.id !== undefined) pending.get(message.id)?.(message);
  });
  let nextId = 1;
  const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
  return {
    notify: (method: string) => send({ jsonrpc: '2.0', method }),
    request: (method: string, params: Record<string, unknown> = {}): Promise<JsonRpc> => {
      const id = nextId++;
      send({ jsonrpc: '2.0', id, method, params });
      return new Promise((resolve) => pending.set(id, resolve));
    },
  };
}

/** One start: initialize + tools/list, checking the version, stdout and stderr. */
async function run(label: string, dir: string, registry: string, manifest: Manifest, env: object) {
  const child = startNpx(dir, registry, manifest, env);
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  child.on('exit', (code) => fail(`${label}: server exited early (code ${code})\n${stderr}`));
  const timer = setTimeout(
    () => fail(`${label}: no answer within ${RUN_TIMEOUT_MS} ms\n${stderr}`),
    RUN_TIMEOUT_MS,
  );

  const rpc = jsonRpc(child, label);
  const init = await rpc.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'package-smoke', version: '0' },
  });
  const serverVersion = (init.result?.serverInfo as { version?: string } | undefined)?.version;
  if (serverVersion !== manifest.version) {
    fail(`${label}: serverInfo.version is ${serverVersion}, expected ${manifest.version}`);
  }
  rpc.notify('notifications/initialized');
  const tools = ((await rpc.request('tools/list')).result?.tools as unknown[] | undefined) ?? [];

  clearTimeout(timer);
  child.removeAllListeners('exit');
  child.kill();
  if (tools.length === 0) fail(`${label}: tools/list returned no tools`);
  if (stderr.includes(TOKEN)) fail(`${label}: the API token appeared on stderr`);
  return { tools: tools.length, stderr };
}

/** Every package npx installed must be the version package-lock.json pins. */
function assertPinnedTree(dir: string, manifest: Manifest): number {
  const npxRoot = join(dir, 'cache', '_npx');
  const [hash] = readdirSync(npxRoot);
  const read = (file: string) =>
    (JSON.parse(readFileSync(file, 'utf8')) as { packages: Record<string, LockEntry> }).packages;
  const installed = read(join(npxRoot, hash, 'node_modules', '.package-lock.json'));
  const locked = read(join(ROOT, 'package-lock.json'));
  const own = `node_modules/${manifest.name}`;

  const drift = Object.entries(installed)
    .filter(([path]) => path !== own)
    .map(([path, entry]) => [path.replace(`${own}/`, ''), entry.version] as const)
    .filter(([path, version]) => locked[path]?.version !== version);
  if (drift.length) {
    fail(`not the locked tree: ${drift.map(([p, v]) => `${p}@${v}`).join(', ')}`);
  }
  return Object.keys(installed).length - 1;
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest;
const dir = mkdtempSync(join(tmpdir(), 'productive-mcp-smoke-'));
process.on('exit', () => {
  // On Windows the killed server can still hold its files for a moment.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // a leftover temp directory is not worth a red run
  }
});

const registry = await serveRegistry(pack(dir), manifest);
const env = { PRODUCTIVE_API_TOKEN: TOKEN, PRODUCTIVE_ORG_ID: '1-smoke' };
const withUser = await run('with PRODUCTIVE_USER_ID', dir, registry, manifest, {
  ...env,
  PRODUCTIVE_USER_ID: '1',
});
const pinned = assertPinnedTree(dir, manifest);
const tokenOnly = await run('token and org only', dir, registry, manifest, {
  ...env,
  PRODUCTIVE_API_BASE_URL: 'http://127.0.0.1:9/api/v2/',
});
if (!tokenOnly.stderr.includes('Could not determine the Productive person ID')) {
  fail(`token and org only: expected the "me" lookup to fail and warn\n${tokenOnly.stderr}`);
}

console.log(
  `package smoke test passed: ${manifest.version}, ${withUser.tools} tools, ` +
    `${pinned} dependencies as locked, stdout clean, starts with token and org only`,
);
process.exit(0);
