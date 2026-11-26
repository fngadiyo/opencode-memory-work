import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import type {Dirent} from 'node:fs';
import {join} from 'node:path';
import {workRoot, type WorkflowSettings} from './config.js';
import {newWorkDoc, parseWorkDoc, renderWorkDoc, sectionOf, toStatus, type WorkDoc, type WorkStatus} from './doc.js';
import {today} from '../util/fs.js';

export interface WorkEntry {
  slug: string;
  title: string;
  status: WorkStatus;
  updated: string;
  goal: string;
  broken: boolean;
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes('..');
}

export function slugify(title: string, date: Date = new Date()): string {
  const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const body = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return body === '' ? stamp : `${stamp}-${body}`;
}

function readmePath(settings: WorkflowSettings, slug: string, cwd: string): string {
  return join(workRoot(settings, cwd), slug, 'README.md');
}

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) return trimmed;
  }
  return '';
}

function entryFrom(settings: WorkflowSettings, slug: string, cwd: string): WorkEntry {
  const path = readmePath(settings, slug, cwd);
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch {
    return {slug, title: slug, status: 'open', updated: '', goal: '', broken: true};
  }
  const doc = parseWorkDoc(text);
  return {
    slug,
    title: doc.title === '' ? slug : doc.title,
    status: toStatus(doc.fields.status),
    updated: doc.fields.updated ?? '',
    goal: firstLine(sectionOf(doc, 'Goal')),
    broken: doc.title === '',
  };
}

export function listWork(settings: WorkflowSettings, cwd: string): WorkEntry[] {
  const root = workRoot(settings, cwd);
  let entries: Dirent[];
  try { entries = readdirSync(root, {withFileTypes: true}); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => entryFrom(settings, e.name, cwd))
    .sort((a, b) => {
      const keyA = a.updated !== '' ? a.updated : a.slug.slice(0, 10);
      const keyB = b.updated !== '' ? b.updated : b.slug.slice(0, 10);
      return keyB.localeCompare(keyA);
    });
}

export function loadWork(settings: WorkflowSettings, slug: string, cwd: string): {ok: true; doc: WorkDoc; path: string; entry: WorkEntry} | {ok: false; error: string} {
  if (!isValidSlug(slug)) return {ok: false, error: `"${slug}" is not a valid work folder name.`};
  const path = readmePath(settings, slug, cwd);
  if (!existsSync(path)) {
    const known = listWork(settings, cwd).map((e) => e.slug);
    return {ok: false, error: `No work folder "${slug}".
${known.length > 0 ? `Known folders:\n  ${known.join('\n  ')}` : 'No work folders yet.'}`};
  }
  try {
    const text = readFileSync(path, 'utf8');
    return {ok: true, doc: parseWorkDoc(text), path, entry: entryFrom(settings, slug, cwd)};
  } catch (err) {
    return {ok: false, error: err instanceof Error ? err.message : String(err)};
  }
}

export function createWork(settings: WorkflowSettings, cwd: string, input: {title: string; goal: string; slug?: string; status?: WorkStatus}): {ok: true; slug: string; path: string} | {ok: false; error: string} {
  const title = input.title.trim();
  const goal = input.goal.trim();
  if (title === '') return {ok: false, error: '`title` is required.'};
  if (goal === '') return {ok: false, error: '`goal` is required — write what must be true when the work is complete.'};
  const slug = (input.slug?.trim() || slugify(title)).trim();
  if (!isValidSlug(slug)) return {ok: false, error: `"${slug}" is not a valid folder name.`};
  const dir = join(workRoot(settings, cwd), slug);
  if (existsSync(dir)) return {ok: false, error: `Work folder "${slug}" already exists — resume it with work_status, or pick another title.`};
  const doc = newWorkDoc({title, goal, status: input.status, fields: {created: today(), updated: today()}});
  const path = readmePath(settings, slug, cwd);
  try {
    mkdirSync(dir, {recursive: true});
    writeFileSync(path, renderWorkDoc(doc), 'utf8');
  } catch (err) {
    return {ok: false, error: err instanceof Error ? err.message : String(err)};
  }
  return {ok: true, slug, path};
}

export function updateWork(
  settings: WorkflowSettings,
  cwd: string,
  input: {slug: string; sections?: Record<string, string>; status?: WorkStatus; title?: string},
): {ok: true; slug: string; path: string; created: string[]} | {ok: false; error: string} {
  const loaded = loadWork(settings, input.slug, cwd);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;
  const created: string[] = [];
  for (const [name, body] of Object.entries(input.sections ?? {})) {
    if (name.trim() === '') continue;
    const existing = Object.keys(doc.sections).find((k) => k.toLowerCase() === name.trim().toLowerCase());
    const key = existing ?? name.trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
    if (existing === undefined) created.push(key);
    doc.sections[key] = body.trim();
  }
  if (input.title !== undefined && input.title.trim() !== '') doc.title = input.title.trim();
  doc.fields.status = toStatus(input.status ?? doc.fields.status);
  doc.fields.updated = today();
  if (doc.fields.kind === undefined) doc.fields.kind = 'work';
  try { writeFileSync(loaded.path, renderWorkDoc(doc), 'utf8'); } catch (err) {
    return {ok: false, error: err instanceof Error ? err.message : String(err)};
  }
  return {ok: true, slug: input.slug, path: loaded.path, created};
}
