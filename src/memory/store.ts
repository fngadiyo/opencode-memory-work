import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import type {Dirent} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative} from 'node:path';
import {parseMemoryFrontmatter, renderFrontmatter} from './frontmatter.js';
import {memoryRoot, type MemorySettings} from './config.js';
import {git, headSha} from '../util/git.js';

export type MemoryKind = 'schema' | 'playbook' | 'run' | 'note' | (string & {});

export interface MemoryDoc {
  id: string;
  kind: MemoryKind;
  title: string;
  fields: Record<string, string>;
  lists: Record<string, string[]>;
  body: string;
}

export interface Freshness {
  status: 'fresh' | 'stale' | 'unknown' | 'uncheckable';
  reason: string;
  changed: string[];
  uncommitted: string[];
}

const KIND_DIRS: Array<{prefix: string; kind: MemoryKind}> = [
  {prefix: 'schemas', kind: 'schema'},
  {prefix: 'playbooks', kind: 'playbook'},
  {prefix: 'runs', kind: 'run'},
];

function kindFor(id: string): MemoryKind {
  const head = id.split('/')[0];
  if (!id.includes('/')) return 'other';
  return KIND_DIRS.find((k) => k.prefix === head)?.kind ?? head;
}

function walk(dir: string, root: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(relative(root, full).replace(/\\/g, '/'));
    }
  }
}

function titleOf(body: string, id: string): string {
  for (const line of body.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match) return match[1].trim();
  }
  return basename(id);
}

function readDoc(root: string, id: string): MemoryDoc | null {
  let text: string;
  try {
    text = readFileSync(join(root, id), 'utf8');
  } catch {
    return null;
  }
  const fm = parseMemoryFrontmatter(text);
  const fields = fm?.fields ?? {};
  const lists = fm?.lists ?? {};
  const body = fm?.body ?? text;
  const explicitKind = fields.kind?.trim();
  return {
    id,
    kind: explicitKind ? explicitKind : kindFor(id),
    title: titleOf(body, id),
    fields,
    lists,
    body,
  };
}

export function listDocs(settings: MemorySettings, cwd: string): MemoryDoc[] {
  const root = memoryRoot(settings, cwd);
  const ids: string[] = [];
  walk(root, root, ids);
  const docs: MemoryDoc[] = [];
  for (const id of ids.sort()) {
    if (id === 'README.md' || id === 'index.md') continue;
    const doc = readDoc(root, id);
    if (doc) docs.push(doc);
  }
  return docs;
}

function isMemoryPath(relPath: string, settings: MemorySettings): boolean {
  const memoryDir = settings.dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return relPath.replace(/\\/g, '/').startsWith(`${memoryDir}/`);
}

export function checkFreshness(doc: MemoryDoc, settings: MemorySettings, cwd: string): Freshness {
  const verifiedAt = doc.fields.verified_at?.trim();
  if (!verifiedAt || verifiedAt.includes('<')) {
    return {status: 'unknown', reason: 'no verified_at recorded', changed: [], uncommitted: []};
  }
  if (git(cwd, ['rev-parse', '--verify', '--quiet', `${verifiedAt}^{commit}`]) === null) {
    return {status: 'uncheckable', reason: `verified_at "${verifiedAt}" is not a commit in this repo`, changed: [], uncommitted: []};
  }
  const covers = (doc.lists.covers ?? []).filter((c) => c !== '');
  if (covers.length === 0) {
    return {status: 'uncheckable', reason: 'no covers paths, so drift cannot be detected', changed: [], uncommitted: []};
  }
  const committed = git(cwd, ['diff', '--name-only', `${verifiedAt}..HEAD`, '--', ...covers]);
  if (committed === null) {
    return {status: 'uncheckable', reason: 'git diff failed', changed: [], uncommitted: []};
  }
  const committedFiles = committed.split(/\r?\n/).filter((f) => f !== '');
  const dirty = git(cwd, ['status', '--porcelain', '--', ...covers]);
  const uncommitted = (dirty ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.replace(/^.{1,2}\s+/, '').trim())
    .map((f) => f.replace(/^.* -> /, ''))
    .filter((f) => f !== '')
    .filter((f) => !isMemoryPath(f, settings))
    .filter((f) => !committedFiles.includes(f));

  if (committedFiles.length === 0) {
    const reason = uncommitted.length === 0
      ? `covered paths unchanged since ${verifiedAt.slice(0, 8)}`
      : `no commits since ${verifiedAt.slice(0, 8)} (working tree has uncommitted changes)`;
    return {status: 'fresh', reason, changed: [], uncommitted};
  }
  return {
    status: 'stale',
    reason: `${committedFiles.length} covered file(s) changed since ${verifiedAt.slice(0, 8)}`,
    changed: committedFiles.slice(0, 20),
    uncommitted,
  };
}

export interface SearchHit {
  doc: MemoryDoc;
  line: number;
  snippet: string;
}

export function searchDocs(settings: MemorySettings, cwd: string, query: string, limit = 10): SearchHit[] {
  const needle = query.toLowerCase().trim();
  if (needle === '') return [];
  const hits: SearchHit[] = [];
  for (const doc of listDocs(settings, cwd)) {
    if (doc.title.toLowerCase().includes(needle) || doc.id.toLowerCase().includes(needle)) {
      hits.push({doc, line: 1, snippet: doc.title});
      if (hits.length >= limit) break;
      continue;
    }
    const lines = doc.body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push({doc, line: i + 1, snippet: lines[i].trim().slice(0, 200)});
        break;
      }
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

export function saveDoc(
  settings: MemorySettings,
  cwd: string,
  input: {id: string; fields: Record<string, string | number | boolean | null | undefined>; lists: Record<string, string[]>; body: string},
  overwrite = false,
): {ok: true; id: string} | {ok: false; error: string} {
  const root = memoryRoot(settings, cwd);
  if (isAbsolute(input.id)) return {ok: false, error: `id must be relative to ${settings.dir}, got "${input.id}"`};
  const id = input.id.replace(/\\/g, '/').replace(/^\/+/, '');
  if (id === '' || id.split('/').some((seg) => seg === '..' || seg === '')) {
    return {ok: false, error: `refusing suspicious id "${input.id}"`};
  }
  if (!id.toLowerCase().endsWith('.md')) return {ok: false, error: 'id must end with .md'};
  if (basename(id).startsWith('_')) return {ok: false, error: 'ids starting with "_" are reserved for templates'};
  const target = join(root, id);
  const relToRoot = relative(root, target);
  if (relToRoot.startsWith('..') || relToRoot.split(/[\\/]/).includes('..')) {
    return {ok: false, error: `refusing to write outside ${settings.dir}`};
  }
  if (existsSync(target) && !overwrite) {
    return {ok: false, error: `${id} already exists — pass overwrite:true to update it`};
  }
  const fields = {...input.fields};
  if (!fields.verified_at) fields.verified_at = headSha(cwd) ?? undefined;
  const content = `${renderFrontmatter(fields, input.lists)}\n\n${input.body.trim()}\n`;
  try {
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, content, 'utf8');
  } catch (err) {
    return {ok: false, error: err instanceof Error ? err.message : String(err)};
  }
  return {ok: true, id};
}
