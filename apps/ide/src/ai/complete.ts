import { addUsage, AiError, loadAdapter } from '@blockforge/core';
import { monaco } from '../editor/monaco';
import { t } from '../i18n';
import { activeProvider, useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { providerReady, transport, useAi } from './engine';

const cache = new Map<string, string>();
const CACHE_LIMIT = 60;
let inFlight: AbortController | undefined;
let registered: monaco.IDisposable | undefined;
/** Files that may receive suggestions (editable code files), by model URI. */
export const completableModels = new Map<string, { language: string; fileName: string }>();

function remember(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Inline (ghost text) completion. Requests are debounced, limited to one at a
 * time, cancelled when the cursor moves on, cached, and paused after a rate limit.
 */
export function registerInlineCompletion(): void {
  if (registered) return;
  registered = monaco.languages.registerInlineCompletionsProvider(
    { pattern: '**' },
    {
      async provideInlineCompletions(model, position, context, token) {
        const none = { items: [] };
        const target = completableModels.get(model.uri.toString());
        const settings = useSettings.getState().ai.autocomplete;
        if (!target || !settings.enabled) return none;
        const manual = context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit;
        if (!manual && !settings.automatic) return none;
        const provider = activeProvider();
        if (!provider || !providerReady(provider)) return none;
        const state = useAi.getState().completion;
        if (Date.now() < state.pausedUntil) return none;

        const offset = model.getOffsetAt(position);
        const text = model.getValue();
        const prefix = text.slice(Math.max(0, offset - 6000), offset);
        const suffix = text.slice(offset, offset + 2000);
        // Nothing useful can be suggested in the middle of a word on an empty file.
        if (!manual && prefix.trim().length < 3) return none;
        const key = `${provider.id}|${provider.autocompleteModel ?? provider.model}|${target.language}|${prefix.slice(-800)}|${suffix.slice(0, 200)}`;
        const hit = cache.get(key);
        const item = (insertText: string) => ({ items: insertText ? [{ insertText, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] : [] });
        if (hit !== undefined) return item(hit);

        if (!manual) {
          await sleep(settings.delayMs);
          if (token.isCancellationRequested) return none;
        }
        // Only the newest request is allowed to run.
        inFlight?.abort();
        const ctl = new AbortController();
        inFlight = ctl;
        const cancel = token.onCancellationRequested(() => ctl.abort());
        try {
          const adapter = await loadAdapter(provider.kind);
          const out = await adapter.complete(provider, { prefix, suffix, language: target.language, fileName: target.fileName, maxTokens: settings.maxTokens, signal: ctl.signal }, transport);
          useAi.setState((s) => ({ completion: { ...s.completion, requests: s.completion.requests + 1, usage: out.usage ? addUsage(s.completion.usage, out.usage) : s.completion.usage, lastError: undefined } }));
          if (token.isCancellationRequested) return none;
          remember(key, out.text);
          return item(out.text);
        } catch (err) {
          if (err instanceof AiError && err.kind === 'aborted') return none;
          if (ctl.signal.aborted) return none;
          const e = err instanceof AiError ? err : undefined;
          if (e?.kind === 'rate_limit') {
            const wait = e.retryAfterMs ?? 30000;
            useAi.setState((s) => ({ completion: { ...s.completion, pausedUntil: Date.now() + wait, lastError: 'rate_limit' } }));
            useUi.getState().toast(t('ai.completionPaused', { seconds: Math.ceil(wait / 1000) }), 'info');
          } else {
            // Other failures pause briefly so a broken setup does not spend tokens on every keystroke.
            useAi.setState((s) => ({ completion: { ...s.completion, pausedUntil: Date.now() + 15000, lastError: e?.kind ?? 'network' } }));
          }
          return none;
        } finally {
          cancel.dispose();
          if (inFlight === ctl) inFlight = undefined;
        }
      },
      disposeInlineCompletions() {},
    },
  );
}

export function clearCompletionCache(): void {
  cache.clear();
}
