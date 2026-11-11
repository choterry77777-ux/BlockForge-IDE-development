import type { ScopeInfo, VarInfo } from '../ir/analyze';
import type { ClassDecl, FuncDecl, InterfaceDecl } from '../ir/types';
import { atom, type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import type { Emitter } from './emitter';

export class PythonGenerator extends ImperativeGenerator {
  readonly lang = 'python' as const;
  protected readonly reservedWords = ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'print', 'input', 'len', 'str', 'int', 'float', 'bool', 'list', 'dict', 'range', 'math', 'random', 'json', 'os', 'sys', 'time', 'subprocess', 'urllib', 'asyncio', 'abs', 'min', 'max', 'round', 'open', 'self', 'main', 'type', 'id', 'sum', 'map', 'filter', 'set', 'object'];
  protected override stmtEnd = '';
  protected override lineComment = '#';

  protected override prepare(): void {
    this.computeAsync([], ['await']);
  }

  protected layout(): Emitter {
    const body = this.em;
    this.emitDecls();
    if (this.mainAsync) {
      this.imports.add('import asyncio');
      body.line('async def main():');
      body.indent();
      const start = body.count;
      const globals = [...this.an.main.globalsAssigned].map((g) => this.v(g));
      if (globals.length) body.line(`global ${globals.join(', ')}`);
      this.emitMain();
      if (body.count === start) body.line('pass');
      body.dedent();
      body.blank();
      body.line('asyncio.run(main())');
    } else {
      this.emitMain();
    }
    const out = this.newEmitter();
    this.writeHeader(out);
    out.append(body);
    return out;
  }

  protected override declare(name: string, _info: VarInfo, init: string): void {
    this.em.line(`${this.v(name)} = ${init}`);
  }

  protected override hoist(): void {}

  protected override emptyBody(): string {
    return 'pass';
  }

  protected override nullLiteral(): string {
    return 'None';
  }

  protected override boolLiteral(v: boolean): string {
    return v ? 'True' : 'False';
  }

  protected override thisLiteral(): string {
    return 'self';
  }

  protected override opSymbol(op: string): string {
    return op === '&&' ? 'and' : op === '||' ? 'or' : op;
  }

  protected override ifOpen(cond: string, first: boolean): string {
    return `${first ? 'if' : 'elif'} ${cond}:`;
  }

  protected override elseOpen(): string {
    return 'else:';
  }

  protected override blockEnd(): null {
    return null;
  }

  protected override whileOpen(cond: string): string {
    return `while ${cond}:`;
  }

  protected repeatOpen(count: string): string {
    return `for _ in range(${count}):`;
  }

  protected forRangeOpen(r: RangeInfo, s: S<'forRange'>): string {
    const int = (code: string) => (r.type.k === 'int' ? code : `int(${code})`);
    if (r.type.k !== 'int') this.warnOnce(`range:${s.id}`, 'gen.rangeNeedsInt', 'Python range() needs whole numbers, so the bounds are converted with int().', s.id);
    const bound = (code: string, delta: number) => (/^-?\d+$/.test(code) ? String(Number(code) + delta) : `${int(code)} ${delta > 0 ? '+' : '-'} 1`);
    const stop = bound(r.to, r.desc ? -1 : 1);
    const args = [int(r.from), stop];
    if (r.desc) args.push(`-${r.step}`);
    else if (!r.stepIsOne) args.push(int(r.step));
    return `for ${r.v} in range(${args.join(', ')}):`;
  }

  protected forEachOpen(v: string, iter: string): string {
    return `for ${v} in ${iter}:`;
  }

  protected sPrint(s: S<'print'>): void {
    this.em.line(`print(${this.ex(s.value).c})`);
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.append(${this.ex(s.value).c})`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.pop(${this.ex(s.index).c})`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}.pop(${this.ex(s.key).c}, None)`);
  }

  protected override sTry(s: S<'try'>): void {
    const e = this.names.fresh('e');
    this.em.line('try:');
    this.em.indent();
    this.body(s.body);
    this.em.dedent();
    this.em.line(`except Exception as ${e}:`);
    this.em.indent();
    this.bind(s, s.errVar, `str(${e})`);
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
  }

  protected override sThrow(s: S<'throw'>): void {
    this.em.line(`raise Exception(${this.ex(s.message).c})`);
  }

  protected override importLine(module: string): string {
    return `import ${module}`;
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    const f = this.names.fresh('f');
    this.em.line(`with open(${this.ex(s.path).c}, "${s.append ? 'a' : 'w'}", encoding="utf-8") as ${f}:`);
    this.em.indent();
    this.em.line(`${f}.write(${this.text(s.content)})`);
    this.em.dedent();
  }

  protected override sSleep(s: S<'sleep'>): void {
    const secs = `${paren(this.ex(s.ms), P.MUL + 1)} / 1000`;
    if (this.curFunc ? this.asyncFuncs.has(this.curFunc.name) : this.mainAsync) {
      this.imports.add('import asyncio');
      this.em.line(`await asyncio.sleep(${secs})`);
    } else {
      this.imports.add('import time');
      this.em.line(`time.sleep(${secs})`);
    }
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.imports.add('import subprocess');
    this.em.line(`subprocess.run(${this.ex(s.cmd).c}, shell=True)`);
  }

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    const params = f.params.map((p) => this.v(p.name));
    if (isMethod) return `def ${this.member(f.name)}(${['self', ...params].join(', ')}):`;
    return `${this.asyncFuncs.has(f.name) ? 'async ' : ''}def ${this.fn(f.name)}(${params.join(', ')}):`;
  }

  protected override funcPrologue(_f: FuncDecl, scope: ScopeInfo): void {
    const globals = [...scope.globalsAssigned].map((g) => this.v(g));
    if (globals.length) this.em.line(`global ${globals.join(', ')}`);
  }

  protected override emitClass(c: ClassDecl): void {
    this.em.line(`class ${this.typeId(c.name)}${c.implements ? `(${this.typeId(c.implements)})` : ''}:`);
    this.em.indent();
    const fields = c.fields.map((f) => this.member(f.name));
    this.em.line(`def __init__(${['self', ...fields].join(', ')}):`);
    this.em.indent();
    if (!fields.length) this.em.line('pass');
    for (const f of fields) this.em.line(`self.${f} = ${f}`);
    this.em.dedent();
    for (const m of c.methods) {
      this.em.blank();
      this.emitFunc(m, c);
    }
    this.em.dedent();
    this.em.blank();
  }

  protected override emitInterface(i: InterfaceDecl): void {
    this.imports.add('from abc import ABC, abstractmethod');
    this.em.line(`class ${this.typeId(i.name)}(ABC):`);
    this.em.indent();
    if (!i.methods.length) this.em.line('pass');
    i.methods.forEach((m, idx) => {
      if (idx) this.em.blank();
      this.em.line('@abstractmethod');
      this.em.line(`def ${this.member(m.name)}(${['self', ...m.params.map((p) => this.member(p.name))].join(', ')}):`);
      this.em.indent();
      this.em.line('pass');
      this.em.dedent();
    });
    this.em.dedent();
    this.em.blank();
  }

  // ----- expressions -----

  /** Expression as text, converting non-strings with str(). */
  private text(e: Parameters<PythonGenerator['ex']>[0]): string {
    return e.t?.k === 'string' ? this.ex(e).c : `str(${this.ex(e).c})`;
  }

  protected override eUn(e: E<'un'>): X {
    if (e.op === 'not') return { c: `not ${paren(this.ex(e.e), P.CMP)}`, p: P.NOT };
    return super.eUn(e);
  }

  protected override ePow(e: E<'bin'>): X {
    return { c: `${paren(this.ex(e.l), P.POW + 1)} ** ${paren(this.ex(e.r), P.UNARY)}`, p: P.POW };
  }

  protected override eCall(e: E<'call'>): X {
    return super.eCall(e);
  }

  protected override eMap(e: E<'map'>): X {
    return atom(`{${e.entries.map((x) => `${this.ex(x.key).c}: ${this.ex(x.value).c}`).join(', ')}}`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return { c: `${paren(this.ex(e.key), P.CMP + 1)} in ${paren(this.ex(e.target), P.CMP + 1)}`, p: P.CMP };
  }

  protected eLen(e: E<'len'>): X {
    return post(`len(${this.ex(e.target).c})`);
  }

  protected eConcat(e: E<'concat'>): X {
    if (e.parts.length === 1) return post(this.text(e.parts[0]));
    return { c: e.parts.map((p) => (p.t?.k === 'string' ? paren(this.ex(p), P.ADD + 1) : `str(${this.ex(p).c})`)).join(' + '), p: P.ADD };
  }

  protected eConvert(e: E<'convert'>): X {
    return post(`${{ int: 'int', float: 'float', string: 'str', bool: 'bool' }[e.to]}(${this.ex(e.e).c})`);
  }

  protected eInput(e: E<'input'>): X {
    const call = `input(${e.prompt.k === 'missing' ? '' : this.ex(e.prompt).c})`;
    return post(e.numeric ? `float(${call})` : call);
  }

  protected eMath(e: E<'math'>): X {
    const a = e.args.map((x) => this.ex(x).c);
    const m = (fn: string) => {
      this.imports.add('import math');
      return post(`math.${fn}(${a.join(', ')})`);
    };
    switch (e.fn) {
      case 'abs':
        return post(`abs(${a[0]})`);
      case 'round':
        return post(`round(${a[0]})`);
      case 'min':
      case 'max':
        return post(`${e.fn}(${a.join(', ')})`);
      case 'ln':
        return m('log');
      case 'pow10':
        return { c: `10 ** ${paren(this.ex(e.args[0]), P.UNARY)}`, p: P.POW };
      default:
        return m(e.fn);
    }
  }

  protected eRandom(e: E<'random'>): X {
    this.imports.add('import random');
    return post(`random.randint(${this.ex(e.from).c}, ${this.ex(e.to).c})`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    const a = paren(this.ex(e.args[0]), P.POST);
    if (e.op === 'contains') return { c: `${paren(this.ex(e.args[1]), P.CMP + 1)} in ${paren(this.ex(e.args[0]), P.CMP + 1)}`, p: P.CMP };
    return post(`${a}.${{ upper: 'upper', lower: 'lower', trim: 'strip' }[e.op]}()`);
  }

  protected override eTernary(e: E<'ternary'>): X {
    return { c: `${paren(this.ex(e.a), P.TERN + 1)} if ${paren(this.ex(e.cond), P.TERN + 1)} else ${paren(this.ex(e.b), P.TERN)}`, p: P.TERN };
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    return post(`open(${this.ex(e.path).c}, encoding="utf-8").read()`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.imports.add('import os');
    return post(`os.path.exists(${this.ex(e.path).c})`);
  }

  protected override eJsonParse(e: E<'jsonParse'>): X {
    this.imports.add('import json');
    return post(`json.loads(${this.ex(e.e).c})`);
  }

  protected override eJsonStringify(e: E<'jsonStringify'>): X {
    this.imports.add('import json');
    return post(`json.dumps(${this.ex(e.e).c})`);
  }

  protected override eHttpGet(e: E<'httpGet'>): X {
    this.imports.add('import urllib.request');
    return post(`urllib.request.urlopen(${this.ex(e.url).c}).read().decode("utf-8")`);
  }

  protected override eShell(e: E<'shell'>): X {
    this.imports.add('import subprocess');
    return post(`subprocess.run(${this.ex(e.cmd).c}, shell=True, capture_output=True, text=True).stdout`);
  }

  protected override eNew(e: E<'new'>): X {
    return post(`${this.typeId(e.name)}(${this.args(e.args)})`);
  }

  protected override eAwait(e: E<'await'>): X {
    if (e.e.k === 'call' && this.asyncFuncs.has(e.e.name)) return this.ex(e.e);
    return this.awaited(this.ex(e.e));
  }

  protected override eFuncRef(e: E<'funcRef'>): X {
    return atom(this.fn(e.name));
  }

  protected override eCallRef(e: E<'callRef'>): X {
    return post(`${paren(this.ex(e.fn), P.POST)}(${this.args(e.args)})`);
  }
}

export default new PythonGenerator();
