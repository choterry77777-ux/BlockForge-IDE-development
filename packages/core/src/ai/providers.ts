import type { Effort, Pricing, ProviderAdapter, ProviderCapabilities, ProviderConfig, ProviderKind, Usage } from './types';

export interface AnthropicModelInfo {
  id: string;
  label: string;
  adaptiveThinking: boolean;
  effort: boolean;
  /** Server-side refusal fallback is offered for this model. */
  refusalFallback: boolean;
  pricing: Pricing;
}

const PRICE_SOURCE = 'Anthropic list price, cached 2026-11';

export const ANTHROPIC_MODELS: AnthropicModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', adaptiveThinking: true, effort: true, refusalFallback: true, pricing: { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, source: PRICE_SOURCE } },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', adaptiveThinking: true, effort: true, refusalFallback: true, pricing: { inputPerMTok: 8, outputPerMTok: 40, cacheReadPerMTok: 0.2, source: PRICE_SOURCE } },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', adaptiveThinking: true, effort: true, refusalFallback: true, pricing: { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1, source: PRICE_SOURCE } },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', adaptiveThinking: true, effort: true, refusalFallback: false, pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5, source: PRICE_SOURCE } },
];

export function anthropicModel(id: string): AnthropicModelInfo | undefined {
  return ANTHROPIC_MODELS.find((m) => m.id === id);
}

const CHAT: ProviderCapabilities = { apiStyle: 'chat-completions', streaming: true, tools: true, usageInStream: true, sampling: true, fim: false, effort: false, maxTokensParam: 'max_tokens', systemRole: 'system', modelList: true };

export const CAPABILITY_PRESETS: Record<ProviderKind, ProviderCapabilities> = {
  anthropic: { apiStyle: 'anthropic', streaming: true, tools: true, usageInStream: true, sampling: false, fim: false, effort: true, maxTokensParam: 'max_tokens', systemRole: 'system', modelList: true },
  openai: { ...CHAT, apiStyle: 'responses', sampling: false, effort: true, maxTokensParam: 'max_completion_tokens', systemRole: 'developer' },
  deepseek: { ...CHAT, fim: true },
  // Conservative defaults: features are switched on by the user after testing.
  'openai-compatible': { ...CHAT, tools: false, usageInStream: false, modelList: true },
  custom: { ...CHAT, tools: false, usageInStream: false, modelList: false },
};

export interface ProviderPreset {
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  model: string;
  models: string[];
  maxTokens: number;
  effort?: Effort;
  keyHint: string;
  /** Whether the provider permits requests straight from a web page. */
  browserNote: string;
}

export const PROVIDER_PRESETS: Record<ProviderKind, ProviderPreset> = {
  anthropic: { kind: 'anthropic', name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', models: ANTHROPIC_MODELS.map((m) => m.id), maxTokens: 64000, effort: 'medium', keyHint: 'sk-ant-...', browserNote: 'Works from a browser only because BlockForge sends the explicit direct-browser-access header. The key is visible to this page.' },
  openai: { kind: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', models: [], maxTokens: 16000, keyHint: 'sk-...', browserNote: 'Browser requests may be blocked by CORS. The desktop app is not affected.' },
  deepseek: { kind: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], maxTokens: 8000, keyHint: 'sk-...', browserNote: 'Browser requests may be blocked by CORS. The desktop app is not affected.' },
  'openai-compatible': { kind: 'openai-compatible', name: 'OpenAI-compatible', baseUrl: 'http://localhost:11434/v1', model: '', models: [], maxTokens: 8000, keyHint: 'Leave empty for local servers', browserNote: 'The server must allow cross-origin requests when used from a browser.' },
  custom: { kind: 'custom', name: 'Custom endpoint', baseUrl: '', model: '', models: [], maxTokens: 8000, keyHint: 'API key, if the endpoint needs one', browserNote: 'The server must allow cross-origin requests when used from a browser.' },
};

export function createProviderConfig(kind: ProviderKind, id: string): ProviderConfig {
  const p = PROVIDER_PRESETS[kind];
  return { id, kind, name: p.name, baseUrl: p.baseUrl, model: p.model, models: [...p.models], capabilities: { ...CAPABILITY_PRESETS[kind] }, maxTokens: p.maxTokens, effort: p.effort, maxRetries: 2, refusalFallback: kind === 'anthropic' ? true : undefined };
}

/** Adapters are loaded on demand; the Anthropic SDK is only fetched when used. */
export async function loadAdapter(kind: ProviderKind): Promise<ProviderAdapter> {
  if (kind === 'anthropic') return (await import('./anthropic')).anthropicAdapter;
  return (await import('./openai')).openAiAdapter;
}

export function pricingFor(cfg: ProviderConfig, model: string): Pricing | undefined {
  return cfg.pricing?.[model] ?? (cfg.kind === 'anthropic' ? anthropicModel(model)?.pricing : undefined);
}

/** Cost in US dollars, or undefined when no reliable price is known. */
export function estimateCost(usage: Usage, pricing: Pricing | undefined): number | undefined {
  if (!pricing) return undefined;
  const cached = usage.cacheReadTokens ?? 0;
  const fresh = Math.max(0, usage.inputTokens - cached);
  return (fresh * pricing.inputPerMTok + cached * (pricing.cacheReadPerMTok ?? pricing.inputPerMTok) + usage.outputTokens * pricing.outputPerMTok) / 1_000_000;
}

export function addUsage(a: Usage | undefined, b: Usage): Usage {
  if (!a) return { ...b };
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) || undefined,
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) || undefined,
  };
}
