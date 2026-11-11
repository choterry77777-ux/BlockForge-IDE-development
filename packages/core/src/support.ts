import * as b from './blocks/dsl';
import { BLOCKS } from './blocks/registry';
import type { BlockSpec, WorkspaceState } from './blocks/state';
import { IMPERATIVE_LANGUAGES } from './langs';
import { generate } from './pipeline';
import type { LanguageId } from './types';

const t = b.text;
const n = b.num;
const one = (...stmts: BlockSpec[]): WorkspaceState => b.workspace(b.start(...stmts));
const spec = (type: string, inputs: Record<string, BlockSpec> = {}, fields: Record<string, string | number | boolean> = {}): BlockSpec => ({ type, inputs, fields });

/** A tiny program per feature. A language supports the feature when it generates without a gen.unsupported error. */
export const FEATURE_PROBES: Record<string, { label: string; build: () => WorkspaceState }> = {
  print: { label: 'Print', build: () => one(b.print(t('x'))) },
  input: { label: 'Input', build: () => one(b.print(b.ask('? '))) },
  conditions: { label: 'Conditions', build: () => one(b.iff(b.cmp('GT', n(2), n(1)), [b.print(t('x'))], [b.print(t('y'))])) },
  loops: { label: 'Loops', build: () => one(b.count('i', 1, 3, [b.print(b.getv('i'))]), b.whileDo(b.bool(false), [b.brk()])) },
  functions: { label: 'Functions and recursion', build: () => b.workspace(b.fnDef('f', ['a'], [b.ifReturn(b.cmp('LTE', b.getv('a'), n(0)), n(0))], b.call('f', b.sub(b.getv('a'), n(1)))), b.start(b.print(b.call('f', n(2))))) },
  strings: { label: 'Text operations', build: () => one(b.print(b.join(b.strOp('upper', t('a')), b.textLen(t('abc'))))) },
  math: { label: 'Math functions', build: () => one(b.print(b.mathFn('ROOT', n(4))), b.print(b.round('ROUND', n(2.5)))) },
  convert: { label: 'Type conversion', build: () => one(b.print(b.convert(t('4'), 'int'))) },
  random: { label: 'Random numbers', build: () => one(b.print(spec('math_random_int', { FROM: n(1), TO: n(6) }))) },
  typedDecl: { label: 'Typed declarations and constants', build: () => one(b.declare('k', 'int', n(1), true), b.print(b.getv('k'))) },
  lists: { label: 'Lists', build: () => one(b.setv('l', b.list(n(1), n(2))), b.append(b.getv('l'), n(3)), b.print(b.item(b.getv('l'), n(0)))) },
  maps: { label: 'Dictionaries', build: () => one(b.setv('m', b.dict()), b.dictSet(b.getv('m'), t('a'), n(1)), b.print(b.dictGet(b.getv('m'), t('a')))) },
  exceptions: { label: 'Exceptions (try / raise)', build: () => one(b.tryCatch([b.iff(b.cmp('GT', n(2), n(1)), [b.raise(t('x'))])], 'e', [b.print(b.getv('e'))])) },
  files: { label: 'File access', build: () => one(spec('bf_file_write', { PATH: t('a.txt'), CONTENT: t('x') }, { MODE: 'write' }), b.print(spec('bf_file_read', { PATH: t('a.txt') }))) },
  structs: { label: 'Structs', build: () => b.workspace(b.structDef('P', [['x', 'int']]), b.start(b.setv('p', b.create('P', n(1))), b.print(b.field(b.getv('p'), 'x')))) },
  classes: { label: 'Classes and methods', build: () => b.workspace(b.classDef('C', [['v', 'int']], [b.method('get', '', 'int', [b.ret(b.field(b.self(), 'v'))])]), b.start(b.setv('c', b.create('C', n(1))), b.print(b.callMethod(b.getv('c'), 'get')))) },
  interfaces: { label: 'Interfaces', build: () => b.workspace(b.interfaceDef('S', [['area', '', 'int']]), b.classDef('Q', [['s', 'int']], [b.method('area', '', 'int', [b.ret(b.field(b.self(), 's'))])], 'S'), b.start(b.setv('q', b.create('Q', n(2))), b.print(b.callMethod(b.getv('q'), 'area')))) },
  callbacks: { label: 'Function values', build: () => b.workspace(b.fnDef('h', [], [b.print(t('x'))]), b.start(spec('bf_call_ref_stmt', { FN: spec('bf_func_ref', {}, { NAME: 'h' }), ARGS: b.list() }))) },
  sleep: { label: 'Waiting', build: () => one(spec('bf_sleep', { MS: n(1) })) },
  http: { label: 'HTTP requests', build: () => one(b.print(spec('bf_http_get', { URL: t('https://example.com') }))) },
  json: { label: 'JSON output', build: () => one(b.print(spec('bf_json_stringify', { VALUE: b.list(n(1)) }))) },
  jsonParse: { label: 'JSON parsing', build: () => one(b.setv('j', spec('bf_json_parse', { TEXT: t('[1]') })), b.print(t('ok'))) },
  shell: { label: 'Shell commands', build: () => one(spec('bf_shell_run', { CMD: t('true') })) },
  pointers: { label: 'Pointers and references', build: () => one(b.setv('v', n(1)), b.setv('p', spec('bf_addr_of', {}, { VAR: 'v' })), spec('bf_deref_set', { PTR: b.getv('p'), VALUE: n(2) }), b.print(spec('bf_deref', { PTR: b.getv('p') }))) },
  manualMemory: { label: 'Manual memory', build: () => one(b.setv('p', spec('bf_alloc', { COUNT: n(4) }, { TYPE: 'int' })), b.setItem(b.getv('p'), n(0), n(7)), spec('bf_free', {}, { VAR: 'p' })) },
  dom: { label: 'Web page scripting', build: () => one(spec('bf_dom_set', { VALUE: t('x') }, { ID: 'out', WHAT: 'text' })) },
  imports: { label: 'Module imports', build: () => one(spec('bf_import', {}, { MODULE: 'x' })) },
};

export type SupportMatrix = Record<string, Partial<Record<LanguageId, boolean>>>;

/** Measure, by generating code, which features each language can express. */
export async function computeSupport(langs: LanguageId[] = IMPERATIVE_LANGUAGES): Promise<SupportMatrix> {
  const out: SupportMatrix = {};
  for (const [feature, probe] of Object.entries(FEATURE_PROBES)) {
    out[feature] = {};
    for (const lang of langs) {
      const r = await generate(probe.build(), lang);
      out[feature][lang] = !r.diagnostics.some((d) => d.severity === 'error' && (d.code === 'gen.unsupported' || d.code === 'gen.mixedTypes' || d.code === 'gen.tryControlFlow'));
    }
  }
  return out;
}

/** Block types that a language cannot express, derived from the measured matrix. */
export function unsupportedBlocks(matrix: SupportMatrix, lang: LanguageId): Set<string> {
  const out = new Set<string>();
  for (const [type, meta] of Object.entries(BLOCKS)) {
    if (meta.feature && matrix[meta.feature]?.[lang] === false) out.add(type);
  }
  return out;
}
