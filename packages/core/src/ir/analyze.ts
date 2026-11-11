/**
 * Semantic analysis for imperative programs: scopes, declaration placement,
 * type inference and structural diagnostics.
 */
import type { Diagnostic, Severity } from '../types';
import { type ClassDecl, type Expr, type FuncDecl, type ImperativeProgram, isNumeric, type Stmt, T, type TypeRef, typeEq, typeToString, unify } from './types';

export interface VarInfo {
  name: string;
  type: TypeRef;
  /** Assigned more than once. */
  reassigned: boolean;
  /** Contents changed in place (append, item set, field set, address taken, method call). */
  mutated: boolean;
  /** The value is read somewhere. */
  read: boolean;
  isConst: boolean;
  explicitType: boolean;
  /**
   * param: function parameter. atFirst: declare at `declNode`.
   * loop: declared by the loop header. hoist: declare at the top of the scope.
   * global: shared between scopes, declared at file level.
   */
  decl: 'param' | 'atFirst' | 'loop' | 'hoist' | 'global';
  declNode?: Stmt;
}

export interface ScopeInfo {
  /** '' for main, function name, or Class.method. */
  name: string;
  vars: Map<string, VarInfo>;
  /** Globals read or written in this scope. */
  globalsUsed: Set<string>;
  globalsAssigned: Set<string>;
  /** Names of user functions called directly. */
  calls: Set<string>;
  /** Hoisted variables, in first-use order. */
  hoisted: string[];
}

export interface FuncInfo {
  decl: FuncDecl;
  scope: ScopeInfo;
  ownerClass?: string;
}

export interface Analysis {
  main: ScopeInfo;
  funcs: Map<string, FuncInfo>;
  methods: Map<string, FuncInfo>;
  globals: Map<string, VarInfo>;
  classes: Map<string, ClassDecl>;
  features: Set<string>;
  diagnostics: Diagnostic[];
  /** Variables to declare at a given statement. */
  declAt: Map<Stmt, string[]>;
}

// ---------- tree helpers ----------

export function childExprs(e: Expr): Expr[] {
  switch (e.k) {
    case 'bin':
      return [e.l, e.r];
    case 'un':
    case 'convert':
    case 'jsonParse':
    case 'jsonStringify':
    case 'await':
    case 'deref':
      return [e.e];
    case 'call':
    case 'new':
    case 'math':
    case 'strOp':
      return e.args;
    case 'list':
      return e.items;
    case 'map':
      return e.entries.flatMap((x) => [x.key, x.value]);
    case 'index':
      return [e.target, e.index];
    case 'mapGet':
    case 'mapHas':
      return [e.target, e.key];
    case 'len':
    case 'field':
    case 'domGet':
      return [e.target];
    case 'concat':
      return e.parts;
    case 'input':
      return [e.prompt];
    case 'random':
      return [e.from, e.to];
    case 'ternary':
      return [e.cond, e.a, e.b];
    case 'fileRead':
    case 'fileExists':
      return [e.path];
    case 'httpGet':
      return [e.url];
    case 'shell':
      return [e.cmd];
    case 'method':
      return [e.target, ...e.args];
    case 'callRef':
      return [e.fn, ...e.args];
    case 'alloc':
      return [e.count];
    default:
      return [];
  }
}

/** Expressions evaluated directly by a statement (not those of nested statements). */
export function stmtExprs(s: Stmt): Expr[] {
  switch (s.k) {
    case 'varDecl':
      return s.init ? [s.init] : [];
    case 'assign':
    case 'print':
      return [s.value];
    case 'if':
      return s.branches.map((b) => b.cond);
    case 'while':
      return [s.cond];
    case 'repeat':
      return [s.count];
    case 'forRange':
      return [s.from, s.to, s.step];
    case 'forEach':
      return [s.iterable];
    case 'return':
      return s.value ? [s.value] : [];
    case 'exprStmt':
      return [s.e];
    case 'listAppend':
      return [s.list, s.value];
    case 'listSet':
      return [s.list, s.index, s.value];
    case 'listRemove':
      return [s.list, s.index];
    case 'mapSet':
      return [s.map, s.key, s.value];
    case 'mapDelete':
      return [s.map, s.key];
    case 'throw':
      return [s.message];
    case 'fileWrite':
      return [s.path, s.content];
    case 'fieldSet':
      return [s.target, s.value];
    case 'sleep':
      return [s.ms];
    case 'shellRun':
      return [s.cmd];
    case 'derefSet':
      return [s.ptr, s.value];
    case 'domSet':
      return [s.target, s.value];
    case 'domOn':
      return [s.target];
    default:
      return [];
  }
}

export function stmtBlocks(s: Stmt): Stmt[][] {
  switch (s.k) {
    case 'if':
      return [...s.branches.map((b) => b.body), ...(s.else ? [s.else] : [])];
    case 'while':
    case 'repeat':
    case 'forRange':
    case 'forEach':
    case 'domOn':
      return [s.body];
    case 'try':
      return [s.body, s.handler];
    default:
      return [];
  }
}

export function walkExpr(e: Expr, fn: (e: Expr) => void): void {
  fn(e);
  for (const c of childExprs(e)) walkExpr(c, fn);
}

export function walkStmts(stmts: Stmt[], onStmt: (s: Stmt) => void, onExpr?: (e: Expr, s: Stmt) => void): void {
  for (const s of stmts) {
    onStmt(s);
    if (onExpr) for (const e of stmtExprs(s)) walkExpr(e, (x) => onExpr(x, s));
    for (const b of stmtBlocks(s)) walkStmts(b, onStmt, onExpr);
  }
}

const STMT_FEATURES: Partial<Record<Stmt['k'], string>> = {
  varDecl: 'typedDecl', if: 'conditions', while: 'loops', repeat: 'loops', forRange: 'loops', forEach: 'loops',
  listAppend: 'lists', listSet: 'lists', listRemove: 'lists', mapSet: 'maps', mapDelete: 'maps', try: 'exceptions',
  throw: 'exceptions', comment: 'comments', import: 'imports', fileWrite: 'files', fieldSet: 'structs', sleep: 'sleep',
  shellRun: 'shell', derefSet: 'pointers', free: 'manualMemory', domSet: 'dom', domOn: 'dom', rawStmt: 'raw', print: 'print',
};
const EXPR_FEATURES: Partial<Record<Expr['k'], string>> = {
  list: 'lists', index: 'lists', map: 'maps', mapGet: 'maps', mapHas: 'maps', concat: 'strings', strOp: 'strings',
  convert: 'convert', input: 'input', math: 'math', random: 'random', ternary: 'conditions', fileRead: 'files',
  fileExists: 'files', jsonParse: 'jsonParse', jsonStringify: 'json', httpGet: 'http', shell: 'shell', field: 'structs',
  new: 'structs', method: 'classes', this: 'classes', await: 'async', funcRef: 'callbacks', callRef: 'callbacks',
  addrOf: 'pointers', deref: 'pointers', alloc: 'manualMemory', domGet: 'dom', raw: 'raw', call: 'functions',
};

// ---------- occurrences ----------

interface PathEntry {
  block: Stmt[];
  index: number;
}
interface Occ {
  path: PathEntry[];
  kind: 'read' | 'write' | 'bind';
  stmt: Stmt;
}

function collectOccurrences(body: Stmt[]): Map<string, Occ[]> {
  const occs = new Map<string, Occ[]>();
  const add = (name: string, occ: Occ) => {
    let list = occs.get(name);
    if (!list) occs.set(name, (list = []));
    list.push(occ);
  };
  const visit = (block: Stmt[], prefix: PathEntry[]) => {
    block.forEach((s, index) => {
      const path = [...prefix, { block, index }];
      for (const e of stmtExprs(s)) {
        walkExpr(e, (x) => {
          if (x.k === 'var') add(x.name, { path, kind: 'read', stmt: s });
          else if (x.k === 'addrOf') add(x.name, { path, kind: 'read', stmt: s });
        });
      }
      if (s.k === 'assign' || s.k === 'varDecl') add(s.name, { path, kind: 'write', stmt: s });
      else if (s.k === 'forRange' || s.k === 'forEach') add(s.var, { path, kind: 'bind', stmt: s });
      else if (s.k === 'try') add(s.errVar, { path, kind: 'bind', stmt: s });
      else if (s.k === 'free') add(s.name, { path, kind: 'read', stmt: s });
      for (const b of stmtBlocks(s)) visit(b, path);
    });
  };
  visit(body, []);
  return occs;
}

function defaultFor(severity: Severity, code: string, message: string, blockId?: string, params?: Record<string, string | number>): Diagnostic {
  return { severity, code, message, blockId, params, source: 'analysis' };
}

// ---------- analysis ----------

export function analyze(program: ImperativeProgram): Analysis {
  const diagnostics: Diagnostic[] = [];
  const features = new Set<string>();
  const classes = new Map(program.classes.map((c) => [c.name, c]));
  const report = (sev: Severity, code: string, message: string, id?: string, params?: Record<string, string | number>) => diagnostics.push(defaultFor(sev, code, message, id, params));

  if (program.funcs.length) features.add('functions');
  for (const c of program.classes) features.add(c.isStruct ? 'structs' : 'classes');
  if (program.interfaces.length) features.add('interfaces');

  // ----- scopes -----
  interface RawScope {
    name: string;
    body: Stmt[];
    params: string[];
    func?: FuncDecl;
    ownerClass?: string;
    occs: Map<string, Occ[]>;
  }
  const scopes: RawScope[] = [{ name: '', body: program.main, params: [], occs: collectOccurrences(program.main) }];
  for (const f of program.funcs) scopes.push({ name: f.name, body: f.body, params: f.params.map((p) => p.name), func: f, occs: collectOccurrences(f.body) });
  for (const c of program.classes) {
    for (const m of c.methods) scopes.push({ name: `${c.name}.${m.name}`, body: m.body, params: m.params.map((p) => p.name), func: m, ownerClass: c.name, occs: collectOccurrences(m.body) });
  }

  // A variable used by more than one scope (and not a parameter there) is global.
  const usedIn = new Map<string, Set<string>>();
  for (const sc of scopes) {
    for (const name of sc.occs.keys()) {
      if (sc.params.includes(name)) continue;
      if (!usedIn.has(name)) usedIn.set(name, new Set());
      usedIn.get(name)!.add(sc.name);
    }
  }
  const globals = new Map<string, VarInfo>();
  for (const [name, set] of usedIn) {
    if (set.size > 1) globals.set(name, { name, type: T.unknown, reassigned: true, mutated: false, read: true, isConst: false, explicitType: false, decl: 'global' });
  }

  const declAt = new Map<Stmt, string[]>();
  const scopeInfos = new Map<string, ScopeInfo>();
  const userFuncs = new Map(program.funcs.map((f) => [f.name, f]));

  for (const sc of scopes) {
    const info: ScopeInfo = { name: sc.name, vars: new Map(), globalsUsed: new Set(), globalsAssigned: new Set(), calls: new Set(), hoisted: [] };
    scopeInfos.set(sc.name, info);
    sc.func?.params.forEach((p) => info.vars.set(p.name, { name: p.name, type: p.type, reassigned: false, mutated: false, read: true, isConst: false, explicitType: !!sc.func?.explicitTypes, decl: 'param' }));

    for (const [name, occs] of sc.occs) {
      const writes = occs.filter((o) => o.kind !== 'read');
      const isParam = sc.params.includes(name);
      if (!isParam && globals.has(name)) {
        info.globalsUsed.add(name);
        if (writes.length) info.globalsAssigned.add(name);
        continue;
      }
      const inLoopWrite = writes.some((o) => o.path.slice(0, -1).some((p) => ['while', 'repeat', 'forRange', 'forEach'].includes(p.block[p.index].k)));
      if (isParam) {
        const v = info.vars.get(name)!;
        v.reassigned = writes.length > 0;
        continue;
      }
      const v: VarInfo = { name, type: T.unknown, reassigned: writes.length > 1 || inLoopWrite, mutated: false, read: occs.some((o) => o.kind === 'read'), isConst: false, explicitType: false, decl: 'hoist' };
      info.vars.set(name, v);

      // Depth of the innermost block that contains every occurrence.
      let depth = Math.min(...occs.map((o) => o.path.length));
      for (let d = 0; d < depth; d++) {
        if (occs.some((o) => o.path[d].block !== occs[0].path[d].block)) {
          depth = d;
          break;
        }
      }
      const first = occs[0];
      const d = depth - 1;
      if (first.kind === 'read') {
        report('warning', 'analysis.useBeforeAssign', `Variable "${name}" is read before it is given a value.`, first.stmt.id, { name });
      } else if (d >= 0 && first.path.length === depth) {
        const minIdx = Math.min(...occs.map((o) => o.path[d].index));
        const stmt = first.path[d].block[minIdx];
        const allInStmt = occs.every((o) => o.path[d].index === minIdx);
        if (stmt === first.stmt) {
          if (stmt.k === 'assign' || stmt.k === 'varDecl') {
            v.decl = 'atFirst';
            v.declNode = stmt;
          } else if ((stmt.k === 'forRange' || stmt.k === 'forEach') && allInStmt) {
            v.decl = 'loop';
            v.declNode = stmt;
            v.reassigned = writes.length > 1;
          } else if (stmt.k === 'try' && allInStmt) {
            v.decl = 'atFirst';
            v.declNode = stmt;
          }
        }
      }
      if (v.decl === 'atFirst') v.reassigned = writes.length > 1;
      else if (v.decl === 'hoist') v.reassigned = true;
      if (v.decl === 'atFirst' && v.declNode) {
        if (!declAt.has(v.declNode)) declAt.set(v.declNode, []);
        declAt.get(v.declNode)!.push(name);
      } else if (v.decl === 'hoist') {
        info.hoisted.push(name);
      }
    }
  }

  // ----- explicit declarations, constants, mutation flags, structure checks -----
  const lookupVar = (scope: ScopeInfo, name: string): VarInfo | undefined => scope.vars.get(name) ?? globals.get(name);

  for (const sc of scopes) {
    const info = scopeInfos.get(sc.name)!;
    const declared = new Set<string>();
    const check = (block: Stmt[], inLoop: boolean) => {
      for (const s of block) {
        const f = STMT_FEATURES[s.k];
        if (f) features.add(f);
        for (const e of stmtExprs(s)) {
          walkExpr(e, (x) => {
            const ef = EXPR_FEATURES[x.k];
            if (ef) features.add(ef);
            if (x.k === 'call') {
              info.calls.add(x.name);
              const fn = userFuncs.get(x.name);
              if (!fn) report('error', 'analysis.unknownFunction', `Function "${x.name}" is not defined.`, x.id, { name: x.name });
              else if (fn.params.length !== x.args.length) report('error', 'analysis.argCount', `Function "${x.name}" expects ${fn.params.length} argument(s) but got ${x.args.length}.`, x.id, { name: x.name, expected: fn.params.length, got: x.args.length });
            } else if (x.k === 'new') {
              const cls = classes.get(x.name);
              if (!cls) report('error', 'analysis.unknownClass', `Class or struct "${x.name}" is not defined.`, x.id, { name: x.name });
              else if (cls.fields.length !== x.args.length) report('error', 'analysis.newArgCount', `"${x.name}" has ${cls.fields.length} field(s) but ${x.args.length} value(s) were given.`, x.id, { name: x.name, expected: cls.fields.length, got: x.args.length });
            } else if (x.k === 'funcRef' && !userFuncs.has(x.name)) {
              report('error', 'analysis.unknownFunction', `Function "${x.name}" is not defined.`, x.id, { name: x.name });
            } else if (x.k === 'addrOf') {
              const v = lookupVar(info, x.name);
              if (v) v.mutated = true;
            } else if (x.k === 'method' && x.target.k === 'var') {
              const v = lookupVar(info, x.target.name);
              if (v) v.mutated = true;
            } else if (x.k === 'this' && !sc.ownerClass) {
              report('error', 'analysis.thisOutsideClass', '"this object" can only be used inside a class method.', x.id);
            }
          });
        }
        switch (s.k) {
          case 'varDecl': {
            const v = lookupVar(info, s.name);
            if (v) {
              if (declared.has(s.name)) report('error', 'analysis.redeclared', `Variable "${s.name}" is declared twice.`, s.id, { name: s.name });
              declared.add(s.name);
              if (s.declType) v.explicitType = true;
              if (s.isConst) {
                if (v.decl === 'atFirst' && v.declNode === s) v.isConst = true;
                else report('warning', 'analysis.constNotLocal', `"${s.name}" cannot be a constant here because it is used outside this block.`, s.id, { name: s.name });
              }
            }
            break;
          }
          case 'assign': {
            const v = lookupVar(info, s.name);
            if (v?.isConst && v.declNode !== s) report('error', 'analysis.constReassigned', `"${s.name}" is a constant and cannot be changed.`, s.id, { name: s.name });
            break;
          }
          case 'listAppend':
          case 'listSet':
          case 'listRemove':
          case 'mapSet':
          case 'mapDelete':
          case 'fieldSet': {
            const target = s.k === 'mapSet' || s.k === 'mapDelete' ? s.map : s.k === 'fieldSet' ? s.target : s.list;
            if (target.k === 'var') {
              const v = lookupVar(info, target.name);
              if (v) v.mutated = true;
            }
            break;
          }
          case 'break':
          case 'continue':
            if (!inLoop) report('error', 'analysis.breakOutsideLoop', 'Break and continue can only be used inside a loop.', s.id);
            break;
          case 'return':
            if (!sc.func) report('error', 'analysis.returnInMain', 'Return can only be used inside a function.', s.id);
            break;
          default:
            break;
        }
        const loop = s.k === 'while' || s.k === 'repeat' || s.k === 'forRange' || s.k === 'forEach';
        for (const b of stmtBlocks(s)) check(b, s.k === 'domOn' ? false : inLoop || loop);
      }
    };
    check(sc.body, false);
    // Constants keep their flag only when never reassigned.
    for (const v of info.vars.values()) if (v.isConst) v.reassigned = false;
  }

  // ----- type inference (monotone fixpoint) -----
  const typeOfVar = (scope: ScopeInfo, name: string): TypeRef => lookupVar(scope, name)?.type ?? T.unknown;
  let changed = true;
  const widen = (scope: ScopeInfo, name: string, t: TypeRef) => {
    const v = lookupVar(scope, name);
    if (!v || t.k === 'unknown') return;
    if (v.explicitType && v.type.k !== 'unknown') return;
    const next = unify(v.type, t);
    if (!typeEq(next, v.type)) {
      v.type = next;
      changed = true;
    }
  };
  const funcInfo = (name: string) => userFuncs.get(name);
  const numeric = (op: string, a: TypeRef, b: TypeRef): TypeRef => {
    if (op === '/' || op === '**') return T.float;
    if (a.k === 'float' || b.k === 'float') return T.float;
    if (a.k === 'int' || b.k === 'int') return a.k === 'any' || b.k === 'any' ? T.any : T.int;
    if (a.k === 'any' || b.k === 'any') return T.any;
    return T.unknown;
  };

  const typeOf = (e: Expr, scope: ScopeInfo, cls?: string): TypeRef => {
    const t = infer(e, scope, cls);
    e.t = t;
    return t;
  };
  const infer = (e: Expr, scope: ScopeInfo, cls?: string): TypeRef => {
    const ty = (x: Expr) => typeOf(x, scope, cls);
    switch (e.k) {
      case 'num':
        return e.isInt ? T.int : T.float;
      case 'str':
        return T.string;
      case 'bool':
        return T.bool;
      case 'null':
        return T.null;
      case 'var':
        return typeOfVar(scope, e.name);
      case 'bin': {
        const a = ty(e.l);
        const b = ty(e.r);
        if (['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(e.op)) return T.bool;
        return numeric(e.op, a, b);
      }
      case 'un':
        return e.op === 'not' ? (ty(e.e), T.bool) : ty(e.e);
      case 'call': {
        const fn = funcInfo(e.name);
        const callee = scopeInfos.get(e.name);
        e.args.forEach((a, i) => {
          const at = ty(a);
          const p = fn?.params[i];
          if (p && callee) widen(callee, p.name, at);
        });
        return fn?.ret ?? T.unknown;
      }
      case 'list': {
        let of: TypeRef = T.unknown;
        for (const it of e.items) of = unify(of, ty(it));
        return T.list(of);
      }
      case 'map': {
        let k: TypeRef = T.unknown;
        let v: TypeRef = T.unknown;
        for (const en of e.entries) {
          k = unify(k, ty(en.key));
          v = unify(v, ty(en.value));
        }
        return T.map(k, v);
      }
      case 'index': {
        const tt = ty(e.target);
        ty(e.index);
        if (tt.k === 'list') return tt.of;
        if (tt.k === 'ptr') return tt.to;
        if (tt.k === 'string') return T.string;
        return tt.k === 'any' ? T.any : T.unknown;
      }
      case 'mapGet': {
        const tt = ty(e.target);
        ty(e.key);
        return tt.k === 'map' ? tt.value : tt.k === 'any' ? T.any : T.unknown;
      }
      case 'mapHas':
        ty(e.target);
        ty(e.key);
        return T.bool;
      case 'len':
        ty(e.target);
        return T.int;
      case 'concat':
        e.parts.forEach(ty);
        return T.string;
      case 'convert':
        ty(e.e);
        return { int: T.int, float: T.float, string: T.string, bool: T.bool }[e.to];
      case 'input':
        ty(e.prompt);
        return e.numeric ? T.float : T.string;
      case 'math': {
        const ts = e.args.map(ty);
        if (e.fn === 'abs') return ts[0] ?? T.unknown;
        if (e.fn === 'floor' || e.fn === 'ceil' || e.fn === 'round') return T.int;
        if (e.fn === 'min' || e.fn === 'max') return ts.reduce((a, b) => unify(a, b), T.unknown);
        return T.float;
      }
      case 'random':
        ty(e.from);
        ty(e.to);
        return T.int;
      case 'strOp':
        e.args.forEach(ty);
        return e.op === 'contains' ? T.bool : T.string;
      case 'ternary':
        ty(e.cond);
        return unify(ty(e.a), ty(e.b));
      case 'fileRead':
        ty(e.path);
        return T.string;
      case 'fileExists':
        ty(e.path);
        return T.bool;
      case 'jsonParse':
        ty(e.e);
        return T.any;
      case 'jsonStringify':
        ty(e.e);
        return T.string;
      case 'httpGet':
        ty(e.url);
        return T.string;
      case 'shell':
        ty(e.cmd);
        return T.string;
      case 'field': {
        const tt = ty(e.target);
        if (tt.k === 'struct') {
          const f = classes.get(tt.name)?.fields.find((x) => x.name === e.name);
          if (f) return f.type;
        }
        return T.unknown;
      }
      case 'this':
        return cls ? T.struct(cls) : T.unknown;
      case 'new': {
        const c = classes.get(e.name);
        e.args.forEach(ty);
        return c ? T.struct(e.name) : T.unknown;
      }
      case 'method': {
        const tt = ty(e.target);
        e.args.forEach(ty);
        if (tt.k === 'struct') {
          const m = classes.get(tt.name)?.methods.find((x) => x.name === e.name);
          if (m) return m.ret;
        }
        return T.unknown;
      }
      case 'await':
        return ty(e.e);
      case 'funcRef':
        return T.func;
      case 'callRef':
        ty(e.fn);
        e.args.forEach(ty);
        return T.any;
      case 'addrOf':
        return T.ptr(typeOfVar(scope, e.name));
      case 'deref': {
        const tt = ty(e.e);
        return tt.k === 'ptr' ? tt.to : T.unknown;
      }
      case 'alloc':
        ty(e.count);
        return T.ptr(e.elem);
      case 'domGet':
        return T.string;
      case 'raw':
        return T.any;
      default:
        return T.unknown;
    }
  };

  const inferBlock = (block: Stmt[], scope: ScopeInfo, fn?: FuncDecl, cls?: string) => {
    const ty = (e: Expr) => typeOf(e, scope, cls);
    for (const s of block) {
      switch (s.k) {
        case 'varDecl': {
          const it = s.init ? ty(s.init) : T.unknown;
          const v = lookupVar(scope, s.name);
          if (s.declType && v) {
            if (!typeEq(v.type, s.declType)) {
              v.type = s.declType;
              changed = true;
            }
          } else widen(scope, s.name, it);
          break;
        }
        case 'assign':
          widen(scope, s.name, ty(s.value));
          break;
        case 'forRange': {
          const t = unify(unify(ty(s.from), ty(s.to)), ty(s.step));
          widen(scope, s.var, isNumeric(t) ? t : T.int);
          break;
        }
        case 'forEach': {
          const it = ty(s.iterable);
          widen(scope, s.var, it.k === 'list' ? it.of : it.k === 'string' ? T.string : it.k === 'any' ? T.any : T.unknown);
          break;
        }
        case 'listAppend': {
          const vt = ty(s.value);
          ty(s.list);
          if (s.list.k === 'var') widen(scope, s.list.name, T.list(vt));
          break;
        }
        case 'listSet': {
          ty(s.index);
          const vt = ty(s.value);
          const lt = ty(s.list);
          if (s.list.k === 'var' && lt.k !== 'ptr') widen(scope, s.list.name, T.list(vt));
          break;
        }
        case 'mapSet': {
          const kt = ty(s.key);
          const vt = ty(s.value);
          ty(s.map);
          if (s.map.k === 'var') widen(scope, s.map.name, T.map(kt, vt));
          break;
        }
        case 'try':
          widen(scope, s.errVar, T.string);
          break;
        case 'return':
          if (fn && s.value) {
            const rt = ty(s.value);
            if (!fn.explicitTypes && rt.k !== 'unknown') {
              const next = unify(fn.ret, rt);
              if (!typeEq(next, fn.ret)) {
                fn.ret = next;
                changed = true;
              }
            }
          }
          break;
        default:
          for (const e of stmtExprs(s)) ty(e);
      }
      for (const b of stmtBlocks(s)) inferBlock(b, scope, fn, cls);
    }
  };

  for (let pass = 0; pass < 16 && changed; pass++) {
    changed = false;
    for (const sc of scopes) inferBlock(sc.body, scopeInfos.get(sc.name)!, sc.func, sc.ownerClass);
    // Parameter types live on both the scope and the declaration.
    for (const sc of scopes) {
      if (!sc.func || sc.func.explicitTypes) continue;
      const info = scopeInfos.get(sc.name)!;
      for (const p of sc.func.params) {
        const vt = info.vars.get(p.name)?.type ?? T.unknown;
        if (!typeEq(vt, p.type)) {
          p.type = vt;
          changed = true;
        }
      }
    }
  }
  // Final pass so every node carries its settled type.
  for (const sc of scopes) inferBlock(sc.body, scopeInfos.get(sc.name)!, sc.func, sc.ownerClass);
  for (const f of program.funcs) if (f.ret.k === 'unknown') f.ret = T.void;

  for (const info of scopeInfos.values()) {
    for (const v of info.vars.values()) {
      if (v.type.k === 'any') report('info', 'analysis.mixedTypes', `Variable "${v.name}" holds values of different types (${typeToString(v.type)}).`, v.declNode?.id, { name: v.name });
    }
  }

  const funcs = new Map<string, FuncInfo>();
  const methods = new Map<string, FuncInfo>();
  for (const sc of scopes) {
    if (!sc.func) continue;
    const fi: FuncInfo = { decl: sc.func, scope: scopeInfos.get(sc.name)!, ownerClass: sc.ownerClass };
    if (sc.ownerClass) methods.set(sc.name, fi);
    else funcs.set(sc.name, fi);
  }
  if ([...funcs.values()].some((f) => f.scope.calls.has(f.decl.name))) features.add('recursion');

  return { main: scopeInfos.get('')!, funcs, methods, globals, classes, features, diagnostics, declAt };
}

/** True when a statement list contains the given statement kinds or expression kinds (not crossing into nested functions). */
export function containsKinds(stmts: Stmt[], stmtKinds: Set<string>, exprKinds: Set<string>): boolean {
  let found = false;
  walkStmts(
    stmts,
    (s) => {
      if (stmtKinds.has(s.k)) found = true;
    },
    (e) => {
      if (exprKinds.has(e.k)) found = true;
    },
  );
  return found;
}

/** True when a loop body contains a `continue` that belongs to this loop (not to a nested one). */
export function hasDirectContinue(body: Stmt[]): boolean {
  for (const s of body) {
    if (s.k === 'continue') return true;
    if (s.k === 'while' || s.k === 'repeat' || s.k === 'forRange' || s.k === 'forEach' || s.k === 'domOn') continue;
    if (stmtBlocks(s).some((b) => hasDirectContinue(b))) return true;
  }
  return false;
}

/** True when statements contain return, break or continue at any depth. */
export function hasControlFlow(body: Stmt[]): boolean {
  return containsKinds(body, new Set(['return', 'break', 'continue']), new Set());
}
