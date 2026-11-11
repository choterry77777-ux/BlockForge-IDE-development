import type { DetectedToolchain, Diagnostic } from '@blockforge/core';
import { create } from 'zustand';

export interface OutputChunk {
  kind: 'out' | 'err' | 'in' | 'sys' | 'ok';
  text: string;
}

export interface ResultTable {
  title: string;
  columns: string[];
  rows: unknown[][];
}

export type RunStatus = 'idle' | 'building' | 'running';

interface RunStore {
  status: RunStatus;
  fileId?: string;
  output: OutputChunk[];
  tables: ResultTable[];
  /** Compiler and runtime diagnostics of the last run. */
  diagnostics: Diagnostic[];
  lastExit?: { ok: boolean; code?: number | null; ms: number; note?: string };
  toolchains: DetectedToolchain[];
  toolchainsChecked: boolean;
  /** HTML shown in the preview tab. */
  preview?: { html: string; n: number };
  append: (kind: OutputChunk['kind'], text: string) => void;
  clear: () => void;
  set: (patch: Partial<RunStore>) => void;
}

const MAX_CHUNKS = 4000;

export const useRun = create<RunStore>((set) => ({
  status: 'idle',
  output: [],
  tables: [],
  diagnostics: [],
  toolchains: [],
  toolchainsChecked: false,
  append: (kind, text) =>
    set((s) => {
      if (!text) return s;
      const last = s.output[s.output.length - 1];
      // Consecutive chunks of one stream are merged to keep rendering cheap.
      if (last && last.kind === kind && last.text.length < 8000) return { output: [...s.output.slice(0, -1), { kind, text: last.text + text }] };
      const next = [...s.output, { kind, text }];
      return { output: next.length > MAX_CHUNKS ? next.slice(-MAX_CHUNKS) : next };
    }),
  clear: () => set({ output: [], tables: [], diagnostics: [], lastExit: undefined }),
  set: (patch) => set(patch),
}));

export function outputText(chunks: OutputChunk[] = useRun.getState().output): string {
  return chunks.map((c) => c.text).join('');
}
