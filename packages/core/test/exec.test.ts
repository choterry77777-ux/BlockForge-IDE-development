/**
 * End-to-end generator tests: blocks -> code -> real compiler/interpreter -> stdout.
 * A language whose toolchain is missing is skipped and reported as such; it is
 * never counted as passing.
 */
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/build/recipes';
import { IMPERATIVE_EXAMPLES } from '../src/examples/imperative';
import { UNSUPPORTED } from '../src/examples/support';
import { IMPERATIVE_LANGUAGES } from '../src/langs';
import { generate } from '../src/pipeline';
import type { LanguageId } from '../src/types';
import { hasTools, runGenerated } from './helpers/run';

const only = process.env.BF_LANGS?.split(',') as LanguageId[] | undefined;
const langs = IMPERATIVE_LANGUAGES.filter((l) => !only || only.includes(l));

for (const lang of langs) {
  const requires = buildPlan({ language: lang, entry: 'x' }).requires;
  const available = hasTools(requires);
  describe(`${lang} generator`, () => {
    for (const ex of IMPERATIVE_EXAMPLES) {
      const unsupported = UNSUPPORTED[ex.id]?.includes(lang);
      it(`${ex.id}: ${unsupported ? 'reports unsupported constructs' : 'generates valid code'}`, async () => {
        const result = await generate(ex.build(), lang);
        const errors = result.diagnostics.filter((d) => d.severity === 'error');
        if (unsupported) {
          expect(errors.some((d) => d.code === 'gen.unsupported'), 'expected a gen.unsupported diagnostic').toBe(true);
          return;
        }
        expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
        expect(result.files[0].content.length).toBeGreaterThan(0);
        expect(result.mappings.length).toBeGreaterThan(0);
      });
      if (!unsupported && ex.expected !== undefined) {
        it.skipIf(!available)(`${ex.id}: runs and prints the expected output`, async () => {
          const result = await generate(ex.build(), lang);
          const out = runGenerated(result, lang, ex.stdin);
          if (!out.ok) throw new Error(`${out.stage} failed\n--- stderr\n${out.stderr}\n--- stdout\n${out.stdout}\n--- source\n${result.files[0].content}`);
          expect(out.stdout.replace(/\r\n/g, '\n')).toBe(ex.expected);
        });
      }
    }
  });
}
