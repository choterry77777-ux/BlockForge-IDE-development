export interface RunRequest {
  code: string;
  stdin: string;
}

export type WorkerMessage =
  | { type: 'out' | 'err' | 'in' | 'sys'; text: string }
  | { type: 'table'; title: string; columns: string[]; rows: unknown[][] }
  | { type: 'status'; text: string }
  | { type: 'done'; ok: boolean; error?: string; line?: number };

/** Hands out stdin one line at a time, as an interactive program would read it. */
export function lineReader(stdin: string): () => string | null {
  const lines = stdin.length ? stdin.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [];
  let i = 0;
  return () => (i < lines.length ? lines[i++] : null);
}
