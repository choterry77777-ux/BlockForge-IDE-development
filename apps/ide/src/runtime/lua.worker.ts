/// <reference lib="webworker" />
import { LuaFactory } from 'wasmoon';
import wasmUrl from 'wasmoon/dist/glue.wasm?url';
import { lineReader, type RunRequest, type WorkerMessage } from './protocol';

const post = (m: WorkerMessage) => self.postMessage(m);
const factory = new LuaFactory(wasmUrl);

/** Output goes through Lua's own tostring so numbers and nil print as Lua prints them. */
const PRELUDE = `
local __out = __bf_out
print = function(...)
  local parts = {}
  for i = 1, select('#', ...) do parts[i] = tostring((select(i, ...))) end
  __out(table.concat(parts, '\\t') .. '\\n')
end
io.write = function(...)
  local parts = {}
  for i = 1, select('#', ...) do parts[i] = tostring((select(i, ...))) end
  __out(table.concat(parts))
end
io.flush = function() end
io.read = function() return __bf_input('') end
`;

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  post({ type: 'status', text: 'loading' });
  const lua = await factory.createEngine();
  try {
    const next = lineReader(e.data.stdin);
    lua.global.set('__bf_out', (text: string) => post({ type: 'out', text: String(text) }));
    lua.global.set('__bf_input', (prompt: string) => {
      if (prompt) post({ type: 'out', text: String(prompt) });
      const line = next();
      post({ type: 'in', text: `${line ?? ''}\n` });
      return line ?? '';
    });
    await lua.doString(PRELUDE);
    post({ type: 'status', text: 'running' });
    await lua.doString(e.data.code);
    post({ type: 'done', ok: true });
  } catch (err) {
    const text = String((err as Error)?.message ?? err);
    const m = /\]:(\d+):\s*(.*)/s.exec(text);
    post({ type: 'err', text: `${m ? `main.lua:${m[1]}: ${m[2]}` : text}\n` });
    post({ type: 'done', ok: false, error: m ? m[2] : text, line: m ? Number(m[1]) : undefined });
  } finally {
    lua.global.close();
  }
};
