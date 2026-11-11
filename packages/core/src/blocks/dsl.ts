/** Small builder DSL for block specs. Used by templates, examples and tests. */
import { type BlockSpec, specsToWorkspace, type WorkspaceState } from './state';

type Arith = 'ADD' | 'MINUS' | 'MULTIPLY' | 'DIVIDE' | 'POWER';
type Cmp = 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE';

export const num = (n: number): BlockSpec => ({ type: 'math_number', fields: { NUM: n } });
export const text = (s: string): BlockSpec => ({ type: 'text', fields: { TEXT: s } });
export const bool = (v: boolean): BlockSpec => ({ type: 'logic_boolean', fields: { BOOL: v ? 'TRUE' : 'FALSE' } });
export const nil = (): BlockSpec => ({ type: 'logic_null' });
export const getv = (name: string): BlockSpec => ({ type: 'variables_get', fields: { VAR: name } });
export const setv = (name: string, value: BlockSpec): BlockSpec => ({ type: 'variables_set', fields: { VAR: name }, inputs: { VALUE: value } });
export const change = (name: string, delta: BlockSpec): BlockSpec => ({ type: 'math_change', fields: { VAR: name }, inputs: { DELTA: delta } });
export const declare = (name: string, type: string, value: BlockSpec, isConst = false): BlockSpec => ({ type: 'bf_var_declare', fields: { VAR: name, TYPE: type, CONST: isConst }, inputs: { VALUE: value } });
export const print = (value: BlockSpec): BlockSpec => ({ type: 'text_print', inputs: { TEXT: value } });
export const ask = (prompt: string, numeric = false): BlockSpec => ({ type: 'text_prompt_ext', fields: { TYPE: numeric ? 'NUMBER' : 'TEXT' }, inputs: { TEXT: text(prompt) } });
export const arith = (op: Arith, a: BlockSpec, b: BlockSpec): BlockSpec => ({ type: 'math_arithmetic', fields: { OP: op }, inputs: { A: a, B: b } });
export const add = (a: BlockSpec, b: BlockSpec) => arith('ADD', a, b);
export const sub = (a: BlockSpec, b: BlockSpec) => arith('MINUS', a, b);
export const mul = (a: BlockSpec, b: BlockSpec) => arith('MULTIPLY', a, b);
export const div = (a: BlockSpec, b: BlockSpec) => arith('DIVIDE', a, b);
export const pow = (a: BlockSpec, b: BlockSpec) => arith('POWER', a, b);
export const mod = (a: BlockSpec, b: BlockSpec): BlockSpec => ({ type: 'math_modulo', inputs: { DIVIDEND: a, DIVISOR: b } });
export const neg = (a: BlockSpec): BlockSpec => ({ type: 'math_single', fields: { OP: 'NEG' }, inputs: { NUM: a } });
export const mathFn = (op: 'ROOT' | 'ABS' | 'LN' | 'LOG10' | 'EXP' | 'POW10', a: BlockSpec): BlockSpec => ({ type: 'math_single', fields: { OP: op }, inputs: { NUM: a } });
export const round = (op: 'ROUND' | 'ROUNDUP' | 'ROUNDDOWN', a: BlockSpec): BlockSpec => ({ type: 'math_round', fields: { OP: op }, inputs: { NUM: a } });
export const minmax = (fn: 'min' | 'max', a: BlockSpec, b: BlockSpec): BlockSpec => ({ type: 'bf_math_minmax', fields: { FN: fn }, inputs: { A: a, B: b } });
export const cmp = (op: Cmp, a: BlockSpec, b: BlockSpec): BlockSpec => ({ type: 'logic_compare', fields: { OP: op }, inputs: { A: a, B: b } });
export const and = (a: BlockSpec, b: BlockSpec): BlockSpec => ({ type: 'logic_operation', fields: { OP: 'AND' }, inputs: { A: a, B: b } });
export const or = (a: BlockSpec, b: BlockSpec): BlockSpec => ({ type: 'logic_operation', fields: { OP: 'OR' }, inputs: { A: a, B: b } });
export const not = (a: BlockSpec): BlockSpec => ({ type: 'logic_negate', inputs: { BOOL: a } });
export const ternary = (c: BlockSpec, a: BlockSpec, b: BlockSpec): BlockSpec => ({ type: 'logic_ternary', inputs: { IF: c, THEN: a, ELSE: b } });

/** if / else-if chain. */
export const ifs = (branches: [BlockSpec, BlockSpec[]][], otherwise?: BlockSpec[]): BlockSpec => {
  const spec: BlockSpec = { type: 'controls_if', inputs: {}, statements: {} };
  branches.forEach(([c, body], i) => {
    spec.inputs![`IF${i}`] = c;
    spec.statements![`DO${i}`] = body;
  });
  if (otherwise) spec.statements!.ELSE = otherwise;
  return spec;
};
export const iff = (c: BlockSpec, then: BlockSpec[], otherwise?: BlockSpec[]) => ifs([[c, then]], otherwise);
export const repeat = (times: BlockSpec, body: BlockSpec[]): BlockSpec => ({ type: 'controls_repeat_ext', inputs: { TIMES: times }, statements: { DO: body } });
export const whileDo = (c: BlockSpec, body: BlockSpec[]): BlockSpec => ({ type: 'controls_whileUntil', fields: { MODE: 'WHILE' }, inputs: { BOOL: c }, statements: { DO: body } });
export const until = (c: BlockSpec, body: BlockSpec[]): BlockSpec => ({ type: 'controls_whileUntil', fields: { MODE: 'UNTIL' }, inputs: { BOOL: c }, statements: { DO: body } });
export const forRange = (v: string, from: BlockSpec, to: BlockSpec, by: BlockSpec, body: BlockSpec[]): BlockSpec => ({ type: 'controls_for', fields: { VAR: v }, inputs: { FROM: from, TO: to, BY: by }, statements: { DO: body } });
export const count = (v: string, from: number, to: number, body: BlockSpec[]) => forRange(v, num(from), num(to), num(1), body);
export const forEach = (v: string, list: BlockSpec, body: BlockSpec[]): BlockSpec => ({ type: 'controls_forEach', fields: { VAR: v }, inputs: { LIST: list }, statements: { DO: body } });
export const brk = (): BlockSpec => ({ type: 'controls_flow_statements', fields: { FLOW: 'BREAK' } });
export const cont = (): BlockSpec => ({ type: 'controls_flow_statements', fields: { FLOW: 'CONTINUE' } });

const items = (type: string, list: BlockSpec[]): BlockSpec => ({ type, inputs: Object.fromEntries(list.map((b, i) => [`ADD${i}`, b])) });
export const list = (...xs: BlockSpec[]) => items('lists_create_with', xs);
export const join = (...xs: BlockSpec[]) => items('text_join', xs);
export const len = (x: BlockSpec): BlockSpec => ({ type: 'lists_length', inputs: { VALUE: x } });
export const textLen = (x: BlockSpec): BlockSpec => ({ type: 'text_length', inputs: { VALUE: x } });
export const item = (l: BlockSpec, i: BlockSpec): BlockSpec => ({ type: 'bf_list_get', inputs: { LIST: l, INDEX: i } });
export const setItem = (l: BlockSpec, i: BlockSpec, v: BlockSpec): BlockSpec => ({ type: 'bf_list_set', inputs: { LIST: l, INDEX: i, VALUE: v } });
export const append = (l: BlockSpec, v: BlockSpec): BlockSpec => ({ type: 'bf_list_append', inputs: { LIST: l, VALUE: v } });
export const removeAt = (l: BlockSpec, i: BlockSpec): BlockSpec => ({ type: 'bf_list_remove', inputs: { LIST: l, INDEX: i } });
export const dict = (): BlockSpec => ({ type: 'bf_map_create' });
export const dictSet = (m: BlockSpec, k: BlockSpec, v: BlockSpec): BlockSpec => ({ type: 'bf_map_set', inputs: { MAP: m, KEY: k, VALUE: v } });
export const dictGet = (m: BlockSpec, k: BlockSpec): BlockSpec => ({ type: 'bf_map_get', inputs: { MAP: m, KEY: k } });
export const dictHas = (m: BlockSpec, k: BlockSpec): BlockSpec => ({ type: 'bf_map_has', inputs: { MAP: m, KEY: k } });
export const dictDelete = (m: BlockSpec, k: BlockSpec): BlockSpec => ({ type: 'bf_map_delete', inputs: { MAP: m, KEY: k } });
export const convert = (v: BlockSpec, to: 'int' | 'float' | 'string' | 'bool'): BlockSpec => ({ type: 'bf_convert', fields: { TO: to }, inputs: { VALUE: v } });
export const strOp = (op: 'upper' | 'lower' | 'trim', v: BlockSpec): BlockSpec => ({ type: 'bf_str_op', fields: { OP: op }, inputs: { VALUE: v } });
export const contains = (a: BlockSpec, b: BlockSpec): BlockSpec => ({ type: 'bf_str_contains', inputs: { TEXT: a, FIND: b } });
export const comment = (t: string): BlockSpec => ({ type: 'bf_comment', fields: { TEXT: t } });
export const ret = (v?: BlockSpec): BlockSpec => ({ type: 'bf_return', inputs: v ? { VALUE: v } : {} });
export const tryCatch = (body: BlockSpec[], errVar: string, handler: BlockSpec[]): BlockSpec => ({ type: 'bf_try', fields: { ERR: errVar }, statements: { TRY: body, CATCH: handler } });
export const raise = (msg: BlockSpec): BlockSpec => ({ type: 'bf_throw', inputs: { MESSAGE: msg } });

/** Function definition as a top-level stack. */
export const fnDef = (name: string, params: string[], body: BlockSpec[], result?: BlockSpec): BlockSpec[] => [
  { type: result ? 'procedures_defreturn' : 'procedures_defnoreturn', fields: { NAME: name }, params, statements: { STACK: body }, inputs: result ? { RETURN: result } : {} },
];
const callInputs = (args: BlockSpec[]) => Object.fromEntries(args.map((a, i) => [`ARG${i}`, a]));
export const call = (name: string, ...args: BlockSpec[]): BlockSpec => ({ type: 'procedures_callreturn', fields: { NAME: name }, inputs: callInputs(args) });
export const callStmt = (name: string, ...args: BlockSpec[]): BlockSpec => ({ type: 'procedures_callnoreturn', fields: { NAME: name }, inputs: callInputs(args) });

export const structDef = (name: string, fields: [string, string][]): BlockSpec[] => [
  { type: 'bf_struct_def', fields: { NAME: name }, statements: { MEMBERS: fields.map(([n, t]) => ({ type: 'bf_class_field', fields: { NAME: n, TYPE: t } })) } },
];
export const method = (name: string, params: string, retType: string, body: BlockSpec[]): BlockSpec => ({ type: 'bf_class_method', fields: { NAME: name, PARAMS: params, RET: retType }, statements: { BODY: body } });
export const classDef = (name: string, fields: [string, string][], methods: BlockSpec[], impl = ''): BlockSpec[] => [
  { type: 'bf_class_def', fields: { NAME: name, IMPLEMENTS: impl }, statements: { MEMBERS: [...fields.map(([n, t]) => ({ type: 'bf_class_field', fields: { NAME: n, TYPE: t } })), ...methods] } },
];
export const interfaceDef = (name: string, methods: [string, string, string][]): BlockSpec[] => [
  { type: 'bf_interface_def', fields: { NAME: name }, statements: { MEMBERS: methods.map(([n, p, r]) => ({ type: 'bf_interface_method', fields: { NAME: n, PARAMS: p, RET: r } })) } },
];
export const create = (cls: string, ...args: BlockSpec[]): BlockSpec => ({ type: 'bf_new', fields: { CLASS: cls }, inputs: { ARGS: list(...args) } });
export const self = (): BlockSpec => ({ type: 'bf_this' });
export const field = (obj: BlockSpec, name: string): BlockSpec => ({ type: 'bf_field_get', fields: { FIELD: name }, inputs: { OBJ: obj } });
export const setField = (obj: BlockSpec, name: string, v: BlockSpec): BlockSpec => ({ type: 'bf_field_set', fields: { FIELD: name }, inputs: { OBJ: obj, VALUE: v } });
export const callMethod = (obj: BlockSpec, name: string, ...args: BlockSpec[]): BlockSpec => ({ type: 'bf_method_call', fields: { METHOD: name }, inputs: { OBJ: obj, ARGS: list(...args) } });
export const callMethodStmt = (obj: BlockSpec, name: string, ...args: BlockSpec[]): BlockSpec => ({ type: 'bf_method_call_stmt', fields: { METHOD: name }, inputs: { OBJ: obj, ARGS: list(...args) } });

/** The main stack: a start block followed by statements. */
export const start = (...stmts: BlockSpec[]): BlockSpec[] => [{ type: 'bf_start' }, ...stmts];
export const workspace = (...stacks: BlockSpec[][]): WorkspaceState => {
  let n = 0;
  return specsToWorkspace(stacks, () => `b${++n}`);
};
export const ifReturn = (c: BlockSpec, value?: BlockSpec): BlockSpec => ({ type: 'procedures_ifreturn', inputs: value ? { CONDITION: c, VALUE: value } : { CONDITION: c } });
