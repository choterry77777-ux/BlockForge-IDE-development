/**
 * Blockly JSON workspace serialisation types and pure helpers.
 * Everything here works on plain data so it runs in Node, workers and tests.
 */
import { BLOCKS } from './registry';

export interface BlockLink {
  block?: BlockState;
  shadow?: BlockState;
}

export interface BlockState {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, BlockLink>;
  next?: BlockLink;
  extraState?: Record<string, unknown>;
  enabled?: boolean;
  disabledReasons?: string[];
  collapsed?: boolean;
  data?: string;
  icons?: Record<string, unknown>;
}

export interface VariableState {
  name: string;
  id: string;
  type?: string;
}

export interface WorkspaceState {
  blocks?: { languageVersion?: number; blocks: BlockState[] };
  variables?: VariableState[];
}

export const emptyWorkspace = (): WorkspaceState => ({ blocks: { languageVersion: 0, blocks: [] }, variables: [] });

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function genId(length = 16): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return out;
}

export const linked = (l?: BlockLink): BlockState | undefined => l?.block ?? l?.shadow;

export function isEnabled(b: BlockState): boolean {
  if (b.enabled === false) return false;
  return !(b.disabledReasons && b.disabledReasons.length > 0);
}

/** Visit every block (including shadows) depth-first. */
export function walkBlocks(state: WorkspaceState, fn: (b: BlockState, parent?: BlockState) => void): void {
  const visit = (b: BlockState | undefined, parent?: BlockState) => {
    if (!b) return;
    fn(b, parent);
    for (const link of Object.values(b.inputs ?? {})) visit(linked(link), b);
    visit(linked(b.next), b);
  };
  for (const top of state.blocks?.blocks ?? []) visit(top);
}

export function findBlock(state: WorkspaceState, id: string): BlockState | undefined {
  let found: BlockState | undefined;
  walkBlocks(state, (b) => {
    if (b.id === id) found = b;
  });
  return found;
}

export function countBlocks(state: WorkspaceState): number {
  let n = 0;
  walkBlocks(state, () => n++);
  return n;
}

/** Follow next-links from a block and return the whole stack. */
export function stackOf(first: BlockState | undefined): BlockState[] {
  const out: BlockState[] = [];
  let cur = first;
  while (cur) {
    out.push(cur);
    cur = linked(cur.next);
  }
  return out;
}

// ---------- compact block specs ----------

/**
 * Compact, human and model friendly description of a block tree. Used by
 * templates, tests and AI block operations, and expanded into Blockly state.
 */
export interface BlockSpec {
  type: string;
  id?: string;
  /** Field values. Variable fields take the variable name. */
  fields?: Record<string, string | number | boolean>;
  /** Value inputs. */
  inputs?: Record<string, BlockSpec>;
  /** Statement inputs, each an ordered stack. */
  statements?: Record<string, BlockSpec[]>;
  /** Parameter names, for function definitions. */
  params?: string[];
  shadow?: boolean;
}

export interface SpecContext {
  variables: VariableState[];
  /** Known function signatures: name -> parameter names. */
  procedures: Map<string, string[]>;
  idFactory?: () => string;
}

export function newSpecContext(state?: WorkspaceState): SpecContext {
  const ctx: SpecContext = { variables: [...(state?.variables ?? [])], procedures: new Map() };
  if (state) {
    walkBlocks(state, (b) => {
      if (b.type === 'procedures_defnoreturn' || b.type === 'procedures_defreturn') {
        const params = ((b.extraState?.params as { name: string }[]) ?? []).map((p) => p.name);
        ctx.procedures.set(String(b.fields?.NAME ?? ''), params);
      }
    });
  }
  return ctx;
}

export function variableId(ctx: SpecContext, name: string): string {
  let v = ctx.variables.find((x) => x.name === name);
  if (!v) {
    v = { name, id: (ctx.idFactory ?? genId)() };
    ctx.variables.push(v);
  }
  return v.id;
}

/** Register function definitions found in specs so calls can resolve their parameters. */
export function collectProcedures(specs: BlockSpec[], ctx: SpecContext): void {
  const visit = (s: BlockSpec) => {
    if (s.type === 'procedures_defnoreturn' || s.type === 'procedures_defreturn') {
      ctx.procedures.set(String(s.fields?.NAME ?? ''), s.params ?? []);
    }
    Object.values(s.inputs ?? {}).forEach(visit);
    Object.values(s.statements ?? {}).forEach((list) => list.forEach(visit));
  };
  specs.forEach(visit);
}

export function specToBlock(spec: BlockSpec, ctx: SpecContext): BlockState {
  const meta = BLOCKS[spec.type];
  const mk = ctx.idFactory ?? genId;
  const block: BlockState = { type: spec.type, id: spec.id ?? mk() };
  const fields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(spec.fields ?? {})) {
    if (meta?.fields[name]?.kind === 'var') fields[name] = { id: variableId(ctx, String(value)) };
    else if (meta?.fields[name]?.kind === 'check') fields[name] = value === true || value === 'TRUE';
    else fields[name] = value;
  }
  if (Object.keys(fields).length) block.fields = fields;

  const inputs: Record<string, BlockLink> = {};
  for (const [name, child] of Object.entries(spec.inputs ?? {})) {
    const b = specToBlock(child, ctx);
    inputs[name] = child.shadow ? { shadow: b } : { block: b };
  }
  for (const [name, list] of Object.entries(spec.statements ?? {})) {
    const chain = chainSpecs(list, ctx);
    if (chain) inputs[name] = { block: chain };
  }
  if (Object.keys(inputs).length) block.inputs = inputs;

  const names = [...Object.keys(spec.inputs ?? {}), ...Object.keys(spec.statements ?? {})];
  switch (meta?.dynamic) {
    case 'items': {
      const max = names.reduce((m, n) => Math.max(m, /^ADD(\d+)$/.test(n) ? Number(n.slice(3)) + 1 : 0), 0);
      block.extraState = { itemCount: max };
      break;
    }
    case 'if': {
      const elseIfCount = names.reduce((m, n) => Math.max(m, /^(IF|DO)(\d+)$/.test(n) ? Number(n.replace(/\D/g, '')) : 0), 0);
      const hasElse = names.includes('ELSE');
      if (elseIfCount || hasElse) block.extraState = { ...(elseIfCount ? { elseIfCount } : {}), ...(hasElse ? { hasElse: true } : {}) };
      break;
    }
    case 'procDef': {
      const params = (spec.params ?? []).map((name) => ({ name, id: variableId(ctx, name) }));
      block.extraState = { ...(params.length ? { params } : {}), hasStatements: true };
      ctx.procedures.set(String(spec.fields?.NAME ?? ''), spec.params ?? []);
      break;
    }
    case 'procCall': {
      const name = String(spec.fields?.NAME ?? '');
      delete block.fields;
      const params = ctx.procedures.get(name) ?? names.filter((n) => /^ARG\d+$/.test(n)).map((_, i) => `arg${i}`);
      block.extraState = { name, ...(params.length ? { params } : {}) };
      break;
    }
  }
  return block;
}

export function chainSpecs(list: BlockSpec[], ctx: SpecContext): BlockState | undefined {
  let first: BlockState | undefined;
  let prev: BlockState | undefined;
  for (const spec of list) {
    const b = specToBlock(spec, ctx);
    if (!first) first = b;
    if (prev) prev.next = { block: b };
    prev = b;
  }
  return first;
}

/** Build a full workspace from top-level stacks. */
export function specsToWorkspace(stacks: BlockSpec[][], idFactory?: () => string): WorkspaceState {
  const ctx: SpecContext = { variables: [], procedures: new Map(), idFactory };
  for (const stack of stacks) collectProcedures(stack, ctx);
  const tops: BlockState[] = [];
  let y = 24;
  for (const stack of stacks) {
    const top = chainSpecs(stack, ctx);
    if (!top) continue;
    top.x = 24;
    top.y = y;
    y += 60 + estimateHeight(stack) * 34;
    tops.push(top);
  }
  return { blocks: { languageVersion: 0, blocks: tops }, variables: ctx.variables };
}

function estimateHeight(stack: BlockSpec[]): number {
  let n = 0;
  for (const s of stack) {
    n += 1;
    for (const list of Object.values(s.statements ?? {})) n += estimateHeight(list) + 0.5;
  }
  return n;
}

/** Convert a Blockly block back into a compact spec (used for AI context). */
export function blockToSpec(b: BlockState, vars: VariableState[]): BlockSpec {
  const meta = BLOCKS[b.type];
  const spec: BlockSpec = { type: b.type, id: b.id };
  const fields: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(b.fields ?? {})) {
    if (value && typeof value === 'object' && 'id' in (value as object)) {
      const id = (value as { id: string }).id;
      fields[name] = vars.find((v) => v.id === id)?.name ?? (value as { name?: string }).name ?? id;
    } else fields[name] = value as string | number | boolean;
  }
  if (meta?.dynamic === 'procCall') fields.NAME = String(b.extraState?.name ?? '');
  if (Object.keys(fields).length) spec.fields = fields;
  if (meta?.dynamic === 'procDef') spec.params = ((b.extraState?.params as { name: string }[]) ?? []).map((p) => p.name);
  for (const [name, link] of Object.entries(b.inputs ?? {})) {
    const child = linked(link);
    if (!child) continue;
    const isStmt = meta ? !!meta.stmts[name] || /^DO\d+$/.test(name) || name === 'ELSE' : false;
    if (isStmt) (spec.statements ??= {})[name] = stackOf(child).map((c) => blockToSpec(c, vars));
    else (spec.inputs ??= {})[name] = blockToSpec(child, vars);
  }
  return spec;
}

export function workspaceToSpecs(state: WorkspaceState): BlockSpec[][] {
  const vars = state.variables ?? [];
  return (state.blocks?.blocks ?? []).map((top) => stackOf(top).map((b) => blockToSpec(b, vars)));
}
