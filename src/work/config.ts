import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readJson} from '../util/fs.js';

export interface WorkflowSettings {
  dir: string;
  write: boolean;
}

const DEFAULTS: WorkflowSettings = {dir: '.work', write: true};

function coerce(raw: Record<string, unknown>): Partial<WorkflowSettings> {
  const out: Partial<WorkflowSettings> = {};
  if (typeof raw.dir === 'string' && raw.dir.trim() !== '') out.dir = raw.dir.trim();
  if (typeof raw.write === 'boolean') out.write = raw.write;
  return out;
}

export function resolveWorkflowSettings(cwd: string): WorkflowSettings {
  const project = readJson(join(cwd, 'workflow.json'));
  const user = readJson(join(homedir(), '.pal', 'workflow.json'));
  return {...DEFAULTS, ...(project ? coerce(project) : {}), ...(user ? coerce(user) : {})};
}

export function workRoot(settings: WorkflowSettings, cwd: string): string {
  return join(cwd, settings.dir);
}

export function workAvailable(settings: WorkflowSettings, cwd: string): boolean {
  return existsSync(workRoot(settings, cwd)) || settings.write;
}
