import type { ClassDecl, Expr, FuncDecl, InterfaceDecl, Stmt, TypeRef } from '../ir/types';
import { ImperativeGenerator, type E, type RangeInfo, type S, type X } from './base';
import type { Emitter } from './emitter';

/**
 * A shell word built from segments.
 * dq: text placed inside double quotes (already escaped, may contain expansions).
 * bare: a self-contained expansion or literal that needs no quotes when it stands alone.
 * raw: must be written exactly as is, e.g. $'...' or an array literal.
 */
type Seg = { k: 'dq' | 'bare' | 'raw'; s: string };
type Word = Seg[];

interface Test {
  c: string;
  /** 'simple' commands can be combined freely; compound lists need braces. */
  kind: 'simple' | 'and' | 'or';
}

const dq = (s: string): Word => [{ k: 'dq', s }];
const bare = (s: string): Word => [{ k: 'bare', s }];

function render(w: Word): string {
  if (!w.length) return '""';
  if (w.length === 1 && w[0].k !== 'dq') return w[0].s;
  let out = '';
  let open = false;
  for (const seg of w) {
    if (seg.k === 'raw') {
      if (open) out += '"';
      open = false;
      out += seg.s;
    } else {
      if (!open) out += '"';
      open = true;
      out += seg.s;
    }
  }
  return out + (open ? '"' : '');
}

function escapeDq(s: string): string {
  return s.replace(/[\\"$`]/g, (m) => '\\' + m);
}

function literal(s: string): Word {
  if (s === '') return dq('');
  // Control characters need ANSI-C quoting.
  if (/[\x00-\x1f\x7f]/.test(s)) {
    const body = s.replace(/[\\']/g, (m) => '\\' + m).replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/[\x00-\x1f\x7f]/g, (m) => '\\x' + m.charCodeAt(0).toString(16).padStart(2, '0'));
    return [{ k: 'raw', s: `$'${body}'` }];
  }
  return dq(escapeDq(s));
}

type Kind = 'int' | 'float' | 'bool' | 'str' | 'list' | 'map';

function kindOf(t: TypeRef | undefined): Kind {
  switch (t?.k) {
    case 'int':
      return 'int';
    case 'float':
      return 'float';
    case 'bool':
      return 'bool';
    case 'list':
      return 'list';
    case 'map':
      return 'map';
    default:
      return 'str';
  }
}

const AWK_FMT = 'printf \\"%.15g\\", ';

export class BashGenerator extends ImperativeGenerator {
  readonly lang = 'bash' as const;
  protected readonly reservedWords = ['if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'select', 'while', 'until', 'do', 'done', 'in', 'function', 'time', 'coproc', 'local', 'declare', 'readonly', 'return', 'exit', 'echo', 'printf', 'read', 'test', 'true', 'false', 'unset', 'export', 'source', 'eval', 'exec', 'set', 'shift', 'trap', 'wait', 'cd', 'pwd', 'let', 'break', 'continue', 'main', 'awk', 'sed', 'tr', 'cat', 'curl', 'sleep', 'bash', 'sh', 'ls', 'rm', 'cp', 'mv', 'mkdir', 'grep', 'find', 'sort', 'head', 'tail', 'wc', 'date', 'kill', 'PATH', 'HOME', 'IFS', 'RANDOM', 'PWD', 'USER', 'SHELL', 'LINES', 'COLUMNS', 'SECONDS', 'UID', 'HOSTNAME', 'OSTYPE', 'REPLY', 'OPTARG', 'OPTIND', 'BASH', 'TERM', 'LANG', 'type', 'hash', 'help', 'history', 'jobs', 'fg', 'bg', 'alias', 'command', 'builtin', 'enable', 'getopts', 'umask', 'ulimit', 'times', 'dirs', 'pushd', 'popd'];
  protected override unicodeIdents = false;
  protected override indentUnit = '  ';
  protected override stmtEnd = '';
  protected override lineComment = '#';

  /** Lines that must run before the statement being built (function calls, input). */
  private pre: string[] = [];

  protected layout(): Emitter {
    this.pre = [];
    const body = this.em;
    for (const c of this.program.classes) this.unsupported(c.id, c.isStruct ? 'structs' : 'classes', 'Bash only has text, numbers and arrays.');
    for (const i of this.program.interfaces) this.unsupported(i.id, 'interfaces');
    for (const f of this.program.funcs) {
      this.emitFunc(f);
      body.blank();
    }
    this.emitMain();
    const out = this.newEmitter();
    out.line('#!/usr/bin/env bash');
    out.blank();
    this.writeHeader(out);
    out.append(body);
    return out;
  }

  protected override emitClass(_c: ClassDecl): void {}
  protected override emitInterface(_i: InterfaceDecl): void {}

  // ---------- helpers ----------

  private flush(): void {
    for (const l of this.pre) this.em.line(l);
    this.pre = [];
  }

  private get local(): string {
    return this.curFunc ? 'local ' : '';
  }

  private temp(prefix: string, value: string): string {
    const name = this.names.fresh(prefix);
    this.pre.push(`${this.local}${name}=${value}`);
    return name;
  }

  private bad(e: Expr, feature: string, detail = ''): Word {
    this.unsupported(e.id, feature, detail);
    return bare('0');
  }

  /** Name of a variable holding a list/dictionary, or undefined with a diagnostic. */
  private arrayName(e: Expr, what: string): string | undefined {
    if (e.k === 'var') return this.v(e.name);
    this.unsupported(e.id, what, 'In Bash the list or dictionary must be stored in a variable.');
    return undefined;
  }

  private awkValue(expr: string): Word {
    return [{ k: 'dq', s: `$(awk "BEGIN { ${AWK_FMT}${expr} }")` }];
  }

  private awkFn(args: Record<string, string>, program: string): Word {
    const vars = Object.entries(args).map(([k, v]) => `-v ${k}=${v}`).join(' ');
    return [{ k: 'dq', s: `$(awk ${vars} 'BEGIN { ${program} }')` }];
  }

  // ---------- expression forms ----------

  /** A shell word holding the value of the expression. */
  private word(e: Expr): Word {
    const kind = kindOf(e.t);
    switch (e.k) {
      case 'num':
        return bare(String(e.value));
      case 'str':
        return literal(e.value);
      case 'bool':
        return bare(e.value ? 'true' : 'false');
      case 'null':
      case 'missing':
        return dq('');
      case 'var':
        return dq(`\${${this.v(e.name)}}`);
      case 'bin':
        if (['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(e.op)) return this.boolWord(e);
        return kind === 'float' ? this.awkValue(this.awk(e)) : bare(`$(( ${this.arith(e)} ))`);
      case 'un':
        if (e.op === 'not') return this.boolWord(e);
        return kind === 'float' ? this.awkValue(this.awk(e)) : bare(`$(( ${this.arith(e)} ))`);
      case 'call':
        return this.callWord(e);
      case 'list':
        return [{ k: 'raw', s: `(${e.items.map((i) => render(this.word(i))).join(' ')})` }];
      case 'map':
        if (e.entries.length) return this.bad(e, 'dictionary literals with entries');
        return [{ k: 'raw', s: '()' }];
      case 'index': {
        if (e.target.t?.k === 'string') {
          const name = e.target.k === 'var' ? this.v(e.target.name) : this.temp('__s', render(this.word(e.target)));
          return dq(`\${${name}:${this.arith(e.index)}:1}`);
        }
        const name = this.arrayName(e.target, 'indexing a temporary list');
        return name ? dq(`\${${name}[${this.arith(e.index)}]}`) : bare('0');
      }
      case 'mapGet': {
        const name = this.arrayName(e.target, 'reading a temporary dictionary');
        return name ? dq(`\${${name}[${render(this.word(e.key))}]}`) : bare('0');
      }
      case 'mapHas':
      case 'fileExists':
        return this.boolWord(e);
      case 'len':
        return bare(this.lenExpr(e));
      case 'concat':
        return e.parts.flatMap((p) => this.word(p).map((seg): Seg => (seg.k === 'bare' ? { k: 'dq', s: seg.s } : seg)));
      case 'convert':
        return this.convertWord(e);
      case 'input': {
        this.pre.push(`printf '%s' ${e.prompt.k === 'missing' ? '""' : render(this.word(e.prompt))}`);
        const name = this.names.fresh('__in');
        if (this.curFunc) this.pre.push(`local ${name}`);
        this.pre.push(`IFS= read -r ${name} || true`);
        return dq(`\${${name}}`);
      }
      case 'math':
        return this.mathWord(e);
      case 'random': {
        const lo = this.arith(e.from);
        return bare(`$(( RANDOM % (${this.arith(e.to)} - (${lo}) + 1) + (${lo}) ))`);
      }
      case 'strOp': {
        if (e.op === 'contains') return this.boolWord(e);
        const src = render(this.word(e.args[0]));
        if (e.op === 'trim') return dq(`$(printf '%s' ${src} | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')`);
        const [from, to] = e.op === 'upper' ? ['[:lower:]', '[:upper:]'] : ['[:upper:]', '[:lower:]'];
        return dq(`$(printf '%s' ${src} | tr '${from}' '${to}')`);
      }
      case 'ternary':
        return dq(`$(if ${this.test(e.cond).c}; then printf '%s' ${render(this.word(e.a))}; else printf '%s' ${render(this.word(e.b))}; fi)`);
      case 'fileRead':
        return dq(`$(cat ${render(this.word(e.path))})`);
      case 'httpGet':
        this.notes.push('HTTP blocks call the curl command.');
        return dq(`$(curl -fsSL ${render(this.word(e.url))})`);
      case 'shell':
        return dq(`$(bash -c ${render(this.word(e.cmd))})`);
      case 'await':
        return this.word(e.e);
      case 'funcRef':
        return bare(this.fn(e.name));
      case 'callRef': {
        this.pre.push(`${render(this.word(e.fn))} ${e.args.map((a) => render(this.word(a))).join(' ')}`.trim());
        return dq(`\${${this.temp('__r', '"$__ret"')}}`);
      }
      case 'raw':
        if (e.lang !== 'bash') {
          this.report('error', 'gen.rawExprMismatch', `A raw ${e.lang} expression cannot be used when the target is Bash.`, e.id, { from: e.lang });
          return bare('0');
        }
        return [{ k: 'raw', s: e.code }];
      case 'jsonParse':
      case 'jsonStringify':
        return this.bad(e, 'JSON', 'Use a tool such as jq through a shell command block.');
      case 'field':
      case 'new':
      case 'method':
      case 'this':
        return this.bad(e, 'objects', 'Bash only has text, numbers and arrays.');
      case 'addrOf':
      case 'deref':
      case 'alloc':
        return this.bad(e, 'pointers');
      case 'domGet':
        return this.bad(e, 'web page scripting');
    }
  }

  private callWord(e: E<'call'>): Word {
    const args = e.args.map((a) => {
      if (a.t?.k === 'list' || a.t?.k === 'map') this.unsupported(a.id, 'passing lists or dictionaries to functions', 'Bash function arguments are plain text.');
      return render(this.word(a));
    });
    this.pre.push([this.fn(e.name), ...args].join(' '));
    return dq(`\${${this.temp('__r', '"$__ret"')}}`);
  }

  private boolWord(e: Expr): Word {
    return dq(`$(if ${this.test(e).c}; then echo true; else echo false; fi)`);
  }

  private lenExpr(e: E<'len'>): string {
    const k = kindOf(e.target.t);
    if (k === 'list' || k === 'map') {
      const name = this.arrayName(e.target, 'measuring a temporary list');
      return name ? `\${#${name}[@]}` : '0';
    }
    const name = e.target.k === 'var' ? this.v(e.target.name) : this.temp('__s', render(this.word(e.target)));
    return `\${#${name}}`;
  }

  private convertWord(e: E<'convert'>): Word {
    const src = render(this.word(e.e));
    switch (e.to) {
      case 'int':
        return kindOf(e.e.t) === 'int' ? this.word(e.e) : this.awkFn({ v: src }, 'printf "%d", v');
      case 'float':
        return this.awkFn({ v: src }, 'printf "%.15g", v');
      case 'string':
        return this.word(e.e).map((seg): Seg => (seg.k === 'bare' ? { k: 'dq', s: seg.s } : seg));
      case 'bool':
        if (kindOf(e.e.t) === 'bool') return this.word(e.e);
        return dq(`$(if [[ -n ${src} && ${src} != 0 && ${src} != false ]]; then echo true; else echo false; fi)`);
    }
  }

  private mathWord(e: E<'math'>): Word {
    const isFloat = e.args.some((a) => kindOf(a.t) === 'float') || kindOf(e.t) === 'float';
    const a0 = e.args[0];
    switch (e.fn) {
      case 'floor':
        return this.awkFn({ v: render(this.word(a0)) }, 'f = int(v); if (f > v) f--; printf "%d", f');
      case 'ceil':
        return this.awkFn({ v: render(this.word(a0)) }, 'c = int(v); if (c < v) c++; printf "%d", c');
      case 'round':
        return this.awkFn({ v: render(this.word(a0)) }, 'printf "%d", (v < 0) ? int(v - 0.5) : int(v + 0.5)');
      case 'abs':
      case 'min':
      case 'max':
        if (!isFloat) return bare(`$(( ${this.arith(e)} ))`);
        return this.awkValue(this.awk(e));
      default:
        return this.awkValue(this.awk(e));
    }
  }

  /** Code for use inside $(( )). Only meaningful for whole numbers. */
  private arith(e: Expr, min = 0): string {
    const wrap = (code: string, p: number) => (p < min ? `(${code})` : code);
    switch (e.k) {
      case 'num':
        return e.value < 0 ? `(${e.value})` : String(Math.trunc(e.value));
      case 'var':
        return this.v(e.name);
      case 'bin': {
        const prec: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 8 };
        const p = prec[e.op];
        return wrap(`${this.arith(e.l, p)} ${e.op} ${this.arith(e.r, p + 1)}`, p);
      }
      case 'un':
        return e.op === 'neg' ? `-${this.arith(e.e, 7)}` : `!${this.arith(e.e, 7)}`;
      case 'index': {
        const name = e.target.k === 'var' ? this.v(e.target.name) : undefined;
        if (name && e.target.t?.k === 'list') return `${name}[${this.arith(e.index)}]`;
        break;
      }
      case 'len':
        return this.lenExpr(e);
      case 'math':
        if (e.fn === 'abs') {
          const a = this.arith(e.args[0], 9);
          return `(${a} < 0 ? -${a} : ${a})`;
        }
        if (e.fn === 'min' || e.fn === 'max') {
          const a = this.arith(e.args[0], 9);
          const b = this.arith(e.args[1], 9);
          return `(${a} ${e.fn === 'min' ? '<' : '>'} ${b} ? ${a} : ${b})`;
        }
        break;
      default:
        break;
    }
    // Anything else is evaluated as a word first.
    const w = render(this.word(e));
    const m = /^"\$\{(\w+)\}"$/.exec(w);
    return m ? m[1] : w.replace(/^"(.*)"$/s, '$1');
  }

  /** Code for use inside an awk program that is wrapped in double quotes. */
  private awk(e: Expr, min = 0): string {
    const wrap = (code: string, p: number) => (p < min ? `(${code})` : code);
    switch (e.k) {
      case 'num':
        return e.value < 0 ? `(${e.value})` : String(e.value);
      case 'var':
        return `\${${this.v(e.name)}}`;
      case 'bin': {
        const prec: Record<string, number> = { '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 8 };
        const p = prec[e.op];
        if (p === undefined) break;
        return wrap(`${this.awk(e.l, p)} ${e.op === '**' ? '^' : e.op} ${this.awk(e.r, p + 1)}`, p);
      }
      case 'un':
        if (e.op === 'neg') return `-(${this.awk(e.e)})`;
        break;
      case 'math': {
        const a = this.awk(e.args[0]);
        switch (e.fn) {
          case 'sqrt':
          case 'exp':
          case 'sin':
          case 'cos':
            return `${e.fn}(${a})`;
          case 'ln':
            return `log(${a})`;
          case 'log10':
            return `(log(${a}) / log(10))`;
          case 'tan':
            return `(sin(${a}) / cos(${a}))`;
          case 'pow10':
            return `(10 ^ (${a}))`;
          case 'abs':
            return `((${a}) < 0 ? -(${a}) : (${a}))`;
          case 'min':
          case 'max': {
            const b = this.awk(e.args[1]);
            return `((${a}) ${e.fn === 'min' ? '<' : '>'} (${b}) ? (${a}) : (${b}))`;
          }
          default:
            break;
        }
        break;
      }
      default:
        break;
    }
    const w = render(this.word(e));
    return w.replace(/^"(.*)"$/s, '$1');
  }

  /** A command whose exit status is the truth of the expression. */
  private test(e: Expr): Test {
    const simple = (c: string): Test => ({ c, kind: 'simple' });
    const group = (t: Test) => (t.kind === 'simple' ? t.c : `{ ${t.c}; }`);
    switch (e.k) {
      case 'bool':
        return simple(e.value ? 'true' : 'false');
      case 'bin': {
        if (e.op === '&&' || e.op === '||') {
          const kind = e.op === '&&' ? 'and' : 'or';
          const l = this.test(e.l);
          const r = this.test(e.r);
          // && and || have equal precedence in the shell, so mixed chains are braced.
          const left = l.kind === 'simple' || l.kind === kind ? l.c : `{ ${l.c}; }`;
          return { c: `${left} ${e.op} ${group(r)}`, kind };
        }
        if (['==', '!=', '<', '<=', '>', '>='].includes(e.op)) {
          const lk = kindOf(e.l.t);
          const rk = kindOf(e.r.t);
          if (lk === 'int' && rk === 'int') return simple(`(( ${this.arith(e.l, 4)} ${e.op} ${this.arith(e.r, 5)} ))`);
          if ((lk === 'int' || lk === 'float') && (rk === 'int' || rk === 'float')) return simple(`awk "BEGIN { exit !(${this.awk(e.l, 5)} ${e.op} ${this.awk(e.r, 5)}) }"`);
          const a = render(this.word(e.l));
          const b = render(this.word(e.r));
          if (e.op === '<=' ) return simple(`[[ ! ${a} > ${b} ]]`);
          if (e.op === '>=') return simple(`[[ ! ${a} < ${b} ]]`);
          return simple(`[[ ${a} ${e.op} ${b} ]]`);
        }
        break;
      }
      case 'un':
        if (e.op === 'not') return simple(`! ${group(this.test(e.e))}`);
        break;
      case 'mapHas': {
        const name = this.arrayName(e.target, 'checking a temporary dictionary');
        return simple(name ? `[[ -n "\${${name}[${render(this.word(e.key))}]+set}" ]]` : 'false');
      }
      case 'strOp':
        if (e.op === 'contains') return simple(`[[ ${render(this.word(e.args[0]))} == *${render(this.word(e.args[1]))}* ]]`);
        break;
      case 'fileExists':
        return simple(`[[ -e ${render(this.word(e.path))} ]]`);
      default:
        break;
    }
    return simple(`[[ ${render(this.word(e))} == true ]]`);
  }

  // ---------- statements ----------

  protected override stmt(s: Stmt): void {
    const start = this.em.count;
    this.emit(s);
    this.flush();
    this.em.mark(s.id, start);
  }

  private line(text: string): void {
    this.flush();
    this.em.line(text);
  }

  private assign(s: Stmt, name: string, value: Expr | undefined): void {
    const info = this.info(name);
    const id = this.v(name);
    const declare = !!info && this.declaredAt(s, name);
    const kind = kindOf(info?.type);
    const local = this.curFunc && declare;
    if (kind === 'map') {
      this.warnOnce('assoc', 'gen.bash4', 'Dictionaries use associative arrays, which need Bash 4 or newer. The Bash that ships with macOS is version 3.2.', s.id, undefined, 'info');
      if (value && value.k !== 'map') {
        this.unsupportedStmt(s, 'copying dictionaries');
        return;
      }
      this.line(`${local ? 'local' : 'declare'} -A ${id}=()`);
      return;
    }
    if (kind === 'list') {
      const src = value?.k === 'list' ? render(this.word(value)) : value?.k === 'var' ? `("\${${this.v(value.name)}[@]}")` : '()';
      if (value && value.k !== 'list' && value.k !== 'var') this.unsupported(s.id, 'lists produced by expressions', 'Create the list with a list block or copy it from a variable.');
      this.line(`${local ? 'local ' : ''}${id}=${src}`);
      return;
    }
    const w = value ? render(this.word(value)) : kind === 'str' ? '""' : kind === 'bool' ? 'false' : '0';
    const prefix = info?.isConst && declare ? (this.curFunc ? 'local -r ' : 'readonly ') : local ? 'local ' : '';
    this.line(`${prefix}${id}=${w}`);
  }

  private block(body: Stmt[]): void {
    this.em.indent();
    const start = this.em.count;
    for (const s of body) this.stmt(s);
    if (this.em.count === start) this.em.line(':');
    this.em.dedent();
  }

  private emit(s: Stmt): void {
    switch (s.k) {
      case 'varDecl':
        this.assign(s, s.name, s.init);
        break;
      case 'assign':
        this.assign(s, s.name, s.value);
        break;
      case 'print': {
        const k = kindOf(s.value.t);
        if (k === 'list' && s.value.k === 'var') this.line(`echo "\${${this.v(s.value.name)}[@]}"`);
        else this.line(`echo ${render(this.word(s.value))}`);
        break;
      }
      case 'if': {
        let extra = 0;
        s.branches.forEach((b, i) => {
          const t = this.test(b.cond);
          if (i === 0) this.line(`if ${t.c}; then`);
          else if (this.pre.length) {
            // The condition needs statements of its own, so it becomes a nested if.
            this.em.line('else');
            this.em.indent();
            extra++;
            this.line(`if ${t.c}; then`);
          } else this.em.line(`elif ${t.c}; then`);
          this.block(b.body);
        });
        if (s.else && s.else.length) {
          this.em.line('else');
          this.block(s.else);
        }
        this.em.line('fi');
        for (; extra > 0; extra--) {
          this.em.dedent();
          this.em.line('fi');
        }
        break;
      }
      case 'while': {
        const saved = this.pre;
        this.pre = [];
        const t = this.test(s.cond);
        const condPre = this.pre;
        this.pre = saved;
        if (!condPre.length) {
          this.line(`while ${t.c}; do`);
          this.block(s.body);
        } else {
          this.line('while true; do');
          this.em.indent();
          for (const l of condPre) this.em.line(l);
          this.em.line(`${t.kind === 'simple' ? t.c : `{ ${t.c}; }`} || break`);
          this.em.dedent();
          this.block(s.body);
        }
        this.em.line('done');
        break;
      }
      case 'repeat': {
        const i = this.names.fresh('i');
        const count = this.arith(s.count);
        if (this.curFunc) this.pre.push(`local ${i}`);
        this.line(`for ((${i} = 0; ${i} < ${count}; ${i}++)); do`);
        this.block(s.body);
        this.em.line('done');
        break;
      }
      case 'forRange': {
        const r = this.rangeInfo(s);
        if (r.type.k !== 'int') {
          this.unsupportedStmt(s, 'counting loops over decimal numbers', 'Bash arithmetic only handles whole numbers.');
          break;
        }
        const from = this.arith(s.from);
        const to = this.arith(s.to);
        const step = r.stepIsOne ? `${r.v}${r.desc ? '--' : '++'}` : `${r.v} ${r.desc ? '-=' : '+='} ${r.step}`;
        if (this.curFunc && r.declare) this.pre.push(`local ${r.v}`);
        this.line(`for ((${r.v} = ${from}; ${r.v} ${r.desc ? '>=' : '<='} ${to}; ${step})); do`);
        this.block(s.body);
        this.em.line('done');
        break;
      }
      case 'forEach': {
        const name = this.arrayName(s.iterable, 'looping over a temporary list');
        const v = this.v(s.var);
        if (this.curFunc && this.info(s.var)?.decl === 'loop') this.pre.push(`local ${v}`);
        this.line(`for ${v} in "\${${name ?? 'empty'}[@]}"; do`);
        this.block(s.body);
        this.em.line('done');
        break;
      }
      case 'break':
        this.line('break');
        break;
      case 'continue':
        this.line('continue');
        break;
      case 'return':
        if (s.value) {
          const w = render(this.word(s.value));
          this.line(`__ret=${w}`);
        }
        this.line('return 0');
        break;
      case 'exprStmt':
        if (s.e.k === 'call') {
          const args = s.e.args.map((a) => render(this.word(a)));
          this.line([this.fn(s.e.name), ...args].join(' '));
        } else if (s.e.k === 'callRef') {
          const fn = render(this.word(s.e.fn));
          this.line([fn, ...s.e.args.map((a) => render(this.word(a)))].join(' '));
        } else this.unsupportedStmt(s, 'this statement');
        break;
      case 'listAppend': {
        const name = this.arrayName(s.list, 'adding to a temporary list');
        if (name) this.line(`${name}+=(${render(this.word(s.value))})`);
        break;
      }
      case 'listSet': {
        const name = this.arrayName(s.list, 'changing a temporary list');
        if (name) this.line(`${name}[${this.arith(s.index)}]=${render(this.word(s.value))}`);
        break;
      }
      case 'listRemove': {
        const name = this.arrayName(s.list, 'removing from a temporary list');
        if (!name) break;
        this.line(`unset "${name}[$(( ${this.arith(s.index)} ))]"`);
        this.em.line(`${name}=("\${${name}[@]}")`);
        break;
      }
      case 'mapSet': {
        const name = this.arrayName(s.map, 'changing a temporary dictionary');
        if (name) this.line(`${name}[${render(this.word(s.key))}]=${render(this.word(s.value))}`);
        break;
      }
      case 'mapDelete': {
        const name = this.arrayName(s.map, 'changing a temporary dictionary');
        if (!name) break;
        const key = this.word(s.key).map((seg) => seg.s).join('');
        this.line(`unset "${name}[${key}]"`);
        break;
      }
      case 'try':
        this.unsupportedStmt(s, 'try/catch error handling', 'Bash reports errors through exit codes.');
        break;
      case 'throw':
        this.line(`echo ${render(this.word(s.message))} >&2`);
        this.em.line('exit 1');
        break;
      case 'comment':
        if (this.opts.comments !== false) for (const l of s.text.split('\n')) this.em.line(`# ${l}`.trimEnd());
        break;
      case 'import':
        if (s.module) this.line(`source ${render(literal(s.module))}`);
        break;
      case 'fileWrite':
        this.line(`printf '%s' ${render(this.word(s.content))} ${s.append ? '>>' : '>'} ${render(this.word(s.path))}`);
        break;
      case 'sleep':
        this.line(`sleep "$(awk -v ms=${render(this.word(s.ms))} 'BEGIN { printf "%.3f", ms / 1000 }')"`);
        break;
      case 'shellRun':
        this.line(`bash -c ${render(this.word(s.cmd))}`);
        break;
      case 'rawStmt':
        this.sRawStmt(s);
        break;
      case 'fieldSet':
        this.unsupportedStmt(s, 'objects', 'Bash only has text, numbers and arrays.');
        break;
      case 'derefSet':
      case 'free':
        this.unsupportedStmt(s, 'pointers');
        break;
      case 'domSet':
      case 'domOn':
        this.unsupportedStmt(s, 'web page scripting', 'Page blocks only work with JavaScript, TypeScript and HTML.');
        break;
    }
  }

  // ---------- functions ----------

  protected funcOpen(f: FuncDecl): string {
    return `${this.fn(f.name)}() {`;
  }

  protected override emitFunc(f: FuncDecl): void {
    const fi = this.an.funcs.get(f.name);
    if (!fi) return;
    const saved = { scope: this.scope, func: this.curFunc };
    this.scope = fi.scope;
    this.curFunc = f;
    const start = this.em.count;
    this.em.line(this.funcOpen(f));
    this.em.indent();
    f.params.forEach((p, i) => this.em.line(`local ${this.v(p.name)}="$${i + 1}"`));
    for (const name of fi.scope.hoisted) this.em.line(`local ${this.v(name)}`);
    const bodyStart = this.em.count;
    for (const s of f.body) this.stmt(s);
    if (this.em.count === bodyStart && !f.params.length) this.em.line(':');
    this.em.dedent();
    this.em.line('}');
    this.em.mark(f.id, start);
    this.scope = saved.scope;
    this.curFunc = saved.func;
  }

  protected override hoist(): void {}

  // ---------- unused abstract members (Bash builds statements itself) ----------

  protected sPrint(_s: S<'print'>): void {}
  protected repeatOpen(): string {
    return '';
  }
  protected forRangeOpen(_r: RangeInfo): string {
    return '';
  }
  protected forEachOpen(): string {
    return '';
  }
  protected eLen(_e: E<'len'>): X {
    return { c: '', p: 0 };
  }
  protected eConcat(_e: E<'concat'>): X {
    return { c: '', p: 0 };
  }
  protected eConvert(_e: E<'convert'>): X {
    return { c: '', p: 0 };
  }
  protected eInput(_e: E<'input'>): X {
    return { c: '', p: 0 };
  }
  protected eMath(_e: E<'math'>): X {
    return { c: '', p: 0 };
  }
  protected eRandom(_e: E<'random'>): X {
    return { c: '', p: 0 };
  }
  protected eStrOp(_e: E<'strOp'>): X {
    return { c: '', p: 0 };
  }

  /** Used by the shared range helper. */
  protected override valueFor(e: Expr): string {
    return kindOf(e.t) === 'int' ? this.arith(e) : render(this.word(e));
  }
}

export default new BashGenerator();
