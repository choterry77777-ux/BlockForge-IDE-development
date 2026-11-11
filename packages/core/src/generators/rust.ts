import type { ScopeInfo, VarInfo } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, type InterfaceDecl, T, type TypeRef } from '../ir/types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import { type Emitter, quote } from './emitter';

export class RustGenerator extends ImperativeGenerator {
  readonly lang = 'rust' as const;
  protected readonly reservedWords = ['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv', 'try', 'typeof', 'unsized', 'virtual', 'yield', 'main', 'String', 'Vec', 'HashMap', 'Option', 'Result', 'input', 'random_int', 'std', 'i64', 'f64', 'bool', 'str', 'usize'];
  protected override staticTypes = true;
  protected override strictNumeric = true;
  protected override strictArith = true;

  private use(path: string): void {
    this.imports.add(`use ${path};`);
  }

  protected override importLine(module: string): string {
    return `use ${module};`;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) this.imports.add(this.importLine(s.module));
  }

  protected layout(): Emitter {
    if (this.an.globals.size) {
      const first = [...this.an.globals.values()][0];
      this.unsupported(first.declNode?.id, 'variables shared between the main program and functions', 'Safe Rust has no mutable global variables. Pass the value as a parameter and return the result instead.');
    }
    const body = this.em;
    this.emitDecls();
    body.line('fn main() {');
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
        return 'i64';
      case 'float':
        return 'f64';
      case 'string':
        return 'String';
      case 'bool':
        return 'bool';
      case 'void':
        return '()';
      case 'list': {
        const s = this.settle(t, 'list', id);
        return `Vec<${this.typeName(s.k === 'list' ? s.of : T.int, id)}>`;
      }
      case 'map': {
        this.use('std::collections::HashMap');
        const m = this.settle(t, 'dictionary', id) as { key: TypeRef; value: TypeRef };
        return `HashMap<${this.typeName(m.key, id)}, ${this.typeName(m.value, id)}>`;
      }
      case 'struct':
        return this.typeId(t.name);
      case 'ptr':
        return `&mut ${this.typeName(t.to, id)}`;
      case 'func':
        this.unsupported(id, 'function values', 'A fn type with an explicit signature is required.');
        return 'i64';
      case 'any':
        return this.mixed(id);
      default:
        return 'i64';
    }
  }

  protected override zero(t: TypeRef): string {
    switch (t.k) {
      case 'float':
        return '0.0';
      case 'string':
        return 'String::new()';
      case 'bool':
        return 'false';
      case 'list':
        return 'Vec::new()';
      case 'map':
        this.use('std::collections::HashMap');
        return 'HashMap::new()';
      case 'struct': {
        const cls = this.an.classes.get(t.name);
        return `${this.typeId(t.name)} { ${(cls?.fields ?? []).map((f) => `${this.member(f.name)}: ${this.zero(f.type)}`).join(', ')} }`;
      }
      default:
        return '0';
    }
  }

  protected override str(s: string): string {
    return `String::from(${this.lit(s)})`;
  }

  private lit(s: string): string {
    return quote(s, { control: 'ubrace' });
  }

  private isCopy(t: TypeRef | undefined): boolean {
    return !!t && ['int', 'float', 'bool', 'void'].includes(t.k);
  }

  /** Values that own memory are cloned when they flow into another owner. */
  protected override valueFor(e: Expr, target?: TypeRef, min = 0): string {
    const code = super.valueFor(e, target, min);
    if ((e.k === 'var' || e.k === 'field' || e.k === 'index' || e.k === 'mapGet') && !this.isCopy(e.t) && e.t?.k !== 'ptr') return `${paren({ c: code, p: e.k === 'var' ? P.ATOM : P.POST }, P.POST)}.clone()`;
    return code;
  }

  /** A &str view of a text expression, without allocating for literals. */
  private strRef(e: Expr): string {
    if (e.k === 'str') return this.lit(e.value);
    return `${paren(this.ex(e), P.POST)}.as_str()`;
  }

  // ----- declarations -----

  protected override declare(name: string, info: VarInfo, init: string): void {
    const t = this.varType(info);
    const mut = (info.reassigned || info.mutated) && !info.isConst ? 'mut ' : '';
    this.em.line(`let ${mut}${this.v(name)}: ${this.typeName(t, info.declNode?.id)} = ${init};`);
  }

  protected override hoist(scope: ScopeInfo): void {
    for (const name of scope.hoisted) {
      const info = scope.vars.get(name)!;
      this.em.line(`let mut ${this.v(name)}: ${this.typeName(this.varType(info))} = ${this.zero(this.varType(info))};`);
    }
  }

  protected override globalsDecl(): void {}

  protected override sAssign(s: S<'assign'>): void {
    if (this.isGlobal(s.name)) return;
    super.sAssign(s);
  }

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const info = isMethod ? this.an.methods.get(`${this.curClass!.name}.${f.name}`) : this.an.funcs.get(f.name);
    const params = f.params.map((p) => {
      const v = info?.scope.vars.get(p.name);
      return `${v?.reassigned || v?.mutated ? 'mut ' : ''}${this.v(p.name)}: ${this.typeName(isMethod ? p.type : this.paramType(p, f), f.id)}`;
    });
    const ret = f.ret.k === 'void' ? '' : ` -> ${this.typeName(f.ret, f.id)}`;
    if (isMethod) return `fn ${this.member(f.name)}(${['&mut self', ...params].join(', ')})${ret} {`;
    return `fn ${this.fn(f.name)}(${params.join(', ')})${ret} {`;
  }

  protected override emitClass(c: ClassDecl): void {
    const name = this.typeId(c.name);
    this.em.line('#[derive(Clone, Debug)]');
    this.em.line(`struct ${name} {`);
    this.em.indent();
    for (const f of c.fields) this.em.line(`${this.member(f.name)}: ${this.typeName(f.type, f.id)},`);
    this.em.dedent();
    this.em.line('}');
    const iface = c.implements ? this.program.interfaces.find((i) => i.name === c.implements) : undefined;
    const own = c.methods.filter((m) => !iface?.methods.some((x) => x.name === m.name));
    const shared = c.methods.filter((m) => iface?.methods.some((x) => x.name === m.name));
    const block = (head: string, methods: FuncDecl[]) => {
      if (!methods.length) return;
      this.em.blank();
      this.em.line(head);
      this.em.indent();
      methods.forEach((m, i) => {
        if (i) this.em.blank();
        this.emitFunc(m, c);
      });
      this.em.dedent();
      this.em.line('}');
    };
    block(`impl ${name} {`, own);
    if (iface) block(`impl ${this.typeId(iface.name)} for ${name} {`, shared);
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.em.line(`trait ${this.typeId(i.name)} {`);
    this.em.indent();
    for (const m of i.methods) {
      const ret = m.ret.k === 'void' ? '' : ` -> ${this.typeName(m.ret, m.id)}`;
      this.em.line(`fn ${this.member(m.name)}(${['&mut self', ...m.params.map((p) => `${this.member(p.name)}: ${this.typeName(p.type, m.id)}`)].join(', ')})${ret};`);
    }
    this.em.dedent();
    this.em.line('}');
  }

  // ----- statements -----

  protected override ifOpen(cond: string, first: boolean): string {
    return first ? `if ${cond} {` : `} else if ${cond} {`;
  }

  protected override whileOpen(cond: string): string {
    return cond === 'true' ? 'loop {' : `while ${cond} {`;
  }

  /** println!/format! pieces: literals are inlined into the format string. */
  private format(parts: Expr[]): { fmt: string; args: string[] } {
    let fmt = '';
    const args: string[] = [];
    for (const p of parts) {
      if (p.k === 'str') fmt += p.value.replace(/[{}]/g, (m) => m + m);
      else {
        fmt += p.t?.k === 'list' || p.t?.k === 'map' || p.t?.k === 'struct' ? '{:?}' : '{}';
        args.push(this.ex(p).c);
      }
    }
    return { fmt, args };
  }

  protected sPrint(s: S<'print'>): void {
    const { fmt, args } = this.format(s.value.k === 'concat' ? s.value.parts : [s.value]);
    this.em.line(`println!(${[this.lit(fmt), ...args].join(', ')});`);
  }

  protected repeatOpen(count: string): string {
    return `for _ in 0..${paren({ c: count, p: /^[\w.]+$/.test(count) ? P.ATOM : P.LOW }, P.ATOM)} {`;
  }

  protected forRangeOpen(r: RangeInfo, s: S<'forRange'>): string | [string, string] {
    if (r.type.k !== 'int') this.unsupported(s.id, 'counting loops over decimal numbers', 'Rust ranges need whole numbers.');
    const bound = (code: string) => (/^-?[\w.]+$/.test(code) ? code : `(${code})`);
    let range = r.desc ? `(${bound(r.to)}..=${bound(r.from)}).rev()` : `${bound(r.from)}..=${bound(r.to)}`;
    if (!r.stepIsOne) range = `${r.desc ? range : `(${range})`}.step_by(${bound(r.step)} as usize)`;
    if (r.declare) return `for ${r.v} in ${range} {`;
    const tmp = this.names.fresh('step');
    return [`for ${tmp} in ${range} {`, `${r.v} = ${tmp};`];
  }

  protected forEachOpen(v: string, iter: string, _s: S<'forEach'>, declare: boolean): string | [string, string] {
    if (declare) return `for ${v} in ${iter}.clone() {`;
    const tmp = this.names.fresh('item');
    return [`for ${tmp} in ${iter}.clone() {`, `${v} = ${tmp};`];
  }

  protected override sReturn(s: S<'return'>): void {
    if (!s.value) this.em.line('return;');
    else this.em.line(`return ${super.valueFor(s.value, this.curFunc?.ret)};`);
  }

  private idx(e: Expr): string {
    return e.k === 'num' && e.isInt && e.value >= 0 ? String(e.value) : `${paren(this.ex(e), P.UNARY + 1)} as usize`;
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.push(${this.valueFor(s.value, this.elemType(s.list))});`);
  }

  protected override sListSet(s: S<'listSet'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}[${this.idx(s.index)}] = ${this.valueFor(s.value, this.elemType(s.list))};`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.remove(${this.idx(s.index)});`);
  }

  protected override sMapSet(s: S<'mapSet'>): void {
    const m = s.map.t?.k === 'map' ? s.map.t : undefined;
    this.em.line(`${paren(this.ex(s.map), P.POST)}.insert(${this.valueFor(s.key, m?.key)}, ${this.valueFor(s.value, m?.value)});`);
  }

  private keyRef(e: Expr): string {
    if (e.k === 'str') return this.lit(e.value);
    return `&${paren(this.ex(e), P.UNARY)}`;
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}.remove(${this.keyRef(s.key)});`);
  }

  protected override sTry(s: S<'try'>): void {
    this.unsupportedStmt(s, 'try/catch error handling', 'Rust handles errors with Result values instead of exceptions.');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`panic!("{}", ${this.ex(s.message).c});`);
  }

  protected override sFieldSet(s: S<'fieldSet'>): void {
    const cls = s.target.t?.k === 'struct' ? this.an.classes.get(s.target.t.name) : undefined;
    const ft = cls?.fields.find((f) => f.name === s.name)?.type;
    this.em.line(`${paren(this.ex(s.target), P.POST)}.${this.member(s.name)} = ${this.valueFor(s.value, ft)};`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    const text = s.content.t?.k === 'string' ? this.ex(s.content).c : `${paren(this.ex(s.content), P.POST)}.to_string()`;
    if (!s.append) {
      this.em.line(`std::fs::write(${this.strRef(s.path)}, ${text}).expect("could not write the file");`);
      return;
    }
    this.use('std::io::Write');
    const f = this.names.fresh('file');
    this.em.line(`let mut ${f} = std::fs::OpenOptions::new().create(true).append(true).open(${this.strRef(s.path)}).expect("could not open the file");`);
    this.em.line(`${f}.write_all(${text}.as_bytes()).expect("could not write the file");`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.em.line(`std::thread::sleep(std::time::Duration::from_millis(${paren(this.ex(s.ms), P.UNARY + 1)} as u64));`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.em.line(`std::process::Command::new("sh").arg("-c").arg(${this.strRef(s.cmd)}).status().expect("could not run the command");`);
  }

  protected override sDerefSet(s: S<'derefSet'>): void {
    const to = s.ptr.t?.k === 'ptr' ? s.ptr.t.to : undefined;
    this.em.line(`*${paren(this.ex(s.ptr), P.UNARY)} = ${this.valueFor(s.value, to)};`);
  }

  // ----- expressions -----

  protected override ex(e: Expr): X {
    if (e.k === 'this') return atom('self');
    return super.ex(e);
  }

  protected override eNum(e: E<'num'>): X {
    const x = super.eNum(e);
    // A suffix lets method syntax and inference work on bare literals.
    return x;
  }

  protected override toFloat(x: X): X {
    return atom(`(${paren(x, P.UNARY)} as f64)`);
  }

  protected override ePow(e: E<'bin'>): X {
    return post(`f64::powf(${this.valueFor(e.l, T.float)}, ${this.valueFor(e.r, T.float)})`);
  }

  protected override eEquality(e: E<'bin'>): X {
    // String == &str works, so a literal does not need to be allocated.
    if (e.l.t?.k === 'string' && e.r.k === 'str') return { c: `${paren(this.ex(e.l), P.CMP + 1)} ${e.op} ${this.lit(e.r.value)}`, p: P.CMP };
    if (e.r.t?.k === 'string' && e.l.k === 'str') return { c: `${this.lit(e.l.value)} ${e.op} ${paren(this.ex(e.r), P.CMP + 1)}`, p: P.CMP };
    return super.eEquality(e);
  }

  protected override eTernary(e: E<'ternary'>): X {
    return { c: `if ${this.ex(e.cond).c} { ${this.valueFor(e.a, e.t)} } else { ${this.valueFor(e.b, e.t)} }`, p: P.LOW };
  }

  protected override eCall(e: E<'call'>): X {
    return post(`${this.fn(e.name)}(${this.args(e.args, this.callTypes(e.name))})`);
  }

  protected override eList(e: E<'list'>): X {
    const t = this.settle(e.t ?? T.list(T.int), 'list', e.id);
    const of = t.k === 'list' ? t.of : T.int;
    return e.items.length ? post(`vec![${e.items.map((i) => this.valueFor(i, of)).join(', ')}]`) : post('Vec::new()');
  }

  protected override eMap(_e: E<'map'>): X {
    this.use('std::collections::HashMap');
    return post('HashMap::new()');
  }

  protected override eIndex(e: E<'index'>): X {
    if (e.target.t?.k === 'string') return post(`${paren(this.ex(e.target), P.POST)}.chars().nth(${this.idx(e.index)}).map(String::from).unwrap_or_default()`);
    return post(`${paren(this.ex(e.target), P.POST)}[${this.idx(e.index)}]`);
  }

  protected override eMapGet(e: E<'mapGet'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}[${this.keyRef(e.key)}]`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.contains_key(${this.keyRef(e.key)})`);
  }

  protected eLen(e: E<'len'>): X {
    const target = paren(this.ex(e.target), P.POST);
    return atom(`(${target}.${e.target.t?.k === 'string' ? 'chars().count()' : 'len()'} as i64)`);
  }

  protected eConcat(e: E<'concat'>): X {
    const { fmt, args } = this.format(e.parts);
    return post(`format!(${[this.lit(fmt), ...args].join(', ')})`);
  }

  protected eConvert(e: E<'convert'>): X {
    const from = e.e.t?.k;
    const x = this.ex(e.e);
    switch (e.to) {
      case 'int':
        if (from === 'string') return post(`${paren(x, P.POST)}.trim().parse::<i64>().unwrap_or(0)`);
        return atom(`(${paren(x, P.UNARY)} as i64)`);
      case 'float':
        if (from === 'string') return post(`${paren(x, P.POST)}.trim().parse::<f64>().unwrap_or(0.0)`);
        return atom(`(${paren(x, P.UNARY)} as f64)`);
      case 'string':
        return from === 'string' ? x : post(`${e.e.k === 'num' ? `(${x.c})` : paren(x, P.POST)}.to_string()`);
      case 'bool':
        return from === 'string' ? { c: `!${paren(x, P.POST)}.is_empty()`, p: P.UNARY } : from === 'bool' ? x : { c: `${paren(x, P.CMP + 1)} != ${from === 'float' ? '0.0' : '0'}`, p: P.CMP };
    }
  }

  protected eInput(e: E<'input'>): X {
    this.use('std::io::Write');
    this.helper('input', [
      '/// Prints a prompt and reads one line of text.',
      'fn input(prompt: &str) -> String {',
      '    print!("{}", prompt);',
      '    std::io::stdout().flush().expect("could not flush the output");',
      '    let mut line = String::new();',
      '    std::io::stdin().read_line(&mut line).expect("could not read a line");',
      "    line.trim_end_matches(['\\r', '\\n']).to_string()",
      '}',
    ]);
    const call = `input(${e.prompt.k === 'missing' ? '""' : this.strRef(e.prompt)})`;
    return post(e.numeric ? `${call}.trim().parse::<f64>().unwrap_or(0.0)` : call);
  }

  protected eMath(e: E<'math'>): X {
    const isFloat = e.args.some((x) => x.t?.k === 'float');
    const f = (x: Expr) => this.valueFor(x, T.float);
    const a0 = e.args[0];
    switch (e.fn) {
      case 'abs':
        return post(isFloat ? `f64::abs(${f(a0)})` : `i64::abs(${this.ex(a0).c})`);
      case 'floor':
      case 'ceil':
      case 'round':
        return atom(`(f64::${e.fn}(${f(a0)}) as i64)`);
      case 'min':
      case 'max':
        return post(isFloat ? `f64::${e.fn}(${e.args.map(f).join(', ')})` : `i64::${e.fn}(${e.args.map((x) => this.ex(x).c).join(', ')})`);
      case 'pow10':
        return post(`f64::powf(10.0, ${f(a0)})`);
      default:
        return post(`f64::${e.fn}(${f(a0)})`);
    }
  }

  protected eRandom(e: E<'random'>): X {
    this.helper('random_int', [
      '/// A small pseudo-random helper seeded from the clock. Use the `rand` crate for serious work.',
      'fn random_int(low: i64, high: i64) -> i64 {',
      '    use std::time::{SystemTime, UNIX_EPOCH};',
      '    static mut STATE: u64 = 0;',
      '    let span = (high - low + 1).max(1) as u64;',
      '    // SAFETY: the generated program is single threaded.',
      '    let next = unsafe {',
      '        if STATE == 0 {',
      '            STATE = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1) | 1;',
      '        }',
      '        STATE ^= STATE << 13;',
      '        STATE ^= STATE >> 7;',
      '        STATE ^= STATE << 17;',
      '        STATE',
      '    };',
      '    low + (next % span) as i64',
      '}',
    ]);
    return post(`random_int(${this.ex(e.from).c}, ${this.ex(e.to).c})`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = paren(this.ex(e.args[0]), P.POST);
    if (e.op === 'contains') return post(`${a}.contains(${this.strRef(e.args[1])})`);
    if (e.op === 'trim') return post(`${a}.trim().to_string()`);
    return post(`${a}.${e.op === 'upper' ? 'to_uppercase' : 'to_lowercase'}()`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    return post(`std::fs::read_to_string(${this.strRef(e.path)}).unwrap_or_default()`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    return post(`std::path::Path::new(${this.strRef(e.path)}).exists()`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    return this.unsupportedExpr(e, 'HTTP requests', 'The standard library has no HTTP client. Add a crate such as reqwest and use a raw code block.');
  }

  protected override eShell(e: E<'shell'>): X {
    return post(`String::from_utf8_lossy(&std::process::Command::new("sh").arg("-c").arg(${this.strRef(e.cmd)}).output().expect("could not run the command").stdout).to_string()`);
  }

  protected override eNew(e: E<'new'>): X {
    const cls = this.an.classes.get(e.name);
    if (!cls) return atom('0');
    const fields = cls.fields.map((f, i) => `${this.member(f.name)}: ${e.args[i] ? this.valueFor(e.args[i], f.type) : this.zero(f.type)}`);
    return post(`${this.typeId(e.name)} { ${fields.join(', ')} }`);
  }

  protected override eAddrOf(e: E<'addrOf'>): X {
    return { c: `&mut ${this.v(e.name)}`, p: P.UNARY };
  }

  protected override eDeref(e: E<'deref'>): X {
    return { c: `*${paren(this.ex(e.e), P.UNARY)}`, p: P.UNARY };
  }
}

export default new RustGenerator();
