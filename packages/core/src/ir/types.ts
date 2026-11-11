/**
 * Common intermediate representation.
 *
 * Imperative programs share one IR across 15 languages. HTML/CSS, SQL and
 * Assembly have their own IR domains because their semantics do not map onto
 * imperative statements.
 */
import type { AsmArch, AsmPlatform } from '../types';

// ---------- types ----------

export type PrimKind = 'int' | 'float' | 'string' | 'bool' | 'void' | 'any' | 'unknown' | 'null';

export type TypeRef =
  | { k: PrimKind }
  | { k: 'list'; of: TypeRef }
  | { k: 'map'; key: TypeRef; value: TypeRef }
  | { k: 'struct'; name: string }
  | { k: 'ptr'; to: TypeRef }
  | { k: 'func' };

export const T = {
  int: { k: 'int' } as TypeRef,
  float: { k: 'float' } as TypeRef,
  string: { k: 'string' } as TypeRef,
  bool: { k: 'bool' } as TypeRef,
  void: { k: 'void' } as TypeRef,
  any: { k: 'any' } as TypeRef,
  unknown: { k: 'unknown' } as TypeRef,
  null: { k: 'null' } as TypeRef,
  func: { k: 'func' } as TypeRef,
  list: (of: TypeRef): TypeRef => ({ k: 'list', of }),
  map: (key: TypeRef, value: TypeRef): TypeRef => ({ k: 'map', key, value }),
  struct: (name: string): TypeRef => ({ k: 'struct', name }),
  ptr: (to: TypeRef): TypeRef => ({ k: 'ptr', to }),
};

export function typeEq(a: TypeRef, b: TypeRef): boolean {
  if (a.k !== b.k) return false;
  if (a.k === 'list' && b.k === 'list') return typeEq(a.of, b.of);
  if (a.k === 'map' && b.k === 'map') return typeEq(a.key, b.key) && typeEq(a.value, b.value);
  if (a.k === 'struct' && b.k === 'struct') return a.name === b.name;
  if (a.k === 'ptr' && b.k === 'ptr') return typeEq(a.to, b.to);
  return true;
}

/** Least upper bound used by inference. */
export function unify(a: TypeRef, b: TypeRef): TypeRef {
  if (a.k === 'unknown') return b;
  if (b.k === 'unknown') return a;
  if (a.k === 'null') return b;
  if (b.k === 'null') return a;
  if (typeEq(a, b)) return a;
  if ((a.k === 'int' && b.k === 'float') || (a.k === 'float' && b.k === 'int')) return T.float;
  if (a.k === 'list' && b.k === 'list') return T.list(unify(a.of, b.of));
  if (a.k === 'map' && b.k === 'map') return T.map(unify(a.key, b.key), unify(a.value, b.value));
  return T.any;
}

export function typeToString(t: TypeRef): string {
  switch (t.k) {
    case 'list':
      return `list<${typeToString(t.of)}>`;
    case 'map':
      return `map<${typeToString(t.key)}, ${typeToString(t.value)}>`;
    case 'struct':
      return t.name;
    case 'ptr':
      return `ptr<${typeToString(t.to)}>`;
    default:
      return t.k;
  }
}

export const isNumeric = (t: TypeRef | undefined): boolean => !!t && (t.k === 'int' || t.k === 'float');

// ---------- expressions ----------

export type BinOp = '+' | '-' | '*' | '/' | '%' | '**' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';
export type MathFn = 'sqrt' | 'abs' | 'floor' | 'ceil' | 'round' | 'ln' | 'log10' | 'exp' | 'pow10' | 'sin' | 'cos' | 'tan' | 'min' | 'max';
export type ConvertTarget = 'int' | 'float' | 'string' | 'bool';
export type StrOp = 'upper' | 'lower' | 'trim' | 'contains';

interface N {
  /** Originating block id. */
  id?: string;
  /** Resolved type, filled in by semantic analysis. */
  t?: TypeRef;
}

export type Expr =
  | (N & { k: 'num'; value: number; isInt: boolean })
  | (N & { k: 'str'; value: string })
  | (N & { k: 'bool'; value: boolean })
  | (N & { k: 'null' })
  | (N & { k: 'var'; name: string })
  | (N & { k: 'bin'; op: BinOp; l: Expr; r: Expr })
  | (N & { k: 'un'; op: 'neg' | 'not'; e: Expr })
  | (N & { k: 'call'; name: string; args: Expr[] })
  | (N & { k: 'list'; items: Expr[] })
  | (N & { k: 'map'; entries: { key: Expr; value: Expr }[] })
  | (N & { k: 'index'; target: Expr; index: Expr })
  | (N & { k: 'mapGet'; target: Expr; key: Expr })
  | (N & { k: 'mapHas'; target: Expr; key: Expr })
  | (N & { k: 'len'; target: Expr })
  | (N & { k: 'concat'; parts: Expr[] })
  | (N & { k: 'convert'; to: ConvertTarget; e: Expr })
  | (N & { k: 'input'; prompt: Expr; numeric: boolean })
  | (N & { k: 'math'; fn: MathFn; args: Expr[] })
  | (N & { k: 'random'; from: Expr; to: Expr })
  | (N & { k: 'strOp'; op: StrOp; args: Expr[] })
  | (N & { k: 'ternary'; cond: Expr; a: Expr; b: Expr })
  | (N & { k: 'fileRead'; path: Expr })
  | (N & { k: 'fileExists'; path: Expr })
  | (N & { k: 'jsonParse'; e: Expr })
  | (N & { k: 'jsonStringify'; e: Expr })
  | (N & { k: 'httpGet'; url: Expr })
  | (N & { k: 'shell'; cmd: Expr })
  | (N & { k: 'field'; target: Expr; name: string })
  | (N & { k: 'this' })
  | (N & { k: 'new'; name: string; args: Expr[] })
  | (N & { k: 'method'; target: Expr; name: string; args: Expr[] })
  | (N & { k: 'await'; e: Expr })
  | (N & { k: 'funcRef'; name: string })
  | (N & { k: 'callRef'; fn: Expr; args: Expr[] })
  | (N & { k: 'addrOf'; name: string })
  | (N & { k: 'deref'; e: Expr })
  | (N & { k: 'alloc'; elem: TypeRef; count: Expr })
  | (N & { k: 'domGet'; target: Expr; what: 'value' | 'text' })
  | (N & { k: 'raw'; code: string; lang: string })
  | (N & { k: 'missing' });

export type ExprKind = Expr['k'];

// ---------- statements ----------

export interface Param {
  name: string;
  type: TypeRef;
}

export interface FuncDecl extends N {
  k: 'func';
  name: string;
  params: Param[];
  ret: TypeRef;
  body: Stmt[];
  isAsync: boolean;
  /** True when parameter/return types came from explicit annotations. */
  explicitTypes?: boolean;
}

export interface FieldDecl {
  id?: string;
  name: string;
  type: TypeRef;
  init?: Expr;
}

export interface ClassDecl extends N {
  k: 'class';
  name: string;
  isStruct: boolean;
  implements?: string;
  fields: FieldDecl[];
  methods: FuncDecl[];
}

export interface InterfaceDecl extends N {
  k: 'interface';
  name: string;
  methods: { id?: string; name: string; params: Param[]; ret: TypeRef }[];
}

export type Stmt =
  | (N & { k: 'varDecl'; name: string; declType?: TypeRef; init?: Expr; isConst: boolean })
  | (N & { k: 'assign'; name: string; value: Expr })
  | (N & { k: 'print'; value: Expr })
  | (N & { k: 'if'; branches: { cond: Expr; body: Stmt[] }[]; else?: Stmt[] })
  | (N & { k: 'while'; cond: Expr; body: Stmt[] })
  | (N & { k: 'repeat'; count: Expr; body: Stmt[] })
  | (N & { k: 'forRange'; var: string; from: Expr; to: Expr; step: Expr; body: Stmt[] })
  | (N & { k: 'forEach'; var: string; iterable: Expr; body: Stmt[] })
  | (N & { k: 'break' })
  | (N & { k: 'continue' })
  | (N & { k: 'return'; value?: Expr })
  | (N & { k: 'exprStmt'; e: Expr })
  | (N & { k: 'listAppend'; list: Expr; value: Expr })
  | (N & { k: 'listSet'; list: Expr; index: Expr; value: Expr })
  | (N & { k: 'listRemove'; list: Expr; index: Expr })
  | (N & { k: 'mapSet'; map: Expr; key: Expr; value: Expr })
  | (N & { k: 'mapDelete'; map: Expr; key: Expr })
  | (N & { k: 'try'; body: Stmt[]; errVar: string; handler: Stmt[] })
  | (N & { k: 'throw'; message: Expr })
  | (N & { k: 'comment'; text: string })
  | (N & { k: 'import'; module: string })
  | (N & { k: 'fileWrite'; path: Expr; content: Expr; append: boolean })
  | (N & { k: 'fieldSet'; target: Expr; name: string; value: Expr })
  | (N & { k: 'sleep'; ms: Expr })
  | (N & { k: 'shellRun'; cmd: Expr })
  | (N & { k: 'derefSet'; ptr: Expr; value: Expr })
  | (N & { k: 'free'; name: string })
  | (N & { k: 'domSet'; target: Expr; what: 'text' | 'html' | 'value' | 'style'; prop?: string; value: Expr })
  | (N & { k: 'domOn'; target: Expr; event: string; body: Stmt[] })
  | (N & { k: 'rawStmt'; code: string; lang: string });

export type StmtKind = Stmt['k'];

export interface ImperativeProgram {
  domain: 'imperative';
  main: Stmt[];
  funcs: FuncDecl[];
  classes: ClassDecl[];
  interfaces: InterfaceDecl[];
  /** True when the workspace has an explicit start block. */
  hasStart: boolean;
  startId?: string;
}

// ---------- web (HTML/CSS) IR ----------

export interface WebElement {
  id?: string;
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: WebNode[];
  /** Void elements such as img/input/br. */
  selfClosing?: boolean;
}
export interface WebText {
  id?: string;
  kind: 'text';
  text: string;
}
export type WebNode = WebElement | WebText;

export interface CssDecl {
  id?: string;
  prop: string;
  value: string;
}
export interface CssRule {
  id?: string;
  kind: 'rule';
  selector: string;
  decls: CssDecl[];
}
export interface CssMedia {
  id?: string;
  kind: 'media';
  query: string;
  rules: CssRule[];
}
export type CssItem = CssRule | CssMedia;

export interface WebProgram {
  domain: 'web';
  hasDocument: boolean;
  docId?: string;
  title: string;
  lang: string;
  body: WebNode[];
  styles: CssItem[];
  /** Imperative statements emitted as an inline script. */
  script: Stmt[];
  scriptFuncs: FuncDecl[];
}

// ---------- SQL IR ----------

export type SqlExpr =
  | { k: 'num'; value: number; id?: string }
  | { k: 'str'; value: string; id?: string }
  | { k: 'bool'; value: boolean; id?: string }
  | { k: 'null'; id?: string }
  | { k: 'col'; name: string; id?: string }
  | { k: 'star'; id?: string }
  | { k: 'bin'; op: string; l: SqlExpr; r: SqlExpr; id?: string }
  | { k: 'not'; e: SqlExpr; id?: string }
  | { k: 'func'; name: string; distinct: boolean; arg: SqlExpr; id?: string }
  | { k: 'like'; e: SqlExpr; pattern: SqlExpr; id?: string }
  | { k: 'in'; e: SqlExpr; items: SqlExpr[]; id?: string }
  | { k: 'isNull'; e: SqlExpr; negate: boolean; id?: string }
  | { k: 'between'; e: SqlExpr; lo: SqlExpr; hi: SqlExpr; id?: string }
  | { k: 'alias'; e: SqlExpr; name: string; id?: string }
  | { k: 'raw'; code: string; id?: string }
  | { k: 'missing'; id?: string };

export interface SqlColumnDef {
  id?: string;
  name: string;
  type: string;
  primaryKey: boolean;
  autoIncrement: boolean;
  notNull: boolean;
  unique: boolean;
  default?: string;
}

export type SqlClause =
  | { k: 'join'; id?: string; type: string; table: string; on: SqlExpr }
  | { k: 'where'; id?: string; cond: SqlExpr }
  | { k: 'groupBy'; id?: string; columns: string }
  | { k: 'having'; id?: string; cond: SqlExpr }
  | { k: 'orderBy'; id?: string; column: string; dir: 'ASC' | 'DESC' }
  | { k: 'limit'; id?: string; count: number; offset: number };

export type SqlStmt =
  | { k: 'createTable'; id?: string; name: string; ifNotExists: boolean; columns: SqlColumnDef[] }
  | { k: 'dropTable'; id?: string; name: string; ifExists: boolean }
  | { k: 'insert'; id?: string; table: string; columns: string[]; values: SqlExpr[] }
  | { k: 'select'; id?: string; distinct: boolean; columns: SqlExpr[]; from: string; clauses: SqlClause[] }
  | { k: 'update'; id?: string; table: string; sets: { id?: string; column: string; value: SqlExpr }[]; where?: SqlExpr }
  | { k: 'delete'; id?: string; table: string; where?: SqlExpr }
  | { k: 'createIndex'; id?: string; name: string; table: string; columns: string; unique: boolean }
  | { k: 'addColumn'; id?: string; table: string; column: SqlColumnDef }
  | { k: 'txn'; id?: string; action: 'BEGIN' | 'COMMIT' | 'ROLLBACK' }
  | { k: 'comment'; id?: string; text: string }
  | { k: 'raw'; id?: string; code: string };

export interface SqlProgram {
  domain: 'sql';
  statements: SqlStmt[];
}

// ---------- Assembly IR ----------

export interface AsmInstr {
  id?: string;
  /** Block type decides the encoding; fields carry the operands. */
  op: string;
  /** 'arm64' / 'x86_64' for architecture specific blocks, 'any' for portable ones. */
  arch: AsmArch | 'any';
  f: Record<string, string>;
}

export interface AsmRoutine {
  id?: string;
  name: string;
  isEntry: boolean;
  body: AsmInstr[];
}

export interface AsmProgram {
  domain: 'asm';
  arch: AsmArch;
  platform: AsmPlatform;
  hasProgram: boolean;
  programId?: string;
  routines: AsmRoutine[];
}

export type Program = ImperativeProgram | WebProgram | SqlProgram | AsmProgram;
