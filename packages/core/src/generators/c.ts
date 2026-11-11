import type { ScopeInfo, VarInfo } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, T, type TypeRef } from '../ir/types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import { type Emitter, quote } from './emitter';

const LIST_NAMES: Record<string, string> = { int: 'IntList', float: 'DoubleList', string: 'StrList', bool: 'BoolList' };

export class CGenerator extends ImperativeGenerator {
  readonly lang = 'c' as const;
  protected readonly reservedWords = ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', 'bool', 'true', 'false', 'main', 'printf', 'puts', 'malloc', 'free', 'exit', 'abs', 'pow', 'sqrt', 'floor', 'ceil', 'round', 'log', 'exp', 'sin', 'cos', 'tan', 'rand', 'time', 'strlen', 'strcmp', 'strstr', 'system', 'NULL', 'FILE', 'stdin', 'stdout', 'stderr', 'remove', 'rename', 'index', 'read', 'write', 'open', 'close', 'link', 'signal', 'y0', 'y1', 'yn', 'j0', 'j1', 'jn', 'div', 'count', 'total_', 'getline', 'pipe', 'sleep', 'select', 'abort', 'string'];
  protected override staticTypes = true;
  private includes = new Set<string>();

  private inc(h: string): void {
    this.includes.add(h);
  }

  protected layout(): Emitter {
    this.includes = new Set(['stdio.h']);
    const body = this.em;
    for (const c of this.program.classes) {
      const start = body.count;
      this.emitClass(c);
      body.mark(c.id, start);
      body.blank();
    }
    for (const i of this.program.interfaces) this.unsupported(i.id, 'interfaces');
    this.globalsDecl();
    // Prototypes let functions call each other in any order.
    for (const f of this.program.funcs) body.line(`${this.signature(f)};`);
    if (this.program.funcs.length) body.blank();
    for (const f of this.program.funcs) {
      this.emitFunc(f);
      body.blank();
    }
    body.line('int main(void) {');
    body.indent();
    this.emitMain();
    body.line('return 0;');
    body.dedent();
    body.line('}');
    const out = this.newEmitter();
    for (const h of [...this.includes].sort()) out.line(`#include <${h}>`);
    for (const i of [...this.imports].sort()) out.line(i);
    out.blank();
    for (const lines of this.helpers.values()) {
      out.block(lines);
      out.blank();
    }
    out.append(body);
    return out;
  }

  protected override importLine(module: string): string {
    return `#include <${module}>`;
  }

  // ----- types -----

  private listName(of: TypeRef, id?: string): string {
    const name = LIST_NAMES[of.k];
    if (!name) {
      this.unsupported(id, 'lists of this item type', 'Lists in C can hold integers, decimals, text or true/false values.');
      return 'IntList';
    }
    const ctype = this.typeName(of);
    this.inc('stdlib.h');
    this.helper(name, [
      `typedef struct {`,
      `    ${ctype} *items;`,
      `    int count;`,
      `    int capacity;`,
      `} ${name};`,
      ``,
      `static void ${name}_push(${name} *list, ${ctype} value) {`,
      `    if (list->count == list->capacity) {`,
      `        list->capacity = list->capacity ? list->capacity * 2 : 8;`,
      `        list->items = realloc(list->items, sizeof(${ctype}) * (size_t)list->capacity);`,
      `    }`,
      `    list->items[list->count++] = value;`,
      `}`,
      ``,
      `static ${name} ${name}_from(const ${ctype.replace(/^const /, '')}${ctype.endsWith('*') ? '' : ' '}*values, int count) {`,
      `    ${name} list = {NULL, 0, 0};`,
      `    for (int i = 0; i < count; i++) ${name}_push(&list, values[i]);`,
      `    return list;`,
      `}`,
      ``,
      `static void ${name}_remove(${name} *list, int index) {`,
      `    for (int i = index; i < list->count - 1; i++) list->items[i] = list->items[i + 1];`,
      `    if (index >= 0 && index < list->count) list->count--;`,
      `}`,
    ]);
    return name;
  }

  protected override typeName(t: TypeRef, id?: string): string {
    switch (t.k) {
      case 'int':
        return 'int';
      case 'float':
        return 'double';
      case 'string':
        return 'const char *';
      case 'bool':
        this.inc('stdbool.h');
        return 'bool';
      case 'void':
        return 'void';
      case 'list':
        return this.listName(t.of, id);
      case 'struct':
        return this.typeId(t.name);
      case 'ptr':
        return `${this.typeName(t.to, id)} *`;
      case 'map':
        this.unsupported(id, 'dictionaries', 'C has no built-in dictionary type.');
        return 'int';
      case 'func':
        this.unsupported(id, 'function values', 'Function pointers need an explicit signature.');
        return 'int';
      case 'any':
        return this.mixed(id);
      default:
        return 'int';
    }
  }

  /** "int x" / "const char *x": C binds the pointer star to the name. */
  private decl(t: TypeRef, name: string, id?: string): string {
    const tn = this.typeName(t, id);
    return tn.endsWith('*') ? `${tn}${name}` : `${tn} ${name}`;
  }

  protected override zero(t: TypeRef): string {
    switch (t.k) {
      case 'float':
        return '0.0';
      case 'string':
        return '""';
      case 'bool':
        this.inc('stdbool.h');
        return 'false';
      case 'list':
        return `${this.listName(t.of)}_from(NULL, 0)`;
      case 'struct':
        return `(${this.typeId(t.name)}){0}`;
      case 'ptr':
        return 'NULL';
      default:
        return '0';
    }
  }

  protected override nullLiteral(): string {
    return 'NULL';
  }

  protected override boolLiteral(v: boolean): string {
    this.inc('stdbool.h');
    return v ? 'true' : 'false';
  }

  protected override str(s: string): string {
    return quote(s, { control: 'octal' });
  }

  // ----- declarations -----

  protected override declare(name: string, info: VarInfo, init: string): void {
    const t = this.varType(info);
    const isConst = info.isConst && t.k !== 'string';
    this.em.line(`${isConst ? 'const ' : ''}${this.decl(t, this.v(name), info.declNode?.id)} = ${init};`);
  }

  protected override globalsDecl(): void {
    for (const info of this.an.globals.values()) {
      const t = this.varType(info);
      const init = t.k === 'list' ? '{NULL, 0, 0}' : t.k === 'struct' ? '{0}' : this.zero(t);
      this.em.line(`${this.decl(t, this.v(info.name))} = ${init};`);
    }
    if (this.an.globals.size) this.em.blank();
  }

  private signature(f: FuncDecl): string {
    const params = f.params.map((p) => this.decl(this.paramType(p, f), this.v(p.name), f.id)).join(', ') || 'void';
    return `${this.decl(f.ret, this.fn(f.name), f.id)}(${params})`;
  }

  protected funcOpen(f: FuncDecl): string {
    return `${this.signature(f)} {`;
  }

  protected override funcPrologue(_f: FuncDecl, _scope: ScopeInfo): void {}

  protected override emitClass(c: ClassDecl): void {
    if (!c.isStruct) {
      this.unsupported(c.id, 'classes', 'Use a struct block and plain functions instead.');
      return;
    }
    this.em.line('typedef struct {');
    this.em.indent();
    for (const f of c.fields) this.em.line(`${this.decl(f.type, this.member(f.name), f.id)};`);
    this.em.dedent();
    this.em.line(`} ${this.typeId(c.name)};`);
  }

  // ----- statements -----

  private fmtSpec(t: TypeRef | undefined): string {
    switch (t?.k) {
      case 'float':
        return '%.15g';
      case 'string':
      case 'bool':
        return '%s';
      default:
        return '%d';
    }
  }

  private fmtArg(e: Expr): string {
    const x = this.ex(e);
    return e.t?.k === 'bool' ? `${paren(x, P.TERN + 1)} ? "true" : "false"` : x.c;
  }

  /** Build a printf style format string and argument list from parts. */
  private format(parts: Expr[], suffix = ''): { fmt: string; args: string[] } {
    let fmt = '';
    const args: string[] = [];
    for (const p of parts) {
      if (p.k === 'str') fmt += p.value.replace(/%/g, '%%');
      else {
        if (p.t?.k === 'list' || p.t?.k === 'map' || p.t?.k === 'struct') this.unsupported(p.id, 'turning this value into text');
        fmt += this.fmtSpec(p.t);
        args.push(this.fmtArg(p));
      }
    }
    return { fmt: fmt + suffix, args };
  }

  protected sPrint(s: S<'print'>): void {
    const parts = s.value.k === 'concat' ? s.value.parts : [s.value];
    if (parts.length === 1 && parts[0].t?.k === 'list') {
      const of = (parts[0].t as { of: TypeRef }).of;
      const list = this.ex(parts[0]).c;
      this.em.line('printf("[");');
      this.em.line(`for (int i = 0; i < ${list}.count; i++) printf(i ? ", ${this.fmtSpec(of)}" : "${this.fmtSpec(of)}", ${of.k === 'bool' ? `${list}.items[i] ? "true" : "false"` : `${list}.items[i]`});`);
      this.em.line('printf("]\\n");');
      return;
    }
    const { fmt, args } = this.format(parts, '\n');
    this.em.line(`printf(${[this.str(fmt), ...args].join(', ')});`);
  }

  protected repeatOpen(count: string, counter: string): string {
    return `for (int ${counter} = 0; ${counter} < ${count}; ${counter}++) {`;
  }

  protected forRangeOpen(r: RangeInfo): string {
    const step = r.stepIsOne ? `${r.v}${r.desc ? '--' : '++'}` : `${r.v} ${r.desc ? '-=' : '+='} ${r.step}`;
    return `for (${r.declare ? this.typeName(r.type) + ' ' : ''}${r.v} = ${r.from}; ${r.v} ${r.desc ? '>=' : '<='} ${r.to}; ${step}) {`;
  }

  protected forEachOpen(v: string, iter: string, s: S<'forEach'>, declare: boolean): [string, string] {
    const i = this.names.fresh('index');
    const of = this.elemType(s.iterable) ?? T.int;
    if (s.iterable.t?.k !== 'list') this.unsupported(s.id, 'looping over this value', 'Only lists can be looped over in C.');
    return [`for (int ${i} = 0; ${i} < ${iter}.count; ${i}++) {`, `${declare ? this.decl(of, v) : v} = ${iter}.items[${i}];`];
  }

  private lvalue(e: Expr, what: string): string | undefined {
    if (e.k === 'var' || e.k === 'field') return this.ex(e).c;
    this.unsupported(e.id, what, 'The list must be stored in a variable first.');
    return undefined;
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    const target = this.lvalue(s.list, 'adding to a temporary list');
    if (!target) return;
    const of = this.elemType(s.list) ?? s.value.t ?? T.int;
    this.em.line(`${this.listName(of, s.id)}_push(&${target}, ${this.valueFor(s.value, of)});`);
  }

  protected override sListSet(s: S<'listSet'>): void {
    const target = paren(this.ex(s.list), P.POST);
    const idx = this.valueFor(s.index, T.int);
    this.em.line(`${target}${s.list.t?.k === 'ptr' ? '' : '.items'}[${idx}] = ${this.valueFor(s.value, this.elemType(s.list))};`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    const target = this.lvalue(s.list, 'removing from a temporary list');
    if (!target) return;
    this.em.line(`${this.listName(this.elemType(s.list) ?? T.int, s.id)}_remove(&${target}, ${this.valueFor(s.index, T.int)});`);
  }

  protected override sMapSet(s: S<'mapSet'>): void {
    this.unsupportedStmt(s, 'dictionaries', 'C has no built-in dictionary type.');
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.unsupportedStmt(s, 'dictionaries', 'C has no built-in dictionary type.');
  }

  protected override sTry(s: S<'try'>): void {
    this.unsupportedStmt(s, 'exception handling', 'C reports errors through return values.');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.inc('stdlib.h');
    this.em.line(`fprintf(stderr, "%s\\n", ${this.ex(s.message).c});`);
    this.em.line('exit(1);');
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    const f = this.names.fresh('file');
    const { fmt, args } = this.format(s.content.k === 'concat' ? s.content.parts : [s.content]);
    this.em.line(`FILE *${f} = fopen(${this.ex(s.path).c}, "${s.append ? 'a' : 'w'}");`);
    this.em.line(`if (${f}) {`);
    this.em.indent();
    this.em.line(`fprintf(${[f, this.str(fmt), ...args].join(', ')});`);
    this.em.line(`fclose(${f});`);
    this.em.dedent();
    this.em.line('}');
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.inc('time.h');
    this.helper('bf_sleep', [
      'static void bf_sleep(double milliseconds) {',
      '    struct timespec wait;',
      '    wait.tv_sec = (time_t)(milliseconds / 1000);',
      '    wait.tv_nsec = (long)((milliseconds - (double)wait.tv_sec * 1000) * 1000000);',
      '    nanosleep(&wait, NULL);',
      '}',
    ]);
    this.em.line(`bf_sleep(${this.ex(s.ms).c});`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.inc('stdlib.h');
    this.em.line(`system(${this.ex(s.cmd).c});`);
  }

  protected override sDerefSet(s: S<'derefSet'>): void {
    const to = s.ptr.t?.k === 'ptr' ? s.ptr.t.to : undefined;
    this.em.line(`*${paren(this.ex(s.ptr), P.UNARY)} = ${this.valueFor(s.value, to)};`);
  }

  protected override sFree(s: S<'free'>): void {
    this.inc('stdlib.h');
    this.em.line(`free(${this.v(s.name)});`);
  }

  // ----- expressions -----

  protected override toFloat(x: X): X {
    return { c: `(double)${paren(x, P.UNARY)}`, p: P.UNARY };
  }

  protected override ePow(e: E<'bin'>): X {
    this.inc('math.h');
    return post(`pow(${this.ex(e.l).c}, ${this.ex(e.r).c})`);
  }

  private isStr(e: Expr): boolean {
    return e.t?.k === 'string';
  }

  protected override eEquality(e: E<'bin'>): X {
    if (this.isStr(e.l) || this.isStr(e.r)) {
      this.inc('string.h');
      return { c: `strcmp(${this.ex(e.l).c}, ${this.ex(e.r).c}) ${e.op} 0`, p: P.CMP };
    }
    return super.eEquality(e);
  }

  protected override eCompare(e: E<'bin'>): X {
    if (this.isStr(e.l) || this.isStr(e.r)) {
      this.inc('string.h');
      return { c: `strcmp(${this.ex(e.l).c}, ${this.ex(e.r).c}) ${e.op} 0`, p: P.CMP };
    }
    return super.eCompare(e);
  }

  protected override eBin(e: E<'bin'>): X {
    if (e.op === '%' && e.t?.k === 'float') {
      this.inc('math.h');
      return post(`fmod(${this.ex(e.l).c}, ${this.ex(e.r).c})`);
    }
    return super.eBin(e);
  }

  protected override eList(e: E<'list'>): X {
    const of = this.settle(e.t ?? T.list(T.int), 'list', e.id);
    const item = of.k === 'list' ? of.of : T.int;
    const name = this.listName(item, e.id);
    if (!e.items.length) return post(`${name}_from(NULL, 0)`);
    const ctype = this.typeName(item);
    return post(`${name}_from((${ctype.endsWith('*') ? ctype : ctype + ' '}[]){${e.items.map((i) => this.valueFor(i, item)).join(', ')}}, ${e.items.length})`);
  }

  protected override eMap(e: E<'map'>): X {
    return this.unsupportedExpr(e, 'dictionaries', 'C has no built-in dictionary type.');
  }

  protected override eMapGet(e: E<'mapGet'>): X {
    return this.unsupportedExpr(e, 'dictionaries', 'C has no built-in dictionary type.');
  }

  protected override eIndex(e: E<'index'>): X {
    const target = paren(this.ex(e.target), P.POST);
    const idx = this.valueFor(e.index, T.int);
    if (e.target.t?.k === 'string') return this.unsupportedExpr(e, 'taking one character of text');
    return post(`${target}${e.target.t?.k === 'ptr' ? '' : '.items'}[${idx}]`);
  }

  protected eLen(e: E<'len'>): X {
    if (e.target.t?.k === 'string') {
      this.inc('string.h');
      return { c: `(int)strlen(${this.ex(e.target).c})`, p: P.UNARY };
    }
    return post(`${paren(this.ex(e.target), P.POST)}.count`);
  }

  private bfFormat(): void {
    this.inc('stdarg.h');
    this.inc('stdlib.h');
    this.helper('bf_format', [
      '/* Builds a new text value from a printf style format. */',
      'static char *bf_format(const char *format, ...) {',
      '    va_list args;',
      '    va_list copy;',
      '    va_start(args, format);',
      '    va_copy(copy, args);',
      '    int size = vsnprintf(NULL, 0, format, copy);',
      '    va_end(copy);',
      '    char *text = malloc((size_t)size + 1);',
      '    vsnprintf(text, (size_t)size + 1, format, args);',
      '    va_end(args);',
      '    return text;',
      '}',
    ]);
  }

  protected eConcat(e: E<'concat'>): X {
    this.bfFormat();
    const { fmt, args } = this.format(e.parts);
    return post(`bf_format(${[this.str(fmt), ...args].join(', ')})`);
  }

  protected eConvert(e: E<'convert'>): X {
    const from = e.e.t?.k;
    const x = this.ex(e.e);
    switch (e.to) {
      case 'int':
        if (from === 'string') {
          this.inc('stdlib.h');
          return post(`atoi(${x.c})`);
        }
        return { c: `(int)${paren(x, P.UNARY)}`, p: P.UNARY };
      case 'float':
        if (from === 'string') {
          this.inc('stdlib.h');
          return post(`atof(${x.c})`);
        }
        return { c: `(double)${paren(x, P.UNARY)}`, p: P.UNARY };
      case 'string':
        if (from === 'string') return x;
        this.bfFormat();
        return post(`bf_format("${this.fmtSpec(e.e.t)}", ${this.fmtArg(e.e)})`);
      case 'bool':
        if (from === 'string') {
          this.inc('string.h');
          return { c: `strlen(${x.c}) > 0`, p: P.CMP };
        }
        return { c: `${paren(x, P.CMP + 1)} != 0`, p: P.CMP };
    }
  }

  protected eInput(e: E<'input'>): X {
    this.inc('stdlib.h');
    this.inc('string.h');
    this.helper('bf_input', [
      '/* Prints a prompt and reads one line of text. */',
      'static char *bf_input(const char *prompt) {',
      '    size_t capacity = 64;',
      '    size_t length = 0;',
      '    char *line = malloc(capacity);',
      '    int ch;',
      '    printf("%s", prompt);',
      '    fflush(stdout);',
      "    while ((ch = getchar()) != EOF && ch != '\\n') {",
      '        if (length + 1 >= capacity) {',
      '            capacity *= 2;',
      '            line = realloc(line, capacity);',
      '        }',
      '        line[length++] = (char)ch;',
      '    }',
      "    if (length > 0 && line[length - 1] == '\\r') length--;",
      "    line[length] = '\\0';",
      '    return line;',
      '}',
    ]);
    const call = `bf_input(${e.prompt.k === 'missing' ? '""' : this.ex(e.prompt).c})`;
    return post(e.numeric ? `atof(${call})` : call);
  }

  protected eMath(e: E<'math'>): X {
    const a = e.args.map((x) => this.ex(x).c);
    const isFloat = e.args.some((x) => x.t?.k === 'float');
    const cast = (code: string) => ({ c: `(int)${code}`, p: P.UNARY });
    switch (e.fn) {
      case 'abs':
        if (isFloat) {
          this.inc('math.h');
          return post(`fabs(${a[0]})`);
        }
        this.inc('stdlib.h');
        return post(`abs(${a[0]})`);
      case 'floor':
      case 'ceil':
      case 'round':
        this.inc('math.h');
        return cast(`${e.fn}(${a[0]})`);
      case 'min':
      case 'max': {
        if (isFloat) {
          this.inc('math.h');
          return post(`f${e.fn}(${a.join(', ')})`);
        }
        const name = `bf_${e.fn}`;
        this.helper(name, [`static int ${name}(int a, int b) {`, `    return a ${e.fn === 'min' ? '<' : '>'} b ? a : b;`, '}']);
        return post(`${name}(${a.join(', ')})`);
      }
      case 'ln':
        this.inc('math.h');
        return post(`log(${a[0]})`);
      case 'pow10':
        this.inc('math.h');
        return post(`pow(10, ${a[0]})`);
      default:
        this.inc('math.h');
        return post(`${e.fn}(${a[0]})`);
    }
  }

  protected eRandom(e: E<'random'>): X {
    this.inc('stdlib.h');
    this.inc('time.h');
    this.inc('stdbool.h');
    this.helper('bf_random', [
      'static int bf_random(int low, int high) {',
      '    static bool seeded = false;',
      '    if (!seeded) {',
      '        srand((unsigned)time(NULL));',
      '        seeded = true;',
      '    }',
      '    return low + rand() % (high - low + 1);',
      '}',
    ]);
    return post(`bf_random(${this.ex(e.from).c}, ${this.ex(e.to).c})`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    this.inc('string.h');
    const a = this.ex(e.args[0]).c;
    if (e.op === 'contains') return { c: `strstr(${a}, ${this.ex(e.args[1]).c}) != NULL`, p: P.CMP };
    this.inc('stdlib.h');
    this.inc('ctype.h');
    if (e.op === 'trim') {
      this.helper('bf_trim', [
        'static char *bf_trim(const char *text) {',
        '    while (isspace((unsigned char)*text)) text++;',
        '    size_t length = strlen(text);',
        '    while (length > 0 && isspace((unsigned char)text[length - 1])) length--;',
        '    char *copy = malloc(length + 1);',
        '    memcpy(copy, text, length);',
        "    copy[length] = '\\0';",
        '    return copy;',
        '}',
      ]);
      return post(`bf_trim(${a})`);
    }
    const name = e.op === 'upper' ? 'bf_upper' : 'bf_lower';
    this.helper(name, [
      `static char *${name}(const char *text) {`,
      '    size_t length = strlen(text);',
      '    char *copy = malloc(length + 1);',
      `    for (size_t i = 0; i <= length; i++) copy[i] = (char)${e.op === 'upper' ? 'toupper' : 'tolower'}((unsigned char)text[i]);`,
      '    return copy;',
      '}',
    ]);
    return post(`${name}(${a})`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    this.inc('stdlib.h');
    this.helper('bf_read_file', [
      '/* Returns the whole file as text, or an empty text when it cannot be read. */',
      'static char *bf_read_file(const char *path) {',
      '    FILE *file = fopen(path, "rb");',
      '    if (!file) return calloc(1, 1);',
      '    fseek(file, 0, SEEK_END);',
      '    long size = ftell(file);',
      '    fseek(file, 0, SEEK_SET);',
      '    char *text = malloc((size_t)size + 1);',
      '    size_t read = fread(text, 1, (size_t)size, file);',
      "    text[read] = '\\0';",
      '    fclose(file);',
      '    return text;',
      '}',
    ]);
    return post(`bf_read_file(${this.ex(e.path).c})`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.inc('stdbool.h');
    this.helper('bf_file_exists', ['static bool bf_file_exists(const char *path) {', '    FILE *file = fopen(path, "rb");', '    if (!file) return false;', '    fclose(file);', '    return true;', '}']);
    return post(`bf_file_exists(${this.ex(e.path).c})`);
  }

  protected override eShell(e: E<'shell'>): X {
    this.inc('stdlib.h');
    this.inc('string.h');
    this.helper('bf_shell', [
      '/* Runs a command and returns what it printed. */',
      'static char *bf_shell(const char *command) {',
      '    size_t capacity = 256;',
      '    size_t length = 0;',
      '    char *text = malloc(capacity);',
      '    FILE *pipe = popen(command, "r");',
      '    int ch;',
      '    while (pipe && (ch = fgetc(pipe)) != EOF) {',
      '        if (length + 1 >= capacity) {',
      '            capacity *= 2;',
      '            text = realloc(text, capacity);',
      '        }',
      '        text[length++] = (char)ch;',
      '    }',
      '    if (pipe) pclose(pipe);',
      "    text[length] = '\\0';",
      '    return text;',
      '}',
    ]);
    return post(`bf_shell(${this.ex(e.cmd).c})`);
  }

  protected override eNew(e: E<'new'>): X {
    const cls = this.an.classes.get(e.name);
    return post(`(${this.typeId(e.name)}){${this.args(e.args, cls?.fields.map((f) => f.type))}}`);
  }

  protected override eMethod(e: E<'method'>): X {
    return this.unsupportedExpr(e, 'classes', 'Use a struct block and plain functions instead.');
  }

  protected override eAddrOf(e: E<'addrOf'>): X {
    return { c: `&${this.v(e.name)}`, p: P.UNARY };
  }

  protected override eDeref(e: E<'deref'>): X {
    return { c: `*${paren(this.ex(e.e), P.UNARY)}`, p: P.UNARY };
  }

  protected override eAlloc(e: E<'alloc'>): X {
    this.inc('stdlib.h');
    const t = this.typeName(e.elem);
    return post(`malloc(sizeof(${t}) * (size_t)${paren(this.ex(e.count), P.UNARY)})`);
  }

  protected override eNum(e: E<'num'>): X {
    return super.eNum(e);
  }

  protected override sImport(s: S<'import'>): void {
    if (!s.module) return;
    this.imports.add(this.importLine(s.module));
  }
}

export default new CGenerator();
export { atom };
