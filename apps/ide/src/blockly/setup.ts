import { BLOCKS, type BlockMessages, CUSTOM_BLOCK_DEFS, STANDARD_STATEMENT_TYPES, toBlocklyJson } from '@blockforge/core';
import * as Blockly from 'blockly/core';
import * as libraryBlocks from 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { getBundle, type LocaleId, LOCALES, t } from '../i18n';
import { promptDialog, confirmDialog, useUi } from '../state/ui';

void libraryBlocks;

const STYLE_COLOURS: Record<string, string> = {
  logic_blocks: '#5B80D6',
  loop_blocks: '#3FA37C',
  math_blocks: '#6C6FD9',
  text_blocks: '#C98A3A',
  list_blocks: '#C2577B',
  variable_blocks: '#D0703C',
  variable_dynamic_blocks: '#D0703C',
  procedure_blocks: '#8A5CD0',
  colour_blocks: '#A5745B',
  start_blocks: '#3A3D44',
  map_blocks: '#B0683F',
  error_blocks: '#D05656',
  file_blocks: '#5E8C99',
  class_blocks: '#4D9DB5',
  async_blocks: '#7B8794',
  net_blocks: '#3F8FCF',
  sys_blocks: '#6B7280',
  mem_blocks: '#9B6B4F',
  web_blocks: '#D2603A',
  css_blocks: '#3B8FD9',
  sql_blocks: '#2E86AB',
  sql_clause_blocks: '#4FA3A5',
  sql_expr_blocks: '#6B8FB5',
  asm_blocks: '#5B6472',
  asm_a64_blocks: '#2F9E83',
  asm_x64_blocks: '#B5653C',
  raw_blocks: '#8B8F96',
};

const CATEGORY_COLOURS: Record<string, string> = {
  start_category: '#3A3D44',
  logic_category: '#5B80D6',
  loop_category: '#3FA37C',
  math_category: '#6C6FD9',
  text_category: '#C98A3A',
  list_category: '#C2577B',
  map_category: '#B0683F',
  variable_category: '#D0703C',
  procedure_category: '#8A5CD0',
  io_category: '#C98A3A',
  error_category: '#D05656',
  file_category: '#5E8C99',
  class_category: '#4D9DB5',
  async_category: '#7B8794',
  net_category: '#3F8FCF',
  sys_category: '#6B7280',
  mem_category: '#9B6B4F',
  web_category: '#D2603A',
  layout_category: '#7A62C9',
  css_category: '#3B8FD9',
  sql_category: '#2E86AB',
  sql_expr_category: '#6B8FB5',
  asm_category: '#5B6472',
  asm_a64_category: '#2F9E83',
  asm_x64_category: '#B5653C',
  raw_category: '#8B8F96',
  favorite_category: '#D4A72C',
  custom_category: '#8A5CD0',
  search_category: '#8B8F96',
};

const fontStyle = { family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'PingFang SC', 'Hiragino Kaku Gothic ProN', sans-serif", weight: '500', size: 11 };
const blockStyles = Object.fromEntries(Object.entries(STYLE_COLOURS).map(([k, c]) => [k, { colourPrimary: c }]));
const categoryStyles = Object.fromEntries(Object.entries(CATEGORY_COLOURS).map(([k, c]) => [k, { colour: c }]));

export const themes = {
  light: Blockly.Theme.defineTheme('bf-light', {
    name: 'bf-light',
    base: Blockly.Themes.Classic,
    blockStyles,
    categoryStyles,
    fontStyle,
    startHats: true,
    componentStyles: { workspaceBackgroundColour: '#ffffff', toolboxBackgroundColour: '#f9fafb', toolboxForegroundColour: '#0f1115', flyoutBackgroundColour: '#f9fafb', flyoutForegroundColour: '#61666b', flyoutOpacity: 0.97, scrollbarColour: '#c8ccd1', scrollbarOpacity: 0.6, insertionMarkerColour: '#0f1115', insertionMarkerOpacity: 0.25, cursorColour: '#4176e6' },
  }),
  dark: Blockly.Theme.defineTheme('bf-dark', {
    name: 'bf-dark',
    base: Blockly.Themes.Classic,
    blockStyles,
    categoryStyles,
    fontStyle,
    startHats: true,
    componentStyles: { workspaceBackgroundColour: '#151517', toolboxBackgroundColour: '#1b1b1c', toolboxForegroundColour: '#f9fafb', flyoutBackgroundColour: '#1b1b1c', flyoutForegroundColour: '#cfd3d6', flyoutOpacity: 0.97, scrollbarColour: '#5a5d63', scrollbarOpacity: 0.6, insertionMarkerColour: '#ffffff', insertionMarkerOpacity: 0.3, cursorColour: '#7aaaff' },
  }),
};

/** Toolbox rows show a small colour dot instead of Blockly's coloured border. */
class DotCategory extends Blockly.ToolboxCategory {
  protected override addColourBorder_(colour: string): void {
    this.rowDiv_?.style.setProperty('--cat', colour);
    this.rowDiv_?.classList.add('bf-cat-row');
  }

  override setSelected(isSelected: boolean): void {
    if (!this.rowDiv_) return;
    this.rowDiv_.classList.toggle('blocklyToolboxSelected', isSelected);
    this.rowDiv_.setAttribute('aria-selected', String(isSelected));
  }
}

let registered = false;
let blocksLocale: string | undefined;

function patchStandardChecks(): void {
  // Built-in statement blocks accept any neighbour; narrow them so they cannot be
  // dropped into HTML, CSS, SQL or assembly containers.
  for (const type of STANDARD_STATEMENT_TYPES) {
    const def = Blockly.Blocks[type];
    if (!def || def.__bfPatched) continue;
    const init = def.init;
    def.init = function (this: Blockly.Block) {
      init.call(this);
      if (this.previousConnection) this.setPreviousStatement(true, 'Stmt');
      if (this.nextConnection) this.setNextStatement(true, 'Stmt');
      for (const input of this.inputList) {
        if (input.connection && input.type === Blockly.inputs.inputTypes.STATEMENT) input.setCheck('Stmt');
      }
    };
    // Mutators rebuild inputs, so the checks are reapplied afterwards.
    const rebuild = def.rebuildShape_ ?? def.updateShape_;
    if (rebuild) {
      const key = def.rebuildShape_ ? 'rebuildShape_' : 'updateShape_';
      def[key] = function (this: Blockly.Block, ...args: unknown[]) {
        rebuild.apply(this, args);
        for (const input of this.inputList) {
          if (input.connection && input.type === Blockly.inputs.inputTypes.STATEMENT) input.setCheck('Stmt');
        }
      };
    }
    def.__bfPatched = true;
  }
}

/** Define (or redefine, after a language change) every custom block. */
function defineCustomBlocks(messages: Record<string, BlockMessages>): void {
  for (const def of CUSTOM_BLOCK_DEFS) delete Blockly.Blocks[def.type];
  Blockly.common.defineBlocksWithJsonArray(CUSTOM_BLOCK_DEFS.map((def) => toBlocklyJson(def, messages[def.type])));
}

export async function setupBlockly(locale: LocaleId): Promise<void> {
  if (!registered) {
    registered = true;
    Blockly.registry.register(Blockly.registry.Type.TOOLBOX_ITEM, Blockly.ToolboxCategory.registrationName, DotCategory, true);
    patchStandardChecks();
    // Native prompt/confirm do not exist in the desktop web view, so dialogs are in-app.
    Blockly.dialog.setPrompt((message, defaultValue, callback) => {
      void promptDialog({ title: message, message: '', value: defaultValue }).then((v) => callback(v ?? null));
    });
    Blockly.dialog.setConfirm((message, callback) => {
      void confirmDialog({ title: message, message: '' }).then(callback);
    });
    Blockly.dialog.setAlert((message, callback) => {
      useUi.getState().toast(message, 'info');
      callback?.();
    });
  }
  if (blocksLocale === locale) return;
  const code = LOCALES.find((l) => l.id === locale)?.blockly ?? 'en';
  let msg: Record<string, string> = En as unknown as Record<string, string>;
  if (code !== 'en') {
    const mod = code === 'ko' ? await import('blockly/msg/ko') : code === 'ja' ? await import('blockly/msg/ja') : code === 'zh-hans' ? await import('blockly/msg/zh-hans') : await import('blockly/msg/zh-hant');
    msg = { ...(En as unknown as Record<string, string>), ...(mod as unknown as Record<string, string>) };
  }
  Blockly.setLocale(msg as unknown as { [key: string]: string });
  defineCustomBlocks(getBundle().blocks);
  blocksLocale = locale;
}

/** Plain text of a block's label, used by block search. */
export function blockSearchText(type: string): string {
  const custom = CUSTOM_BLOCK_DEFS.find((d) => d.type === type);
  if (custom) {
    const rows = getBundle().blocks[type]?.rows ?? custom.rows.map((r) => r[0]);
    return `${rows.join(' ').replace(/%\d+/g, ' ')} ${custom.rows.map((r) => r[0]).join(' ').replace(/%\d+/g, ' ')} ${type}`.toLowerCase();
  }
  const key = (name: string) => (Blockly.Msg[name] ?? '').replace(/%\d+/g, ' ');
  const hints: Record<string, string[]> = {
    controls_if: ['CONTROLS_IF_MSG_IF', 'CONTROLS_IF_MSG_ELSE'],
    controls_repeat_ext: ['CONTROLS_REPEAT_TITLE'],
    controls_whileUntil: ['CONTROLS_WHILEUNTIL_OPERATOR_WHILE', 'CONTROLS_WHILEUNTIL_OPERATOR_UNTIL'],
    controls_for: ['CONTROLS_FOR_TITLE'],
    controls_forEach: ['CONTROLS_FOREACH_TITLE'],
    controls_flow_statements: ['CONTROLS_FLOW_STATEMENTS_OPERATOR_BREAK', 'CONTROLS_FLOW_STATEMENTS_OPERATOR_CONTINUE'],
    text_print: ['TEXT_PRINT_TITLE'],
    text_prompt_ext: ['TEXT_PROMPT_TYPE_TEXT', 'TEXT_PROMPT_TYPE_NUMBER'],
    text_join: ['TEXT_JOIN_TITLE_CREATEWITH'],
    text_length: ['TEXT_LENGTH_TITLE'],
    lists_create_with: ['LISTS_CREATE_WITH_INPUT_WITH'],
    lists_length: ['LISTS_LENGTH_TITLE'],
    logic_boolean: ['LOGIC_BOOLEAN_TRUE', 'LOGIC_BOOLEAN_FALSE'],
    logic_null: ['LOGIC_NULL'],
    logic_negate: ['LOGIC_NEGATE_TITLE'],
    logic_operation: ['LOGIC_OPERATION_AND', 'LOGIC_OPERATION_OR'],
    logic_ternary: ['LOGIC_TERNARY_CONDITION'],
    math_modulo: ['MATH_MODULO_TITLE'],
    math_random_int: ['MATH_RANDOM_INT_TITLE'],
    math_single: ['MATH_SINGLE_OP_ROOT', 'MATH_SINGLE_OP_ABSOLUTE'],
    math_round: ['MATH_ROUND_OPERATOR_ROUND'],
    variables_set: ['VARIABLES_SET'],
    math_change: ['MATH_CHANGE_TITLE'],
  };
  return `${(hints[type] ?? []).map(key).join(' ')} ${BLOCKS[type]?.summary ?? ''} ${type}`.toLowerCase();
}

export function categoryLabel(id: string): string {
  return t(`cat.${id}`);
}

export { Blockly, CATEGORY_COLOURS };
