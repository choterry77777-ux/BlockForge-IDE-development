import type { SourceMapping } from '../types';

/** Line based code writer that records which block produced which lines. */
export class Emitter {
  readonly lines: string[] = [];
  readonly maps: { blockId: string; start: number; end: number }[] = [];
  level = 0;

  constructor(readonly unit = '    ') {}

  line(text = ''): void {
    this.lines.push(text ? this.unit.repeat(this.level) + text : '');
  }

  /** Emit already formatted lines relative to the current indentation. */
  block(lines: string[]): void {
    for (const l of lines) this.line(l);
  }

  blank(): void {
    if (this.lines.length && this.lines[this.lines.length - 1] !== '') this.lines.push('');
  }

  indent(): void {
    this.level++;
  }

  dedent(): void {
    this.level = Math.max(0, this.level - 1);
  }

  get count(): number {
    return this.lines.length;
  }

  /** Record that lines written since `start` belong to a block. */
  mark(blockId: string | undefined, start: number): void {
    if (blockId && this.lines.length > start) this.maps.push({ blockId, start: start + 1, end: this.lines.length });
  }

  /** Append another emitter at the current indentation, shifting its mappings. */
  append(other: Emitter): void {
    const offset = this.lines.length;
    const pad = this.unit.repeat(this.level);
    for (const l of other.lines) this.lines.push(l ? pad + l : '');
    for (const m of other.maps) this.maps.push({ blockId: m.blockId, start: m.start + offset, end: m.end + offset });
  }

  toString(): string {
    const out = [...this.lines];
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }

  mappings(file: string): SourceMapping[] {
    return this.maps.map((m) => ({ blockId: m.blockId, file, startLine: m.start, endLine: m.end }));
  }
}

export interface QuoteOptions {
  quote?: '"' | "'";
  /** How to write control characters. */
  control?: 'u4' | 'ubrace' | 'octal' | 'decimal' | 'x2';
  /** Extra characters that need a backslash, e.g. '$' or '#'. */
  escape?: string;
}

/** Quote a string literal with C-style escapes. Non-ASCII text is kept as UTF-8. */
export function quote(s: string, o: QuoteOptions = {}): string {
  const q = o.quote ?? '"';
  let out = q;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === q) out += '\\' + q;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (o.escape?.includes(ch)) out += '\\' + ch;
    else if (code < 0x20 || code === 0x7f) {
      switch (o.control ?? 'u4') {
        case 'ubrace':
          out += `\\u{${code.toString(16)}}`;
          break;
        case 'octal':
          out += '\\' + code.toString(8).padStart(3, '0');
          break;
        case 'decimal':
          out += '\\' + code.toString(10).padStart(3, '0');
          break;
        case 'x2':
          out += '\\x' + code.toString(16).padStart(2, '0');
          break;
        default:
          out += '\\u' + code.toString(16).padStart(4, '0');
      }
    } else out += ch;
  }
  return out + q;
}

/** Maps user facing names to valid, collision free identifiers of a target language. */
export class NameTable {
  private map = new Map<string, string>();
  private used = new Set<string>();

  constructor(
    private reserved: Set<string>,
    private unicode: boolean,
  ) {}

  private clean(name: string): string {
    let out = '';
    for (const ch of name.trim()) {
      if (/[A-Za-z0-9_]/.test(ch)) out += ch;
      else if (this.unicode && /[\p{L}\p{N}]/u.test(ch)) out += ch;
      else if (/\s|-/.test(ch)) out += '_';
      else if (!this.unicode && ch.codePointAt(0)! > 127) out += 'u' + ch.codePointAt(0)!.toString(16);
      else out += '_';
    }
    if (!out) out = 'v';
    if (/^[0-9]/.test(out)) out = '_' + out;
    return out;
  }

  /** Identifier for a namespaced user name, e.g. ('var', 'my total'). */
  get(kind: string, name: string): string {
    const key = `${kind}:${name}`;
    const hit = this.map.get(key);
    if (hit) return hit;
    let id = this.clean(name);
    if (this.reserved.has(id)) id += '_';
    const base = id;
    let n = 2;
    while (this.used.has(id)) id = `${base}${n++}`;
    this.used.add(id);
    this.map.set(key, id);
    return id;
  }

  /** A new identifier that does not collide with anything else. */
  fresh(base: string): string {
    let id = base;
    let n = 2;
    while (this.used.has(id) || this.reserved.has(id)) id = `${base}${n++}`;
    this.used.add(id);
    return id;
  }

  reserve(id: string): void {
    this.used.add(id);
  }
}
