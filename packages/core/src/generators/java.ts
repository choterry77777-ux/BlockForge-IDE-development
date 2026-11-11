import type { VarInfo } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, type InterfaceDecl, T, type TypeRef } from '../ir/types';
import { type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import type { Emitter } from './emitter';

export class JavaGenerator extends ImperativeGenerator {
  readonly lang = 'java' as const;
  protected readonly reservedWords = ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null', 'var', 'record', 'yield', 'Main', 'main', 'String', 'Math', 'System', 'Object', 'Integer', 'Double', 'Boolean', 'input', 'SCANNER', 'args', 'List', 'Map', 'ArrayList', 'HashMap', 'Files', 'Path', 'Thread', 'Exception'];
  protected override staticTypes = true;
  /** Checked exceptions are thrown by files, HTTP, sleep and shell blocks. */
  private checked = false;

  private imp(name: string): void {
    this.imports.add(`import ${name};`);
  }

  protected override importLine(module: string): string {
    return `import ${module};`;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) this.imports.add(this.importLine(s.module));
  }

  protected override prepare(): void {
    this.checked = ['files', 'http', 'sleep', 'shell'].some((f) => this.an.features.has(f));
  }

  private get throwsClause(): string {
    return this.checked ? ' throws Exception' : '';
  }

  protected layout(): Emitter {
    const body = this.newEmitter();
    this.em = body;
    body.line('public class Main {');
    body.indent();
    const helperMark = body.count;
    for (const info of this.an.globals.values()) body.line(`static ${this.typeName(this.varType(info))} ${this.v(info.name)} = ${this.zero(this.varType(info))};`);
    if (this.an.globals.size) body.blank();
    this.emitDecls();
    body.line(`public static void main(String[] args)${this.throwsClause} {`);
    body.indent();
    this.emitMain();
    body.dedent();
    body.line('}');
    body.dedent();
    body.line('}');
    // Helpers are static members, inserted at the top of the class.
    const helperLines: string[] = [];
    for (const lines of this.helpers.values()) helperLines.push(...lines.map((l) => (l ? this.indentUnit + l : '')), '');
    body.lines.splice(helperMark, 0, ...helperLines);
    for (const m of body.maps) {
      if (m.start > helperMark) m.start += helperLines.length;
      if (m.end > helperMark) m.end += helperLines.length;
    }
    const out = this.newEmitter();
    for (const i of [...this.imports].sort()) out.line(i);
    if (this.imports.size) out.blank();
    out.append(body);
    return out;
  }

  // ----- types -----

  protected override typeName(t: TypeRef, id?: string, boxed = false): string {
    switch (t.k) {
      case 'int':
        return boxed ? 'Integer' : 'int';
      case 'float':
        return boxed ? 'Double' : 'double';
      case 'string':
        return 'String';
      case 'bool':
        return boxed ? 'Boolean' : 'boolean';
      case 'void':
        return 'void';
      case 'list': {
        this.imp('java.util.ArrayList');
        const s = this.settle(t, 'list', id);
        return `ArrayList<${this.typeName(s.k === 'list' ? s.of : T.int, id, true)}>`;
      }
      case 'map': {
        this.imp('java.util.HashMap');
        const m = this.settle(t, 'dictionary', id) as { key: TypeRef; value: TypeRef };
        return `HashMap<${this.typeName(m.key, id, true)}, ${this.typeName(m.value, id, true)}>`;
      }
      case 'struct':
        return this.typeId(t.name);
      case 'ptr':
        this.unsupported(id, 'pointers', 'Java has no raw pointers.');
        return 'int';
      case 'func':
        this.unsupported(id, 'function values', 'A functional interface with an explicit signature is required.');
        return 'Object';
      case 'any':
        return this.mixed(id);
      default:
        return boxed ? 'Integer' : 'int';
    }
  }

  protected override zero(t: TypeRef): string {
    switch (t.k) {
      case 'float':
        return '0.0';
      case 'string':
        return '""';
      case 'bool':
        return 'false';
      case 'list':
      case 'map':
        this.typeName(t);
        return `new ${t.k === 'list' ? 'ArrayList' : 'HashMap'}<>()`;
      case 'struct':
        return 'null';
      default:
        return '0';
    }
  }

  // ----- declarations -----

  protected override declare(name: string, info: VarInfo, init: string): void {
    this.em.line(`${info.isConst ? 'final ' : ''}${this.typeName(this.varType(info), info.declNode?.id)} ${this.v(name)} = ${init};`);
  }

  protected override globalsDecl(): void {}

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const params = f.params.map((p) => `${this.typeName(isMethod ? p.type : this.paramType(p, f), f.id)} ${this.v(p.name)}`).join(', ');
    if (isMethod) return `public ${this.typeName(f.ret, f.id)} ${this.member(f.name)}(${params})${this.throwsClause} {`;
    return `static ${this.typeName(f.ret, f.id)} ${this.fn(f.name)}(${params})${this.throwsClause} {`;
  }

  protected override emitClass(c: ClassDecl): void {
    this.em.line(`static class ${this.typeId(c.name)}${c.implements ? ` implements ${this.typeId(c.implements)}` : ''} {`);
    this.em.indent();
    for (const f of c.fields) this.em.line(`${this.typeName(f.type, f.id)} ${this.member(f.name)};`);
    if (c.fields.length) this.em.blank();
    this.em.line(`${this.typeId(c.name)}(${c.fields.map((f) => `${this.typeName(f.type, f.id)} ${this.member(f.name)}`).join(', ')}) {`);
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

  protected override emitInterface(i: InterfaceDecl): void {
    this.em.line(`interface ${this.typeId(i.name)} {`);
    this.em.indent();
    for (const m of i.methods) this.em.line(`${this.typeName(m.ret, m.id)} ${this.member(m.name)}(${m.params.map((p) => `${this.typeName(p.type, m.id)} ${this.member(p.name)}`).join(', ')})${this.throwsClause};`);
    this.em.dedent();
    this.em.line('}');
  }

  // ----- statements -----

  protected sPrint(s: S<'print'>): void {
    this.em.line(`System.out.println(${this.ex(s.value).c});`);
  }

  protected repeatOpen(count: string, counter: string): string {
    return `for (int ${counter} = 0; ${counter} < ${count}; ${counter}++) {`;
  }

  protected forRangeOpen(r: RangeInfo): string {
    const step = r.stepIsOne ? `${r.v}${r.desc ? '--' : '++'}` : `${r.v} ${r.desc ? '-=' : '+='} ${r.step}`;
    return `for (${r.declare ? this.typeName(r.type) + ' ' : ''}${r.v} = ${r.from}; ${r.v} ${r.desc ? '>=' : '<='} ${r.to}; ${step}) {`;
  }

  protected forEachOpen(v: string, iter: string, s: S<'forEach'>, declare: boolean): string | [string, string] {
    const of = this.typeName(this.settle(this.elemType(s.iterable) ?? T.int, v, s.id), s.id);
    if (declare) return `for (${of} ${v} : ${iter}) {`;
    const tmp = this.names.fresh('item');
    return [`for (${of} ${tmp} : ${iter}) {`, `${v} = ${tmp};`];
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.add(${this.valueFor(s.value, this.elemType(s.list))});`);
  }

  protected override sListSet(s: S<'listSet'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.set(${this.valueFor(s.index, T.int)}, ${this.valueFor(s.value, this.elemType(s.list))});`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.remove((int) ${paren(this.ex(s.index), P.UNARY)});`);
  }

  protected override sMapSet(s: S<'mapSet'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}.put(${this.ex(s.key).c}, ${this.valueFor(s.value, s.map.t?.k === 'map' ? s.map.t.value : undefined)});`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}.remove(${this.ex(s.key).c});`);
  }

  protected override sTry(s: S<'try'>): void {
    const e = this.names.fresh('error');
    this.em.line('try {');
    this.em.indent();
    this.body(s.body);
    this.em.dedent();
    this.em.line(`} catch (Exception ${e}) {`);
    this.em.indent();
    this.bind(s, s.errVar, `String.valueOf(${e}.getMessage())`);
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
    this.em.line('}');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`throw new RuntimeException(${this.ex(s.message).c});`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    this.imp('java.nio.file.Files');
    this.imp('java.nio.file.Path');
    if (s.append) this.imp('java.nio.file.StandardOpenOption');
    const opts = s.append ? ', StandardOpenOption.CREATE, StandardOpenOption.APPEND' : '';
    this.em.line(`Files.writeString(Path.of(${this.ex(s.path).c}), String.valueOf(${this.ex(s.content).c})${opts});`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.em.line(`Thread.sleep((long) ${paren(this.ex(s.ms), P.UNARY)});`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.em.line(`new ProcessBuilder("sh", "-c", ${this.ex(s.cmd).c}).inheritIO().start().waitFor();`);
  }

  // ----- expressions -----

  protected override toFloat(x: X): X {
    return { c: `(double) ${paren(x, P.UNARY)}`, p: P.UNARY };
  }

  private isStr(e: Expr): boolean {
    return e.t?.k === 'string';
  }

  protected override eEquality(e: E<'bin'>): X {
    if (this.isStr(e.l) || this.isStr(e.r)) {
      const call = `${paren(this.ex(e.l), P.POST)}.equals(${this.ex(e.r).c})`;
      return e.op === '==' ? post(call) : { c: `!${call}`, p: P.UNARY };
    }
    return super.eEquality(e);
  }

  protected override eCompare(e: E<'bin'>): X {
    if (this.isStr(e.l) || this.isStr(e.r)) return { c: `${paren(this.ex(e.l), P.POST)}.compareTo(${this.ex(e.r).c}) ${e.op} 0`, p: P.CMP };
    return super.eCompare(e);
  }

  protected override eList(e: E<'list'>): X {
    const t = this.settle(e.t ?? T.list(T.int), 'list', e.id);
    const of = t.k === 'list' ? t.of : T.int;
    this.typeName(t, e.id);
    if (!e.items.length) return post('new ArrayList<>()');
    this.imp('java.util.List');
    return post(`new ArrayList<>(List.of(${e.items.map((i) => this.valueFor(i, of)).join(', ')}))`);
  }

  protected override eMap(e: E<'map'>): X {
    this.imp('java.util.HashMap');
    return post('new HashMap<>()');
  }

  protected override eIndex(e: E<'index'>): X {
    if (e.target.t?.k === 'string') return post(`String.valueOf(${paren(this.ex(e.target), P.POST)}.charAt(${this.valueFor(e.index, T.int)}))`);
    return post(`${paren(this.ex(e.target), P.POST)}.get(${this.valueFor(e.index, T.int)})`);
  }

  protected override eMapGet(e: E<'mapGet'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.get(${this.ex(e.key).c})`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.containsKey(${this.ex(e.key).c})`);
  }

  protected eLen(e: E<'len'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.${e.target.t?.k === 'string' ? 'length' : 'size'}()`);
  }

  protected eConcat(e: E<'concat'>): X {
    const parts = e.parts.map((p, i) => (i === 0 && !this.isStr(p) ? `String.valueOf(${this.ex(p).c})` : paren(this.ex(p), P.ADD + 1)));
    return parts.length === 1 ? post(parts[0]) : { c: parts.join(' + '), p: P.ADD };
  }

  protected eConvert(e: E<'convert'>): X {
    const from = e.e.t?.k;
    const x = this.ex(e.e);
    switch (e.to) {
      case 'int':
        return from === 'string' ? post(`Integer.parseInt(${paren(x, P.POST)}.trim())`) : { c: `(int) ${paren(x, P.UNARY)}`, p: P.UNARY };
      case 'float':
        return from === 'string' ? post(`Double.parseDouble(${paren(x, P.POST)}.trim())`) : { c: `(double) ${paren(x, P.UNARY)}`, p: P.UNARY };
      case 'string':
        return post(`String.valueOf(${x.c})`);
      case 'bool':
        return from === 'string' ? { c: `!${paren(x, P.POST)}.isEmpty()`, p: P.UNARY } : from === 'bool' ? x : { c: `${paren(x, P.CMP + 1)} != 0`, p: P.CMP };
    }
  }

  protected eInput(e: E<'input'>): X {
    this.imp('java.util.Scanner');
    this.helper('input', [
      'static final Scanner SCANNER = new Scanner(System.in);',
      '',
      '// Prints a prompt and reads one line of text.',
      'static String input(String prompt) {',
      '    System.out.print(prompt);',
      '    System.out.flush();',
      '    return SCANNER.hasNextLine() ? SCANNER.nextLine() : "";',
      '}',
    ]);
    const call = `input(${e.prompt.k === 'missing' ? '""' : this.ex(e.prompt).c})`;
    return post(e.numeric ? `Double.parseDouble(${call}.trim())` : call);
  }

  protected eMath(e: E<'math'>): X {
    const a = e.args.map((x) => this.ex(x).c);
    switch (e.fn) {
      case 'floor':
      case 'ceil':
      case 'round':
        return { c: `(int) Math.${e.fn}(${a[0]})`, p: P.UNARY };
      case 'ln':
        return post(`Math.log(${a[0]})`);
      case 'pow10':
        return post(`Math.pow(10, ${a[0]})`);
      default:
        return post(`Math.${e.fn}(${a.join(', ')})`);
    }
  }

  protected eRandom(e: E<'random'>): X {
    this.imp('java.util.concurrent.ThreadLocalRandom');
    return post(`ThreadLocalRandom.current().nextInt(${this.ex(e.from).c}, ${paren(this.ex(e.to), P.ADD)} + 1)`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = paren(this.ex(e.args[0]), P.POST);
    if (e.op === 'contains') return post(`${a}.contains(${this.ex(e.args[1]).c})`);
    return post(`${a}.${{ upper: 'toUpperCase', lower: 'toLowerCase', trim: 'trim' }[e.op]}()`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    this.imp('java.nio.file.Files');
    this.imp('java.nio.file.Path');
    return post(`Files.readString(Path.of(${this.ex(e.path).c}))`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.imp('java.nio.file.Files');
    this.imp('java.nio.file.Path');
    return post(`Files.exists(Path.of(${this.ex(e.path).c}))`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    this.imp('java.net.URI');
    this.imp('java.net.http.HttpClient');
    this.imp('java.net.http.HttpRequest');
    this.imp('java.net.http.HttpResponse');
    return post(`HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(${this.ex(e.url).c})).build(), HttpResponse.BodyHandlers.ofString()).body()`);
  }

  protected override eShell(e: E<'shell'>): X {
    return post(`new String(new ProcessBuilder("sh", "-c", ${this.ex(e.cmd).c}).start().getInputStream().readAllBytes())`);
  }
}

export default new JavaGenerator();
