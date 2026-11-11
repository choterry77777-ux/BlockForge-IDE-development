import { type BlockDef, C, D, Nu, S, Tx, V, Vr } from './schema';

const TYPES: [string, string][] = [
  ['auto', 'auto'],
  ['integer', 'int'],
  ['decimal', 'float'],
  ['text', 'string'],
  ['true/false', 'bool'],
];
const VALUE_TYPES = TYPES.slice(1);
const RET_TYPES: [string, string][] = [['nothing', 'void'], ...VALUE_TYPES];
const RAW_LANGS = ['python', 'javascript', 'typescript', 'c', 'cpp', 'java', 'csharp', 'lua', 'php', 'go', 'rust', 'dart', 'ruby', 'kotlin', 'bash'];
const POINTER_LANGS = ['c', 'cpp', 'go', 'rust'] as const;
const DOM_LANGS = ['javascript', 'typescript', 'html'] as const;

const st = (d: Omit<BlockDef, 'domain' | 'prev'> & { prev?: string }): BlockDef => ({ domain: 'imperative', prev: 'Stmt', ...d });
const ex = (d: Omit<BlockDef, 'domain'>): BlockDef => ({ domain: 'imperative', inline: true, ...d });

export const IMPERATIVE_BLOCKS: BlockDef[] = [
  // ----- program entry -----
  { type: 'bf_start', domain: 'imperative', category: 'start', style: 'start_blocks', rows: [['when program starts']], next: 'Stmt', hat: true, tip: 'Blocks attached below run when the program starts.' },

  // ----- variables -----
  st({ type: 'bf_var_declare', category: 'variables', style: 'variable_blocks', rows: [['declare %1 as %2 = %3 constant %4', Vr('VAR', 'x'), D('TYPE', ...TYPES), V('VALUE'), C('CONST')]], inline: true, tip: 'Declare a variable with an explicit type. Tick constant to forbid reassignment.', feature: 'typedDecl' }),
  st({ type: 'bf_return', category: 'functions', style: 'procedure_blocks', rows: [['return %1', V('VALUE')]], next: false, inline: true, tip: 'Return from the current function, optionally with a value.' }),

  // ----- comments / raw -----
  st({ type: 'bf_comment', category: 'io', style: 'raw_blocks', rows: [['comment %1', Tx('TEXT', 'note')]], feature: 'comments' }),
  st({ type: 'bf_raw_stmt', category: 'raw', style: 'raw_blocks', rows: [['%1 code %2', D('LANG', ...RAW_LANGS), Tx('CODE', '')]], tip: 'Inserted verbatim, only when the target language matches.', feature: 'raw' }),
  ex({ type: 'bf_raw_expr', category: 'raw', style: 'raw_blocks', rows: [['%1 expression %2', D('LANG', ...RAW_LANGS), Tx('CODE', '')]], output: null, feature: 'raw' }),

  // ----- conversions / text / math -----
  ex({ type: 'bf_convert', category: 'convert', style: 'math_blocks', rows: [['convert %1 to %2', V('VALUE'), D('TO', ...VALUE_TYPES)]], output: null, feature: 'convert' }),
  ex({ type: 'bf_str_op', category: 'text', style: 'text_blocks', rows: [['%1 of %2', D('OP', ['uppercase', 'upper'], ['lowercase', 'lower'], ['trimmed', 'trim']), V('VALUE', 'String')]], output: ['String'], feature: 'strings' }),
  ex({ type: 'bf_str_contains', category: 'text', style: 'text_blocks', rows: [['%1 contains %2', V('TEXT', 'String'), V('FIND', 'String')]], output: ['Boolean'], feature: 'strings' }),
  ex({ type: 'bf_math_fn', category: 'math', style: 'math_blocks', rows: [['%1 %2', D('FN', 'floor', 'ceil', 'sin', 'cos', 'tan'), V('NUM', 'Number')]], output: ['Number'], feature: 'math' }),
  ex({ type: 'bf_math_minmax', category: 'math', style: 'math_blocks', rows: [['%1 of %2 and %3', D('FN', ['smaller', 'min'], ['larger', 'max']), V('A', 'Number'), V('B', 'Number')]], output: ['Number'], feature: 'math' }),

  // ----- lists -----
  ex({ type: 'bf_list_get', category: 'lists', style: 'list_blocks', rows: [['item %2 of %1', V('LIST', 'Array', 'Pointer'), V('INDEX', 'Number')]], output: null, tip: 'Indexes start at 0.', feature: 'lists' }),
  st({ type: 'bf_list_set', category: 'lists', style: 'list_blocks', rows: [['set item %2 of %1 to %3', V('LIST', 'Array', 'Pointer'), V('INDEX', 'Number'), V('VALUE')]], inline: true, tip: 'Indexes start at 0.', feature: 'lists' }),
  st({ type: 'bf_list_append', category: 'lists', style: 'list_blocks', rows: [['add %2 to end of %1', V('LIST', 'Array'), V('VALUE')]], inline: true, feature: 'lists' }),
  st({ type: 'bf_list_remove', category: 'lists', style: 'list_blocks', rows: [['remove item %2 of %1', V('LIST', 'Array'), V('INDEX', 'Number')]], inline: true, feature: 'lists' }),

  // ----- dictionaries -----
  ex({ type: 'bf_map_create', category: 'maps', style: 'map_blocks', rows: [['empty dictionary']], output: ['Map'], feature: 'maps' }),
  st({ type: 'bf_map_set', category: 'maps', style: 'map_blocks', rows: [['in %1 set key %2 to %3', V('MAP', 'Map'), V('KEY'), V('VALUE')]], inline: true, feature: 'maps' }),
  ex({ type: 'bf_map_get', category: 'maps', style: 'map_blocks', rows: [['value of key %2 in %1', V('MAP', 'Map'), V('KEY')]], output: null, feature: 'maps' }),
  ex({ type: 'bf_map_has', category: 'maps', style: 'map_blocks', rows: [['%1 has key %2', V('MAP', 'Map'), V('KEY')]], output: ['Boolean'], feature: 'maps' }),
  st({ type: 'bf_map_delete', category: 'maps', style: 'map_blocks', rows: [['delete key %2 from %1', V('MAP', 'Map'), V('KEY')]], inline: true, feature: 'maps' }),

  // ----- exceptions -----
  st({ type: 'bf_try', category: 'errors', style: 'error_blocks', rows: [['try'], ['%1', S('TRY')], ['on error, message in %1', Vr('ERR', 'error')], ['%1', S('CATCH')]], feature: 'exceptions' }),
  st({ type: 'bf_throw', category: 'errors', style: 'error_blocks', rows: [['raise error %1', V('MESSAGE', 'String')]], next: false, inline: true, feature: 'exceptions' }),

  // ----- files -----
  ex({ type: 'bf_file_read', category: 'files', style: 'file_blocks', rows: [['read text file %1', V('PATH', 'String')]], output: ['String'], feature: 'files' }),
  st({ type: 'bf_file_write', category: 'files', style: 'file_blocks', rows: [['%3 %2 to file %1', V('PATH', 'String'), V('CONTENT'), D('MODE', ['write', 'write'], ['append', 'append'])]], inline: true, feature: 'files' }),
  ex({ type: 'bf_file_exists', category: 'files', style: 'file_blocks', rows: [['file %1 exists', V('PATH', 'String')]], output: ['Boolean'], feature: 'files' }),

  // ----- modules -----
  st({ type: 'bf_import', category: 'modules', style: 'sys_blocks', rows: [['import module %1', Tx('MODULE', 'math')]], tip: 'Module names are specific to the target language.', feature: 'imports' }),

  // ----- classes / structs / interfaces -----
  { type: 'bf_struct_def', domain: 'imperative', category: 'classes', style: 'class_blocks', rows: [['struct %1', Tx('NAME', 'Point')], ['%1', S('MEMBERS', 'ClassMember')]], hat: true, feature: 'structs' },
  { type: 'bf_class_def', domain: 'imperative', category: 'classes', style: 'class_blocks', rows: [['class %1 implements %2', Tx('NAME', 'Counter'), Tx('IMPLEMENTS', '')], ['%1', S('MEMBERS', 'ClassMember')]], hat: true, feature: 'classes' },
  { type: 'bf_class_field', domain: 'imperative', category: 'classes', style: 'class_blocks', rows: [['field %1 type %2', Tx('NAME', 'value'), D('TYPE', ...VALUE_TYPES)]], prev: 'ClassMember', feature: 'structs' },
  { type: 'bf_class_method', domain: 'imperative', category: 'classes', style: 'class_blocks', rows: [['method %1 ( %2 ) returns %3', Tx('NAME', 'increment'), Tx('PARAMS', ''), D('RET', ...RET_TYPES)], ['%1', S('BODY')]], prev: 'ClassMember', tip: 'Parameters are written as name:type, separated by commas.', feature: 'classes' },
  { type: 'bf_interface_def', domain: 'imperative', category: 'classes', style: 'class_blocks', rows: [['interface %1', Tx('NAME', 'Shape')], ['%1', S('MEMBERS', 'IfaceMember')]], hat: true, feature: 'interfaces' },
  { type: 'bf_interface_method', domain: 'imperative', category: 'classes', style: 'class_blocks', rows: [['method %1 ( %2 ) returns %3', Tx('NAME', 'area'), Tx('PARAMS', ''), D('RET', ...RET_TYPES)]], prev: 'IfaceMember', feature: 'interfaces' },
  ex({ type: 'bf_new', category: 'classes', style: 'class_blocks', rows: [['new %1 with %2', Tx('CLASS', 'Point'), V('ARGS', 'Array')]], output: ['Object'], feature: 'structs' }),
  ex({ type: 'bf_this', category: 'classes', style: 'class_blocks', rows: [['this object']], output: ['Object'], feature: 'classes' }),
  ex({ type: 'bf_field_get', category: 'classes', style: 'class_blocks', rows: [['%1 . %2', V('OBJ', 'Object'), Tx('FIELD', 'value')]], output: null, feature: 'structs' }),
  st({ type: 'bf_field_set', category: 'classes', style: 'class_blocks', rows: [['set %1 . %2 to %3', V('OBJ', 'Object'), Tx('FIELD', 'value'), V('VALUE')]], inline: true, feature: 'structs' }),
  ex({ type: 'bf_method_call', category: 'classes', style: 'class_blocks', rows: [['%1 . %2 with %3', V('OBJ', 'Object'), Tx('METHOD', 'increment'), V('ARGS', 'Array')]], output: null, feature: 'classes' }),
  st({ type: 'bf_method_call_stmt', category: 'classes', style: 'class_blocks', rows: [['call %1 . %2 with %3', V('OBJ', 'Object'), Tx('METHOD', 'increment'), V('ARGS', 'Array')]], inline: true, feature: 'classes' }),

  // ----- async -----
  ex({ type: 'bf_await', category: 'async', style: 'async_blocks', rows: [['await %1', V('VALUE')]], output: null, feature: 'async' }),
  st({ type: 'bf_sleep', category: 'async', style: 'async_blocks', rows: [['wait %1 milliseconds', V('MS', 'Number')]], inline: true, feature: 'sleep' }),

  // ----- callbacks -----
  ex({ type: 'bf_func_ref', category: 'functions', style: 'procedure_blocks', rows: [['function named %1', Tx('NAME', 'handler')]], output: ['Function'], feature: 'callbacks' }),
  ex({ type: 'bf_call_ref', category: 'functions', style: 'procedure_blocks', rows: [['call function value %1 with %2', V('FN', 'Function'), V('ARGS', 'Array')]], output: null, feature: 'callbacks' }),
  st({ type: 'bf_call_ref_stmt', category: 'functions', style: 'procedure_blocks', rows: [['run function value %1 with %2', V('FN', 'Function'), V('ARGS', 'Array')]], inline: true, feature: 'callbacks' }),

  // ----- network / json -----
  ex({ type: 'bf_http_get', category: 'network', style: 'net_blocks', rows: [['HTTP GET %1', V('URL', 'String')]], output: ['String'], feature: 'http' }),
  ex({ type: 'bf_json_stringify', category: 'network', style: 'net_blocks', rows: [['to JSON text %1', V('VALUE')]], output: ['String'], feature: 'json' }),
  ex({ type: 'bf_json_parse', category: 'network', style: 'net_blocks', rows: [['parse JSON %1', V('TEXT', 'String')]], output: null, feature: 'jsonParse' }),

  // ----- shell -----
  st({ type: 'bf_shell_run', category: 'system', style: 'sys_blocks', rows: [['run shell command %1', V('CMD', 'String')]], inline: true, feature: 'shell' }),
  ex({ type: 'bf_shell_output', category: 'system', style: 'sys_blocks', rows: [['output of shell command %1', V('CMD', 'String')]], output: ['String'], feature: 'shell' }),

  // ----- memory / pointers -----
  ex({ type: 'bf_addr_of', category: 'memory', style: 'mem_blocks', rows: [['address of %1', Vr('VAR', 'x')]], output: ['Pointer'], feature: 'pointers', langs: [...POINTER_LANGS] }),
  ex({ type: 'bf_deref', category: 'memory', style: 'mem_blocks', rows: [['value at %1', V('PTR', 'Pointer')]], output: null, feature: 'pointers', langs: [...POINTER_LANGS] }),
  st({ type: 'bf_deref_set', category: 'memory', style: 'mem_blocks', rows: [['set value at %1 to %2', V('PTR', 'Pointer'), V('VALUE')]], inline: true, feature: 'pointers', langs: [...POINTER_LANGS] }),
  ex({ type: 'bf_alloc', category: 'memory', style: 'mem_blocks', rows: [['allocate %2 items of %1', D('TYPE', ['integer', 'int'], ['decimal', 'float']), V('COUNT', 'Number')]], output: ['Pointer'], feature: 'manualMemory', langs: ['c', 'cpp'] }),
  st({ type: 'bf_free', category: 'memory', style: 'mem_blocks', rows: [['free memory of %1', Vr('VAR', 'p')]], feature: 'manualMemory', langs: ['c', 'cpp'] }),

  // ----- page scripting (JavaScript / TypeScript / HTML script) -----
  st({ type: 'bf_dom_set', category: 'page', style: 'web_blocks', rows: [['set %2 of element %1 to %3', Tx('ID', 'output'), D('WHAT', ['text', 'text'], ['HTML', 'html'], ['value', 'value']), V('VALUE')]], inline: true, feature: 'dom', langs: [...DOM_LANGS] }),
  st({ type: 'bf_dom_style', category: 'page', style: 'web_blocks', rows: [['set style %2 of element %1 to %3', Tx('ID', 'output'), Tx('PROP', 'color'), V('VALUE', 'String')]], inline: true, feature: 'dom', langs: [...DOM_LANGS] }),
  ex({ type: 'bf_dom_get', category: 'page', style: 'web_blocks', rows: [['%2 of element %1', Tx('ID', 'input'), D('WHAT', ['value', 'value'], ['text', 'text'])]], output: ['String'], feature: 'dom', langs: [...DOM_LANGS] }),
  st({ type: 'bf_dom_on', category: 'page', style: 'web_blocks', rows: [['when element %1 gets %2', Tx('ID', 'button'), D('EVENT', 'click', 'input', 'change', 'submit', 'keydown', 'mouseover')], ['%1', S('DO')]], feature: 'dom', langs: [...DOM_LANGS] }),
];

// Number field helper is kept exported for symmetry with other definition files.
export const _unused = Nu;
