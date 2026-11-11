import { hasControlFlow, type ScopeInfo, type VarInfo } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, type InterfaceDecl, T, type TypeRef } from '../ir/types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import type { Emitter } from './emitter';

export class GoGenerator extends ImperativeGenerator {
  readonly lang = 'go' as const;
  protected readonly reservedWords = ['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var', 'true', 'false', 'nil', 'int', 'float64', 'string', 'bool', 'any', 'error', 'len', 'cap', 'append', 'make', 'new', 'panic', 'recover', 'print', 'println', 'main', 'fmt', 'math', 'os', 'strings', 'strconv', 'time', 'rand', 'bufio', 'min', 'max', 'input', 'stdin', 'choose', 'hasKey', 'toInt', 'toFloat', 'absInt', 'readFile', 'writeFile', 'fileExists', 'httpGet', 'toJSON', 'shell', 'this', 'copy', 'delete', 'close', 'complex', 'real', 'imag', 'init'];
  protected override staticTypes = true;
  protected override strictNumeric = true;
  protected override strictArith = true;
  protected override stmtEnd = '';
  protected override indentUnit = '\t';

  private imp(pkg: string): void {
    this.imports.add(pkg);
  }

  protected override importLine(module: string): string {
    return module;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) {
      this.imports.add(s.module);
      // Go rejects unused imports, so keep the package referenced.
      this.report('info', 'gen.goImport', `Go refuses to compile a program with an unused import. Use something from "${s.module}" with a raw code block.`, s.id, { module: s.module });
    }
  }

  protected layout(): Emitter {
    const body = this.em;
    this.emitDecls();
    body.line('func main() {');
    body.indent();
    this.emitMain();
    body.dedent();
    body.line('}');
    const out = this.newEmitter();
    out.line('package main');
    out.blank();
    const imports = [...this.imports].sort();
    if (imports.length === 1) out.line(`import "${imports[0]}"`);
    else if (imports.length) {
      out.line('import (');
      for (const i of imports) out.line(`\t"${i}"`);
      out.line(')');
    }
    if (imports.length) out.blank();
    for (const info of this.an.globals.values()) out.line(`var ${this.v(info.name)} ${this.typeName(this.varType(info))}`);
    if (this.an.globals.size) out.blank();
    for (const lines of this.helpers.values()) {
      out.block(lines);
      out.blank();
    }
    out.append(body);
    return out;
  }

  // ----- types -----

  protected override typeName(t: TypeRef, id?: string): string {
    switch (t.k) {
      case 'int':
        return 'int';
      case 'float':
        return 'float64';
      case 'string':
        return 'string';
      case 'bool':
        return 'bool';
      case 'void':
        return '';
      case 'list': {
        const s = this.settle(t, 'list', id);
        return `[]${this.typeName(s.k === 'list' ? s.of : T.int, id)}`;
      }
      case 'map': {
        const m = this.settle(t, 'dictionary', id) as { key: TypeRef; value: TypeRef };
        return `map[${this.typeName(m.key, id)}]${this.typeName(m.value, id)}`;
      }
      case 'struct': {
        const cls = this.an.classes.get(t.name);
        return cls && !cls.isStruct ? `*${this.typeId(t.name)}` : this.typeId(t.name);
      }
      case 'ptr':
        return `*${this.typeName(t.to, id)}`;
      case 'func':
        this.unsupported(id, 'function values', 'A func type with an explicit signature is required.');
        return 'any';
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
        return `${this.typeName(t)}{}`;
      case 'struct':
        return this.an.classes.get(t.name)?.isStruct ? `${this.typeId(t.name)}{}` : 'nil';
      case 'ptr':
        return 'nil';
      default:
        return '0';
    }
  }

  protected override nullLiteral(): string {
    return 'nil';
  }

  // ----- declarations -----

  protected override declare(name: string, info: VarInfo, init: string): void {
    const t = this.varType(info);
    const id = this.v(name);
    // An explicit type is needed when the literal alone would infer something else.
    const explicit = info.explicitType || t.k === 'ptr' || (t.k === 'struct' && init === 'nil');
    this.em.line(explicit ? `var ${id} ${this.typeName(t, info.declNode?.id)} = ${init}` : `${id} := ${init}`);
    if (!info.read) this.em.line(`_ = ${id}`);
  }

  protected override hoist(scope: ScopeInfo): void {
    for (const name of scope.hoisted) {
      const info = scope.vars.get(name)!;
      this.em.line(`var ${this.v(name)} ${this.typeName(this.varType(info))}`);
      if (!info.read) this.em.line(`_ = ${this.v(name)}`);
    }
  }

  protected override globalsDecl(): void {}

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const params = f.params.map((p) => `${this.v(p.name)} ${this.typeName(isMethod ? p.type : this.paramType(p, f), f.id)}`).join(', ');
    const ret = this.typeName(f.ret, f.id);
    if (isMethod) return `func (this *${this.typeId(this.curClass!.name)}) ${this.member(f.name)}(${params})${ret ? ' ' + ret : ''} {`;
    return `func ${this.fn(f.name)}(${params})${ret ? ' ' + ret : ''} {`;
  }

  protected override emitClass(c: ClassDecl): void {
    this.em.line(`type ${this.typeId(c.name)} struct {`);
    this.em.indent();
    for (const f of c.fields) this.em.line(`${this.member(f.name)} ${this.typeName(f.type, f.id)}`);
    this.em.dedent();
    this.em.line('}');
    for (const m of c.methods) {
      this.em.blank();
      this.emitFunc(m, c);
    }
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.em.line(`type ${this.typeId(i.name)} interface {`);
    this.em.indent();
    for (const m of i.methods) {
      const ret = this.typeName(m.ret, m.id);
      this.em.line(`${this.member(m.name)}(${m.params.map((p) => `${this.member(p.name)} ${this.typeName(p.type, m.id)}`).join(', ')})${ret ? ' ' + ret : ''}`);
    }
    this.em.dedent();
    this.em.line('}');
  }

  // ----- statements -----

  protected override ifOpen(cond: string, first: boolean): string {
    return first ? `if ${cond} {` : `} else if ${cond} {`;
  }

  protected override whileOpen(cond: string): string {
    return cond === 'true' ? 'for {' : `for ${cond} {`;
  }

  protected sPrint(s: S<'print'>): void {
    this.imp('fmt');
    this.em.line(`fmt.Println(${this.ex(s.value).c})`);
  }

  protected repeatOpen(count: string, counter: string): string {
    return `for ${counter} := 0; ${counter} < ${count}; ${counter}++ {`;
  }

  protected forRangeOpen(r: RangeInfo): string {
    const step = r.stepIsOne ? `${r.v}${r.desc ? '--' : '++'}` : `${r.v} ${r.desc ? '-=' : '+='} ${r.step}`;
    return `for ${r.v} ${r.declare ? ':=' : '='} ${r.from}; ${r.v} ${r.desc ? '>=' : '<='} ${r.to}; ${step} {`;
  }

  protected forEachOpen(v: string, iter: string, s: S<'forEach'>, declare: boolean): string | [string, string] {
    if (declare) return this.info(s.var)?.read ? `for _, ${v} := range ${iter} {` : `for range ${iter} {`;
    const tmp = this.names.fresh('item');
    return [`for _, ${tmp} := range ${iter} {`, `${v} = ${tmp}`];
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    const l = this.ex(s.list).c;
    this.em.line(`${l} = append(${l}, ${this.valueFor(s.value, this.elemType(s.list))})`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    const l = this.ex(s.list).c;
    const i = this.ex(s.index);
    this.em.line(`${l} = append(${l}[:${i.c}], ${l}[${paren(i, P.ADD)}+1:]...)`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`delete(${this.ex(s.map).c}, ${this.ex(s.key).c})`);
  }

  protected override sTry(s: S<'try'>): void {
    this.imp('fmt');
    if (hasControlFlow(s.body) || hasControlFlow(s.handler)) {
      this.report('error', 'gen.tryControlFlow', 'Go models try/catch with panic and recover inside a function literal, so return, break and continue cannot be used inside it.', s.id);
    }
    const r = this.names.fresh('problem');
    this.em.line('func() {');
    this.em.indent();
    this.em.line('defer func() {');
    this.em.indent();
    this.em.line(`if ${r} := recover(); ${r} != nil {`);
    this.em.indent();
    this.bind(s, s.errVar, `fmt.Sprint(${r})`);
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
    this.em.line('}');
    this.em.dedent();
    this.em.line('}()');
    this.body(s.body);
    this.em.dedent();
    this.em.line('}()');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`panic(${this.ex(s.message).c})`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    this.imp('os');
    this.imp('fmt');
    this.helper('writeFile', [
      '// writeFile writes text to a file, replacing or extending it.',
      'func writeFile(path string, text string, extend bool) {',
      '\tflags := os.O_CREATE | os.O_WRONLY | os.O_TRUNC',
      '\tif extend {',
      '\t\tflags = os.O_CREATE | os.O_WRONLY | os.O_APPEND',
      '\t}',
      '\tfile, err := os.OpenFile(path, flags, 0644)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tdefer file.Close()',
      '\tfile.WriteString(text)',
      '}',
    ]);
    this.em.line(`writeFile(${this.ex(s.path).c}, ${this.text(s.content)}, ${s.append})`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.imp('time');
    this.em.line(`time.Sleep(time.Duration(${this.ex(s.ms).c}) * time.Millisecond)`);
  }

  private shellHelper(): void {
    this.imp('os');
    this.imp('os/exec');
    this.helper('shell', [
      '// shell runs a command. When capture is true the printed text is returned.',
      'func shell(command string, capture bool) string {',
      '\tcmd := exec.Command("sh", "-c", command)',
      '\tcmd.Stderr = os.Stderr',
      '\tif capture {',
      '\t\tout, _ := cmd.Output()',
      '\t\treturn string(out)',
      '\t}',
      '\tcmd.Stdout = os.Stdout',
      '\tcmd.Run()',
      '\treturn ""',
      '}',
    ]);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.shellHelper();
    this.em.line(`shell(${this.ex(s.cmd).c}, false)`);
  }

  protected override sDerefSet(s: S<'derefSet'>): void {
    const to = s.ptr.t?.k === 'ptr' ? s.ptr.t.to : undefined;
    this.em.line(`*${paren(this.ex(s.ptr), P.UNARY)} = ${this.valueFor(s.value, to)}`);
  }

  // ----- expressions -----

  protected override toFloat(x: X): X {
    return post(`float64(${x.c})`);
  }

  private text(e: Expr): string {
    if (e.t?.k === 'string') return paren(this.ex(e), P.ADD + 1);
    this.imp('fmt');
    return `fmt.Sprint(${this.ex(e).c})`;
  }

  protected override ePow(e: E<'bin'>): X {
    this.imp('math');
    return post(`math.Pow(${this.valueFor(e.l, T.float)}, ${this.valueFor(e.r, T.float)})`);
  }

  protected override eBin(e: E<'bin'>): X {
    if (e.op === '%' && e.t?.k === 'float') {
      this.imp('math');
      return post(`math.Mod(${this.valueFor(e.l, T.float)}, ${this.valueFor(e.r, T.float)})`);
    }
    return super.eBin(e);
  }

  protected override eTernary(e: E<'ternary'>): X {
    this.helper('choose', ['// choose returns a when the condition holds, otherwise b. Both values are evaluated.', 'func choose[T any](condition bool, a T, b T) T {', '\tif condition {', '\t\treturn a', '\t}', '\treturn b', '}']);
    this.warnOnce('choose', 'gen.eagerTernary', 'Go has no conditional expression. The generated helper evaluates both values before choosing one.', e.id, undefined, 'info');
    const t = e.t;
    return post(`choose(${this.ex(e.cond).c}, ${this.valueFor(e.a, t)}, ${this.valueFor(e.b, t)})`);
  }

  protected override eList(e: E<'list'>): X {
    const t = this.settle(e.t ?? T.list(T.int), 'list', e.id);
    const of = t.k === 'list' ? t.of : T.int;
    return post(`${this.typeName(T.list(of), e.id)}{${e.items.map((i) => this.valueFor(i, of)).join(', ')}}`);
  }

  protected override eMap(e: E<'map'>): X {
    return post(`${this.typeName(this.settle(e.t ?? T.map(T.string, T.int), 'dictionary', e.id), e.id)}{}`);
  }

  protected override eIndex(e: E<'index'>): X {
    const x = super.eIndex(e);
    return e.target.t?.k === 'string' ? post(`string(${x.c})`) : x;
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    this.helper('hasKey', ['// hasKey reports whether a map contains a key.', 'func hasKey[K comparable, V any](m map[K]V, key K) bool {', '\t_, ok := m[key]', '\treturn ok', '}']);
    return post(`hasKey(${this.ex(e.target).c}, ${this.ex(e.key).c})`);
  }

  protected eLen(e: E<'len'>): X {
    return post(`len(${this.ex(e.target).c})`);
  }

  protected eConcat(e: E<'concat'>): X {
    return { c: e.parts.map((p) => this.text(p)).join(' + '), p: e.parts.length === 1 ? P.POST : P.ADD };
  }

  protected eConvert(e: E<'convert'>): X {
    const from = e.e.t?.k;
    const x = this.ex(e.e);
    switch (e.to) {
      case 'int':
        if (from === 'string') {
          this.imp('strconv');
          this.imp('strings');
          this.helper('toInt', ['// toInt reads a whole number from text. Invalid text gives 0.', 'func toInt(text string) int {', '\tn, _ := strconv.Atoi(strings.TrimSpace(text))', '\treturn n', '}']);
          return post(`toInt(${x.c})`);
        }
        // Go refuses to truncate a constant, so literals are converted here.
        if (e.e.k === 'num') return atom(String(Math.trunc(e.e.value)));
        return post(`int(${x.c})`);
      case 'float':
        if (from === 'string') {
          this.imp('strconv');
          this.imp('strings');
          this.helper('toFloat', ['// toFloat reads a decimal number from text. Invalid text gives 0.', 'func toFloat(text string) float64 {', '\tf, _ := strconv.ParseFloat(strings.TrimSpace(text), 64)', '\treturn f', '}']);
          return post(`toFloat(${x.c})`);
        }
        return post(`float64(${x.c})`);
      case 'string':
        return post(this.text(e.e));
      case 'bool':
        return from === 'string' ? { c: `${x.c} != ""`, p: P.CMP } : from === 'bool' ? x : { c: `${paren(x, P.CMP + 1)} != 0`, p: P.CMP };
    }
  }

  protected eInput(e: E<'input'>): X {
    this.imp('bufio');
    this.imp('fmt');
    this.imp('os');
    this.imp('strings');
    this.helper('input', ['var stdin = bufio.NewReader(os.Stdin)', '', '// input prints a prompt and reads one line of text.', 'func input(prompt string) string {', '\tfmt.Print(prompt)', "\tline, _ := stdin.ReadString('\\n')", '\treturn strings.TrimRight(line, "\\r\\n")', '}']);
    const call = `input(${e.prompt.k === 'missing' ? '""' : this.ex(e.prompt).c})`;
    if (!e.numeric) return post(call);
    this.imp('strconv');
    this.helper('toFloat', ['// toFloat reads a decimal number from text. Invalid text gives 0.', 'func toFloat(text string) float64 {', '\tf, _ := strconv.ParseFloat(strings.TrimSpace(text), 64)', '\treturn f', '}']);
    return post(`toFloat(${call})`);
  }

  protected eMath(e: E<'math'>): X {
    const isFloat = e.args.some((x) => x.t?.k === 'float');
    const f = (x: Expr) => this.valueFor(x, T.float);
    const m = (fn: string, ...args: string[]) => {
      this.imp('math');
      return post(`math.${fn}(${args.join(', ')})`);
    };
    const a0 = e.args[0];
    switch (e.fn) {
      case 'abs':
        if (isFloat) return m('Abs', f(a0));
        this.helper('absInt', ['func absInt(n int) int {', '\tif n < 0 {', '\t\treturn -n', '\t}', '\treturn n', '}']);
        return post(`absInt(${this.ex(a0).c})`);
      case 'floor':
        return post(`int(${m('Floor', f(a0)).c})`);
      case 'ceil':
        return post(`int(${m('Ceil', f(a0)).c})`);
      case 'round':
        return post(`int(${m('Round', f(a0)).c})`);
      case 'min':
      case 'max': {
        const t = isFloat ? T.float : T.int;
        return post(`${e.fn}(${e.args.map((x) => this.valueFor(x, t)).join(', ')})`);
      }
      case 'ln':
        return m('Log', f(a0));
      case 'log10':
        return m('Log10', f(a0));
      case 'pow10':
        return m('Pow', '10', f(a0));
      default:
        return m(e.fn[0].toUpperCase() + e.fn.slice(1), f(a0));
    }
  }

  protected eRandom(e: E<'random'>): X {
    this.imp('math/rand');
    const lo = this.ex(e.from);
    return { c: `rand.Intn(${paren(this.ex(e.to), P.ADD)} - ${paren(lo, P.ADD + 1)} + 1) + ${paren(lo, P.ADD + 1)}`, p: P.ADD };
  }

  protected eStrOp(e: E<'strOp'>): X {
    this.imp('strings');
    const a = this.ex(e.args[0]).c;
    if (e.op === 'contains') return post(`strings.Contains(${a}, ${this.ex(e.args[1]).c})`);
    return post(`strings.${{ upper: 'ToUpper', lower: 'ToLower', trim: 'TrimSpace' }[e.op]}(${a})`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    this.imp('os');
    this.helper('readFile', ['// readFile returns the whole file as text, or empty text when it cannot be read.', 'func readFile(path string) string {', '\tdata, err := os.ReadFile(path)', '\tif err != nil {', '\t\treturn ""', '\t}', '\treturn string(data)', '}']);
    return post(`readFile(${this.ex(e.path).c})`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.imp('os');
    this.helper('fileExists', ['func fileExists(path string) bool {', '\t_, err := os.Stat(path)', '\treturn err == nil', '}']);
    return post(`fileExists(${this.ex(e.path).c})`);
  }

  protected override eJsonStringify(e: E<'jsonStringify'>): X {
    this.imp('encoding/json');
    this.helper('toJSON', ['// toJSON encodes a value as JSON text.', 'func toJSON(value any) string {', '\tdata, err := json.Marshal(value)', '\tif err != nil {', '\t\treturn ""', '\t}', '\treturn string(data)', '}']);
    return post(`toJSON(${this.ex(e.e).c})`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    this.imp('io');
    this.imp('net/http');
    this.helper('httpGet', ['// httpGet downloads a URL and returns the response body as text.', 'func httpGet(url string) string {', '\tresponse, err := http.Get(url)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer response.Body.Close()', '\tdata, _ := io.ReadAll(response.Body)', '\treturn string(data)', '}']);
    return post(`httpGet(${this.ex(e.url).c})`);
  }

  protected override eShell(e: E<'shell'>): X {
    this.shellHelper();
    return post(`shell(${this.ex(e.cmd).c}, true)`);
  }

  protected override eNew(e: E<'new'>): X {
    const cls = this.an.classes.get(e.name);
    const lit = `${this.typeId(e.name)}{${this.args(e.args, cls?.fields.map((f) => f.type))}}`;
    return cls && !cls.isStruct ? { c: `&${lit}`, p: P.UNARY } : post(lit);
  }

  protected override eAddrOf(e: E<'addrOf'>): X {
    return { c: `&${this.v(e.name)}`, p: P.UNARY };
  }

  protected override eDeref(e: E<'deref'>): X {
    return { c: `*${paren(this.ex(e.e), P.UNARY)}`, p: P.UNARY };
  }

  protected override eAwait(e: E<'await'>): X {
    return super.eAwait(e);
  }
}

export default new GoGenerator();
export { atom };
