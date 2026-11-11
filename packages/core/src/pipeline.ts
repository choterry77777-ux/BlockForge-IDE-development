import type { WorkspaceState } from './blocks/state';
import { type Analysis, analyze } from './ir/analyze';
import { asmFromBlocks, sqlFromBlocks, webFromBlocks } from './ir/domains';
import { imperativeFromBlocks } from './ir/fromBlocks';
import type { AsmProgram, ImperativeProgram, Program, SqlProgram, WebProgram } from './ir/types';
import { domainOf } from './langs';
import type { Diagnostic, Domain, GenOptions, GenResult, LanguageId } from './types';

export interface ImperativeLangGenerator {
  generate(program: ImperativeProgram, analysis: Analysis, opts?: GenOptions): GenResult;
}
export interface DomainLangGenerator<P> {
  generate(program: P, opts?: GenOptions): GenResult;
}

type Loader = () => Promise<{ default: unknown }>;

/** Generators are loaded on demand so a session only pays for the languages it uses. */
const LOADERS: Record<LanguageId, Loader> = {
  python: () => import('./generators/python'),
  javascript: () => import('./generators/javascript'),
  typescript: () => import('./generators/typescript'),
  c: () => import('./generators/c'),
  cpp: () => import('./generators/cpp'),
  java: () => import('./generators/java'),
  csharp: () => import('./generators/csharp'),
  lua: () => import('./generators/lua'),
  html: () => import('./generators/html'),
  css: () => import('./generators/css'),
  php: () => import('./generators/php'),
  go: () => import('./generators/go'),
  rust: () => import('./generators/rust'),
  sql: () => import('./generators/sql'),
  dart: () => import('./generators/dart'),
  assembly: () => import('./generators/assembly'),
  ruby: () => import('./generators/ruby'),
  kotlin: () => import('./generators/kotlin'),
  bash: () => import('./generators/bash'),
};

const cache = new Map<LanguageId, unknown>();

export async function loadGenerator(lang: LanguageId): Promise<unknown> {
  if (!cache.has(lang)) cache.set(lang, (await LOADERS[lang]()).default);
  return cache.get(lang);
}

export interface Converted {
  domain: Domain;
  program: Program;
  diagnostics: Diagnostic[];
  analysis?: Analysis;
}

/** Blocks -> validated IR (+ semantic analysis for imperative programs). */
export function convert(state: WorkspaceState, domain: Domain, opts: GenOptions = {}): Converted {
  switch (domain) {
    case 'imperative': {
      const { program, diagnostics } = imperativeFromBlocks(state);
      const analysis = analyze(program);
      return { domain, program, diagnostics: [...diagnostics, ...analysis.diagnostics], analysis };
    }
    case 'web': {
      const { program, diagnostics } = webFromBlocks(state);
      return { domain, program, diagnostics };
    }
    case 'sql': {
      const { program, diagnostics } = sqlFromBlocks(state);
      return { domain, program, diagnostics };
    }
    case 'asm': {
      const { program, diagnostics } = asmFromBlocks(state, opts.asmArch, opts.asmPlatform);
      return { domain, program, diagnostics };
    }
  }
}

export async function generateConverted(conv: Converted, lang: LanguageId, opts: GenOptions = {}): Promise<GenResult> {
  const gen = await loadGenerator(lang);
  let result: GenResult;
  if (conv.domain === 'imperative') {
    result = (gen as ImperativeLangGenerator).generate(conv.program as ImperativeProgram, conv.analysis!, opts);
  } else {
    result = (gen as DomainLangGenerator<WebProgram | SqlProgram | AsmProgram>).generate(conv.program as WebProgram, opts);
  }
  return finish(result, conv.diagnostics);
}

/** Full pipeline: blocks -> IR -> analysis -> source code with mappings and diagnostics. */
export async function generate(state: WorkspaceState, lang: LanguageId, opts: GenOptions = {}): Promise<GenResult> {
  return generateConverted(convert(state, domainOf(lang), opts), lang, opts);
}

/** Generate several languages of the same domain from one conversion pass. */
export async function generateMany(state: WorkspaceState, langs: LanguageId[], opts: GenOptions = {}): Promise<Partial<Record<LanguageId, GenResult>>> {
  const out: Partial<Record<LanguageId, GenResult>> = {};
  const byDomain = new Map<Domain, Converted>();
  for (const lang of langs) {
    const domain = domainOf(lang);
    if (!byDomain.has(domain)) byDomain.set(domain, convert(state, domain, opts));
    out[lang] = await generateConverted(byDomain.get(domain)!, lang, opts);
  }
  return out;
}

function finish(result: GenResult, upstream: Diagnostic[]): GenResult {
  const entry = result.meta.entryFile;
  const firstLine = new Map<string, number>();
  for (const m of result.mappings) {
    const cur = firstLine.get(m.blockId);
    if (cur === undefined || m.startLine < cur) firstLine.set(m.blockId, m.startLine);
  }
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const d of [...upstream, ...result.diagnostics]) {
    const key = `${d.code}|${d.blockId ?? ''}|${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({ ...d, file: d.file ?? entry, line: d.line ?? (d.blockId ? firstLine.get(d.blockId) : undefined) });
  }
  return { ...result, diagnostics };
}

/** Innermost block for a source line, used to jump from code or compiler errors to blocks. */
export function blockAtLine(result: GenResult, file: string, line: number): string | undefined {
  let best: { id: string; span: number } | undefined;
  for (const m of result.mappings) {
    if (m.file !== file || line < m.startLine || line > m.endLine) continue;
    const span = m.endLine - m.startLine;
    if (!best || span < best.span) best = { id: m.blockId, span };
  }
  return best?.id;
}

export function linesOfBlock(result: GenResult, blockId: string): { file: string; startLine: number; endLine: number } | undefined {
  const hits = result.mappings.filter((m) => m.blockId === blockId);
  if (!hits.length) return undefined;
  return { file: hits[0].file, startLine: Math.min(...hits.map((h) => h.startLine)), endLine: Math.max(...hits.map((h) => h.endLine)) };
}
