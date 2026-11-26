import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

export function readText(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function readJson(path: string): Record<string, unknown> | null {
  try {
    const text = readText(path);
    if (text == null) return null;
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, content, 'utf8');
}

export function ensureDir(path: string): void {
  mkdirSync(path, {recursive: true});
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function repoPath(cwd: string, ...parts: string[]): string {
  return join(cwd, ...parts);
}
