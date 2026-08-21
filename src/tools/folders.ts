import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { toMcpError } from '../utils/errors.js';

// Productive's UI calls this resource a "folder"; the API resource concept is
// a "board" (task and task-list relationships reference it as `board`/
// `board_id`). This file is the ONLY tool set for it -- there is no separate
// "board" tool. See src/api/client.ts's Board-named methods for the client
// layer this file talks to.

// ---- List Folders ----

const ListFoldersSchema = z.object({
  project_id: z
    .string()
    .optional()
    .describe('Filter to Folders/Boards belonging to this project ID'),
  status: z.coerce.number().optional().describe('Filter by status (1=active, 2=archived)'),
  limit: z.coerce
    .number()
    .optional()
    .default(30)
    .describe('Max number of Folders/Boards to return (default 30, max 200)'),
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
    throw toMcpError(error);
  }
}

export const listFoldersTool = {
  name: 'list_folders',
  description:
    'List Folders in a project. A Folder is Productive UI name for a Board resource -- it is NOT a Task List. Folders sit directly inside a project (Customers -> Projects -> Folders/Boards -> Task Lists -> Tasks) and contain the task lists that hold tasks. The API models this resource as a "board" (see board_id on tasks/task lists); there is no separate "board" tool. Returns up to `limit` folders (default 30, max 200); pass project_id to scope to one project.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Filter to Folders/Boards belonging to this project ID',
      },
      status: {
        type: 'number',
        description: 'Filter by status (1=active, 2=archived)',
      },
      limit: {
        type: 'number',
        description: 'Max number of Folders/Boards to return (default 30, max 200)',
        default: 30,
      },
    },
  },
  annotations: { title: 'List folders', readOnlyHint: true, openWorldHint: true },
};

// ---- Get Folder ----

const GetFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the Folder/Board to retrieve'),
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
    throw toMcpError(error);
  }
}

export const getFolderTool = {
  name: 'get_folder',
  description:
    'Get full details of one Folder by ID -- name, position, archived/hidden state, timestamps, and its parent Project ID. This is a Folder, i.e. a Board resource inside a project -- NOT a Task List (use get_task_list for those). The API models this resource as a "board".',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the Folder/Board to retrieve',
      },
    },
    required: ['folder_id'],
  },
  annotations: { title: 'Get folder', readOnlyHint: true, openWorldHint: true },
};

// ---- Create Folder ----

const CreateFolderSchema = z.object({
  project_id: z
    .string()
    .describe(
      'The ID of the project to create the Folder/Board in (a Folder always lives inside a project)',
    ),
  name: z.string().describe('Name for the new Folder/Board'),
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
    throw toMcpError(error);
  }
}

export const createFolderTool = {
  name: 'create_folder',
  description:
    'Create a new Folder (a Board resource) inside a project. This is a Folder/Board, NOT a Task List. It is the top drill-down step when setting up new work: create_folder -> create_task_list -> create_task. A Folder must belong to a project.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description:
          'The ID of the project to create the Folder/Board in (a Folder always lives inside a project)',
      },
      name: {
        type: 'string',
        description: 'Name for the new Folder/Board',
      },
    },
    required: ['project_id', 'name'],
  },
  annotations: {
    title: 'Create folder',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

// ---- Update Folder ----

const UpdateFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the Folder/Board to update'),
  name: z.string().optional().describe('New name for the Folder/Board'),
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
    throw toMcpError(error);
  }
}

export const updateFolderTool = {
  name: 'update_folder',
  description:
    'Rename an existing Folder (Board) by ID. This is a Folder/Board, NOT a Task List -- use update_task_list to rename a task list.',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the Folder/Board to update',
      },
      name: {
        type: 'string',
        description: 'New name for the Folder/Board',
      },
    },
    required: ['folder_id'],
  },
  annotations: {
    title: 'Update folder',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

// ---- Archive Folder ----

const ArchiveFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the Folder/Board to archive'),
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
    throw toMcpError(error);
  }
}

export const archiveFolderTool = {
  name: 'archive_folder',
  description:
    'Archive a Folder (Board) by ID: hides it and its task lists/tasks from active project views while preserving all data, so it can be brought back later with restore_folder. This is a Folder/Board, NOT a Task List -- use archive_task_list to archive a single task list.',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the Folder/Board to archive',
      },
    },
    required: ['folder_id'],
  },
  annotations: {
    title: 'Archive folder',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
};

// ---- Restore Folder ----

const RestoreFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the archived Folder/Board to restore'),
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
    throw toMcpError(error);
  }
}

export const restoreFolderTool = {
  name: 'restore_folder',
  description:
    'Restore a previously archived Folder (Board) by ID, bringing it and its contents back into active project views (reverses archive_folder). This is a Folder/Board, NOT a Task List -- use restore_task_list for those.',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the archived Folder/Board to restore',
      },
    },
    required: ['folder_id'],
  },
  annotations: {
    title: 'Restore folder',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

// ---- Copy Folder ----

const CopyFolderSchema = z.object({
  name: z.string().describe('Name for the new (copied) Folder/Board'),
  template_id: z
    .string()
    .describe('The ID of the source Folder/Board to copy from (used as a template)'),
  project_id: z.string().describe('The ID of the project the new Folder/Board will be created in'),
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
    throw toMcpError(error);
  }
}

export const copyFolderTool = {
  name: 'copy_folder',
  description:
    'Duplicate an existing Folder (Board), used as a template, into a project -- creating a new Folder with the given name. This is a Folder/Board, NOT a Task List -- use copy_task_list to copy a single task list.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the new (copied) Folder/Board',
      },
      template_id: {
        type: 'string',
        description: 'The ID of the source Folder/Board to copy from (used as a template)',
      },
      project_id: {
        type: 'string',
        description: 'The ID of the project the new Folder/Board will be created in',
      },
    },
    required: ['name', 'template_id', 'project_id'],
  },
  annotations: {
    title: 'Copy folder',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

// ---- Move Folder ----

const MoveFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the Folder/Board to move'),
  project_id: z
    .string()
    .describe('The ID of the destination project to move the Folder/Board into'),
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
    throw toMcpError(error);
  }
}

export const moveFolderTool = {
  name: 'move_folder',
  description:
    'Move a Folder (Board), together with its task lists and tasks, to a different project. This is a Folder/Board, NOT a Task List -- use move_task_list to move a task list between folders/boards.',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the Folder/Board to move',
      },
      project_id: {
        type: 'string',
        description: 'The ID of the destination project to move the Folder/Board into',
      },
    },
    required: ['folder_id', 'project_id'],
  },
  annotations: {
    title: 'Move folder',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

// ---- Reposition Folder ----

const RepositionFolderSchema = z.object({
  folder_id: z.string().describe('The ID of the Folder/Board to reposition'),
  move_before_id: z
    .string()
    .describe('The ID of the Folder/Board to place this one immediately before'),
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
    throw toMcpError(error);
  }
}

export const repositionFolderTool = {
  name: 'reposition_folder',
  description:
    'Reorder a Folder (Board) within its project by placing it immediately before another folder (changes display order only). This is a Folder/Board, NOT a Task List -- use reposition_task_list for those.',
  inputSchema: {
    type: 'object',
    properties: {
      folder_id: {
        type: 'string',
        description: 'The ID of the Folder/Board to reposition',
      },
      move_before_id: {
        type: 'string',
        description: 'The ID of the Folder/Board to place this one immediately before',
      },
    },
    required: ['folder_id', 'move_before_id'],
  },
  annotations: {
    title: 'Reposition folder',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};
