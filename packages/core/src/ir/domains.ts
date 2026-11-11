import { BLOCKS } from '../blocks/registry';
import type { BlockState, WorkspaceState } from '../blocks/state';
import type { AsmArch, AsmPlatform, Diagnostic } from '../types';
import { ImperativeConverter } from './fromBlocks';
import { Reader } from './reader';
import type { AsmInstr, AsmProgram, CssDecl, CssItem, CssRule, SqlClause, SqlColumnDef, SqlExpr, SqlProgram, SqlStmt, WebNode, WebProgram } from './types';

// =====================================================================
// Web (HTML / CSS)
// =====================================================================

const TAG_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const ATTR_RE = /([a-zA-Z_:@][-\w:.@]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(ATTR_RE)) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

class WebConverter {
  constructor(
    readonly r: Reader,
    readonly imp: ImperativeConverter,
  ) {}

  private idClass(b: BlockState): Record<string, string> {
    const attrs: Record<string, string> = {};
    const id = this.r.str(b, 'ID').trim();
    const cls = this.r.str(b, 'CLASS').trim();
    if (id) attrs.id = id;
    if (cls) attrs.class = cls;
    return attrs;
  }

  nodes(blocks: BlockState[]): WebNode[] {
    const out: WebNode[] = [];
    for (const b of blocks) {
      const n = this.node(b);
      if (n) out.push(n);
    }
    return out;
  }

  node(b: BlockState): WebNode | undefined {
    const r = this.r;
    const id = b.id;
    const kids = () => this.nodes(r.stack(b, 'CHILDREN'));
    switch (b.type) {
      case 'web_element':
        return { kind: 'element', id, tag: r.str(b, 'TAG', 'div'), attrs: this.idClass(b), children: kids() };
      case 'web_text_element':
        return { kind: 'element', id, tag: r.str(b, 'TAG', 'p'), attrs: this.idClass(b), children: [{ kind: 'text', text: r.str(b, 'TEXT') }] };
      case 'web_text':
        return { kind: 'text', id, text: r.str(b, 'TEXT') };
      case 'web_link':
        return { kind: 'element', id, tag: 'a', attrs: { href: r.str(b, 'HREF') }, children: [{ kind: 'text', text: r.str(b, 'TEXT') }] };
      case 'web_image':
        return { kind: 'element', id, tag: 'img', attrs: { src: r.str(b, 'SRC'), alt: r.str(b, 'ALT') }, children: [], selfClosing: true };
      case 'web_button':
        return { kind: 'element', id, tag: 'button', attrs: { type: 'button', ...this.idClass(b) }, children: [{ kind: 'text', text: r.str(b, 'TEXT') }] };
      case 'web_input': {
        const attrs: Record<string, string> = { type: r.str(b, 'TYPE', 'text') };
        const ph = r.str(b, 'PLACEHOLDER');
        if (ph) attrs.placeholder = ph;
        const eid = r.str(b, 'ID').trim();
        if (eid) attrs.id = eid;
        return { kind: 'element', id, tag: 'input', attrs, children: [], selfClosing: true };
      }
      case 'web_void':
        return { kind: 'element', id, tag: r.str(b, 'TAG', 'br'), attrs: {}, children: [], selfClosing: true };
      case 'web_flex': {
        const style = [`display: flex`, `flex-direction: ${r.str(b, 'DIR', 'row')}`, `justify-content: ${r.str(b, 'JUSTIFY', 'flex-start')}`, `align-items: ${r.str(b, 'ALIGN', 'stretch')}`, `gap: ${r.num(b, 'GAP')}px`];
        if (r.bool(b, 'WRAP')) style.push('flex-wrap: wrap');
        return { kind: 'element', id, tag: 'div', attrs: { style: style.join('; ') }, children: kids() };
      }
      case 'web_grid':
        return { kind: 'element', id, tag: 'div', attrs: { style: `display: grid; grid-template-columns: ${r.str(b, 'COLUMNS', '1fr')}; gap: ${r.num(b, 'GAP')}px` }, children: kids() };
      case 'web_custom': {
        const tag = r.str(b, 'TAG').trim();
        if (!TAG_RE.test(tag)) {
          r.report('error', 'web.badTag', `"${tag}" is not a valid element name.`, id, { tag });
          return undefined;
        }
        return { kind: 'element', id, tag: tag.toLowerCase(), attrs: parseAttributes(r.str(b, 'ATTRS')), children: kids() };
      }
      default:
        r.report('error', 'blocks.wrongDomain', `The block "${b.type}" cannot be placed inside page content.`, id, { type: b.type });
        return undefined;
    }
  }

  decls(blocks: BlockState[]): CssDecl[] {
    const r = this.r;
    const out: CssDecl[] = [];
    const push = (b: BlockState, prop: string, value: string) => {
      if (!prop.trim()) return;
      if (/[;{}]/.test(value) || /[;{}:]/.test(prop)) {
        r.report('error', 'css.badValue', 'A CSS property or value contains characters that would break the stylesheet.', b.id);
        return;
      }
      out.push({ id: b.id, prop: prop.trim(), value: value.trim() });
    };
    for (const b of blocks) {
      switch (b.type) {
        case 'css_decl':
        case 'css_color':
          push(b, r.str(b, 'PROP'), r.str(b, 'VALUE'));
          break;
        case 'css_size':
          push(b, r.str(b, 'PROP'), `${r.num(b, 'VALUE')}${r.str(b, 'UNIT', 'px')}`);
          break;
        case 'css_display':
          push(b, 'display', r.str(b, 'VALUE'));
          break;
        case 'css_position':
          push(b, 'position', r.str(b, 'VALUE'));
          break;
        case 'css_text_align':
          push(b, 'text-align', r.str(b, 'VALUE'));
          break;
        case 'css_flex':
          push(b, 'display', 'flex');
          push(b, 'flex-direction', r.str(b, 'DIR', 'row'));
          push(b, 'justify-content', r.str(b, 'JUSTIFY', 'flex-start'));
          push(b, 'align-items', r.str(b, 'ALIGN', 'stretch'));
          if (r.bool(b, 'WRAP')) push(b, 'flex-wrap', 'wrap');
          break;
        case 'css_grid':
          push(b, 'display', 'grid');
          push(b, 'grid-template-columns', r.str(b, 'COLUMNS', '1fr'));
          if (r.str(b, 'ROWS').trim()) push(b, 'grid-template-rows', r.str(b, 'ROWS'));
          push(b, 'gap', `${r.num(b, 'GAP')}px`);
          break;
        case 'css_font':
          push(b, 'font-family', r.str(b, 'FAMILY'));
          push(b, 'font-weight', r.str(b, 'WEIGHT', '400'));
          break;
        case 'css_border':
          push(b, 'border', `${r.num(b, 'WIDTH')}px ${r.str(b, 'STYLE', 'solid')} ${r.str(b, 'COLOR')}`);
          break;
        default:
          r.report('error', 'blocks.wrongDomain', `The block "${b.type}" is not a style property.`, b.id, { type: b.type });
      }
    }
    return out;
  }

  rule(b: BlockState): CssRule | undefined {
    const selector = this.r.str(b, 'SELECTOR').trim();
    if (!selector || /[{}]/.test(selector)) {
      this.r.report('error', 'css.badSelector', 'The selector is empty or contains braces.', b.id);
      return undefined;
    }
    return { kind: 'rule', id: b.id, selector, decls: this.decls(this.r.stack(b, 'DECLS')) };
  }

  cssItems(blocks: BlockState[]): CssItem[] {
    const out: CssItem[] = [];
    for (const b of blocks) {
      if (b.type === 'css_rule') {
        const rule = this.rule(b);
        if (rule) out.push(rule);
      } else if (b.type === 'css_media') {
        const rules = this.r.stack(b, 'RULES').flatMap((x) => (x.type === 'css_rule' ? (this.rule(x) ?? []) : []));
        out.push({ kind: 'media', id: b.id, query: `(${this.r.str(b, 'COND', 'max-width')}: ${this.r.num(b, 'VALUE')}px)`, rules });
      } else {
        this.r.report('error', 'blocks.wrongDomain', `The block "${b.type}" is not a style rule.`, b.id, { type: b.type });
      }
    }
    return out;
  }
}

export function webFromBlocks(state: WorkspaceState): { program: WebProgram; diagnostics: Diagnostic[] } {
  const r = new Reader(state);
  const imp = new ImperativeConverter(r);
  const w = new WebConverter(r, imp);
  const program: WebProgram = { domain: 'web', hasDocument: false, title: '', lang: 'en', body: [], styles: [], script: [], scriptFuncs: [] };
  for (const top of r.tops()) {
    if (top.type === 'web_document') {
      if (program.hasDocument) {
        r.report('error', 'web.multipleDocuments', 'Only one HTML document block is allowed.', top.id);
        continue;
      }
      program.hasDocument = true;
      program.docId = top.id;
      program.title = r.str(top, 'TITLE');
      program.lang = r.str(top, 'LANG', 'en').trim() || 'en';
      program.body = w.nodes(r.stack(top, 'BODY'));
      program.styles.push(...w.cssItems(r.stack(top, 'STYLE')));
      program.script = imp.stmts(r.stack(top, 'SCRIPT'));
    } else if (top.type === 'css_rule' || top.type === 'css_media') {
      program.styles.push(...w.cssItems(r.chain(top)));
    } else if (top.type === 'procedures_defnoreturn' || top.type === 'procedures_defreturn') {
      program.scriptFuncs.push(imp.func(top));
    } else {
      r.report('warning', 'blocks.orphan', 'These blocks are not inside a document or style rule and are ignored.', top.id);
    }
  }
  return { program, diagnostics: r.diags };
}

// =====================================================================
// SQL
// =====================================================================

const SQL_COMPARE: Record<string, string> = { EQ: '=', NEQ: '<>', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
const SQL_ARITH: Record<string, string> = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/' };

class SqlConverter {
  constructor(readonly r: Reader) {}

  expr(parent: BlockState, input: string, optional = false): SqlExpr {
    const b = this.r.value(parent, input);
    if (!b) {
      if (!optional) this.r.report('error', 'blocks.emptyInput', `An input of this block is empty (${input}).`, parent.id, { input });
      return { k: 'missing', id: parent.id };
    }
    return this.exprOf(b);
  }

  items(b: BlockState): SqlExpr[] {
    const count = Number(b.extraState?.itemCount ?? Object.keys(b.inputs ?? {}).length);
    const out: SqlExpr[] = [];
    for (let i = 0; i < count; i++) {
      const child = this.r.value(b, `ADD${i}`);
      if (child) out.push(this.exprOf(child));
    }
    return out;
  }

  exprOf(b: BlockState): SqlExpr {
    const r = this.r;
    const id = b.id;
    const e = (name: string) => this.expr(b, name);
    switch (b.type) {
      case 'math_number':
        return { k: 'num', id, value: r.num(b, 'NUM') };
      case 'text':
        return { k: 'str', id, value: r.str(b, 'TEXT') };
      case 'logic_boolean':
        return { k: 'bool', id, value: r.str(b, 'BOOL') === 'TRUE' };
      case 'logic_null':
        return { k: 'null', id };
      case 'logic_compare':
        return { k: 'bin', id, op: SQL_COMPARE[r.str(b, 'OP')] ?? '=', l: e('A'), r: e('B') };
      case 'logic_operation':
        return { k: 'bin', id, op: r.str(b, 'OP') === 'OR' ? 'OR' : 'AND', l: e('A'), r: e('B') };
      case 'logic_negate':
        return { k: 'not', id, e: e('BOOL') };
      case 'math_arithmetic': {
        const op = SQL_ARITH[r.str(b, 'OP')];
        if (!op) {
          r.report('error', 'sql.noPower', 'SQL has no portable power operator.', id);
          return { k: 'missing', id };
        }
        return { k: 'bin', id, op, l: e('A'), r: e('B') };
      }
      case 'sql_col':
        return { k: 'col', id, name: r.str(b, 'NAME').trim() };
      case 'sql_star':
        return { k: 'star', id };
      case 'sql_func':
        return { k: 'func', id, name: r.str(b, 'FN', 'COUNT'), distinct: r.bool(b, 'DISTINCT'), arg: e('ARG') };
      case 'sql_like':
        return { k: 'like', id, e: e('VALUE'), pattern: e('PATTERN') };
      case 'sql_in': {
        const list = r.value(b, 'ITEMS');
        if (!list || list.type !== 'lists_create_with') {
          r.report('error', 'sql.inNeedsList', 'IN needs a "create list" block with the allowed values.', id);
          return { k: 'missing', id };
        }
        return { k: 'in', id, e: e('VALUE'), items: this.items(list) };
      }
      case 'sql_is_null':
        return { k: 'isNull', id, e: e('VALUE'), negate: r.str(b, 'MODE') === 'notnull' };
      case 'sql_between':
        return { k: 'between', id, e: e('VALUE'), lo: e('LOW'), hi: e('HIGH') };
      case 'sql_alias':
        return { k: 'alias', id, e: e('VALUE'), name: r.str(b, 'NAME').trim() };
      default:
        r.report('error', 'blocks.wrongDomain', `The block "${b.type}" cannot be used in a SQL expression.`, id, { type: b.type });
        return { k: 'missing', id };
    }
  }

  column(b: BlockState): SqlColumnDef {
    const r = this.r;
    return { id: b.id, name: r.str(b, 'NAME').trim(), type: r.str(b, 'TYPE', 'TEXT'), primaryKey: r.bool(b, 'PK'), autoIncrement: r.bool(b, 'AI'), notNull: r.bool(b, 'NN'), unique: r.bool(b, 'UQ'), default: r.str(b, 'DEFAULT').trim() || undefined };
  }

  clause(b: BlockState): SqlClause | undefined {
    const r = this.r;
    const id = b.id;
    switch (b.type) {
      case 'sql_join': {
        const type = r.str(b, 'TYPE', 'INNER');
        return { k: 'join', id, type, table: r.str(b, 'TABLE').trim(), on: this.expr(b, 'ON', type === 'CROSS') };
      }
      case 'sql_where':
        return { k: 'where', id, cond: this.expr(b, 'COND') };
      case 'sql_group_by':
        return { k: 'groupBy', id, columns: r.str(b, 'COLUMNS').trim() };
      case 'sql_having':
        return { k: 'having', id, cond: this.expr(b, 'COND') };
      case 'sql_order_by':
        return { k: 'orderBy', id, column: r.str(b, 'COLUMN').trim(), dir: r.str(b, 'DIR') === 'DESC' ? 'DESC' : 'ASC' };
      case 'sql_limit':
        return { k: 'limit', id, count: r.num(b, 'COUNT', 10), offset: r.num(b, 'OFFSET') };
      default:
        r.report('error', 'blocks.wrongDomain', `The block "${b.type}" is not a query clause.`, id, { type: b.type });
        return undefined;
    }
  }

  stmt(b: BlockState): SqlStmt | undefined {
    const r = this.r;
    const id = b.id;
    switch (b.type) {
      case 'sql_create_table':
        return { k: 'createTable', id, name: r.str(b, 'NAME').trim(), ifNotExists: r.bool(b, 'IFNE'), columns: r.stack(b, 'COLUMNS').filter((c) => c.type === 'sql_column').map((c) => this.column(c)) };
      case 'sql_drop_table':
        return { k: 'dropTable', id, name: r.str(b, 'NAME').trim(), ifExists: r.bool(b, 'IFE') };
      case 'sql_add_column':
        return { k: 'addColumn', id, table: r.str(b, 'TABLE').trim(), column: { name: r.str(b, 'NAME').trim(), type: r.str(b, 'TYPE', 'TEXT'), primaryKey: false, autoIncrement: false, notNull: false, unique: false } };
      case 'sql_create_index':
        return { k: 'createIndex', id, name: r.str(b, 'NAME').trim(), table: r.str(b, 'TABLE').trim(), columns: r.str(b, 'COLUMNS').trim(), unique: r.bool(b, 'UNIQUE') };
      case 'sql_insert': {
        const list = r.value(b, 'VALUES');
        if (!list || list.type !== 'lists_create_with') {
          r.report('error', 'sql.valuesNeedList', 'INSERT needs a "create list" block holding one value per column.', id);
          return undefined;
        }
        return { k: 'insert', id, table: r.str(b, 'TABLE').trim(), columns: r.str(b, 'COLUMNS').split(',').map((s) => s.trim()).filter(Boolean), values: this.items(list) };
      }
      case 'sql_select': {
        const cols = r.value(b, 'COLUMNS');
        const columns: SqlExpr[] = !cols ? [{ k: 'star' }] : cols.type === 'lists_create_with' ? this.items(cols) : [this.exprOf(cols)];
        const clauses = r.stack(b, 'CLAUSES').flatMap((c) => this.clause(c) ?? []);
        return { k: 'select', id, distinct: r.bool(b, 'DISTINCT'), columns: columns.length ? columns : [{ k: 'star' }], from: r.str(b, 'FROM').trim(), clauses };
      }
      case 'sql_update': {
        const sets = r.stack(b, 'SETS').filter((s) => s.type === 'sql_set').map((s) => ({ id: s.id, column: r.str(s, 'COLUMN').trim(), value: this.expr(s, 'VALUE') }));
        return { k: 'update', id, table: r.str(b, 'TABLE').trim(), sets, where: r.value(b, 'WHERE') ? this.expr(b, 'WHERE') : undefined };
      }
      case 'sql_delete':
        return { k: 'delete', id, table: r.str(b, 'TABLE').trim(), where: r.value(b, 'WHERE') ? this.expr(b, 'WHERE') : undefined };
      case 'sql_txn':
        return { k: 'txn', id, action: r.str(b, 'ACTION', 'BEGIN') as 'BEGIN' };
      case 'sql_comment':
        return { k: 'comment', id, text: r.str(b, 'TEXT') };
      case 'sql_raw':
        return { k: 'raw', id, code: r.str(b, 'CODE') };
      default:
        if (!BLOCKS[b.type]) r.report('error', 'blocks.unknownType', `Unknown block type "${b.type}".`, id, { type: b.type });
        else r.report('error', 'blocks.wrongDomain', `The block "${b.type}" is not a SQL statement.`, id, { type: b.type });
        return undefined;
    }
  }
}

export function sqlFromBlocks(state: WorkspaceState): { program: SqlProgram; diagnostics: Diagnostic[] } {
  const r = new Reader(state);
  const c = new SqlConverter(r);
  const program: SqlProgram = { domain: 'sql', statements: [] };
  for (const top of r.tops()) {
    const meta = BLOCKS[top.type];
    if (meta?.prev !== 'SqlStmt') {
      r.report('warning', 'blocks.orphan', 'These blocks are not part of a SQL statement and are ignored.', top.id);
      continue;
    }
    for (const b of r.chain(top)) {
      const s = c.stmt(b);
      if (s) program.statements.push(s);
    }
  }
  return { program, diagnostics: r.diags };
}

// =====================================================================
// Assembly
// =====================================================================

function archOf(type: string): AsmArch | 'any' {
  if (type.startsWith('a64_')) return 'arm64';
  if (type.startsWith('x64_')) return 'x86_64';
  return 'any';
}

export function asmFromBlocks(state: WorkspaceState, fallbackArch: AsmArch = 'arm64', fallbackPlatform: AsmPlatform = 'macos'): { program: AsmProgram; diagnostics: Diagnostic[] } {
  const r = new Reader(state);
  const program: AsmProgram = { domain: 'asm', arch: fallbackArch, platform: fallbackPlatform, hasProgram: false, routines: [] };
  const body = (b: BlockState): AsmInstr[] => {
    const out: AsmInstr[] = [];
    for (const ins of r.stack(b, 'BODY')) {
      const meta = BLOCKS[ins.type];
      if (!meta || meta.domain !== 'asm') {
        r.report('error', 'asm.highLevel', 'High-level blocks cannot be translated to assembly. Use instruction blocks.', ins.id, { type: ins.type });
        continue;
      }
      const f: Record<string, string> = {};
      for (const [k, v] of Object.entries(ins.fields ?? {})) f[k] = String(v);
      out.push({ id: ins.id, op: ins.type, arch: archOf(ins.type), f });
    }
    return out;
  };
  for (const top of r.tops()) {
    if (top.type === 'asm_program') {
      if (program.hasProgram) {
        r.report('error', 'asm.multiplePrograms', 'Only one assembly program block is allowed.', top.id);
        continue;
      }
      program.hasProgram = true;
      program.programId = top.id;
      program.arch = r.str(top, 'ARCH', fallbackArch) as AsmArch;
      program.platform = r.str(top, 'PLATFORM', fallbackPlatform) as AsmPlatform;
      program.routines.unshift({ id: top.id, name: 'main', isEntry: true, body: body(top) });
    } else if (top.type === 'asm_routine') {
      program.routines.push({ id: top.id, name: r.str(top, 'NAME').trim(), isEntry: false, body: body(top) });
    } else if (BLOCKS[top.type]?.domain === 'asm') {
      r.report('warning', 'blocks.orphan', 'These instructions are not inside a program or routine and are ignored.', top.id);
    } else {
      r.report('error', 'asm.highLevel', 'High-level blocks cannot be translated to assembly. Use instruction blocks.', top.id, { type: top.type });
    }
  }
  return { program, diagnostics: r.diags };
}
