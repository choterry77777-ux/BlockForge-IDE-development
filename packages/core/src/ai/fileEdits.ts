/** Structured, validated project file edits proposed by an AI model. */

export type FileEdit =
  | { action: 'create'; path: string; content: string }
  | { action: 'replace'; path: string; content: string }
  | { action: 'patch'; path: string; hunks: { search: string; replace: string }[] }
  | { action: 'delete'; path: string };

export interface EditIssue {
  path: string;
  message: string;
}

const MAX_EDITS = 50;
const MAX_CONTENT = 400_000;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Project relative paths only: no absolute paths, drive letters or parent traversal. */
export function safeRelativePath(path: unknown): string | undefined {
  if (typeof path !== 'string') return undefined;
  const p = path.trim().replace(/\\/g, '/');
  if (!p || p.length > 200 || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('~')) return undefined;
  const parts = p.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..')) return undefined;
  if (!/^[\w .@+\-/()[\]]+$/u.test(p)) return undefined;
  return p;
}

/** Simple glob matching for exclusion lists: * within a segment, ** across segments. */
export function matchesGlob(path: string, glob: string): boolean {
  const re = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^(?:.*/)?${re}(?:/.*)?$`).test(path);
}

export function parseFileEdits(input: unknown, excluded: string[] = []): { edits: FileEdit[]; issues: EditIssue[] } {
  const issues: EditIssue[] = [];
  const edits: FileEdit[] = [];
  const list = isObj(input) && Array.isArray(input.edits) ? input.edits : input;
  if (!Array.isArray(list)) return { edits, issues: [{ path: 'edits', message: 'expected a list of edits' }] };
  if (list.length > MAX_EDITS) return { edits, issues: [{ path: 'edits', message: `too many edits (limit ${MAX_EDITS})` }] };
  list.forEach((raw, i) => {
    const where = `edits[${i}]`;
    const bad = (message: string) => issues.push({ path: where, message });
    if (!isObj(raw)) return bad('an edit must be an object');
    const path = safeRelativePath(raw.path);
    if (!path) return bad('the path must be a relative path inside the project');
    if (excluded.some((g) => matchesGlob(path, g))) return bad(`"${path}" is excluded from AI access`);
    const text = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_CONTENT;
    switch (raw.action) {
      case 'create':
      case 'replace':
        if (!text(raw.content)) return bad('"content" must be text of a reasonable size');
        edits.push({ action: raw.action, path, content: raw.content });
        break;
      case 'patch': {
        const hunks = raw.hunks;
        if (!Array.isArray(hunks) || !hunks.length || hunks.some((h) => !isObj(h) || !text(h.search) || !text(h.replace) || h.search === '')) return bad('"hunks" must be a non-empty list of { search, replace }');
        edits.push({ action: 'patch', path, hunks: hunks.map((h) => ({ search: String((h as { search: string }).search), replace: String((h as { replace: string }).replace) })) });
        break;
      }
      case 'delete':
        edits.push({ action: 'delete', path });
        break;
      default:
        bad(`unknown action "${String(raw.action)}"`);
    }
  });
  return { edits, issues };
}

export interface FileChange {
  path: string;
  kind: 'create' | 'modify' | 'delete';
  before?: string;
  after?: string;
}

export interface AppliedEdits {
  ok: boolean;
  files: Record<string, string>;
  changes: FileChange[];
  issues: EditIssue[];
  /** Deleting or overwriting whole files needs explicit approval. */
  destructive: boolean;
}

/** Apply edits to an in-memory copy of the project files. Nothing touches the real files. */
export function applyFileEdits(source: Record<string, string>, edits: FileEdit[]): AppliedEdits {
  const files = { ...source };
  const issues: EditIssue[] = [];
  const touched = new Map<string, string | undefined>();
  const remember = (path: string) => {
    if (!touched.has(path)) touched.set(path, source[path]);
  };
  edits.forEach((e, i) => {
    const where = `edits[${i}]`;
    const bad = (message: string) => issues.push({ path: where, message });
    switch (e.action) {
      case 'create':
        if (e.path in files) return bad(`"${e.path}" already exists; use replace or patch`);
        remember(e.path);
        files[e.path] = e.content;
        break;
      case 'replace':
        if (!(e.path in files)) return bad(`"${e.path}" does not exist; use create`);
        remember(e.path);
        files[e.path] = e.content;
        break;
      case 'patch': {
        if (!(e.path in files)) return bad(`"${e.path}" does not exist`);
        let text = files[e.path];
        for (const [j, h] of e.hunks.entries()) {
          const first = text.indexOf(h.search);
          if (first === -1) return bad(`hunk ${j + 1}: the text to replace was not found in "${e.path}"`);
          if (text.indexOf(h.search, first + 1) !== -1) return bad(`hunk ${j + 1}: the text to replace appears more than once in "${e.path}"; include more surrounding lines`);
          text = text.slice(0, first) + h.replace + text.slice(first + h.search.length);
        }
        remember(e.path);
        files[e.path] = text;
        break;
      }
      case 'delete':
        if (!(e.path in files)) return bad(`"${e.path}" does not exist`);
        remember(e.path);
        delete files[e.path];
        break;
    }
  });
  const changes: FileChange[] = [];
  for (const [path, before] of touched) {
    const after = files[path];
    if (before === after) continue;
    changes.push({ path, kind: before === undefined ? 'create' : after === undefined ? 'delete' : 'modify', before, after });
  }
  return { ok: issues.length === 0, files: issues.length ? source : files, changes, issues, destructive: edits.some((e) => e.action === 'delete' || e.action === 'replace') };
}
