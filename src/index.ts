import type {Plugin} from '@opencode-ai/plugin';
import {createMemoryTools} from './memory/tools.js';
import {createWorkTools} from './work/tools.js';

const MEMORY_PROMPT = [
  'REPO MEMORY: This repo may keep notes from previous sessions in `.memory`.',
  'BEFORE you start exploring the codebase — before a broad search, before reading many files — call `memory_lookup` with no arguments.',
  'It is one cheap call and returns an index plus a git-computed staleness verdict per doc.',
  'A `fresh` doc means its covered paths are unchanged since it was verified — trust it and skip re-exploring those paths.',
  'A `stale` or `unknown` doc is a hint only: verify against the real code, and it will point you at files that drifted.',
  'When you had to derive something the hard way or found a stale doc, write it back with `memory_save` and refresh `verified_at`.',
  'Never write a doc without `covers` globs, and prefer updating an existing doc over adding a near-duplicate.',
  'If memory has nothing relevant, say nothing about it and carry on normally.',
].join(' ');

const WORK_PROMPT = [
  'TASK CONTINUITY: This repo may keep per-task handoffs in `.work/` — one folder per multi-session task, each with a README holding goal, current state, decisions, constraints, relevant files and remaining work.',
  'This is not the same thing as `.memory` (which describes the codebase): `.work` describes the TASK.',
  'Memory comes FIRST, always. Work comes SECOND, only when you have a task in hand.',
  'Do not call `work_status` before `memory_lookup` on a fresh task.',
  'WHEN a task spans more than one session, call `work_status` with no arguments to see what is already open.',
  'If a folder matches your task, read it with `work_status({slug})` before exploring the codebase and continue from its Remaining work section.',
  'If none matches and the task is genuinely multi-session, call `work_start` to create one.',
  'Keep the README current: after a decision is settled, and ALWAYS before the session ends, call `work_update` with the section bodies that changed.',
  'Replace section bodies with the current truth — do not append a changelog.',
  'Use `backlog` for work that is known but not being done now; it survives sessions.',
].join(' ');

export const MemoryWorkPlugin: Plugin = async ({directory}) => {
  const cwd = directory;
  const memory = createMemoryTools(cwd);
  const work = createWorkTools(cwd);

  // Create roots lazily/optimistically if writing enabled. Never throw.
  try { memory.ensureRoot(); } catch { /* ignore */ }

  const notices: string[] = [];
  try { const n = memory.notice(); if (n) notices.push(n); } catch { /* ignore */ }
  try { const n = work.notice(); if (n) notices.push(n); } catch { /* ignore */ }

  const tools: Record<string, any> = {};
  if (memory.available()) Object.assign(tools, memory.tools);
  if (work.available()) Object.assign(tools, work.tools);

  return {
    tool: tools,
    async "experimental.chat.system.transform"(input, output) {
      const parts: string[] = [];
      if (memory.available()) parts.push(MEMORY_PROMPT);
      if (work.available()) parts.push(WORK_PROMPT);
      if (notices.length > 0) parts.push(`Continuity notices:\n- ${notices.join('\n- ')}`);
      if (parts.length > 0) output.system.push(parts.join('\n\n'));
    },
  };
};

export const PalContinuityPlugin = MemoryWorkPlugin;
export default MemoryWorkPlugin;
