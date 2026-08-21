import { z } from 'zod';
import { ProductiveAPIClient } from '../api/client.js';
import { formatChangeset } from './changeset.js';
import { toMcpError } from '../utils/errors.js';

const RecentUpdatesRequestSchema = z.object({
  project_id: z.string().optional(),
  days_back: z.coerce.number().min(1).max(30).default(7),
  limit: z.coerce.number().min(1).max(200).optional(),
});

export async function getRecentUpdates(
  client: ProductiveAPIClient,
  args: unknown,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const params = RecentUpdatesRequestSchema.parse(args);

    // Calculate date range
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - params.days_back);
    const after = afterDate.toISOString();

    // Get activities for the specified timeframe
    const response = await client.listActivities({
      project_id: params.project_id,
      after,
      event: 'update', // Focus on updates only
      limit: params.limit || 100,
    });

    const activities = response.data;

    // Group activities by item type and summarize
    const summary: Record<string, { count: number; items: Set<string> }> = {};
    const detailedUpdates: Array<{
      date: string;
      type: string;
      id: string;
      changes: string[];
      creator?: string;
    }> = [];

    for (const activity of activities) {
      const itemType = activity.attributes.item_type;
      const itemId = activity.attributes.item_id;

      if (!summary[itemType]) {
        summary[itemType] = { count: 0, items: new Set() };
      }

      summary[itemType].count++;
      summary[itemType].items.add(itemId);

      detailedUpdates.push({
        date: new Date(activity.attributes.created_at).toLocaleString(),
        type: itemType,
        id: itemId,
        changes: formatChangeset(activity.attributes.changeset),
        creator: activity.relationships?.creator?.data?.id,
      });
    }

    let output = `## Recent Updates Summary (Last ${params.days_back} Days)\n\n`;

    if (params.project_id) {
      output += `**Project ID:** ${params.project_id}\n\n`;
    }

    if (Object.keys(summary).length === 0) {
      output += 'No updates found in the specified timeframe.';
    } else {
      output += '### Summary by Item Type:\n';
      for (const [itemType, data] of Object.entries(summary)) {
        output += `• **${itemType}**: ${data.count} updates across ${data.items.size} items\n`;
      }

      output += '\n### Detailed Updates:\n\n';

      // Sort by date (most recent first)
      detailedUpdates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      for (const update of detailedUpdates) {
        output += `**${update.date}** - ${update.type} (ID: ${update.id})\n`;

        if (update.creator) {
          output += `  👤 Updated by: Person ID ${update.creator}\n`;
        }

        if (update.changes.length > 0) {
          output += '  📝 Changes:\n';
          for (const change of update.changes) {
            output += `    • ${change}\n`;
          }
        }

        output += '\n';
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  } catch (error) {
    throw toMcpError(error);
  }
}

export const getRecentUpdatesTool = {
  name: 'get_recent_updates',
  description:
    'Summarize recent update events (edits only — not creates or deletes) from the last N days (default 7, max 30), grouped by item type with counts plus a chronological detail list. Optionally scope to one project_id. Built on the same activity feed as list_activities; reach for list_activities when you need the raw, fully filterable event stream (including creates/deletes or a custom date range). Creators are shown as raw person IDs, not resolved names.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Optional project ID to filter updates for a specific project',
      },
      days_back: {
        type: 'number',
        description: 'Number of days to look back for recent updates (1-30, default: 7)',
        minimum: 1,
        maximum: 30,
        default: 7,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of updates to analyze (1-200, default: 100)',
        minimum: 1,
        maximum: 200,
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
};
