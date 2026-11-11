import type { VarInfo } from '../ir/analyze';
import type { ClassDecl, Expr, FuncDecl, InterfaceDecl } from '../ir/types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import { type Emitter, quote } from './emitter';

export class RubyGenerator extends ImperativeGenerator {
  readonly lang = 'ruby' as const;
  protected readonly reservedWords = ['BEGIN', 'END', 'alias', 'and', 'begin', 'break', 'case', 'class', 'def', 'defined?', 'do', 'else', 'elsif', 'end', 'ensure', 'false', 'for', 'if', 'in', 'module', 'next', 'nil', 'not', 'or', 'redo', 'rescue', 'retry', 'return', 'self', 'super', 'then', 'true', 'undef', 'unless', 'until', 'when', 'while', 'yield', 'puts', 'print', 'p', 'gets', 'input', 'rand', 'sleep', 'require', 'raise', 'loop', 'lambda', 'proc', 'method', 'system', 'format', 'open', 'exit', 'test', 'fail', 'catch', 'throw', 'binding', 'object_id', 'send', 'display', 'hash', 'class_', 'freeze', 'dup', 'clone', 'tap', 'then_'];
  protected override indentUnit = '  ';
  protected override stmtEnd = '';
  protected override lineComment = '#';

  protected layout(): Emitter {
    const body = this.em;
    this.emitDecls();
    this.emitMain();
    const out = this.newEmitter();
    this.writeHeader(out);
    out.append(body);
    return out;
  }

  /** Locals must start with a lowercase letter; shared variables become $globals. */
  protected override v(name: string): string {
    let id = this.names.get('var', name);
    const info = this.info(name);
    const keepConstant = info?.isConst && !this.curFunc && !this.isGlobal(name);
    if (/^[A-Z]/.test(id) && !keepConstant) id = `_${id}`;
    return this.isGlobal(name) ? `$${id}` : id;
  }

  protected override fn(name: string): string {
    const id = this.names.get('fn', name);
    return /^[A-Z]/.test(id) ? id[0].toLowerCase() + id.slice(1) : id;
  }

  protected override typeId(name: string): string {
    const id = this.names.get('type', name);
    return id[0].toUpperCase() + id.slice(1);
  }

  protected override str(s: string): string {
    return quote(s, { control: 'u4', escape: '#' });
  }

  protected override nullLiteral(): string {
    return 'nil';
  }

  protected override thisLiteral(): string {
    return 'self';
  }

  protected override importLine(module: string): string {
    return `require '${module}'`;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) this.imports.add(this.importLine(s.module));
  }

  // ----- declarations -----

  protected override declare(name: string, _info: VarInfo, init: string): void {
    this.em.line(`${this.v(name)} = ${init}`);
  }

  protected override hoist(): void {}

  protected override globalsDecl(): void {}

  protected override zero(t: Parameters<ImperativeGenerator['zero']>[0]): string {
    if (t.k === 'list') return '[]';
    if (t.k === 'map') return '{}';
    return super.zero(t);
  }

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const params = f.params.map((p) => this.v(p.name)).join(', ');
    const name = isMethod ? this.member(f.name) : this.fn(f.name);
    return `def ${name}${params ? `(${params})` : ''}`;
  }

  protected override blockEnd(): string {
    return 'end';
  }

  protected override emitClass(c: ClassDecl): void {
    this.em.line(`class ${this.typeId(c.name)}`);
    this.em.indent();
    const fields = c.fields.map((f) => this.member(f.name));
    if (fields.length) {
      this.em.line(`attr_accessor ${fields.map((f) => `:${f}`).join(', ')}`);
      this.em.blank();
    }
    this.em.line(`def initialize${fields.length ? `(${fields.join(', ')})` : ''}`);
    this.em.indent();
    for (const f of fields) this.em.line(`@${f} = ${f}`);
    this.em.dedent();
    this.em.line('end');
    for (const m of c.methods) {
      this.em.blank();
      this.emitFunc(m, c);
    }
    this.em.dedent();
    this.em.line('end');
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.warnOnce(`iface:${i.name}`, 'gen.interfaceErased', 'Ruby relies on duck typing, so the interface is only kept as a comment.', i.id, undefined, 'info');
    this.em.line(`# interface ${i.name}: ${i.methods.map((m) => m.name).join(', ')}`);
  }

  // ----- statements -----

  protected override ifOpen(cond: string, first: boolean): string {
    return `${first ? 'if' : 'elsif'} ${cond}`;
  }

  protected override elseOpen(): string {
    return 'else';
  }

  protected override whileOpen(cond: string): string {
    return `while ${cond}`;
  }

  protected override sContinue(): void {
    this.em.line('next');
  }

  protected sPrint(s: S<'print'>): void {
    const t = s.value.t?.k;
    if (t === 'list' || t === 'map') this.em.line(`puts ${paren(this.ex(s.value), P.POST)}.inspect`);
    else this.em.line(`puts ${this.ex(s.value).c}`);
  }

  protected repeatOpen(count: string): string {
    return `${/^\w+$/.test(count) ? count : `(${count})`}.times do`;
  }

  protected forRangeOpen(r: RangeInfo): string | [string, string] {
    const recv = (code: string) => (/^[\w.$]+$/.test(code) ? code : `(${code})`);
    const tmp = r.declare ? r.v : this.names.fresh('step');
    let head: string;
    if (r.stepIsOne) head = r.desc ? `${recv(r.from)}.downto(${r.to}) do |${tmp}|` : `(${r.from}..${r.to}).each do |${tmp}|`;
    else head = `${recv(r.from)}.step(${r.to}, ${r.desc ? '-' : ''}${r.step}) do |${tmp}|`;
    return r.declare ? head : [head, `${r.v} = ${tmp}`];
  }

  protected forEachOpen(v: string, iter: string, _s: S<'forEach'>, declare: boolean): string | [string, string] {
    if (declare) return `${iter}.each do |${v}|`;
    const tmp = this.names.fresh('item');
    return [`${iter}.each do |${tmp}|`, `${v} = ${tmp}`];
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.push(${this.ex(s.value).c})`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.delete_at(${this.ex(s.index).c})`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}.delete(${this.ex(s.key).c})`);
  }

  protected override sTry(s: S<'try'>): void {
    const e = this.names.fresh('e');
    this.em.line('begin');
    this.em.indent();
    this.body(s.body);
    this.em.dedent();
    this.em.line(`rescue StandardError => ${e}`);
    this.em.indent();
    this.bind(s, s.errVar, `${e}.message`);
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
    this.em.line('end');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`raise ${this.ex(s.message).c}`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    const text = s.content.t?.k === 'string' ? this.ex(s.content).c : `${paren(this.ex(s.content), P.POST)}.to_s`;
    if (s.append) this.em.line(`File.open(${this.ex(s.path).c}, "a") { |file| file.write(${text}) }`);
    else this.em.line(`File.write(${this.ex(s.path).c}, ${text})`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.em.line(`sleep(${paren(this.ex(s.ms), P.MUL + 1)} / 1000.0)`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.em.line(`system(${this.ex(s.cmd).c})`);
  }

  // ----- expressions -----

  protected override eDivide(e: E<'bin'>): X {
    // Integer / integer truncates in Ruby, so true division uses fdiv.
    if (e.l.t?.k === 'float' || e.r.t?.k === 'float') return this.bin('/', P.MUL, this.ex(e.l), this.ex(e.r));
    return post(`${paren(this.ex(e.l), P.POST)}.fdiv(${this.ex(e.r).c})`);
  }

  protected override ePow(e: E<'bin'>): X {
    return { c: `${paren(this.ex(e.l), P.POW + 1)} ** ${paren(this.ex(e.r), P.POW)}`, p: P.POW };
  }

  protected override eNum(e: E<'num'>): X {
    const x = super.eNum(e);
    // Method calls on a negative literal need parentheses to read clearly.
    return x;
  }

  private recv(e: Expr): string {
    const x = this.ex(e);
    return e.k === 'num' && e.value < 0 ? `(${x.c})` : paren(x, P.POST);
  }

  protected override eMap(e: E<'map'>): X {
    return atom(`{${e.entries.map((x) => `${this.ex(x.key).c} => ${this.ex(x.value).c}`).join(', ')}}`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.key?(${this.ex(e.key).c})`);
  }

  protected eLen(e: E<'len'>): X {
    return post(`${this.recv(e.target)}.length`);
  }

  protected eConcat(e: E<'concat'>): X {
    let out = '"';
    for (const p of e.parts) {
      if (p.k === 'str') out += this.str(p.value).slice(1, -1);
      else out += `#{${this.ex(p).c}}`;
    }
    return atom(out + '"');
  }

  protected eConvert(e: E<'convert'>): X {
    const x = this.recv(e.e);
    switch (e.to) {
      case 'int':
        return post(`${x}.to_i`);
      case 'float':
        return post(`${x}.to_f`);
      case 'string':
        return post(`${x}.to_s`);
      case 'bool':
        return e.e.t?.k === 'string' ? { c: `!${x}.empty?`, p: P.UNARY } : e.e.t?.k === 'bool' ? this.ex(e.e) : { c: `${x} != 0`, p: P.CMP };
    }
  }

  protected eInput(e: E<'input'>): X {
    this.helper('input', ['# Prints a prompt and reads one line of text.', 'def input(prompt)', '  print prompt', '  $stdout.flush', '  ($stdin.gets || "").chomp', 'end']);
    const call = `input(${e.prompt.k === 'missing' ? '""' : this.ex(e.prompt).c})`;
    return post(e.numeric ? `${call}.to_f` : call);
  }

  protected eMath(e: E<'math'>): X {
    const a = e.args.map((x) => this.ex(x).c);
    switch (e.fn) {
      case 'abs':
      case 'floor':
      case 'ceil':
      case 'round':
        return post(`${this.recv(e.args[0])}.${e.fn}`);
      case 'min':
      case 'max':
        return post(`[${a.join(', ')}].${e.fn}`);
      case 'ln':
        return post(`Math.log(${a[0]})`);
      case 'pow10':
        return { c: `10 ** ${paren(this.ex(e.args[0]), P.POW)}`, p: P.POW };
      default:
        return post(`Math.${e.fn}(${a[0]})`);
    }
  }

  protected eRandom(e: E<'random'>): X {
    return post(`rand(${paren(this.ex(e.from), P.ADD)}..${paren(this.ex(e.to), P.ADD)})`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = paren(this.ex(e.args[0]), P.POST);
    if (e.op === 'contains') return post(`${a}.include?(${this.ex(e.args[1]).c})`);
    return post(`${a}.${{ upper: 'upcase', lower: 'downcase', trim: 'strip' }[e.op]}`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    return post(`File.read(${this.ex(e.path).c})`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    return post(`File.exist?(${this.ex(e.path).c})`);
  }

  protected override eJsonParse(e: E<'jsonParse'>): X {
    this.imports.add("require 'json'");
    return post(`JSON.parse(${this.ex(e.e).c})`);
  }

  protected override eJsonStringify(e: E<'jsonStringify'>): X {
    this.imports.add("require 'json'");
    return post(`JSON.generate(${this.ex(e.e).c})`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    this.imports.add("require 'net/http'");
    return post(`Net::HTTP.get(URI(${this.ex(e.url).c}))`);
  }

  protected override eShell(e: E<'shell'>): X {
    return post(`IO.popen(${this.ex(e.cmd).c}, &:read)`);
  }

  protected override eNew(e: E<'new'>): X {
    return post(`${this.typeId(e.name)}.new${e.args.length ? `(${this.args(e.args)})` : ''}`);
  }

  protected override eMethod(e: E<'method'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.${this.member(e.name)}${e.args.length ? `(${this.args(e.args)})` : ''}`);
  }

  protected override eCall(e: E<'call'>): X {
    return post(`${this.fn(e.name)}(${this.args(e.args)})`);
  }

  protected override eFuncRef(e: E<'funcRef'>): X {
    return post(`method(:${this.fn(e.name)})`);
  }

  protected override eCallRef(e: E<'callRef'>): X {
    return post(`${paren(this.ex(e.fn), P.POST)}.call(${this.args(e.args)})`);
  }
}

export default new RubyGenerator();
