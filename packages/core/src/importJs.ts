/**
 * Source code -> blocks for a subset of JavaScript.
 *
 * Anything outside the subset is kept verbatim in a raw code block and reported,
 * so importing never loses code silently. The conversion is not promised to be
 * lossless: comments and formatting are not preserved.
 */
import { type Node, parse } from 'acorn';
import { type BlockSpec, specsToWorkspace, type WorkspaceState } from './blocks/state';

export interface ImportWarning {
  line: number;
  message: string;
}

export interface ImportResult {
  ok: boolean;
  state?: WorkspaceState;
  warnings: ImportWarning[];
  /** Statements and expressions converted to real blocks / kept as raw code. */
  converted: number;
  raw: number;
  error?: string;
}

type N = Node & Record<string, any>;

const ARITH: Record<string, string> = { '+': 'ADD', '-': 'MINUS', '*': 'MULTIPLY', '/': 'DIVIDE', '**': 'POWER' };
const COMPARE: Record<string, string> = { '==': 'EQ', '===': 'EQ', '!=': 'NEQ', '!==': 'NEQ', '<': 'LT', '<=': 'LTE', '>': 'GT', '>=': 'GTE' };
const MATH1: Record<string, [string, string]> = { sqrt: ['math_single', 'ROOT'], abs: ['math_single', 'ABS'], log: ['math_single', 'LN'], log10: ['math_single', 'LOG10'], exp: ['math_single', 'EXP'], round: ['math_round', 'ROUND'], ceil: ['math_round', 'ROUNDUP'], floor: ['math_round', 'ROUNDDOWN'] };

class Importer {
  warnings: ImportWarning[] = [];
  converted = 0;
  raw = 0;
  private funcs = new Map<string, { params: string[]; returns: boolean }>();

  constructor(readonly source: string) {}

  private line(n: N): number {
    return n.loc?.start.line ?? 0;
  }

  private text(n: N): string {
    return this.source.slice(n.start, n.end);
  }

  private rawStmt(n: N, why: string): BlockSpec {
    this.raw++;
    this.warnings.push({ line: this.line(n), message: `${why} is kept as raw JavaScript.` });
    return { type: 'bf_raw_stmt', fields: { LANG: 'javascript', CODE: this.text(n) } };
  }

  private rawExpr(n: N, why: string): BlockSpec {
    this.raw++;
    this.warnings.push({ line: this.line(n), message: `${why} is kept as a raw JavaScript expression.` });
    return { type: 'bf_raw_expr', fields: { LANG: 'javascript', CODE: this.text(n) } };
  }

  private isTexty(n: N): boolean {
    return (n.type === 'Literal' && typeof n.value === 'string') || n.type === 'TemplateLiteral' || (n.type === 'BinaryExpression' && n.operator === '+' && (this.isTexty(n.left) || this.isTexty(n.right)));
  }

  private flattenConcat(n: N): N[] {
    if (n.type === 'BinaryExpression' && n.operator === '+' && this.isTexty(n)) return [...this.flattenConcat(n.left), ...this.flattenConcat(n.right)];
    return [n];
  }

  scan(program: N): void {
    for (const s of program.body as N[]) {
      if (s.type === 'FunctionDeclaration' && s.id) {
        let returns = false;
        const look = (x: any): void => {
          if (!x || typeof x !== 'object') return;
          if (Array.isArray(x)) return x.forEach(look);
          if (x.type === 'ReturnStatement' && x.argument) returns = true;
          if (x.type === 'FunctionDeclaration' || x.type === 'FunctionExpression' || x.type === 'ArrowFunctionExpression') return;
          for (const k of Object.keys(x)) if (k !== 'loc') look(x[k]);
        };
        look(s.body.body);
        this.funcs.set(s.id.name, { params: s.params.map((p: N) => (p.type === 'Identifier' ? p.name : '')), returns });
      }
    }
  }

  expr(n: N): BlockSpec {
    const ok = (spec: BlockSpec) => {
      this.converted++;
      return spec;
    };
    switch (n.type) {
      case 'Literal':
        if (typeof n.value === 'number') return ok({ type: 'math_number', fields: { NUM: n.value } });
        if (typeof n.value === 'string') return ok({ type: 'text', fields: { TEXT: n.value } });
        if (typeof n.value === 'boolean') return ok({ type: 'logic_boolean', fields: { BOOL: n.value ? 'TRUE' : 'FALSE' } });
        if (n.value === null && n.raw === 'null') return ok({ type: 'logic_null' });
        return this.rawExpr(n, 'This literal');
      case 'Identifier':
        if (n.name === 'undefined') return ok({ type: 'logic_null' });
        return ok({ type: 'variables_get', fields: { VAR: n.name } });
      case 'TemplateLiteral': {
        const parts: BlockSpec[] = [];
        n.quasis.forEach((q: N, i: number) => {
          if (q.value.cooked) parts.push({ type: 'text', fields: { TEXT: q.value.cooked } });
          if (n.expressions[i]) parts.push(this.expr(n.expressions[i]));
        });
        return ok({ type: 'text_join', inputs: Object.fromEntries(parts.map((p, i) => [`ADD${i}`, p])) });
      }
      case 'UnaryExpression':
        if (n.operator === '!') return ok({ type: 'logic_negate', inputs: { BOOL: this.expr(n.argument) } });
        if (n.operator === '-') {
          if (n.argument.type === 'Literal' && typeof n.argument.value === 'number') return ok({ type: 'math_number', fields: { NUM: -n.argument.value } });
          return ok({ type: 'math_single', fields: { OP: 'NEG' }, inputs: { NUM: this.expr(n.argument) } });
        }
        return this.rawExpr(n, `The operator "${n.operator}"`);
      case 'BinaryExpression':
        if (n.operator === '+' && this.isTexty(n)) {
          const parts = this.flattenConcat(n).map((p) => this.expr(p));
          return ok({ type: 'text_join', inputs: Object.fromEntries(parts.map((p, i) => [`ADD${i}`, p])) });
        }
        if (ARITH[n.operator]) return ok({ type: 'math_arithmetic', fields: { OP: ARITH[n.operator] }, inputs: { A: this.expr(n.left), B: this.expr(n.right) } });
        if (n.operator === '%') return ok({ type: 'math_modulo', inputs: { DIVIDEND: this.expr(n.left), DIVISOR: this.expr(n.right) } });
        if (COMPARE[n.operator]) return ok({ type: 'logic_compare', fields: { OP: COMPARE[n.operator] }, inputs: { A: this.expr(n.left), B: this.expr(n.right) } });
        return this.rawExpr(n, `The operator "${n.operator}"`);
      case 'LogicalExpression':
        if (n.operator === '&&' || n.operator === '||') return ok({ type: 'logic_operation', fields: { OP: n.operator === '&&' ? 'AND' : 'OR' }, inputs: { A: this.expr(n.left), B: this.expr(n.right) } });
        return this.rawExpr(n, `The operator "${n.operator}"`);
      case 'ConditionalExpression':
        return ok({ type: 'logic_ternary', inputs: { IF: this.expr(n.test), THEN: this.expr(n.consequent), ELSE: this.expr(n.alternate) } });
      case 'ArrayExpression':
        if (n.elements.some((e: N | null) => !e || e.type === 'SpreadElement')) return this.rawExpr(n, 'This array');
        return ok({ type: 'lists_create_with', inputs: Object.fromEntries(n.elements.map((e: N, i: number) => [`ADD${i}`, this.expr(e)])) });
      case 'MemberExpression':
        if (!n.computed && n.property.name === 'length') return ok({ type: 'lists_length', inputs: { VALUE: this.expr(n.object) } });
        if (n.computed) return ok({ type: 'bf_list_get', inputs: { LIST: this.expr(n.object), INDEX: this.expr(n.property) } });
        return this.rawExpr(n, 'This property access');
      case 'CallExpression': {
        const c = n.callee as N;
        const args = n.arguments as N[];
        if (args.some((a) => a.type === 'SpreadElement')) return this.rawExpr(n, 'A call with spread arguments');
        if (c.type === 'Identifier') {
          const fn = this.funcs.get(c.name);
          if (fn && fn.params.length === args.length) return ok({ type: 'procedures_callreturn', fields: { NAME: c.name }, inputs: Object.fromEntries(args.map((a, i) => [`ARG${i}`, this.expr(a)])) });
          if (c.name === 'String' && args.length === 1) return ok({ type: 'bf_convert', fields: { TO: 'string' }, inputs: { VALUE: this.expr(args[0]) } });
          if ((c.name === 'Number' || c.name === 'parseFloat') && args.length === 1) return ok({ type: 'bf_convert', fields: { TO: 'float' }, inputs: { VALUE: this.expr(args[0]) } });
          if (c.name === 'parseInt' && args.length >= 1) return ok({ type: 'bf_convert', fields: { TO: 'int' }, inputs: { VALUE: this.expr(args[0]) } });
          if (c.name === 'Boolean' && args.length === 1) return ok({ type: 'bf_convert', fields: { TO: 'bool' }, inputs: { VALUE: this.expr(args[0]) } });
          if (c.name === 'prompt') return ok({ type: 'text_prompt_ext', fields: { TYPE: 'TEXT' }, inputs: { TEXT: args[0] ? this.expr(args[0]) : { type: 'text', fields: { TEXT: '' } } } });
        }
        if (c.type === 'MemberExpression' && !c.computed) {
          const obj = c.object as N;
          const name = c.property.name as string;
          if (obj.type === 'Identifier' && obj.name === 'Math') {
            if (MATH1[name] && args.length === 1) return ok({ type: MATH1[name][0], fields: { OP: MATH1[name][1] }, inputs: { NUM: this.expr(args[0]) } });
            if ((name === 'min' || name === 'max') && args.length === 2) return ok({ type: 'bf_math_minmax', fields: { FN: name }, inputs: { A: this.expr(args[0]), B: this.expr(args[1]) } });
            if ((name === 'sin' || name === 'cos' || name === 'tan') && args.length === 1) return ok({ type: 'bf_math_fn', fields: { FN: name }, inputs: { NUM: this.expr(args[0]) } });
            if (name === 'pow' && args.length === 2) return ok({ type: 'math_arithmetic', fields: { OP: 'POWER' }, inputs: { A: this.expr(args[0]), B: this.expr(args[1]) } });
          }
          if (args.length === 0 && (name === 'toUpperCase' || name === 'toLowerCase' || name === 'trim')) return ok({ type: 'bf_str_op', fields: { OP: { toUpperCase: 'upper', toLowerCase: 'lower', trim: 'trim' }[name]! }, inputs: { VALUE: this.expr(obj) } });
          if (name === 'includes' && args.length === 1) return ok({ type: 'bf_str_contains', inputs: { TEXT: this.expr(obj), FIND: this.expr(args[0]) } });
        }
        return this.rawExpr(n, 'This call');
      }
      default:
        return this.rawExpr(n, `"${n.type}"`);
    }
  }

  private countingLoop(n: N): BlockSpec | undefined {
    const init = n.init as N | null;
    const test = n.test as N | null;
    const update = n.update as N | null;
    if (!init || !test || !update) return undefined;
    let name: string | undefined;
    let from: N | undefined;
    if (init.type === 'VariableDeclaration' && init.declarations.length === 1 && init.declarations[0].id.type === 'Identifier' && init.declarations[0].init) {
      name = init.declarations[0].id.name;
      from = init.declarations[0].init;
    } else if (init.type === 'AssignmentExpression' && init.operator === '=' && init.left.type === 'Identifier') {
      name = init.left.name;
      from = init.right;
    }
    if (!name || !from) return undefined;
    if (test.type !== 'BinaryExpression' || test.left.type !== 'Identifier' || test.left.name !== name) return undefined;
    let step: N | number | undefined;
    if (update.type === 'UpdateExpression' && update.argument.name === name) step = update.operator === '++' ? 1 : -1;
    else if (update.type === 'AssignmentExpression' && update.left.name === name && (update.operator === '+=' || update.operator === '-=')) step = update.operator === '+=' ? update.right : undefined;
    if (step === undefined) return undefined;
    // Blocks count to an inclusive end, so "<" and ">" need a literal bound to adjust.
    const up = typeof step !== 'number' || step > 0;
    let to: BlockSpec;
    if (test.operator === (up ? '<=' : '>=')) to = this.expr(test.right);
    else if (test.operator === (up ? '<' : '>') && test.right.type === 'Literal' && typeof test.right.value === 'number' && Number.isInteger(test.right.value)) to = { type: 'math_number', fields: { NUM: test.right.value + (up ? -1 : 1) } };
    else if (test.operator === (up ? '<' : '>')) to = { type: 'math_arithmetic', fields: { OP: up ? 'MINUS' : 'ADD' }, inputs: { A: this.expr(test.right), B: { type: 'math_number', fields: { NUM: 1 } } } };
    else return undefined;
    const by: BlockSpec = typeof step === 'number' ? { type: 'math_number', fields: { NUM: Math.abs(step) } } : this.expr(step);
    this.converted++;
    return { type: 'controls_for', fields: { VAR: name }, inputs: { FROM: this.expr(from), TO: to, BY: by }, statements: { DO: this.block(n.body) } };
  }

  block(n: N | null): BlockSpec[] {
    if (!n) return [];
    const list: N[] = n.type === 'BlockStatement' ? n.body : [n];
    return list.flatMap((s) => this.stmt(s));
  }

  stmt(n: N): BlockSpec[] {
    const ok = (...specs: BlockSpec[]) => {
      this.converted++;
      return specs;
    };
    switch (n.type) {
      case 'EmptyStatement':
        return [];
      case 'VariableDeclaration': {
        const out: BlockSpec[] = [];
        for (const d of n.declarations as N[]) {
          if (d.id.type !== 'Identifier') return [this.rawStmt(n, 'Destructuring')];
          if (!d.init) continue;
          out.push({ type: 'variables_set', fields: { VAR: d.id.name }, inputs: { VALUE: this.expr(d.init) } });
          this.converted++;
        }
        return out;
      }
      case 'ExpressionStatement': {
        const e = n.expression as N;
        if (e.type === 'AssignmentExpression') {
          if (e.left.type === 'Identifier') {
            if (e.operator === '=') return ok({ type: 'variables_set', fields: { VAR: e.left.name }, inputs: { VALUE: this.expr(e.right) } });
            if (e.operator === '+=' && !this.isTexty(e.right)) return ok({ type: 'math_change', fields: { VAR: e.left.name }, inputs: { DELTA: this.expr(e.right) } });
            if (e.operator === '-=') return ok({ type: 'math_change', fields: { VAR: e.left.name }, inputs: { DELTA: { type: 'math_single', fields: { OP: 'NEG' }, inputs: { NUM: this.expr(e.right) } } } });
          }
          if (e.operator === '=' && e.left.type === 'MemberExpression' && e.left.computed) return ok({ type: 'bf_list_set', inputs: { LIST: this.expr(e.left.object), INDEX: this.expr(e.left.property), VALUE: this.expr(e.right) } });
          return [this.rawStmt(n, 'This assignment')];
        }
        if (e.type === 'UpdateExpression' && e.argument.type === 'Identifier') return ok({ type: 'math_change', fields: { VAR: e.argument.name }, inputs: { DELTA: { type: 'math_number', fields: { NUM: e.operator === '++' ? 1 : -1 } } } });
        if (e.type === 'CallExpression') {
          const c = e.callee as N;
          const args = e.arguments as N[];
          if (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'console' && c.property.name === 'log' && args.length === 1 && args[0].type !== 'SpreadElement') return ok({ type: 'text_print', inputs: { TEXT: this.expr(args[0]) } });
          if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'push' && args.length === 1) return ok({ type: 'bf_list_append', inputs: { LIST: this.expr(c.object), VALUE: this.expr(args[0]) } });
          if (c.type === 'Identifier') {
            const fn = this.funcs.get(c.name);
            if (fn && fn.params.length === args.length && !args.some((a) => a.type === 'SpreadElement')) {
              const inputs = Object.fromEntries(args.map((a, i) => [`ARG${i}`, this.expr(a)]));
              if (!fn.returns) return ok({ type: 'procedures_callnoreturn', fields: { NAME: c.name }, inputs });
            }
          }
        }
        return [this.rawStmt(n, 'This statement')];
      }
      case 'IfStatement': {
        const spec: BlockSpec = { type: 'controls_if', inputs: {}, statements: {} };
        let cur: N | null = n;
        let i = 0;
        while (cur && cur.type === 'IfStatement') {
          spec.inputs![`IF${i}`] = this.expr(cur.test);
          spec.statements![`DO${i}`] = this.block(cur.consequent);
          cur = cur.alternate;
          i++;
        }
        if (cur) spec.statements!.ELSE = this.block(cur);
        return ok(spec);
      }
      case 'WhileStatement':
        return ok({ type: 'controls_whileUntil', fields: { MODE: 'WHILE' }, inputs: { BOOL: this.expr(n.test) }, statements: { DO: this.block(n.body) } });
      case 'ForStatement': {
        const loop = this.countingLoop(n);
        return loop ? [loop] : [this.rawStmt(n, 'This for loop')];
      }
      case 'ForOfStatement': {
        const left = n.left as N;
        const name = left.type === 'VariableDeclaration' && left.declarations[0].id.type === 'Identifier' ? left.declarations[0].id.name : left.type === 'Identifier' ? left.name : undefined;
        if (!name || n.await) return [this.rawStmt(n, 'This loop')];
        return ok({ type: 'controls_forEach', fields: { VAR: name }, inputs: { LIST: this.expr(n.right) }, statements: { DO: this.block(n.body) } });
      }
      case 'BreakStatement':
      case 'ContinueStatement':
        if (n.label) return [this.rawStmt(n, 'A labelled jump')];
        return ok({ type: 'controls_flow_statements', fields: { FLOW: n.type === 'BreakStatement' ? 'BREAK' : 'CONTINUE' } });
      case 'ReturnStatement':
        return ok({ type: 'bf_return', inputs: n.argument ? { VALUE: this.expr(n.argument) } : {} });
      case 'ThrowStatement': {
        const a = n.argument as N;
        const msg = a.type === 'NewExpression' && a.callee.name === 'Error' && a.arguments.length === 1 ? a.arguments[0] : undefined;
        return msg ? ok({ type: 'bf_throw', inputs: { MESSAGE: this.expr(msg) } }) : [this.rawStmt(n, 'This throw')];
      }
      case 'BlockStatement':
        return this.block(n);
      default:
        return [this.rawStmt(n, `"${n.type}"`)];
    }
  }

  func(n: N): BlockSpec[] | undefined {
    if (n.async || n.generator || n.params.some((p: N) => p.type !== 'Identifier')) return undefined;
    const body = n.body.body as N[];
    const last = body[body.length - 1];
    const info = this.funcs.get(n.id.name)!;
    // A trailing "return value" maps onto the return slot of the definition block.
    const tail = last && last.type === 'ReturnStatement' && last.argument ? last : undefined;
    const stmts = (tail ? body.slice(0, -1) : body).flatMap((s) => this.stmt(s));
    this.converted++;
    return [{ type: info.returns ? 'procedures_defreturn' : 'procedures_defnoreturn', fields: { NAME: n.id.name }, params: info.params, statements: { STACK: stmts }, inputs: tail ? { RETURN: this.expr(tail.argument) } : {} }];
  }
}

export function importJavaScript(source: string): ImportResult {
  let program: N;
  try {
    program = parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowReturnOutsideFunction: false, allowAwaitOutsideFunction: true }) as N;
  } catch (err) {
    try {
      program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }) as N;
    } catch {
      return { ok: false, warnings: [], converted: 0, raw: 0, error: (err as Error).message };
    }
  }
  const im = new Importer(source);
  im.scan(program);
  const stacks: BlockSpec[][] = [];
  const main: BlockSpec[] = [{ type: 'bf_start' }];
  for (const s of program.body as N[]) {
    if (s.type === 'FunctionDeclaration' && s.id) {
      const def = im.func(s);
      if (def) stacks.push(def);
      else {
        main.push({ type: 'bf_raw_stmt', fields: { LANG: 'javascript', CODE: source.slice(s.start, s.end) } });
        im.raw++;
        im.warnings.push({ line: s.loc?.start.line ?? 0, message: `The function "${s.id.name}" uses features outside the block subset and is kept as raw JavaScript.` });
      }
    } else main.push(...im.stmt(s));
  }
  stacks.push(main);
  return { ok: true, state: specsToWorkspace(stacks), warnings: im.warnings, converted: im.converted, raw: im.raw };
}
