/// <reference lib="webworker" />
import { loadPyodide, type PyodideInterface } from 'pyodide';
import { lineReader, type RunRequest, type WorkerMessage } from './protocol';

const post = (m: WorkerMessage) => self.postMessage(m);
let runtime: Promise<PyodideInterface> | undefined;

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  try {
    if (!runtime) {
      post({ type: 'status', text: 'loading' });
      // Served from the application itself, so Python works offline.
      runtime = loadPyodide({ indexURL: new URL('/pyodide/', self.location.origin).href });
    }
    const py = await runtime;
    const next = lineReader(e.data.stdin);
    const decoder = new TextDecoder();
    const writer = (kind: 'out' | 'err') => ({
      write: (buf: Uint8Array) => {
        post({ type: kind, text: decoder.decode(buf, { stream: true }) });
        return buf.length;
      },
    });
    py.setStdout(writer('out'));
    py.setStderr(writer('err'));
    py.setStdin({
      stdin: () => {
        const line = next();
        post({ type: 'in', text: `${line ?? ''}\n` });
        return line === null ? null : `${line}\n`;
      },
    });
    post({ type: 'status', text: 'running' });
    const globals = py.toPy({ __name__: '__main__' });
    try {
      await py.runPythonAsync(e.data.code, { globals, filename: 'main.py' });
      post({ type: 'done', ok: true });
    } catch (err) {
      const text = String((err as Error)?.message ?? err);
      // Keep the part of the traceback that is about the user's file.
      const frames = [...text.matchAll(/File "main\.py", line (\d+)/g)];
      const from = text.indexOf('  File "main.py"');
      post({ type: 'err', text: (from >= 0 ? `Traceback (most recent call last):\n${text.slice(from)}` : text).replace(/\n*$/, '\n') });
      post({ type: 'done', ok: false, error: text.trim().split('\n').pop(), line: frames.length ? Number(frames[frames.length - 1][1]) : undefined });
    } finally {
      globals.destroy();
    }
  } catch (err) {
    post({ type: 'err', text: `${String((err as Error)?.message ?? err)}\n` });
    post({ type: 'done', ok: false, error: String((err as Error)?.message ?? err) });
  }
};
