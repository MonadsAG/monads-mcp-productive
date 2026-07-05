import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ProductiveIncludedResource } from '../api/types.js';

type ToolResult = { content: Array<{ type: string; text: string }> };

function resolvePersonName(
  personId: string | undefined,
  included?: ProductiveIncludedResource[],
): string | undefined {
  if (!personId || !included) return undefined;
  const person = included.find((item) => item.type === 'people' && item.id === personId);
  if (!person) return undefined;
  const first = person.attributes.first_name || '';
  const last = person.attributes.last_name || '';
  return `${first} ${last}`.trim() || undefined;
}

function truncateBody(body: string, maxLength = 200): string {
  if (body.length <= maxLength) return body;
  return body.substring(0, maxLength) + '...';
}

// ---- Add Task Comment ----

const addTaskCommentSchema = z.object({
  task_id: z.string().min(1, 'Task ID is required'),
  comment: z.string().min(1, 'Comment text is required'),
});

export async function addTaskCommentTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = addTaskCommentSchema.parse(args);

    const commentData = {
      data: {
        type: 'comments' as const,
        attributes: {
          body: params.comment,
        },
        relationships: {
          task: {
            data: {
              id: params.task_id,
              type: 'tasks' as const,
            },
          },
        },
      },
    };

    const response = await client.createComment(commentData);

    let text = `Comment added successfully!\n`;
    text += `Task ID: ${params.task_id}\n`;
    text += `Comment: ${response.data.attributes.body}\n`;
    text += `Comment ID: ${response.data.id}`;
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
        `Invalid parameters: ${error.errors.map((e) => e.message).join(', ')}`,
      );
    }

    throw new McpError(
      ErrorCode.InternalError,
      error instanceof Error ? error.message : 'Unknown error occurred',
    );
  }
}

export const addTaskCommentDefinition = {
  name: 'add_task_comment',
  description:
    "Post a new comment onto a task's activity feed. Use this to leave a fresh note or to follow up on something surfaced by list_comments. To change an existing comment instead, use update_comment; to acknowledge one without writing text, use add_comment_reaction.",
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'ID of the task to add the comment to (required)',
      },
      comment: {
        type: 'string',
        description:
          'Comment content (required). Plain text or HTML — supported tags include <div>, <p>, <strong>, <em>, <ul>, <li>, and <a href="">.',
      },
    },
    required: ['task_id', 'comment'],
  },
};

// ---- List Comments ----

const listCommentsSchema = z.object({
  task_id: z.string().optional(),
  project_id: z.string().optional(),
  limit: z.coerce.number().optional(),
});

export async function listCommentsTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = listCommentsSchema.parse(args);

    const response = await client.listComments({
      task_id: params.task_id,
      project_id: params.project_id,
      limit: params.limit,
    });

    if (!response.data || response.data.length === 0) {
      return {
        content: [{ type: 'text', text: 'No comments found.' }],
      };
    }

    const commentsText = response.data
      .map((comment) => {
        const creatorId = comment.relationships?.creator?.data?.id;
        const creatorName =
          resolvePersonName(creatorId, response.included) || `Person ${creatorId || 'unknown'}`;
        const pinned = comment.attributes.pinned_at ? ' [PINNED]' : '';
        const body = truncateBody(comment.attributes.body);

        return `- Comment ID: ${comment.id}${pinned}\n  By: ${creatorName}\n  Date: ${comment.attributes.created_at}\n  Body: ${body}`;
      })
      .join('\n\n');

    return {
      content: [{ type: 'text', text: `Comments (${response.data.length}):\n\n${commentsText}` }],
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

export const listCommentsDefinition = {
  name: 'list_comments',
  description:
    "List comments, each rendered with its body truncated to ~200 characters and a [PINNED] marker where applicable. Filter by task_id to read a single task's thread or by project_id to see a project's comments; omit both to list broadly. Use this to survey a thread, then call get_comment for one comment's full untruncated body and metadata. Returns up to `limit` comments.",
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: "Filter to comments on a single task (the task's comment thread)",
      },
      project_id: {
        type: 'string',
        description: 'Filter to comments within a project',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of comments to return',
      },
    },
  },
};

// ---- Get Comment ----

const getCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
});

export async function getCommentTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = getCommentSchema.parse(args);

    const response = await client.getComment(params.comment_id);
    const comment = response.data;
    const attrs = comment.attributes;

    const creatorId = comment.relationships?.creator?.data?.id;
    const included = (response as unknown as { included?: ProductiveIncludedResource[] }).included;
    const creatorName =
      resolvePersonName(creatorId, included) || `Person ${creatorId || 'unknown'}`;

    let text = `Comment ID: ${comment.id}\n`;
    text += `Body: ${attrs.body}\n`;
    text += `Commentable Type: ${attrs.commentable_type}\n`;
    text += `Creator: ${creatorName}\n`;
    text += `Created: ${attrs.created_at}\n`;
    text += `Updated: ${attrs.updated_at}\n`;
    if (attrs.edited_at) text += `Edited: ${attrs.edited_at}\n`;
    if (attrs.deleted_at) text += `Deleted: ${attrs.deleted_at}\n`;
    text += `Draft: ${attrs.draft ?? false}\n`;
    text += `Hidden: ${attrs.hidden ?? false}\n`;
    text += `Pinned: ${attrs.pinned_at ? `Yes (${attrs.pinned_at})` : 'No'}\n`;
    if (attrs.reactions) text += `Reactions: ${JSON.stringify(attrs.reactions)}\n`;
    if (attrs.version_number !== undefined) text += `Version: ${attrs.version_number}\n`;

    return {
      content: [{ type: 'text', text }],
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

export const getCommentDefinition = {
  name: 'get_comment',
  description:
    "Fetch one comment by ID with its complete untruncated body plus metadata that list_comments omits: creator, created/updated/edited/deleted timestamps, draft and hidden flags, pinned state, reactions, and version number. Use this when list_comments' 200-character preview isn't enough.",
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to retrieve (required)',
      },
    },
    required: ['comment_id'],
  },
};

// ---- Update Comment ----

const updateCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
  body: z.string().min(1, 'Comment body is required'),
});

export async function updateCommentTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = updateCommentSchema.parse(args);

    const response = await client.updateComment(params.comment_id, {
      data: {
        type: 'comments',
        id: params.comment_id,
        attributes: {
          body: params.body,
        },
      },
    });

    return {
      content: [
        {
          type: 'text',
          text: `Comment ${params.comment_id} updated successfully.\nNew body: ${response.data.attributes.body}`,
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

export const updateCommentDefinition = {
  name: 'update_comment',
  description:
    'Replace the body of an existing comment. The new body overwrites the old one entirely — there is no append, so include any text you want to keep. To post a new comment instead of editing one, use add_task_comment.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to update (required)',
      },
      body: {
        type: 'string',
        description:
          'The new comment body (required), which fully replaces the existing body. Plain text or HTML.',
      },
    },
    required: ['comment_id', 'body'],
  },
};

// ---- Delete Comment ----

const deleteCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
});

export async function deleteCommentTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = deleteCommentSchema.parse(args);

    await client.deleteComment(params.comment_id);

    return {
      content: [
        {
          type: 'text',
          text: `Comment ${params.comment_id} deleted successfully.`,
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

export const deleteCommentDefinition = {
  name: 'delete_comment',
  description:
    'Delete a comment by ID, removing it from the thread. This removes the comment itself — if you only want to take a pinned comment out of the highlighted area while keeping it, use unpin_comment instead.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to delete (required)',
      },
    },
    required: ['comment_id'],
  },
};

// ---- Pin Comment ----

const pinCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
});

export async function pinCommentTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = pinCommentSchema.parse(args);

    await client.pinComment(params.comment_id);

    return {
      content: [
        {
          type: 'text',
          text: `Comment ${params.comment_id} pinned successfully.`,
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

export const pinCommentDefinition = {
  name: 'pin_comment',
  description:
    "Pin a comment so it is highlighted at the top of its task's comment area; list_comments then shows it with a [PINNED] marker. The inverse action is unpin_comment.",
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to pin (required)',
      },
    },
    required: ['comment_id'],
  },
};

// ---- Unpin Comment ----

const unpinCommentSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
});

export async function unpinCommentTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = unpinCommentSchema.parse(args);

    await client.unpinComment(params.comment_id);

    return {
      content: [
        {
          type: 'text',
          text: `Comment ${params.comment_id} unpinned successfully.`,
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

export const unpinCommentDefinition = {
  name: 'unpin_comment',
  description:
    'Remove the pinned highlight from a comment previously pinned with pin_comment, leaving the comment itself in place in the thread. The inverse action is pin_comment.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to unpin (required)',
      },
    },
    required: ['comment_id'],
  },
};

// ---- Add Comment Reaction ----

const addCommentReactionSchema = z.object({
  comment_id: z.string().min(1, 'Comment ID is required'),
  reaction: z.string().min(1, 'Reaction is required'),
});

export async function addCommentReactionTool(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<ToolResult> {
  try {
    const params = addCommentReactionSchema.parse(args);

    await client.addCommentReaction(params.comment_id, params.reaction);

    return {
      content: [
        {
          type: 'text',
          text: `Reaction "${params.reaction}" added to comment ${params.comment_id} successfully.`,
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

export const addCommentReactionDefinition = {
  name: 'add_comment_reaction',
  description:
    'Attach an emoji-style reaction (e.g. "like", "heart", "thumbsup") to a comment — a lightweight acknowledgement when you want to respond without writing a reply via add_task_comment.',
  inputSchema: {
    type: 'object',
    properties: {
      comment_id: {
        type: 'string',
        description: 'The ID of the comment to react to (required)',
      },
      reaction: {
        type: 'string',
        description: 'The reaction key to add, e.g. "like", "heart", or "thumbsup" (required)',
      },
    },
    required: ['comment_id', 'reaction'],
  },
};
