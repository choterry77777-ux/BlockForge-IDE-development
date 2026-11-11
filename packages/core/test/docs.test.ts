import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOWED_EXECUTABLES } from '../src/build/toolchains';
import { IMPERATIVE_LANGUAGES, LANGUAGES } from '../src/langs';
import { LANGUAGE_IDS } from '../src/types';
import { computeSupport, FEATURE_PROBES } from '../src/support';
import { UNSUPPORTED } from '../src/examples/support';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Languages whose generated programs are compiled and run by the test suite on a machine that has the toolchain. */
const RUNTIME_VERIFIED = ['python', 'javascript', 'typescript', 'c', 'cpp', 'java', 'csharp', 'go', 'rust', 'lua', 'php', 'ruby', 'kotlin', 'bash', 'sql', 'assembly'];

async function supportDocument(): Promise<string> {
  const matrix = await computeSupport();
  const langs = IMPERATIVE_LANGUAGES;
  const lines: string[] = [
    '# Feature support matrix',
    '',
    'This file is generated from the code generators themselves (`computeSupport()` in `packages/core/src/support.ts`):',
    'each feature is a small block program that is generated for every language, and a cell is "yes" only when the',
    'generator produced code without an "unsupported" diagnostic. Regenerate it with `BF_WRITE_DOCS=1 npx vitest run packages/core/test/docs.test.ts`.',
    '',
    'When a language cannot express a block, the IDE shows an explicit diagnostic on that block instead of generating wrong code.',
    '',
    '## General-purpose languages',
    '',
    `| Feature | ${langs.map((l) => LANGUAGES[l].name).join(' | ')} |`,
    `| --- | ${langs.map(() => ':-:').join(' | ')} |`,
  ];
  for (const [feature, probe] of Object.entries(FEATURE_PROBES)) lines.push(`| ${probe.label} | ${langs.map((l) => (matrix[feature]?.[l] ? 'yes' : 'no')).join(' | ')} |`);
  lines.push(
    '',
    '## How each language runs',
    '',
    '| Language | File | Runs inside the app without tools | Desktop toolchain | Generated code executed by the test suite |',
    '| --- | --- | --- | --- | :-: |',
  );
  for (const l of LANGUAGE_IDS) {
    const m = LANGUAGES[l];
    const builtin = m.browserRuntime ? (l === 'html' || l === 'css' ? 'yes (sandboxed preview)' : 'yes') : 'no';
    lines.push(`| ${m.name} | \`${m.entry}\` | ${builtin} | ${m.toolchains.length ? m.toolchains.join(', ') : 'none needed'} | ${RUNTIME_VERIFIED.includes(l) ? 'yes' : l === 'html' || l === 'css' ? 'structure checked' : 'no'} |`);
  }
  lines.push(
    '',
    'Dart code is generated and unit-checked, but it has not been executed by the test suite because the Dart SDK was not installed on the development machine.',
    '',
    '## Example programs that a language cannot express',
    '',
    'The shared example programs are run in every language. These combinations are expected to report "unsupported" instead:',
    '',
  );
  for (const [example, list] of Object.entries(UNSUPPORTED)) lines.push(`- \`${example}\`: ${list.map((l) => LANGUAGES[l].name).join(', ')}`);
  lines.push('');
  return lines.join('\n');
}

describe('documentation', () => {
  it('docs/SUPPORT.md matches what the generators can do', async () => {
    const file = join(root, 'docs/SUPPORT.md');
    const text = await supportDocument();
    if (process.env.BF_WRITE_DOCS) writeFileSync(file, text);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('the desktop backend allows exactly the executables the build recipes use', () => {
    const rust = readFileSync(join(root, 'apps/ide/src-tauri/src/paths.rs'), 'utf8');
    const block = rust.match(/ALLOWED_EXECUTABLES: &\[&str\] = &\[([\s\S]*?)\];/);
    expect(block).not.toBeNull();
    const names = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(names).toEqual([...ALLOWED_EXECUTABLES].sort());
  });
});
