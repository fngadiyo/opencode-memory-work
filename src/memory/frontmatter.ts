export interface MemoryFrontmatter {
  fields: Record<string, string>;
  lists: Record<string, string[]>;
  body: string;
}

const LIST_KEY = /^([A-Za-z_][\w-]*)\s*:\s*$/;
const SCALAR_KEY = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;
const LIST_ITEM = /^-\s+(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  const comment = trimmed.indexOf(' #');
  return comment === -1 ? trimmed : trimmed.slice(0, comment).trim();
}

export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => unquote(item))
    .filter((item) => item !== '');
}

export function parseMemoryFrontmatter(text: string): MemoryFrontmatter | null {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;

  const fields: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let closing = -1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '---') {
      closing = i;
      break;
    }
    if (line === '' || line.startsWith('#')) continue;

    const listKey = LIST_KEY.exec(line);
    if (listKey) {
      const items: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next === '' || next.startsWith('#')) {
          i++;
          continue;
        }
        const item = LIST_ITEM.exec(next);
        if (!item) break;
        const value = unquote(item[1]);
        if (value !== '') items.push(value);
        i++;
      }
      lists[listKey[1]] = items;
      continue;
    }

    const scalar = SCALAR_KEY.exec(line);
    if (!scalar) return null;
    const key = scalar[1];
    const value = unquote(scalar[2]);
    fields[key] = value;
    if (key === 'covers' || key === 'schema_docs' || key === 'tags') {
      lists[key] = splitList(value);
    }
  }

  if (closing === -1) return null;
  return {fields, lists, body: lines.slice(closing + 1).join('\n')};
}

export function renderFrontmatter(
  fields: Record<string, string | number | boolean | null | undefined>,
  lists: Record<string, string[]>,
): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    lines.push(`${key}: ${value}`);
  }
  for (const [key, values] of Object.entries(lists)) {
    if (values.length === 0) continue;
    lines.push(`${key}: ${values.join(', ')}`);
  }
  lines.push('---');
  return lines.join('\n');
}
