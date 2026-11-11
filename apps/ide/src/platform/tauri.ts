import type { DetectedToolchain, ToolchainSpec, TransportRequest, TransportResponse } from '@blockforge/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BrowserBounds, FolderRef, FsEntry, FsMatch, HostOs, Platform, ProcessExit, ProcessHandle, ProcessRequest, TerminalHandle, TerminalOptions } from './types';

let seq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;

interface HostInfo {
  os: HostOs;
  arch: 'arm64' | 'x86_64';
}

const info: HostInfo = { os: 'macos', arch: 'arm64' };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aiSend(req: TransportRequest): Promise<TransportResponse> {
  const id = nextId('http');
  const queue: Uint8Array[] = [];
  let finished = false;
  let failure: string | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const unChunk = await listen<{ id: string; data: string }>('http-chunk', (e) => {
    if (e.payload.id !== id) return;
    queue.push(b64ToBytes(e.payload.data));
    notify();
  });
  const unEnd = await listen<{ id: string; error?: string }>('http-end', (e) => {
    if (e.payload.id !== id) return;
    finished = true;
    failure = e.payload.error;
    notify();
  });
  const cleanup = () => {
    unChunk();
    unEnd();
  };
  const onAbort = () => {
    void invoke('http_cancel', { id });
  };
  req.signal?.addEventListener('abort', onAbort, { once: true });
  let head: { status: number; headers: Record<string, string> };
  try {
    head = await invoke('http_stream', { id, request: { url: req.url, method: req.method, headers: req.headers, body: req.body ?? null, provider_id: req.auth.providerId, scheme: req.auth.scheme } });
  } catch (err) {
    cleanup();
    req.signal?.removeEventListener('abort', onAbort);
    if (req.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    throw new Error(String(err));
  }
  async function* body(): AsyncIterable<Uint8Array> {
    try {
      for (;;) {
        if (queue.length) {
          yield queue.shift()!;
          continue;
        }
        if (finished) {
          if (req.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          if (failure) throw new Error(failure);
          return;
        }
        await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      cleanup();
      req.signal?.removeEventListener('abort', onAbort);
      if (!finished) void invoke('http_cancel', { id });
    }
  }
  return { status: head.status, headers: head.headers, body: body() };
}

async function spawn(req: ProcessRequest, onData: (stream: 'stdout' | 'stderr', text: string) => void): Promise<ProcessHandle> {
  const id = nextId('proc');
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  let resolveDone!: (exit: ProcessExit) => void;
  const done = new Promise<ProcessExit>((r) => (resolveDone = r));
  const unOut = await listen<{ id: string; stream: 'stdout' | 'stderr'; data: string }>('proc-output', (e) => {
    if (e.payload.id !== id) return;
    onData(e.payload.stream, decoders[e.payload.stream].decode(b64ToBytes(e.payload.data), { stream: true }));
  });
  const unExit = await listen<{ id: string; code: number | null; timed_out: boolean; truncated: boolean; killed: boolean; error?: string }>('proc-exit', (e) => {
    if (e.payload.id !== id) return;
    unOut();
    unExit();
    resolveDone({ code: e.payload.code, timedOut: e.payload.timed_out, truncated: e.payload.truncated, killed: e.payload.killed, error: e.payload.error });
  });
  try {
    await invoke('proc_spawn', { id, request: { project_id: req.projectId, tool: req.tool ?? null, artifact: req.artifact ?? null, args: req.args, env: req.env ?? {}, stdin: req.stdin ?? null, timeout_ms: req.timeoutMs, max_output_bytes: req.maxOutputBytes } });
  } catch (err) {
    unOut();
    unExit();
    throw new Error(String(err));
  }
  return { write: (data) => invoke('proc_write', { id, data }), kill: () => invoke('proc_kill', { id }), done };
}

async function openTerminal(options: TerminalOptions, onData: (bytes: Uint8Array) => void): Promise<TerminalHandle> {
  const id = nextId('pty');
  let resolveDone!: (code: number | null) => void;
  const done = new Promise<number | null>((r) => (resolveDone = r));
  const unData = await listen<{ id: string; data: string }>('pty-data', (e) => {
    if (e.payload.id === id) onData(b64ToBytes(e.payload.data));
  });
  const unExit = await listen<{ id: string; code: number | null }>('pty-exit', (e) => {
    if (e.payload.id !== id) return;
    unData();
    unExit();
    resolveDone(e.payload.code ?? null);
  });
  let cwd: string;
  try {
    cwd = await invoke<string>('pty_open', { id, options: { cwd: options.cwd ?? null, project_id: options.projectId ?? null, cols: options.cols, rows: options.rows, command: options.command ?? null } });
  } catch (err) {
    unData();
    unExit();
    throw new Error(String(err));
  }
  return { id, cwd, write: (data) => invoke('pty_write', { id, data }), resize: (cols, rows) => invoke('pty_resize', { id, cols, rows }), close: () => invoke('pty_close', { id }), done };
}

/** Backend errors arrive as plain strings; give callers a real Error. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw new Error(String(err));
  }
}

const navListeners = new Set<(url: string) => void>();
let navBound = false;

export async function createTauriPlatform(): Promise<Platform> {
  Object.assign(info, await invoke<HostInfo>('host_info'));
  return {
    kind: 'desktop',
    os: info.os,
    arch: info.arch,
    detectToolchains: (specs: ToolchainSpec[]) => invoke<DetectedToolchain[]>('detect_toolchains', { specs: specs.map((s) => ({ id: s.id, candidates: s.candidates, version_args: s.versionArgs })) }),
    writeWorkFiles: (projectId, files) => invoke<string>('work_write', { projectId, files }),
    cleanWork: (projectId, paths) => invoke('work_clean', { projectId, paths }),
    spawn,
    revealWork: (projectId) => invoke('work_reveal', { projectId }),
    setSecret: (providerId, value, origin) => invoke('secret_set', { providerId, value, origin }),
    hasSecret: (providerId) => invoke<boolean>('secret_has', { providerId }),
    deleteSecret: (providerId) => invoke('secret_delete', { providerId }),
    aiSend,
    registryGet: (url, headers) => invoke<string>('registry_get', { url, headers: headers ?? {} }),
    async openTextFile(extensions) {
      const r = await invoke<{ name: string; path: string; text: string } | null>('file_open', { extensions });
      return r ?? undefined;
    },
    async saveTextFile(suggestedName, text, path) {
      const r = await invoke<{ name: string; path: string } | null>('file_save', { suggestedName, text, path: path ?? null });
      return r ?? undefined;
    },
    saveBinaryFile: (suggestedName, data) => invoke<boolean>('file_save_binary', { suggestedName, data: Array.from(data) }),
    openExternal: (url) => invoke('open_external', { url }),
    workspace: {
      available: true,
      async pickFolder() {
        return (await call<FolderRef | null>('folder_pick')) ?? undefined;
      },
      recentFolders: () => call<FolderRef[]>('folder_recent'),
      reopenFolder: (path) => call<FolderRef>('folder_reopen', { path }),
      forgetFolder: (path) => call('folder_forget', { path }),
      list: (path) => call<FsEntry[]>('fs_list', { path }),
      async read(path) {
        const r = await call<{ text: string | null; binary: boolean; size: number }>('fs_read', { path });
        return { text: r.text ?? undefined, binary: r.binary, size: r.size };
      },
      write: (path, text) => call('fs_write', { path, text }),
      create: (path, dir) => call('fs_create', { path, dir }),
      rename: (from, to) => call('fs_rename', { from, to }),
      trash: (path) => call('fs_trash', { path }),
      reveal: (path) => call('fs_reveal', { path }),
      search: (root, query, max) => call<FsMatch[]>('fs_search', { root, query, max }),
    },
    terminal: { available: true, open: openTerminal },
    browser: {
      native: true,
      open: (url: string, bounds: BrowserBounds) => invoke('browser_open', { url, bounds }),
      navigate: (url: string) => invoke('browser_navigate', { url }),
      setBounds: (bounds: BrowserBounds) => invoke('browser_bounds', { bounds }),
      setVisible: (visible: boolean) => invoke('browser_visible', { visible }),
      back: () => invoke('browser_eval', { action: 'back' }),
      forward: () => invoke('browser_eval', { action: 'forward' }),
      reload: () => invoke('browser_eval', { action: 'reload' }),
      close: () => invoke('browser_close'),
      onNavigate(cb) {
        navListeners.add(cb);
        if (!navBound) {
          navBound = true;
          void listen<{ url: string }>('browser-nav', (e) => navListeners.forEach((l) => l(e.payload.url)));
        }
        return () => navListeners.delete(cb);
      },
    },
  };
}
