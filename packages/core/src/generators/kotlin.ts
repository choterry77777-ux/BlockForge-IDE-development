import type { ScopeInfo, VarInfo } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, type InterfaceDecl, T, type TypeRef } from '../ir/types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import { type Emitter, quote } from './emitter';

export class KotlinGenerator extends ImperativeGenerator {
  readonly lang = 'kotlin' as const;
  protected readonly reservedWords = ['as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while', 'main', 'input', 'println', 'print', 'String', 'Int', 'Double', 'Boolean', 'Math', 'File', 'it', 'field', 'repeat', 'run', 'let', 'also', 'apply', 'with', 'to', 'listOf', 'mapOf'];
  protected override staticTypes = true;
  protected override strictNumeric = true;
  protected override stmtEnd = '';

  protected override importLine(module: string): string {
    return `import ${module}`;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) this.imports.add(this.importLine(s.module));
  }

  protected layout(): Emitter {
    const body = this.em;
    for (const info of this.an.globals.values()) body.line(`var ${this.v(info.name)}: ${this.typeName(this.varType(info))} = ${this.zero(this.varType(info))}`);
    if (this.an.globals.size) body.blank();
    this.emitDecls();
    body.line('fun main() {');
    body.indent();
    this.emitMain();
    body.dedent();
    body.line('}');
    const out = this.newEmitter();
    this.writeHeader(out);
    out.append(body);
    return out;
  }

  // ----- types -----

  protected override typeName(t: TypeRef, id?: string): string {
    switch (t.k) {
      case 'int':
        return 'Int';
      case 'float':
        return 'Double';
      case 'string':
        return 'String';
      case 'bool':
        return 'Boolean';
      case 'void':
        return 'Unit';
      case 'list': {
        const s = this.settle(t, 'list', id);
        return `MutableList<${this.typeName(s.k === 'list' ? s.of : T.int, id)}>`;
      }
      case 'map': {
        const m = this.settle(t, 'dictionary', id) as { key: TypeRef; value: TypeRef };
        return `MutableMap<${this.typeName(m.key, id)}, ${this.typeName(m.value, id)}>`;
      }
      case 'struct':
        return this.typeId(t.name);
      case 'ptr':
        this.unsupported(id, 'pointers', 'Kotlin has no raw pointers.');
        return 'Int';
      case 'func':
        this.unsupported(id, 'function values', 'A function type with an explicit signature is required.');
        return 'Any';
      case 'any':
        return this.mixed(id);
      default:
        return 'Int';
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
        return 'mutableListOf()';
      case 'map':
        return 'mutableMapOf()';
      default:
        return '0';
    }
  }

  protected override str(s: string): string {
    return quote(s, { control: 'u4', escape: '$' });
  }

  // ----- declarations -----

  protected override declare(name: string, info: VarInfo, init: string): void {
    const t = this.varType(info);
    this.em.line(`${info.reassigned && !info.isConst ? 'var' : 'val'} ${this.v(name)}: ${this.typeName(t, info.declNode?.id)} = ${init}`);
  }

  protected override hoist(scope: ScopeInfo): void {
    for (const name of scope.hoisted) {
      const info = scope.vars.get(name)!;
      const t = this.varType(info);
      if (t.k === 'struct') this.em.line(`lateinit var ${this.v(name)}: ${this.typeName(t)}`);
      else this.em.line(`var ${this.v(name)}: ${this.typeName(t)} = ${this.zero(t)}`);
    }
  }

  protected override globalsDecl(): void {}

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const info = isMethod ? this.an.methods.get(`${this.curClass!.name}.${f.name}`) : this.an.funcs.get(f.name);
    const params = f.params.map((p) => `${this.v(p.name)}: ${this.typeName(isMethod ? p.type : this.paramType(p, f), f.id)}`).join(', ');
    const ret = f.ret.k === 'void' ? '' : `: ${this.typeName(f.ret, f.id)}`;
    const iface = isMethod && this.curClass?.implements ? this.program.interfaces.find((i) => i.name === this.curClass!.implements) : undefined;
    const prefix = iface?.methods.some((m) => m.name === f.name) ? 'override ' : '';
    // Parameters are read-only in Kotlin; a reassigned one is shadowed in the prologue.
    void info;
    return `${prefix}fun ${isMethod ? this.member(f.name) : this.fn(f.name)}(${params})${ret} {`;
  }

  protected override funcPrologue(f: FuncDecl, scope: ScopeInfo): void {
    for (const p of f.params) {
      const v = scope.vars.get(p.name);
      if (v?.reassigned) this.em.line(`var ${this.v(p.name)} = ${this.v(p.name)}`);
    }
  }

  protected override emitClass(c: ClassDecl): void {
    const fields = c.fields.map((f) => `var ${this.member(f.name)}: ${this.typeName(f.type, f.id)}`).join(', ');
    const impl = c.implements ? ` : ${this.typeId(c.implements)}` : '';
    if (c.isStruct || !c.methods.length) {
      this.em.line(`${c.isStruct && c.fields.length ? 'data ' : ''}class ${this.typeId(c.name)}(${fields})${impl}`);
      return;
    }
    this.em.line(`class ${this.typeId(c.name)}(${fields})${impl} {`);
    this.em.indent();
    c.methods.forEach((m, i) => {
      if (i) this.em.blank();
      this.emitFunc(m, c);
    });
    this.em.dedent();
    this.em.line('}');
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.em.line(`interface ${this.typeId(i.name)} {`);
    this.em.indent();
    for (const m of i.methods) {
      const ret = m.ret.k === 'void' ? '' : `: ${this.typeName(m.ret, m.id)}`;
      this.em.line(`fun ${this.member(m.name)}(${m.params.map((p) => `${this.member(p.name)}: ${this.typeName(p.type, m.id)}`).join(', ')})${ret}`);
    }
    this.em.dedent();
    this.em.line('}');
  }

  // ----- statements -----

  protected sPrint(s: S<'print'>): void {
    this.em.line(`println(${this.ex(s.value).c})`);
  }

  protected repeatOpen(count: string, counter: string): string {
    return `for (${counter} in 0 until ${count}) {`;
  }

  protected forRangeOpen(r: RangeInfo, s: S<'forRange'>): string | [string, string] {
    if (r.type.k !== 'int') this.unsupported(s.id, 'counting loops over decimal numbers', 'Kotlin ranges need whole numbers.');
    const range = `${r.from} ${r.desc ? 'downTo' : '..'} ${r.to}`.replace(' .. ', '..') + (r.stepIsOne ? '' : ` step ${r.step}`);
    if (r.declare) return `for (${r.v} in ${range}) {`;
    const tmp = this.names.fresh('step');
    return [`for (${tmp} in ${range}) {`, `${r.v} = ${tmp}`];
  }

  protected forEachOpen(v: string, iter: string, _s: S<'forEach'>, declare: boolean): string | [string, string] {
    if (declare) return `for (${v} in ${iter}.toList()) {`;
    const tmp = this.names.fresh('item');
    return [`for (${tmp} in ${iter}.toList()) {`, `${v} = ${tmp}`];
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.add(${this.valueFor(s.value, this.elemType(s.list))})`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.removeAt(${this.valueFor(s.index, T.int)})`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}.remove(${this.ex(s.key).c})`);
  }

  protected override sTry(s: S<'try'>): void {
    const e = this.names.fresh('error');
    this.em.line('try {');
    this.em.indent();
    this.body(s.body);
    this.em.dedent();
    this.em.line(`} catch (${e}: Exception) {`);
    this.em.indent();
    this.bind(s, s.errVar, `${e}.message ?: ""`);
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
    this.em.line('}');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`throw Exception(${this.ex(s.message).c})`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    this.imports.add('import java.io.File');
    this.em.line(`File(${this.ex(s.path).c}).${s.append ? 'appendText' : 'writeText'}(${this.text(s.content)})`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.em.line(`Thread.sleep(${paren(this.ex(s.ms), P.POST)}.toLong())`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.em.line(`ProcessBuilder("sh", "-c", ${this.ex(s.cmd).c}).inheritIO().start().waitFor()`);
  }

  // ----- expressions -----

  private text(e: Expr): string {
    return e.t?.k === 'string' ? this.ex(e).c : `${this.recv(e)}.toString()`;
  }

  private recv(e: Expr): string {
    const x = this.ex(e);
    return e.k === 'num' && e.value < 0 ? `(${x.c})` : paren(x, P.POST);
  }

  protected override toFloat(x: X): X {
    return post(`${paren(x, P.POST)}.toDouble()`);
  }

  protected override ePow(e: E<'bin'>): X {
    return post(`Math.pow(${this.valueFor(e.l, T.float)}, ${this.valueFor(e.r, T.float)})`);
  }

  protected override eTernary(e: E<'ternary'>): X {
    return { c: `if (${this.ex(e.cond).c}) ${this.valueFor(e.a, e.t, P.TERN + 1)} else ${this.valueFor(e.b, e.t, P.TERN + 1)}`, p: P.LOW };
  }

  protected override eList(e: E<'list'>): X {
    const t = this.settle(e.t ?? T.list(T.int), 'list', e.id);
    const of = t.k === 'list' ? t.of : T.int;
    return post(e.items.length ? `mutableListOf(${e.items.map((i) => this.valueFor(i, of)).join(', ')})` : `mutableListOf<${this.typeName(of, e.id)}>()`);
  }

  protected override eMap(e: E<'map'>): X {
    const m = this.settle(e.t ?? T.map(T.string, T.int), 'dictionary', e.id) as { key: TypeRef; value: TypeRef };
    return post(`mutableMapOf<${this.typeName(m.key, e.id)}, ${this.typeName(m.value, e.id)}>()`);
  }

  protected override eIndex(e: E<'index'>): X {
    const x = super.eIndex(e);
    return e.target.t?.k === 'string' ? post(`${x.c}.toString()`) : x;
  }

  protected override eMapGet(e: E<'mapGet'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.getValue(${this.ex(e.key).c})`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.containsKey(${this.ex(e.key).c})`);
  }

  protected eLen(e: E<'len'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.${e.target.t?.k === 'string' ? 'length' : 'size'}`);
  }

  protected eConcat(e: E<'concat'>): X {
    let out = '"';
    for (const p of e.parts) {
      if (p.k === 'str') out += this.str(p.value).slice(1, -1);
      else out += '${' + this.ex(p).c + '}';
    }
    return atom(out + '"');
  }

  protected eConvert(e: E<'convert'>): X {
    const from = e.e.t?.k;
    const x = this.recv(e.e);
    switch (e.to) {
      case 'int':
        return post(from === 'string' ? `${x}.trim().toInt()` : `${x}.toInt()`);
      case 'float':
        return post(from === 'string' ? `${x}.trim().toDouble()` : `${x}.toDouble()`);
      case 'string':
        return post(`${x}.toString()`);
      case 'bool':
        return from === 'string' ? post(`${x}.isNotEmpty()`) : from === 'bool' ? this.ex(e.e) : { c: `${x} != ${from === 'float' ? '0.0' : '0'}`, p: P.CMP };
    }
  }

  protected eInput(e: E<'input'>): X {
    this.helper('input', ['// Prints a prompt and reads one line of text.', 'fun input(prompt: String): String {', '    print(prompt)', '    System.out.flush()', '    return readLine() ?: ""', '}']);
    const call = `input(${e.prompt.k === 'missing' ? '""' : this.ex(e.prompt).c})`;
    return post(e.numeric ? `${call}.trim().toDouble()` : call);
  }

  protected eMath(e: E<'math'>): X {
    const isFloat = e.args.some((x) => x.t?.k === 'float');
    const f = (x: Expr) => this.valueFor(x, T.float);
    const a0 = e.args[0];
    switch (e.fn) {
      case 'abs':
        return post(`Math.abs(${this.ex(a0).c})`);
      case 'floor':
      case 'ceil':
        return post(`Math.${e.fn}(${f(a0)}).toInt()`);
      case 'round':
        return post(`Math.round(${f(a0)}).toInt()`);
      case 'min':
      case 'max': {
        const t = isFloat ? T.float : T.int;
        return post(`${e.fn}Of(${e.args.map((x) => this.valueFor(x, t)).join(', ')})`);
      }
      case 'ln':
        return post(`Math.log(${f(a0)})`);
      case 'pow10':
        return post(`Math.pow(10.0, ${f(a0)})`);
      default:
        return post(`Math.${e.fn}(${f(a0)})`);
    }
  }

  protected eRandom(e: E<'random'>): X {
    return post(`(${paren(this.ex(e.from), P.ADD)}..${paren(this.ex(e.to), P.ADD)}).random()`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = paren(this.ex(e.args[0]), P.POST);
    if (e.op === 'contains') return post(`${a}.contains(${this.ex(e.args[1]).c})`);
    return post(`${a}.${{ upper: 'uppercase', lower: 'lowercase', trim: 'trim' }[e.op]}()`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    this.imports.add('import java.io.File');
    return post(`File(${this.ex(e.path).c}).readText()`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.imports.add('import java.io.File');
    return post(`File(${this.ex(e.path).c}).exists()`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    return post(`java.net.URI(${this.ex(e.url).c}).toURL().readText()`);
  }

  protected override eShell(e: E<'shell'>): X {
    return post(`ProcessBuilder("sh", "-c", ${this.ex(e.cmd).c}).start().inputStream.bufferedReader().readText()`);
  }

  protected override eNew(e: E<'new'>): X {
    const cls = this.an.classes.get(e.name);
    return post(`${this.typeId(e.name)}(${this.args(e.args, cls?.fields.map((f) => f.type))})`);
  }
}

export default new KotlinGenerator();
