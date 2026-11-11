import { analyze } from '../ir/analyze';
import type { CssItem, CssRule, ImperativeProgram, WebElement, WebNode, WebProgram } from '../ir/types';
import { LANGUAGES } from '../langs';
import type { Diagnostic, GenOptions, GenResult, LanguageId } from '../types';
import { Emitter } from './emitter';
import jsGenerator from './javascript';

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');
const PROP_RE = /^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/;
const INLINE_TAGS = new Set(['a', 'span', 'strong', 'em', 'label', 'button', 'code', 'b', 'i', 'small']);

function diag(severity: Diagnostic['severity'], code: string, message: string, blockId?: string, params?: Record<string, string | number>): Diagnostic {
  return { severity, code, message, blockId, params, source: 'generator' };
}

/** Writes CSS rules and reports questionable declarations. */
export function writeCss(em: Emitter, items: CssItem[], diags: Diagnostic[]): void {
  const rule = (r: CssRule) => {
    const start = em.count;
    em.line(`${r.selector} {`);
    em.indent();
    const seen = new Set<string>();
    if (!r.decls.length) diags.push(diag('info', 'css.emptyRule', `The rule "${r.selector}" has no properties.`, r.id, { selector: r.selector }));
    for (const d of r.decls) {
      if (!PROP_RE.test(d.prop)) {
        diags.push(diag('error', 'css.badProperty', `"${d.prop}" is not a valid CSS property name.`, d.id, { prop: d.prop }));
        continue;
      }
      if (!d.value) {
        diags.push(diag('error', 'css.emptyValue', `The property "${d.prop}" has no value.`, d.id, { prop: d.prop }));
        continue;
      }
      if (seen.has(d.prop)) diags.push(diag('warning', 'css.duplicateProperty', `"${d.prop}" is set twice in "${r.selector}"; the last value wins.`, d.id, { prop: d.prop, selector: r.selector }));
      seen.add(d.prop);
      const ds = em.count;
      em.line(`${d.prop}: ${d.value};`);
      em.mark(d.id, ds);
    }
    em.dedent();
    em.line('}');
    em.mark(r.id, start);
  };
  items.forEach((item, i) => {
    if (i) em.blank();
    if (item.kind === 'rule') rule(item);
    else {
      const start = em.count;
      em.line(`@media ${item.query} {`);
      em.indent();
      item.rules.forEach((r, j) => {
        if (j) em.blank();
        rule(r);
      });
      em.dedent();
      em.line('}');
      em.mark(item.id, start);
    }
  });
}

function result(lang: LanguageId, em: Emitter, diags: Diagnostic[], opts: GenOptions, notes: string[] = []): GenResult {
  const info = LANGUAGES[lang];
  const file = opts.baseName ? `${opts.baseName}.${info.ext}` : info.entry;
  return {
    language: lang,
    files: [{ path: file, content: em.toString(), role: 'main' }],
    mappings: em.mappings(file),
    dependencies: [],
    diagnostics: diags,
    meta: { entryFile: file, languageName: info.name, features: [] },
    requirements: { toolchains: [], notes },
  };
}

export const cssGenerator = {
  generate(program: WebProgram, opts: GenOptions = {}): GenResult {
    const em = new Emitter(' '.repeat(opts.indent ?? 2));
    const diags: Diagnostic[] = [];
    if (!program.styles.length) diags.push(diag('warning', 'css.noRules', 'There are no style rules yet. Add a style rule block.'));
    writeCss(em, program.styles, diags);
    return result('css', em, diags, opts);
  },
};

function writeNode(em: Emitter, n: WebNode, diags: Diagnostic[], ids: Map<string, string | undefined>): void {
  const start = em.count;
  if (n.kind === 'text') {
    em.line(escapeText(n.text));
    em.mark(n.id, start);
    return;
  }
  const el: WebElement = n;
  if (el.attrs.id) {
    if (ids.has(el.attrs.id)) diags.push(diag('warning', 'web.duplicateId', `The id "${el.attrs.id}" is used by more than one element.`, el.id, { id: el.attrs.id }));
    ids.set(el.attrs.id, el.id);
  }
  if (el.tag === 'img' && !el.attrs.alt) diags.push(diag('info', 'web.missingAlt', 'Add a description so screen readers can announce the image.', el.id));
  if (el.tag === 'a' && /^\s*javascript:/i.test(el.attrs.href ?? '')) diags.push(diag('warning', 'web.scriptLink', 'Links that run script are discouraged. Use an event block instead.', el.id));
  const attrs = Object.entries(el.attrs)
    .filter(([k, v]) => !(k === 'alt' && v === '' && el.tag !== 'img'))
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
  if (el.selfClosing) em.line(`<${el.tag}${attrs}>`);
  else if (!el.children.length) em.line(`<${el.tag}${attrs}></${el.tag}>`);
  else if (el.children.length === 1 && el.children[0].kind === 'text') em.line(`<${el.tag}${attrs}>${escapeText(el.children[0].text)}</${el.tag}>`);
  else if (INLINE_TAGS.has(el.tag) && el.children.every((c) => c.kind === 'text')) em.line(`<${el.tag}${attrs}>${el.children.map((c) => (c.kind === 'text' ? escapeText(c.text) : '')).join(' ')}</${el.tag}>`);
  else {
    em.line(`<${el.tag}${attrs}>`);
    em.indent();
    for (const c of el.children) writeNode(em, c, diags, ids);
    em.dedent();
    em.line(`</${el.tag}>`);
  }
  em.mark(el.id, start);
}

export const htmlGenerator = {
  generate(program: WebProgram, opts: GenOptions = {}): GenResult {
    const em = new Emitter(' '.repeat(opts.indent ?? 2));
    const diags: Diagnostic[] = [];
    const notes: string[] = [];
    if (!program.hasDocument) {
      diags.push(diag('error', 'web.noDocument', 'Add an HTML document block to build a page.'));
      return result('html', em, diags, opts);
    }
    const docStart = em.count;
    em.line('<!DOCTYPE html>');
    em.line(`<html lang="${escapeAttr(program.lang)}">`);
    em.line('<head>');
    em.indent();
    em.line('<meta charset="UTF-8">');
    em.line('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    em.line(`<title>${escapeText(program.title)}</title>`);
    if (program.styles.length) {
      em.line('<style>');
      em.indent();
      writeCss(em, program.styles, diags);
      em.dedent();
      em.line('</style>');
    }
    em.dedent();
    em.line('</head>');
    em.line('<body>');
    em.indent();
    const ids = new Map<string, string | undefined>();
    for (const n of program.body) writeNode(em, n, diags, ids);
    if (program.script.length || program.scriptFuncs.length) {
      const ip: ImperativeProgram = { domain: 'imperative', main: program.script, funcs: program.scriptFuncs, classes: [], interfaces: [], hasStart: true };
      const an = analyze(ip);
      const js = jsGenerator.generate(ip, an, { ...opts, indent: opts.indent ?? 2 });
      diags.push(...an.diagnostics, ...js.diagnostics);
      em.line('<script>');
      em.indent();
      const offset = em.count;
      const pad = em.unit.repeat(em.level);
      const lines = js.files[0].content.replace(/\n$/, '').split('\n');
      for (const l of lines) em.lines.push(l ? pad + l.replace(/<\/script/gi, '<\\/script') : '');
      for (const m of js.mappings) em.maps.push({ blockId: m.blockId, start: m.startLine + offset, end: m.endLine + offset });
      em.dedent();
      em.line('</script>');
      // Elements referenced from script must exist in the page.
      const check = (id: string | undefined, blockId?: string) => {
        if (id !== undefined && !ids.has(id)) diags.push(diag('warning', 'web.unknownElement', `The script uses an element with id "${id}", but the page has no such element.`, blockId, { id }));
      };
      const visit = (stmts: typeof program.script): void => {
        for (const s of stmts) {
          if ((s.k === 'domSet' || s.k === 'domOn') && s.target.k === 'str') check(s.target.value, s.id);
          if (s.k === 'domOn') visit(s.body);
          if (s.k === 'if') [...s.branches.map((b) => b.body), s.else ?? []].forEach(visit);
          if (s.k === 'while' || s.k === 'repeat' || s.k === 'forRange' || s.k === 'forEach') visit(s.body);
        }
      };
      visit(program.script);
      program.scriptFuncs.forEach((f) => visit(f.body));
      notes.push('Script blocks are emitted as inline JavaScript.');
    }
    em.dedent();
    em.line('</body>');
    em.line('</html>');
    if (program.docId) em.maps.push({ blockId: program.docId, start: docStart + 1, end: em.count });
    return result('html', em, diags, opts, notes);
  },
};
