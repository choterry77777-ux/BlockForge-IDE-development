/// <reference lib="webworker" />
import { lineReader, type RunRequest, type WorkerMessage } from './protocol';

const post = (m: WorkerMessage) => self.postMessage(m);

function show(v: unknown, depth = 0): string {
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
  if (v instanceof Error) return v.stack ?? String(v);
  if (depth > 3) return '...';
  if (Array.isArray(v)) return `[ ${v.map((x) => show(x, depth + 1)).join(', ')} ]`.replace('[  ]', '[]');
  if (v instanceof Map) return `Map(${v.size}) { ${[...v].map(([k, x]) => `${show(k, depth + 1)} => ${show(x, depth + 1)}`).join(', ')} }`;
  try {
    const entries = Object.entries(v as object).map(([k, x]) => `${k}: ${show(x, depth + 1)}`);
    const name = (v as object).constructor?.name;
    return `${name && name !== 'Object' ? name + ' ' : ''}{ ${entries.join(', ')} }`.replace('{  }', '{}');
  } catch {
    return String(v);
  }
}

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const next = lineReader(e.data.stdin);
  const line = (kind: 'out' | 'err') => (...args: unknown[]) => post({ type: kind, text: args.map((a) => show(a)).join(' ') + '\n' });
  const sandboxConsole = { log: line('out'), info: line('out'), debug: line('out'), warn: line('err'), error: line('err'), table: line('out') };
  const prompt = (question?: unknown) => {
    post({ type: 'out', text: String(question ?? '') });
    const answer = next();
    post({ type: 'in', text: `${answer ?? ''}\n` });
    return answer ?? '';
  };
  const unavailable = (name: string) => () => {
    throw new Error(`${name} is not available in the built-in JavaScript runtime. Run the project with Node.js in the desktop app to use files, shell commands or modules.`);
  };
  // A generated async entry point is awaited so the run finishes when the program does.
  const code = e.data.code.replace(/\nmain\(\);\s*$/, '\nawait main();\n');
  const HEADER_LINES = 2;
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...a: unknown[]) => Promise<unknown>;
    const fn = new AsyncFunction('console', 'prompt', 'require', 'process', 'module', 'exports', code);
    const module = { exports: {} };
    await fn(sandboxConsole, prompt, unavailable('require()'), undefined, module, module.exports);
    post({ type: 'done', ok: true });
  } catch (err) {
    const e2 = err as Error;
    const m = /<anonymous>:(\d+):(\d+)/.exec(e2?.stack ?? '');
    post({ type: 'err', text: `${e2?.name ?? 'Error'}: ${e2?.message ?? String(err)}\n` });
    post({ type: 'done', ok: false, error: e2?.message ?? String(err), line: m ? Math.max(1, Number(m[1]) - HEADER_LINES) : undefined });
  }
};
