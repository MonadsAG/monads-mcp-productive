import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createServer } from '../../src/server.js';
// Evaluated for its side effect: constructing the (mocked) OAuthProvider captures the apiHandler.
import '../../src/worker.js';
import { getUserPat } from '../../src/auth/pat-store.js';
import type { WorkerEnv } from '../../src/config/worker-config.js';

type WorkerFetch = (request: Request, env: WorkerEnv, ctx: unknown) => Promise<Response>;

const captured = vi.hoisted(() => ({
  stdioTransport: {} as object,
  workerServer: undefined as Server | undefined,
  workerFetch: undefined as WorkerFetch | undefined,
}));

// stdio entry: hand createServer() one end of an in-memory pair instead of stdin/stdout.
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    constructor() {
      return captured.stdioTransport;
    }
  },
}));

// A configured PRODUCTIVE_USER_ID means no API call at startup (see self-resolver).
vi.mock('../../src/config/index.js', () => ({
  getConfig: () => ({
    PRODUCTIVE_API_TOKEN: 'test-token',
    PRODUCTIVE_ORG_ID: '1',
    PRODUCTIVE_USER_ID: '42',
    PRODUCTIVE_API_BASE_URL: 'https://api.example.test/',
  }),
}));

// Worker entry: capture the apiHandler and the per-request Server it builds.
vi.mock('@cloudflare/workers-oauth-provider', () => ({
  default: class {
    constructor(options: { apiHandler: { fetch: WorkerFetch } }) {
      captured.workerFetch = options.apiHandler.fetch;
    }
  },
}));

vi.mock('agents/mcp', () => ({
  createMcpHandler: (server: Server) => async () => {
    captured.workerServer = server;
    return new Response(null, { status: 204 });
  },
}));

vi.mock('../../src/auth/entra-handler.js', () => ({ EntraAuthHandler: {} }));
vi.mock('../../src/auth/pat-store.js', () => ({ getUserPat: vi.fn() }));
vi.mock('../../src/auth/user-resolver.js', () => ({ resolveUserId: vi.fn(async () => '42') }));

async function connectClient(clientTransport: InMemoryTransport): Promise<Client> {
  const client = new Client({ name: 'prompts-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function expectTimesheetPrompts(client: Client) {
  expect(client.getServerCapabilities()?.prompts).toBeDefined();

  const { prompts } = await client.listPrompts();
  expect(prompts.map((prompt) => prompt.name)).toEqual(['timesheet_entry', 'timesheet_step']);

  const entry = await client.getPrompt({ name: 'timesheet_entry', arguments: {} });
  expect(entry.messages.length).toBeGreaterThan(0);

  const step = await client.getPrompt({ name: 'timesheet_step', arguments: { step: 'project' } });
  expect(step.messages.length).toBeGreaterThan(0);
}

describe('timesheet prompts', () => {
  beforeEach(() => {
    captured.workerServer = undefined;
  });

  it('are served by the stdio entry point', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    captured.stdioTransport = serverTransport;

    await createServer();
    const client = await connectClient(clientTransport);

    await expectTimesheetPrompts(client);
  });

  it.each([
    ['with a stored PAT', 'stored-pat'],
    ['without a stored PAT', null],
  ])('are served by the Worker entry point %s', async (_label, pat) => {
    vi.mocked(getUserPat).mockResolvedValue(pat);

    await captured.workerFetch!(
      new Request('https://mcp.example.test/mcp', { method: 'POST' }),
      { PRODUCTIVE_ORG_ID: '1' } as WorkerEnv,
      { props: { oid: 'oid-1', email: 'user@example.test' } },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await captured.workerServer!.connect(serverTransport);
    const client = await connectClient(clientTransport);

    await expectTimesheetPrompts(client);
  });
});
