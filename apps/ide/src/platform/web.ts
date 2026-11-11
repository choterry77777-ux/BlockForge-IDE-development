import { AiError, type DetectedToolchain, type ToolchainSpec, type TransportRequest, type TransportResponse } from '@blockforge/core';
import type { HostOs, Platform, ProcessHandle } from './types';

/**
 * Browser edition. There are no local toolchains, and API keys live in this
 * tab's memory unless the user chooses to remember them on the device.
 */
const SESSION = new Map<string, string>();
const DEVICE_PREFIX = 'bf.key.';

function os(): HostOs {
  const p = navigator.userAgent;
  if (/Mac/i.test(p)) return 'macos';
  if (/Win/i.test(p)) return 'windows';
  return 'linux';
}

export function webKeyStorage(): 'session' | 'device' {
  return localStorage.getItem('bf.keyStorage') === 'device' ? 'device' : 'session';
}

export function setWebKeyStorage(mode: 'session' | 'device'): void {
  localStorage.setItem('bf.keyStorage', mode);
  if (mode === 'session') {
    for (const k of Object.keys(localStorage)) if (k.startsWith(DEVICE_PREFIX)) localStorage.removeItem(k);
  } else {
    for (const [id, v] of SESSION) localStorage.setItem(DEVICE_PREFIX + id, v);
  }
}

function readKey(id: string): string | undefined {
  return SESSION.get(id) ?? localStorage.getItem(DEVICE_PREFIX + id) ?? undefined;
}

async function* streamOf(res: Response): AsyncIterable<Uint8Array> {
  if (!res.body) return;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const unsupported = (): never => {
  throw new Error('This needs the desktop app.');
};

const desktopOnly = async (): Promise<never> => {
  throw new Error('This needs the desktop app.');
};

export const webPlatform: Platform = {
  kind: 'web',
  os: os(),
  arch: /arm|aarch64/i.test(navigator.userAgent) ? 'arm64' : 'x86_64',

  async detectToolchains(specs: ToolchainSpec[]): Promise<DetectedToolchain[]> {
    return specs.map((s) => ({ id: s.id, found: false }));
  },
  async writeWorkFiles() {
    return unsupported();
  },
  async cleanWork() {},
  async spawn(): Promise<ProcessHandle> {
    return unsupported();
  },
  async revealWork() {},

  async setSecret(providerId, value) {
    SESSION.set(providerId, value);
    if (webKeyStorage() === 'device') localStorage.setItem(DEVICE_PREFIX + providerId, value);
  },
  async hasSecret(providerId) {
    return !!readKey(providerId);
  },
  async deleteSecret(providerId) {
    SESSION.delete(providerId);
    localStorage.removeItem(DEVICE_PREFIX + providerId);
  },

  async aiSend(req: TransportRequest): Promise<TransportResponse> {
    const headers: Record<string, string> = { ...req.headers };
    const key = readKey(req.auth.providerId);
    if (req.auth.scheme === 'bearer' && key) headers.authorization = `Bearer ${key}`;
    if (req.auth.scheme === 'x-api-key') {
      if (key) headers['x-api-key'] = key;
      // Anthropic only accepts browser calls that opt in explicitly.
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    let res: Response;
    try {
      res = await fetch(req.url, { method: req.method, headers, body: req.body, signal: req.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new AiError('The request could not be sent. In a browser this is usually the provider blocking cross-origin requests (CORS); the desktop app is not affected.', 'network');
    }
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => (out[k] = v));
    return { status: res.status, headers: out, body: streamOf(res) };
  },

  async registryGet(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },

  async openTextFile(extensions) {
    const file = await pickFile(extensions.map((e) => `.${e}`).join(','));
    return file ? { name: file.name, text: await file.text() } : undefined;
  },
  async saveTextFile(name, text) {
    download(name, new Blob([text], { type: 'text/plain;charset=utf-8' }));
    return { name };
  },
  async saveBinaryFile(name, data) {
    download(name, new Blob([data.slice().buffer], { type: 'application/octet-stream' }));
    return true;
  },
  async openExternal(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  },

  // A browser tab cannot open folders or start a shell; the desktop app can.
  workspace: {
    available: false,
    pickFolder: desktopOnly,
    recentFolders: async () => [],
    reopenFolder: desktopOnly,
    forgetFolder: async () => {},
    list: desktopOnly,
    read: desktopOnly,
    write: desktopOnly,
    create: desktopOnly,
    rename: desktopOnly,
    trash: desktopOnly,
    reveal: desktopOnly,
    search: async () => [],
  },
  terminal: { available: false, open: desktopOnly },

  browser: {
    native: false,
    async open() {},
    async navigate() {},
    async setBounds() {},
    async setVisible() {},
    async back() {},
    async forward() {},
    async reload() {},
    async close() {},
    onNavigate: () => () => {},
  },
};
