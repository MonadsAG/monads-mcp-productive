import { describe, it, expect, vi } from 'vitest';
import type { ProductiveAPIClient } from '../../src/api/client.js';
import { listCompaniesTool } from '../../src/tools/companies.js';

function mockCompany(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'companies',
    attributes: {
      name: 'Acme',
      billing_name: 'Acme AG',
      default_currency: 'CHF',
      company_code: 'ACME1',
      tag_list: ['client'],
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    },
  };
}

async function listCompaniesText(companies: unknown[]): Promise<string> {
  const client = {
    listCompanies: vi.fn().mockResolvedValue({ data: companies }),
  } as unknown as ProductiveAPIClient;

  const result = await listCompaniesTool(client, {});
  return result.content[0].text;
}

describe('listCompaniesTool', () => {
  it('shows the name, ID, every email domain and the tags of a company', async () => {
    const text = await listCompaniesText([mockCompany('1', { domains: ['acme.com', 'acme.ch'] })]);

    expect(text).toContain('• Acme (ID: 1)');
    expect(text).toContain('Domains: acme.com, acme.ch');
    expect(text).toContain('Tags: client');
  });

  it('says so when a company has no email domains', async () => {
    const text = await listCompaniesText([mockCompany('1', { domains: [] }), mockCompany('2')]);

    expect(text.match(/No domains/g) ?? []).toHaveLength(2);
    expect(text).not.toContain('Domains:');
  });
});
