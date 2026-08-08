export type MarkdownDocument = {
  data: Record<string, unknown>;
  body: string;
};

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return trimmed.startsWith('"')
        ? JSON.parse(trimmed)
        : trimmed.slice(1, -1).replace(/''/g, "'");
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseMarkdownDocument(source: string): MarkdownDocument {
  const normalized = source.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) return { data: {}, body: normalized };

  const data: Record<string, unknown> = {};
  let currentKey = '';
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const item = line.match(/^\s+-\s*(.*)$/);
    if (item && currentKey) {
      const existing = data[currentKey];
      const list: unknown[] = Array.isArray(existing) ? existing : [];
      list.push(scalar(item[1]));
      data[currentKey] = list;
      continue;
    }
    const property = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!property) continue;
    currentKey = property[1];
    data[currentKey] = property[2] ? scalar(property[2]) : [];
  }

  return { data, body: match[2].replace(/^\n/, '').replace(/\s+$/, '') };
}

function yamlScalar(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (value === null || value === undefined) return '""';
  return JSON.stringify(String(value));
}

export function serializeMarkdownDocument(data: Record<string, unknown>, body = ''): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push('---', '', body.trim(), '');
  return lines.join('\n');
}
