/** Provider independent AI types. Adapters translate these to each API. */

export type ProviderKind = 'anthropic' | 'openai' | 'deepseek' | 'openai-compatible' | 'custom';
export type ApiStyle = 'anthropic' | 'chat-completions' | 'responses';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** What an endpoint can do. Never assumed: compatible providers differ widely. */
export interface ProviderCapabilities {
  apiStyle: ApiStyle;
  streaming: boolean;
  /** Native tool / function calling. When false, proposals use fenced JSON in text. */
  tools: boolean;
  /** Usage numbers are reported in the stream. */
  usageInStream: boolean;
  /** Accepts temperature / top_p. */
  sampling: boolean;
  /** Fill-in-the-middle completion endpoint (prompt + suffix). */
  fim: boolean;
  /** Accepts an effort / reasoning effort setting. */
  effort: boolean;
  /** Name of the output limit parameter for chat-completions style APIs. */
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
  /** Role used for the system prompt in chat-completions style APIs. */
  systemRole: 'system' | 'developer';
  /** GET {base}/models is available. */
  modelList: boolean;
}

export interface Pricing {
  /** US dollars per million tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  /** Where the numbers came from, shown next to cost estimates. */
  source: string;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  /** Base URL without a trailing slash, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  model: string;
  /** Model used for inline completion; falls back to `model`. */
  autocompleteModel?: string;
  models: string[];
  capabilities: ProviderCapabilities;
  maxTokens: number;
  temperature?: number;
  effort?: Effort;
  /** Extra non-secret headers for custom endpoints. */
  headers?: Record<string, string>;
  /** Per-model price overrides entered by the user. */
  pricing?: Record<string, Pricing>;
  maxRetries: number;
  /** Anthropic: let the API retry a declined request on another model. */
  refusalFallback?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the input object. */
  schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed input; undefined when the JSON could not be parsed. */
  input?: unknown;
  rawInput: string;
}

export interface ToolResult {
  callId: string;
  content: string;
  isError?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Tool calls made by the assistant in this turn. */
  toolCalls?: ToolCall[];
  /** Results for the previous assistant turn's tool calls; sent before `content`. */
  toolResults?: ToolResult[];
  /**
   * Provider native content of an assistant turn. Replayed unchanged so that
   * reasoning blocks stay valid; only used when `nativeFor` matches the provider kind.
   */
  native?: unknown;
  nativeFor?: ProviderKind;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'retry'; attempt: number; delayMs: number; reason: string }
  | { type: 'done'; stopReason: string; model?: string; native?: unknown; note?: string };

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  model?: string;
  maxTokens?: number;
  effort?: Effort;
  signal?: AbortSignal;
}

export interface CompletionRequest {
  prefix: string;
  suffix: string;
  language: string;
  fileName?: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Authentication is described, not carried: the transport adds the secret. */
export interface AuthSpec {
  providerId: string;
  scheme: 'bearer' | 'x-api-key' | 'none';
}

export interface TransportRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  auth: AuthSpec;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  /** Response body as a stream of byte chunks. */
  body: AsyncIterable<Uint8Array>;
}

/**
 * Sends HTTP requests on behalf of adapters. The browser transport uses fetch
 * with a key held in memory; the desktop transport runs in the Rust backend and
 * reads the key from the system keychain, so the key never enters the web view.
 */
export interface Transport {
  send(req: TransportRequest): Promise<TransportResponse>;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate_limit' | 'bad_request' | 'not_found' | 'server' | 'network' | 'aborted' | 'refusal' | 'unsupported',
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'server' || this.kind === 'network';
  }
}

export interface ProviderAdapter {
  chat(cfg: ProviderConfig, req: ChatRequest, transport: Transport): AsyncGenerator<StreamEvent>;
  /** Inline code completion. Returns the text to insert at the cursor. */
  complete(cfg: ProviderConfig, req: CompletionRequest, transport: Transport): Promise<{ text: string; usage?: Usage }>;
  /** Cheap request that proves the key, URL and model work. */
  test(cfg: ProviderConfig, transport: Transport, signal?: AbortSignal): Promise<{ ok: true; detail: string }>;
  listModels(cfg: ProviderConfig, transport: Transport, signal?: AbortSignal): Promise<string[]>;
}
