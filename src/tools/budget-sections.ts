import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveAPIClient } from '../api/client.js';
import type { ProductiveResponse, ProductiveSection, ProductiveService } from '../api/types.js';
import { collectPages, MAX_PAGE_SIZE, type CollectedPages } from '../api/invoice-time-entries.js';
import { toMcpError } from '../utils/errors.js';
import { toNumericId, type ToolResult } from './tool-helpers.js';

// Ceiling for every sweep in this file (10 x 200 rows). Past it a list says it
// may be incomplete and a delete refuses.
const MAX_PAGES = 10;

// ---------------------------------------------------------------------------
// Linkage and completeness
// ---------------------------------------------------------------------------

/**
 * What a to-one relationship says: linked to an id, explicitly empty
 * (`data: null`), or unknown. Unknown covers the stub Productive returns when
 * the relationship was not sideloaded (`meta.included: false`) even if it also
 * carries `data: null` -- reading that as "empty" would let a delete through on
 * missing information.
 */
export type Linkage = { kind: 'linked'; id: string } | { kind: 'none' } | { kind: 'unknown' };

const linkageSchema = z.object({
  data: z.object({ id: z.union([z.string(), z.number()]).transform(String) }).nullable(),
  meta: z.object({ included: z.boolean().optional() }).optional(),
});

export function readLinkage(relationship: unknown): Linkage {
  const parsed = linkageSchema.safeParse(relationship);
  if (!parsed.success || parsed.data.meta?.included === false) return { kind: 'unknown' };
  return parsed.data.data ? { kind: 'linked', id: parsed.data.data.id } : { kind: 'none' };
}

function sectionOf(service: ProductiveService): Linkage {
  return readLinkage(service.relationships?.section);
}

function isIn(service: ProductiveService, sectionId: string): boolean {
  const link = sectionOf(service);
  return link.kind === 'linked' && link.id === sectionId;
}

/**
 * Why a sweep did not provably read every row, or null when it did. Neither
 * /services nor /sections offers a unique sort key, so a row can slip across a
 * page boundary without the deduplication noticing; only the total Productive
 * reports proves the list complete.
 */
function incompleteness<T>(pages: CollectedPages<T>): string | null {
  if (pages.truncated) return `more than ${MAX_PAGES * MAX_PAGE_SIZE} rows came back`;
  if (pages.expected === undefined) return 'Productive reported no total';
  if (pages.rows.length !== pages.expected) {
    return `${pages.rows.length} of ${pages.expected} reported rows were read`;
  }
  return null;
}

function sweep<T extends { id: string }>(
  fetchPage: (page: number) => Promise<ProductiveResponse<T>>,
): Promise<CollectedPages<T>> {
  return collectPages(fetchPage, MAX_PAGES, MAX_PAGE_SIZE);
}

interface ServiceSweep {
  rows: ProductiveService[];
  /** Why the lookup is not provably complete; empty when it is. */
  gaps: string[];
}

/**
 * Per the spec, /services leaves out the services of budgets that are not
 * linked to a project unless `filter[projectless_budgets]=true` is set, and
 * create_budget makes such budgets. Every service lookup therefore runs once
 * without and once with the flag, merged by id: whether the flag adds those
 * services or narrows the result to them, the union covers both.
 */
async function sweepServices(
  fetchPage: (page: number, projectless: boolean) => Promise<ProductiveResponse<ProductiveService>>,
): Promise<ServiceSweep> {
  const lookups = await Promise.all(
    [false, true].map((projectless) => sweep((page) => fetchPage(page, projectless))),
  );
  const byId = new Map<string, ProductiveService>();
  for (const lookup of lookups) for (const row of lookup.rows) byId.set(row.id, row);

  const labels = ['plain lookup', 'lookup including budgets without a project'];
  const gaps = lookups.flatMap((lookup, i) => {
    const why = incompleteness(lookup);
    return why === null ? [] : [`${labels[i]}: ${why}`];
  });
  return { rows: [...byId.values()], gaps };
}

// ---------------------------------------------------------------------------
// Tool: list_budget_sections
// ---------------------------------------------------------------------------

const listBudgetSectionsSchema = z.object({
  budget_id: z.string().min(1, 'Budget ID is required'),
});

/** Sections ordered as Productive positions them; unpositioned ones last, by id. */
function byPosition(a: ProductiveSection, b: ProductiveSection): number {
  const pa = a.attributes.position ?? Number.MAX_SAFE_INTEGER;
  const pb = b.attributes.position ?? Number.MAX_SAFE_INTEGER;
  return pa - pb || Number(a.id) - Number(b.id);
}

function serviceLines(services: ProductiveService[]): string[] {
  return services.map((s) => `  - Service ${s.id}: ${s.attributes.name}`);
}

function countLabel(n: number): string {
  return n === 0 ? 'no services' : `${n} service${n === 1 ? '' : 's'}`;
}

/**
 * A section's name, or null when it has none: Productive keeps sections with
 * an empty name (seen live), and a blank in the output reads like a bug.
 */
function nameOf(section: ProductiveSection): string | null {
  return section.attributes.name?.trim() ? section.attributes.name : null;
}

function sectionHeading(section: ProductiveSection, members: number): string {
  const unreported =
    readLinkage(section.relationships?.deal).kind === 'linked' ? '' : ', budget not reported';
  const details = `${countLabel(members)}${unreported}`;
  const name = nameOf(section);
  return name === null
    ? `Section ${section.id} (unnamed, ${details})`
    : `Section ${section.id}: ${name} (${details})`;
}

function formatSectionList(
  budgetId: string,
  sections: ProductiveSection[],
  services: ProductiveService[],
  notes: string[],
): string {
  const lines = [
    `Budget ${budgetId}: ${sections.length} section(s), ${services.length} service(s)`,
  ];

  for (const section of sections) {
    const members = services.filter((s) => isIn(s, String(section.id)));
    lines.push('', sectionHeading(section, members.length), ...serviceLines(members));
  }

  const known = new Set(sections.map((s) => String(s.id)));
  const groups: Array<[string, (link: Linkage) => boolean]> = [
    ['Not in any section', (link) => link.kind === 'none'],
    ['In a section not listed above', (link) => link.kind === 'linked' && !known.has(link.id)],
    ['Section unknown (Productive did not report it)', (link) => link.kind === 'unknown'],
  ];
  for (const [label, matches] of groups) {
    const members = services.filter((s) => matches(sectionOf(s)));
    if (members.length > 0) {
      lines.push('', `${label} (${countLabel(members.length)})`, ...serviceLines(members));
    }
  }

  for (const note of notes) lines.push('', note);
  return lines.join('\n');
}

export async function listBudgetSectionsTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const { budget_id } = listBudgetSectionsSchema.parse(args);
    const budgetId = String(toNumericId(budget_id, 'budget_id'));

    const [sectionPages, services] = await Promise.all([
      sweep((page) => client.listSections(budgetId, page)),
      sweepServices((page, projectless) =>
        client.listDealServices({
          deal_id: budgetId,
          include: 'section',
          limit: MAX_PAGE_SIZE,
          page,
          projectless_budgets: projectless,
        }),
      ),
    ]);

    // A filter can be accepted and still not narrow the result (CLAUDE.md,
    // Gotchas), so sections that name a different budget are dropped here.
    const sections = sectionPages.rows
      .filter((s) => {
        const deal = readLinkage(s.relationships?.deal);
        return deal.kind !== 'linked' || deal.id === budgetId;
      })
      .sort(byPosition);

    const notes: string[] = [];
    const foreign = sectionPages.rows.length - sections.length;
    if (foreign > 0) notes.push(`Left out ${foreign} section(s) that belong to other budgets.`);
    const sectionGap = incompleteness(sectionPages);
    if (sectionGap) notes.push(`The section list may be incomplete: ${sectionGap}.`);
    if (services.gaps.length > 0) {
      notes.push(`The service list may be incomplete: ${services.gaps.join('; ')}.`);
    }

    return {
      content: [
        { type: 'text', text: formatSectionList(budgetId, sections, services.rows, notes) },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const listBudgetSectionsDefinition = {
  name: 'list_budget_sections',
  description:
    'List the sections of a budget (groups of services, e.g. project phases) together with the ' +
    'services in each section. Services that are in no section are listed separately. ' +
    'Use list_company_budgets or create_budget to get budget_id.',
  inputSchema: {
    type: 'object',
    required: ['budget_id'],
    properties: {
      budget_id: { type: 'string', description: 'Budget ID' },
    },
  },
  annotations: {
    title: 'List budget sections',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

// ---------------------------------------------------------------------------
// Tool: create_budget_section
// ---------------------------------------------------------------------------

const createBudgetSectionSchema = z.object({
  budget_id: z.string().min(1, 'Budget ID is required'),
  name: z.string().trim().min(1, 'Name is required'),
});

export async function createBudgetSectionTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const { budget_id, name } = createBudgetSectionSchema.parse(args);
    const budgetId = toNumericId(budget_id, 'budget_id');

    const response = await client.createSection({
      data: { type: 'sections', attributes: { name, deal_id: budgetId } },
    });
    const section = response.data;

    return {
      content: [
        {
          type: 'text',
          text:
            `Section created! Section ID: ${section.id} (${section.attributes.name}) on budget ${budgetId}\n\n` +
            `Next step: put services into it with create_budget_service or update_budget_service (section_id: ${section.id}).`,
        },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const createBudgetSectionDefinition = {
  name: 'create_budget_section',
  description:
    "Create a section in a budget. A section groups the budget's services, e.g. by project " +
    'phase. Put services into it with the section_id parameter of create_budget_service or ' +
    'update_budget_service.',
  inputSchema: {
    type: 'object',
    required: ['budget_id', 'name'],
    properties: {
      budget_id: { type: 'string', description: 'Budget ID to create the section in' },
      name: { type: 'string', description: 'Section name' },
    },
  },
  annotations: {
    title: 'Create budget section',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

// ---------------------------------------------------------------------------
// Tool: update_budget_section
// ---------------------------------------------------------------------------

const updateBudgetSectionSchema = z.object({
  section_id: z.string().min(1, 'Section ID is required'),
  name: z.string().trim().min(1, 'Name is required'),
});

export async function updateBudgetSectionTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const { section_id, name } = updateBudgetSectionSchema.parse(args);
    const sectionId = String(toNumericId(section_id, 'section_id'));

    const response = await client.updateSection(sectionId, {
      data: { type: 'sections', id: sectionId, attributes: { name } },
    });

    // The name Productive stored, not the one requested: if the rename did not
    // take, the old name shows here.
    return {
      content: [
        {
          type: 'text',
          text: `Section ${sectionId} renamed to "${response.data.attributes.name}".`,
        },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const updateBudgetSectionDefinition = {
  name: 'update_budget_section',
  description: 'Rename a budget section. Use list_budget_sections to find section IDs.',
  inputSchema: {
    type: 'object',
    required: ['section_id', 'name'],
    properties: {
      section_id: { type: 'string', description: 'Section ID' },
      name: { type: 'string', description: 'New section name' },
    },
  },
  annotations: {
    title: 'Update budget section',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

// ---------------------------------------------------------------------------
// Tool: delete_budget_section
// ---------------------------------------------------------------------------

const deleteBudgetSectionSchema = z.object({
  section_id: z.string().min(1, 'Section ID is required'),
});

/**
 * Refuse unless the section is provably empty. What Productive does with the
 * services of a deleted section is not documented, so "probably empty" is not
 * enough. Services are looked up by section rather than by budget, which also
 * catches a service of another budget sitting in this section; if Productive
 * ignored the section filter, more services come back rather than fewer, and
 * the check only gets stricter.
 */
async function assertSectionEmpty(
  client: ProductiveAPIClient,
  section: ProductiveSection,
  sectionId: string,
): Promise<void> {
  const services = await sweepServices((page, projectless) =>
    client.listServicesInSection(sectionId, page, projectless),
  );
  const unknown = services.rows.filter((s) => sectionOf(s).kind === 'unknown');
  const reasons = [...services.gaps];
  if (unknown.length > 0) {
    reasons.push(`Productive did not report the section of ${countLabel(unknown.length)}`);
  }
  if (reasons.length > 0) {
    throw new McpError(
      ErrorCode.InternalError,
      `Cannot confirm that section ${sectionId} is empty (${reasons.join('; ')}). Nothing was deleted.`,
    );
  }

  // Rows the filter returned whose own link names no section or another one
  // are not counted: an ignored filter returns exactly such rows. Only a filter
  // and a link that contradict each other could hide a service here.
  const inside = services.rows.filter((s) => isIn(s, sectionId));
  if (inside.length > 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Section ${sectionId} (${nameOf(section) ?? 'unnamed'}) still contains ${countLabel(inside.length)}:\n` +
        `${serviceLines(inside).join('\n')}\n` +
        'Move them to another section with update_budget_service first. Nothing was deleted.',
    );
  }
}

export async function deleteBudgetSectionTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const { section_id } = deleteBudgetSectionSchema.parse(args);
    const sectionId = String(toNumericId(section_id, 'section_id'));

    const section = (await client.getSection(sectionId)).data;
    if (section.type !== 'sections' || String(section.id) !== sectionId) {
      throw new McpError(
        ErrorCode.InternalError,
        `Productive did not return section ${sectionId}. Nothing was deleted.`,
      );
    }
    await assertSectionEmpty(client, section, sectionId);
    await client.deleteSection(sectionId);

    const budget = readLinkage(section.relationships?.deal);
    const from = budget.kind === 'linked' ? ` from budget ${budget.id}` : '';
    return {
      content: [
        {
          type: 'text',
          text: `Section ${sectionId} (${nameOf(section) ?? 'unnamed'}) deleted${from}.`,
        },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const deleteBudgetSectionDefinition = {
  name: 'delete_budget_section',
  description:
    'Delete a budget section. Only an empty section can be deleted: while any service is still ' +
    'in it, the call is refused and names the services; move them to another section with ' +
    'update_budget_service first. It is also refused ' +
    "when Productive's answer does not prove the section empty. Cannot be undone.",
  inputSchema: {
    type: 'object',
    required: ['section_id'],
    properties: {
      section_id: { type: 'string', description: 'Section ID' },
    },
  },
  annotations: {
    title: 'Delete budget section',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
};
