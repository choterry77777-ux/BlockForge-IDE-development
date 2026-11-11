import type { ScopeInfo, VarInfo } from '../ir/analyze';
import type { ClassDecl, Expr, FuncDecl, InterfaceDecl } from '../ir/types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import { type Emitter, quote } from './emitter';

/** Precedence of the "." concatenation operator: below arithmetic, above comparison. */
const P_CONCAT = P.CMP + 1;

export class PhpGenerator extends ImperativeGenerator {
  readonly lang = 'php' as const;
  protected readonly reservedWords = ['abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo', 'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'eval', 'exit', 'extends', 'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global', 'goto', 'if', 'implements', 'include', 'instanceof', 'insteadof', 'interface', 'isset', 'list', 'match', 'namespace', 'new', 'or', 'print', 'private', 'protected', 'public', 'readonly', 'require', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor', 'yield', 'input', 'this', 'count', 'strlen', 'trim', 'min', 'max', 'abs', 'round', 'floor', 'ceil', 'sqrt', 'log', 'exp', 'sin', 'cos', 'tan', 'sleep', 'usleep', 'time', 'date', 'file', 'copy', 'rename', 'link', 'mail', 'key', 'next', 'reset', 'end', 'each', 'current', 'pos', 'range', 'sort', 'shuffle'];
  private funcNames = new Set<string>();

  protected layout(): Emitter {
    const body = this.em;
    this.emitDecls();
    this.emitMain();
    const out = this.newEmitter();
    out.line('<?php');
    out.blank();
    this.writeHeader(out);
    out.append(body);
    return out;
  }

  protected override v(name: string): string {
    return `$${this.names.get('var', name)}`;
  }

  protected override str(s: string): string {
    return quote(s, { control: 'ubrace', escape: '$' });
  }

  protected override thisLiteral(): string {
    return '$this';
  }

  protected override importLine(module: string): string {
    return `require_once '${module}';`;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) this.imports.add(this.importLine(s.module));
  }

  // ----- declarations -----

  protected override declare(name: string, _info: VarInfo, init: string): void {
    this.em.line(`${this.v(name)} = ${init};`);
  }

  protected override hoist(): void {}

  protected override zero(t: Parameters<ImperativeGenerator['zero']>[0]): string {
    return t.k === 'list' || t.k === 'map' ? '[]' : super.zero(t);
  }

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const params = f.params.map((p) => this.v(p.name)).join(', ');
    if (isMethod) return `public function ${this.member(f.name)}(${params}) {`;
    this.funcNames.add(f.name);
    return `function ${this.fn(f.name)}(${params}) {`;
  }

  protected override funcPrologue(_f: FuncDecl, scope: ScopeInfo): void {
    const globals = [...scope.globalsUsed].map((g) => this.v(g));
    if (globals.length) this.em.line(`global ${globals.join(', ')};`);
  }

  protected override emitClass(c: ClassDecl): void {
    this.em.line(`class ${this.typeId(c.name)}${c.implements ? ` implements ${this.typeId(c.implements)}` : ''} {`);
    this.em.indent();
    for (const f of c.fields) this.em.line(`public $${this.member(f.name)};`);
    if (c.fields.length) this.em.blank();
    this.em.line(`public function __construct(${c.fields.map((f) => `$${this.member(f.name)}`).join(', ')}) {`);
    this.em.indent();
    for (const f of c.fields) this.em.line(`$this->${this.member(f.name)} = $${this.member(f.name)};`);
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
    for (const m of i.methods) this.em.line(`public function ${this.member(m.name)}(${m.params.map((p) => `$${this.member(p.name)}`).join(', ')});`);
    this.em.dedent();
    this.em.line('}');
  }

  // ----- statements -----

  protected sPrint(s: S<'print'>): void {
    const t = s.value.t?.k;
    if (t === 'list' || t === 'map') this.em.line(`echo json_encode(${this.ex(s.value).c}), "\\n";`);
    else this.em.line(`echo ${paren(this.ex(s.value), P.TERN + 1)}, "\\n";`);
  }

  protected repeatOpen(count: string, counter: string): string {
    return `for ($${counter} = 0; $${counter} < ${count}; $${counter}++) {`;
  }

  protected forRangeOpen(r: RangeInfo): string {
    const step = r.stepIsOne ? `${r.v}${r.desc ? '--' : '++'}` : `${r.v} ${r.desc ? '-=' : '+='} ${r.step}`;
    return `for (${r.v} = ${r.from}; ${r.v} ${r.desc ? '>=' : '<='} ${r.to}; ${step}) {`;
  }

  protected forEachOpen(v: string, iter: string): string {
    return `foreach (${iter} as ${v}) {`;
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}[] = ${this.ex(s.value).c};`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`array_splice(${this.ex(s.list).c}, ${this.ex(s.index).c}, 1);`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`unset(${paren(this.ex(s.map), P.POST)}[${this.ex(s.key).c}]);`);
  }

  protected override sTry(s: S<'try'>): void {
    const e = this.names.fresh('e');
    this.em.line('try {');
    this.em.indent();
    this.body(s.body);
    this.em.dedent();
    this.em.line(`} catch (Exception $${e}) {`);
    this.em.indent();
    this.bind(s, s.errVar, `$${e}->getMessage()`);
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
    this.em.line('}');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`throw new Exception(${this.ex(s.message).c});`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    this.em.line(`file_put_contents(${this.ex(s.path).c}, ${this.ex(s.content).c}${s.append ? ', FILE_APPEND' : ''});`);
  }

  protected override sFieldSet(s: S<'fieldSet'>): void {
    this.em.line(`${paren(this.ex(s.target), P.POST)}->${this.member(s.name)} = ${this.ex(s.value).c};`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.em.line(`usleep((int) (${this.ex(s.ms).c} * 1000));`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.em.line(`passthru(${this.ex(s.cmd).c});`);
  }

  // ----- expressions -----

  protected override ex(e: Expr): X {
    if (e.k === 'field') return post(`${paren(this.ex(e.target), P.POST)}->${this.member(e.name)}`);
    return super.ex(e);
  }

  protected override ePow(e: E<'bin'>): X {
    return { c: `${paren(this.ex(e.l), P.POW + 1)} ** ${paren(this.ex(e.r), P.POW)}`, p: P.POW };
  }

  protected override eTernary(e: E<'ternary'>): X {
    // PHP 8 rejects nested conditional expressions without parentheses.
    return { c: `${paren(this.ex(e.cond), P.TERN + 1)} ? ${paren(this.ex(e.a), P.TERN + 1)} : ${paren(this.ex(e.b), P.TERN + 1)}`, p: P.TERN };
  }

  protected override eMap(e: E<'map'>): X {
    return atom(`[${e.entries.map((x) => `${this.ex(x.key).c} => ${this.ex(x.value).c}`).join(', ')}]`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return post(`array_key_exists(${this.ex(e.key).c}, ${this.ex(e.target).c})`);
  }

  protected eLen(e: E<'len'>): X {
    return post(`${e.target.t?.k === 'string' ? 'strlen' : 'count'}(${this.ex(e.target).c})`);
  }

  protected eConcat(e: E<'concat'>): X {
    if (e.parts.length === 1) return post(`strval(${this.ex(e.parts[0]).c})`);
    return { c: e.parts.map((p) => paren(this.ex(p), P_CONCAT + 1)).join(' . '), p: P_CONCAT };
  }

  protected eConvert(e: E<'convert'>): X {
    return post(`${{ int: 'intval', float: 'floatval', string: 'strval', bool: 'boolval' }[e.to]}(${this.ex(e.e).c})`);
  }

  protected eInput(e: E<'input'>): X {
    this.helper('input', ['// Prints a prompt and reads one line of text.', 'function input($prompt) {', '    echo $prompt;', '    $line = fgets(STDIN);', '    return $line === false ? "" : rtrim($line, "\\r\\n");', '}']);
    const call = `input(${e.prompt.k === 'missing' ? '""' : this.ex(e.prompt).c})`;
    return post(e.numeric ? `floatval(${call})` : call);
  }

  protected eMath(e: E<'math'>): X {
    const a = e.args.map((x) => this.ex(x).c);
    switch (e.fn) {
      case 'floor':
      case 'ceil':
      case 'round':
        return { c: `(int) ${e.fn}(${a[0]})`, p: P.UNARY };
      case 'ln':
        return post(`log(${a[0]})`);
      case 'pow10':
        return { c: `10 ** ${paren(this.ex(e.args[0]), P.POW)}`, p: P.POW };
      default:
        return post(`${e.fn}(${a.join(', ')})`);
    }
  }

  protected eRandom(e: E<'random'>): X {
    return post(`random_int(${this.ex(e.from).c}, ${this.ex(e.to).c})`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = this.ex(e.args[0]).c;
    if (e.op === 'contains') return post(`str_contains(${a}, ${this.ex(e.args[1]).c})`);
    return post(`${{ upper: 'strtoupper', lower: 'strtolower', trim: 'trim' }[e.op]}(${a})`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    return post(`file_get_contents(${this.ex(e.path).c})`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    return post(`file_exists(${this.ex(e.path).c})`);
  }

  protected override eJsonParse(e: E<'jsonParse'>): X {
    return post(`json_decode(${this.ex(e.e).c}, true)`);
  }

  protected override eJsonStringify(e: E<'jsonStringify'>): X {
    return post(`json_encode(${this.ex(e.e).c})`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    return post(`file_get_contents(${this.ex(e.url).c})`);
  }

  protected override eShell(e: E<'shell'>): X {
    return post(`shell_exec(${this.ex(e.cmd).c})`);
  }

  protected override eMethod(e: E<'method'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}->${this.member(e.name)}(${this.args(e.args)})`);
  }

  protected override eFuncRef(e: E<'funcRef'>): X {
    return atom(`'${this.fn(e.name)}'`);
  }

  protected override eCallRef(e: E<'callRef'>): X {
    return post(`call_user_func(${[this.ex(e.fn).c, ...e.args.map((a) => this.ex(a).c)].join(', ')})`);
  }
}

export default new PhpGenerator();
