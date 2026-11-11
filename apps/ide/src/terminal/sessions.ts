import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { create } from 'zustand';
import { t } from '../i18n';
import { getPlatform } from '../platform';
import type { TerminalHandle } from '../platform/types';
import { useProject } from '../state/project';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { useWorkspace } from '../state/workspace';

export interface TermSession {
  id: string;
  title: string;
  /** A shell the user types into, or one command started for them. */
  kind: 'shell' | 'task';
  exited: boolean;
  code?: number | null;
}

interface Live {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  opened: boolean;
  handle?: TerminalHandle;
}

export const useTerminals = create<{ sessions: TermSession[]; active?: string }>(() => ({ sessions: [] }));

const live = new Map<string, Live>();
let seq = 0;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function theme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    background: css('--bg-base') || (dark ? '#151517' : '#ffffff'),
    foreground: css('--label-primary') || (dark ? '#f5f5f5' : '#0f1115'),
    cursor: css('--label-primary') || undefined,
    cursorAccent: css('--bg-base') || undefined,
    selectionBackground: dark ? 'rgba(122,170,255,0.30)' : 'rgba(65,118,230,0.22)',
    black: dark ? '#3a3d44' : '#1b1b1c',
    red: dark ? '#f2777a' : '#c9302c',
    green: dark ? '#7ec699' : '#1e8e4f',
    yellow: dark ? '#e6c07b' : '#a36a00',
    blue: dark ? '#7aaaff' : '#2b62d6',
    magenta: dark ? '#c594c5' : '#9a3fa8',
    cyan: dark ? '#5fb3b3' : '#0f7f86',
    white: dark ? '#d8dbe0' : '#61666b',
    brightBlack: dark ? '#81858c' : '#81858c',
    brightRed: dark ? '#ff9a9c' : '#e0443f',
    brightGreen: dark ? '#9fe0b5' : '#27a85f',
    brightYellow: dark ? '#f5d79a' : '#bd7f0a',
    brightBlue: dark ? '#a3c4ff' : '#4176e6',
    brightMagenta: dark ? '#dcb0dc' : '#b556c4',
    brightCyan: dark ? '#86cfcf' : '#1898a0',
    brightWhite: dark ? '#ffffff' : '#0f1115',
  };
}

function createLive(): Live {
  const editor = useSettings.getState().editor;
  const term = new Terminal({
    fontFamily: css('--font-code') || 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: Math.max(11, editor.fontSize - 1),
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: false,
    macOptionIsMeta: true,
    theme: theme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const el = document.createElement('div');
  el.className = 'term-host';
  return { term, fit, el, opened: false };
}

/** Follow the light or dark theme of the app. */
export function refreshTerminalTheme(): void {
  for (const l of live.values()) l.term.options.theme = theme();
}

function patch(id: string, p: Partial<TermSession>): void {
  useTerminals.setState((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
}

/** Where commands start: the opened folder, else the work folder of the open project. */
export function terminalHome(): { cwd?: string; projectId?: string } {
  const folder = useWorkspace.getState().folder;
  if (folder) return { cwd: folder.path };
  const project = useProject.getState().project;
  return project ? { projectId: project.id } : {};
}

function showTerminal(): void {
  useSettings.getState().update({ layout: { dockOpen: true, dockTab: 'terminal' } });
}

/** Start an interactive shell in a new terminal tab. */
export async function openShell(cwd?: string): Promise<string | undefined> {
  const platform = getPlatform();
  if (!platform.terminal.available) return undefined;
  const id = `term-${++seq}`;
  const l = createLive();
  live.set(id, l);
  const count = useTerminals.getState().sessions.filter((s) => s.kind === 'shell').length + 1;
  useTerminals.setState((s) => ({ sessions: [...s.sessions, { id, title: `${t('term.shell')} ${count}`, kind: 'shell', exited: false }], active: id }));
  showTerminal();
  try {
    const where = cwd ? { cwd } : terminalHome();
    const handle = await platform.terminal.open({ ...where, cols: l.term.cols, rows: l.term.rows }, (bytes) => l.term.write(bytes));
    l.handle = handle;
    l.term.onData((data) => void handle.write(data).catch(() => undefined));
    l.term.onResize(({ cols, rows }) => void handle.resize(cols, rows).catch(() => undefined));
    // The pane may have been measured before the shell existed.
    void handle.resize(l.term.cols, l.term.rows).catch(() => undefined);
    void handle.done.then((code) => {
      patch(id, { exited: true, code });
      l.term.write(`\r\n\x1b[2m${t('term.ended', { code: code ?? '?' })}\x1b[0m\r\n`);
    });
    return id;
  } catch (err) {
    closeSession(id);
    useUi.getState().toast(String((err as Error)?.message ?? err), 'err');
    return undefined;
  }
}

// Escape sequences are removed from text that is handed to the assistant or searched.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

export function plainText(raw: string): string {
  return raw.replace(ANSI, '').replace(/\r\n/g, '\n').replace(/[^\n]*\r(?!\n)/g, '');
}

export interface TaskResult {
  id: string;
  output: string;
  code: number | null;
  timedOut: boolean;
}

/** Run one command line in its own terminal tab and collect what it printed. */
export async function runTask(command: string, opts: { cwd?: string; projectId?: string; title?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<TaskResult> {
  const platform = getPlatform();
  if (!platform.terminal.available) throw new Error(t('desktop.only'));
  const id = `term-${++seq}`;
  const l = createLive();
  live.set(id, l);
  useTerminals.setState((s) => ({ sessions: [...s.sessions, { id, title: opts.title ?? command.slice(0, 28), kind: 'task', exited: false }], active: id }));
  showTerminal();
  l.term.write(`\x1b[2m$ ${command.replace(/\n/g, '\r\n  ')}\x1b[0m\r\n`);
  const decoder = new TextDecoder();
  let raw = '';
  const where = opts.cwd || opts.projectId ? { cwd: opts.cwd, projectId: opts.projectId } : terminalHome();
  let handle: TerminalHandle;
  try {
    handle = await platform.terminal.open({ ...where, cols: Math.max(l.term.cols, 100), rows: l.term.rows, command }, (bytes) => {
      l.term.write(bytes);
      // Enough for the assistant; a flood of output is cut rather than kept in memory.
      if (raw.length < 400_000) raw += decoder.decode(bytes, { stream: true });
    });
  } catch (err) {
    patch(id, { exited: true, code: null });
    l.term.write(`${String((err as Error)?.message ?? err)}\r\n`);
    throw err;
  }
  l.handle = handle;
  l.term.onData((data) => void handle.write(data).catch(() => undefined));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void handle.close();
  }, opts.timeoutMs ?? 120_000);
  const onAbort = () => void handle.close();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const code = await handle.done;
  clearTimeout(timer);
  opts.signal?.removeEventListener('abort', onAbort);
  patch(id, { exited: true, code });
  l.term.write(`\r\n\x1b[2m${timedOut ? t('term.timedOut') : t('term.ended', { code: code ?? '?' })}\x1b[0m\r\n`);
  return { id, output: plainText(raw), code, timedOut };
}

export function closeSession(id: string): void {
  const l = live.get(id);
  void l?.handle?.close().catch(() => undefined);
  l?.term.dispose();
  l?.el.remove();
  live.delete(id);
  useTerminals.setState((s) => {
    const sessions = s.sessions.filter((x) => x.id !== id);
    return { sessions, active: s.active === id ? sessions[sessions.length - 1]?.id : s.active };
  });
}

/** Put a session's screen into the pane and size it to fit. */
export function attachSession(id: string, container: HTMLElement): void {
  const l = live.get(id);
  if (!l) return;
  if (l.el.parentElement !== container) container.replaceChildren(l.el);
  if (!l.opened) {
    l.term.open(l.el);
    l.opened = true;
  }
  fitSession(id);
  l.term.focus();
}

export function fitSession(id: string): void {
  const l = live.get(id);
  if (!l?.opened || !l.el.isConnected || l.el.clientWidth < 40 || l.el.clientHeight < 20) return;
  try {
    l.fit.fit();
  } catch {
    // Measuring can fail while the pane is being laid out; the next resize fits it.
  }
}

/** The last lines shown in a terminal tab, as plain text. */
export function readSession(id: string | undefined = useTerminals.getState().active, lines = 200): string {
  const l = id ? live.get(id) : undefined;
  if (!l) return '';
  const buffer = l.term.buffer.active;
  const out: string[] = [];
  for (let i = Math.max(0, buffer.length - Math.max(1, lines) - 50); i < buffer.length; i++) out.push(buffer.getLine(i)?.translateToString(true) ?? '');
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.slice(-lines).join('\n');
}

export function clearSession(id: string): void {
  live.get(id)?.term.clear();
}
