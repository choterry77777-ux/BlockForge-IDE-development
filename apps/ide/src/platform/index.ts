import type { Platform } from './types';
import { webPlatform } from './web';

export type { Platform } from './types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let platform: Platform = webPlatform;

/** Choose the desktop or browser implementation. Called once at start-up. */
export async function initPlatform(): Promise<Platform> {
  if (isTauri) {
    try {
      platform = await (await import('./tauri')).createTauriPlatform();
    } catch (err) {
      console.error('Desktop backend unavailable, continuing with browser features.', err);
    }
  }
  return platform;
}

export function getPlatform(): Platform {
  return platform;
}
