import { BLOCKS } from '../blocks/registry';
import type { BlockState, WorkspaceState } from '../blocks/state';
import type { Diagnostic } from '../types';
import { Reader } from './reader';
import { type ClassDecl, type Expr, type FieldDecl, type FuncDecl, type ImperativeProgram, type InterfaceDecl, type Param, type Stmt, T, type TypeRef } from './types';

const COMPARE: Record<string, '==' | '!=' | '<' | '<=' | '>' | '>='> = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
const ARITH: Record<string, '+' | '-' | '*' | '/' | '**'> = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/', POWER: '**' };

export function typeFromName(name: string): TypeRef {
  switch (name.trim().toLowerCase()) {
    case 'int':
    case 'integer':
      return T.int;
    case 'float':
    case 'double':
    case 'decimal':
    case 'number':
      return T.float;
    case 'string':
    case 'text':
    case 'str':
      return T.string;
    case 'bool':
    case 'boolean':
      return T.bool;
    case 'void':
    case 'nothing':
      return T.void;
    default:
      return name.trim() ? T.struct(name.trim()) : T.int;
  }
}

/** Parse "a:int, b:string" into typed parameters. Missing types default to int. */
export function parseParams(text: string): Param[] {
  return text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [name, type] = p.split(':').map((s) => s.trim());
      return { name, type: type ? typeFromName(type) : T.int };
    });
}

/** Converts imperative blocks into IR. Also used for the script slot of HTML documents. */
export class ImperativeConverter {
  constructor(readonly r: Reader) {}

  // ----- expressions -----

  expr(parent: BlockState, input: string, optional = false): Expr {
    const b = this.r.value(parent, input);
    if (!b) {
      if (!optional) {
        this.r.report('error', 'blocks.emptyInput', `An input of this block is empty (${input}).`, parent.id, { input });
      }
      return { k: 'missing', id: parent.id };
    }
    return this.exprOf(b);
  }

  /** Arguments passed through a list block (used by "new", method calls and function values). */
  private argList(parent: BlockState, input: string): Expr[] {
    const b = this.r.value(parent, input);
    if (!b) return [];
    if (b.type !== 'lists_create_with') {
      this.r.report('error', 'blocks.argsNeedList', 'Arguments must be given with a "create list" block.', parent.id);
      return [];
    }
    return this.items(b);
  }

  private items(b: BlockState): Expr[] {
    const count = Number(b.extraState?.itemCount ?? Object.keys(b.inputs ?? {}).length);
    const out: Expr[] = [];
    for (let i = 0; i < count; i++) {
      const child = this.r.value(b, `ADD${i}`);
      if (child) out.push(this.exprOf(child));
    }
    return out;
  }

  exprOf(b: BlockState): Expr {
    const r = this.r;
    const id = b.id;
    const e = (name: string, optional = false) => this.expr(b, name, optional);
    switch (b.type) {
      case 'math_number': {
        const value = r.num(b, 'NUM');
        return { k: 'num', id, value, isInt: Number.isInteger(value) };
      }
      case 'text':
        return { k: 'str', id, value: r.str(b, 'TEXT') };
      case 'logic_boolean':
        return { k: 'bool', id, value: r.str(b, 'BOOL') === 'TRUE' };
      case 'logic_null':
        return { k: 'null', id };
      case 'variables_get':
        return { k: 'var', id, name: r.varName(b, 'VAR') };
      case 'logic_compare':
        return { k: 'bin', id, op: COMPARE[r.str(b, 'OP')] ?? '==', l: e('A'), r: e('B') };
      case 'logic_operation':
        return { k: 'bin', id, op: r.str(b, 'OP') === 'OR' ? '||' : '&&', l: e('A'), r: e('B') };
      case 'logic_negate':
        return { k: 'un', id, op: 'not', e: e('BOOL') };
      case 'logic_ternary':
        return { k: 'ternary', id, cond: e('IF'), a: e('THEN'), b: e('ELSE') };
      case 'math_arithmetic':
        return { k: 'bin', id, op: ARITH[r.str(b, 'OP')] ?? '+', l: e('A'), r: e('B') };
      case 'math_modulo':
        return { k: 'bin', id, op: '%', l: e('DIVIDEND'), r: e('DIVISOR') };
      case 'math_single': {
        const op = r.str(b, 'OP');
        if (op === 'NEG') return { k: 'un', id, op: 'neg', e: e('NUM') };
        const fn = ({ ROOT: 'sqrt', ABS: 'abs', LN: 'ln', LOG10: 'log10', EXP: 'exp', POW10: 'pow10' } as const)[op] ?? 'abs';
        return { k: 'math', id, fn, args: [e('NUM')] };
      }
      case 'math_round': {
        const fn = ({ ROUND: 'round', ROUNDUP: 'ceil', ROUNDDOWN: 'floor' } as const)[r.str(b, 'OP')] ?? 'round';
        return { k: 'math', id, fn, args: [e('NUM')] };
      }
      case 'bf_math_fn':
        return { k: 'math', id, fn: r.str(b, 'FN') as 'floor', args: [e('NUM')] };
      case 'bf_math_minmax':
        return { k: 'math', id, fn: r.str(b, 'FN') === 'max' ? 'max' : 'min', args: [e('A'), e('B')] };
      case 'math_random_int':
        return { k: 'random', id, from: e('FROM'), to: e('TO') };
      case 'text_join': {
        const parts = this.items(b);
        return parts.length ? { k: 'concat', id, parts } : { k: 'str', id, value: '' };
      }
      case 'text_length':
      case 'lists_length':
        return { k: 'len', id, target: e('VALUE') };
      case 'text_prompt_ext':
        return { k: 'input', id, prompt: e('TEXT', true), numeric: r.str(b, 'TYPE') === 'NUMBER' };
      case 'lists_create_with':
        return { k: 'list', id, items: this.items(b) };
      case 'procedures_callreturn':
        return { k: 'call', id, name: String(b.extraState?.name ?? ''), args: this.callArgs(b) };
      case 'bf_convert':
        return { k: 'convert', id, to: r.str(b, 'TO', 'string') as 'int', e: e('VALUE') };
      case 'bf_str_op':
        return { k: 'strOp', id, op: r.str(b, 'OP', 'upper') as 'upper', args: [e('VALUE')] };
      case 'bf_str_contains':
        return { k: 'strOp', id, op: 'contains', args: [e('TEXT'), e('FIND')] };
      case 'bf_list_get':
        return { k: 'index', id, target: e('LIST'), index: e('INDEX') };
      case 'bf_map_create':
        return { k: 'map', id, entries: [] };
      case 'bf_map_get':
        return { k: 'mapGet', id, target: e('MAP'), key: e('KEY') };
      case 'bf_map_has':
        return { k: 'mapHas', id, target: e('MAP'), key: e('KEY') };
      case 'bf_file_read':
        return { k: 'fileRead', id, path: e('PATH') };
      case 'bf_file_exists':
        return { k: 'fileExists', id, path: e('PATH') };
      case 'bf_new':
        return { k: 'new', id, name: r.str(b, 'CLASS').trim(), args: this.argList(b, 'ARGS') };
      case 'bf_this':
        return { k: 'this', id };
      case 'bf_field_get':
        return { k: 'field', id, target: e('OBJ'), name: r.str(b, 'FIELD').trim() };
      case 'bf_method_call':
        return { k: 'method', id, target: e('OBJ'), name: r.str(b, 'METHOD').trim(), args: this.argList(b, 'ARGS') };
      case 'bf_await':
        return { k: 'await', id, e: e('VALUE') };
      case 'bf_func_ref':
        return { k: 'funcRef', id, name: r.str(b, 'NAME').trim() };
      case 'bf_call_ref':
        return { k: 'callRef', id, fn: e('FN'), args: this.argList(b, 'ARGS') };
      case 'bf_http_get':
        return { k: 'httpGet', id, url: e('URL') };
      case 'bf_json_stringify':
        return { k: 'jsonStringify', id, e: e('VALUE') };
      case 'bf_json_parse':
        return { k: 'jsonParse', id, e: e('TEXT') };
      case 'bf_shell_output':
        return { k: 'shell', id, cmd: e('CMD') };
      case 'bf_addr_of':
        return { k: 'addrOf', id, name: r.varName(b, 'VAR') };
      case 'bf_deref':
        return { k: 'deref', id, e: e('PTR') };
      case 'bf_alloc':
        return { k: 'alloc', id, elem: r.str(b, 'TYPE') === 'float' ? T.float : T.int, count: e('COUNT') };
      case 'bf_dom_get':
        return { k: 'domGet', id, target: { k: 'str', value: r.str(b, 'ID') }, what: r.str(b, 'WHAT') === 'text' ? 'text' : 'value' };
      case 'bf_raw_expr':
        return { k: 'raw', id, code: r.str(b, 'CODE'), lang: r.str(b, 'LANG') };
      default:
        if (!BLOCKS[b.type]) r.report('error', 'blocks.unknownType', `Unknown block type "${b.type}".`, id, { type: b.type });
        else if (BLOCKS[b.type].output === undefined) r.report('error', 'blocks.notAValue', 'This block does not produce a value.', id);
        else r.report('error', 'blocks.wrongDomain', `The block "${b.type}" cannot be used in this kind of program.`, id, { type: b.type });
        return { k: 'missing', id };
    }
  }

  private callArgs(b: BlockState): Expr[] {
    const params = (b.extraState?.params as unknown[]) ?? [];
    return params.map((_, i) => this.expr(b, `ARG${i}`));
  }

  // ----- statements -----

  stmts(blocks: BlockState[]): Stmt[] {
    const out: Stmt[] = [];
    for (const b of blocks) {
      const s = this.stmt(b);
      if (s) out.push(s);
    }
    return out;
  }

  stmt(b: BlockState): Stmt | undefined {
    const r = this.r;
    const id = b.id;
    const e = (name: string, optional = false) => this.expr(b, name, optional);
    const body = (name: string) => this.stmts(r.stack(b, name));
    switch (b.type) {
      case 'variables_set':
        return { k: 'assign', id, name: r.varName(b, 'VAR'), value: e('VALUE') };
      case 'math_change': {
        const name = r.varName(b, 'VAR');
        return { k: 'assign', id, name, value: { k: 'bin', id, op: '+', l: { k: 'var', name }, r: e('DELTA') } };
      }
      case 'bf_var_declare': {
        const type = r.str(b, 'TYPE', 'auto');
        return { k: 'varDecl', id, name: r.varName(b, 'VAR'), declType: type === 'auto' ? undefined : typeFromName(type), init: e('VALUE'), isConst: r.bool(b, 'CONST') };
      }
      case 'text_print':
        return { k: 'print', id, value: e('TEXT') };
      case 'controls_if': {
        const count = Number(b.extraState?.elseIfCount ?? 0) + 1;
        const branches = [];
        for (let i = 0; i < count; i++) branches.push({ cond: e(`IF${i}`), body: body(`DO${i}`) });
        const hasElse = !!b.extraState?.hasElse || !!b.inputs?.ELSE;
        return { k: 'if', id, branches, else: hasElse ? body('ELSE') : undefined };
      }
      case 'controls_repeat_ext':
        return { k: 'repeat', id, count: e('TIMES'), body: body('DO') };
      case 'controls_whileUntil': {
        const cond = e('BOOL');
        return { k: 'while', id, cond: r.str(b, 'MODE') === 'UNTIL' ? { k: 'un', op: 'not', e: cond } : cond, body: body('DO') };
      }
      case 'controls_for': {
        const step = r.value(b, 'BY') ? e('BY') : ({ k: 'num', value: 1, isInt: true } as Expr);
        return { k: 'forRange', id, var: r.varName(b, 'VAR'), from: e('FROM'), to: e('TO'), step, body: body('DO') };
      }
      case 'controls_forEach':
        return { k: 'forEach', id, var: r.varName(b, 'VAR'), iterable: e('LIST'), body: body('DO') };
      case 'controls_flow_statements':
        return r.str(b, 'FLOW') === 'CONTINUE' ? { k: 'continue', id } : { k: 'break', id };
      case 'procedures_callnoreturn':
        return { k: 'exprStmt', id, e: { k: 'call', id, name: String(b.extraState?.name ?? ''), args: this.callArgs(b) } };
      case 'procedures_ifreturn': {
        const value = r.value(b, 'VALUE') ? e('VALUE') : undefined;
        return { k: 'if', id, branches: [{ cond: e('CONDITION'), body: [{ k: 'return', id, value }] }] };
      }
      case 'bf_return':
        return { k: 'return', id, value: r.value(b, 'VALUE') ? e('VALUE') : undefined };
      case 'bf_comment':
        return { k: 'comment', id, text: r.str(b, 'TEXT') };
      case 'bf_raw_stmt':
        return { k: 'rawStmt', id, code: r.str(b, 'CODE'), lang: r.str(b, 'LANG') };
      case 'bf_list_set':
        return { k: 'listSet', id, list: e('LIST'), index: e('INDEX'), value: e('VALUE') };
      case 'bf_list_append':
        return { k: 'listAppend', id, list: e('LIST'), value: e('VALUE') };
      case 'bf_list_remove':
        return { k: 'listRemove', id, list: e('LIST'), index: e('INDEX') };
      case 'bf_map_set':
        return { k: 'mapSet', id, map: e('MAP'), key: e('KEY'), value: e('VALUE') };
      case 'bf_map_delete':
        return { k: 'mapDelete', id, map: e('MAP'), key: e('KEY') };
      case 'bf_try':
        return { k: 'try', id, body: body('TRY'), errVar: r.varName(b, 'ERR'), handler: body('CATCH') };
      case 'bf_throw':
        return { k: 'throw', id, message: e('MESSAGE') };
      case 'bf_file_write':
        return { k: 'fileWrite', id, path: e('PATH'), content: e('CONTENT'), append: r.str(b, 'MODE') === 'append' };
      case 'bf_import':
        return { k: 'import', id, module: r.str(b, 'MODULE').trim() };
      case 'bf_field_set':
        return { k: 'fieldSet', id, target: e('OBJ'), name: r.str(b, 'FIELD').trim(), value: e('VALUE') };
      case 'bf_method_call_stmt':
        return { k: 'exprStmt', id, e: { k: 'method', id, target: e('OBJ'), name: r.str(b, 'METHOD').trim(), args: this.argList(b, 'ARGS') } };
      case 'bf_call_ref_stmt':
        return { k: 'exprStmt', id, e: { k: 'callRef', id, fn: e('FN'), args: this.argList(b, 'ARGS') } };
      case 'bf_sleep':
        return { k: 'sleep', id, ms: e('MS') };
      case 'bf_shell_run':
        return { k: 'shellRun', id, cmd: e('CMD') };
      case 'bf_deref_set':
        return { k: 'derefSet', id, ptr: e('PTR'), value: e('VALUE') };
      case 'bf_free':
        return { k: 'free', id, name: r.varName(b, 'VAR') };
      case 'bf_dom_set':
        return { k: 'domSet', id, target: { k: 'str', value: r.str(b, 'ID') }, what: r.str(b, 'WHAT', 'text') as 'text', value: e('VALUE') };
      case 'bf_dom_style':
        return { k: 'domSet', id, target: { k: 'str', value: r.str(b, 'ID') }, what: 'style', prop: r.str(b, 'PROP'), value: e('VALUE') };
      case 'bf_dom_on':
        return { k: 'domOn', id, target: { k: 'str', value: r.str(b, 'ID') }, event: r.str(b, 'EVENT', 'click'), body: body('DO') };
      default:
        if (!BLOCKS[b.type]) r.report('error', 'blocks.unknownType', `Unknown block type "${b.type}".`, id, { type: b.type });
        else r.report('error', 'blocks.wrongDomain', `The block "${b.type}" cannot be used in this kind of program.`, id, { type: b.type });
        return undefined;
    }
  }

  // ----- declarations -----

  func(b: BlockState): FuncDecl {
    const params = ((b.extraState?.params as { name: string }[]) ?? []).map((p) => ({ name: p.name, type: T.unknown }));
    const body = this.stmts(this.r.stack(b, 'STACK'));
    if (b.type === 'procedures_defreturn' && this.r.value(b, 'RETURN')) {
      const last = body[body.length - 1];
      if (last && (last.k === 'return' || last.k === 'throw')) {
        this.r.report('warning', 'blocks.unreachableReturn', 'The return value slot is never reached because the function body already ends with a return.', b.id);
      } else body.push({ k: 'return', id: b.id, value: this.expr(b, 'RETURN') });
    }
    return { k: 'func', id: b.id, name: this.r.str(b, 'NAME', 'function').trim(), params, ret: T.unknown, body, isAsync: false };
  }

  classDecl(b: BlockState): ClassDecl {
    const r = this.r;
    const fields: FieldDecl[] = [];
    const methods: FuncDecl[] = [];
    for (const m of r.stack(b, 'MEMBERS')) {
      if (m.type === 'bf_class_field') fields.push({ id: m.id, name: r.str(m, 'NAME').trim(), type: typeFromName(r.str(m, 'TYPE', 'int')) });
      else if (m.type === 'bf_class_method') {
        methods.push({ k: 'func', id: m.id, name: r.str(m, 'NAME').trim(), params: parseParams(r.str(m, 'PARAMS')), ret: typeFromName(r.str(m, 'RET', 'void')), body: this.stmts(r.stack(m, 'BODY')), isAsync: false, explicitTypes: true });
      }
    }
    const isStruct = b.type === 'bf_struct_def';
    if (isStruct && methods.length) r.report('warning', 'blocks.structMethods', 'Structs cannot contain methods. Use a class block instead.', b.id);
    return { k: 'class', id: b.id, name: r.str(b, 'NAME').trim(), isStruct, implements: isStruct ? undefined : r.str(b, 'IMPLEMENTS').trim() || undefined, fields, methods: isStruct ? [] : methods };
  }

  interfaceDecl(b: BlockState): InterfaceDecl {
    const r = this.r;
    return {
      k: 'interface',
      id: b.id,
      name: r.str(b, 'NAME').trim(),
      methods: r.stack(b, 'MEMBERS').filter((m) => m.type === 'bf_interface_method').map((m) => ({ id: m.id, name: r.str(m, 'NAME').trim(), params: parseParams(r.str(m, 'PARAMS')), ret: typeFromName(r.str(m, 'RET', 'void')) })),
    };
  }
}

const TOP_DECLS = new Set(['procedures_defnoreturn', 'procedures_defreturn', 'bf_class_def', 'bf_struct_def', 'bf_interface_def']);

export function imperativeFromBlocks(state: WorkspaceState): { program: ImperativeProgram; diagnostics: Diagnostic[] } {
  const r = new Reader(state);
  const c = new ImperativeConverter(r);
  const program: ImperativeProgram = { domain: 'imperative', main: [], funcs: [], classes: [], interfaces: [], hasStart: false };
  let orphans = 0;
  for (const top of r.tops()) {
    if (top.type === 'bf_start') {
      if (program.hasStart) {
        r.report('error', 'blocks.multipleStart', 'Only one "when program starts" block is allowed.', top.id);
        continue;
      }
      program.hasStart = true;
      program.startId = top.id;
      program.main = c.stmts(r.chain(top.next?.block));
    } else if (top.type === 'procedures_defnoreturn' || top.type === 'procedures_defreturn') {
      program.funcs.push(c.func(top));
    } else if (top.type === 'bf_class_def' || top.type === 'bf_struct_def') {
      program.classes.push(c.classDecl(top));
    } else if (top.type === 'bf_interface_def') {
      program.interfaces.push(c.interfaceDecl(top));
    } else if (!TOP_DECLS.has(top.type)) {
      const meta = BLOCKS[top.type];
      if (meta && meta.domain !== 'imperative' && meta.domain !== 'any') {
        r.report('error', 'blocks.wrongDomain', `The block "${top.type}" cannot be used in this kind of program.`, top.id, { type: top.type });
      } else {
        orphans++;
        r.report('warning', 'blocks.orphan', 'These blocks are not attached to "when program starts" and are ignored.', top.id);
      }
    }
  }
  if (!program.hasStart && orphans > 0) {
    r.report('warning', 'blocks.noStart', 'Add a "when program starts" block and attach your blocks below it.');
  }
  const seen = new Set<string>();
  for (const f of program.funcs) {
    if (seen.has(f.name)) r.report('error', 'blocks.duplicateFunction', `Two functions are named "${f.name}".`, f.id, { name: f.name });
    seen.add(f.name);
  }
  return { program, diagnostics: r.diags };
}
