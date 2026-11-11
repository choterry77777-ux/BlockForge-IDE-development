import { type ScopeInfo, type VarInfo } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, type InterfaceDecl, T, type TypeRef } from '../ir/types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import { type Emitter, quote } from './emitter';

export class DartGenerator extends ImperativeGenerator {
  readonly lang = 'dart' as const;
  protected readonly reservedWords = ['abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export', 'extends', 'extension', 'external', 'factory', 'false', 'final', 'finally', 'for', 'Function', 'get', 'hide', 'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library', 'mixin', 'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow', 'return', 'set', 'show', 'static', 'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'typedef', 'var', 'void', 'while', 'with', 'yield', 'main', 'print', 'input', 'int', 'double', 'String', 'bool', 'List', 'Map', 'num', 'Object', 'stdin', 'stdout', 'File', 'Random', 'min', 'max', 'sqrt', 'pow', 'log', 'exp', 'sin', 'cos', 'tan', 'pi', 'e', 'sleep', 'exit'];
  protected override staticTypes = true;
  protected override strictNumeric = true;
  protected override unicodeIdents = false;
  protected override indentUnit = '  ';

  private imp(lib: string): void {
    this.imports.add(`import '${lib}';`);
  }

  protected override importLine(module: string): string {
    return `import '${module}';`;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) this.imports.add(this.importLine(s.module));
  }

  protected override prepare(): void {
    this.computeAsync([], ['await', 'httpGet']);
  }

  protected layout(): Emitter {
    const body = this.em;
    for (const info of this.an.globals.values()) body.line(`${this.typeName(this.varType(info))} ${this.v(info.name)} = ${this.zero(this.varType(info))};`);
    if (this.an.globals.size) body.blank();
    this.emitDecls();
    body.line(this.mainAsync ? 'Future<void> main() async {' : 'void main() {');
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
        return 'int';
      case 'float':
        return 'double';
      case 'string':
        return 'String';
      case 'bool':
        return 'bool';
      case 'void':
        return 'void';
      case 'list': {
        const s = this.settle(t, 'list', id);
        return `List<${this.typeName(s.k === 'list' ? s.of : T.int, id)}>`;
      }
      case 'map': {
        const m = this.settle(t, 'dictionary', id) as { key: TypeRef; value: TypeRef };
        return `Map<${this.typeName(m.key, id)}, ${this.typeName(m.value, id)}>`;
      }
      case 'struct':
        return this.typeId(t.name);
      case 'func':
        return 'Function';
      case 'ptr':
        this.unsupported(id, 'pointers', 'Dart has no raw pointers.');
        return 'int';
      case 'any':
        return 'dynamic';
      default:
        return 'int';
    }
  }

  protected override settle(t: TypeRef, what: string, id?: string): TypeRef {
    return t.k === 'any' ? t : super.settle(t, what, id);
  }

  protected override zero(t: TypeRef): string {
    switch (t.k) {
      case 'float':
        return '0.0';
      case 'string':
        return "''";
      case 'bool':
        return 'false';
      case 'list':
        return '[]';
      case 'map':
        return '{}';
      case 'any':
      case 'func':
        return 'null';
      default:
        return '0';
    }
  }

  protected override str(s: string): string {
    return quote(s, { quote: "'", control: 'ubrace', escape: '$' });
  }

  // ----- declarations -----

  protected override declare(name: string, info: VarInfo, init: string): void {
    const t = this.varType(info);
    this.em.line(`${info.isConst ? 'final ' : ''}${this.typeName(t, info.declNode?.id)} ${this.v(name)} = ${init};`);
  }

  protected override hoist(scope: ScopeInfo): void {
    for (const name of scope.hoisted) {
      const info = scope.vars.get(name)!;
      const t = this.varType(info);
      if (t.k === 'struct') this.em.line(`late ${this.typeName(t)} ${this.v(name)};`);
      else this.em.line(`${this.typeName(t)} ${this.v(name)} = ${this.zero(t)};`);
    }
  }

  protected override globalsDecl(): void {}

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const params = f.params.map((p) => `${this.typeName(isMethod ? p.type : this.paramType(p, f), f.id)} ${this.v(p.name)}`).join(', ');
    const ret = this.typeName(f.ret, f.id);
    if (isMethod) return `${ret} ${this.member(f.name)}(${params}) {`;
    const isAsync = this.asyncFuncs.has(f.name);
    return `${isAsync ? `Future<${ret}>` : ret} ${this.fn(f.name)}(${params})${isAsync ? ' async' : ''} {`;
  }

  protected override emitClass(c: ClassDecl): void {
    this.em.line(`class ${this.typeId(c.name)}${c.implements ? ` implements ${this.typeId(c.implements)}` : ''} {`);
    this.em.indent();
    for (const f of c.fields) this.em.line(`${this.typeName(f.type, f.id)} ${this.member(f.name)};`);
    if (c.fields.length) this.em.blank();
    this.em.line(`${this.typeId(c.name)}(${c.fields.map((f) => `this.${this.member(f.name)}`).join(', ')});`);
    const iface = c.implements ? this.program.interfaces.find((i) => i.name === c.implements) : undefined;
    for (const m of c.methods) {
      this.em.blank();
      if (iface?.methods.some((x) => x.name === m.name)) this.em.line('@override');
      this.emitFunc(m, c);
    }
    this.em.dedent();
    this.em.line('}');
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.em.line(`abstract class ${this.typeId(i.name)} {`);
    this.em.indent();
    for (const m of i.methods) this.em.line(`${this.typeName(m.ret, m.id)} ${this.member(m.name)}(${m.params.map((p) => `${this.typeName(p.type, m.id)} ${this.member(p.name)}`).join(', ')});`);
    this.em.dedent();
    this.em.line('}');
  }

  // ----- statements -----

  protected sPrint(s: S<'print'>): void {
    this.em.line(`print(${this.ex(s.value).c});`);
  }

  protected repeatOpen(count: string, counter: string): string {
    return `for (var ${counter} = 0; ${counter} < ${count}; ${counter}++) {`;
  }

  protected forRangeOpen(r: RangeInfo): string {
    const step = r.stepIsOne ? `${r.v}${r.desc ? '--' : '++'}` : `${r.v} ${r.desc ? '-=' : '+='} ${r.step}`;
    return `for (${r.declare ? this.typeName(r.type) + ' ' : ''}${r.v} = ${r.from}; ${r.v} ${r.desc ? '>=' : '<='} ${r.to}; ${step}) {`;
  }

  protected forEachOpen(v: string, iter: string, _s: S<'forEach'>, declare: boolean): string | [string, string] {
    if (declare) return `for (final ${v} in List.of(${iter})) {`;
    const tmp = this.names.fresh('item');
    return [`for (final ${tmp} in List.of(${iter})) {`, `${v} = ${tmp};`];
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.add(${this.valueFor(s.value, this.elemType(s.list))});`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.removeAt(${this.valueFor(s.index, T.int)});`);
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
    this.em.line(`} catch (${e}) {`);
    this.em.indent();
    this.bind(s, s.errVar, `${e}.toString().replaceFirst('Exception: ', '')`);
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
    this.em.line('}');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`throw Exception(${this.ex(s.message).c});`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    this.imp('dart:io');
    this.em.line(`File(${this.ex(s.path).c}).writeAsStringSync(${this.text(s.content)}${s.append ? ', mode: FileMode.append' : ''});`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.imp('dart:io');
    this.em.line(`sleep(Duration(milliseconds: ${paren(this.ex(s.ms), P.POST)}.toInt()));`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.imp('dart:io');
    this.em.line(`stdout.write(Process.runSync('sh', ['-c', ${this.ex(s.cmd).c}]).stdout);`);
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

  /** Dart's / always produces a double, even for two ints. */
  protected override eDivide(e: E<'bin'>): X {
    return this.bin('/', P.MUL, this.ex(e.l), this.ex(e.r));
  }

  protected override ePow(e: E<'bin'>): X {
    this.imp('dart:math');
    return post(`pow(${this.ex(e.l).c}, ${this.ex(e.r).c}).toDouble()`);
  }

  protected override eList(e: E<'list'>): X {
    const t = this.settle(e.t ?? T.list(T.int), 'list', e.id);
    const of = t.k === 'list' ? t.of : T.int;
    return atom(`<${this.typeName(of, e.id)}>[${e.items.map((i) => this.valueFor(i, of)).join(', ')}]`);
  }

  protected override eMap(e: E<'map'>): X {
    const m = this.settle(e.t ?? T.map(T.string, T.int), 'dictionary', e.id) as { key: TypeRef; value: TypeRef };
    return atom(`<${this.typeName(m.key, e.id)}, ${this.typeName(m.value, e.id)}>{}`);
  }

  protected override eMapGet(e: E<'mapGet'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}[${this.ex(e.key).c}]!`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.containsKey(${this.ex(e.key).c})`);
  }

  protected eLen(e: E<'len'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.length`);
  }

  protected eConcat(e: E<'concat'>): X {
    let out = "'";
    for (const p of e.parts) {
      if (p.k === 'str') out += this.str(p.value).slice(1, -1);
      else out += '${' + this.ex(p).c + '}';
    }
    return atom(out + "'");
  }

  protected eConvert(e: E<'convert'>): X {
    const from = e.e.t?.k;
    const x = this.recv(e.e);
    switch (e.to) {
      case 'int':
        return post(from === 'string' ? `int.parse(${this.ex(e.e).c}.trim())` : `${x}.toInt()`);
      case 'float':
        return post(from === 'string' ? `double.parse(${this.ex(e.e).c}.trim())` : `${x}.toDouble()`);
      case 'string':
        return post(`${x}.toString()`);
      case 'bool':
        return from === 'string' ? post(`${x}.isNotEmpty`) : from === 'bool' ? this.ex(e.e) : { c: `${x} != 0`, p: P.CMP };
    }
  }

  protected eInput(e: E<'input'>): X {
    this.imp('dart:io');
    this.helper('input', ['// Prints a prompt and reads one line of text.', 'String input(String prompt) {', '  stdout.write(prompt);', "  return stdin.readLineSync() ?? '';", '}']);
    const call = `input(${e.prompt.k === 'missing' ? "''" : this.ex(e.prompt).c})`;
    return post(e.numeric ? `double.parse(${call}.trim())` : call);
  }

  protected eMath(e: E<'math'>): X {
    const a = e.args.map((x) => this.ex(x).c);
    const isFloat = e.args.some((x) => x.t?.k === 'float');
    const lib = (code: string) => {
      this.imp('dart:math');
      return post(code);
    };
    switch (e.fn) {
      case 'abs':
        return post(`${this.recv(e.args[0])}.abs()`);
      case 'floor':
      case 'ceil':
      case 'round':
        return post(`${this.recv(e.args[0])}.${e.fn}()`);
      case 'min':
      case 'max': {
        const t = isFloat ? T.float : T.int;
        return lib(`${e.fn}(${e.args.map((x) => this.valueFor(x, t)).join(', ')})`);
      }
      case 'ln':
        return lib(`log(${a[0]})`);
      case 'log10':
        return lib(`(log(${a[0]}) / ln10)`);
      case 'pow10':
        return lib(`pow(10, ${a[0]}).toDouble()`);
      default:
        return lib(`${e.fn}(${a[0]})`);
    }
  }

  protected eRandom(e: E<'random'>): X {
    this.imp('dart:math');
    const lo = this.ex(e.from);
    return { c: `Random().nextInt(${paren(this.ex(e.to), P.ADD)} - ${paren(lo, P.ADD + 1)} + 1) + ${paren(lo, P.ADD + 1)}`, p: P.ADD };
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = paren(this.ex(e.args[0]), P.POST);
    if (e.op === 'contains') return post(`${a}.contains(${this.ex(e.args[1]).c})`);
    return post(`${a}.${{ upper: 'toUpperCase', lower: 'toLowerCase', trim: 'trim' }[e.op]}()`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    this.imp('dart:io');
    return post(`File(${this.ex(e.path).c}).readAsStringSync()`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.imp('dart:io');
    return post(`File(${this.ex(e.path).c}).existsSync()`);
  }

  protected override eJsonParse(e: E<'jsonParse'>): X {
    this.imp('dart:convert');
    return post(`jsonDecode(${this.ex(e.e).c})`);
  }

  protected override eJsonStringify(e: E<'jsonStringify'>): X {
    this.imp('dart:convert');
    return post(`jsonEncode(${this.ex(e.e).c})`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    this.imp('dart:io');
    this.imp('dart:convert');
    this.helper('httpGet', [
      '// Downloads a URL and returns the response body as text.',
      'Future<String> httpGet(String url) async {',
      '  final client = HttpClient();',
      '  final request = await client.getUrl(Uri.parse(url));',
      '  final response = await request.close();',
      '  final body = await response.transform(utf8.decoder).join();',
      '  client.close();',
      '  return body;',
      '}',
    ]);
    return { c: `await httpGet(${this.ex(e.url).c})`, p: P.UNARY };
  }

  protected override eShell(e: E<'shell'>): X {
    this.imp('dart:io');
    return post(`Process.runSync('sh', ['-c', ${this.ex(e.cmd).c}]).stdout.toString()`);
  }

  protected override eNew(e: E<'new'>): X {
    const cls = this.an.classes.get(e.name);
    return post(`${this.typeId(e.name)}(${this.args(e.args, cls?.fields.map((f) => f.type))})`);
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
}

export default new DartGenerator();
