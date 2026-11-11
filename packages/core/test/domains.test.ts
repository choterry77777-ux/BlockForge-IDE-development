import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as b from '../src/blocks/dsl';
import { ASM_EXAMPLES, CSS_EXAMPLES, SQL_EXAMPLES, WEB_EXAMPLES } from '../src/examples/domains';
import { generate } from '../src/pipeline';
import { findTool, runGenerated } from './helpers/run';

const errors = (r: Awaited<ReturnType<typeof generate>>) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code}: ${d.message}`);

describe('HTML generator', () => {
  it('builds a complete document with styles and inline script', async () => {
    const r = await generate(WEB_EXAMPLES[0].build(), 'html');
    expect(errors(r)).toEqual([]);
    const html = r.files[0].content;
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>Counter</title>');
    expect(html).toContain('<button type="button" id="add">Add one</button>');
    expect(html).toContain('style="display: flex; flex-direction: row;');
    expect(html).toContain('@media (max-width: 600px) {');
    expect(html).toContain("addEventListener(\"click\"");
    // Every opened element is closed again.
    const open = [...html.matchAll(/<(main|div|p|h1|button|style|script|head|body|html)\b/g)].length;
    const close = [...html.matchAll(/<\/(main|div|p|h1|button|style|script|head|body|html)>/g)].length;
    expect(open).toBe(close);
    // The inline script is valid JavaScript.
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
    expect(() => new Function(script)).not.toThrow();
  });

  it('escapes text and attribute values', async () => {
    const ws = b.workspace([{ type: 'web_document', fields: { TITLE: 'a < b & c', LANG: 'en' }, statements: { BODY: [{ type: 'web_link', fields: { TEXT: '<go>', HREF: 'https://example.com/?q="x"&y=1' } }] } }]);
    const html = (await generate(ws, 'html')).files[0].content;
    expect(html).toContain('<title>a &lt; b &amp; c</title>');
    expect(html).toContain('<a href="https://example.com/?q=&quot;x&quot;&amp;y=1">&lt;go&gt;</a>');
  });

  it('reports a missing document and unknown element ids', async () => {
    const none = await generate(b.workspace([{ type: 'css_rule', fields: { SELECTOR: 'p' } }]), 'html');
    expect(none.diagnostics.some((d) => d.code === 'web.noDocument')).toBe(true);
    const ws = b.workspace([{ type: 'web_document', fields: { TITLE: 't', LANG: 'en' }, statements: { SCRIPT: [{ type: 'bf_dom_set', fields: { ID: 'nope', WHAT: 'text' }, inputs: { VALUE: b.text('x') } }] } }]);
    const r = await generate(ws, 'html');
    expect(r.diagnostics.some((d) => d.code === 'web.unknownElement')).toBe(true);
  });

  it('rejects imperative blocks placed in the page body', async () => {
    const ws = b.workspace([{ type: 'web_document', fields: { TITLE: 't', LANG: 'en' }, statements: { BODY: [b.print(b.text('x'))] } }]);
    const r = await generate(ws, 'html');
    expect(r.diagnostics.some((d) => d.code === 'blocks.wrongDomain')).toBe(true);
  });
});

describe('CSS generator', () => {
  it('writes rules, layout helpers and media queries', async () => {
    const r = await generate(CSS_EXAMPLES[0].build(), 'css');
    expect(errors(r)).toEqual([]);
    const css = r.files[0].content;
    expect(css).toContain('.card {\n  background-color: #ffffff;\n  border: 1px solid #e5e7eb;');
    expect(css).toContain('@media (max-width: 600px) {\n  .cards {\n    display: flex;\n    flex-direction: column;');
    expect(css).toContain('grid-template-columns: repeat(3, 1fr);');
    expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length);
  });

  it('diagnoses invalid properties and values that would break the sheet', async () => {
    const ws = b.workspace([{ type: 'css_rule', fields: { SELECTOR: '.a' }, statements: { DECLS: [{ type: 'css_decl', fields: { PROP: 'col or', VALUE: 'red' } }, { type: 'css_decl', fields: { PROP: 'color', VALUE: 'red; } body { display: none' } }] } }]);
    const r = await generate(ws, 'css');
    expect(r.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['css.badProperty', 'css.badValue']));
    expect(r.files[0].content).not.toContain('display: none');
  });
});

describe('SQL generator', () => {
  it('generates the shop example without errors', async () => {
    const r = await generate(SQL_EXAMPLES[0].build(), 'sql');
    expect(errors(r)).toEqual([]);
    const sql = r.files[0].content;
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS customers (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  city TEXT DEFAULT \'Seoul\'\n);');
    expect(sql).toContain('INNER JOIN orders ON orders.customer_id = customers.id');
    expect(sql).toContain('GROUP BY customers.name\nORDER BY spent DESC\nLIMIT 10;');
  });

  it.skipIf(!findTool('sqlite3'))('runs in SQLite and returns the expected rows', async () => {
    const r = await generate(SQL_EXAMPLES[0].build(), 'sql');
    const out = spawnSync(findTool('sqlite3')!, ['-batch', ':memory:'], { input: r.files[0].content, encoding: 'utf8' });
    expect(out.stderr).toBe('');
    expect(out.stdout).toBe(SQL_EXAMPLES[0].expected);
  });

  it('adapts to PostgreSQL and MySQL dialects', async () => {
    const pg = (await generate(SQL_EXAMPLES[0].build(), 'sql', { sqlDialect: 'postgres' })).files[0].content;
    expect(pg).toContain('id SERIAL PRIMARY KEY');
    expect(pg).toContain('total DOUBLE PRECISION NOT NULL');
    const my = (await generate(SQL_EXAMPLES[0].build(), 'sql', { sqlDialect: 'mysql' })).files[0].content;
    expect(my).toContain('id INT PRIMARY KEY AUTO_INCREMENT');
  });

  it('quotes awkward identifiers and escapes text', async () => {
    const ws = b.workspace([{ type: 'sql_insert', fields: { TABLE: 'order', COLUMNS: 'first name, note' }, inputs: { VALUES: b.list(b.text("O'Brien"), b.nil()) } }]);
    const sql = (await generate(ws, 'sql')).files[0].content;
    expect(sql).toBe(`INSERT INTO "order" ("first name", note)\nVALUES ('O''Brien', NULL);\n`);
  });

  it('warns about destructive statements and structural mistakes', async () => {
    const ws = b.workspace([
      { type: 'sql_delete', fields: { TABLE: 'users' } },
      { type: 'sql_insert', fields: { TABLE: 'users', COLUMNS: 'a, b' }, inputs: { VALUES: b.list(b.num(1)) } },
      { type: 'sql_create_table', fields: { NAME: 't', IFNE: false } },
    ]);
    const codes = (await generate(ws, 'sql')).diagnostics.map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining(['sql.deleteAll', 'sql.valueCount', 'sql.noColumns']));
  });
});

describe('Assembly generator', () => {
  const rosetta = process.platform === 'darwin' && spawnSync('arch', ['-x86_64', '/usr/bin/true']).status === 0;
  for (const ex of ASM_EXAMPLES) {
    const arch = ex.id.includes('x64') ? 'x86_64' : 'arm64';
    const canRun = process.platform === 'darwin' && !!findTool('cc') && (arch === process.arch.replace('x64', 'x86_64') || (arch === 'x86_64' && rosetta));
    it(`${ex.id}: generates without errors`, async () => {
      const r = await generate(ex.build(), 'assembly');
      expect(errors(r)).toEqual([]);
      expect(r.meta.variant).toBe(`${arch}-macos`);
    });
    it.skipIf(!canRun)(`${ex.id}: assembles, links and prints the expected output`, async () => {
      const r = await generate(ex.build(), 'assembly');
      const out = runGenerated(r, 'assembly', '', arch);
      if (!out.ok) throw new Error(`${out.stage} failed\n${out.stderr}\n${r.files[0].content}`);
      expect(out.stdout).toBe(ex.expected);
    });
  }

  it('refuses instruction blocks of the other architecture', async () => {
    const ws = b.workspace([{ type: 'asm_program', fields: { ARCH: 'arm64', PLATFORM: 'macos' }, statements: { BODY: [{ type: 'x64_mov_imm', fields: { DST: 'rax', IMM: 1 } }] } }]);
    const r = await generate(ws, 'assembly');
    expect(r.diagnostics.some((d) => d.code === 'asm.wrongArch')).toBe(true);
  });

  it('refuses high-level blocks instead of inventing a translation', async () => {
    const ws = b.workspace([{ type: 'asm_program', fields: { ARCH: 'arm64', PLATFORM: 'macos' }, statements: { BODY: [b.print(b.text('hi'))] } }]);
    const r = await generate(ws, 'assembly');
    expect(r.diagnostics.some((d) => d.code === 'asm.highLevel')).toBe(true);
  });

  it('checks labels and immediate ranges', async () => {
    const ws = b.workspace([
      {
        type: 'asm_program',
        fields: { ARCH: 'arm64', PLATFORM: 'macos' },
        statements: { BODY: [{ type: 'a64_branch', fields: { COND: 'b', LABEL: 'nowhere' } }, { type: 'a64_arith_imm', fields: { DST: 'x0', A: 'x0', OP: 'add', IMM: 5000 } }] },
      },
    ]);
    const codes = (await generate(ws, 'assembly')).diagnostics.map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining(['asm.undefinedLabel', 'asm.immediateRange']));
  });

  it('emits Linux system calls when asked', async () => {
    const ws = b.workspace([{ type: 'asm_program', fields: { ARCH: 'arm64', PLATFORM: 'linux' }, statements: { BODY: [{ type: 'asm_print_text', fields: { TEXT: 'hi', NEWLINE: true } }] } }]);
    const asm = (await generate(ws, 'assembly')).files[0].content;
    expect(asm).toContain('.global main');
    expect(asm).toContain('mov x8, #64');
    expect(asm).toContain(':lo12:text_1');
  });
});
