import {existsSync, mkdirSync} from 'node:fs';
import {tool} from '@opencode-ai/plugin';
import {memoryAvailable, memoryRoot, resolveMemorySettings, type MemorySettings} from './config.js';
import {checkFreshness, listDocs, saveDoc, searchDocs} from './store.js';
import {unignoredDirNotice} from '../util/git.js';

function mark(doc: ReturnType<typeof listDocs>[number], settings: MemorySettings, cwd: string): string {
  const fresh = checkFreshness(doc, settings, cwd);
  const icon = fresh.status === 'fresh' ? '✓' : fresh.status === 'stale' ? '!' : '?';
  return `${icon} ${doc.id} — ${doc.title} (${fresh.reason})`;
}

function driftHint(changed: string[]): string {
  if (changed.length === 0) return '';
  const shown = changed.slice(0, 5);
  const more = changed.length > shown.length ? ` (+${changed.length - shown.length} more)` : '';
  return `Start here: ${shown.join(', ')}${more}`;
}

export function createMemoryTools(cwd: string) {
  const settings = () => resolveMemorySettings(cwd);
  const ensureRoot = () => {
    const s = settings();
    if (!s.write) return;
    try { mkdirSync(memoryRoot(s, cwd), {recursive: true}); } catch { /* ignore */ }
  };

  return {
    available: () => memoryAvailable(settings(), cwd),
    ensureRoot,
    notice: () => {
      const s = settings();
      if (!existsSync(memoryRoot(s, cwd))) return undefined;
      return unignoredDirNotice(s.dir, cwd);
    },
    tools: {
      memory_lookup: tool({
        description:
          "Read this repo's remembered knowledge (.memory) BEFORE exploring the codebase. Call it with no arguments first on any task: it returns the doc index plus a git-computed staleness verdict per doc. Use `id` to read one doc, `query` to search across docs. `fresh` means covered paths are unchanged since verified — trust it and skip re-exploring those paths. `stale`/`unknown` means treat as a hint, verify against code, and update after verifying.",
        args: {
          id: tool.schema.string().optional().describe('Doc path relative to .memory, e.g. "schemas/core.md"'),
          query: tool.schema.string().optional().describe('Search titles and bodies for this text'),
          kind: tool.schema.string().optional().describe('Filter the index to one kind, e.g. schema/playbook/run/gotcha'),
          limit: tool.schema.number().optional().describe('Max docs to list (default 40)'),
        },
        async execute(args) {
          const s = settings();
          const id = (args.id ?? '').trim();
          if (id !== '') {
            const docs = listDocs(s, cwd);
            const doc = docs.find((d) => d.id === id);
            if (!doc) {
              const known = docs.map((d) => d.id).join('\n  ');
              return `No doc "${id}" in ${s.dir}. Known docs:\n  ${known || '(none)'}`;
            }
            const fresh = checkFreshness(doc, s, cwd);
            const header = [
              `# ${doc.title}`,
              `id: ${doc.id} (${doc.kind})`,
              `staleness: ${fresh.status} — ${fresh.reason}`,
              fresh.changed.length > 0 ? `changed since verification: ${fresh.changed.join(', ')}` : '',
              fresh.uncommitted.length > 0 ? `note (not staleness): uncommitted changes in covered paths — ${fresh.uncommitted.join(', ')}` : '',
              fresh.status === 'fresh'
                ? 'TRUSTED: covered paths are unchanged. You may skip re-exploring them.'
                : 'Verify against the code before relying on this. Changed files indicate where to recheck:',
              driftHint(fresh.changed),
              fresh.status === 'fresh' ? '' : 'After verifying, update this doc and refresh `verified_at` with memory_save.',
              '',
            ].filter((line) => line !== '').join('\n');
            return `${header}\n---\n${doc.body}`;
          }

          const query = (args.query ?? '').trim();
          if (query !== '') {
            const hits = searchDocs(s, cwd, query);
            if (hits.length === 0) return `Nothing in ${s.dir} matches "${query}".`;
            return hits.map((hit) => `${hit.doc.id}:${hit.line} — ${hit.snippet}`).join('\n');
          }

          const kindFilter = (args.kind ?? '').trim();
          const limit = args.limit ? Math.max(1, Math.floor(args.limit)) : 40;
          const docs = listDocs(s, cwd).filter((d) => kindFilter === '' || d.kind === kindFilter);
          if (docs.length === 0) return `No knowledge recorded in ${s.dir} yet. Explore the code normally; write findings back with memory_save when useful.`;
          const lines = docs.slice(0, limit).map((doc) => mark(doc, s, cwd));
          const freshCount = docs.filter((d) => checkFreshness(d, s, cwd).status === 'fresh').length;
          return [
            `${docs.length} doc(s) in ${s.dir} (${freshCount} fresh, ${docs.length - freshCount} needing verification):`,
            ...lines,
            '',
            'Read one with memory_lookup({id}).',
            '✓ = trust and skip exploration · ! = covered paths changed, re-verify · ? = no verified_at',
          ].join('\n');
        },
      }),

      memory_save: tool({
        description:
          'Record knowledge you had to derive by exploring or verifying, so the next session does not repeat it. Call this after you verified something against real code/schema. Requires memory write enabled. Never invent `verified_at`; it defaults to current HEAD. Prefer updating an existing doc over adding a near-duplicate.',
        args: {
          id: tool.schema.string().describe('Path under .memory ending in .md, e.g. "schemas/core.md"'),
          kind: tool.schema.string().describe('What this is: schema/playbook/run/gotcha/data-fix/anything useful'),
          title: tool.schema.string().describe('Human title'),
          body: tool.schema.string().describe('Markdown body. Be specific and include gotchas.'),
          covers: tool.schema.array(tool.schema.string()).optional().describe('Globs of code/paths this doc describes. Required for most docs.'),
          overwrite: tool.schema.boolean().optional().describe('Replace an existing doc. Defaults to false.'),
          extra: tool.schema.record(tool.schema.string(), tool.schema.string()).optional().describe('Extra frontmatter fields'),
        },
        async execute(args) {
          const s = settings();
          if (!s.write) return `Writing to ${s.dir} is disabled. Set {"write": true} in memory.json or ~/.opencode-memory-work/memory.json.`;
          const id = (args.id ?? '').trim();
          const kind = (args.kind ?? '').trim();
          const title = (args.title ?? '').trim();
          const body = (args.body ?? '').trim();
          if (id === '') return 'Error: `id` is required.';
          if (kind === '') return 'Error: `kind` is required.';
          if (title === '') return 'Error: `title` is required.';
          if (body === '') return 'Error: `body` is required.';
          const covers = (args.covers ?? []).map((c) => c.trim()).filter(Boolean);
          if (covers.length === 0 && kind !== 'run') {
            return 'Error: `covers` is required for non-run docs — without it staleness cannot be detected and the doc can never be trusted.';
          }
          const extra = args.extra ?? {};
          const fields: Record<string, string | number | boolean | null | undefined> = {kind};
          for (const [k, v] of Object.entries(extra)) fields[k] = v;
          const result = saveDoc(s, cwd, {
            id,
            fields,
            lists: {covers},
            body: body.startsWith('#') ? body : `# ${title}\n\n${body}`,
          }, args.overwrite === true);
          if (!result.ok) return `Error: ${result.error}`;
          return `Saved ${result.id} in ${s.dir} (${covers.length} cover pattern(s), verified at HEAD).`;
        },
      }),
    },
  };
}
