import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CUSTOM_BLOCK_DEFS } from '@blockforge/core';
import type { LocaleBundle } from '../src/i18n';
import en from '../src/i18n/locales/en';
import ja from '../src/i18n/locales/ja';
import ko from '../src/i18n/locales/ko';
import zhCN from '../src/i18n/locales/zh-CN';
import zhTW from '../src/i18n/locales/zh-TW';

const here = dirname(fileURLToPath(import.meta.url));
const ALL: Record<string, LocaleBundle> = { ko, ja, 'zh-CN': zhCN, 'zh-TW': zhTW };
const only = process.env.BF_LOCALE;
const LOCALES = Object.entries(ALL).filter(([id]) => !only || only.split(',').includes(id));

const curly = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const percent = (s: string) => [...s.matchAll(/%(\d+)/g)].map((m) => m[1]).sort();
// Emoji and pictographs are not allowed anywhere in the interface.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}]|\u{FE0F}/u;

/** English feature names and details passed to `unsupported…(…)` in the generators. */
function generatorPhrases(): string[] {
  const dir = join(here, '../../../packages/core/src/generators');
  const out = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(dir, file), 'utf8');
    // One call per line; a detail sentence may itself contain a semicolon.
    for (const call of src.matchAll(/unsupported(?:Stmt|Expr)?\((.*)\);\s*$/gm)) {
      for (const lit of call[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
        const text = lit[1].replace(/\\'/g, "'");
        if (text) out.add(text);
      }
    }
  }
  return [...out].sort();
}

describe.each(LOCALES)('locale %s', (_id, bundle) => {
  it('translates every interface string', () => {
    const missing = Object.keys(en).filter((k) => !(k in bundle.ui) || !bundle.ui[k].trim());
    expect(missing).toEqual([]);
    const extra = Object.keys(bundle.ui).filter((k) => !(k in en));
    expect(extra).toEqual([]);
  });

  it('keeps {placeholders} intact', () => {
    const wrong = Object.keys(en).filter((k) => bundle.ui[k] !== undefined && curly(en[k]).join() !== curly(bundle.ui[k]).join());
    expect(wrong).toEqual([]);
  });

  it('translates every custom block', () => {
    const problems: string[] = [];
    for (const def of CUSTOM_BLOCK_DEFS) {
      const msg = bundle.blocks[def.type];
      if (!msg) {
        problems.push(`${def.type}: missing`);
        continue;
      }
      if (!msg.rows || msg.rows.length !== def.rows.length) {
        problems.push(`${def.type}: expected ${def.rows.length} rows`);
        continue;
      }
      def.rows.forEach((row, i) => {
        if (percent(row[0]).join() !== percent(msg.rows![i]).join()) problems.push(`${def.type}: row ${i} placeholders differ`);
      });
      if (def.tip && !msg.tip) problems.push(`${def.type}: tip missing`);
      // Dropdown overrides may only name fields and option values that exist.
      for (const [field, opts] of Object.entries(msg.opts ?? {})) {
        const arg = def.rows.flatMap((r) => r.slice(1) as { k: string; name: string; options?: [string, string][] }[]).find((a) => a.k === 'drop' && a.name === field);
        if (!arg) {
          problems.push(`${def.type}: no dropdown ${field}`);
          continue;
        }
        const values = new Set((arg.options ?? []).map((o) => o[1]));
        for (const v of Object.keys(opts)) if (!values.has(v)) problems.push(`${def.type}.${field}: no option ${v}`);
      }
    }
    expect(problems).toEqual([]);
    const unknown = Object.keys(bundle.blocks).filter((t) => !CUSTOM_BLOCK_DEFS.some((d) => d.type === t));
    expect(unknown).toEqual([]);
  });

  it('translates the phrases used in generator diagnostics', () => {
    const missing = generatorPhrases().filter((p) => !bundle.phrases[p]);
    expect(missing).toEqual([]);
  });

  it('contains no emoji', () => {
    const all = [...Object.values(bundle.ui), ...Object.values(bundle.phrases), ...Object.values(bundle.blocks).flatMap((b) => [...(b.rows ?? []), b.tip ?? '', ...Object.values(b.opts ?? {}).flatMap((o) => Object.values(o))])];
    expect(all.filter((s) => EMOJI.test(s))).toEqual([]);
  });
});

describe('english source', () => {
  it('contains no emoji', () => {
    expect(Object.entries(en).filter(([, v]) => EMOJI.test(v))).toEqual([]);
  });
  it('finds generator phrases to translate', () => {
    expect(generatorPhrases().length).toBeGreaterThan(20);
  });
});
