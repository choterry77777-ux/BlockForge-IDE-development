import type { Domain, LanguageId } from '../types';
import { ASM_BLOCKS } from './defs-asm';
import { IMPERATIVE_BLOCKS } from './defs-imperative';
import { SQL_BLOCKS } from './defs-sql';
import { WEB_BLOCKS } from './defs-web';
import type { Arg, BlockDef } from './schema';

export interface FieldMeta {
  kind: 'text' | 'num' | 'drop' | 'check' | 'var';
  options?: string[];
  min?: number;
  max?: number;
  int?: boolean;
}

export interface BlockMeta {
  type: string;
  domain: Domain | 'any';
  category: string;
  fields: Record<string, FieldMeta>;
  values: Record<string, { check?: string[] }>;
  stmts: Record<string, { check?: string }>;
  /** undefined: not a value block. null: any type. */
  output?: string[] | null;
  /** Statement check of the previous connection; undefined when there is none. */
  prev?: string;
  /** false when nothing can follow. */
  next?: string | false;
  /** Inputs that grow with the block's extra state. */
  dynamic?: 'items' | 'if' | 'procDef' | 'procCall';
  feature?: string;
  langs?: LanguageId[];
  /** English one-line description used in the AI block catalogue. */
  summary: string;
  standard: boolean;
}

export const CUSTOM_BLOCK_DEFS: BlockDef[] = [...IMPERATIVE_BLOCKS, ...WEB_BLOCKS, ...SQL_BLOCKS, ...ASM_BLOCKS];

function fieldMeta(a: Arg): FieldMeta | undefined {
  switch (a.k) {
    case 'text':
      return { kind: 'text' };
    case 'num':
      return { kind: 'num', min: a.min, max: a.max, int: a.int };
    case 'drop':
      return { kind: 'drop', options: a.options.map((o) => o[1]) };
    case 'check':
      return { kind: 'check' };
    case 'var':
      return { kind: 'var' };
    default:
      return undefined;
  }
}

function metaFromDef(def: BlockDef): BlockMeta {
  const meta: BlockMeta = {
    type: def.type,
    domain: def.domain,
    category: def.category,
    fields: {},
    values: {},
    stmts: {},
    output: def.output,
    prev: def.prev,
    next: def.prev !== undefined ? (def.next ?? def.prev) : (def.next ?? false),
    feature: def.feature,
    langs: def.langs,
    summary: def.rows.map((r) => r[0]).join(' / '),
    standard: false,
  };
  for (const row of def.rows) {
    for (const a of row.slice(1) as Arg[]) {
      if (a.k === 'value') meta.values[a.name] = { check: a.check };
      else if (a.k === 'stmt') meta.stmts[a.name] = { check: a.check };
      else meta.fields[a.name] = fieldMeta(a)!;
    }
  }
  return meta;
}

type Std = Partial<Omit<BlockMeta, 'type' | 'summary' | 'standard'>> & { summary: string };
const N = ['Number'];
const B = ['Boolean'];
const STR = ['String'];
const drop = (...options: string[]): FieldMeta => ({ kind: 'drop', options });
const stmt = (extra: Std): Std => ({ prev: 'Stmt', next: 'Stmt', ...extra });

/** Metadata for the Blockly built-in blocks BlockForge uses. */
const STANDARD: Record<string, Std> = {
  logic_boolean: { category: 'logic', fields: { BOOL: drop('TRUE', 'FALSE') }, output: B, summary: 'true / false literal' },
  logic_compare: { category: 'logic', fields: { OP: drop('EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE') }, values: { A: {}, B: {} }, output: B, summary: 'A OP B comparison' },
  logic_operation: { category: 'logic', fields: { OP: drop('AND', 'OR') }, values: { A: { check: B }, B: { check: B } }, output: B, summary: 'A and/or B' },
  logic_negate: { category: 'logic', values: { BOOL: { check: B } }, output: B, summary: 'not BOOL' },
  logic_null: { category: 'logic', output: null, summary: 'null value' },
  logic_ternary: { category: 'logic', values: { IF: { check: B }, THEN: {}, ELSE: {} }, output: null, summary: 'IF ? THEN : ELSE' },
  controls_if: stmt({ category: 'logic', dynamic: 'if', summary: 'if / else if / else. Inputs IF0, DO0, IF1, DO1, ..., ELSE' }),
  controls_repeat_ext: stmt({ category: 'loops', values: { TIMES: { check: N } }, stmts: { DO: { check: 'Stmt' } }, summary: 'repeat TIMES times: DO' }),
  controls_whileUntil: stmt({ category: 'loops', fields: { MODE: drop('WHILE', 'UNTIL') }, values: { BOOL: { check: B } }, stmts: { DO: { check: 'Stmt' } }, summary: 'while/until BOOL: DO' }),
  controls_for: stmt({ category: 'loops', fields: { VAR: { kind: 'var' } }, values: { FROM: { check: N }, TO: { check: N }, BY: { check: N } }, stmts: { DO: { check: 'Stmt' } }, summary: 'count VAR from FROM to TO (inclusive) by BY: DO' }),
  controls_forEach: stmt({ category: 'loops', fields: { VAR: { kind: 'var' } }, values: { LIST: { check: ['Array'] } }, stmts: { DO: { check: 'Stmt' } }, summary: 'for each item VAR in LIST: DO' }),
  controls_flow_statements: { category: 'loops', fields: { FLOW: drop('BREAK', 'CONTINUE') }, prev: 'Stmt', next: false, summary: 'break / continue' },
  math_number: { category: 'math', fields: { NUM: { kind: 'num' } }, output: N, summary: 'number literal' },
  math_arithmetic: { category: 'math', fields: { OP: drop('ADD', 'MINUS', 'MULTIPLY', 'DIVIDE', 'POWER') }, values: { A: { check: N }, B: { check: N } }, output: N, summary: 'A OP B arithmetic' },
  math_single: { category: 'math', fields: { OP: drop('ROOT', 'ABS', 'NEG', 'LN', 'LOG10', 'EXP', 'POW10') }, values: { NUM: { check: N } }, output: N, summary: 'sqrt / abs / negate / ln / log10 / exp / 10^' },
  math_round: { category: 'math', fields: { OP: drop('ROUND', 'ROUNDUP', 'ROUNDDOWN') }, values: { NUM: { check: N } }, output: N, summary: 'round / round up / round down' },
  math_modulo: { category: 'math', values: { DIVIDEND: { check: N }, DIVISOR: { check: N } }, output: N, summary: 'remainder of DIVIDEND / DIVISOR' },
  math_random_int: { category: 'math', values: { FROM: { check: N }, TO: { check: N } }, output: N, summary: 'random integer from FROM to TO' },
  math_change: stmt({ category: 'variables', fields: { VAR: { kind: 'var' } }, values: { DELTA: { check: N } }, summary: 'change VAR by DELTA' }),
  text: { category: 'text', fields: { TEXT: { kind: 'text' } }, output: STR, summary: 'text literal' },
  text_join: { category: 'text', dynamic: 'items', output: STR, summary: 'join values into text. Inputs ADD0, ADD1, ...' },
  text_length: { category: 'text', values: { VALUE: { check: ['String', 'Array'] } }, output: N, summary: 'length of text' },
  text_print: stmt({ category: 'io', values: { TEXT: {} }, summary: 'print TEXT followed by a newline' }),
  text_prompt_ext: { category: 'io', fields: { TYPE: drop('TEXT', 'NUMBER') }, values: { TEXT: { check: STR } }, output: ['String', 'Number'], summary: 'ask the user for text or a number with prompt TEXT' },
  lists_create_with: { category: 'lists', dynamic: 'items', output: ['Array'], summary: 'create a list. Inputs ADD0, ADD1, ...' },
  lists_length: { category: 'lists', values: { VALUE: { check: ['String', 'Array'] } }, output: N, summary: 'length of list' },
  variables_get: { category: 'variables', fields: { VAR: { kind: 'var' } }, output: null, summary: 'value of variable VAR' },
  variables_set: stmt({ category: 'variables', fields: { VAR: { kind: 'var' } }, values: { VALUE: {} }, summary: 'set variable VAR to VALUE' }),
  procedures_defnoreturn: { category: 'functions', dynamic: 'procDef', fields: { NAME: { kind: 'text' } }, stmts: { STACK: { check: 'Stmt' } }, next: false, summary: 'define function NAME (params) with body STACK' },
  procedures_defreturn: { category: 'functions', dynamic: 'procDef', fields: { NAME: { kind: 'text' } }, stmts: { STACK: { check: 'Stmt' } }, values: { RETURN: {} }, next: false, summary: 'define function NAME (params) with body STACK returning RETURN' },
  procedures_callnoreturn: stmt({ category: 'functions', dynamic: 'procCall', summary: 'call function. Inputs ARG0, ARG1, ...' }),
  procedures_callreturn: { category: 'functions', dynamic: 'procCall', output: null, summary: 'call function and use its result. Inputs ARG0, ARG1, ...' },
  procedures_ifreturn: stmt({ category: 'functions', values: { CONDITION: { check: B }, VALUE: {} }, summary: 'if CONDITION then return VALUE' }),
};

function buildRegistry(): Record<string, BlockMeta> {
  const reg: Record<string, BlockMeta> = {};
  for (const [type, s] of Object.entries(STANDARD)) {
    reg[type] = {
      type,
      domain: 'any',
      category: s.category ?? 'misc',
      fields: s.fields ?? {},
      values: s.values ?? {},
      stmts: s.stmts ?? {},
      output: s.output,
      prev: s.prev,
      next: s.next ?? false,
      dynamic: s.dynamic,
      summary: s.summary,
      standard: true,
    };
  }
  for (const def of CUSTOM_BLOCK_DEFS) reg[def.type] = metaFromDef(def);
  return reg;
}

export const BLOCKS: Record<string, BlockMeta> = buildRegistry();

/** Built-in statement blocks whose connections are narrowed to the 'Stmt' check. */
export const STANDARD_STATEMENT_TYPES = Object.entries(STANDARD)
  .filter(([, s]) => s.prev === 'Stmt')
  .map(([t]) => t);

export const STANDARD_TYPES = Object.keys(STANDARD);

/** Standard value blocks reused as literals/operators inside SQL expressions. */
export const SQL_SHARED_TYPES = ['math_number', 'text', 'logic_boolean', 'logic_null', 'lists_create_with', 'logic_compare', 'logic_operation', 'logic_negate', 'math_arithmetic'];

export function blockAllowedInDomain(type: string, domain: Domain): boolean {
  const meta = BLOCKS[type];
  if (!meta) return false;
  if (meta.domain === domain) return true;
  if (meta.domain === 'any') {
    if (domain === 'imperative' || domain === 'web') return true;
    if (domain === 'sql') return SQL_SHARED_TYPES.includes(type);
    return false;
  }
  // Imperative blocks are valid inside the script slot of an HTML document.
  return domain === 'web' && meta.domain === 'imperative';
}

/** Blockly connection type check: an empty side accepts anything. */
export function checksCompatible(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return true;
  return a.some((x) => b.includes(x));
}

export function inputKind(meta: BlockMeta, name: string): 'value' | 'stmt' | undefined {
  if (meta.values[name]) return 'value';
  if (meta.stmts[name]) return 'stmt';
  if (meta.dynamic === 'items' && /^ADD\d+$/.test(name)) return 'value';
  if (meta.dynamic === 'if') {
    if (/^IF\d+$/.test(name)) return 'value';
    if (/^DO\d+$/.test(name) || name === 'ELSE') return 'stmt';
  }
  if (meta.dynamic === 'procCall' && /^ARG\d+$/.test(name)) return 'value';
  return undefined;
}

export function inputCheck(meta: BlockMeta, name: string): string[] | undefined {
  if (meta.values[name]) return meta.values[name].check;
  if (meta.stmts[name]) return meta.stmts[name].check ? [meta.stmts[name].check!] : undefined;
  if (meta.dynamic === 'if') {
    if (/^IF\d+$/.test(name)) return ['Boolean'];
    return ['Stmt'];
  }
  return undefined;
}
