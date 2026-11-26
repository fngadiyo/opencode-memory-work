export const SECTIONS = [
  'Goal',
  'Current state',
  'Decisions',
  'Constraints',
  'Relevant files',
  'Remaining work',
] as const;

export type WorkStatus = 'open' | 'paused' | 'done';
const STATUSES: readonly WorkStatus[] = ['open', 'paused', 'done'];

export function toStatus(value: unknown): WorkStatus {
  return STATUSES.includes(value as WorkStatus) ? (value as WorkStatus) : 'open';
}

export interface WorkDoc {
  fields: Record<string, string>;
  title: string;
  sections: Record<string, string>;
  preamble: string;
  noFrontmatter: boolean;
}

const FRONTMATTER_KEY = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  const comment = trimmed.indexOf(' #');
  const body = (comment === -1 ? trimmed : trimmed.slice(0, comment)).trim();
  if (body.length >= 2) {
    const first = body[0];
    const last = body[body.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return body.slice(1, -1);
  }
  return body;
}

export function parseWorkDoc(text: string): WorkDoc {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = source.split(/\r?\n/);
  const fields: Record<string, string> = {};
  let cursor = 0;
  let sawFrontmatter = false;
  if (lines[0]?.trim() === '---') {
    const closing = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (closing !== -1) {
      sawFrontmatter = true;
      for (const raw of lines.slice(1, closing)) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#')) continue;
        const match = FRONTMATTER_KEY.exec(line);
        if (match) fields[match[1]] = unquote(match[2]);
      }
      cursor = closing + 1;
    }
  }
  let title = '';
  const preambleLines: string[] = [];
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let bucket: string[] = [];
  const flush = (): void => {
    if (current === null) preambleLines.push(...bucket);
    else sections[current] = bucket.join('\n').trim();
    bucket = [];
  };
  for (let i = cursor; i < lines.length; i++) {
    const line = lines[i];
    const h1 = /^#\s+(.+)$/.exec(line.trim());
    if (h1 && title === '' && current === null) {
      title = h1[1].trim();
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line.trim());
    if (h2) {
      flush();
      current = h2[1].trim();
      continue;
    }
    bucket.push(line);
  }
  flush();
  return {fields, title, sections, preamble: preambleLines.join('\n').trim(), noFrontmatter: !sawFrontmatter};
}

export function sectionOf(doc: WorkDoc, name: string): string {
  const needle = name.trim().toLowerCase();
  for (const [key, value] of Object.entries(doc.sections)) {
    if (key.toLowerCase() === needle) return value;
  }
  return '';
}

export function renderFrontmatter(fields: Record<string, string>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value.trim() === '') continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  return lines.join('\n');
}

export function renderWorkDoc(doc: WorkDoc): string {
  const parts: string[] = [renderFrontmatter(doc.fields), '', `# ${doc.title}`.trimEnd()];
  const preamble = doc.preamble.trim();
  if (preamble !== '') parts.push('', preamble);
  const emitted = new Set<string>();
  const ordered: string[] = [];
  for (const name of SECTIONS) {
    const key = Object.keys(doc.sections).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key !== undefined) {
      ordered.push(key);
      emitted.add(key);
    }
  }
  for (const key of Object.keys(doc.sections)) {
    if (!emitted.has(key)) ordered.push(key);
  }
  for (const key of ordered) {
    const body = doc.sections[key].trim();
    parts.push('', `## ${key}`, body === '' ? '' : `\n${body}`);
  }
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export function newWorkDoc(input: {title: string; goal: string; status?: WorkStatus; fields?: Record<string, string>}): WorkDoc {
  return {
    fields: {kind: 'work', status: input.status ?? 'open', ...input.fields},
    title: input.title,
    sections: {
      Goal: input.goal.trim(),
      'Current state': 'Not started.',
      Decisions: 'None yet.',
      Constraints: 'None recorded.',
      'Relevant files': 'Not yet identified.',
      'Remaining work': 'Not yet broken down.',
    },
    preamble: '',
    noFrontmatter: false,
  };
}
