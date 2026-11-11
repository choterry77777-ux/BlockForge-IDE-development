import { domainOf } from '../langs';
import type { LanguageId } from '../types';
import { BLOCKS, CUSTOM_BLOCK_DEFS } from './registry';
import type { BlockSpec } from './state';

/** A toolbox entry: a block type, or a spec with preset fields and shadow inputs. */
type Entry = string | BlockSpec;

const n = (v: number): BlockSpec => ({ type: 'math_number', fields: { NUM: v }, shadow: true });
const t = (s: string): BlockSpec => ({ type: 'text', fields: { TEXT: s }, shadow: true });

interface CategoryDef {
  id: string;
  style: string;
  entries?: Entry[];
  /** Dynamic category filled by the app (variables, functions, search, favourites). */
  custom?: string;
}

const IMPERATIVE: CategoryDef[] = [
  { id: 'start', style: 'start_category', entries: ['bf_start'] },
  {
    id: 'logic',
    style: 'logic_category',
    entries: ['controls_if', { type: 'controls_if', statements: { ELSE: [] } }, 'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean', 'logic_null', 'logic_ternary'],
  },
  {
    id: 'loops',
    style: 'loop_category',
    entries: [{ type: 'controls_repeat_ext', inputs: { TIMES: n(10) } }, 'controls_whileUntil', { type: 'controls_for', inputs: { FROM: n(1), TO: n(10), BY: n(1) } }, 'controls_forEach', 'controls_flow_statements'],
  },
  {
    id: 'math',
    style: 'math_category',
    entries: [
      'math_number',
      { type: 'math_arithmetic', inputs: { A: n(1), B: n(1) } },
      { type: 'math_modulo', inputs: { DIVIDEND: n(10), DIVISOR: n(3) } },
      { type: 'math_single', inputs: { NUM: n(9) } },
      { type: 'math_round', inputs: { NUM: n(3.1) } },
      { type: 'bf_math_fn', inputs: { NUM: n(1) } },
      { type: 'bf_math_minmax', inputs: { A: n(1), B: n(2) } },
      { type: 'math_random_int', inputs: { FROM: n(1), TO: n(100) } },
    ],
  },
  {
    id: 'text',
    style: 'text_category',
    entries: ['text', 'text_join', { type: 'text_length', inputs: { VALUE: t('abc') } }, { type: 'bf_str_op', inputs: { VALUE: t('abc') } }, { type: 'bf_str_contains', inputs: { TEXT: t('hello world'), FIND: t('world') } }],
  },
  {
    id: 'lists',
    style: 'list_category',
    entries: ['lists_create_with', 'lists_length', { type: 'bf_list_get', inputs: { INDEX: n(0) } }, { type: 'bf_list_set', inputs: { INDEX: n(0) } }, 'bf_list_append', { type: 'bf_list_remove', inputs: { INDEX: n(0) } }],
  },
  { id: 'maps', style: 'map_category', entries: ['bf_map_create', { type: 'bf_map_set', inputs: { KEY: t('key') } }, { type: 'bf_map_get', inputs: { KEY: t('key') } }, { type: 'bf_map_has', inputs: { KEY: t('key') } }, { type: 'bf_map_delete', inputs: { KEY: t('key') } }] },
  { id: 'variables', style: 'variable_category', custom: 'BF_VARIABLE' },
  { id: 'functions', style: 'procedure_category', custom: 'BF_PROCEDURE' },
  { id: 'io', style: 'io_category', entries: [{ type: 'text_print', inputs: { TEXT: t('Hello') } }, { type: 'text_prompt_ext', inputs: { TEXT: t('Your name? ') } }, 'bf_comment'] },
  { id: 'convert', style: 'math_category', entries: ['bf_convert'] },
  { id: 'errors', style: 'error_category', entries: ['bf_try', { type: 'bf_throw', inputs: { MESSAGE: t('Something went wrong') } }] },
  { id: 'files', style: 'file_category', entries: [{ type: 'bf_file_read', inputs: { PATH: t('notes.txt') } }, { type: 'bf_file_write', inputs: { PATH: t('notes.txt'), CONTENT: t('Hello') } }, { type: 'bf_file_exists', inputs: { PATH: t('notes.txt') } }] },
  { id: 'modules', style: 'sys_category', entries: ['bf_import'] },
  {
    id: 'classes',
    style: 'class_category',
    entries: ['bf_struct_def', 'bf_class_def', 'bf_class_field', 'bf_class_method', 'bf_interface_def', 'bf_interface_method', 'bf_new', 'bf_this', 'bf_field_get', 'bf_field_set', 'bf_method_call', 'bf_method_call_stmt'],
  },
  { id: 'async', style: 'async_category', entries: ['bf_await', { type: 'bf_sleep', inputs: { MS: n(500) } }] },
  { id: 'network', style: 'net_category', entries: [{ type: 'bf_http_get', inputs: { URL: t('https://example.com') } }, 'bf_json_stringify', { type: 'bf_json_parse', inputs: { TEXT: t('{"a": 1}') } }] },
  { id: 'system', style: 'sys_category', entries: [{ type: 'bf_shell_run', inputs: { CMD: t('ls') } }, { type: 'bf_shell_output', inputs: { CMD: t('date') } }] },
  { id: 'memory', style: 'mem_category', entries: ['bf_addr_of', 'bf_deref', 'bf_deref_set', { type: 'bf_alloc', inputs: { COUNT: n(10) } }, 'bf_free'] },
  { id: 'page', style: 'web_category', entries: [{ type: 'bf_dom_set', inputs: { VALUE: t('Hello') } }, { type: 'bf_dom_style', inputs: { VALUE: t('red') } }, 'bf_dom_get', 'bf_dom_on'] },
  { id: 'raw', style: 'raw_category', entries: ['bf_raw_stmt', 'bf_raw_expr'] },
];

const byCategory = (category: string): string[] => CUSTOM_BLOCK_DEFS.filter((d) => d.category === category).map((d) => d.type);

const WEB: CategoryDef[] = [
  { id: 'html', style: 'web_category', entries: byCategory('html') },
  { id: 'layout', style: 'layout_category', entries: byCategory('layout') },
  { id: 'css', style: 'css_category', entries: byCategory('css') },
  { id: 'cssprops', style: 'css_category', entries: byCategory('cssprops') },
];

const SQL: CategoryDef[] = [
  { id: 'sqlschema', style: 'sql_category', entries: byCategory('sqlschema') },
  { id: 'sqldata', style: 'sql_category', entries: byCategory('sqldata') },
  { id: 'sqlquery', style: 'sql_category', entries: byCategory('sqlquery') },
  { id: 'sqlexpr', style: 'sql_expr_category', entries: [...byCategory('sqlexpr'), 'logic_compare', 'logic_operation', 'logic_negate', 'math_arithmetic'] },
  { id: 'sqlvalues', style: 'math_category', entries: ['math_number', 'text', 'logic_boolean', 'logic_null', 'lists_create_with'] },
];

const ASM: CategoryDef[] = [
  { id: 'asm', style: 'asm_category', entries: byCategory('asm') },
  { id: 'arm64', style: 'asm_a64_category', entries: byCategory('arm64') },
  { id: 'x86_64', style: 'asm_x64_category', entries: byCategory('x86_64') },
];

export interface ToolboxOptions {
  lang: LanguageId;
  /** Localised category name for a category id. */
  label: (categoryId: string) => string;
  /** Block types the target language cannot express; shown disabled. */
  unsupported?: Set<string>;
  favorites?: string[];
}

export interface ToolboxCategory {
  kind: 'category';
  name: string;
  categorystyle: string;
  toolboxitemid: string;
  custom?: string;
  contents?: unknown[];
}

function entryToJson(entry: Entry, lang: LanguageId, unsupported?: Set<string>): Record<string, unknown> | undefined {
  const spec: BlockSpec = typeof entry === 'string' ? { type: entry } : entry;
  const meta = BLOCKS[spec.type];
  if (!meta) return undefined;
  if (meta.langs && !meta.langs.includes(lang)) return undefined;
  const item: Record<string, unknown> = { kind: 'block', type: spec.type };
  const fields: Record<string, unknown> = { ...(spec.fields ?? {}) };
  // Raw code blocks start with the current language selected.
  if (meta.fields.LANG?.options?.includes(lang)) fields.LANG = lang;
  if (Object.keys(fields).length) item.fields = fields;
  if (spec.inputs) {
    item.inputs = Object.fromEntries(Object.entries(spec.inputs).map(([name, child]) => [name, { [child.shadow ? 'shadow' : 'block']: { type: child.type, fields: child.fields } }]));
  }
  if (spec.statements?.ELSE) item.extraState = { hasElse: true };
  if (unsupported?.has(spec.type)) item.enabled = false;
  return item;
}

export function toolboxCategories(lang: LanguageId): CategoryDef[] {
  switch (domainOf(lang)) {
    case 'imperative':
      return IMPERATIVE;
    case 'web':
      // CSS files only need style blocks; HTML also offers script blocks.
      return lang === 'css' ? WEB.filter((c) => c.id !== 'html') : [...WEB, ...IMPERATIVE.filter((c) => !['start', 'memory', 'raw', 'classes', 'modules', 'files', 'system', 'errors'].includes(c.id))];
    case 'sql':
      return SQL;
    case 'asm':
      return ASM;
  }
}

/** Blockly toolbox definition for a target language. */
export function buildToolbox(opts: ToolboxOptions): { kind: 'categoryToolbox'; contents: unknown[] } {
  const contents: unknown[] = [];
  if (opts.favorites?.length) {
    contents.push({ kind: 'category', name: opts.label('favorites'), categorystyle: 'favorite_category', toolboxitemid: 'favorites', contents: opts.favorites.flatMap((type) => entryToJson(type, opts.lang, opts.unsupported) ?? []) });
    contents.push({ kind: 'sep' });
  }
  for (const cat of toolboxCategories(opts.lang)) {
    const item: ToolboxCategory = { kind: 'category', name: opts.label(cat.id), categorystyle: cat.style, toolboxitemid: cat.id };
    if (cat.custom) item.custom = cat.custom;
    else {
      item.contents = (cat.entries ?? []).flatMap((e) => entryToJson(e, opts.lang, opts.unsupported) ?? []);
      if (!item.contents.length) continue;
    }
    contents.push(item);
  }
  return { kind: 'categoryToolbox', contents };
}

/** Every block type offered for a language, used by search and the AI catalogue. */
export function blockTypesFor(lang: LanguageId): string[] {
  const out = new Set<string>();
  for (const cat of toolboxCategories(lang)) {
    for (const e of cat.entries ?? []) {
      const type = typeof e === 'string' ? e : e.type;
      const meta = BLOCKS[type];
      if (meta && (!meta.langs || meta.langs.includes(lang))) out.add(type);
    }
    if (cat.custom === 'BF_VARIABLE') ['variables_get', 'variables_set', 'math_change', 'bf_var_declare'].forEach((x) => out.add(x));
    if (cat.custom === 'BF_PROCEDURE') ['procedures_defnoreturn', 'procedures_defreturn', 'procedures_callnoreturn', 'procedures_callreturn', 'procedures_ifreturn', 'bf_return', 'bf_func_ref', 'bf_call_ref', 'bf_call_ref_stmt'].forEach((x) => out.add(x));
  }
  return [...out];
}

export function toolboxEntry(type: string, lang: LanguageId): Record<string, unknown> | undefined {
  for (const cat of toolboxCategories(lang)) {
    const hit = (cat.entries ?? []).find((e) => (typeof e === 'string' ? e : e.type) === type);
    if (hit) return entryToJson(hit, lang);
  }
  return entryToJson(type, lang);
}
