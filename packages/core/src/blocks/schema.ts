import type { Domain, LanguageId } from '../types';

/** One argument slot inside a block row. */
export type Arg =
  | { k: 'value'; name: string; check?: string[] }
  | { k: 'stmt'; name: string; check?: string }
  | { k: 'text'; name: string; text: string }
  | { k: 'num'; name: string; value: number; min?: number; max?: number; int?: boolean }
  | { k: 'drop'; name: string; options: [string, string][] }
  | { k: 'check'; name: string; checked: boolean }
  | { k: 'var'; name: string; variable: string };

export type Row = [string, ...Arg[]];

/**
 * Declarative definition of a custom block. This is the single source of truth:
 * the Blockly JSON definition, the validation registry and the AI block
 * catalogue are all derived from it.
 */
export interface BlockDef {
  type: string;
  domain: Domain | 'any';
  category: string;
  style: string;
  rows: Row[];
  /** undefined: statement block. null: any value. array: typed value. */
  output?: string[] | null;
  /** Statement connection check; undefined means no previous connection. */
  prev?: string;
  /** false: terminal statement. Defaults to the same check as prev. */
  next?: string | false;
  hat?: boolean;
  inline?: boolean;
  tip?: string;
  /** Feature key for the language support matrix. */
  feature?: string;
  /** Restricts the block to specific target languages. */
  langs?: LanguageId[];
}

export const V = (name: string, ...check: string[]): Arg => ({ k: 'value', name, check: check.length ? check : undefined });
export const S = (name: string, check = 'Stmt'): Arg => ({ k: 'stmt', name, check });
export const Tx = (name: string, text = ''): Arg => ({ k: 'text', name, text });
export const Nu = (name: string, value = 0, opts: { min?: number; max?: number; int?: boolean } = {}): Arg => ({ k: 'num', name, value, ...opts });
export const D = (name: string, ...options: (string | [string, string])[]): Arg => ({
  k: 'drop',
  name,
  options: options.map((o) => (typeof o === 'string' ? [o, o] : o)),
});
export const C = (name: string, checked = false): Arg => ({ k: 'check', name, checked });
export const Vr = (name: string, variable = 'x'): Arg => ({ k: 'var', name, variable });

export interface BlockMessages {
  /** One message per row, with %n placeholders kept intact. */
  rows?: string[];
  /** Dropdown label overrides: field name -> option value -> label. */
  opts?: Record<string, Record<string, string>>;
  tip?: string;
}

/** Produce a Blockly JSON block definition, optionally localised. */
export function toBlocklyJson(def: BlockDef, msg?: BlockMessages): Record<string, unknown> {
  const json: Record<string, unknown> = { type: def.type, style: def.style };
  def.rows.forEach((row, i) => {
    const [text, ...args] = row;
    json[`message${i}`] = msg?.rows?.[i] ?? text;
    json[`args${i}`] = args.map((a) => argToJson(a, msg));
  });
  if (def.output !== undefined) json.output = def.output;
  if (def.prev !== undefined) json.previousStatement = def.prev;
  if (def.prev !== undefined && def.next !== false) json.nextStatement = def.next ?? def.prev;
  if (def.prev === undefined && typeof def.next === 'string') json.nextStatement = def.next;
  if (def.inline !== undefined) json.inputsInline = def.inline;
  const tip = msg?.tip ?? def.tip;
  if (tip) json.tooltip = tip;
  if (def.hat) json.hat = 'cap';
  return json;
}

function argToJson(a: Arg, msg?: BlockMessages): Record<string, unknown> {
  switch (a.k) {
    case 'value':
      return { type: 'input_value', name: a.name, ...(a.check ? { check: a.check } : {}) };
    case 'stmt':
      return { type: 'input_statement', name: a.name, ...(a.check ? { check: a.check } : {}) };
    case 'text':
      return { type: 'field_input', name: a.name, text: a.text, spellcheck: false };
    case 'num':
      return {
        type: 'field_number',
        name: a.name,
        value: a.value,
        ...(a.min !== undefined ? { min: a.min } : {}),
        ...(a.max !== undefined ? { max: a.max } : {}),
        ...(a.int ? { precision: 1 } : {}),
      };
    case 'drop':
      return {
        type: 'field_dropdown',
        name: a.name,
        options: a.options.map(([label, value]) => [msg?.opts?.[a.name]?.[value] ?? label, value]),
      };
    case 'check':
      return { type: 'field_checkbox', name: a.name, checked: a.checked };
    case 'var':
      return { type: 'field_variable', name: a.name, variable: a.variable };
  }
}
