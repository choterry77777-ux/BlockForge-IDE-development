import type { SqlClause, SqlColumnDef, SqlExpr, SqlProgram, SqlStmt } from '../ir/types';
import type { Diagnostic, GenOptions, GenResult, SqlDialect } from '../types';
import { Emitter } from './emitter';

const RESERVED = new Set(['select', 'from', 'where', 'group', 'order', 'by', 'table', 'insert', 'update', 'delete', 'index', 'join', 'user', 'default', 'values', 'limit', 'offset', 'having', 'distinct', 'primary', 'key', 'unique', 'null', 'not', 'and', 'or', 'in', 'like', 'between', 'create', 'drop', 'alter', 'add', 'column', 'set', 'into', 'as', 'on', 'check', 'references', 'foreign', 'transaction', 'begin', 'commit', 'rollback', 'case', 'when', 'then', 'else', 'end', 'union', 'all', 'exists', 'desc', 'asc', 'to', 'grant']);
const DEFAULT_KEYWORDS = new Set(['null', 'true', 'false', 'current_timestamp', 'current_date', 'current_time']);
const PREC: Record<string, number> = { OR: 1, AND: 2, '=': 4, '<>': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6 };

class SqlWriter {
  readonly em: Emitter;
  readonly diags: Diagnostic[] = [];

  constructor(
    readonly dialect: SqlDialect,
    indent: number,
  ) {
    this.em = new Emitter(' '.repeat(indent));
  }

  report(severity: Diagnostic['severity'], code: string, message: string, blockId?: string, params?: Record<string, string | number>): void {
    this.diags.push({ severity, code, message, blockId, params: { dialect: this.dialect, ...params }, source: 'generator' });
  }

  /** Quote an identifier only when it needs it. Dotted names are quoted part by part. */
  ident(name: string, blockId?: string): string {
    const q = this.dialect === 'mysql' ? '`' : '"';
    if (!name.trim()) {
      this.report('error', 'sql.emptyName', 'A table or column name is empty.', blockId);
      return q + q;
    }
    return name
      .trim()
      .split('.')
      .map((part) => {
        const p = part.trim();
        if (p === '*') return p;
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) && !RESERVED.has(p.toLowerCase())) return p;
        return q + p.split(q).join(q + q) + q;
      })
      .join('.');
  }

  list(names: string, blockId?: string): string {
    return names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => this.ident(n, blockId))
      .join(', ');
  }

  str(s: string): string {
    return `'${s.replace(/'/g, "''")}'`;
  }

  expr(e: SqlExpr, min = 0): string {
    const wrap = (code: string, p: number) => (p < min ? `(${code})` : code);
    switch (e.k) {
      case 'num':
        return String(e.value);
      case 'str':
        return this.str(e.value);
      case 'bool':
        return e.value ? 'TRUE' : 'FALSE';
      case 'null':
        return 'NULL';
      case 'col':
        return this.ident(e.name, e.id);
      case 'star':
        return '*';
      case 'bin': {
        const p = PREC[e.op] ?? 4;
        if ((e.op === '=' || e.op === '<>') && (e.l.k === 'null' || e.r.k === 'null')) {
          this.report('warning', 'sql.nullCompare', 'Comparing with NULL using = or <> never matches. Use the IS NULL block.', e.id);
        }
        return wrap(`${this.expr(e.l, p)} ${e.op} ${this.expr(e.r, p + 1)}`, p);
      }
      case 'not':
        return wrap(`NOT ${this.expr(e.e, 3)}`, 3);
      case 'func': {
        const arg = this.expr(e.arg);
        if (e.distinct && e.arg.k === 'star') this.report('error', 'sql.distinctStar', 'DISTINCT cannot be combined with *.', e.id);
        return `${e.name}(${e.distinct ? 'DISTINCT ' : ''}${arg})`;
      }
      case 'like':
        return wrap(`${this.expr(e.e, 5)} LIKE ${this.expr(e.pattern, 5)}`, 4);
      case 'in':
        if (!e.items.length) this.report('error', 'sql.emptyIn', 'IN needs at least one value.', e.id);
        return wrap(`${this.expr(e.e, 5)} IN (${e.items.map((i) => this.expr(i)).join(', ')})`, 4);
      case 'isNull':
        return wrap(`${this.expr(e.e, 5)} IS ${e.negate ? 'NOT ' : ''}NULL`, 4);
      case 'between':
        return wrap(`${this.expr(e.e, 5)} BETWEEN ${this.expr(e.lo, 5)} AND ${this.expr(e.hi, 5)}`, 4);
      case 'alias':
        return `${this.expr(e.e)} AS ${this.ident(e.name, e.id)}`;
      case 'raw':
        return e.code;
      case 'missing':
        return 'NULL';
    }
  }

  private columnType(c: SqlColumnDef): string {
    if (this.dialect === 'postgres') return ({ REAL: 'DOUBLE PRECISION', BLOB: 'BYTEA', DATETIME: 'TIMESTAMP' } as Record<string, string>)[c.type] ?? c.type;
    if (this.dialect === 'mysql') return ({ INTEGER: 'INT', REAL: 'DOUBLE', NUMERIC: 'DECIMAL(18, 4)' } as Record<string, string>)[c.type] ?? c.type;
    return c.type;
  }

  column(c: SqlColumnDef): string {
    const parts = [this.ident(c.name, c.id)];
    if (c.autoIncrement) {
      if (c.type !== 'INTEGER' || !c.primaryKey) this.report('error', 'sql.autoIncrement', `Auto increment needs an INTEGER primary key column ("${c.name}").`, c.id, { name: c.name });
      if (this.dialect === 'postgres') parts.push('SERIAL PRIMARY KEY');
      else if (this.dialect === 'mysql') parts.push('INT PRIMARY KEY AUTO_INCREMENT');
      else parts.push('INTEGER PRIMARY KEY AUTOINCREMENT');
    } else {
      parts.push(this.columnType(c));
      if (c.primaryKey) parts.push('PRIMARY KEY');
    }
    if (c.notNull && !c.primaryKey) parts.push('NOT NULL');
    if (c.unique && !c.primaryKey) parts.push('UNIQUE');
    if (c.default !== undefined) {
      const d = c.default;
      const value = /^-?\d+(\.\d+)?$/.test(d) || DEFAULT_KEYWORDS.has(d.toLowerCase()) ? d.toUpperCase() : this.str(d.replace(/^'(.*)'$/, '$1'));
      parts.push(`DEFAULT ${value}`);
    }
    return parts.join(' ');
  }

  stmt(s: SqlStmt): void {
    const em = this.em;
    const start = em.count;
    switch (s.k) {
      case 'createTable': {
        if (!s.columns.length) this.report('error', 'sql.noColumns', `The table "${s.name}" needs at least one column.`, s.id, { name: s.name });
        if (s.columns.filter((c) => c.primaryKey).length > 1) this.report('error', 'sql.multiplePrimaryKeys', `The table "${s.name}" marks more than one column as primary key.`, s.id, { name: s.name });
        const names = new Set<string>();
        for (const c of s.columns) {
          if (names.has(c.name.toLowerCase())) this.report('error', 'sql.duplicateColumn', `The column "${c.name}" appears twice.`, c.id, { name: c.name });
          names.add(c.name.toLowerCase());
        }
        em.line(`CREATE TABLE ${s.ifNotExists ? 'IF NOT EXISTS ' : ''}${this.ident(s.name, s.id)} (`);
        em.indent();
        s.columns.forEach((c, i) => {
          const cs = em.count;
          em.line(this.column(c) + (i < s.columns.length - 1 ? ',' : ''));
          em.mark(c.id, cs);
        });
        em.dedent();
        em.line(');');
        break;
      }
      case 'dropTable':
        em.line(`DROP TABLE ${s.ifExists ? 'IF EXISTS ' : ''}${this.ident(s.name, s.id)};`);
        break;
      case 'addColumn':
        em.line(`ALTER TABLE ${this.ident(s.table, s.id)} ADD COLUMN ${this.column(s.column)};`);
        break;
      case 'createIndex':
        em.line(`CREATE ${s.unique ? 'UNIQUE ' : ''}INDEX ${this.ident(s.name, s.id)} ON ${this.ident(s.table, s.id)} (${this.list(s.columns, s.id)});`);
        break;
      case 'insert':
        if (s.columns.length !== s.values.length) {
          this.report('error', 'sql.valueCount', `INSERT lists ${s.columns.length} column(s) but ${s.values.length} value(s).`, s.id, { columns: s.columns.length, values: s.values.length });
        }
        em.line(`INSERT INTO ${this.ident(s.table, s.id)} (${s.columns.map((c) => this.ident(c, s.id)).join(', ')})`);
        em.line(`VALUES (${s.values.map((v) => this.expr(v)).join(', ')});`);
        break;
      case 'select':
        this.select(s);
        break;
      case 'update':
        if (!s.sets.length) this.report('error', 'sql.noSet', 'UPDATE needs at least one column to set.', s.id);
        if (!s.where) this.report('warning', 'sql.updateAll', `This UPDATE has no WHERE, so it changes every row of "${s.table}".`, s.id, { table: s.table });
        em.line(`UPDATE ${this.ident(s.table, s.id)}`);
        em.line(`SET ${s.sets.map((x) => `${this.ident(x.column, x.id)} = ${this.expr(x.value)}`).join(', ')}${s.where ? '' : ';'}`);
        if (s.where) em.line(`WHERE ${this.expr(s.where)};`);
        break;
      case 'delete':
        if (!s.where) this.report('warning', 'sql.deleteAll', `This DELETE has no WHERE, so it removes every row of "${s.table}".`, s.id, { table: s.table });
        em.line(`DELETE FROM ${this.ident(s.table, s.id)}${s.where ? '' : ';'}`);
        if (s.where) em.line(`WHERE ${this.expr(s.where)};`);
        break;
      case 'txn':
        em.line(this.dialect === 'mysql' && s.action === 'BEGIN' ? 'START TRANSACTION;' : `${s.action};`);
        break;
      case 'comment':
        for (const l of s.text.split('\n')) em.line(`-- ${l}`.trimEnd());
        break;
      case 'raw':
        for (const l of s.code.split('\n')) em.line(l);
        break;
    }
    em.mark(s.id, start);
  }

  private select(s: Extract<SqlStmt, { k: 'select' }>): void {
    const em = this.em;
    const pick = <K extends SqlClause['k']>(k: K) => s.clauses.filter((c): c is Extract<SqlClause, { k: K }> => c.k === k);
    for (const k of ['where', 'groupBy', 'having', 'limit'] as const) {
      const hits = pick(k);
      if (hits.length > 1) this.report('error', 'sql.duplicateClause', `A query can only have one ${k === 'groupBy' ? 'GROUP BY' : k.toUpperCase()} clause.`, hits[1].id, { clause: k });
    }
    if (pick('having').length && !pick('groupBy').length) this.report('warning', 'sql.havingWithoutGroup', 'HAVING is normally used together with GROUP BY.', pick('having')[0].id);
    em.line(`SELECT ${s.distinct ? 'DISTINCT ' : ''}${s.columns.map((c) => this.expr(c)).join(', ')}`);
    em.line(`FROM ${this.ident(s.from, s.id)}`);
    const clause = (id: string | undefined, text: string) => {
      const start = em.count;
      em.line(text);
      em.mark(id, start);
    };
    for (const j of pick('join')) {
      if (this.dialect === 'mysql' && j.type === 'FULL') this.report('error', 'sql.fullJoin', 'MySQL has no FULL JOIN.', j.id);
      clause(j.id, j.type === 'CROSS' ? `CROSS JOIN ${this.ident(j.table, j.id)}` : `${j.type} JOIN ${this.ident(j.table, j.id)} ON ${this.expr(j.on)}`);
    }
    const where = pick('where')[0];
    if (where) clause(where.id, `WHERE ${this.expr(where.cond)}`);
    const group = pick('groupBy')[0];
    if (group) clause(group.id, `GROUP BY ${this.list(group.columns, group.id)}`);
    const having = pick('having')[0];
    if (having) clause(having.id, `HAVING ${this.expr(having.cond)}`);
    const orders = pick('orderBy');
    if (orders.length) {
      const start = em.count;
      em.line(`ORDER BY ${orders.map((o) => `${this.ident(o.column, o.id)}${o.dir === 'DESC' ? ' DESC' : ''}`).join(', ')}`);
      for (const o of orders) em.mark(o.id, start);
    }
    const limit = pick('limit')[0];
    if (limit) clause(limit.id, `LIMIT ${limit.count}${limit.offset ? ` OFFSET ${limit.offset}` : ''}`);
    em.lines[em.lines.length - 1] += ';';
  }
}

export const sqlGenerator = {
  generate(program: SqlProgram, opts: GenOptions = {}): GenResult {
    const dialect = opts.sqlDialect ?? 'sqlite';
    const w = new SqlWriter(dialect, opts.indent ?? 2);
    if (!program.statements.length) w.report('warning', 'sql.empty', 'There are no SQL statements yet.');
    program.statements.forEach((s, i) => {
      if (i && s.k !== 'comment') w.em.blank();
      w.stmt(s);
    });
    const file = opts.baseName ? `${opts.baseName}.sql` : 'query.sql';
    return {
      language: 'sql',
      files: [{ path: file, content: w.em.toString(), role: 'main' }],
      mappings: w.em.mappings(file),
      dependencies: [],
      diagnostics: w.diags,
      meta: { entryFile: file, languageName: 'SQL', variant: dialect, features: [] },
      requirements: { toolchains: dialect === 'sqlite' ? ['sqlite3'] : [], notes: dialect === 'sqlite' ? [] : [`Statements use the ${dialect} dialect; the built-in runner executes SQLite only.`] },
    };
  },
};

export default sqlGenerator;
