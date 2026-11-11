import { type Analysis, containsKinds, type ScopeInfo, type VarInfo } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, type ImperativeProgram, type InterfaceDecl, type Param, type Stmt, T, type TypeRef } from '../ir/types';
import { LANGUAGES } from '../langs';
import type { DependencyRef, Diagnostic, GenOptions, GenResult, LanguageId, Severity } from '../types';
import { Emitter, NameTable, quote } from './emitter';

/** A piece of expression code together with its precedence. */
export interface X {
  c: string;
  p: number;
}

export const P = { LOW: 0, TERN: 2, OR: 3, AND: 4, NOT: 5, CMP: 7, ADD: 10, MUL: 11, UNARY: 13, POW: 14, POST: 16, ATOM: 20 } as const;
export const atom = (c: string): X => ({ c, p: P.ATOM });
export const post = (c: string): X => ({ c, p: P.POST });
export const paren = (x: X, min: number): string => (x.p < min ? `(${x.c})` : x.c);

export type S<K extends Stmt['k']> = Extract<Stmt, { k: K }>;
export type E<K extends Expr['k']> = Extract<Expr, { k: K }>;

export interface RangeInfo {
  v: string;
  from: string;
  to: string;
  /** Absolute step. */
  step: string;
  stepIsOne: boolean;
  desc: boolean;
  type: TypeRef;
  /** The loop variable is declared by the loop header. */
  declare: boolean;
}

const ARITH_PREC: Record<string, number> = { '+': P.ADD, '-': P.ADD, '*': P.MUL, '/': P.MUL, '%': P.MUL };

/**
 * Base class for the 15 imperative language generators. It walks the IR and
 * provides C-family defaults; every language overrides what differs and reports
 * a diagnostic for constructs it cannot express.
 */
export abstract class ImperativeGenerator {
  abstract readonly lang: LanguageId;
  protected abstract readonly reservedWords: string[];
  protected unicodeIdents = true;
  protected indentUnit = '    ';
  /** Never converts an int value to float implicitly on assignment (Go, Rust, Kotlin, Dart). */
  protected strictNumeric = false;
  /** Mixed int/float arithmetic is rejected too (Go, Rust). */
  protected strictArith = false;
  /** Statically typed: unknown and mixed types are diagnosed. */
  protected staticTypes = false;
  protected stmtEnd = ';';
  protected lineComment = '//';

  protected em!: Emitter;
  protected diags!: Diagnostic[];
  protected an!: Analysis;
  protected program!: ImperativeProgram;
  protected opts!: GenOptions;
  protected names!: NameTable;
  protected imports!: Set<string>;
  protected helpers!: Map<string, string[]>;
  protected deps!: DependencyRef[];
  protected notes!: string[];
  protected scope!: ScopeInfo;
  protected curFunc?: FuncDecl;
  protected curClass?: ClassDecl;
  protected asyncFuncs = new Set<string>();
  protected mainAsync = false;
  private warned = new Set<string>();

  generate(program: ImperativeProgram, analysis: Analysis, opts: GenOptions = {}): GenResult {
    this.program = program;
    this.an = analysis;
    this.opts = opts;
    this.diags = [];
    this.imports = new Set();
    this.helpers = new Map();
    this.deps = [];
    this.notes = [];
    this.warned = new Set();
    this.asyncFuncs = new Set();
    this.mainAsync = false;
    this.curFunc = undefined;
    this.curClass = undefined;
    this.names = new NameTable(new Set(this.reservedWords), this.unicodeIdents);
    if (opts.indent) this.indentUnit = ' '.repeat(opts.indent);
    this.scope = analysis.main;
    this.em = this.newEmitter();
    // Functions and types get first pick of clean names.
    for (const f of program.funcs) this.fn(f.name);
    for (const c of program.classes) this.typeId(c.name);
    for (const i of program.interfaces) this.typeId(i.name);
    this.prepare();
    const out = this.layout();
    const info = LANGUAGES[this.lang];
    const file = this.fileName();
    return {
      language: this.lang,
      files: [{ path: file, content: out.toString(), role: 'main' }, ...this.extraFiles()],
      mappings: out.mappings(file),
      dependencies: this.deps,
      diagnostics: this.diags,
      meta: { entryFile: file, languageName: info.name, features: [...analysis.features].sort() },
      requirements: { toolchains: info.toolchains, notes: this.notes },
    };
  }

  protected fileName(): string {
    const info = LANGUAGES[this.lang];
    return this.opts.baseName ? `${this.opts.baseName}.${info.ext}` : info.entry;
  }

  protected extraFiles(): GenResult['files'] {
    return [];
  }

  protected newEmitter(): Emitter {
    return new Emitter(this.indentUnit);
  }

  /** Hook run before layout, e.g. to compute async functions. */
  protected prepare(): void {}

  /** Produce the final file. */
  protected abstract layout(): Emitter;

  // ---------- diagnostics ----------

  protected report(severity: Severity, code: string, message: string, blockId?: string, params?: Record<string, string | number>): void {
    this.diags.push({ severity, code, message, blockId, params: { language: LANGUAGES[this.lang].name, ...params }, source: 'generator' });
  }

  protected warnOnce(key: string, code: string, message: string, blockId?: string, params?: Record<string, string | number>, severity: Severity = 'warning'): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.report(severity, code, message, blockId, params);
  }

  /** Report a construct this language cannot express. */
  protected unsupported(id: string | undefined, feature: string, detail = ''): void {
    const name = LANGUAGES[this.lang].name;
    this.report('error', 'gen.unsupported', `${name} does not support ${feature}.${detail ? ' ' + detail : ''}`, id, { feature, detail });
  }

  protected unsupportedStmt(s: Stmt, feature: string, detail = ''): void {
    this.unsupported(s.id, feature, detail);
    this.em.line(`${this.lineComment} unsupported: ${feature}`);
  }

  protected unsupportedExpr(e: Expr, feature: string, detail = ''): X {
    this.unsupported(e.id, feature, detail);
    return atom(this.zero(T.unknown));
  }

  // ---------- names and types ----------

  protected v(name: string): string {
    return this.names.get('var', name);
  }

  protected fn(name: string): string {
    return this.names.get('fn', name);
  }

  protected typeId(name: string): string {
    return this.names.get('type', name);
  }

  protected member(name: string): string {
    const clean = name.trim().replace(/[^A-Za-z0-9_]/g, '_') || 'field';
    return /^[0-9]/.test(clean) ? `_${clean}` : clean;
  }

  protected info(name: string): VarInfo | undefined {
    return this.scope.vars.get(name) ?? this.an.globals.get(name);
  }

  protected isGlobal(name: string): boolean {
    return !this.scope.vars.has(name) && this.an.globals.has(name);
  }

  /** Type to use for a variable in a static language, diagnosing gaps. */
  protected varType(info: VarInfo | undefined, id?: string): TypeRef {
    const t = info?.type ?? T.unknown;
    return this.settle(t, info?.name ?? '?', id ?? info?.declNode?.id);
  }

  protected settle(t: TypeRef, what: string, id?: string): TypeRef {
    if (!this.staticTypes) return t;
    if (t.k === 'any') {
      this.mixed(id);
      return T.int;
    }
    if (t.k === 'unknown' || t.k === 'null') {
      this.warnOnce(`unk:${what}`, 'gen.typeUnknown', `The type of "${what}" could not be inferred; an integer is assumed.`, id, { name: what });
      return T.int;
    }
    if (t.k === 'list' && (t.of.k === 'unknown' || t.of.k === 'null')) {
      this.warnOnce(`unk:${what}`, 'gen.typeUnknown', `The item type of list "${what}" could not be inferred; integers are assumed.`, id, { name: what });
      return T.list(T.int);
    }
    if (t.k === 'map') {
      const key = t.key.k === 'unknown' ? T.string : t.key;
      const value = t.value.k === 'unknown' ? T.int : t.value;
      return T.map(key, value);
    }
    return t;
  }

  /** Static languages cannot give one type to a value that changes type. */
  protected mixed(id?: string): string {
    this.warnOnce(`mixed:${id}`, 'gen.mixedTypes', `${LANGUAGES[this.lang].name} needs every variable to keep one type, but a value here mixes several types.`, id, undefined, 'error');
    return this.typeName(T.int);
  }

  protected paramType(p: Param, f: FuncDecl): TypeRef {
    return this.settle(p.type, `${f.name}(${p.name})`, f.id);
  }

  /** Name of a type in the target language. Static languages override. */
  protected typeName(_t: TypeRef, _id?: string): string {
    return '';
  }

  /** Default value used for hoisted declarations. */
  protected zero(t: TypeRef): string {
    switch (t.k) {
      case 'float':
        return '0.0';
      case 'string':
        return '""';
      case 'bool':
        return 'false';
      case 'int':
      case 'unknown':
        return '0';
      default:
        return this.nullLiteral();
    }
  }

  protected nullLiteral(): string {
    return 'null';
  }

  protected str(s: string): string {
    return quote(s);
  }

  // ---------- async ----------

  /** Mark functions as async when they contain the given constructs or call an async function. */
  protected computeAsync(stmtKinds: string[], exprKinds: string[]): void {
    const sk = new Set(stmtKinds);
    const ek = new Set(exprKinds);
    const direct = (body: Stmt[]) => containsKinds(body, sk, ek);
    for (const [name, fi] of this.an.funcs) if (direct(fi.decl.body)) this.asyncFuncs.add(name);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name, fi] of this.an.funcs) {
        if (this.asyncFuncs.has(name)) continue;
        if ([...fi.scope.calls].some((c) => this.asyncFuncs.has(c))) {
          this.asyncFuncs.add(name);
          changed = true;
        }
      }
    }
    this.mainAsync = direct(this.program.main) || [...this.an.main.calls].some((c) => this.asyncFuncs.has(c));
  }

  // ---------- statements ----------

  protected body(stmts: Stmt[]): void {
    const start = this.em.count;
    for (const s of stmts) this.stmt(s);
    if (this.em.count === start) {
      const e = this.emptyBody();
      if (e) this.em.line(e);
    }
  }

  protected emptyBody(): string | null {
    return null;
  }

  protected stmt(s: Stmt): void {
    const start = this.em.count;
    switch (s.k) {
      case 'varDecl':
        this.sVarDecl(s);
        break;
      case 'assign':
        this.sAssign(s);
        break;
      case 'print':
        this.sPrint(s);
        break;
      case 'if':
        this.sIf(s);
        break;
      case 'while':
        this.sWhile(s);
        break;
      case 'repeat':
        this.sRepeat(s);
        break;
      case 'forRange':
        this.sForRange(s);
        break;
      case 'forEach':
        this.sForEach(s);
        break;
      case 'break':
        this.sBreak(s);
        break;
      case 'continue':
        this.sContinue(s);
        break;
      case 'return':
        this.sReturn(s);
        break;
      case 'exprStmt':
        this.sExprStmt(s);
        break;
      case 'listAppend':
        this.sListAppend(s);
        break;
      case 'listSet':
        this.sListSet(s);
        break;
      case 'listRemove':
        this.sListRemove(s);
        break;
      case 'mapSet':
        this.sMapSet(s);
        break;
      case 'mapDelete':
        this.sMapDelete(s);
        break;
      case 'try':
        this.sTry(s);
        break;
      case 'throw':
        this.sThrow(s);
        break;
      case 'comment':
        this.sComment(s);
        break;
      case 'import':
        this.sImport(s);
        break;
      case 'fileWrite':
        this.sFileWrite(s);
        break;
      case 'fieldSet':
        this.sFieldSet(s);
        break;
      case 'sleep':
        this.sSleep(s);
        break;
      case 'shellRun':
        this.sShellRun(s);
        break;
      case 'derefSet':
        this.sDerefSet(s);
        break;
      case 'free':
        this.sFree(s);
        break;
      case 'domSet':
        this.sDomSet(s);
        break;
      case 'domOn':
        this.sDomOn(s);
        break;
      case 'rawStmt':
        this.sRawStmt(s);
        break;
    }
    this.em.mark(s.id, start);
  }

  protected sBreak(_s: S<'break'>): void {
    this.em.line(`break${this.stmtEnd}`);
  }

  protected sContinue(_s: S<'continue'>): void {
    this.em.line(`continue${this.stmtEnd}`);
  }

  protected declaredAt(s: Stmt, name: string): boolean {
    return !!this.an.declAt.get(s)?.includes(name);
  }

  /** Emit a declaration with an initial value. */
  protected declare(name: string, info: VarInfo, init: string): void {
    this.em.line(`${info.reassigned || info.mutated ? 'let' : 'const'} ${this.v(name)} = ${init}${this.stmtEnd}`);
  }

  protected assignTo(name: string, code: string): void {
    this.em.line(`${this.v(name)} = ${code}${this.stmtEnd}`);
  }

  /** Declare-or-assign helper shared by assignments, declarations and catch bindings. */
  protected bind(s: Stmt, name: string, code: string): void {
    const info = this.info(name);
    if (info && this.declaredAt(s, name)) this.declare(name, info, code);
    else this.assignTo(name, code);
  }

  /** Declarations for variables hoisted to the top of a scope. */
  protected hoist(scope: ScopeInfo): void {
    for (const name of scope.hoisted) {
      const info = scope.vars.get(name)!;
      this.declare(name, { ...info, reassigned: true }, this.zero(this.varType(info)));
    }
  }

  protected globalsDecl(): void {
    for (const info of this.an.globals.values()) this.declare(info.name, { ...info, reassigned: true }, this.zero(this.varType(info)));
    if (this.an.globals.size) this.em.blank();
  }

  protected sVarDecl(s: S<'varDecl'>): void {
    const info = this.info(s.name);
    const code = s.init ? this.valueFor(s.init, info?.type) : this.zero(this.varType(info, s.id));
    this.bind(s, s.name, code);
  }

  protected sAssign(s: S<'assign'>): void {
    this.bind(s, s.name, this.valueFor(s.value, this.info(s.name)?.type));
  }

  protected abstract sPrint(s: S<'print'>): void;

  protected cond(e: Expr): string {
    return this.ex(e).c;
  }

  protected ifOpen(cond: string, first: boolean): string {
    return first ? `if (${cond}) {` : `} else if (${cond}) {`;
  }

  protected elseOpen(): string {
    return '} else {';
  }

  protected blockEnd(_kind: 'if' | 'loop' | 'func' | 'class' | 'try'): string | null {
    return '}';
  }

  protected whileOpen(cond: string): string {
    return `while (${cond}) {`;
  }

  protected sIf(s: S<'if'>): void {
    s.branches.forEach((b, i) => {
      if (i > 0) this.em.dedent();
      this.em.line(this.ifOpen(this.cond(b.cond), i === 0));
      this.em.indent();
      this.body(b.body);
    });
    if (s.else && s.else.length) {
      this.em.dedent();
      this.em.line(this.elseOpen());
      this.em.indent();
      this.body(s.else);
    }
    this.em.dedent();
    const end = this.blockEnd('if');
    if (end) this.em.line(end);
  }

  /** `open` may carry a second line that is written first inside the loop body. */
  protected loopBody(open: string | [string, string], body: Stmt[]): void {
    const [head, first] = typeof open === 'string' ? [open, undefined] : open;
    this.em.line(head);
    this.em.indent();
    if (first) this.em.line(first);
    if (first) for (const s of body) this.stmt(s);
    else this.body(body);
    this.em.dedent();
    const end = this.blockEnd('loop');
    if (end) this.em.line(end);
  }

  protected sWhile(s: S<'while'>): void {
    this.loopBody(this.whileOpen(this.cond(s.cond)), s.body);
  }

  protected abstract repeatOpen(count: string, counter: string, s: S<'repeat'>): string;

  protected sRepeat(s: S<'repeat'>): void {
    const counter = this.names.fresh('i');
    this.loopBody(this.repeatOpen(this.valueFor(s.count, T.int), counter, s), s.body);
  }

  protected rangeInfo(s: S<'forRange'>): RangeInfo {
    const info = this.info(s.var);
    const type = this.varType(info, s.id);
    const lit = (e: Expr): number | undefined => (e.k === 'num' ? e.value : e.k === 'un' && e.op === 'neg' && e.e.k === 'num' ? -e.e.value : undefined);
    const stepLit = lit(s.step);
    const fromLit = lit(s.from);
    const toLit = lit(s.to);
    let desc = false;
    if (stepLit !== undefined && stepLit < 0) desc = true;
    else if (fromLit !== undefined && toLit !== undefined && fromLit > toLit) desc = true;
    const absStep: Expr = stepLit !== undefined ? { k: 'num', value: Math.abs(stepLit), isInt: Number.isInteger(stepLit), t: Number.isInteger(stepLit) ? T.int : T.float } : s.step;
    if (stepLit === 0) this.report('error', 'gen.zeroStep', 'A counting loop cannot use a step of 0.', s.id);
    return {
      v: this.v(s.var),
      from: this.valueFor(s.from, type),
      to: this.valueFor(s.to, type),
      step: this.valueFor(absStep, type),
      stepIsOne: stepLit !== undefined && Math.abs(stepLit) === 1,
      desc,
      type,
      declare: info?.decl === 'loop',
    };
  }

  protected abstract forRangeOpen(r: RangeInfo, s: S<'forRange'>): string | [string, string];

  protected sForRange(s: S<'forRange'>): void {
    this.loopBody(this.forRangeOpen(this.rangeInfo(s), s), s.body);
  }

  protected abstract forEachOpen(v: string, iter: string, s: S<'forEach'>, declare: boolean): string | [string, string];

  protected sForEach(s: S<'forEach'>): void {
    this.loopBody(this.forEachOpen(this.v(s.var), this.ex(s.iterable).c, s, this.info(s.var)?.decl === 'loop'), s.body);
  }

  protected sReturn(s: S<'return'>): void {
    if (!s.value) this.em.line(`return${this.stmtEnd}`);
    else this.em.line(`return ${this.valueFor(s.value, this.curFunc?.ret)}${this.stmtEnd}`);
  }

  protected sExprStmt(s: S<'exprStmt'>): void {
    this.em.line(`${this.ex(s.e).c}${this.stmtEnd}`);
  }

  protected elemType(list: Expr): TypeRef | undefined {
    return list.t?.k === 'list' ? list.t.of : list.t?.k === 'ptr' ? list.t.to : undefined;
  }

  protected sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.push(${this.valueFor(s.value, this.elemType(s.list))})${this.stmtEnd}`);
  }

  protected sListSet(s: S<'listSet'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}[${this.valueFor(s.index, T.int)}] = ${this.valueFor(s.value, this.elemType(s.list))}${this.stmtEnd}`);
  }

  protected sListRemove(s: S<'listRemove'>): void {
    this.unsupportedStmt(s, 'removing list items');
  }

  protected sMapSet(s: S<'mapSet'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}[${this.ex(s.key).c}] = ${this.valueFor(s.value, s.map.t?.k === 'map' ? s.map.t.value : undefined)}${this.stmtEnd}`);
  }

  protected sMapDelete(s: S<'mapDelete'>): void {
    this.unsupportedStmt(s, 'dictionaries');
  }

  protected sTry(s: S<'try'>): void {
    this.unsupportedStmt(s, 'exception handling');
  }

  protected sThrow(s: S<'throw'>): void {
    this.unsupportedStmt(s, 'exception handling');
  }

  protected sComment(s: S<'comment'>): void {
    if (this.opts.comments === false) return;
    for (const l of s.text.split('\n')) this.em.line(`${this.lineComment} ${l}`.trimEnd());
  }

  /** Imports are collected and written at the top of the file by layout(). */
  protected sImport(s: S<'import'>): void {
    if (!s.module) return;
    if (!/^[\w./@:<>-]+$/.test(s.module)) {
      this.report('error', 'gen.badModule', `"${s.module}" is not a valid module name.`, s.id, { module: s.module });
      return;
    }
    this.imports.add(this.importLine(s.module));
    this.em.line(`${this.lineComment} import ${s.module}`);
  }

  protected importLine(module: string): string {
    return `import ${module}${this.stmtEnd}`;
  }

  protected sFileWrite(s: S<'fileWrite'>): void {
    this.unsupportedStmt(s, 'file access');
  }

  protected sFieldSet(s: S<'fieldSet'>): void {
    this.em.line(`${paren(this.ex(s.target), P.POST)}.${this.member(s.name)} = ${this.ex(s.value).c}${this.stmtEnd}`);
  }

  protected sSleep(s: S<'sleep'>): void {
    this.unsupportedStmt(s, 'waiting');
  }

  protected sShellRun(s: S<'shellRun'>): void {
    this.unsupportedStmt(s, 'shell commands');
  }

  protected sDerefSet(s: S<'derefSet'>): void {
    this.unsupportedStmt(s, 'pointers', 'The language has no raw pointers.');
  }

  protected sFree(s: S<'free'>): void {
    this.unsupportedStmt(s, 'manual memory management', 'Memory is managed automatically.');
  }

  protected sDomSet(s: S<'domSet'>): void {
    this.unsupportedStmt(s, 'web page scripting', 'Page blocks only work with JavaScript, TypeScript and HTML.');
  }

  protected sDomOn(s: S<'domOn'>): void {
    this.unsupportedStmt(s, 'web page scripting', 'Page blocks only work with JavaScript, TypeScript and HTML.');
  }

  protected sRawStmt(s: S<'rawStmt'>): void {
    if (s.lang !== this.lang) {
      this.report('warning', 'gen.rawSkipped', `A raw ${s.lang} code block was skipped because the target is ${LANGUAGES[this.lang].name}.`, s.id, { from: s.lang });
      this.em.line(`${this.lineComment} skipped raw ${s.lang} code`);
      return;
    }
    for (const l of s.code.split('\n')) this.em.line(l);
  }

  // ---------- declarations ----------

  protected abstract funcOpen(f: FuncDecl, isMethod: boolean): string;

  protected funcPrologue(_f: FuncDecl, _scope: ScopeInfo): void {}

  protected emitFunc(f: FuncDecl, owner?: ClassDecl): void {
    const key = owner ? `${owner.name}.${f.name}` : f.name;
    const fi = owner ? this.an.methods.get(key) : this.an.funcs.get(key);
    if (!fi) return;
    const saved = { scope: this.scope, func: this.curFunc };
    this.scope = fi.scope;
    this.curFunc = f;
    const start = this.em.count;
    this.em.line(this.funcOpen(f, !!owner));
    this.em.indent();
    const bodyStart = this.em.count;
    this.funcPrologue(f, fi.scope);
    this.hoist(fi.scope);
    for (const s of f.body) this.stmt(s);
    if (this.em.count === bodyStart) {
      const e = this.emptyBody();
      if (e) this.em.line(e);
    }
    this.em.dedent();
    const end = this.blockEnd('func');
    if (end) this.em.line(end);
    this.em.mark(f.id, start);
    this.scope = saved.scope;
    this.curFunc = saved.func;
  }

  protected emitClass(c: ClassDecl): void {
    this.unsupported(c.id, c.isStruct ? 'structs' : 'classes');
  }

  protected emitInterface(i: InterfaceDecl): void {
    this.unsupported(i.id, 'interfaces');
  }

  /** Classes, interfaces and functions in declaration order. */
  protected emitDecls(): void {
    for (const i of this.program.interfaces) {
      const start = this.em.count;
      this.emitInterface(i);
      this.em.mark(i.id, start);
      this.em.blank();
    }
    for (const c of this.program.classes) {
      const start = this.em.count;
      const saved = this.curClass;
      this.curClass = c;
      this.emitClass(c);
      this.curClass = saved;
      this.em.mark(c.id, start);
      this.em.blank();
    }
    for (const f of this.program.funcs) {
      this.emitFunc(f);
      this.em.blank();
    }
  }

  /** Main statements, including hoisted declarations. */
  protected emitMain(): void {
    const start = this.em.count;
    this.scope = this.an.main;
    this.curFunc = undefined;
    this.hoist(this.an.main);
    const bodyStart = this.em.count;
    for (const s of this.program.main) this.stmt(s);
    if (this.program.startId) this.em.maps.push({ blockId: this.program.startId, start: Math.min(start, bodyStart) + 1, end: Math.max(this.em.count, start + 1) });
  }

  // ---------- expressions ----------

  /** Expression flowing into a slot of a known type, with numeric coercion. */
  protected valueFor(e: Expr, target?: TypeRef, min = 0): string {
    let x = this.ex(e);
    if (target?.k === 'float' && e.t?.k === 'int' && (this.strictNumeric || e.k === 'num')) x = this.asFloat(e, x);
    return paren(x, min);
  }

  protected asFloat(e: Expr, x: X): X {
    if (e.t?.k !== 'int') return x;
    if (e.k === 'num') return e.value < 0 ? { c: `${e.value}.0`, p: P.UNARY } : atom(`${e.value}.0`);
    return this.toFloat(x);
  }

  protected toFloat(x: X): X {
    return x;
  }

  protected args(list: Expr[], types?: (TypeRef | undefined)[]): string {
    return list.map((a, i) => this.valueFor(a, types?.[i])).join(', ');
  }

  protected bin(sym: string, prec: number, l: X, r: X, nonAssoc = false): X {
    return { c: `${paren(l, nonAssoc ? prec + 1 : prec)} ${sym} ${paren(r, prec + 1)}`, p: prec };
  }

  protected ex(e: Expr): X {
    switch (e.k) {
      case 'num':
        return this.eNum(e);
      case 'str':
        return atom(this.str(e.value));
      case 'bool':
        return atom(this.boolLiteral(e.value));
      case 'null':
        return atom(this.nullLiteral());
      case 'var':
        return atom(this.v(e.name));
      case 'bin':
        return this.eBin(e);
      case 'un':
        return this.eUn(e);
      case 'call':
        return this.eCall(e);
      case 'list':
        return this.eList(e);
      case 'map':
        return this.eMap(e);
      case 'index':
        return this.eIndex(e);
      case 'mapGet':
        return this.eMapGet(e);
      case 'mapHas':
        return this.eMapHas(e);
      case 'len':
        return this.eLen(e);
      case 'concat':
        return this.eConcat(e);
      case 'convert':
        return this.eConvert(e);
      case 'input':
        return this.eInput(e);
      case 'math':
        return this.eMath(e);
      case 'random':
        return this.eRandom(e);
      case 'strOp':
        return this.eStrOp(e);
      case 'ternary':
        return this.eTernary(e);
      case 'fileRead':
        return this.eFileRead(e);
      case 'fileExists':
        return this.eFileExists(e);
      case 'jsonParse':
        return this.eJsonParse(e);
      case 'jsonStringify':
        return this.eJsonStringify(e);
      case 'httpGet':
        return this.eHttpGet(e);
      case 'shell':
        return this.eShell(e);
      case 'field':
        return post(`${paren(this.ex(e.target), P.POST)}.${this.member(e.name)}`);
      case 'this':
        return atom(this.thisLiteral());
      case 'new':
        return this.eNew(e);
      case 'method':
        return this.eMethod(e);
      case 'await':
        return this.eAwait(e);
      case 'funcRef':
        return this.eFuncRef(e);
      case 'callRef':
        return this.eCallRef(e);
      case 'addrOf':
        return this.eAddrOf(e);
      case 'deref':
        return this.eDeref(e);
      case 'alloc':
        return this.eAlloc(e);
      case 'domGet':
        return this.eDomGet(e);
      case 'raw':
        return this.eRaw(e);
      case 'missing':
        return atom(this.zero(T.unknown));
    }
  }

  protected eNum(e: E<'num'>): X {
    let c: string;
    if (e.isInt) c = String(e.value);
    else {
      c = String(e.value);
      if (!/[.eE]/.test(c)) c += '.0';
    }
    return e.value < 0 ? { c, p: P.UNARY } : atom(c);
  }

  protected boolLiteral(v: boolean): string {
    return v ? 'true' : 'false';
  }

  protected thisLiteral(): string {
    return 'this';
  }

  protected opSymbol(op: string): string {
    return op;
  }

  protected eBin(e: E<'bin'>): X {
    switch (e.op) {
      case '**':
        return this.ePow(e);
      case '/':
        return this.eDivide(e);
      case '+':
      case '-':
      case '*':
      case '%': {
        let l = this.ex(e.l);
        let r = this.ex(e.r);
        if (this.strictArith && e.t?.k === 'float') {
          l = this.asFloat(e.l, l);
          r = this.asFloat(e.r, r);
        }
        return this.bin(this.opSymbol(e.op), ARITH_PREC[e.op], l, r);
      }
      case '==':
      case '!=':
        return this.eEquality(e);
      case '<':
      case '<=':
      case '>':
      case '>=':
        return this.eCompare(e);
      case '&&':
        return this.bin(this.opSymbol('&&'), P.AND, this.ex(e.l), this.ex(e.r));
      case '||':
        return this.bin(this.opSymbol('||'), P.OR, this.ex(e.l), this.ex(e.r));
    }
  }

  /** Operands of a comparison, converted to a common numeric type when required. */
  protected comparands(e: E<'bin'>): [X, X] {
    let l = this.ex(e.l);
    let r = this.ex(e.r);
    if (this.strictNumeric && (e.l.t?.k === 'float' || e.r.t?.k === 'float')) {
      l = this.asFloat(e.l, l);
      r = this.asFloat(e.r, r);
    }
    return [l, r];
  }

  protected eEquality(e: E<'bin'>): X {
    const [l, r] = this.comparands(e);
    return this.bin(this.opSymbol(e.op), P.CMP, l, r, true);
  }

  protected eCompare(e: E<'bin'>): X {
    const [l, r] = this.comparands(e);
    return this.bin(this.opSymbol(e.op), P.CMP, l, r, true);
  }

  /** True division. Dynamic languages divide natively; static ones convert first. */
  protected eDivide(e: E<'bin'>): X {
    let l = this.ex(e.l);
    let r = this.ex(e.r);
    if (this.staticTypes) {
      l = this.asFloat(e.l, l);
      if (this.strictNumeric) r = this.asFloat(e.r, r);
    }
    return this.bin('/', P.MUL, l, r);
  }

  protected ePow(e: E<'bin'>): X {
    return post(`Math.pow(${this.ex(e.l).c}, ${this.ex(e.r).c})`);
  }

  protected eUn(e: E<'un'>): X {
    const x = this.ex(e.e);
    if (e.op === 'not') return { c: `!${paren(x, P.UNARY)}`, p: P.UNARY };
    const inner = paren(x, P.UNARY);
    return { c: inner.startsWith('-') ? `-(${inner})` : `-${inner}`, p: P.UNARY };
  }

  protected callTypes(name: string): TypeRef[] | undefined {
    return this.an.funcs.get(name)?.decl.params.map((p) => p.type);
  }

  protected eCall(e: E<'call'>): X {
    const x = post(`${this.fn(e.name)}(${this.args(e.args, this.callTypes(e.name))})`);
    return this.asyncFuncs.has(e.name) ? this.awaited(x) : x;
  }

  protected awaited(x: X): X {
    return { c: `await ${paren(x, P.UNARY)}`, p: P.UNARY };
  }

  protected eList(e: E<'list'>): X {
    const of = e.t?.k === 'list' ? e.t.of : undefined;
    return atom(`[${e.items.map((i) => this.valueFor(i, of)).join(', ')}]`);
  }

  protected eMap(e: E<'map'>): X {
    return this.unsupportedExpr(e, 'dictionaries');
  }

  protected eIndex(e: E<'index'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}[${this.valueFor(e.index, T.int)}]`);
  }

  protected eMapGet(e: E<'mapGet'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}[${this.ex(e.key).c}]`);
  }

  protected eMapHas(e: E<'mapHas'>): X {
    return this.unsupportedExpr(e, 'dictionaries');
  }

  protected abstract eLen(e: E<'len'>): X;
  protected abstract eConcat(e: E<'concat'>): X;
  protected abstract eConvert(e: E<'convert'>): X;
  protected abstract eInput(e: E<'input'>): X;
  protected abstract eMath(e: E<'math'>): X;
  protected abstract eRandom(e: E<'random'>): X;
  protected abstract eStrOp(e: E<'strOp'>): X;

  protected eTernary(e: E<'ternary'>): X {
    return { c: `${paren(this.ex(e.cond), P.TERN + 1)} ? ${paren(this.ex(e.a), P.TERN + 1)} : ${paren(this.ex(e.b), P.TERN)}`, p: P.TERN };
  }

  protected eFileRead(e: E<'fileRead'>): X {
    return this.unsupportedExpr(e, 'file access');
  }

  protected eFileExists(e: E<'fileExists'>): X {
    return this.unsupportedExpr(e, 'file access');
  }

  protected eJsonParse(e: E<'jsonParse'>): X {
    return this.unsupportedExpr(e, 'JSON parsing', 'Parsed JSON has no fixed type; use a dynamically typed language or a JSON library.');
  }

  protected eJsonStringify(e: E<'jsonStringify'>): X {
    return this.unsupportedExpr(e, 'JSON output');
  }

  protected eHttpGet(e: E<'httpGet'>): X {
    return this.unsupportedExpr(e, 'HTTP requests', 'The standard library has no HTTP client.');
  }

  protected eShell(e: E<'shell'>): X {
    return this.unsupportedExpr(e, 'shell commands');
  }

  protected eNew(e: E<'new'>): X {
    const cls = this.an.classes.get(e.name);
    return post(`new ${this.typeId(e.name)}(${this.args(e.args, cls?.fields.map((f) => f.type))})`);
  }

  protected eMethod(e: E<'method'>): X {
    const cls = e.target.t?.k === 'struct' ? this.an.classes.get(e.target.t.name) : undefined;
    const m = cls?.methods.find((x) => x.name === e.name);
    return post(`${paren(this.ex(e.target), P.POST)}.${this.member(e.name)}(${this.args(e.args, m?.params.map((p) => p.type))})`);
  }

  protected eAwait(e: E<'await'>): X {
    this.warnOnce('await', 'gen.awaitIgnored', `${LANGUAGES[this.lang].name} code generated here runs synchronously, so "await" has no effect.`, e.id, undefined, 'info');
    return this.ex(e.e);
  }

  protected eFuncRef(e: E<'funcRef'>): X {
    return this.unsupportedExpr(e, 'function values');
  }

  protected eCallRef(e: E<'callRef'>): X {
    return this.unsupportedExpr(e, 'function values');
  }

  protected eAddrOf(e: E<'addrOf'>): X {
    return this.unsupportedExpr(e, 'pointers', 'The language has no raw pointers.');
  }

  protected eDeref(e: E<'deref'>): X {
    return this.unsupportedExpr(e, 'pointers', 'The language has no raw pointers.');
  }

  protected eAlloc(e: E<'alloc'>): X {
    return this.unsupportedExpr(e, 'manual memory management', 'Memory is managed automatically.');
  }

  protected eDomGet(e: E<'domGet'>): X {
    return this.unsupportedExpr(e, 'web page scripting', 'Page blocks only work with JavaScript, TypeScript and HTML.');
  }

  protected eRaw(e: E<'raw'>): X {
    if (e.lang !== this.lang) {
      this.report('error', 'gen.rawExprMismatch', `A raw ${e.lang} expression cannot be used when the target is ${LANGUAGES[this.lang].name}.`, e.id, { from: e.lang });
      return atom(this.zero(T.unknown));
    }
    return { c: e.code, p: P.LOW };
  }

  // ---------- shared layout helpers ----------

  /** Write collected imports and helper definitions. */
  protected writeHeader(out: Emitter, sortImports = true): void {
    const imports = sortImports ? [...this.imports].sort() : [...this.imports];
    for (const i of imports) out.line(i);
    if (imports.length) out.blank();
    for (const lines of this.helpers.values()) {
      out.block(lines);
      out.blank();
    }
  }

  protected helper(name: string, lines: string[]): void {
    if (!this.helpers.has(name)) this.helpers.set(name, lines);
  }
}
