import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// Productive's UI calls this resource a "folder"; the API resource concept is
// a "board" (task and task-list relationships reference it as `board`/
// `board_id`). This file is the ONLY tool set for it -- there is no separate
// "board" tool. See src/api/client.ts's Board-named methods for the client
// layer this file talks to.

// ---- List Folders ----

const ListFoldersSchema = z.object({
  project_id: z.string().optional().describe('Filter folders by project ID'),
  status: z.coerce.number().optional().describe('Filter by status (1=active, 2=archived)'),
  limit: z.coerce.number().optional().default(30).describe('Number of folders to return (max 200)'),
});

export async function listFolders(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = ListFoldersSchema.parse(args || {});

    const response = await client.listBoards({
      project_id: params.project_id,
      status: params.status,
      limit: params.limit,
    });

    if (!response || !response.data || response.data.length === 0) {
      const filterText = params.project_id ? ` for project ${params.project_id}` : '';
      return {
        content: [
          {
            type: 'text',
            text: `No folders found${filterText}`,
          },
        ],
      };
    }

    const foldersText = response.data
      .filter((folder) => folder && folder.attributes)
      .map((folder) => {
        let text = `Folder: ${folder.attributes.name} (ID: ${folder.id})`;
        if (folder.attributes.position !== undefined) {
          text += `\nPosition: ${folder.attributes.position}`;
        }
        if (folder.attributes.archived_at) {
          text += `\nArchived at: ${folder.attributes.archived_at}`;
        }
        if (folder.relationships?.project?.data?.id) {
          text += `\nProject ID: ${folder.relationships.project.data.id}`;
        }
        return text;
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: foldersText,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while fetching folders');
  }
}

export const listFoldersTool = {
  name: 'list_folders',
  description:
    'Get a list of folders from Productive.io. Note: Productive\'s API models this resource as a "board" (see board_id on tasks/task lists); "folder" is the UI and tool-facing name -- there is no separate "board" tool.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Filter folders by project ID',
      },
      status: {
        type: 'number',
        description: 'Filter by status (1=active, 2=archived)',
      },
      limit: {
        type: 'number',
        description: 'Number of folders to return (max 200)',
        default: 30,
      },
    },
  },
};

// ---- Get Folder ----

const GetFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the folder to retrieve'),
});

export async function getFolder(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = GetFolderSchema.parse(args || {});

    const response = await client.getBoard(params.folder_id);

    const folder = response.data;
    let text = `Folder: ${folder.attributes.name} (ID: ${folder.id})`;
    if (folder.attributes.position !== undefined) {
      text += `\nPosition: ${folder.attributes.position}`;
    }
    if (folder.attributes.archived_at) {
      text += `\nArchived at: ${folder.attributes.archived_at}`;
    }
    if (folder.attributes.hidden !== undefined) {
      text += `\nHidden: ${folder.attributes.hidden}`;
    }
    if (folder.attributes.created_at) {
      text += `\nCreated at: ${folder.attributes.created_at}`;
    }
    if (folder.attributes.updated_at) {
      text += `\nUpdated at: ${folder.attributes.updated_at}`;
    }
    if (folder.relationships?.project?.data?.id) {
      text += `\nProject ID: ${folder.relationships.project.data.id}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: text,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while fetching folder');
  }
}

export const getFolderTool = {
  name: 'get_folder',
  description: 'Get details of a specific folder (Productive board) from Productive.io',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the folder to retrieve',
      },
    },
    required: ['folder_id'],
  },
};

// ---- Create Folder ----

const CreateFolderSchema = z.object({
  project_id: z.string().describe('The ID of the project to create the folder in'),
  name: z.string().describe('Name of the folder'),
});

export async function createFolder(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = CreateFolderSchema.parse(args || {});

    const folderData = {
      data: {
        type: 'folders' as const,
        attributes: {
          name: params.name,
        },
        relationships: {
          project: {
            data: {
              id: params.project_id,
              type: 'projects' as const,
            },
          },
        },
      },
    };

    const response = await client.createBoard(folderData);

    let text = `Folder created successfully!\n`;
    text += `Name: ${response.data.attributes.name} (ID: ${response.data.id})`;
    text += `\nProject ID: ${params.project_id}`;
    if (response.data.attributes.created_at) {
      text += `\nCreated at: ${response.data.attributes.created_at}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: text,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while creating folder');
  }
}

export const createFolderTool = {
  name: 'create_folder',
  description: 'Create a new folder (Productive board) in a Productive.io project',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'The ID of the project to create the folder in',
      },
      name: {
        type: 'string',
        description: 'Name of the folder',
      },
    },
    required: ['project_id', 'name'],
  },
};

// ---- Update Folder ----

const UpdateFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the folder to update'),
  name: z.string().optional().describe('New name for the folder'),
});

export async function updateFolder(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = UpdateFolderSchema.parse(args || {});

    const folderData = {
      data: {
        type: 'folders' as const,
        id: params.folder_id,
        attributes: {
          ...(params.name !== undefined && { name: params.name }),
        },
      },
    };

    const response = await client.updateBoard(params.folder_id, folderData);

    let text = `Folder updated successfully!\n`;
    text += `Name: ${response.data.attributes.name} (ID: ${response.data.id})`;
    if (response.data.attributes.updated_at) {
      text += `\nUpdated at: ${response.data.attributes.updated_at}`;
    }

    return {
      content: [
        {
          type: 'text',
          text: text,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while updating folder');
  }
}

export const updateFolderTool = {
  name: 'update_folder',
  description: 'Update an existing folder (Productive board) in Productive.io',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the folder to update',
      },
      name: {
        type: 'string',
        description: 'New name for the folder',
      },
    },
    required: ['folder_id'],
  },
};

// ---- Archive Folder ----

const ArchiveFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the folder to archive'),
});

export async function archiveFolder(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = ArchiveFolderSchema.parse(args || {});

    await client.archiveBoard(params.folder_id);

    return {
      content: [
        {
          type: 'text',
          text: `Folder ${params.folder_id} archived successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while archiving folder');
  }
}

export const archiveFolderTool = {
  name: 'archive_folder',
  description: 'Archive a folder (Productive board) in Productive.io',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the folder to archive',
      },
    },
    required: ['folder_id'],
  },
};

// ---- Restore Folder ----

const RestoreFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the folder to restore'),
});

export async function restoreFolder(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = RestoreFolderSchema.parse(args || {});

    await client.restoreBoard(params.folder_id);

    return {
      content: [
        {
          type: 'text',
          text: `Folder ${params.folder_id} restored successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while restoring folder');
  }
}

export const restoreFolderTool = {
  name: 'restore_folder',
  description: 'Restore an archived folder (Productive board) in Productive.io',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the folder to restore',
      },
    },
    required: ['folder_id'],
  },
};

// ---- Copy Folder ----

const CopyFolderSchema = z.object({
  name: z.string().describe('Name for the copied folder'),
  template_id: z.string().describe('The ID of the source folder to copy from'),
  project_id: z.string().describe('The ID of the project for the new folder'),
});

export async function copyFolder(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = CopyFolderSchema.parse(args || {});

    const response = await client.copyBoard({
      name: params.name,
      template_id: params.template_id,
      project_id: params.project_id,
    });

    let text = `Folder copied successfully!\n`;
    text += `Name: ${response.data.attributes.name} (ID: ${response.data.id})`;
    text += `\nProject ID: ${params.project_id}`;

    return {
      content: [
        {
          type: 'text',
          text: text,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while copying folder');
  }
}

export const copyFolderTool = {
  name: 'copy_folder',
  description: 'Copy a folder (Productive board) from a template in Productive.io',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the copied folder',
      },
      template_id: {
        type: 'string',
        description: 'The ID of the source folder to copy from',
      },
      project_id: {
        type: 'string',
        description: 'The ID of the project for the new folder',
      },
    },
    required: ['name', 'template_id', 'project_id'],
  },
};

// ---- Move Folder ----

const MoveFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the folder to move'),
  project_id: z.string().describe('The ID of the destination project'),
});

export async function moveFolder(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = MoveFolderSchema.parse(args || {});

    await client.moveBoard(params.folder_id, params.project_id);

    return {
      content: [
        {
          type: 'text',
          text: `Folder ${params.folder_id} moved to project ${params.project_id} successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(ErrorCode.InternalError, 'Unknown error occurred while moving folder');
  }
}

export const moveFolderTool = {
  name: 'move_folder',
  description: 'Move a folder (Productive board) to a different project in Productive.io',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the folder to move',
      },
      project_id: {
        type: 'string',
        description: 'The ID of the destination project',
      },
    },
    required: ['folder_id', 'project_id'],
  },
};

// ---- Reposition Folder ----

const RepositionFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the folder to reposition'),
  move_before_id: z.string().describe('The ID of the folder to move before'),
});

export async function repositionFolder(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = RepositionFolderSchema.parse(args || {});

    await client.repositionBoard(params.folder_id, params.move_before_id);

    return {
      content: [
        {
          type: 'text',
          text: `Folder ${params.folder_id} repositioned before ${params.move_before_id} successfully.`,
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }

    if (error instanceof Error) {
      throw new McpError(ErrorCode.InternalError, `API error: ${error.message}`);
    }

    throw new McpError(
      ErrorCode.InternalError,
      'Unknown error occurred while repositioning folder',
    );
  }
}

export const repositionFolderTool = {
  name: 'reposition_folder',
  description: 'Reposition a folder (Productive board) before another folder in Productive.io',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the folder to reposition',
      },
      move_before_id: {
        type: 'string',
        description: 'The ID of the folder to move before',
      },
    },
    required: ['folder_id', 'move_before_id'],
  },
};
