/// <reference lib="webworker" />
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { RunRequest, WorkerMessage } from './protocol';

const post = (m: WorkerMessage) => self.postMessage(m);
const ready = initSqlJs({ locateFile: () => wasmUrl });

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const sql = e.data.code;
  let consumed = 0;
  try {
    post({ type: 'status', text: 'loading' });
    const SQL = await ready;
    const db = new SQL.Database();
    post({ type: 'status', text: 'running' });
    let queries = 0;
    let changed = 0;
    try {
      const it = db.iterateStatements(sql);
      for (const stmt of it) {
        const text = stmt.getSQL().trim();
        const columns = stmt.getColumnNames();
        const rows: unknown[][] = [];
        while (stmt.step()) rows.push(stmt.get());
        consumed = sql.length - it.getRemainingSQL().length;
        if (columns.length) {
          queries++;
          post({ type: 'table', title: text.split('\n')[0].slice(0, 80), columns, rows });
        } else changed += db.getRowsModified();
      }
      post({ type: 'sys', text: `${queries} result set(s), ${changed} row(s) changed.\n` });
      post({ type: 'done', ok: true });
    } finally {
      db.close();
    }
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    // The failing statement starts where the last successful one ended.
    const rest = sql.slice(consumed);
    const lead = rest.length - rest.trimStart().length;
    const line = sql.slice(0, consumed + lead).split('\n').length;
    post({ type: 'err', text: `Error near line ${line}: ${message}\n` });
    post({ type: 'done', ok: false, error: message, line });
  }
};
