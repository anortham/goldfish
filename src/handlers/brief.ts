/**
 * Brief tool handler
 */

import {
  saveBrief,
  getBrief,
  getActiveBrief,
  listBriefs,
  setActiveBrief,
  updateBrief
} from '../briefs.js';
import { getFishEmoji } from '../emoji.js';
import { resolveWorkspace } from '../workspace.js';
import type { Brief, BriefArgs } from '../types.js';

function formatBriefFull(brief: Brief): string {
  const lines: string[] = [];
  lines.push(`# ${brief.title}`);
  lines.push(`ID: ${brief.id}`);
  lines.push(`Status: ${brief.status}`);
  lines.push(`Created: ${brief.created}`);
  lines.push(`Updated: ${brief.updated}`);
  if (brief.tags && brief.tags.length > 0) {
    lines.push(`Tags: ${brief.tags.join(', ')}`);
  }
  lines.push('');
  lines.push(brief.content);
  return lines.join('\n');
}

function formatBriefList(briefs: Brief[]): string {
  const lines: string[] = [];
  for (const brief of briefs) {
    lines.push(`- **${brief.id}**: ${brief.title} (${brief.status}) - updated ${brief.updated}`);
  }
  return lines.join('\n');
}

function textResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }]
  };
}

async function resolveId(args: BriefArgs, workspace: string): Promise<string | null> {
  const id = args.id || args.briefId || args.brief_id;
  if (id) return id;

  const active = await getActiveBrief(workspace);
  return active?.id ?? null;
}

export async function handleBrief(args: BriefArgs) {
  const { action, workspace: wsArg } = args;
  const workspace = resolveWorkspace(wsArg);
  const fish = getFishEmoji();

  switch (action) {
    case 'save': {
      const { title, content, activate, id, tags, status } = args;
      const briefId = id || args.briefId || args.brief_id;
      const shouldActivate = activate !== false;
      if (!title || !content) {
        throw new Error('Title and content are required for save action');
      }

      const brief = await saveBrief({
        title,
        content,
        workspace,
        activate: shouldActivate,
        ...(status && { status: status as Brief['status'] }),
        ...(briefId && { id: briefId }),
        ...(tags && { tags })
      });

      const statusText = shouldActivate && brief.status === 'active' ? ' (active)' : '';
      return textResponse(`${fish} Brief saved: ${brief.id}${statusText}`);
    }

    case 'get': {
      const id = await resolveId(args, workspace);
      if (!id) throw new Error('No active brief found. Provide a brief ID or activate a brief first.');

      const brief = await getBrief(workspace, id);
      if (!brief) throw new Error(`Brief '${id}' not found`);

      return textResponse(formatBriefFull(brief));
    }

    case 'list': {
      const { status } = args;
      const briefs = await listBriefs(workspace);

      const filtered = status
        ? briefs.filter(b => b.status === status)
        : briefs;

      const count = filtered.length;

      if (count === 0) {
        return textResponse(`${fish} No briefs found`);
      }

      const summary = `${fish} Found ${count} brief${count === 1 ? '' : 's'}`;
      return textResponse(`${summary}\n\n${formatBriefList(filtered)}`);
    }

    case 'activate': {
      const id = args.id || args.briefId || args.brief_id;
      if (!id) throw new Error('Brief ID is required for activate action');

      await setActiveBrief(workspace, id);
      return textResponse(`${fish} Brief activated: ${id}`);
    }

    case 'update': {
      const id = await resolveId(args, workspace);
      if (!id) throw new Error('No active brief found. Provide a brief ID or activate a brief first.');

      let { updates } = args;
      if (!updates) {
        const topLevel: Record<string, any> = {};
        if (args.title) topLevel.title = args.title;
        if (args.content) topLevel.content = args.content;
        if (args.status) topLevel.status = args.status;
        if (args.tags) topLevel.tags = args.tags;

        if (Object.keys(topLevel).length > 0) {
          updates = topLevel;
        }
      }

      if (!updates) throw new Error('Updates are required');

      await updateBrief(workspace, id, updates);
      return textResponse(`${fish} Brief updated: ${id}`);
    }

    case 'complete': {
      const id = await resolveId(args, workspace);
      if (!id) throw new Error('No active brief found. Provide a brief ID or activate a brief first.');

      await updateBrief(workspace, id, { status: 'completed' });
      return textResponse(`${fish} Brief completed: ${id}`);
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
