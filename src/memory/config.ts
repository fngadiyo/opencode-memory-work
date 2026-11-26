import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {readJson} from '../util/fs.js';

export interface MemorySettings {
  dir: string;
  write: boolean;
  staleAfterDays: number;
}

const DEFAULTS: MemorySettings = {
  dir: '.memory',
  write: true,
  staleAfterDays: 90,
};

function coerce(raw: Record<string, unknown>): Partial<MemorySettings> {
  const out: Partial<MemorySettings> = {};
  if (typeof raw.dir === 'string' && raw.dir.trim() !== '') out.dir = raw.dir.trim();
  if (typeof raw.write === 'boolean') out.write = raw.write;
  if (typeof raw.staleAfterDays === 'number' && Number.isFinite(raw.staleAfterDays) && raw.staleAfterDays >= 0) {
    out.staleAfterDays = Math.floor(raw.staleAfterDays);
  }
  return out;
}

export function resolveMemorySettings(cwd: string): MemorySettings {
  const project = readJson(join(cwd, 'memory.json'));
  const user = readJson(join(homedir(), '.opencode-memory-work', 'memory.json'));
  const legacy = readJson(join(homedir(), '.pal', 'memory.json'));
  return {
    ...DEFAULTS,
    ...(legacy ? coerce(legacy) : {}),
    ...(project ? coerce(project) : {}),
    ...(user ? coerce(user) : {}),
  };
}

export function memoryRoot(settings: MemorySettings, cwd: string): string {
  return join(cwd, settings.dir);
}

export function memoryAvailable(settings: MemorySettings, cwd: string): boolean {
  return existsSync(memoryRoot(settings, cwd)) || settings.write;
}
