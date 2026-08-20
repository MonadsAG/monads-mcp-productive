import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// ---- Schemas ----

const listPagesSchema = z.object({
  project_id: z.string().optional(),
  sort: z.enum(['created_at', 'title', 'edited_at', 'updated_at']).optional(),
  limit: z.coerce.number().min(1).max(200).default(30).optional(),
});

const getPageSchema = z.object({
  page_id: z.string().min(1, 'Page ID is required'),
});

const createPageSchema = z.object({
  project_id: z.string().min(1, 'Project ID is required'),
  title: z.string().min(1, 'Title is required'),
  markdown: z.string().optional(),
  parent_page_id: z.coerce
    .number()
    .optional()
    .describe('ID of parent page (must also set root_page_id)'),
  root_page_id: z
    .number()
    .optional()
    .describe('ID of root page in the hierarchy (must also set parent_page_id)'),
});

const updatePageSchema = z.object({
  page_id: z.string().min(1, 'Page ID is required'),
  title: z.string().optional(),
  markdown: z.string().optional(),
  append: z.boolean().optional().default(false),
});

const deletePageSchema = z.object({
  page_id: z.string().min(1, 'Page ID is required'),
});

const movePageSchema = z.object({
  page_id: z.string().min(1, 'Page ID is required'),
  target_doc_id: z.string().min(1, 'Target document ID is required'),
});

const copyPageSchema = z.object({
  template_id: z.string().min(1, 'Template ID (page to copy) is required'),
  project_id: z
    .string()
    .optional()
    .describe('Project ID to copy the page into (defaults to same project)'),
});

// ---- Handlers ----

export async function listPagesTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = listPagesSchema.parse(args || {});

    const response = await client.listPages({
      project_id: params.project_id,
      sort: params.sort,
      limit: params.limit,
    });

    if (!response || !response.data || response.data.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No pages found matching the criteria.',
          },
        ],
      };
    }

    const pagesText = response.data
      .filter((page) => page && page.attributes)
      .map((page) => {
        const projectId = page.relationships?.project?.data?.id;
        return `• ${page.attributes.title} (ID: ${page.id})
  ${projectId ? `Project ID: ${projectId}` : ''}
  ${page.attributes.edited_at ? `Edited at: ${page.attributes.edited_at}` : ''}
  ${page.attributes.version_number != null ? `Version: ${page.attributes.version_number}` : ''}`;
      })
      .join('\n\n');

    const summary = `Found ${response.data.length} page${response.data.length !== 1 ? 's' : ''}${response.meta?.total_count ? ` (showing ${response.data.length} of ${response.meta.total_count})` : ''}:\n\n${pagesText}`;

    return {
      content: [
        {
          type: 'text',
          text: summary,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export async function getPageTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = getPageSchema.parse(args);
    const response = await client.getPage(params.page_id);
    const page = response.data;

    const creatorId = page.relationships?.creator?.data?.id;
    const creatorResource =
      creatorId && response.included
        ? response.included.find(
            (item: { type: string; id: string }) => item.type === 'people' && item.id === creatorId,
          )
        : undefined;
    const creatorName = creatorResource
      ? `${creatorResource.attributes.first_name || ''} ${creatorResource.attributes.last_name || ''}`.trim()
      : undefined;

    const projectId = page.relationships?.project?.data?.id;
    const projectResource =
      projectId && response.included
        ? response.included.find(
            (item: { type: string; id: string }) =>
              item.type === 'projects' && item.id === projectId,
          )
        : undefined;
    const projectName = projectResource?.attributes?.name;

    let text = `Page: ${page.attributes.title} (ID: ${page.id})\n`;
    if (projectName) text += `Project: ${projectName} (ID: ${projectId})\n`;
    else if (projectId) text += `Project ID: ${projectId}\n`;
    if (creatorName) text += `Creator: ${creatorName}\n`;
    if (page.attributes.public_access != null)
      text += `Public access: ${page.attributes.public_access}\n`;
    if (page.attributes.version_number != null)
      text += `Version: ${page.attributes.version_number}\n`;
    if (page.attributes.parent_page_id != null)
      text += `Parent page ID: ${page.attributes.parent_page_id}\n`;
    if (page.attributes.root_page_id != null)
      text += `Root page ID: ${page.attributes.root_page_id}\n`;
    text += `Created at: ${page.attributes.created_at}\n`;
    text += `Updated at: ${page.attributes.updated_at}\n`;
    if (page.attributes.edited_at) text += `Edited at: ${page.attributes.edited_at}\n`;
    if (page.attributes.last_activity_at)
      text += `Last activity at: ${page.attributes.last_activity_at}\n`;
    text += `\nBody:\n${page.attributes.body || '(empty)'}`;

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export async function createPageTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = createPageSchema.parse(args);

    // project_id may only be set on root pages -- sending it together with
    // parent_page_id/root_page_id is rejected as `page_project_root_page_only`.
    const nested = params.parent_page_id != null || params.root_page_id != null;

    const response = await client.createPage({
      data: {
        type: 'pages',
        attributes: {
          title: params.title,
          markdown: params.markdown,
          project_id: nested ? undefined : Number(params.project_id),
          parent_page_id: params.parent_page_id,
          root_page_id: params.root_page_id,
        },
      },
    });

    const page = response.data;

    let text = `Page created successfully!\n`;
    text += `Title: ${page.attributes.title}\n`;
    text += `Page ID: ${page.id}\n`;
    text += `Project ID: ${params.project_id}\n`;
    if (params.parent_page_id != null) text += `Parent page ID: ${params.parent_page_id}\n`;
    text += `Created at: ${page.attributes.created_at}`;

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export async function updatePageTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = updatePageSchema.parse(args);

    if (params.title === undefined && params.markdown === undefined) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Provide title, markdown, or both -- there is nothing to update otherwise',
      );
    }

    // Title and body live on different routes: the title goes through the plain
    // PATCH, the body through a markdown proxy that takes a flat payload.
    let page = null;
    if (params.title !== undefined) {
      const response = await client.updatePage(params.page_id, {
        data: { type: 'pages', id: params.page_id, attributes: { title: params.title } },
      });
      page = response.data;
    }
    if (params.markdown !== undefined) {
      const response = params.append
        ? await client.appendPageBody(params.page_id, params.markdown)
        : await client.replacePageBody(params.page_id, params.markdown);
      page = response.data;
    }

    let text = `Page updated successfully!\n`;
    text += `Title: ${page?.attributes.title}\n`;
    text += `Page ID: ${page?.id ?? params.page_id}\n`;
    if (params.markdown !== undefined) {
      text += `Body ${params.append ? 'appended to' : 'replaced'}\n`;
    }
    text += `Updated at: ${page?.attributes.updated_at}`;

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export async function deletePageTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = deletePageSchema.parse(args);
    await client.deletePage(params.page_id);

    return {
      content: [
        {
          type: 'text',
          text: `Page ${params.page_id} deleted successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export async function movePageTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = movePageSchema.parse(args);
    await client.movePage(params.page_id, params.target_doc_id);

    return {
      content: [
        {
          type: 'text',
          text: `Page ${params.page_id} moved under document ${params.target_doc_id} successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export async function copyPageTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = copyPageSchema.parse(args);
    const response = await client.copyPage(params.template_id, params.project_id);
    const page = response.data;

    let text = `Page copied successfully!\n`;
    text += `Title: ${page.attributes.title}\n`;
    text += `New page ID: ${page.id}\n`;
    text += `Created at: ${page.attributes.created_at}`;

    return {
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

// ---- Definitions ----

export const listPagesDefinition = {
  name: 'list_pages',
  description:
    'List document pages, each showing title, ID, project, last-edited time, and version number (but not body content). Filter by project_id and sort by created_at, title, edited_at, or updated_at. Use this to locate a page ID, then call get_page for the full body. Returns up to `limit` pages (default 30).',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Filter to pages belonging to a single project',
      },
      sort: {
        type: 'string',
        enum: ['created_at', 'title', 'edited_at', 'updated_at'],
        description: 'Field to sort the returned pages by',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of pages to return (1-200, default 30)',
      },
    },
    required: [],
  },
};

export const getPageDefinition = {
  name: 'get_page',
  description:
    'Fetch one document page by ID including its full body, creator, project, hierarchy (parent and root page IDs), version, and timestamps. The body is returned as a Productive Document Format document -- a JSON structure ({"type":"doc","content":[...]}), not HTML or plain text. Use this after list_pages, which returns page metadata but omits the body.',
  inputSchema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'ID of the page to retrieve (required)',
      },
    },
    required: ['page_id'],
  },
};

export const createPageDefinition = {
  name: 'create_page',
  description:
    'Create a new document page inside a project. Content is written as Markdown. Optionally nest it under an existing page by supplying parent_page_id together with root_page_id -- for a nested page the project is inherited from the parent, so project_id is ignored. After creating, use move_page to re-parent it or copy_page to duplicate it elsewhere.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'ID of the project to create the page in (required)',
      },
      title: {
        type: 'string',
        description: 'Title of the page (required)',
      },
      markdown: {
        type: 'string',
        description:
          'Body content of the page as Markdown (optional). Headings, lists, tables, checklists, code blocks and links are supported.',
      },
      parent_page_id: {
        type: 'number',
        description:
          'ID of the parent page to nest this page under. Must be set together with root_page_id.',
      },
      root_page_id: {
        type: 'number',
        description:
          'ID of the root (top-level) page in the hierarchy. Must be set together with parent_page_id. For direct children of root, set both to the root page ID.',
      },
    },
    required: ['project_id', 'title'],
  },
};

export const updatePageDefinition = {
  name: 'update_page',
  description:
    "Update a document page's title and/or body. Body content is written as Markdown and replaces the previous content by default; set append: true to add to the end instead of rewriting the page. Omit a field to leave it unchanged. To relocate the page in the hierarchy instead of editing content, use move_page.",
  inputSchema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'ID of the page to update (required)',
      },
      title: {
        type: 'string',
        description: 'New title for the page (omit to leave the title unchanged)',
      },
      markdown: {
        type: 'string',
        description:
          'New body content as Markdown. Replaces the current body unless append is true. Omit to leave the body unchanged.',
      },
      append: {
        type: 'boolean',
        description:
          'Append the markdown to the end of the page instead of replacing the body. Defaults to false.',
      },
    },
    required: ['page_id'],
  },
};

export const deletePageDefinition = {
  name: 'delete_page',
  description:
    'Delete a document page by ID. If you instead want to relocate the page under a different parent, use move_page; to duplicate it, use copy_page.',
  inputSchema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'ID of the page to delete (required)',
      },
    },
    required: ['page_id'],
  },
};

export const movePageDefinition = {
  name: 'move_page',
  description:
    'Re-parent a document page, nesting it under a different page in the hierarchy. This changes where the page lives, not its content — use update_page to edit the title or body. To place a page under a new parent, call this again with a different target_doc_id.',
  inputSchema: {
    type: 'object',
    properties: {
      page_id: {
        type: 'string',
        description: 'ID of the page to move (required)',
      },
      target_doc_id: {
        type: 'string',
        description: 'ID of the page to move this page under, i.e. its new parent (required)',
      },
    },
    required: ['page_id', 'target_doc_id'],
  },
};

export const copyPageDefinition = {
  name: 'copy_page',
  description:
    "Duplicate an existing page (used as the template) into the same project, or into a different one via project_id — useful for spinning up a new page from a boilerplate. Returns the new page's ID; use move_page afterward to position the copy in the hierarchy.",
  inputSchema: {
    type: 'object',
    properties: {
      template_id: {
        type: 'string',
        description: 'ID of the page to copy from, used as the template (required)',
      },
      project_id: {
        type: 'string',
        description:
          "Project to create the copy in (optional; defaults to the template page's project)",
      },
    },
    required: ['template_id'],
  },
};
