/**
 * Install the npm package the way a consumer gets it and start its bin over stdio.
 *
 *   npm run build && npm run package:smoke
 *
 * `npm pack`, install the tarball into an empty temp directory, run
 * `npx productive-mcp` there and speak MCP to it. Catches what the unit tests
 * cannot: a runtime import that only resolves because devDependencies are
 * installed in the repo, a file missing from `files`, or a log line on stdout,
 * which is the MCP channel. PRODUCTIVE_USER_ID is set so the server makes no
 * API call at all -- the token is a dummy.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'smoke-dummy-token-7f3a';
const TIMEOUT_MS = 30_000;
const shell = process.platform === 'win32';

type JsonRpc = { jsonrpc?: string; id?: number; result?: Record<string, unknown>; error?: unknown };

function npm(args: string[], cwd: string): string {
  return execFileSync('npm', args, {
    cwd,
    encoding: 'utf8',
    shell,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function fail(message: string): never {
  console.error(`package smoke test failed: ${message}`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
};
const dir = mkdtempSync(join(tmpdir(), 'productive-mcp-smoke-'));
process.on('exit', () => {
  // On Windows the killed server can still hold its files for a moment.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // a leftover temp directory is not worth a red run
  }
});

const tarball = join(dir, npm(['pack', '--silent', '--pack-destination', dir], ROOT).trim());
writeFileSync(join(dir, 'package.json'), '{ "private": true }\n');
npm(['install', '--silent', '--no-audit', '--no-fund', tarball], dir);

const child = spawn('npx', ['--no-install', 'productive-mcp'], {
  cwd: dir,
  shell,
  env: {
    ...process.env,
    PRODUCTIVE_API_TOKEN: TOKEN,
    PRODUCTIVE_ORG_ID: '1-smoke',
    PRODUCTIVE_USER_ID: '1',
  },
});
let stderr = '';
child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
child.on('exit', (code) => fail(`server exited early (code ${code})\n${stderr}`));
setTimeout(() => fail(`no answer within ${TIMEOUT_MS} ms\n${stderr}`), TIMEOUT_MS).unref();

const pending = new Map<number, (message: JsonRpc) => void>();
createInterface({ input: child.stdout }).on('line', (line) => {
  let message: JsonRpc;
  try {
    message = JSON.parse(line) as JsonRpc;
  } catch {
    fail(`non-JSON line on stdout: ${line.slice(0, 200)}`);
  }
  if (message.jsonrpc !== '2.0') fail(`non-JSON-RPC line on stdout: ${line.slice(0, 200)}`);
  if (message.id !== undefined) pending.get(message.id)?.(message);
});

let nextId = 1;
function request(method: string, params: Record<string, unknown> = {}): Promise<JsonRpc> {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve) => pending.set(id, resolve));
}

const init = await request('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'package-smoke', version: '0' },
});
const serverVersion = (init.result?.serverInfo as { version?: string } | undefined)?.version;
if (serverVersion !== version) fail(`serverInfo.version is ${serverVersion}, expected ${version}`);

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const tools = ((await request('tools/list')).result?.tools as unknown[] | undefined) ?? [];
if (tools.length === 0) fail('tools/list returned no tools');
if (stderr.includes(TOKEN)) fail('the API token appeared on stderr');

child.removeAllListeners('exit');
child.kill();
console.log(`package smoke test passed: ${version}, ${tools.length} tools, stdout clean`);
process.exit(0);
