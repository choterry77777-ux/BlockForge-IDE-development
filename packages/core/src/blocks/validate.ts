import type { Domain } from '../types';
import { blockAllowedInDomain, BLOCKS, checksCompatible, inputCheck, inputKind, type BlockMeta } from './registry';
import { type BlockSpec, type BlockState, linked, type WorkspaceState } from './state';

export interface Issue {
  message: string;
  blockId?: string;
  path: string;
}

const MAX_BLOCKS = 2000;

function fieldProblem(meta: BlockMeta, name: string, value: unknown): string | undefined {
  const f = meta.fields[name];
  if (!f) {
    // Procedure call names live in extra state; NAME is tolerated in specs.
    if (meta.dynamic === 'procCall' && name === 'NAME') return undefined;
    return `unknown field "${name}"`;
  }
  switch (f.kind) {
    case 'drop':
      return f.options && !f.options.includes(String(value)) ? `"${String(value)}" is not an option of ${name} (${f.options.join(', ')})` : undefined;
    case 'num': {
      const v = Number(value);
      if (!Number.isFinite(v)) return `${name} must be a number`;
      if (f.min !== undefined && v < f.min) return `${name} must be at least ${f.min}`;
      if (f.max !== undefined && v > f.max) return `${name} must be at most ${f.max}`;
      if (f.int && !Number.isInteger(v)) return `${name} must be a whole number`;
      return undefined;
    }
    case 'check':
      return typeof value === 'boolean' || value === 'TRUE' || value === 'FALSE' ? undefined : `${name} must be true or false`;
    case 'text':
      return typeof value === 'object' ? `${name} must be text` : undefined;
    case 'var':
      return undefined;
  }
}

/** Validate a compact block spec tree before it is expanded into Blockly state. */
export function validateSpec(spec: unknown, path = 'block', issues: Issue[] = [], counter = { n: 0 }): Issue[] {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    issues.push({ path, message: 'a block must be an object' });
    return issues;
  }
  const s = spec as BlockSpec;
  if (++counter.n > MAX_BLOCKS) {
    if (counter.n === MAX_BLOCKS + 1) issues.push({ path, message: `too many blocks (limit ${MAX_BLOCKS})` });
    return issues;
  }
  const meta = BLOCKS[s.type];
  if (typeof s.type !== 'string' || !meta) {
    issues.push({ path, message: `unknown block type "${String(s.type)}"` });
    return issues;
  }
  for (const key of Object.keys(s)) {
    if (!['type', 'id', 'fields', 'inputs', 'statements', 'params', 'shadow'].includes(key)) issues.push({ path, message: `unknown property "${key}"` });
  }
  if (s.fields !== undefined && (typeof s.fields !== 'object' || Array.isArray(s.fields))) issues.push({ path, message: 'fields must be an object' });
  else {
    for (const [name, value] of Object.entries(s.fields ?? {})) {
      const problem = fieldProblem(meta, name, value);
      if (problem) issues.push({ path: `${path}.fields.${name}`, message: problem });
    }
  }
  if (s.params !== undefined && (!Array.isArray(s.params) || s.params.some((p) => typeof p !== 'string' || !p.trim()))) issues.push({ path, message: 'params must be a list of names' });
  if (meta.dynamic === 'procDef' && !String(s.fields?.NAME ?? '').trim()) issues.push({ path, message: 'a function needs a NAME field' });
  if (meta.dynamic === 'procCall' && !String(s.fields?.NAME ?? '').trim()) issues.push({ path, message: 'a function call needs a NAME field' });
  for (const [name, child] of Object.entries(s.inputs ?? {})) {
    const p = `${path}.inputs.${name}`;
    if (inputKind(meta, name) !== 'value') {
      issues.push({ path: p, message: `"${name}" is not a value input of ${s.type}` });
      continue;
    }
    validateSpec(child, p, issues, counter);
    const cm = BLOCKS[(child as BlockSpec)?.type];
    if (cm) {
      if (cm.output === undefined) issues.push({ path: p, message: `${cm.type} is a statement block and cannot be used as a value` });
      else if (!checksCompatible(cm.output, inputCheck(meta, name))) issues.push({ path: p, message: `${cm.type} produces ${cm.output?.join('/') ?? 'any'} but ${name} expects ${inputCheck(meta, name)?.join('/')}` });
    }
  }
  for (const [name, list] of Object.entries(s.statements ?? {})) {
    const p = `${path}.statements.${name}`;
    if (inputKind(meta, name) !== 'stmt') {
      issues.push({ path: p, message: `"${name}" is not a statement input of ${s.type}` });
      continue;
    }
    if (!Array.isArray(list)) {
      issues.push({ path: p, message: 'a statement input takes a list of blocks' });
      continue;
    }
    validateStack(list, p, inputCheck(meta, name)?.[0], issues, counter);
  }
  return issues;
}

/** Validate an ordered stack of statement specs for a given connection check. */
export function validateStack(list: unknown[], path: string, check: string | undefined, issues: Issue[] = [], counter = { n: 0 }): Issue[] {
  list.forEach((child, i) => {
    const p = `${path}[${i}]`;
    validateSpec(child, p, issues, counter);
    const cm = BLOCKS[(child as BlockSpec)?.type];
    if (!cm) return;
    if (cm.prev === undefined) issues.push({ path: p, message: `${cm.type} cannot be stacked inside another block` });
    else if (check && cm.prev !== check) issues.push({ path: p, message: `${cm.type} does not fit here (expected a ${check} block)` });
    if (i < list.length - 1 && cm.next === false) issues.push({ path: p, message: `nothing can follow ${cm.type}` });
  });
  return issues;
}

/** Structural validation of a full Blockly workspace state. */
export function validateWorkspace(state: WorkspaceState, domain?: Domain): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const varIds = new Set((state.variables ?? []).map((v) => v.id));
  const procs = new Map<string, number>();
  let count = 0;

  const scan = (b: BlockState | undefined) => {
    if (!b) return;
    if ((b.type === 'procedures_defnoreturn' || b.type === 'procedures_defreturn') && b.fields?.NAME) procs.set(String(b.fields.NAME), ((b.extraState?.params as unknown[]) ?? []).length);
    for (const l of Object.values(b.inputs ?? {})) scan(linked(l));
    scan(linked(b.next));
  };
  for (const top of state.blocks?.blocks ?? []) scan(top);

  const visit = (b: BlockState, path: string, expectValue: boolean, check: string[] | undefined) => {
    if (++count > MAX_BLOCKS) {
      if (count === MAX_BLOCKS + 1) issues.push({ path, message: `too many blocks (limit ${MAX_BLOCKS})` });
      return;
    }
    const meta = BLOCKS[b.type];
    if (!meta) {
      issues.push({ path, blockId: b.id, message: `unknown block type "${b.type}"` });
      return;
    }
    if (b.id) {
      if (ids.has(b.id)) issues.push({ path, blockId: b.id, message: `duplicate block id "${b.id}"` });
      ids.add(b.id);
    }
    if (domain && !blockAllowedInDomain(b.type, domain)) issues.push({ path, blockId: b.id, message: `${b.type} does not belong in a ${domain} program` });
    if (expectValue) {
      if (meta.output === undefined) issues.push({ path, blockId: b.id, message: `${b.type} is a statement block and cannot be used as a value` });
      else if (!checksCompatible(meta.output, check)) issues.push({ path, blockId: b.id, message: `${b.type} does not fit this input (expected ${check?.join('/')})` });
      if (b.next) issues.push({ path, blockId: b.id, message: 'a value block cannot have a following block' });
    }
    for (const [name, value] of Object.entries(b.fields ?? {})) {
      if (meta.fields[name]?.kind === 'var') {
        const id = (value as { id?: string })?.id;
        if (id && !varIds.has(id)) issues.push({ path, blockId: b.id, message: `field ${name} refers to a variable that does not exist` });
        continue;
      }
      const problem = fieldProblem(meta, name, value);
      if (problem) issues.push({ path: `${path}.fields.${name}`, blockId: b.id, message: problem });
    }
    if (meta.dynamic === 'procCall') {
      const name = String(b.extraState?.name ?? '');
      const expected = procs.get(name);
      const got = ((b.extraState?.params as unknown[]) ?? []).length;
      if (expected === undefined) issues.push({ path, blockId: b.id, message: `call to undefined function "${name}"` });
      else if (expected !== got) issues.push({ path, blockId: b.id, message: `function "${name}" takes ${expected} argument(s), the call provides ${got}` });
    }
    for (const [name, link] of Object.entries(b.inputs ?? {})) {
      const child = linked(link);
      if (!child) continue;
      const kind = inputKind(meta, name);
      const p = `${path}.${name}`;
      if (!kind) {
        issues.push({ path: p, blockId: b.id, message: `"${name}" is not an input of ${b.type}` });
        continue;
      }
      if (kind === 'value') visit(child, p, true, inputCheck(meta, name));
      else chain(child, p, inputCheck(meta, name)?.[0]);
    }
  };

  const chain = (first: BlockState, path: string, check: string | undefined) => {
    let cur: BlockState | undefined = first;
    let i = 0;
    let prevMeta: BlockMeta | undefined;
    while (cur) {
      const p = `${path}[${i}]`;
      const meta = BLOCKS[cur.type];
      if (meta) {
        if (meta.prev === undefined && meta.output === undefined && i > 0) issues.push({ path: p, blockId: cur.id, message: `${cur.type} cannot follow another block` });
        else if (meta.prev === undefined) issues.push({ path: p, blockId: cur.id, message: `${cur.type} cannot be placed inside this block` });
        else if (check && meta.prev !== check) issues.push({ path: p, blockId: cur.id, message: `${cur.type} does not fit here (expected a ${check} block)` });
        if (prevMeta && prevMeta.next === false) issues.push({ path: p, blockId: cur.id, message: `nothing can follow ${prevMeta.type}` });
      }
      visit(cur, p, false, undefined);
      prevMeta = meta;
      cur = linked(cur.next);
      i++;
    }
  };

  (state.blocks?.blocks ?? []).forEach((top, i) => {
    const meta = BLOCKS[top.type];
    const path = `top[${i}]`;
    if (!meta) {
      issues.push({ path, blockId: top.id, message: `unknown block type "${top.type}"` });
      return;
    }
    // A top-level stack: the first block is free standing, the rest follow it.
    visit(top, path, false, undefined);
    let prevMeta = meta;
    let cur = linked(top.next);
    let j = 1;
    while (cur) {
      const m = BLOCKS[cur.type];
      const p = `${path}[${j}]`;
      if (prevMeta.next === false) issues.push({ path: p, blockId: cur.id, message: `nothing can follow ${prevMeta.type}` });
      else if (m && typeof prevMeta.next === 'string' && m.prev !== prevMeta.next) issues.push({ path: p, blockId: cur.id, message: `${cur.type} cannot follow ${prevMeta.type}` });
      visit(cur, p, false, undefined);
      if (m) prevMeta = m;
      cur = linked(cur.next);
      j++;
    }
  });
  return issues;
}
