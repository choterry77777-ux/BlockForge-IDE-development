import type { VarInfo } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, type InterfaceDecl, T, type TypeRef } from '../ir/types';
import { type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import type { Emitter } from './emitter';

export class CSharpGenerator extends ImperativeGenerator {
  readonly lang = 'csharp' as const;
  protected readonly reservedWords = ['abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while', 'var', 'Program', 'Main', 'Console', 'Math', 'Input', 'RandomInt', 'Shell', 'String', 'List', 'Dictionary', 'File', 'Exception'];
  protected override staticTypes = true;
  private usesFloat = false;

  private using(ns: string): void {
    this.imports.add(`using ${ns};`);
  }

  protected override importLine(module: string): string {
    return `using ${module};`;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) this.imports.add(this.importLine(s.module));
  }

  protected layout(): Emitter {
    this.usesFloat = false;
    this.using('System');
    const body = this.newEmitter();
    this.em = body;
    body.line('class Program');
    body.line('{');
    body.indent();
    const helperMark = body.count;
    for (const info of this.an.globals.values()) body.line(`static ${this.typeName(this.varType(info))} ${this.v(info.name)} = ${this.zero(this.varType(info))};`);
    if (this.an.globals.size) body.blank();
    this.emitDecls();
    body.line('static void Main()');
    body.line('{');
    body.indent();
    const mainMark = body.count;
    this.emitMain();
    body.dedent();
    body.line('}');
    body.dedent();
    body.line('}');
    const insert = (at: number, lines: string[]) => {
      body.lines.splice(at, 0, ...lines);
      for (const m of body.maps) {
        if (m.start > at) m.start += lines.length;
        if (m.end > at) m.end += lines.length;
      }
    };
    if (this.usesFloat) {
      // Decimal numbers print and parse the same way on every computer.
      this.using('System.Globalization');
      insert(mainMark, [`${this.indentUnit.repeat(2)}CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;`]);
    }
    const helperLines: string[] = [];
    for (const lines of this.helpers.values()) helperLines.push(...lines.map((l) => (l ? this.indentUnit + l : '')), '');
    insert(helperMark, helperLines);
    const out = this.newEmitter();
    for (const i of [...this.imports].sort()) out.line(i);
    out.blank();
    out.append(body);
    return out;
  }

  // Allman braces, the C# convention.
  private open(head: string): void {
    this.em.line(head);
    this.em.line('{');
    this.em.indent();
  }

  private close(): void {
    this.em.dedent();
    this.em.line('}');
  }

  protected override sIf(s: S<'if'>): void {
    s.branches.forEach((b, i) => {
      this.open(`${i ? 'else if' : 'if'} (${this.cond(b.cond)})`);
      this.body(b.body);
      this.close();
    });
    if (s.else && s.else.length) {
      this.open('else');
      this.body(s.else);
      this.close();
    }
  }

  protected override loopBody(open: string | [string, string], body: Parameters<ImperativeGenerator['body']>[0]): void {
    const [head, first] = typeof open === 'string' ? [open, undefined] : open;
    this.open(head.replace(/ \{$/, ''));
    if (first) this.em.line(first);
    if (first) for (const s of body) this.stmt(s);
    else this.body(body);
    this.close();
  }

  // ----- types -----

  protected override typeName(t: TypeRef, id?: string): string {
    switch (t.k) {
      case 'int':
        return 'int';
      case 'float':
        this.usesFloat = true;
        return 'double';
      case 'string':
        return 'string';
      case 'bool':
        return 'bool';
      case 'void':
        return 'void';
      case 'list': {
        this.using('System.Collections.Generic');
        const s = this.settle(t, 'list', id);
        return `List<${this.typeName(s.k === 'list' ? s.of : T.int, id)}>`;
      }
      case 'map': {
        this.using('System.Collections.Generic');
        const m = this.settle(t, 'dictionary', id) as { key: TypeRef; value: TypeRef };
        return `Dictionary<${this.typeName(m.key, id)}, ${this.typeName(m.value, id)}>`;
      }
      case 'struct':
        return this.typeId(t.name);
      case 'ptr':
        this.unsupported(id, 'pointers', 'Safe C# has no raw pointers.');
        return 'int';
      case 'func':
        this.unsupported(id, 'function values', 'A delegate type with an explicit signature is required.');
        return 'object';
      case 'any':
        return this.mixed(id);
      default:
        return 'int';
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
        return `new ${this.typeName(t)}()`;
      case 'struct':
        return this.an.classes.get(t.name)?.isStruct ? `new ${this.typeId(t.name)}()` : 'null';
      default:
        return '0';
    }
  }

  // ----- declarations -----

  protected override declare(name: string, info: VarInfo, init: string): void {
    const t = this.varType(info);
    const isConst = info.isConst && ['int', 'float', 'string', 'bool'].includes(t.k) && info.declNode?.k === 'varDecl' && ['num', 'str', 'bool'].includes(info.declNode.init?.k ?? '');
    this.em.line(`${isConst ? 'const ' : ''}${this.typeName(t, info.declNode?.id)} ${this.v(name)} = ${init};`);
  }

  protected override globalsDecl(): void {}

  protected override emitFunc(f: FuncDecl, owner?: ClassDecl): void {
    // Same as the base implementation but with the brace on its own line.
    const key = owner ? `${owner.name}.${f.name}` : f.name;
    const fi = owner ? this.an.methods.get(key) : this.an.funcs.get(key);
    if (!fi) return;
    const saved = { scope: this.scope, func: this.curFunc };
    this.scope = fi.scope;
    this.curFunc = f;
    const start = this.em.count;
    this.open(this.funcOpen(f, !!owner));
    this.hoist(fi.scope);
    for (const s of f.body) this.stmt(s);
    this.close();
    this.em.mark(f.id, start);
    this.scope = saved.scope;
    this.curFunc = saved.func;
  }

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const params = f.params.map((p) => `${this.typeName(isMethod ? p.type : this.paramType(p, f), f.id)} ${this.v(p.name)}`).join(', ');
    if (isMethod) return `public ${this.typeName(f.ret, f.id)} ${this.member(f.name)}(${params})`;
    return `static ${this.typeName(f.ret, f.id)} ${this.fn(f.name)}(${params})`;
  }

  protected override emitClass(c: ClassDecl): void {
    this.open(`${c.isStruct ? 'struct' : 'class'} ${this.typeId(c.name)}${c.implements ? ` : ${this.typeId(c.implements)}` : ''}`);
    for (const f of c.fields) this.em.line(`public ${this.typeName(f.type, f.id)} ${this.member(f.name)};`);
    if (c.fields.length) {
      this.em.blank();
      this.open(`public ${this.typeId(c.name)}(${c.fields.map((f) => `${this.typeName(f.type, f.id)} ${this.member(f.name)}`).join(', ')})`);
      for (const f of c.fields) this.em.line(`this.${this.member(f.name)} = ${this.member(f.name)};`);
      this.close();
    }
    for (const m of c.methods) {
      this.em.blank();
      this.emitFunc(m, c);
    }
    this.close();
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.open(`interface ${this.typeId(i.name)}`);
    for (const m of i.methods) this.em.line(`${this.typeName(m.ret, m.id)} ${this.member(m.name)}(${m.params.map((p) => `${this.typeName(p.type, m.id)} ${this.member(p.name)}`).join(', ')});`);
    this.close();
  }

  // ----- statements -----

  protected sPrint(s: S<'print'>): void {
    if (s.value.t?.k === 'float') this.usesFloat = true;
    if (s.value.t?.k === 'list') this.em.line(`Console.WriteLine("[" + string.Join(", ", ${this.ex(s.value).c}) + "]");`);
    else this.em.line(`Console.WriteLine(${this.ex(s.value).c});`);
  }

  protected override whileOpen(cond: string): string {
    return `while (${cond})`;
  }

  protected repeatOpen(count: string, counter: string): string {
    return `for (int ${counter} = 0; ${counter} < ${count}; ${counter}++)`;
  }

  protected forRangeOpen(r: RangeInfo): string {
    const step = r.stepIsOne ? `${r.v}${r.desc ? '--' : '++'}` : `${r.v} ${r.desc ? '-=' : '+='} ${r.step}`;
    return `for (${r.declare ? this.typeName(r.type) + ' ' : ''}${r.v} = ${r.from}; ${r.v} ${r.desc ? '>=' : '<='} ${r.to}; ${step})`;
  }

  protected forEachOpen(v: string, iter: string, s: S<'forEach'>, declare: boolean): string | [string, string] {
    const of = this.typeName(this.settle(this.elemType(s.iterable) ?? T.int, v, s.id), s.id);
    if (declare) return `foreach (${of} ${v} in ${iter})`;
    const tmp = this.names.fresh('item');
    return [`foreach (${of} ${tmp} in ${iter})`, `${v} = ${tmp};`];
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.Add(${this.valueFor(s.value, this.elemType(s.list))});`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.RemoveAt(${this.valueFor(s.index, T.int)});`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}.Remove(${this.ex(s.key).c});`);
  }

  protected override sTry(s: S<'try'>): void {
    const e = this.names.fresh('error');
    this.open('try');
    this.body(s.body);
    this.close();
    this.open(`catch (Exception ${e})`);
    this.bind(s, s.errVar, `${e}.Message`);
    for (const h of s.handler) this.stmt(h);
    this.close();
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`throw new Exception(${this.ex(s.message).c});`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    this.using('System.IO');
    this.em.line(`File.${s.append ? 'AppendAllText' : 'WriteAllText'}(${this.ex(s.path).c}, Convert.ToString(${this.ex(s.content).c}));`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.using('System.Threading');
    this.em.line(`Thread.Sleep((int)${paren(this.ex(s.ms), P.UNARY)});`);
  }

  private shellHelper(): void {
    this.using('System.Diagnostics');
    this.using('System.Runtime.InteropServices');
    this.helper('Shell', [
      '// Runs a shell command. When capture is true the printed text is returned.',
      'static string Shell(string command, bool capture)',
      '{',
      '    bool windows = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);',
      '    var info = new ProcessStartInfo(windows ? "cmd.exe" : "/bin/sh");',
      '    info.ArgumentList.Add(windows ? "/c" : "-c");',
      '    info.ArgumentList.Add(command);',
      '    info.RedirectStandardOutput = capture;',
      '    info.UseShellExecute = false;',
      '    using var process = Process.Start(info);',
      '    string output = capture ? process.StandardOutput.ReadToEnd() : "";',
      '    process.WaitForExit();',
      '    return output;',
      '}',
    ]);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.shellHelper();
    this.em.line(`Shell(${this.ex(s.cmd).c}, false);`);
  }

  // ----- expressions -----

  protected override toFloat(x: X): X {
    this.usesFloat = true;
    return { c: `(double)${paren(x, P.UNARY)}`, p: P.UNARY };
  }

  protected override eNum(e: E<'num'>): X {
    if (!e.isInt) this.usesFloat = true;
    return super.eNum(e);
  }

  protected override eCompare(e: E<'bin'>): X {
    if (e.l.t?.k === 'string' || e.r.t?.k === 'string') return { c: `string.CompareOrdinal(${this.ex(e.l).c}, ${this.ex(e.r).c}) ${e.op} 0`, p: P.CMP };
    return super.eCompare(e);
  }

  protected override eList(e: E<'list'>): X {
    const t = this.settle(e.t ?? T.list(T.int), 'list', e.id);
    const of = t.k === 'list' ? t.of : T.int;
    const name = this.typeName(T.list(of), e.id);
    return post(e.items.length ? `new ${name} { ${e.items.map((i) => this.valueFor(i, of)).join(', ')} }` : `new ${name}()`);
  }

  protected override eMap(e: E<'map'>): X {
    return post(`new ${this.typeName(this.settle(e.t ?? T.map(T.string, T.int), 'dictionary', e.id), e.id)}()`);
  }

  protected override eIndex(e: E<'index'>): X {
    const x = super.eIndex(e);
    return e.target.t?.k === 'string' ? post(`${x.c}.ToString()`) : x;
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.ContainsKey(${this.ex(e.key).c})`);
  }

  protected eLen(e: E<'len'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.${e.target.t?.k === 'string' ? 'Length' : 'Count'}`);
  }

  protected eConcat(e: E<'concat'>): X {
    if (e.parts.some((p) => p.t?.k === 'float')) this.usesFloat = true;
    const parts = e.parts.map((p, i) => (i === 0 && p.t?.k !== 'string' ? `Convert.ToString(${this.ex(p).c})` : paren(this.ex(p), P.ADD + 1)));
    return parts.length === 1 ? post(parts[0]) : { c: parts.join(' + '), p: P.ADD };
  }

  protected eConvert(e: E<'convert'>): X {
    const from = e.e.t?.k;
    const x = this.ex(e.e);
    switch (e.to) {
      case 'int':
        return from === 'string' ? post(`int.Parse(${x.c})`) : { c: `(int)${paren(x, P.UNARY)}`, p: P.UNARY };
      case 'float':
        this.usesFloat = true;
        return from === 'string' ? post(`double.Parse(${x.c})`) : { c: `(double)${paren(x, P.UNARY)}`, p: P.UNARY };
      case 'string':
        if (from === 'float') this.usesFloat = true;
        return post(`Convert.ToString(${x.c})`);
      case 'bool':
        return from === 'string' ? { c: `${paren(x, P.POST)}.Length > 0`, p: P.CMP } : from === 'bool' ? x : { c: `${paren(x, P.CMP + 1)} != 0`, p: P.CMP };
    }
  }

  protected eInput(e: E<'input'>): X {
    this.helper('Input', ['// Prints a prompt and reads one line of text.', 'static string Input(string prompt)', '{', '    Console.Write(prompt);', '    return Console.ReadLine() ?? "";', '}']);
    const call = `Input(${e.prompt.k === 'missing' ? '""' : this.ex(e.prompt).c})`;
    if (e.numeric) this.usesFloat = true;
    return post(e.numeric ? `double.Parse(${call})` : call);
  }

  protected eMath(e: E<'math'>): X {
    const a = e.args.map((x) => this.ex(x).c);
    const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
    switch (e.fn) {
      case 'floor':
        return { c: `(int)Math.Floor(${this.valueFor(e.args[0], T.float)})`, p: P.UNARY };
      case 'ceil':
        return { c: `(int)Math.Ceiling(${this.valueFor(e.args[0], T.float)})`, p: P.UNARY };
      case 'round':
        return { c: `(int)Math.Round(${this.valueFor(e.args[0], T.float)}, MidpointRounding.AwayFromZero)`, p: P.UNARY };
      case 'ln':
        return post(`Math.Log(${a[0]})`);
      case 'pow10':
        return post(`Math.Pow(10, ${a[0]})`);
      default:
        return post(`Math.${cap(e.fn)}(${a.join(', ')})`);
    }
  }

  protected override ePow(e: E<'bin'>): X {
    return post(`Math.Pow(${this.ex(e.l).c}, ${this.ex(e.r).c})`);
  }

  protected eRandom(e: E<'random'>): X {
    return post(`Random.Shared.Next(${this.ex(e.from).c}, ${paren(this.ex(e.to), P.ADD)} + 1)`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = paren(this.ex(e.args[0]), P.POST);
    if (e.op === 'contains') return post(`${a}.Contains(${this.ex(e.args[1]).c})`);
    return post(`${a}.${{ upper: 'ToUpper', lower: 'ToLower', trim: 'Trim' }[e.op]}()`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    this.using('System.IO');
    return post(`File.ReadAllText(${this.ex(e.path).c})`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.using('System.IO');
    return post(`File.Exists(${this.ex(e.path).c})`);
  }

  protected override eJsonStringify(e: E<'jsonStringify'>): X {
    this.using('System.Text.Json');
    return post(`JsonSerializer.Serialize(${this.ex(e.e).c})`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    this.using('System.Net.Http');
    return post(`new HttpClient().GetStringAsync(${this.ex(e.url).c}).Result`);
  }

  protected override eShell(e: E<'shell'>): X {
    this.shellHelper();
    return post(`Shell(${this.ex(e.cmd).c}, true)`);
  }

  protected override eMethod(e: E<'method'>): X {
    return super.eMethod(e);
  }

  protected isStr(e: Expr): boolean {
    return e.t?.k === 'string';
  }
}

export default new CSharpGenerator();
