/**
 * Anthropic adapter. Uses the official SDK with the native Messages API; it is
 * deliberately separate from the OpenAI style adapter.
 */
import Anthropic from '@anthropic-ai/sdk';
import { cleanCompletion, COMPLETION_SYSTEM, completionPrompt } from './openai';
import { anthropicModel } from './providers';
import { withRetries } from './retry';
import { AiError, type ChatRequest, type ProviderAdapter, type ProviderConfig, type StreamEvent, type Transport, type Usage } from './types';

/**
 * Bridge the SDK's fetch to a BlockForge transport. The SDK is given a
 * placeholder key; the transport adds the real one, so on desktop the key stays
 * in the system keychain and never reaches JavaScript.
 */
function sdkFetch(cfg: ProviderConfig, transport: Transport): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      if (k !== 'x-api-key' && k !== 'authorization') headers[k] = v;
    });
    const res = await transport.send({ url, method: (init?.method ?? 'GET').toUpperCase() as 'GET' | 'POST', headers, body: typeof init?.body === 'string' ? init.body : undefined, auth: { providerId: cfg.id, scheme: 'x-api-key' }, signal: init?.signal ?? undefined });
    const iterator = res.body[Symbol.asyncIterator]();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await iterator.next();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (err) {
          controller.error(err);
        }
      },
      cancel() {
        void iterator.return?.();
      },
    });
    return new Response(res.status === 204 ? null : stream, { status: res.status, headers: res.headers });
  };
}

function client(cfg: ProviderConfig, transport: Transport): Anthropic {
  return new Anthropic({
    apiKey: 'managed-by-blockforge',
    baseURL: cfg.baseUrl || undefined,
    fetch: sdkFetch(cfg, transport),
    // Retries are handled by BlockForge so the UI can show them.
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
    defaultHeaders: cfg.headers,
  });
}

function mapError(err: unknown, signal?: AbortSignal): AiError {
  if (err instanceof AiError) return err;
  if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) return new AiError('The request was cancelled.', 'aborted');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AiError(err.message, 'auth', err.status);
  if (err instanceof Anthropic.NotFoundError) return new AiError(err.message, 'not_found', err.status);
  if (err instanceof Anthropic.RateLimitError) {
    const after = err.headers?.get('retry-after');
    return new AiError(err.message, 'rate_limit', err.status, after && /^\d+(\.\d+)?$/.test(after) ? Math.round(Number(after) * 1000) : undefined);
  }
  if (err instanceof Anthropic.APIConnectionError) return new AiError(err.message, 'network');
  if (err instanceof Anthropic.APIError) return new AiError(err.message, (err.status ?? 0) >= 500 ? 'server' : 'bad_request', err.status);
  return new AiError((err as Error)?.message ?? 'Unknown error.', 'network');
}

function messages(req: ChatRequest): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of req.messages) {
    if (m.role === 'assistant') {
      // Replaying the original blocks keeps reasoning blocks valid for the next turn.
      if (m.native && m.nativeFor === 'anthropic') out.push({ role: 'assistant', content: m.native as Anthropic.ContentBlockParam[] });
      else {
        const content: Anthropic.ContentBlockParam[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: (c.input ?? {}) as Record<string, unknown> });
        if (content.length) out.push({ role: 'assistant', content });
      }
    } else {
      const content: Anthropic.ContentBlockParam[] = [];
      // Tool results must come first in the turn that follows the tool calls.
      for (const r of m.toolResults ?? []) content.push({ type: 'tool_result', tool_use_id: r.callId, content: r.content, is_error: r.isError });
      if (m.content) content.push({ type: 'text', text: m.content });
      if (content.length) out.push({ role: 'user', content });
    }
  }
  return out;
}

function usageOf(u: Anthropic.Usage | Anthropic.MessageDeltaUsage | undefined): Usage | undefined {
  if (!u) return undefined;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return { inputTokens: (u.input_tokens ?? 0) + cacheRead + cacheWrite, outputTokens: u.output_tokens ?? 0, ...(cacheRead ? { cacheReadTokens: cacheRead } : {}), ...(cacheWrite ? { cacheWriteTokens: cacheWrite } : {}) };
}

async function* run(cfg: ProviderConfig, req: ChatRequest, transport: Transport): AsyncGenerator<StreamEvent> {
  const model = req.model ?? cfg.model;
  const info = anthropicModel(model);
  const params: Anthropic.MessageStreamParams = {
    model,
    max_tokens: req.maxTokens ?? cfg.maxTokens,
    messages: messages(req),
  };
  // The system prompt is stable across turns, so it is cached.
  if (req.system) params.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
  if (info?.adaptiveThinking) params.thinking = { type: 'adaptive', display: 'summarized' };
  const effort = req.effort ?? cfg.effort;
  if (info?.effort && effort) params.output_config = { effort };
  if (cfg.capabilities.tools && req.tools?.length) {
    params.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Tool.InputSchema, eager_input_streaming: true }));
    params.tool_choice = { type: 'auto' };
  }
  const api = client(cfg, transport);
  const options = { signal: req.signal };
  const fallback = !!info?.refusalFallback && cfg.refusalFallback !== false;
  try {
    const stream = fallback
      ? api.beta.messages.stream({ ...(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as Parameters<typeof api.beta.messages.stream>[0], options)
      : api.messages.stream(params, options);
    for await (const event of stream as AsyncIterable<Anthropic.MessageStreamEvent>) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
        else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', text: event.delta.thinking };
      }
    }
    const final = (await stream.finalMessage()) as Anthropic.Message;
    const usage = usageOf(final.usage);
    if (usage) yield { type: 'usage', usage };
    if (final.stop_reason === 'refusal') {
      const details = (final as { stop_details?: { category?: string | null; explanation?: string | null } }).stop_details;
      yield { type: 'done', stopReason: 'refusal', model: final.model, native: final.content, note: details?.explanation ?? details?.category ?? undefined };
      return;
    }
    // A truncated turn can carry a cut-off tool input, so its calls are not surfaced.
    if (final.stop_reason !== 'max_tokens') {
      for (const block of final.content) {
        if (block.type === 'tool_use') yield { type: 'tool_call', call: { id: block.id, name: block.name, input: block.input, rawInput: JSON.stringify(block.input ?? {}) } };
      }
    }
    const servedBy = final.model && final.model !== model ? `Answered by ${final.model} after a fallback.` : undefined;
    yield { type: 'done', stopReason: final.stop_reason ?? 'end_turn', model: final.model, native: final.content, note: servedBy };
  } catch (err) {
    throw mapError(err, req.signal);
  }
}

export const anthropicAdapter: ProviderAdapter = {
  chat(cfg, req, transport) {
    return withRetries(cfg.maxRetries, req.signal, () => run(cfg, req, transport));
  },

  async complete(cfg, req, transport) {
    let text = '';
    let usage: Usage | undefined;
    const chatReq: ChatRequest = { system: COMPLETION_SYSTEM, messages: [{ role: 'user', content: completionPrompt(req) }], model: req.model ?? cfg.autocompleteModel ?? cfg.model, maxTokens: req.maxTokens ?? 512, effort: 'low', signal: req.signal };
    for await (const ev of run({ ...cfg, capabilities: { ...cfg.capabilities, tools: false } }, chatReq, transport)) {
      if (ev.type === 'text') text += ev.text;
      else if (ev.type === 'usage') usage = ev.usage;
    }
    return { text: cleanCompletion(text, req.suffix), usage };
  },

  async test(cfg, transport, signal) {
    try {
      const m = await client(cfg, transport).models.retrieve(cfg.model, {}, { signal });
      return { ok: true, detail: `${m.display_name} (${m.id}) is available.` };
    } catch (err) {
      throw mapError(err, signal);
    }
  },

  async listModels(cfg, transport, signal) {
    try {
      const ids: string[] = [];
      for await (const m of client(cfg, transport).models.list({}, { signal })) ids.push(m.id);
      return ids;
    } catch (err) {
      throw mapError(err, signal);
    }
  },
};
