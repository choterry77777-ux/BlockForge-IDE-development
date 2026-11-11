import type { LanguageId } from '../types';
import { ASM_EXAMPLES, CSS_EXAMPLES, SQL_EXAMPLES, WEB_EXAMPLES } from './domains';
import { type Example, IMPERATIVE_EXAMPLES } from './imperative';
import { UNSUPPORTED } from './support';
import { domainOf } from '../langs';

export type { Example } from './imperative';
export { IMPERATIVE_EXAMPLES, WEB_EXAMPLES, CSS_EXAMPLES, SQL_EXAMPLES, ASM_EXAMPLES, UNSUPPORTED };

/** Examples that make sense for a target language. */
export function examplesFor(lang: LanguageId): Example[] {
  switch (domainOf(lang)) {
    case 'imperative':
      return IMPERATIVE_EXAMPLES.filter((e) => !UNSUPPORTED[e.id]?.includes(lang));
    case 'web':
      return lang === 'css' ? CSS_EXAMPLES : WEB_EXAMPLES;
    case 'sql':
      return SQL_EXAMPLES;
    case 'asm':
      return ASM_EXAMPLES;
  }
}
