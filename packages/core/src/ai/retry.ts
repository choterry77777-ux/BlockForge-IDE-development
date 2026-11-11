import { AiError, type StreamEvent } from './types';

export function errorFromStatus(status: number, message: string, retryAfter?: string): AiError {
  const retryAfterMs = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter) ? Math.round(Number(retryAfter) * 1000) : undefined;
  if (status === 401 || status === 403) return new AiError(message || 'The API key was rejected.', 'auth', status);
  if (status === 404) return new AiError(message || 'The endpoint or model was not found.', 'not_found', status);
  if (status === 429) return new AiError(message || 'The rate limit was reached.', 'rate_limit', status, retryAfterMs);
  if (status >= 500) return new AiError(message || 'The provider had a server error.', 'server', status, retryAfterMs);
  return new AiError(message || `The request was rejected (HTTP ${status}).`, 'bad_request', status);
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const e = err as { name?: string; message?: string };
  if (e?.name === 'AbortError') return new AiError('The request was cancelled.', 'aborted');
  return new AiError(e?.message || 'Network error.', 'network');
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiError('The request was cancelled.', 'aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AiError('The request was cancelled.', 'aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Backoff delay honouring Retry-After, capped so the UI never waits blindly. */
export function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, 60000);
  return Math.min(1000 * 2 ** (attempt - 1), 16000);
}

/**
 * Run a streaming attempt with retries. A retry only happens when nothing has
 * been yielded yet, so partial output is never duplicated.
 */
export async function* withRetries(maxRetries: number, signal: AbortSignal | undefined, attempt: () => AsyncGenerator<StreamEvent>, wait: (ms: number, signal?: AbortSignal) => Promise<void> = sleep): AsyncGenerator<StreamEvent> {
  for (let n = 1; ; n++) {
    let produced = false;
    try {
      for await (const ev of attempt()) {
        produced = true;
        yield ev;
      }
      return;
    } catch (err) {
      const e = signal?.aborted ? new AiError('The request was cancelled.', 'aborted') : toAiError(err);
      if (produced || !e.retryable || n > maxRetries) throw e;
      const delayMs = backoffMs(n, e.retryAfterMs);
      yield { type: 'retry', attempt: n, delayMs, reason: e.kind === 'rate_limit' ? 'rate_limit' : e.message };
      await wait(delayMs, signal);
    }
  }
}
