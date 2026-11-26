import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {workRoot, type WorkflowSettings} from './config.js';

export type BacklogStatus = 'todo' | 'doing' | 'done' | 'dropped';
export interface BacklogItem { line: number; text: string; status: BacklogStatus; work?: string; }

const MARK: Record<BacklogStatus, string> = {todo: '[ ]', doing: '[~]', done: '[x]', dropped: '[-]'};
const STATUS_OF: Record<string, BacklogStatus> = {' ': 'todo', '': 'todo', '~': 'doing', x: 'done', X: 'done', '-': 'dropped'};
const ITEM_RE = /^[-*]\s+\[(.?)\]\s*(.+)$/;
const WORK_RE = /\s*(?:→|->)\s*([a-z0-9][a-z0-9._-]*)\s*$/i;

export function backlogPath(settings: WorkflowSettings, cwd: string): string {
  return join(workRoot(settings, cwd), 'TODO.md');
}

export function parseBacklog(text: string): BacklogItem[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const items: BacklogItem[] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const match = ITEM_RE.exec(raw.trim());
    if (!match) return;
    const status = STATUS_OF[match[1]] ?? 'todo';
    let body = match[2].trim();
    let work: string | undefined;
    const link = WORK_RE.exec(body);
    if (link) { work = link[1]; body = body.slice(0, link.index).trim(); }
    if (body === '') return;
    items.push({line: i + 1, text: body, status, work});
  });
  return items;
}

export function renderBacklog(items: readonly BacklogItem[], title = 'Backlog'): string {
  const lines = [`# ${title}`, ''];
  if (items.length === 0) lines.push('_Empty._ Add tasks with `backlog` `add`.');
  else for (const item of items) {
    const link = item.work ? ` → ${item.work}` : '';
    lines.push(`- ${MARK[item.status]} ${item.text}${link}`);
  }
  return `${lines.join('\n')}\n`;
}

export function readBacklog(settings: WorkflowSettings, cwd: string): BacklogItem[] {
  const path = backlogPath(settings, cwd);
  if (!existsSync(path)) return [];
  try { return parseBacklog(readFileSync(path, 'utf8')); } catch { return []; }
}

function write(settings: WorkflowSettings, cwd: string, items: readonly BacklogItem[]): void {
  const path = backlogPath(settings, cwd);
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, renderBacklog(items), 'utf8');
}

export function addItems(settings: WorkflowSettings, cwd: string, texts: readonly string[], work?: string): {ok: true; added: number; total: number} | {ok: false; error: string} {
  const items = readBacklog(settings, cwd);
  let added = 0;
  for (const text of texts) {
    const trimmed = text.trim();
    if (trimmed === '') continue;
    items.push({line: 0, text: trimmed, status: 'todo', work});
    added++;
  }
  if (added === 0) return {ok: false, error: 'No task text given.'};
  try { write(settings, cwd, items); } catch (err) { return {ok: false, error: err instanceof Error ? err.message : String(err)}; }
  return {ok: true, added, total: items.length};
}

export function findItems(items: readonly BacklogItem[], query: string): BacklogItem[] {
  const trimmed = query.trim();
  if (trimmed === '') return [];
  const ordinal = /^#(\d+)$/.exec(trimmed);
  if (ordinal) {
    const index = Number(ordinal[1]) - 1;
    return index >= 0 && index < items.length ? [items[index]] : [];
  }
  const needle = trimmed.toLowerCase();
  return items.filter((item) => item.text.toLowerCase().includes(needle));
}

export type BacklogMutation = {ok: true; item: BacklogItem} | {ok: false; error: string};

export function setItemStatus(settings: WorkflowSettings, cwd: string, query: string, status: BacklogStatus): BacklogMutation {
  const items = readBacklog(settings, cwd);
  const matches = findItems(items, query);
  if (matches.length === 0) return {ok: false, error: `No backlog item matches "${query}".`};
  if (matches.length > 1) return {ok: false, error: `"${query}" matches ${matches.length} items — be more specific or use #N:
${matches.map(m => '  - ' + m.text).join('\n')}`};
  const index = items.indexOf(matches[0]);
  items[index] = {...items[index], status};
  try { write(settings, cwd, items); } catch (err) { return {ok: false, error: err instanceof Error ? err.message : String(err)}; }
  return {ok: true, item: items[index]};
}

export function removeItem(settings: WorkflowSettings, cwd: string, query: string): BacklogMutation {
  const items = readBacklog(settings, cwd);
  const matches = findItems(items, query);
  if (matches.length === 0) return {ok: false, error: `No backlog item matches "${query}".`};
  if (matches.length > 1) return {ok: false, error: `"${query}" matches ${matches.length} items — be more specific or use #N:
${matches.map(m => '  - ' + m.text).join('\n')}`};
  const index = items.indexOf(matches[0]);
  const [removed] = items.splice(index, 1);
  try { write(settings, cwd, items); } catch (err) { return {ok: false, error: err instanceof Error ? err.message : String(err)}; }
  return {ok: true, item: removed};
}

export function formatBacklog(items: readonly BacklogItem[]): string {
  if (items.length === 0) return 'Backlog is empty.';
  const open = items.filter((i) => i.status === 'todo' || i.status === 'doing').length;
  return `${open} open of ${items.length}\n${items.map((item, i) => `${i + 1}. ${MARK[item.status]} ${item.text}${item.work ? `  (${item.work})` : ''}`).join('\n')}`;
}
