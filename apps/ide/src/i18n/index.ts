import type { BlockMessages } from '@blockforge/core';
import { useSyncExternalStore } from 'react';
import en from './locales/en';

export const LOCALES = [
  { id: 'en', name: 'English', blockly: 'en' },
  { id: 'ko', name: '한국어', blockly: 'ko' },
  { id: 'ja', name: '日本語', blockly: 'ja' },
  { id: 'zh-CN', name: '简体中文', blockly: 'zh-hans' },
  { id: 'zh-TW', name: '繁體中文', blockly: 'zh-hant' },
] as const;

export type LocaleId = (typeof LOCALES)[number]['id'];
export type Dictionary = Record<string, string>;

export interface LocaleBundle {
  ui: Dictionary;
  /** Custom block messages by block type. */
  blocks: Record<string, BlockMessages>;
  /** Phrases embedded in diagnostics (feature names and details). */
  phrases: Record<string, string>;
}

const loaders: Record<LocaleId, () => Promise<LocaleBundle>> = {
  en: async () => ({ ui: en, blocks: {}, phrases: {} }),
  ko: async () => (await import('./locales/ko')).default,
  ja: async () => (await import('./locales/ja')).default,
  'zh-CN': async () => (await import('./locales/zh-CN')).default,
  'zh-TW': async () => (await import('./locales/zh-TW')).default,
};

let current: LocaleId = 'en';
let bundle: LocaleBundle = { ui: en, blocks: {}, phrases: {} };
const listeners = new Set<() => void>();

export function getLocale(): LocaleId {
  return current;
}

export function getBundle(): LocaleBundle {
  return bundle;
}

export async function setLocale(id: LocaleId): Promise<void> {
  const next = await loaders[id]();
  current = id;
  bundle = next;
  document.documentElement.lang = id;
  listeners.forEach((l) => l());
}

/** Pick the supported locale closest to a browser language tag. */
export function matchLocale(tag: string): LocaleId {
  const t = tag.toLowerCase();
  if (t.startsWith('ko')) return 'ko';
  if (t.startsWith('ja')) return 'ja';
  if (t.startsWith('zh')) return /tw|hk|mo|hant/.test(t) ? 'zh-TW' : 'zh-CN';
  return 'en';
}

export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in params ? String(params[key]) : m));
}

/** Translate a key. English is the fallback so nothing ever renders as a raw key. */
export function t(key: string, params?: Record<string, string | number>): string {
  return format(bundle.ui[key] ?? en[key] ?? key, params);
}

export function hasKey(key: string): boolean {
  return key in en;
}

/** Re-render when the language changes. */
export function useLocale(): LocaleId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** Localised text of a diagnostic produced by the core. */
export function diagText(d: { code: string; message: string; params?: Record<string, string | number> }): string {
  const key = `diag.${d.code}`;
  const template = bundle.ui[key] ?? en[key];
  if (!template) return d.message;
  const params: Record<string, string | number> = { ...(d.params ?? {}) };
  for (const k of ['feature', 'detail']) {
    const v = params[k];
    if (typeof v === 'string' && v) params[k] = bundle.phrases[v] ?? v;
  }
  return format(template, params).replace(/\s+$/, '');
}
