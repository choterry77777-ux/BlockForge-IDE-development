import { containsKinds, type VarInfo, walkStmts } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, type InterfaceDecl, type Param, type Stmt, T, type TypeRef } from '../ir/types';
import type { LanguageId } from '../types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import type { Emitter } from './emitter';

const JS_RESERVED = ['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'async', 'console', 'Math', 'Number', 'String', 'Boolean', 'Object', 'Array', 'JSON', 'Promise', 'Error', 'document', 'window', 'fetch', 'require', 'process', 'input', 'randomInt', 'main', 'fs', 'undefined', 'NaN', 'Infinity', 'arguments', 'eval', 'self', 'prompt', 'any', 'number', 'string', 'boolean', 'type', 'declare'];

const INPUT_HELPER = (ts: boolean) => [
  `function input(question${ts ? ': string' : ''})${ts ? ': string' : ''} {`,
  `  if (typeof prompt === 'function') return prompt(question) ?? '';`,
  `  const fs = require('fs');`,
  `  process.stdout.write(String(question));`,
  `  const bytes${ts ? ': number[]' : ''} = [];`,
  `  const one = Buffer.alloc(1);`,
  `  while (true) {`,
  `    let count = 0;`,
  `    try {`,
  `      count = fs.readSync(0, one, 0, 1, null);`,
  `    } catch (err${ts ? ': any' : ''}) {`,
  `      if (err.code === 'EAGAIN') continue;`,
  `      break;`,
  `    }`,
  `    if (count === 0 || one[0] === 10) break;`,
  `    bytes.push(one[0]);`,
  `  }`,
  `  return Buffer.from(bytes).toString('utf8').replace(/\\r$/, '');`,
  `}`,
];

/** JavaScript generator. TypeScript extends it and adds type annotations. */
export class JavaScriptGenerator extends ImperativeGenerator {
  readonly lang: LanguageId = 'javascript';
  protected readonly reservedWords = JS_RESERVED;
  protected override indentUnit = '  ';
  protected ts = false;
  /** Set when Node-only globals are referenced, so TypeScript can declare them. */
  protected usesNode = false;

  protected override prepare(): void {
    this.usesNode = false;
    this.computeAsync(['sleep'], ['await', 'httpGet']);
  }

  /** Type annotation suffix; empty in JavaScript. */
  protected ann(_t: TypeRef | undefined, _id?: string): string {
    return '';
  }

  protected layout(): Emitter {
    const body = this.em;
    this.globalsDecl();
    this.emitDecls();
    if (this.mainAsync) {
      body.line(`async function main()${this.ts ? ': Promise<void>' : ''} {`);
      body.indent();
      this.emitMain();
      body.dedent();
      body.line('}');
      body.blank();
      body.line('main();');
    } else {
      this.emitMain();
    }
    const out = this.newEmitter();
    this.preamble(out);
    this.writeHeader(out, false);
    out.append(body);
    return out;
  }

  protected preamble(_out: Emitter): void {}

  protected node(module: string, local: string): void {
    this.usesNode = true;
    this.imports.add(`const ${local} = require('${module}');`);
  }

  protected override declare(name: string, info: VarInfo, init: string): void {
    const kw = info.reassigned ? 'let' : 'const';
    this.em.line(`${kw} ${this.v(name)}${this.ann(this.varType(info))} = ${init};`);
  }

  protected override zero(t: TypeRef): string {
    switch (t.k) {
      case 'float':
        return '0';
      case 'list':
        return '[]';
      case 'map':
        return '{}';
      default:
        return super.zero(t);
    }
  }

  protected sPrint(s: S<'print'>): void {
    this.em.line(`console.log(${this.ex(s.value).c});`);
  }

  protected repeatOpen(count: string, counter: string): string {
    return `for (let ${counter} = 0; ${counter} < ${count}; ${counter}++) {`;
  }

  protected forRangeOpen(r: RangeInfo): string {
    const step = r.stepIsOne ? `${r.v}${r.desc ? '--' : '++'}` : `${r.v} ${r.desc ? '-=' : '+='} ${r.step}`;
    return `for (${r.declare ? `let ${r.v}${this.ann(r.type)}` : r.v} = ${r.from}; ${r.v} ${r.desc ? '>=' : '<='} ${r.to}; ${step}) {`;
  }

  protected forEachOpen(v: string, iter: string, _s: S<'forEach'>, declare: boolean): string {
    return `for (${declare ? 'const ' : ''}${v} of ${iter}) {`;
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.splice(${this.ex(s.index).c}, 1);`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`delete ${paren(this.ex(s.map), P.POST)}[${this.ex(s.key).c}];`);
  }

  protected catchMessage(e: string): string {
    return `String(${e} && ${e}.message !== undefined ? ${e}.message : ${e})`;
  }

  protected override sTry(s: S<'try'>): void {
    const e = this.names.fresh('err');
    this.em.line('try {');
    this.em.indent();
    this.body(s.body);
    this.em.dedent();
    this.em.line(`} catch (${e}${this.ts ? ': any' : ''}) {`);
    this.em.indent();
    this.bind(s, s.errVar, this.catchMessage(e));
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
    this.em.line('}');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`throw new Error(${this.ex(s.message).c});`);
  }

  protected override importLine(module: string): string {
    this.usesNode = true;
    const local = this.names.fresh(module.replace(/^.*[/:]/, '').replace(/[^A-Za-z0-9_]/g, '_') || 'mod');
    return `const ${local} = require('${module}');`;
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    this.node('fs', 'fs');
    this.em.line(`fs.${s.append ? 'appendFileSync' : 'writeFileSync'}(${this.ex(s.path).c}, String(${this.ex(s.content).c}));`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.em.line(`await new Promise((resolve) => setTimeout(resolve, ${this.ex(s.ms).c}));`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.node('child_process', 'childProcess');
    this.em.line(`childProcess.execSync(${this.ex(s.cmd).c}, { stdio: 'inherit' });`);
  }

  protected element(target: Expr): string {
    const el = `document.getElementById(${this.ex(target).c})`;
    return this.ts ? `(${el} as any)` : el;
  }

  protected override sDomSet(s: S<'domSet'>): void {
    const el = this.element(s.target);
    if (s.what === 'style') this.em.line(`${el}.style.setProperty(${this.str(s.prop ?? '')}, String(${this.ex(s.value).c}));`);
    else this.em.line(`${el}.${{ text: 'textContent', html: 'innerHTML', value: 'value' }[s.what]} = ${s.what === 'value' ? this.ex(s.value).c : `String(${this.ex(s.value).c})`};`);
  }

  protected override sDomOn(s: S<'domOn'>): void {
    const isAsync = containsKinds(s.body, new Set(['sleep']), new Set(['await', 'httpGet'])) || this.callsAsync(s.body);
    this.em.line(`${this.element(s.target)}.addEventListener(${this.str(s.event)}, ${isAsync ? 'async ' : ''}() => {`);
    this.em.indent();
    this.body(s.body);
    this.em.dedent();
    this.em.line('});');
  }

  private callsAsync(body: Stmt[]): boolean {
    let found = false;
    walkStmts(
      body,
      () => {},
      (e) => {
        if (e.k === 'call' && this.asyncFuncs.has(e.name)) found = true;
      },
    );
    return found;
  }

  protected params(f: FuncDecl): string {
    return f.params.map((p) => `${this.v(p.name)}${this.ann(this.pType(p, f))}`).join(', ');
  }

  protected pType(p: Param, _f: FuncDecl): TypeRef {
    return p.type;
  }

  protected retAnn(f: FuncDecl, isAsync: boolean): string {
    void f;
    void isAsync;
    return '';
  }

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    if (isMethod) return `${this.member(f.name)}(${this.params(f)})${this.retAnn(f, false)} {`;
    const isAsync = this.asyncFuncs.has(f.name);
    return `${isAsync ? 'async ' : ''}function ${this.fn(f.name)}(${this.params(f)})${this.retAnn(f, isAsync)} {`;
  }

  protected override emitClass(c: ClassDecl): void {
    this.em.line(`class ${this.typeId(c.name)}${this.implementsClause(c)} {`);
    this.em.indent();
    if (this.ts) for (const f of c.fields) this.em.line(`${this.member(f.name)}${this.ann(f.type)};`);
    if (this.ts && c.fields.length) this.em.blank();
    this.em.line(`constructor(${c.fields.map((f) => `${this.member(f.name)}${this.ann(f.type)}`).join(', ')}) {`);
    this.em.indent();
    for (const f of c.fields) this.em.line(`this.${this.member(f.name)} = ${this.member(f.name)};`);
    this.em.dedent();
    this.em.line('}');
    for (const m of c.methods) {
      this.em.blank();
      this.emitFunc(m, c);
    }
    this.em.dedent();
    this.em.line('}');
  }

  protected implementsClause(c: ClassDecl): string {
    if (c.implements) this.warnOnce(`impl:${c.name}`, 'gen.interfaceErased', 'JavaScript has no interfaces, so "implements" is only kept as a comment.', c.id, undefined, 'info');
    return '';
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.warnOnce(`iface:${i.name}`, 'gen.interfaceErased', 'JavaScript has no interfaces, so the interface is only kept as a comment.', i.id, undefined, 'info');
    this.em.line(`// interface ${i.name}: ${i.methods.map((m) => `${m.name}(${m.params.map((p) => p.name).join(', ')})`).join(', ')}`);
  }

  // ----- expressions -----

  protected override eEquality(e: E<'bin'>): X {
    return this.bin(e.op === '==' ? '===' : '!==', P.CMP, this.ex(e.l), this.ex(e.r), true);
  }

  protected override ePow(e: E<'bin'>): X {
    return { c: `${paren(this.ex(e.l), P.POW + 1)} ** ${paren(this.ex(e.r), P.POW)}`, p: P.POW };
  }

  protected override eUn(e: E<'un'>): X {
    // JavaScript forbids a bare unary operand on the left of **.
    if (e.op === 'neg' && e.e.k === 'bin' && e.e.op === '**') return { c: `-(${this.ex(e.e).c})`, p: P.UNARY };
    return super.eUn(e);
  }

  protected override eMap(e: E<'map'>): X {
    if (!e.entries.length) return atom('{}');
    return atom(`{ ${e.entries.map((x) => `[${this.ex(x.key).c}]: ${this.ex(x.value).c}`).join(', ')} }`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return post(`Object.hasOwn(${this.ex(e.target).c}, ${this.ex(e.key).c})`);
  }

  protected eLen(e: E<'len'>): X {
    if (e.target.t?.k === 'map') return post(`Object.keys(${this.ex(e.target).c}).length`);
    return post(`${paren(this.ex(e.target), P.POST)}.length`);
  }

  protected eConcat(e: E<'concat'>): X {
    const parts = e.parts.map((p, i) => (i === 0 && p.t?.k !== 'string' ? `String(${this.ex(p).c})` : paren(this.ex(p), P.ADD + 1)));
    return parts.length === 1 ? post(parts[0]) : { c: parts.join(' + '), p: P.ADD };
  }

  protected eConvert(e: E<'convert'>): X {
    const x = this.ex(e.e).c;
    switch (e.to) {
      case 'int':
        return post(`Math.trunc(Number(${x}))`);
      case 'float':
        return post(`Number(${x})`);
      case 'string':
        return post(`String(${x})`);
      case 'bool':
        return post(`Boolean(${x})`);
    }
  }

  protected eInput(e: E<'input'>): X {
    this.usesNode = true;
    this.helper('input', INPUT_HELPER(this.ts));
    const call = `input(${e.prompt.k === 'missing' ? "''" : this.ex(e.prompt).c})`;
    return post(e.numeric ? `Number(${call})` : call);
  }

  protected eMath(e: E<'math'>): X {
    const a = e.args.map((x) => this.ex(x).c).join(', ');
    if (e.fn === 'pow10') return { c: `10 ** ${paren(this.ex(e.args[0]), P.POW)}`, p: P.POW };
    return post(`Math.${e.fn === 'ln' ? 'log' : e.fn}(${a})`);
  }

  protected eRandom(e: E<'random'>): X {
    const n = this.ts ? ': number' : '';
    this.helper('randomInt', [`function randomInt(low${n}, high${n})${n} {`, '  return Math.floor(Math.random() * (high - low + 1)) + low;', '}']);
    return post(`randomInt(${this.ex(e.from).c}, ${this.ex(e.to).c})`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = paren(this.ex(e.args[0]), P.POST);
    if (e.op === 'contains') return post(`${a}.includes(${this.ex(e.args[1]).c})`);
    return post(`${a}.${{ upper: 'toUpperCase', lower: 'toLowerCase', trim: 'trim' }[e.op]}()`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    this.node('fs', 'fs');
    return post(`fs.readFileSync(${this.ex(e.path).c}, 'utf8')`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.node('fs', 'fs');
    return post(`fs.existsSync(${this.ex(e.path).c})`);
  }

  protected override eJsonParse(e: E<'jsonParse'>): X {
    return post(`JSON.parse(${this.ex(e.e).c})`);
  }

  protected override eJsonStringify(e: E<'jsonStringify'>): X {
    return post(`JSON.stringify(${this.ex(e.e).c})`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    return { c: `await (await fetch(${this.ex(e.url).c})).text()`, p: P.UNARY };
  }

  protected override eShell(e: E<'shell'>): X {
    this.node('child_process', 'childProcess');
    return post(`childProcess.execSync(${this.ex(e.cmd).c}, { encoding: 'utf8' })`);
  }

  protected override eAwait(e: E<'await'>): X {
    if (e.e.k === 'call' && this.asyncFuncs.has(e.e.name)) return this.ex(e.e);
    if (e.e.k === 'httpGet') return this.ex(e.e);
    return this.awaited(this.ex(e.e));
  }

  protected override eFuncRef(e: E<'funcRef'>): X {
    return atom(this.fn(e.name));
  }

  protected override eCallRef(e: E<'callRef'>): X {
    return post(`${paren(this.ex(e.fn), P.POST)}(${this.args(e.args)})`);
  }

  protected override eDomGet(e: E<'domGet'>): X {
    return post(`${this.element(e.target)}.${e.what === 'text' ? 'textContent' : 'value'}`);
  }

  protected override settle(t: TypeRef): TypeRef {
    return t.k === 'null' ? T.unknown : t;
  }
}

export default new JavaScriptGenerator();
