import { hasControlFlow, hasDirectContinue, type ScopeInfo, type VarInfo } from '../ir/analyze';
import type { ClassDecl, Expr, FuncDecl, InterfaceDecl, Stmt } from '../ir/types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import { type Emitter, quote } from './emitter';

export class LuaGenerator extends ImperativeGenerator {
  readonly lang = 'lua' as const;
  protected readonly reservedWords = ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'print', 'type', 'tostring', 'tonumber', 'pairs', 'ipairs', 'table', 'string', 'math', 'io', 'os', 'error', 'pcall', 'require', 'select', 'self', 'input', 'to_int', 'to_bool', 'trim', 'read_file', 'write_file', 'file_exists', 'sleep', 'count_keys', 'next', 'assert', 'load', 'unpack'];
  protected override unicodeIdents = false;
  protected override indentUnit = '  ';
  protected override stmtEnd = '';
  protected override lineComment = '--';
  private labels: (string | undefined)[] = [];

  protected layout(): Emitter {
    this.labels = [];
    const body = this.em;
    for (const info of this.an.globals.values()) body.line(`local ${this.v(info.name)} = ${this.zero(info.type)}`);
    if (this.an.globals.size) body.blank();
    this.emitDecls();
    this.emitMain();
    const out = this.newEmitter();
    this.writeHeader(out);
    out.append(body);
    return out;
  }

  protected override str(s: string): string {
    return quote(s, { control: 'decimal' });
  }

  protected override nullLiteral(): string {
    return 'nil';
  }

  protected override thisLiteral(): string {
    return 'self';
  }

  protected override opSymbol(op: string): string {
    return op === '&&' ? 'and' : op === '||' ? 'or' : op === '!=' ? '~=' : op;
  }

  protected override importLine(module: string): string {
    return `local ${module.replace(/[^A-Za-z0-9_]/g, '_')} = require("${module}")`;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) this.imports.add(this.importLine(s.module));
  }

  // ----- declarations -----

  protected override declare(name: string, _info: VarInfo, init: string): void {
    this.em.line(`local ${this.v(name)} = ${init}`);
  }

  protected override hoist(scope: ScopeInfo): void {
    for (const name of scope.hoisted) this.em.line(`local ${this.v(name)} = ${this.zero(scope.vars.get(name)!.type)}`);
  }

  protected override zero(t: Parameters<ImperativeGenerator['zero']>[0]): string {
    if (t.k === 'list' || t.k === 'map') return '{}';
    if (t.k === 'float') return '0.0';
    return super.zero(t);
  }

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const params = f.params.map((p) => this.v(p.name)).join(', ');
    if (isMethod) return `function ${this.typeId(this.curClass!.name)}:${this.member(f.name)}(${params})`;
    return `function ${this.fn(f.name)}(${params})`;
  }

  protected override blockEnd(): string {
    return 'end';
  }

  protected override emitClass(c: ClassDecl): void {
    const name = this.typeId(c.name);
    const fields = c.fields.map((f) => this.member(f.name));
    this.em.line(`local ${name} = {}`);
    this.em.line(`${name}.__index = ${name}`);
    this.em.blank();
    this.em.line(`function ${name}.new(${fields.join(', ')})`);
    this.em.indent();
    this.em.line(`local self = setmetatable({}, ${name})`);
    for (const f of fields) this.em.line(`self.${f} = ${f}`);
    this.em.line('return self');
    this.em.dedent();
    this.em.line('end');
    for (const m of c.methods) {
      this.em.blank();
      this.emitFunc(m, c);
    }
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.warnOnce(`iface:${i.name}`, 'gen.interfaceErased', 'Lua has no interfaces, so the interface is only kept as a comment.', i.id, undefined, 'info');
    this.em.line(`-- interface ${i.name}: ${i.methods.map((m) => m.name).join(', ')}`);
  }

  // ----- statements -----

  protected override ifOpen(cond: string, first: boolean): string {
    return `${first ? 'if' : 'elseif'} ${cond} then`;
  }

  protected override elseOpen(): string {
    return 'else';
  }

  protected override whileOpen(cond: string): string {
    return `while ${cond} do`;
  }

  /** Lua has no continue: loops that need it get a label at the end of the body. */
  protected override loopBody(open: string | [string, string], body: Stmt[]): void {
    const label = hasDirectContinue(body) ? this.names.fresh('continue') : undefined;
    this.labels.push(label);
    const [head, first] = typeof open === 'string' ? [open, undefined] : open;
    this.em.line(head);
    this.em.indent();
    if (first) this.em.line(first);
    for (const s of body) this.stmt(s);
    if (label) this.em.line(`::${label}::`);
    this.em.dedent();
    this.em.line('end');
    this.labels.pop();
  }

  protected override sContinue(): void {
    const label = this.labels[this.labels.length - 1];
    this.em.line(label ? `goto ${label}` : '-- continue');
  }

  protected override sBreak(): void {
    this.em.line('break');
  }

  protected sPrint(s: S<'print'>): void {
    if (s.value.t?.k === 'list') this.em.line(`print("[" .. table.concat(${this.ex(s.value).c}, ", ") .. "]")`);
    else this.em.line(`print(${this.ex(s.value).c})`);
  }

  protected repeatOpen(count: string): string {
    return `for _ = 1, ${count} do`;
  }

  protected forRangeOpen(r: RangeInfo): string | [string, string] {
    const step = r.desc ? `, -${r.step}` : r.stepIsOne ? '' : `, ${r.step}`;
    if (r.declare) return `for ${r.v} = ${r.from}, ${r.to}${step} do`;
    const tmp = this.names.fresh('step');
    return [`for ${tmp} = ${r.from}, ${r.to}${step} do`, `${r.v} = ${tmp}`];
  }

  protected forEachOpen(v: string, iter: string, _s: S<'forEach'>, declare: boolean): string | [string, string] {
    if (declare) return `for _, ${v} in ipairs(${iter}) do`;
    const tmp = this.names.fresh('item');
    return [`for _, ${tmp} in ipairs(${iter}) do`, `${v} = ${tmp}`];
  }

  /** Lists are 1-based in Lua; block indexes are 0-based. */
  private index(e: Expr): string {
    if (e.k === 'num' && e.isInt) return String(e.value + 1);
    return `${paren(this.ex(e), P.ADD)} + 1`;
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`table.insert(${this.ex(s.list).c}, ${this.ex(s.value).c})`);
  }

  protected override sListSet(s: S<'listSet'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}[${this.index(s.index)}] = ${this.ex(s.value).c}`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`table.remove(${this.ex(s.list).c}, ${this.index(s.index)})`);
  }

  protected override sMapSet(s: S<'mapSet'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}[${this.ex(s.key).c}] = ${this.ex(s.value).c}`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}[${this.ex(s.key).c}] = nil`);
  }

  protected override sTry(s: S<'try'>): void {
    if (hasControlFlow(s.body)) this.report('error', 'gen.tryControlFlow', 'Lua models try/catch with pcall and a function, so return, break and continue cannot be used inside the protected part.', s.id);
    const ok = this.names.fresh('ok');
    const err = this.names.fresh('err');
    this.em.line(`local ${ok}, ${err} = pcall(function()`);
    this.em.indent();
    const saved = this.labels;
    this.labels = [];
    this.body(s.body);
    this.labels = saved;
    this.em.dedent();
    this.em.line('end)');
    this.em.line(`if not ${ok} then`);
    this.em.indent();
    this.bind(s, s.errVar, `tostring(${err})`);
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
    this.em.line('end');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`error(${this.ex(s.message).c}, 0)`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    this.helper('write_file', ['local function write_file(path, text, mode)', '  local file = assert(io.open(path, mode))', '  file:write(text)', '  file:close()', 'end']);
    this.em.line(`write_file(${this.ex(s.path).c}, tostring(${this.ex(s.content).c}), "${s.append ? 'a' : 'w'}")`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.helper('sleep', ['-- Lua has no sleep function, so this waits by watching the clock.', 'local function sleep(milliseconds)', '  local finish = os.clock() + milliseconds / 1000', '  while os.clock() < finish do end', 'end']);
    this.warnOnce('sleep', 'gen.busyWait', 'Standard Lua has no sleep function; the generated helper keeps the CPU busy while waiting.', s.id, undefined, 'info');
    this.em.line(`sleep(${this.ex(s.ms).c})`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.em.line(`os.execute(${this.ex(s.cmd).c})`);
  }

  // ----- expressions -----

  protected override eUn(e: E<'un'>): X {
    if (e.op === 'not') return { c: `not ${paren(this.ex(e.e), P.UNARY)}`, p: P.UNARY };
    return super.eUn(e);
  }

  protected override ePow(e: E<'bin'>): X {
    return { c: `${paren(this.ex(e.l), P.POW + 1)} ^ ${paren(this.ex(e.r), P.UNARY)}`, p: P.POW };
  }

  protected override eTernary(e: E<'ternary'>): X {
    // "c and a or b" is only safe when a can never be false or nil.
    if (e.a.t && ['int', 'float', 'string'].includes(e.a.t.k)) {
      return { c: `${paren(this.ex(e.cond), P.AND + 1)} and ${paren(this.ex(e.a), P.AND + 1)} or ${paren(this.ex(e.b), P.OR + 1)}`, p: P.OR };
    }
    return post(`(function() if ${this.ex(e.cond).c} then return ${this.ex(e.a).c} else return ${this.ex(e.b).c} end end)()`);
  }

  protected override eList(e: E<'list'>): X {
    return atom(`{${e.items.map((i) => this.ex(i).c).join(', ')}}`);
  }

  protected override eMap(e: E<'map'>): X {
    return atom(`{${e.entries.map((x) => `[${this.ex(x.key).c}] = ${this.ex(x.value).c}`).join(', ')}}`);
  }

  protected override eIndex(e: E<'index'>): X {
    if (e.target.t?.k === 'string') return post(`string.sub(${this.ex(e.target).c}, ${this.index(e.index)}, ${this.index(e.index)})`);
    return post(`${paren(this.ex(e.target), P.POST)}[${this.index(e.index)}]`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return { c: `${paren(this.ex(e.target), P.POST)}[${this.ex(e.key).c}] ~= nil`, p: P.CMP };
  }

  protected eLen(e: E<'len'>): X {
    if (e.target.t?.k === 'map') {
      this.helper('count_keys', ['local function count_keys(map)', '  local count = 0', '  for _ in pairs(map) do count = count + 1 end', '  return count', 'end']);
      return post(`count_keys(${this.ex(e.target).c})`);
    }
    return { c: `#${paren(this.ex(e.target), P.POST)}`, p: P.UNARY };
  }

  protected eConcat(e: E<'concat'>): X {
    const part = (p: Expr) => (p.t?.k === 'string' || p.t?.k === 'int' ? paren(this.ex(p), P.ADD + 1) : `tostring(${this.ex(p).c})`);
    if (e.parts.length === 1) return post(`tostring(${this.ex(e.parts[0]).c})`);
    // ".." binds looser than arithmetic and tighter than comparison.
    return { c: e.parts.map(part).join(' .. '), p: P.CMP + 1 };
  }

  protected eConvert(e: E<'convert'>): X {
    const x = this.ex(e.e).c;
    switch (e.to) {
      case 'int':
        this.helper('to_int', ['-- Converts a number or text to a whole number, dropping the fraction.', 'local function to_int(value)', '  local number = tonumber(value) or 0', '  if number >= 0 then return math.floor(number) end', '  return math.ceil(number)', 'end']);
        return post(`to_int(${x})`);
      case 'float':
        return { c: `${paren({ c: `tonumber(${x})`, p: P.POST }, P.ADD)} + 0.0`, p: P.ADD };
      case 'string':
        return post(`tostring(${x})`);
      case 'bool':
        this.helper('to_bool', ['local function to_bool(value)', '  return value ~= nil and value ~= false and value ~= 0 and value ~= ""', 'end']);
        return post(`to_bool(${x})`);
    }
  }

  protected eInput(e: E<'input'>): X {
    this.helper('input', ['-- Prints a prompt and reads one line of text.', 'local function input(prompt)', '  if __bf_input then return __bf_input(prompt) end', '  io.write(prompt)', '  io.flush()', '  return io.read("l") or ""', 'end']);
    const call = `input(${e.prompt.k === 'missing' ? '""' : this.ex(e.prompt).c})`;
    return post(e.numeric ? `tonumber(${call})` : call);
  }

  protected eMath(e: E<'math'>): X {
    const a = e.args.map((x) => this.ex(x).c);
    switch (e.fn) {
      case 'round':
        return post(`math.floor(${paren(this.ex(e.args[0]), P.ADD)} + 0.5)`);
      case 'ln':
        return post(`math.log(${a[0]})`);
      case 'log10':
        return post(`math.log(${a[0]}, 10)`);
      case 'pow10':
        return { c: `10 ^ ${paren(this.ex(e.args[0]), P.UNARY)}`, p: P.POW };
      default:
        return post(`math.${e.fn}(${a.join(', ')})`);
    }
  }

  protected eRandom(e: E<'random'>): X {
    return post(`math.random(${this.ex(e.from).c}, ${this.ex(e.to).c})`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = this.ex(e.args[0]).c;
    if (e.op === 'contains') return { c: `string.find(${a}, ${this.ex(e.args[1]).c}, 1, true) ~= nil`, p: P.CMP };
    if (e.op === 'trim') {
      this.helper('trim', ['local function trim(text)', '  return (string.gsub(text, "^%s*(.-)%s*$", "%1"))', 'end']);
      return post(`trim(${a})`);
    }
    return post(`string.${e.op}(${a})`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    this.helper('read_file', ['-- Returns the whole file as text, or empty text when it cannot be read.', 'local function read_file(path)', '  local file = io.open(path, "r")', '  if not file then return "" end', '  local text = file:read("a")', '  file:close()', '  return text', 'end']);
    return post(`read_file(${this.ex(e.path).c})`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.helper('file_exists', ['local function file_exists(path)', '  local file = io.open(path, "r")', '  if file then file:close() end', '  return file ~= nil', 'end']);
    return post(`file_exists(${this.ex(e.path).c})`);
  }

  protected override eShell(e: E<'shell'>): X {
    return post(`io.popen(${this.ex(e.cmd).c}):read("a")`);
  }

  protected override eNew(e: E<'new'>): X {
    return post(`${this.typeId(e.name)}.new(${this.args(e.args)})`);
  }

  protected override eMethod(e: E<'method'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}:${this.member(e.name)}(${this.args(e.args)})`);
  }

  protected override eFuncRef(e: E<'funcRef'>): X {
    return atom(this.fn(e.name));
  }

  protected override eCallRef(e: E<'callRef'>): X {
    return post(`${paren(this.ex(e.fn), P.POST)}(${this.args(e.args)})`);
  }
}

export default new LuaGenerator();
