import { createProviderConfig, type ProviderConfig } from '@blockforge/core';
import { create } from 'zustand';
import type { LocaleId } from '../i18n';

export type ThemeMode = 'system' | 'light' | 'dark';
export type CenterView = 'blocks' | 'split' | 'code';
export type RightTab = 'assistant' | 'compare' | 'preview' | 'browser' | 'tools' | 'packages' | 'toolchains';
export type DockTab = 'output' | 'problems' | 'input' | 'terminal';

export interface Settings {
  locale: LocaleId | 'auto';
  theme: ThemeMode;
  editor: { fontSize: number; wordWrap: boolean; minimap: boolean; lineNumbers: boolean };
  blocks: { grid: boolean; snap: boolean; minimap: boolean; sounds: boolean; scale: number };
  autosave: { enabled: boolean; delayMs: number };
  run: { timeoutSec: number; maxOutputKb: number };
  ai: {
    providers: ProviderConfig[];
    activeProviderId?: string;
    /** Use native tool calling when the provider supports it. */
    preferTools: boolean;
    autocomplete: { enabled: boolean; automatic: boolean; delayMs: number; maxTokens: number };
    /** When project content may be sent to the provider. */
    context: 'ask' | 'always' | 'never';
    /** Ask again before applying edits that delete or replace things. */
    confirmDestructive: boolean;
    /** Build and run again after an AI edit is applied. */
    verifyAfterApply: boolean;
    /** Whether the assistant may ask to run commands in the terminal: never, with approval each time, or on its own for commands that are not risky. */
    commands: 'off' | 'ask' | 'auto';
    /** Providers the user has already allowed to receive project content. */
    consented: string[];
  };
  layout: { sidebarWidth: number; sidebarCollapsed: boolean; rightWidth: number; rightOpen: boolean; rightTab: RightTab; dockHeight: number; dockOpen: boolean; dockTab: DockTab; view: CenterView; splitRatio: number };
  /** Collapsed sections of the sidebar. */
  sidebarClosed: Record<string, boolean>;
  favorites: string[];
  /** Custom blocks saved by the user: a name and a block tree. */
  customBlocks: { id: string; name: string; state: unknown }[];
  compareLanguages: string[];
  browserHome: string;
}

export const DEFAULT_SETTINGS: Settings = {
  locale: 'auto',
  theme: 'system',
  editor: { fontSize: 13, wordWrap: false, minimap: false, lineNumbers: true },
  blocks: { grid: true, snap: true, minimap: false, sounds: false, scale: 0.85 },
  autosave: { enabled: true, delayMs: 1500 },
  run: { timeoutSec: 30, maxOutputKb: 512 },
  ai: {
    providers: [createProviderConfig('anthropic', 'anthropic'), createProviderConfig('openai', 'openai'), createProviderConfig('deepseek', 'deepseek')],
    activeProviderId: 'anthropic',
    preferTools: true,
    autocomplete: { enabled: false, automatic: true, delayMs: 700, maxTokens: 256 },
    context: 'ask',
    confirmDestructive: true,
    verifyAfterApply: true,
    commands: 'ask',
    consented: [],
  },
  layout: { sidebarWidth: 280, sidebarCollapsed: false, rightWidth: 380, rightOpen: true, rightTab: 'assistant', dockHeight: 200, dockOpen: true, dockTab: 'output', view: 'split', splitRatio: 0.58 },
  sidebarClosed: {},
  favorites: [],
  customBlocks: [],
  compareLanguages: ['python', 'javascript', 'c', 'rust'],
  browserHome: 'https://developer.mozilla.org/',
};

const KEY = 'bf.settings.v1';

function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !base || typeof base !== 'object' || Array.isArray(base)) return (patch === undefined ? base : (patch as T)) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = k in out ? merge(out[k], v) : v;
  return out as T;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_SETTINGS;
}

interface SettingsStore extends Settings {
  update: (patch: DeepPartial<Settings>) => void;
  reset: () => void;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  update: (patch) => {
    const { update, reset, ...current } = get();
    void update;
    void reset;
    const next = merge(current as Settings, patch);
    set(next);
    // Provider configurations are saved; API keys never are (they live in the keychain or memory).
    localStorage.setItem(KEY, JSON.stringify(next));
  },
  reset: () => {
    localStorage.removeItem(KEY);
    set(DEFAULT_SETTINGS);
  },
}));

export function activeProvider(s: Settings = useSettings.getState()): ProviderConfig | undefined {
  return s.ai.providers.find((p) => p.id === s.ai.activeProviderId) ?? s.ai.providers[0];
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
