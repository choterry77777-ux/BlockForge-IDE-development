import { type BlockState, isEnabled, linked, type WorkspaceState } from '../blocks/state';
import type { Diagnostic, Severity } from '../types';

/** Shared helpers for reading Blockly state while converting to IR. */
export class Reader {
  readonly diags: Diagnostic[] = [];
  private vars = new Map<string, string>();

  constructor(readonly state: WorkspaceState) {
    for (const v of state.variables ?? []) this.vars.set(v.id, v.name);
  }

  report(severity: Severity, code: string, message: string, blockId?: string, params?: Record<string, string | number>): void {
    this.diags.push({ severity, code, message, blockId, params, source: 'blocks' });
  }

  str(b: BlockState, name: string, fallback = ''): string {
    const v = b.fields?.[name];
    return v === undefined || v === null ? fallback : String(v);
  }

  num(b: BlockState, name: string, fallback = 0): number {
    const v = Number(b.fields?.[name]);
    return Number.isFinite(v) ? v : fallback;
  }

  bool(b: BlockState, name: string): boolean {
    const v = b.fields?.[name];
    return v === true || v === 'TRUE' || v === 'true';
  }

  /** Name of the variable referenced by a variable field. */
  varName(b: BlockState, name: string): string {
    const v = b.fields?.[name] as { id?: string; name?: string } | string | undefined;
    if (typeof v === 'string') return this.vars.get(v) ?? v;
    if (v?.id && this.vars.has(v.id)) return this.vars.get(v.id)!;
    return v?.name ?? 'unnamed';
  }

  /** Block plugged into a value input (real block or shadow). */
  value(b: BlockState, name: string): BlockState | undefined {
    const child = linked(b.inputs?.[name]);
    return child && isEnabled(child) ? child : undefined;
  }

  /** Ordered, enabled blocks of a statement input. */
  stack(b: BlockState, name: string): BlockState[] {
    return this.chain(linked(b.inputs?.[name]));
  }

  /** Follow next links, skipping disabled blocks. */
  chain(first: BlockState | undefined): BlockState[] {
    const out: BlockState[] = [];
    let cur = first;
    while (cur) {
      if (isEnabled(cur)) out.push(cur);
      cur = linked(cur.next);
    }
    return out;
  }

  /** Top-level blocks ordered the way a reader scans the canvas. */
  tops(): BlockState[] {
    return [...(this.state.blocks?.blocks ?? [])]
      .filter(isEnabled)
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  }
}
