import {execFileSync} from 'node:child_process';

export function git(cwd: string, args: string[], timeout = 10_000): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
    }).trim();
  } catch {
    return null;
  }
}

export function headSha(cwd: string): string | null {
  return git(cwd, ['rev-parse', 'HEAD']);
}

export function isDirGitIgnored(dir: string, cwd: string): boolean | undefined {
  try {
    execFileSync('git', ['check-ignore', '-q', dir], {
      cwd,
      stdio: 'ignore',
      timeout: 2000,
    });
    return true;
  } catch (err) {
    const code = (err as {status?: number}).status;
    if (code === 1) return false;
    return undefined;
  }
}

export function unignoredDirNotice(dir: string, cwd: string): string | undefined {
  const ignored = isDirGitIgnored(dir, cwd);
  if (ignored !== false) return undefined;
  return `${dir} is not ignored by git — it will show up in git status and can be committed by accident. Hide it machine-wide: printf '${dir}/\n' >> ~/.config/git/ignore`;
}
