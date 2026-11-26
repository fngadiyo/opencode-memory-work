import {existsSync} from 'node:fs';
import {tool} from '@opencode-ai/plugin';
import {resolveWorkflowSettings, workAvailable, workRoot} from './config.js';
import {SECTIONS} from './doc.js';
import {createWork, isValidSlug, listWork, loadWork, updateWork} from './store.js';
import {addItems, formatBacklog, readBacklog, removeItem, setItemStatus} from './backlog.js';
import {unignoredDirNotice} from '../util/git.js';

function renderList(settings: ReturnType<typeof resolveWorkflowSettings>, cwd: string): string {
  const entries = listWork(settings, cwd);
  if (entries.length === 0) return `No work folders in ${settings.dir}. Start one with work_start({title, goal}).`;
  const open = entries.filter((e) => e.status !== 'done');
  const lines = entries.map((entry) => {
    const mark = entry.status === 'done' ? '[x]' : entry.status === 'paused' ? '[~]' : '[ ]';
    const goal = entry.goal ? ` — ${entry.goal.slice(0, 100)}` : '';
    const broken = entry.broken ? ' (no README — needs repair)' : '';
    const updated = entry.updated ? ` (${entry.updated})` : '';
    return `${mark} ${entry.slug} — ${entry.title}${updated}${goal}${broken}`;
  });
  return `${open.length} open of ${entries.length} work folder(s) in ${settings.dir}:\n${lines.join('\n')}`;
}

export function createWorkTools(cwd: string) {
  const settings = () => resolveWorkflowSettings(cwd);
  return {
    available: () => workAvailable(settings(), cwd),
    notice: () => {
      const s = settings();
      if (!existsSync(workRoot(s, cwd))) return undefined;
      return unignoredDirNotice(s.dir, cwd);
    },
    tools: {
      work_start: tool({
        description:
          'Create a work folder (.work/<slug>/README.md) for a task that spans more than one session. Use when a task needs more than one sitting. The README is the handoff document. Requires a clear goal.',
        args: {
          title: tool.schema.string().describe('Short human title'),
          goal: tool.schema.string().describe('What must be true when the work is complete'),
          slug: tool.schema.string().optional().describe('Optional folder name; defaults to dated slug from title'),
        },
        async execute(args) {
          const s = settings();
          if (!s.write) return `Writing to ${s.dir} is disabled. Set {"write": true} in workflow.json.`;
          const result = createWork(s, cwd, {title: args.title, goal: args.goal, slug: args.slug?.trim() || undefined});
          if (!result.ok) return `Error: ${result.error}`;
          return `Created work folder ${s.dir}/${result.slug}/README.md\n\nUpdate it as work progresses with work_update({slug, current_state, decisions, remaining_work, ...}).`;
        },
      }),
      work_status: tool({
        description:
          'Read work folder state. With no args, lists folders. With a slug, returns the full README for resuming a task.',
        args: {
          slug: tool.schema.string().optional().describe('Work folder name. Omit to list all.'),
        },
        async execute(args) {
          const s = settings();
          const slug = (args.slug ?? '').trim();
          if (slug === '') return renderList(s, cwd);
          const loaded = loadWork(s, slug, cwd);
          if (!loaded.ok) return `Error: ${loaded.error}`;
          const {doc, entry} = loaded;
          const lines = [
            `# ${doc.title}`,
            `slug: ${slug} · status: ${entry.status}${doc.fields.updated ? ` · updated: ${doc.fields.updated}` : ''}`,
            `file: ${s.dir}/${slug}/README.md`,
            '',
          ];
          for (const name of SECTIONS) {
            const body = Object.keys(doc.sections).filter((k) => k.toLowerCase() === name.toLowerCase()).map((k) => doc.sections[k])[0];
            if (body === undefined) continue;
            lines.push(`## ${name}`, body.trim() === '' ? '(empty)' : body.trim(), '');
          }
          const known = new Set(SECTIONS.map((s2) => s2.toLowerCase()));
          for (const [key, body] of Object.entries(doc.sections)) {
            if (known.has(key.toLowerCase())) continue;
            lines.push(`## ${key}`, body.trim() === '' ? '(empty)' : body.trim(), '');
          }
          return lines.join('\n').trimEnd();
        },
      }),
      work_update: tool({
        description:
          'Update a work folder README. Section bodies are REPLACED, not appended — write the current truth. Use before ending a session, after decisions settle, or when remaining work changes.',
        args: {
          slug: tool.schema.string().describe('Work folder name'),
          goal: tool.schema.string().optional().describe('Replace Goal section'),
          current_state: tool.schema.string().optional().describe('Replace Current state section'),
          decisions: tool.schema.string().optional().describe('Replace Decisions section'),
          constraints: tool.schema.string().optional().describe('Replace Constraints section'),
          relevant_files: tool.schema.string().optional().describe('Replace Relevant files section'),
          remaining_work: tool.schema.string().optional().describe('Replace Remaining work section'),
          status: tool.schema.enum(['open', 'paused', 'done']).optional().describe('Set folder status'),
        },
        async execute(args) {
          const s = settings();
          if (!s.write) return `Writing to ${s.dir} is disabled. Set {"write": true} in workflow.json.`;
          const slug = (args.slug ?? '').trim();
          if (slug === '') return 'Error: `slug` is required.';
          const sections: Record<string, string> = {};
          const map: Array<[keyof typeof args, string]> = [
            ['goal', 'Goal'], ['current_state', 'Current state'], ['decisions', 'Decisions'],
            ['constraints', 'Constraints'], ['relevant_files', 'Relevant files'], ['remaining_work', 'Remaining work'],
          ];
          for (const [arg, section] of map) {
            const body = args[arg];
            if (typeof body === 'string') sections[section] = body;
          }
          const result = updateWork(s, cwd, {slug, sections, status: args.status, title: undefined});
          if (!result.ok) return `Error: ${result.error}`;
          const touched = Object.keys(sections);
          const parts = [`Updated ${s.dir}/${slug}/README.md`];
          if (touched.length > 0) parts.push(`replaced: ${touched.join(', ')}`);
          if (result.created.length > 0) parts.push(`new sections: ${result.created.join(', ')}`);
          if (args.status) parts.push(`status: ${args.status}`);
          return parts.join('\n');
        },
      }),
      backlog: tool({
        description:
          'Durable task list for this repo (.work/TODO.md), survives sessions. Unlike session todo, use this for work known but not being done now, and to record what the next session should pick up.',
        args: {
          action: tool.schema.enum(['list', 'add', 'start', 'done', 'drop', 'remove']).optional().describe('Action, default list'),
          text: tool.schema.string().optional().describe('For add: task text, newline-separated for multiple'),
          match: tool.schema.string().optional().describe('For start/done/drop/remove: text to match or #N'),
          work: tool.schema.string().optional().describe('For add: optional work-folder slug to link'),
        },
        async execute(args) {
          const s = settings();
          const action = args.action ?? 'list';
          const text = args.text ?? '';
          const match = args.match ?? '';
          const work = (args.work ?? '').trim();
          if (action === 'list') return `# ${s.dir}/TODO.md\n${formatBacklog(readBacklog(s, cwd))}`;
          if (!s.write) return `Writing to ${s.dir} is disabled. Set {"write": true} in workflow.json.`;
          if (action === 'add') {
            if (work !== '' && !isValidSlug(work)) return `Error: "${work}" is not a valid work folder name.`;
            const texts = text.split('\n').map((line) => line.replace(/^\s*[-*]\s*(\[[^\]]*\])?\s*/, ''));
            const result = addItems(s, cwd, texts, work || undefined);
            if (!result.ok) return `Error: ${result.error}`;
            return `Added ${result.added} item(s) to ${s.dir}/TODO.md (${result.total} total).`;
          }
          if (action === 'start' || action === 'done' || action === 'drop') {
            if (match.trim() === '') return `Error: \`match\` is required for "${action}".`;
            const status = action === 'start' ? 'doing' : action === 'done' ? 'done' : 'dropped';
            const result = setItemStatus(s, cwd, match, status);
            if (!result.ok) return `Error: ${result.error}`;
            return `Marked "${result.item.text}" as ${status}.`;
          }
          if (action === 'remove') {
            if (match.trim() === '') return 'Error: `match` is required for "remove".';
            const result = removeItem(s, cwd, match);
            if (!result.ok) return `Error: ${result.error}`;
            return `Removed "${result.item.text}".`;
          }
          return `Error: unknown action "${String(action)}".`;
        },
      }),
    },
  };
}
