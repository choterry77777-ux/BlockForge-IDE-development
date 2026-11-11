import type { VarInfo } from '../ir/analyze';
import { type ClassDecl, type Expr, type FuncDecl, type InterfaceDecl, T, type TypeRef } from '../ir/types';
import { type E, ImperativeGenerator, P, paren, post, type RangeInfo, type S, type X } from './base';
import { type Emitter, quote } from './emitter';

export class CppGenerator extends ImperativeGenerator {
  readonly lang = 'cpp' as const;
  protected readonly reservedWords = ['alignas', 'alignof', 'and', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'not', 'nullptr', 'operator', 'or', 'private', 'protected', 'public', 'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while', 'xor', 'main', 'std', 'string', 'vector', 'map', 'cout', 'cin', 'endl', 'input', 'toText', 'randomInt', 'readFile', 'trim', 'toUpper', 'toLower', 'printList', 'index', 'time', 'count', 'min', 'max', 'abs', 'round', 'floor', 'ceil', 'pow', 'sqrt', 'log', 'exp', 'sin', 'cos', 'tan', 'remove', 'rename', 'signal', 'y0', 'y1', 'yn', 'j0', 'j1', 'jn', 'div', 'exit'];
  protected override staticTypes = true;
  private includes = new Set<string>();
  private printsFloat = false;

  private inc(h: string): void {
    this.includes.add(h);
  }

  protected layout(): Emitter {
    this.includes = new Set(['iostream']);
    this.printsFloat = false;
    const body = this.em;
    this.emitTypes();
    this.globalsDecl();
    for (const f of this.program.funcs) body.line(`${this.signature(f)};`);
    if (this.program.funcs.length) body.blank();
    for (const f of this.program.funcs) {
      this.emitFunc(f);
      body.blank();
    }
    const main = this.newEmitter();
    const saved = this.em;
    this.em = main;
    main.line('int main() {');
    main.indent();
    const mark = main.count;
    this.emitMain();
    main.line('return 0;');
    main.dedent();
    main.line('}');
    if (this.printsFloat) {
      this.inc('iomanip');
      main.lines.splice(mark, 0, `${this.indentUnit}std::cout << std::setprecision(15);`);
      for (const m of main.maps) {
        if (m.start > mark) m.start++;
        if (m.end > mark) m.end++;
      }
    }
    this.em = saved;
    body.append(main);
    const out = this.newEmitter();
    for (const h of [...this.includes].sort()) out.line(`#include <${h}>`);
    for (const i of [...this.imports].sort()) out.line(i);
    out.blank();
    for (const lines of this.helpers.values()) {
      out.block(lines);
      out.blank();
    }
    out.append(body);
    return out;
  }

  private emitTypes(): void {
    for (const i of this.program.interfaces) {
      const start = this.em.count;
      this.emitInterface(i);
      this.em.mark(i.id, start);
      this.em.blank();
    }
    for (const c of this.program.classes) {
      const start = this.em.count;
      this.curClass = c;
      this.emitClass(c);
      this.curClass = undefined;
      this.em.mark(c.id, start);
      this.em.blank();
    }
  }

  protected override importLine(module: string): string {
    return `#include <${module}>`;
  }

  protected override sImport(s: S<'import'>): void {
    if (s.module) this.imports.add(this.importLine(s.module));
  }

  // ----- types -----

  protected override typeName(t: TypeRef, id?: string): string {
    switch (t.k) {
      case 'int':
        return 'int';
      case 'float':
        return 'double';
      case 'string':
        this.inc('string');
        return 'std::string';
      case 'bool':
        return 'bool';
      case 'void':
        return 'void';
      case 'list':
        this.inc('vector');
        return `std::vector<${this.typeName(this.settle(t, 'list', id).k === 'list' ? (this.settle(t, 'list', id) as { of: TypeRef }).of : T.int, id)}>`;
      case 'map': {
        this.inc('map');
        const m = this.settle(t, 'dictionary', id) as { key: TypeRef; value: TypeRef };
        return `std::map<${this.typeName(m.key, id)}, ${this.typeName(m.value, id)}>`;
      }
      case 'struct':
        return this.typeId(t.name);
      case 'ptr':
        return `${this.typeName(t.to, id)} *`;
      case 'func':
        this.unsupported(id, 'function values', 'Function pointers need an explicit signature.');
        return 'int';
      case 'any':
        return this.mixed(id);
      default:
        return 'int';
    }
  }

  private decl(t: TypeRef, name: string, id?: string): string {
    const tn = this.typeName(t, id);
    return tn.endsWith('*') ? `${tn}${name}` : `${tn} ${name}`;
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
      case 'struct':
        return `${this.typeName(t)}{}`;
      case 'ptr':
        return 'nullptr';
      default:
        return '0';
    }
  }

  protected override nullLiteral(): string {
    return 'nullptr';
  }

  protected override str(s: string): string {
    return quote(s, { control: 'octal' });
  }

  /** A std::string value; literals are wrapped so that + concatenation is always valid. */
  private text(e: Expr): string {
    if (e.k === 'str') {
      this.inc('string');
      return `std::string(${this.str(e.value)})`;
    }
    if (e.t?.k === 'string') return paren(this.ex(e), P.ADD + 1);
    this.toTextHelper();
    return `toText(${this.ex(e).c})`;
  }

  private toTextHelper(): void {
    this.inc('sstream');
    this.inc('iomanip');
    this.inc('string');
    this.helper('toText', [
      '// Converts any printable value to text.',
      'template <typename T>',
      'std::string toText(const T &value) {',
      '    std::ostringstream out;',
      '    out << std::boolalpha << std::setprecision(15) << value;',
      '    return out.str();',
      '}',
    ]);
  }

  // ----- declarations -----

  protected override declare(name: string, info: VarInfo, init: string): void {
    const t = this.varType(info);
    this.em.line(`${info.isConst ? 'const ' : ''}${this.decl(t, this.v(name), info.declNode?.id)} = ${init};`);
  }

  private signature(f: FuncDecl): string {
    const params = f.params.map((p) => this.decl(this.paramType(p, f), this.v(p.name), f.id)).join(', ');
    return `${this.decl(f.ret, this.fn(f.name), f.id)}(${params})`;
  }

  protected funcOpen(f: FuncDecl, isMethod: boolean): string {
    if (!isMethod) return `${this.signature(f)} {`;
    const params = f.params.map((p) => this.decl(p.type, this.v(p.name), f.id)).join(', ');
    const iface = this.curClass?.implements ? this.program.interfaces.find((i) => i.name === this.curClass!.implements) : undefined;
    const overrides = iface?.methods.some((m) => m.name === f.name) ? ' override' : '';
    return `${this.decl(f.ret, this.member(f.name), f.id)}(${params})${overrides} {`;
  }

  protected override emitClass(c: ClassDecl): void {
    const name = this.typeId(c.name);
    if (c.isStruct) {
      this.em.line(`struct ${name} {`);
      this.em.indent();
      for (const f of c.fields) this.em.line(`${this.decl(f.type, this.member(f.name), f.id)};`);
      this.em.dedent();
      this.em.line('};');
      return;
    }
    this.em.line(`class ${name}${c.implements ? ` : public ${this.typeId(c.implements)}` : ''} {`);
    this.em.line('public:');
    this.em.indent();
    for (const f of c.fields) this.em.line(`${this.decl(f.type, this.member(f.name), f.id)};`);
    if (c.fields.length) this.em.blank();
    const params = c.fields.map((f) => this.decl(f.type, this.member(f.name), f.id)).join(', ');
    const inits = c.fields.map((f) => `${this.member(f.name)}(${this.member(f.name)})`).join(', ');
    this.em.line(`${name}(${params})${inits ? ` : ${inits}` : ''} {}`);
    for (const m of c.methods) {
      this.em.blank();
      this.emitFunc(m, c);
    }
    this.em.dedent();
    this.em.line('};');
  }

  protected override emitInterface(i: InterfaceDecl): void {
    const name = this.typeId(i.name);
    this.em.line(`class ${name} {`);
    this.em.line('public:');
    this.em.indent();
    this.em.line(`virtual ~${name}() = default;`);
    for (const m of i.methods) {
      this.em.line(`virtual ${this.decl(m.ret, this.member(m.name), m.id)}(${m.params.map((p) => this.decl(p.type, this.member(p.name), m.id)).join(', ')}) = 0;`);
    }
    this.em.dedent();
    this.em.line('};');
  }

  // ----- statements -----

  private streamArg(e: Expr): string {
    if (e.t?.k === 'float') this.printsFloat = true;
    if (e.t?.k === 'bool') return `(${paren(this.ex(e), P.TERN + 1)} ? "true" : "false")`;
    // << binds tighter than comparison and logic operators.
    return paren(this.ex(e), P.ADD);
  }

  protected sPrint(s: S<'print'>): void {
    const parts = s.value.k === 'concat' ? s.value.parts : [s.value];
    if (parts.length === 1 && parts[0].t?.k === 'list') {
      const list = this.ex(parts[0]).c;
      this.printsFloat = true;
      this.em.line('std::cout << "[";');
      this.em.line(`for (std::size_t i = 0; i < ${list}.size(); i++) std::cout << (i ? ", " : "") << ${list}[i];`);
      this.em.line('std::cout << "]\\n";');
      return;
    }
    this.em.line(`std::cout << ${parts.map((p) => this.streamArg(p)).join(' << ')} << "\\n";`);
  }

  protected repeatOpen(count: string, counter: string): string {
    return `for (int ${counter} = 0; ${counter} < ${count}; ${counter}++) {`;
  }

  protected forRangeOpen(r: RangeInfo): string {
    const step = r.stepIsOne ? `${r.v}${r.desc ? '--' : '++'}` : `${r.v} ${r.desc ? '-=' : '+='} ${r.step}`;
    return `for (${r.declare ? this.typeName(r.type) + ' ' : ''}${r.v} = ${r.from}; ${r.v} ${r.desc ? '>=' : '<='} ${r.to}; ${step}) {`;
  }

  protected forEachOpen(v: string, iter: string, _s: S<'forEach'>, declare: boolean): string | [string, string] {
    if (declare) return `for (auto ${v} : ${iter}) {`;
    const tmp = this.names.fresh('item');
    return [`for (auto ${tmp} : ${iter}) {`, `${v} = ${tmp};`];
  }

  protected override sListAppend(s: S<'listAppend'>): void {
    this.em.line(`${paren(this.ex(s.list), P.POST)}.push_back(${this.valueFor(s.value, this.elemType(s.list))});`);
  }

  protected override sListRemove(s: S<'listRemove'>): void {
    const l = paren(this.ex(s.list), P.POST);
    this.em.line(`${l}.erase(${l}.begin() + ${paren(this.ex(s.index), P.ADD + 1)});`);
  }

  protected override sMapDelete(s: S<'mapDelete'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}.erase(${this.key(s.key)});`);
  }

  protected override sMapSet(s: S<'mapSet'>): void {
    this.em.line(`${paren(this.ex(s.map), P.POST)}[${this.key(s.key)}] = ${this.valueFor(s.value, s.map.t?.k === 'map' ? s.map.t.value : undefined)};`);
  }

  private key(e: Expr): string {
    return this.ex(e).c;
  }

  protected override sTry(s: S<'try'>): void {
    this.inc('exception');
    const e = this.names.fresh('error');
    this.em.line('try {');
    this.em.indent();
    this.body(s.body);
    this.em.dedent();
    this.em.line(`} catch (const std::exception &${e}) {`);
    this.em.indent();
    this.bind(s, s.errVar, `${e}.what()`);
    for (const h of s.handler) this.stmt(h);
    this.em.dedent();
    this.em.line('}');
  }

  protected override sThrow(s: S<'throw'>): void {
    this.inc('stdexcept');
    this.em.line(`throw std::runtime_error(${this.ex(s.message).c});`);
  }

  protected override sFileWrite(s: S<'fileWrite'>): void {
    this.inc('fstream');
    const f = this.names.fresh('file');
    this.em.line(`std::ofstream ${f}(${this.ex(s.path).c}${s.append ? ', std::ios::app' : ''});`);
    this.em.line(`${f} << ${this.streamArg(s.content)};`);
    this.em.line(`${f}.close();`);
  }

  protected override sSleep(s: S<'sleep'>): void {
    this.inc('thread');
    this.inc('chrono');
    this.em.line(`std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<long long>(${this.ex(s.ms).c})));`);
  }

  protected override sShellRun(s: S<'shellRun'>): void {
    this.inc('cstdlib');
    this.em.line(`std::system(${this.text(s.cmd)}.c_str());`);
  }

  protected override sFieldSet(s: S<'fieldSet'>): void {
    this.em.line(`${this.fieldRef(s.target, s.name)} = ${this.ex(s.value).c};`);
  }

  private fieldRef(target: Expr, name: string): string {
    if (target.k === 'this') return `this->${this.member(name)}`;
    return `${paren(this.ex(target), P.POST)}.${this.member(name)}`;
  }

  protected override sDerefSet(s: S<'derefSet'>): void {
    this.em.line(`*${paren(this.ex(s.ptr), P.UNARY)} = ${this.ex(s.value).c};`);
  }

  protected override sFree(s: S<'free'>): void {
    this.em.line(`delete[] ${this.v(s.name)};`);
  }

  // ----- expressions -----

  protected override ex(e: Expr): X {
    if (e.k === 'field') return post(this.fieldRef(e.target, e.name));
    if (e.k === 'this') return { c: '*this', p: P.UNARY };
    return super.ex(e);
  }

  protected override toFloat(x: X): X {
    return post(`static_cast<double>(${x.c})`);
  }

  protected override ePow(e: E<'bin'>): X {
    this.inc('cmath');
    return post(`std::pow(${this.ex(e.l).c}, ${this.ex(e.r).c})`);
  }

  protected override eBin(e: E<'bin'>): X {
    if (e.op === '%' && e.t?.k === 'float') {
      this.inc('cmath');
      return post(`std::fmod(${this.ex(e.l).c}, ${this.ex(e.r).c})`);
    }
    return super.eBin(e);
  }

  protected override eEquality(e: E<'bin'>): X {
    if (e.l.k === 'str' && e.r.k === 'str') return { c: `${this.text(e.l)} ${e.op} ${this.text(e.r)}`, p: P.CMP };
    return super.eEquality(e);
  }

  protected override eList(e: E<'list'>): X {
    const t = this.settle(e.t ?? T.list(T.int), 'list', e.id);
    const of = t.k === 'list' ? t.of : T.int;
    return post(`${this.typeName(T.list(of), e.id)}{${e.items.map((i) => this.valueFor(i, of)).join(', ')}}`);
  }

  protected override eMap(e: E<'map'>): X {
    const t = this.settle(e.t ?? T.map(T.string, T.int), 'dictionary', e.id);
    return post(`${this.typeName(t, e.id)}{}`);
  }

  protected override eMapGet(e: E<'mapGet'>): X {
    return post(`${paren(this.ex(e.target), P.POST)}.at(${this.key(e.key)})`);
  }

  protected override eMapHas(e: E<'mapHas'>): X {
    return { c: `${paren(this.ex(e.target), P.POST)}.count(${this.key(e.key)}) > 0`, p: P.CMP };
  }

  protected eLen(e: E<'len'>): X {
    // A text literal is a char array in C++, so it is wrapped before calling members.
    const target = e.target.k === 'str' ? this.text(e.target) : paren(this.ex(e.target), P.POST);
    return post(`static_cast<int>(${target}.size())`);
  }

  protected eConcat(e: E<'concat'>): X {
    return { c: e.parts.map((p) => this.text(p)).join(' + '), p: e.parts.length === 1 ? P.POST : P.ADD };
  }

  protected eConvert(e: E<'convert'>): X {
    const from = e.e.t?.k;
    const x = this.ex(e.e);
    this.inc('string');
    switch (e.to) {
      case 'int':
        return post(from === 'string' ? `std::stoi(${x.c})` : `static_cast<int>(${x.c})`);
      case 'float':
        return post(from === 'string' ? `std::stod(${x.c})` : `static_cast<double>(${x.c})`);
      case 'string':
        return post(this.text(e.e));
      case 'bool':
        return from === 'string' ? { c: `!${e.e.k === 'str' ? this.text(e.e) : paren(x, P.POST)}.empty()`, p: P.UNARY } : { c: `${paren(x, P.CMP + 1)} != 0`, p: P.CMP };
    }
  }

  protected eInput(e: E<'input'>): X {
    this.inc('string');
    this.helper('input', ['// Prints a prompt and reads one line of text.', 'std::string input(const std::string &prompt) {', '    std::string line;', '    std::cout << prompt << std::flush;', '    std::getline(std::cin, line);', "    if (!line.empty() && line.back() == '\\r') line.pop_back();", '    return line;', '}']);
    const call = `input(${e.prompt.k === 'missing' ? '""' : this.ex(e.prompt).c})`;
    return post(e.numeric ? `std::stod(${call})` : call);
  }

  protected eMath(e: E<'math'>): X {
    this.inc('cmath');
    const a = e.args.map((x) => this.ex(x).c);
    const isFloat = e.args.some((x) => x.t?.k === 'float');
    switch (e.fn) {
      case 'abs':
        if (!isFloat) this.inc('cstdlib');
        return post(`std::abs(${a[0]})`);
      case 'floor':
      case 'ceil':
      case 'round':
        return post(`static_cast<int>(std::${e.fn}(${a[0]}))`);
      case 'min':
      case 'max':
        this.inc('algorithm');
        return post(`std::${e.fn}<${isFloat ? 'double' : 'int'}>(${a.join(', ')})`);
      case 'ln':
        return post(`std::log(${a[0]})`);
      case 'pow10':
        return post(`std::pow(10, ${a[0]})`);
      default:
        return post(`std::${e.fn}(${a[0]})`);
    }
  }

  protected eRandom(e: E<'random'>): X {
    this.inc('random');
    this.helper('randomInt', ['int randomInt(int low, int high) {', '    static std::mt19937 engine(std::random_device{}());', '    return std::uniform_int_distribution<int>(low, high)(engine);', '}']);
    return post(`randomInt(${this.ex(e.from).c}, ${this.ex(e.to).c})`);
  }

  protected eStrOp(e: E<'strOp'>): X {
    this.inc('string');
    if (e.op === 'contains') return { c: `${this.text(e.args[0])}.find(${this.ex(e.args[1]).c}) != std::string::npos`, p: P.CMP };
    if (e.op === 'trim') {
      this.helper('trim', [
        'std::string trim(const std::string &text) {',
        '    const char *spaces = " \\t\\r\\n";',
        '    std::size_t first = text.find_first_not_of(spaces);',
        '    if (first == std::string::npos) return "";',
        '    return text.substr(first, text.find_last_not_of(spaces) - first + 1);',
        '}',
      ]);
      return post(`trim(${this.ex(e.args[0]).c})`);
    }
    this.inc('algorithm');
    this.inc('cctype');
    const name = e.op === 'upper' ? 'toUpper' : 'toLower';
    this.helper(name, [
      `std::string ${name}(std::string text) {`,
      `    std::transform(text.begin(), text.end(), text.begin(), [](unsigned char ch) { return static_cast<char>(std::${e.op === 'upper' ? 'toupper' : 'tolower'}(ch)); });`,
      '    return text;',
      '}',
    ]);
    return post(`${name}(${this.ex(e.args[0]).c})`);
  }

  protected override eFileRead(e: E<'fileRead'>): X {
    this.inc('fstream');
    this.inc('sstream');
    this.inc('string');
    this.helper('readFile', ['// Returns the whole file as text, or an empty text when it cannot be read.', 'std::string readFile(const std::string &path) {', '    std::ifstream file(path);', '    std::ostringstream text;', '    text << file.rdbuf();', '    return text.str();', '}']);
    return post(`readFile(${this.ex(e.path).c})`);
  }

  protected override eFileExists(e: E<'fileExists'>): X {
    this.inc('fstream');
    return post(`std::ifstream(${this.ex(e.path).c}).good()`);
  }

  protected override eShell(e: E<'shell'>): X {
    this.inc('cstdio');
    this.inc('string');
    this.helper('shellOutput', [
      '// Runs a command and returns what it printed.',
      'std::string shellOutput(const std::string &command) {',
      '    std::string text;',
      '    char buffer[256];',
      '    FILE *pipe = popen(command.c_str(), "r");',
      '    if (!pipe) return text;',
      '    while (fgets(buffer, sizeof(buffer), pipe)) text += buffer;',
      '    pclose(pipe);',
      '    return text;',
      '}',
    ]);
    return post(`shellOutput(${this.ex(e.cmd).c})`);
  }

  protected override eNew(e: E<'new'>): X {
    const cls = this.an.classes.get(e.name);
    const args = this.args(e.args, cls?.fields.map((f) => f.type));
    return post(cls?.isStruct ? `${this.typeId(e.name)}{${args}}` : `${this.typeId(e.name)}(${args})`);
  }

  protected override eMethod(e: E<'method'>): X {
    const cls = e.target.t?.k === 'struct' ? this.an.classes.get(e.target.t.name) : undefined;
    const m = cls?.methods.find((x) => x.name === e.name);
    const target = e.target.k === 'this' ? 'this->' : `${paren(this.ex(e.target), P.POST)}.`;
    return post(`${target}${this.member(e.name)}(${this.args(e.args, m?.params.map((p) => p.type))})`);
  }

  protected override eAddrOf(e: E<'addrOf'>): X {
    return { c: `&${this.v(e.name)}`, p: P.UNARY };
  }

  protected override eDeref(e: E<'deref'>): X {
    return { c: `*${paren(this.ex(e.e), P.UNARY)}`, p: P.UNARY };
  }

  protected override eAlloc(e: E<'alloc'>): X {
    return { c: `new ${this.typeName(e.elem)}[${this.ex(e.count).c}]()`, p: P.UNARY };
  }
}

export default new CppGenerator();
