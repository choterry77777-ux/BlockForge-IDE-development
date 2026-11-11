import * as b from '../blocks/dsl';
import type { BlockSpec, WorkspaceState } from '../blocks/state';
import type { Example } from './imperative';

const ws = (...stacks: BlockSpec[][]): WorkspaceState => b.workspace(...stacks);
const decl = (prop: string, value: string): BlockSpec => ({ type: 'css_decl', fields: { PROP: prop, VALUE: value } });
const color = (prop: string, value: string): BlockSpec => ({ type: 'css_color', fields: { PROP: prop, VALUE: value } });
const size = (prop: string, value: number, unit = 'px'): BlockSpec => ({ type: 'css_size', fields: { PROP: prop, VALUE: value, UNIT: unit } });
const rule = (selector: string, decls: BlockSpec[]): BlockSpec => ({ type: 'css_rule', fields: { SELECTOR: selector }, statements: { DECLS: decls } });
const el = (tag: string, children: BlockSpec[], id = '', cls = ''): BlockSpec => ({ type: 'web_element', fields: { TAG: tag, ID: id, CLASS: cls }, statements: { CHILDREN: children } });
const txt = (tag: string, text: string, id = '', cls = ''): BlockSpec => ({ type: 'web_text_element', fields: { TAG: tag, TEXT: text, ID: id, CLASS: cls } });

const PAGE_STYLES: BlockSpec[] = [
  rule('body', [{ type: 'css_font', fields: { FAMILY: 'system-ui, sans-serif', WEIGHT: '400' } }, size('margin', 0), color('background-color', '#f9fafb'), color('color', '#0f1115')]),
  rule('.page', [size('max-width', 720), decl('margin', '0 auto'), size('padding', 24)]),
  rule('.card', [color('background-color', '#ffffff'), { type: 'css_border', fields: { WIDTH: 1, STYLE: 'solid', COLOR: '#e5e7eb' } }, size('border-radius', 16), size('padding', 16)]),
  rule('button', [size('padding', 8), size('border-radius', 12), color('background-color', '#0f1115'), color('color', '#f9fafb'), decl('border', 'none'), decl('cursor', 'pointer')]),
  { type: 'css_media', fields: { COND: 'max-width', VALUE: 600 }, statements: { RULES: [rule('.cards', [{ type: 'css_flex', fields: { DIR: 'column', JUSTIFY: 'flex-start', ALIGN: 'stretch', WRAP: false } }])] } },
];

export const WEB_EXAMPLES: Example[] = [
  {
    id: 'html-page',
    title: 'Interactive page',
    description: 'A page with a flex layout, styles and a click counter.',
    build: () =>
      ws([
        {
          type: 'web_document',
          fields: { TITLE: 'Counter', LANG: 'en' },
          statements: {
            BODY: [
              el(
                'main',
                [
                  txt('h1', 'Click counter'),
                  {
                    type: 'web_flex',
                    fields: { DIR: 'row', JUSTIFY: 'flex-start', ALIGN: 'center', GAP: 12, WRAP: true },
                    statements: { CHILDREN: [el('div', [txt('p', 'Clicks: 0', 'output')], '', 'card'), { type: 'web_button', fields: { TEXT: 'Add one', ID: 'add', CLASS: '' } }] },
                  },
                ],
                '',
                'page',
              ),
            ],
            STYLE: PAGE_STYLES,
            SCRIPT: [
              b.setv('clicks', b.num(0)),
              {
                type: 'bf_dom_on',
                fields: { ID: 'add', EVENT: 'click' },
                statements: { DO: [b.change('clicks', b.num(1)), { type: 'bf_dom_set', fields: { ID: 'output', WHAT: 'text' }, inputs: { VALUE: b.join(b.text('Clicks: '), b.getv('clicks')) } }] },
              },
            ],
          },
        },
      ]),
  },
];

export const CSS_EXAMPLES: Example[] = [
  {
    id: 'css-card',
    title: 'Responsive card styles',
    description: 'Rules, Flexbox, Grid and a media query.',
    build: () =>
      ws([
        ...PAGE_STYLES,
        rule('.gallery', [{ type: 'css_grid', fields: { COLUMNS: 'repeat(3, 1fr)', ROWS: '', GAP: 16 } }]),
        rule('.title', [size('font-size', 2, 'rem'), { type: 'css_text_align', fields: { VALUE: 'center' } }]),
      ]),
  },
];

const col = (name: string, type: string, flags: Partial<Record<'PK' | 'AI' | 'NN' | 'UQ', boolean>> = {}, def = ''): BlockSpec => ({ type: 'sql_column', fields: { NAME: name, TYPE: type, PK: !!flags.PK, AI: !!flags.AI, NN: !!flags.NN, UQ: !!flags.UQ, DEFAULT: def } });
const insert = (table: string, columns: string, ...values: BlockSpec[]): BlockSpec => ({ type: 'sql_insert', fields: { TABLE: table, COLUMNS: columns }, inputs: { VALUES: b.list(...values) } });
const sqlCol = (name: string): BlockSpec => ({ type: 'sql_col', fields: { NAME: name } });

export const SQL_EXAMPLES: Example[] = [
  {
    id: 'sql-shop',
    title: 'Shop database',
    description: 'Create tables, add rows and query them with a join.',
    build: () =>
      ws([
        { type: 'sql_drop_table', fields: { NAME: 'orders', IFE: true } },
        { type: 'sql_drop_table', fields: { NAME: 'customers', IFE: true } },
        { type: 'sql_create_table', fields: { NAME: 'customers', IFNE: true }, statements: { COLUMNS: [col('id', 'INTEGER', { PK: true, AI: true }), col('name', 'TEXT', { NN: true }), col('city', 'TEXT', {}, 'Seoul')] } },
        { type: 'sql_create_table', fields: { NAME: 'orders', IFNE: true }, statements: { COLUMNS: [col('id', 'INTEGER', { PK: true, AI: true }), col('customer_id', 'INTEGER', { NN: true }), col('total', 'REAL', { NN: true })] } },
        insert('customers', 'name, city', b.text('Ada'), b.text('London')),
        insert('customers', 'name, city', b.text('Min'), b.text('Seoul')),
        insert('orders', 'customer_id, total', b.num(1), b.num(19.5)),
        insert('orders', 'customer_id, total', b.num(1), b.num(5.5)),
        insert('orders', 'customer_id, total', b.num(2), b.num(42)),
        { type: 'sql_update', fields: { TABLE: 'orders' }, statements: { SETS: [{ type: 'sql_set', fields: { COLUMN: 'total' }, inputs: { VALUE: b.num(40) } }] }, inputs: { WHERE: b.cmp('EQ', sqlCol('id'), b.num(3)) } },
        {
          type: 'sql_select',
          fields: { DISTINCT: false, FROM: 'customers' },
          inputs: { COLUMNS: b.list(sqlCol('customers.name'), { type: 'sql_alias', fields: { NAME: 'spent' }, inputs: { VALUE: { type: 'sql_func', fields: { FN: 'SUM', DISTINCT: false }, inputs: { ARG: sqlCol('orders.total') } } } }) },
          statements: {
            CLAUSES: [
              { type: 'sql_join', fields: { TYPE: 'INNER', TABLE: 'orders' }, inputs: { ON: b.cmp('EQ', sqlCol('orders.customer_id'), sqlCol('customers.id')) } },
              { type: 'sql_where', inputs: { COND: b.cmp('GT', sqlCol('orders.total'), b.num(1)) } },
              { type: 'sql_group_by', fields: { COLUMNS: 'customers.name' } },
              { type: 'sql_order_by', fields: { COLUMN: 'spent', DIR: 'DESC' } },
              { type: 'sql_limit', fields: { COUNT: 10, OFFSET: 0 } },
            ],
          },
        },
      ]),
    expected: 'Min|40.0\nAda|25.0\n',
  },
];

const asmProgram = (arch: string, body: BlockSpec[]): BlockSpec[] => [{ type: 'asm_program', fields: { ARCH: arch, PLATFORM: 'macos' }, statements: { BODY: body } }];
const i = (type: string, fields: Record<string, string | number | boolean> = {}): BlockSpec => ({ type, fields });

export const ASM_EXAMPLES: Example[] = [
  {
    id: 'asm-hello-arm64',
    title: 'Hello (ARM64)',
    description: 'Write text with a system call.',
    build: () => ws(asmProgram('arm64', [i('asm_print_text', { TEXT: 'Hello from ARM64', NEWLINE: true }), i('asm_exit', { CODE: 0 })])),
    expected: 'Hello from ARM64\n',
  },
  {
    id: 'asm-sum-arm64',
    title: 'Sum 1 to 10 (ARM64)',
    description: 'A loop with compare and branch, printing the result.',
    build: () =>
      ws(
        asmProgram('arm64', [
          i('asm_comment', { TEXT: 'x19 = total, x20 = counter' }),
          i('a64_mov_imm', { DST: 'x19', IMM: 0 }),
          i('a64_mov_imm', { DST: 'x20', IMM: 1 }),
          i('asm_label', { NAME: 'loop' }),
          i('a64_arith', { DST: 'x19', A: 'x19', OP: 'add', B: 'x20' }),
          i('a64_arith_imm', { DST: 'x20', A: 'x20', OP: 'add', IMM: 1 }),
          i('a64_cmp_imm', { A: 'x20', IMM: 10 }),
          i('a64_branch', { COND: 'b.le', LABEL: 'loop' }),
          i('a64_print_reg', { REG: 'x19' }),
          i('a64_call', { LABEL: 'show_big' }),
          i('asm_exit', { CODE: 0 }),
        ]),
        [
          {
            type: 'asm_routine',
            fields: { NAME: 'show_big' },
            statements: { BODY: [i('a64_save_lr', { MODE: 'save' }), i('a64_mov_imm', { DST: 'x0', IMM: -1234567890123 }), i('a64_print_reg', { REG: 'x0' }), i('a64_save_lr', { MODE: 'restore' }), i('a64_ret')] },
          },
        ],
      ),
    expected: '55\n-1234567890123\n',
  },
  {
    id: 'asm-hello-x64',
    title: 'Hello (x86-64)',
    description: 'Write text with a system call.',
    build: () => ws(asmProgram('x86_64', [i('asm_print_text', { TEXT: 'Hello from x86-64', NEWLINE: true }), i('asm_exit', { CODE: 0 })])),
    expected: 'Hello from x86-64\n',
  },
  {
    id: 'asm-sum-x64',
    title: 'Sum 1 to 10 (x86-64)',
    description: 'A loop with compare and jump, printing the result.',
    build: () =>
      ws(
        asmProgram('x86_64', [
          i('asm_comment', { TEXT: 'rbx = total, r12 = counter' }),
          i('x64_mov_imm', { DST: 'rbx', IMM: 0 }),
          i('x64_mov_imm', { DST: 'r12', IMM: 1 }),
          i('asm_label', { NAME: 'loop' }),
          i('x64_arith', { DST: 'rbx', OP: 'add', SRC: 'r12' }),
          i('x64_incdec', { REG: 'r12', OP: 'inc' }),
          i('x64_cmp_imm', { A: 'r12', IMM: 10 }),
          i('x64_jump', { COND: 'jle', LABEL: 'loop' }),
          i('x64_print_reg', { REG: 'rbx' }),
          i('x64_mov_imm', { DST: 'rax', IMM: -42 }),
          i('x64_print_reg', { REG: 'rax' }),
          i('asm_exit', { CODE: 0 }),
        ]),
      ),
    expected: '55\n-42\n',
  },
];
