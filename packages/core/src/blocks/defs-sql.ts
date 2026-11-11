import { type BlockDef, C, D, Nu, S, Tx, V } from './schema';

const COL_TYPES = ['INTEGER', 'REAL', 'TEXT', 'BLOB', 'NUMERIC', 'BOOLEAN', 'DATE', 'DATETIME'];
const SQLX = ['SqlExpr', 'Boolean', 'Number', 'String'];

const stmt = (d: Omit<BlockDef, 'domain' | 'prev' | 'style'> & { style?: string }): BlockDef => ({ domain: 'sql', prev: 'SqlStmt', style: 'sql_blocks', ...d });
const clause = (d: Omit<BlockDef, 'domain' | 'prev' | 'style' | 'category'>): BlockDef => ({ domain: 'sql', prev: 'SqlClause', style: 'sql_clause_blocks', category: 'sqlquery', ...d });
const expr = (d: Omit<BlockDef, 'domain' | 'style' | 'category' | 'output'>): BlockDef => ({ domain: 'sql', style: 'sql_expr_blocks', category: 'sqlexpr', output: SQLX, inline: true, ...d });

export const SQL_BLOCKS: BlockDef[] = [
  stmt({ type: 'sql_create_table', category: 'sqlschema', rows: [['CREATE TABLE %1 if not exists %2', Tx('NAME', 'users'), C('IFNE', true)], ['%1', S('COLUMNS', 'SqlColumn')]] }),
  { type: 'sql_column', domain: 'sql', category: 'sqlschema', style: 'sql_clause_blocks', prev: 'SqlColumn', rows: [['column %1 %2 primary key %3 auto increment %4 not null %5 unique %6 default %7', Tx('NAME', 'id'), D('TYPE', ...COL_TYPES), C('PK'), C('AI'), C('NN'), C('UQ'), Tx('DEFAULT', '')]] },
  stmt({ type: 'sql_drop_table', category: 'sqlschema', rows: [['DROP TABLE %1 if exists %2', Tx('NAME', 'users'), C('IFE', true)]] }),
  stmt({ type: 'sql_add_column', category: 'sqlschema', rows: [['ALTER TABLE %1 ADD COLUMN %2 %3', Tx('TABLE', 'users'), Tx('NAME', 'email'), D('TYPE', ...COL_TYPES)]] }),
  stmt({ type: 'sql_create_index', category: 'sqlschema', rows: [['CREATE INDEX %1 ON %2 ( %3 ) unique %4', Tx('NAME', 'idx_users_name'), Tx('TABLE', 'users'), Tx('COLUMNS', 'name'), C('UNIQUE')]] }),

  stmt({ type: 'sql_insert', category: 'sqldata', rows: [['INSERT INTO %1 ( %2 ) VALUES %3', Tx('TABLE', 'users'), Tx('COLUMNS', 'name, age'), V('VALUES', 'Array')]], inline: true }),
  stmt({ type: 'sql_update', category: 'sqldata', rows: [['UPDATE %1', Tx('TABLE', 'users')], ['SET %1', S('SETS', 'SqlSet')], ['WHERE %1', V('WHERE')]] }),
  { type: 'sql_set', domain: 'sql', category: 'sqldata', style: 'sql_clause_blocks', prev: 'SqlSet', inline: true, rows: [['%1 = %2', Tx('COLUMN', 'age'), V('VALUE')]] },
  stmt({ type: 'sql_delete', category: 'sqldata', rows: [['DELETE FROM %1 WHERE %2', Tx('TABLE', 'users'), V('WHERE')]], inline: true }),
  stmt({ type: 'sql_txn', category: 'sqldata', rows: [['%1 transaction', D('ACTION', 'BEGIN', 'COMMIT', 'ROLLBACK')]] }),

  stmt({ type: 'sql_select', category: 'sqlquery', rows: [['SELECT %1 distinct %2 FROM %3', V('COLUMNS'), C('DISTINCT'), Tx('FROM', 'users')], ['%1', S('CLAUSES', 'SqlClause')]], inline: true, tip: 'Leave the column slot empty to select every column.' }),
  clause({ type: 'sql_join', rows: [['%1 JOIN %2 ON %3', D('TYPE', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'), Tx('TABLE', 'orders'), V('ON')]], inline: true }),
  clause({ type: 'sql_where', rows: [['WHERE %1', V('COND')]], inline: true }),
  clause({ type: 'sql_group_by', rows: [['GROUP BY %1', Tx('COLUMNS', 'name')]] }),
  clause({ type: 'sql_having', rows: [['HAVING %1', V('COND')]], inline: true }),
  clause({ type: 'sql_order_by', rows: [['ORDER BY %1 %2', Tx('COLUMN', 'name'), D('DIR', 'ASC', 'DESC')]] }),
  clause({ type: 'sql_limit', rows: [['LIMIT %1 OFFSET %2', Nu('COUNT', 10, { min: 0, int: true }), Nu('OFFSET', 0, { min: 0, int: true })]] }),

  expr({ type: 'sql_col', rows: [['column %1', Tx('NAME', 'name')]] }),
  expr({ type: 'sql_star', rows: [['all columns *']] }),
  expr({ type: 'sql_func', rows: [['%1 ( %2 ) distinct %3', D('FN', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'UPPER', 'LOWER', 'LENGTH', 'ABS', 'ROUND'), V('ARG'), C('DISTINCT')]] }),
  expr({ type: 'sql_like', rows: [['%1 LIKE %2', V('VALUE'), V('PATTERN')]] }),
  expr({ type: 'sql_in', rows: [['%1 IN %2', V('VALUE'), V('ITEMS', 'Array')]] }),
  expr({ type: 'sql_is_null', rows: [['%1 %2', V('VALUE'), D('MODE', ['IS NULL', 'null'], ['IS NOT NULL', 'notnull'])]] }),
  expr({ type: 'sql_between', rows: [['%1 BETWEEN %2 AND %3', V('VALUE'), V('LOW'), V('HIGH')]] }),
  expr({ type: 'sql_alias', rows: [['%1 AS %2', V('VALUE'), Tx('NAME', 'total')]] }),

  stmt({ type: 'sql_comment', category: 'sqldata', style: 'raw_blocks', rows: [['comment %1', Tx('TEXT', 'note')]] }),
  stmt({ type: 'sql_raw', category: 'sqldata', style: 'raw_blocks', rows: [['SQL %1', Tx('CODE', '')]], tip: 'Inserted verbatim.' }),
];
