/**
 * Structured, validated block edits proposed by an AI model.
 *
 * Model output is never applied to Blockly directly. It is parsed against this
 * schema, applied to a copy of the workspace state, and the result is validated
 * as a whole before the user is shown a preview.
 */
import { BLOCKS } from '../blocks/registry';
import { type BlockLink, type BlockSpec, type BlockState, chainSpecs, collectProcedures, linked, newSpecContext, type SpecContext, specToBlock, stackOf, variableId, type WorkspaceState } from '../blocks/state';
import { type Issue, validateSpec, validateStack, validateWorkspace } from '../blocks/validate';
import type { Domain } from '../types';

export type BlockOp =
  | { op: 'add_stack'; blocks: BlockSpec[] }
  | { op: 'append'; target: string; blocks: BlockSpec[] }
  | { op: 'insert_into'; parent: string; input: string; blocks: BlockSpec[]; position?: 'start' | 'end' }
  | { op: 'set_input'; parent: string; input: string; block: BlockSpec }
  | { op: 'replace'; target: string; blocks: BlockSpec[] }
  | { op: 'delete'; target: string; withFollowing?: boolean }
  | { op: 'set_field'; target: string; field: string; value: string | number | boolean }
  | { op: 'connect'; child: string; parent: string; input?: string }
  | { op: 'disconnect'; target: string }
  | { op: 'create_variable'; name: string }
  | { op: 'create_function'; name: string; params?: string[]; body?: BlockSpec[]; returns?: BlockSpec }
  | { op: 'clear' };

export const DESTRUCTIVE_OPS = new Set<BlockOp['op']>(['delete', 'replace', 'clear', 'disconnect']);

const MAX_OPS = 200;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 200;

export interface ParsedOps {
  ops: BlockOp[];
  issues: Issue[];
}

/** Check the shape of model output. Unknown operations and properties are rejected. */
export function parseBlockOps(input: unknown): ParsedOps {
  const issues: Issue[] = [];
  const ops: BlockOp[] = [];
  const list = isObj(input) && Array.isArray(input.ops) ? input.ops : input;
  if (!Array.isArray(list)) return { ops, issues: [{ path: 'ops', message: 'expected a list of operations' }] };
  if (list.length > MAX_OPS) return { ops, issues: [{ path: 'ops', message: `too many operations (limit ${MAX_OPS})` }] };
  list.forEach((raw, i) => {
    const path = `ops[${i}]`;
    const bad = (message: string) => issues.push({ path, message });
    if (!isObj(raw) || typeof raw.op !== 'string') return bad('an operation needs an "op" name');
    const specs = (key: string, required = true): BlockSpec[] | undefined => {
      const v = raw[key];
      if (v === undefined && !required) return [];
      if (!Array.isArray(v) || (required && v.length === 0)) {
        bad(`"${key}" must be a non-empty list of blocks`);
        return undefined;
      }
      return v as BlockSpec[];
    };
    const allow = (...keys: string[]) => {
      for (const k of Object.keys(raw)) if (k !== 'op' && !keys.includes(k)) bad(`unknown property "${k}" for ${String(raw.op)}`);
    };
    switch (raw.op) {
      case 'add_stack': {
        allow('blocks');
        const blocks = specs('blocks');
        if (blocks) ops.push({ op: 'add_stack', blocks });
        break;
      }
      case 'append': {
        allow('target', 'blocks');
        const blocks = specs('blocks');
        if (!isStr(raw.target)) bad('"target" must be a block id');
        else if (blocks) ops.push({ op: 'append', target: raw.target, blocks });
        break;
      }
      case 'insert_into': {
        allow('parent', 'input', 'blocks', 'position');
        const blocks = specs('blocks');
        if (!isStr(raw.parent) || !isStr(raw.input)) bad('"parent" and "input" are required');
        else if (raw.position !== undefined && raw.position !== 'start' && raw.position !== 'end') bad('"position" must be "start" or "end"');
        else if (blocks) ops.push({ op: 'insert_into', parent: raw.parent, input: raw.input, blocks, position: raw.position as 'start' | 'end' | undefined });
        break;
      }
      case 'set_input':
        allow('parent', 'input', 'block');
        if (!isStr(raw.parent) || !isStr(raw.input) || !isObj(raw.block)) bad('"parent", "input" and "block" are required');
        else ops.push({ op: 'set_input', parent: raw.parent, input: raw.input, block: raw.block as unknown as BlockSpec });
        break;
      case 'replace': {
        allow('target', 'blocks');
        const blocks = specs('blocks');
        if (!isStr(raw.target)) bad('"target" must be a block id');
        else if (blocks) ops.push({ op: 'replace', target: raw.target, blocks });
        break;
      }
      case 'delete':
        allow('target', 'withFollowing');
        if (!isStr(raw.target)) bad('"target" must be a block id');
        else ops.push({ op: 'delete', target: raw.target, withFollowing: raw.withFollowing === true });
        break;
      case 'set_field':
        allow('target', 'field', 'value');
        if (!isStr(raw.target) || !isStr(raw.field) || !['string', 'number', 'boolean'].includes(typeof raw.value)) bad('"target", "field" and a primitive "value" are required');
        else ops.push({ op: 'set_field', target: raw.target, field: raw.field, value: raw.value as string });
        break;
      case 'connect':
        allow('child', 'parent', 'input');
        if (!isStr(raw.child) || !isStr(raw.parent) || (raw.input !== undefined && !isStr(raw.input))) bad('"child" and "parent" are required');
        else ops.push({ op: 'connect', child: raw.child, parent: raw.parent, input: raw.input as string | undefined });
        break;
      case 'disconnect':
        allow('target');
        if (!isStr(raw.target)) bad('"target" must be a block id');
        else ops.push({ op: 'disconnect', target: raw.target });
        break;
      case 'create_variable':
        allow('name');
        if (!isStr(raw.name)) bad('"name" is required');
        else ops.push({ op: 'create_variable', name: raw.name });
        break;
      case 'create_function': {
        allow('name', 'params', 'body', 'returns');
        const params = raw.params === undefined ? [] : raw.params;
        if (!isStr(raw.name)) bad('"name" is required');
        else if (!Array.isArray(params) || params.some((p) => !isStr(p))) bad('"params" must be a list of names');
        else if (raw.returns !== undefined && !isObj(raw.returns)) bad('"returns" must be a block');
        else {
          const body = specs('body', false);
          if (body) ops.push({ op: 'create_function', name: raw.name, params: params as string[], body, returns: raw.returns as unknown as BlockSpec | undefined });
        }
        break;
      }
      case 'clear':
        allow();
        ops.push({ op: 'clear' });
        break;
      default:
        bad(`unknown operation "${raw.op}"`);
    }
  });
  return { ops, issues };
}

// ---------- applying ----------

interface Location {
  block: BlockState;
  /** The link object holding this block, or undefined for top-level blocks. */
  link?: BlockLink;
  parent?: BlockState;
  input?: string;
  topIndex?: number;
}

function locate(state: WorkspaceState, id: string): Location | undefined {
  let found: Location | undefined;
  const visit = (b: BlockState, loc: Omit<Location, 'block'>) => {
    if (found) return;
    if (b.id === id) {
      found = { block: b, ...loc };
      return;
    }
    for (const [name, link] of Object.entries(b.inputs ?? {})) {
      const child = linked(link);
      if (child) visit(child, { link, parent: b, input: name });
    }
    const next = linked(b.next);
    if (next) visit(next, { link: b.next, parent: b });
  };
  (state.blocks?.blocks ?? []).forEach((top, i) => visit(top, { topIndex: i }));
  return found;
}

function lastOf(first: BlockState): BlockState {
  const stack = stackOf(first);
  return stack[stack.length - 1];
}

function nextY(state: WorkspaceState): number {
  let y = 24;
  for (const top of state.blocks?.blocks ?? []) y = Math.max(y, (top.y ?? 0) + 60 + stackOf(top).length * 40);
  return y;
}

export interface AppliedOps {
  ok: boolean;
  state: WorkspaceState;
  issues: Issue[];
  /** Ids of blocks created by the operations, for highlighting in the preview. */
  created: string[];
  removed: string[];
  destructive: boolean;
}

/** Apply operations to a copy of the workspace. The input state is never modified. */
export function applyBlockOps(source: WorkspaceState, ops: BlockOp[], domain?: Domain, idFactory?: () => string): AppliedOps {
  const state: WorkspaceState = JSON.parse(JSON.stringify(source));
  state.blocks ??= { languageVersion: 0, blocks: [] };
  state.variables ??= [];
  const issues: Issue[] = [];
  const created: string[] = [];
  const removed: string[] = [];
  const ctx: SpecContext = { ...newSpecContext(state), variables: state.variables, idFactory };
  const before = new Set<string>();
  const collect = (b: BlockState | undefined, into: Set<string> | string[]) => {
    if (!b) return;
    if (b.id) Array.isArray(into) ? into.push(b.id) : into.add(b.id);
    for (const l of Object.values(b.inputs ?? {})) collect(linked(l), into);
    collect(linked(b.next), into);
  };
  for (const top of state.blocks.blocks) collect(top, before);

  // Functions defined anywhere in this batch are known to calls in earlier operations.
  for (const op of ops) {
    if ('blocks' in op && Array.isArray(op.blocks)) collectProcedures(op.blocks, ctx);
    if (op.op === 'create_function') ctx.procedures.set(op.name, op.params ?? []);
  }

  ops.forEach((op, i) => {
    const path = `ops[${i}]`;
    const fail = (message: string, blockId?: string) => issues.push({ path, message, blockId });
    const find = (id: string): Location | undefined => {
      const loc = locate(state, id);
      if (!loc) fail(`there is no block with id "${id}"`);
      return loc;
    };
    const stmtCheck = (meta: (typeof BLOCKS)[string], input: string) => meta.stmts[input]?.check ?? (meta.dynamic === 'if' ? 'Stmt' : undefined);
    const build = (specs: BlockSpec[], check?: string): BlockState | undefined => {
      const problems = validateStack(specs, `${path}.blocks`, check);
      if (problems.length) {
        issues.push(...problems);
        return undefined;
      }
      return chainSpecs(specs, ctx);
    };
    const detach = (loc: Location) => {
      if (loc.topIndex !== undefined) state.blocks!.blocks.splice(loc.topIndex, 1);
      else if (loc.link) {
        if (loc.input && loc.parent?.inputs) delete loc.parent.inputs[loc.input];
        else if (loc.parent) delete loc.parent.next;
      }
    };
    switch (op.op) {
      case 'add_stack': {
        const problems = op.blocks.flatMap((s, j) => validateSpec(s, `${path}.blocks[${j}]`));
        const head = BLOCKS[op.blocks[0]?.type];
        // A free-standing stack may start with any block; the rest must be able to follow it.
        const tail = validateStack(op.blocks.slice(1), `${path}.blocks`, typeof head?.next === 'string' ? head.next : undefined);
        if (head?.next === false && op.blocks.length > 1) problems.push({ path, message: `nothing can follow ${head.type}` });
        if (problems.length || tail.length) {
          issues.push(...problems, ...tail.filter((t) => !problems.some((p) => p.message === t.message && p.path === t.path)));
          return;
        }
        const top = chainSpecs(op.blocks, ctx)!;
        top.x = 24;
        top.y = nextY(state);
        state.blocks!.blocks.push(top);
        break;
      }
      case 'create_function': {
        const spec: BlockSpec = { type: op.returns ? 'procedures_defreturn' : 'procedures_defnoreturn', fields: { NAME: op.name }, params: op.params ?? [], statements: { STACK: op.body ?? [] }, inputs: op.returns ? { RETURN: op.returns } : {} };
        const problems = validateSpec(spec, path);
        if (problems.length) {
          issues.push(...problems);
          return;
        }
        const top = specToBlock(spec, ctx);
        top.x = 24;
        top.y = nextY(state);
        state.blocks!.blocks.push(top);
        break;
      }
      case 'append': {
        const loc = find(op.target);
        if (!loc) return;
        const meta = BLOCKS[loc.block.type];
        if (!meta || meta.next === false || meta.output !== undefined) return fail(`nothing can be attached below ${loc.block.type}`, op.target);
        const chain = build(op.blocks, typeof meta.next === 'string' ? meta.next : undefined);
        if (!chain) return;
        const following = linked(loc.block.next);
        const tail = lastOf(chain);
        if (following) {
          if (BLOCKS[tail.type]?.next === false) return fail(`nothing can follow ${tail.type}, but blocks come after the insertion point`, op.target);
          tail.next = { block: following };
        }
        loc.block.next = { block: chain };
        break;
      }
      case 'insert_into': {
        const loc = find(op.parent);
        if (!loc) return;
        const meta = BLOCKS[loc.block.type];
        const check = meta ? stmtCheck(meta, op.input) : undefined;
        const isStmt = !!meta && (!!meta.stmts[op.input] || (meta.dynamic === 'if' && (/^DO\d+$/.test(op.input) || op.input === 'ELSE')));
        if (!isStmt) return fail(`"${op.input}" is not a statement input of ${loc.block.type}`, op.parent);
        const chain = build(op.blocks, check);
        if (!chain) return;
        loc.block.inputs ??= {};
        const existing = linked(loc.block.inputs[op.input]);
        if (!existing) loc.block.inputs[op.input] = { block: chain };
        else if (op.position === 'start') {
          const tail = lastOf(chain);
          if (BLOCKS[tail.type]?.next === false) return fail(`nothing can follow ${tail.type}`, op.parent);
          tail.next = { block: existing };
          loc.block.inputs[op.input] = { block: chain };
        } else {
          const tail = lastOf(existing);
          if (BLOCKS[tail.type]?.next === false) return fail(`nothing can follow ${tail.type}`, tail.id);
          tail.next = { block: chain };
        }
        if (meta?.dynamic === 'if') {
          const m = /^DO(\d+)$/.exec(op.input);
          loc.block.extraState = { ...(loc.block.extraState ?? {}), ...(op.input === 'ELSE' ? { hasElse: true } : {}), ...(m && Number(m[1]) > Number(loc.block.extraState?.elseIfCount ?? 0) ? { elseIfCount: Number(m[1]) } : {}) };
        }
        break;
      }
      case 'set_input': {
        const loc = find(op.parent);
        if (!loc) return;
        const problems = validateSpec({ type: loc.block.type, inputs: { [op.input]: op.block } } as BlockSpec, path);
        if (problems.length) {
          issues.push(...problems);
          return;
        }
        loc.block.inputs ??= {};
        collect(linked(loc.block.inputs[op.input]), removed);
        loc.block.inputs[op.input] = { block: specToBlock(op.block, ctx) };
        const meta = BLOCKS[loc.block.type];
        const num = Number(/\d+$/.exec(op.input)?.[0] ?? -1);
        if (meta?.dynamic === 'items' && num >= Number(loc.block.extraState?.itemCount ?? 0)) loc.block.extraState = { ...(loc.block.extraState ?? {}), itemCount: num + 1 };
        if (meta?.dynamic === 'if' && num > Number(loc.block.extraState?.elseIfCount ?? 0)) loc.block.extraState = { ...(loc.block.extraState ?? {}), elseIfCount: num };
        break;
      }
      case 'replace': {
        const loc = find(op.target);
        if (!loc) return;
        const meta = BLOCKS[loc.block.type];
        const isValue = meta?.output !== undefined;
        if (isValue) {
          if (op.blocks.length !== 1) return fail('a value block can only be replaced by one block', op.target);
          const problems = loc.parent && loc.input ? validateSpec({ type: loc.parent.type, inputs: { [loc.input]: op.blocks[0] } } as BlockSpec, path) : validateSpec(op.blocks[0], path);
          if (problems.length) {
            issues.push(...problems);
            return;
          }
          const fresh = specToBlock(op.blocks[0], ctx);
          collect({ ...loc.block, next: undefined }, removed);
          if (loc.link) loc.link.block = fresh;
          else {
            fresh.x = loc.block.x;
            fresh.y = loc.block.y;
            state.blocks!.blocks[loc.topIndex!] = fresh;
          }
          if (loc.link?.shadow && loc.link.block) delete loc.link.shadow;
        } else {
          const following = linked(loc.block.next);
          const chain = build(op.blocks, loc.topIndex !== undefined ? undefined : meta?.prev);
          if (!chain) return;
          const tail = lastOf(chain);
          if (following) {
            if (BLOCKS[tail.type]?.next === false) return fail(`nothing can follow ${tail.type}, but blocks come after the replaced block`, op.target);
            tail.next = { block: following };
          }
          collect({ ...loc.block, next: undefined }, removed);
          if (loc.link) loc.link.block = chain;
          else {
            chain.x = loc.block.x;
            chain.y = loc.block.y;
            state.blocks!.blocks[loc.topIndex!] = chain;
          }
        }
        break;
      }
      case 'delete': {
        const loc = find(op.target);
        if (!loc) return;
        const following = op.withFollowing ? undefined : linked(loc.block.next);
        const isValue = BLOCKS[loc.block.type]?.output !== undefined;
        collect(op.withFollowing ? loc.block : { ...loc.block, next: undefined }, removed);
        if (following && !isValue) {
          // Heal the stack so the blocks below stay attached.
          if (loc.link) loc.link.block = following;
          else {
            following.x = loc.block.x;
            following.y = loc.block.y;
            state.blocks!.blocks[loc.topIndex!] = following;
          }
        } else detach(loc);
        break;
      }
      case 'set_field': {
        const loc = find(op.target);
        if (!loc) return;
        const meta = BLOCKS[loc.block.type];
        const problems = validateSpec({ type: loc.block.type, fields: { [op.field]: op.value } } as BlockSpec, path);
        if (problems.length) {
          issues.push(...problems.filter((p) => !/NAME field/.test(p.message)));
          if (problems.some((p) => !/NAME field/.test(p.message))) return;
        }
        loc.block.fields ??= {};
        if (meta?.fields[op.field]?.kind === 'var') loc.block.fields[op.field] = { id: variableId(ctx, String(op.value)) };
        else loc.block.fields[op.field] = op.value;
        break;
      }
      case 'connect': {
        const child = find(op.child);
        if (!child) return;
        if (locate({ blocks: { blocks: [child.block] } }, op.parent)) return fail('a block cannot be connected inside itself', op.child);
        const moving = child.block;
        detach(child);
        const parent = find(op.parent);
        if (!parent) return;
        const pm = BLOCKS[parent.block.type];
        delete moving.x;
        delete moving.y;
        if (op.input) {
          parent.block.inputs ??= {};
          const existing = linked(parent.block.inputs[op.input]);
          const isStmt = !!pm?.stmts[op.input] || /^DO\d+$/.test(op.input) || op.input === 'ELSE';
          if (isStmt && existing) lastOf(existing).next = { block: moving };
          else {
            collect(existing, removed);
            parent.block.inputs[op.input] = { block: moving };
          }
        } else {
          const following = linked(parent.block.next);
          if (following) lastOf(moving).next = { block: following };
          parent.block.next = { block: moving };
        }
        break;
      }
      case 'disconnect': {
        const loc = find(op.target);
        if (!loc) return;
        if (loc.topIndex !== undefined) return;
        detach(loc);
        loc.block.x = 24;
        loc.block.y = nextY(state);
        state.blocks!.blocks.push(loc.block);
        break;
      }
      case 'create_variable':
        variableId(ctx, op.name);
        break;
      case 'clear':
        for (const top of state.blocks!.blocks) collect(top, removed);
        state.blocks!.blocks = [];
        break;
    }
  });

  // The result as a whole must be a well-formed workspace.
  if (!issues.length) issues.push(...validateWorkspace(state, domain));
  for (const top of state.blocks.blocks) {
    const all: string[] = [];
    collect(top, all);
    for (const id of all) if (!before.has(id)) created.push(id);
  }
  return { ok: issues.length === 0, state: issues.length ? source : state, issues, created, removed: [...new Set(removed)].filter((id) => before.has(id)), destructive: ops.some((o) => DESTRUCTIVE_OPS.has(o.op)) };
}

/** One-line human summaries of each operation, for the review panel. */
export function describeOps(ops: BlockOp[]): { op: BlockOp['op']; count: number; detail: string }[] {
  const count = (specs: BlockSpec[] | undefined): number => (specs ?? []).reduce((n, s) => n + 1 + count(Object.values(s.inputs ?? {})) + Object.values(s.statements ?? {}).reduce((m, l) => m + count(l), 0), 0);
  return ops.map((o) => {
    switch (o.op) {
      case 'add_stack':
      case 'append':
      case 'insert_into':
      case 'replace':
        return { op: o.op, count: count(o.blocks), detail: o.blocks.map((b) => b.type).slice(0, 4).join(', ') };
      case 'set_input':
        return { op: o.op, count: count([o.block]), detail: `${o.input}: ${o.block.type}` };
      case 'set_field':
        return { op: o.op, count: 0, detail: `${o.field} = ${String(o.value)}` };
      case 'create_function':
        return { op: o.op, count: count(o.body) + 1, detail: `${o.name}(${(o.params ?? []).join(', ')})` };
      case 'create_variable':
        return { op: o.op, count: 0, detail: o.name };
      case 'connect':
        return { op: o.op, count: 0, detail: o.input ?? 'next' };
      default:
        return { op: o.op, count: 0, detail: '' };
    }
  });
}
