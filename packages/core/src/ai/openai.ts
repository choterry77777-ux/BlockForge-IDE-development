/**
 * Adapter for OpenAI style HTTP APIs: OpenAI, DeepSeek and any compatible
 * endpoint. Behaviour is driven by capability flags rather than assumptions,
 * because "compatible" providers implement different subsets.
 */
import { errorFromStatus, toAiError, withRetries } from './retry';
import { parseSse, readAll } from './sse';
import { AiError, type ChatMessage, type ChatRequest, type CompletionRequest, type ProviderAdapter, type ProviderConfig, type StreamEvent, type ToolCall, type Transport, type TransportResponse, type Usage } from './types';

const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;

async function failure(res: TransportResponse): Promise<AiError> {
  const text = await readAll(res.body).catch(() => '');
  let message = '';
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    message = typeof json.error === 'string' ? json.error : (json.error?.message ?? json.message ?? '');
  } catch {
    message = text.slice(0, 300);
  }
  return errorFromStatus(res.status, message, res.headers['retry-after']);
}

function headers(cfg: ProviderConfig, stream: boolean): Record<string, string> {
  return { 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json', ...(cfg.headers ?? {}) };
}

function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// ---------- chat completions ----------

function chatMessages(cfg: ProviderConfig, req: ChatRequest): unknown[] {
  const out: unknown[] = [];
  if (req.system) out.push({ role: cfg.capabilities.systemRole, content: req.system });
  const native = cfg.capabilities.tools;
  for (const m of req.messages) {
    if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content || (m.toolCalls?.length && native ? null : '') };
      if (native && m.toolCalls?.length) msg.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.rawInput || '{}' } }));
      out.push(msg);
    } else {
      let text = m.content;
      if (m.toolResults?.length) {
        if (native) for (const r of m.toolResults) out.push({ role: 'tool', tool_call_id: r.callId, content: r.content });
        else text = `${m.toolResults.map((r) => `[Result of the previous proposal] ${r.content}`).join('\n')}\n\n${text}`;
      }
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

function chatBody(cfg: ProviderConfig, req: ChatRequest): Record<string, unknown> {
  const caps = cfg.capabilities;
  const body: Record<string, unknown> = { model: req.model ?? cfg.model, messages: chatMessages(cfg, req), stream: caps.streaming };
  body[caps.maxTokensParam] = req.maxTokens ?? cfg.maxTokens;
  if (caps.streaming && caps.usageInStream) body.stream_options = { include_usage: true };
  if (caps.sampling && cfg.temperature !== undefined) body.temperature = cfg.temperature;
  if (caps.effort && (req.effort ?? cfg.effort)) body.reasoning_effort = mapEffort(req.effort ?? cfg.effort!);
  if (caps.tools && req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
    body.tool_choice = 'auto';
  }
  return body;
}

/** OpenAI style endpoints know low / medium / high. */
function mapEffort(e: string): string {
  return e === 'xhigh' || e === 'max' ? 'high' : e;
}

function usageOf(u: Record<string, unknown> | undefined): Usage | undefined {
  if (!u) return undefined;
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
  const output = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  const details = (u.prompt_tokens_details ?? u.input_tokens_details) as { cached_tokens?: number } | undefined;
  const cached = Number(details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0);
  return { inputTokens: input, outputTokens: output, ...(cached ? { cacheReadTokens: cached } : {}) };
}

async function* chatCompletions(cfg: ProviderConfig, req: ChatRequest, transport: Transport): AsyncGenerator<StreamEvent> {
  const res = await transport.send({ url: join(cfg.baseUrl, '/chat/completions'), method: 'POST', headers: headers(cfg, cfg.capabilities.streaming), body: JSON.stringify(chatBody(cfg, req)), auth: { providerId: cfg.id, scheme: 'bearer' }, signal: req.signal });
  if (res.status < 200 || res.status >= 300) throw await failure(res);
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let stop = 'stop';
  let model: string | undefined;
  const finish = function* (): Generator<StreamEvent> {
    for (const c of [...calls.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1])) {
      const call: ToolCall = { id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: c.name, rawInput: c.args, input: parseArgs(c.args) };
      yield { type: 'tool_call', call };
    }
    yield { type: 'done', stopReason: stop, model };
  };
  if (!cfg.capabilities.streaming) {
    const json = JSON.parse(await readAll(res.body)) as { model?: string; choices?: { message?: { content?: string; reasoning_content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[]; usage?: Record<string, unknown> };
    const msg = json.choices?.[0]?.message;
    model = json.model;
    if (msg?.reasoning_content) yield { type: 'thinking', text: msg.reasoning_content };
    if (msg?.content) yield { type: 'text', text: msg.content };
    (msg?.tool_calls ?? []).forEach((c, i) => calls.set(i, { id: c.id, name: c.function.name, args: c.function.arguments }));
    stop = json.choices?.[0]?.finish_reason ?? 'stop';
    const usage = usageOf(json.usage);
    if (usage) yield { type: 'usage', usage };
    yield* finish();
    return;
  }
  for await (const ev of parseSse(res.body)) {
    if (ev.data === '[DONE]') break;
    let json: { model?: string; error?: { message?: string }; choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]; usage?: Record<string, unknown> | null };
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (json.error) throw new AiError(json.error.message ?? 'The provider reported an error.', 'server');
    if (json.model) model = json.model;
    const choice = json.choices?.[0];
    const delta = choice?.delta;
    const thinking = delta?.reasoning_content ?? delta?.reasoning;
    if (thinking) yield { type: 'thinking', text: thinking };
    if (delta?.content) yield { type: 'text', text: delta.content };
    for (const tc of delta?.tool_calls ?? []) {
      const index = tc.index ?? 0;
      const cur = calls.get(index) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      calls.set(index, cur);
    }
    if (choice?.finish_reason) stop = choice.finish_reason;
    const usage = usageOf(json.usage ?? undefined);
    if (usage) yield { type: 'usage', usage };
  }
  yield* finish();
}

// ---------- responses API ----------

function responsesInput(req: ChatRequest, native: boolean): unknown[] {
  const out: unknown[] = [];
  for (const m of req.messages) {
    if (m.role === 'assistant') {
      if (m.content) out.push({ role: 'assistant', content: m.content });
      if (native) for (const c of m.toolCalls ?? []) out.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: c.rawInput || '{}' });
    } else {
      let text = m.content;
      if (m.toolResults?.length) {
        if (native) for (const r of m.toolResults) out.push({ type: 'function_call_output', call_id: r.callId, output: r.content });
        else text = `${m.toolResults.map((r) => `[Result of the previous proposal] ${r.content}`).join('\n')}\n\n${text}`;
      }
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

async function* responsesApi(cfg: ProviderConfig, req: ChatRequest, transport: Transport): AsyncGenerator<StreamEvent> {
  const caps = cfg.capabilities;
  const body: Record<string, unknown> = { model: req.model ?? cfg.model, input: responsesInput(req, caps.tools), stream: true, max_output_tokens: req.maxTokens ?? cfg.maxTokens, store: false };
  if (req.system) body.instructions = req.system;
  if (caps.sampling && cfg.temperature !== undefined) body.temperature = cfg.temperature;
  if (caps.effort && (req.effort ?? cfg.effort)) body.reasoning = { effort: mapEffort(req.effort ?? cfg.effort!) };
  if (caps.tools && req.tools?.length) body.tools = req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema }));
  const res = await transport.send({ url: join(cfg.baseUrl, '/responses'), method: 'POST', headers: headers(cfg, true), body: JSON.stringify(body), auth: { providerId: cfg.id, scheme: 'bearer' }, signal: req.signal });
  if (res.status < 200 || res.status >= 300) throw await failure(res);
  const calls = new Map<string, { id: string; name: string; args: string }>();
  let stop = 'stop';
  let model: string | undefined;
  for await (const ev of parseSse(res.body)) {
    if (ev.data === '[DONE]') break;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = (json.type as string) ?? ev.event ?? '';
    const item = json.item as { type?: string; id?: string; call_id?: string; name?: string; arguments?: string } | undefined;
    switch (type) {
      case 'response.output_text.delta':
        if (json.delta) yield { type: 'text', text: String(json.delta) };
        break;
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (json.delta) yield { type: 'thinking', text: String(json.delta) };
        break;
      case 'response.output_item.added':
        if (item?.type === 'function_call' && item.id) calls.set(item.id, { id: item.call_id ?? item.id, name: item.name ?? '', args: item.arguments ?? '' });
        break;
      case 'response.function_call_arguments.delta': {
        const cur = calls.get(String(json.item_id));
        if (cur) cur.args += String(json.delta ?? '');
        break;
      }
      case 'response.output_item.done':
        if (item?.type === 'function_call' && item.id) calls.set(item.id, { id: item.call_id ?? item.id, name: item.name ?? calls.get(item.id)?.name ?? '', args: item.arguments ?? calls.get(item.id)?.args ?? '' });
        break;
      case 'response.completed':
      case 'response.incomplete': {
        const response = json.response as { model?: string; status?: string; usage?: Record<string, unknown>; incomplete_details?: { reason?: string } } | undefined;
        model = response?.model;
        const usage = usageOf(response?.usage);
        if (usage) yield { type: 'usage', usage };
        if (type === 'response.incomplete') stop = response?.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'incomplete';
        break;
      }
      case 'response.failed':
      case 'error': {
        const e = ((json.response as { error?: { message?: string } } | undefined)?.error ?? (json as { error?: { message?: string }; message?: string }).error ?? json) as { message?: string };
        throw new AiError(e.message ?? 'The provider reported an error.', 'server');
      }
      default:
        break;
    }
  }
  for (const c of calls.values()) {
    yield { type: 'tool_call', call: { id: c.id, name: c.name, rawInput: c.args, input: parseArgs(c.args) } };
    stop = 'tool_calls';
  }
  yield { type: 'done', stopReason: stop, model };
}

// ---------- completion ----------

const COMPLETION_SYSTEM =
  'You complete source code at the cursor. Reply with only the code that should be inserted at <CURSOR>, with no explanation and no Markdown fences. Do not repeat code that already exists before or after the cursor. Reply with an empty message if nothing should be inserted.';

export function completionPrompt(req: CompletionRequest): string {
  return `Language: ${req.language}${req.fileName ? `\nFile: ${req.fileName}` : ''}\n\n<code>\n${req.prefix}<CURSOR>${req.suffix}\n</code>`;
}

/** Strip fences and text that merely repeats what follows the cursor. */
export function cleanCompletion(text: string, suffix: string): string {
  let out = text.replace(/^\s*```[\w+-]*\n?/, '').replace(/\n?```\s*$/, '');
  out = out.replace(/<CURSOR>/g, '');
  const tail = suffix.trimStart().slice(0, 80);
  if (tail.length >= 8) {
    const idx = out.indexOf(tail.slice(0, Math.min(tail.length, 40)));
    if (idx > 0) out = out.slice(0, idx);
    else if (idx === 0) out = '';
  }
  return out.replace(/\s+$/, (m) => (m.includes('\n') ? '\n' : ''));
}

async function fim(cfg: ProviderConfig, req: CompletionRequest, transport: Transport): Promise<{ text: string; usage?: Usage }> {
  // DeepSeek serves fill-in-the-middle from the beta path of the same host.
  const base = cfg.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const body = { model: req.model ?? cfg.autocompleteModel ?? cfg.model, prompt: req.prefix, suffix: req.suffix, max_tokens: req.maxTokens ?? 256, stream: false };
  const res = await transport.send({ url: `${base}/beta/completions`, method: 'POST', headers: headers(cfg, false), body: JSON.stringify(body), auth: { providerId: cfg.id, scheme: 'bearer' }, signal: req.signal });
  if (res.status < 200 || res.status >= 300) throw await failure(res);
  const json = JSON.parse(await readAll(res.body)) as { choices?: { text?: string }[]; usage?: Record<string, unknown> };
  return { text: json.choices?.[0]?.text ?? '', usage: usageOf(json.usage) };
}

export const openAiAdapter: ProviderAdapter = {
  chat(cfg, req, transport) {
    const run = cfg.capabilities.apiStyle === 'responses' ? responsesApi : chatCompletions;
    return withRetries(cfg.maxRetries, req.signal, () => run(cfg, req, transport));
  },

  async complete(cfg, req, transport) {
    try {
      if (cfg.capabilities.fim) return await fim(cfg, req, transport);
      const messages: ChatMessage[] = [{ role: 'user', content: completionPrompt(req) }];
      let text = '';
      let usage: Usage | undefined;
      const chatReq: ChatRequest = { system: COMPLETION_SYSTEM, messages, model: req.model ?? cfg.autocompleteModel ?? cfg.model, maxTokens: req.maxTokens ?? 256, effort: 'low', signal: req.signal };
      const run = cfg.capabilities.apiStyle === 'responses' ? responsesApi : chatCompletions;
      for await (const ev of run({ ...cfg, maxRetries: 0 }, chatReq, transport)) {
        if (ev.type === 'text') text += ev.text;
        else if (ev.type === 'usage') usage = ev.usage;
      }
      return { text: cleanCompletion(text, req.suffix), usage };
    } catch (err) {
      throw req.signal?.aborted ? new AiError('The request was cancelled.', 'aborted') : toAiError(err);
    }
  },

  async test(cfg, transport, signal) {
    try {
      const probe: ChatRequest = { messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 16, signal };
      const run = cfg.capabilities.apiStyle === 'responses' ? responsesApi : chatCompletions;
      let text = '';
      let model: string | undefined;
      for await (const ev of run({ ...cfg, capabilities: { ...cfg.capabilities, tools: false } }, probe, transport)) {
        if (ev.type === 'text') text += ev.text;
        else if (ev.type === 'done') model = ev.model;
      }
      return { ok: true, detail: `${model ?? cfg.model} replied: ${text.trim().slice(0, 40) || '(empty)'}` };
    } catch (err) {
      throw toAiError(err);
    }
  },

  async listModels(cfg, transport, signal) {
    if (!cfg.capabilities.modelList) return cfg.models;
    const res = await transport.send({ url: join(cfg.baseUrl, '/models'), method: 'GET', headers: headers(cfg, false), auth: { providerId: cfg.id, scheme: 'bearer' }, signal });
    if (res.status < 200 || res.status >= 300) throw await failure(res);
    const json = JSON.parse(await readAll(res.body)) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => m.id).sort();
  },
};

export { COMPLETION_SYSTEM };
