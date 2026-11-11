import {
  addUsage,
  AiError,
  applyBlockOps,
  applyFileEdits,
  type BlockOp,
  buildContext,
  type ChatMessage,
  type ContextParts,
  countBlocks,
  domainOf,
  type EditIssue,
  estimateCost,
  type CommandRequest,
  extractProposals,
  isRiskyCommand,
  type FileChange,
  type FileEdit,
  hasErrors,
  type Issue,
  languageByExtension,
  loadAdapter,
  matchesGlob,
  parseBlockOps,
  parseFileEdits,
  pricingFor,
  type ProviderConfig,
  type ProviderKind,
  redactSecrets,
  stripProposalFences,
  terminalEnvelope,
  TOOL_READ_TERMINAL,
  TOOL_RUN_COMMAND,
  systemPrompt,
  TOOL_BLOCK_EDITS,
  TOOL_FILE_EDITS,
  type ToolCall,
  type ToolResult,
  type Transport,
  type Usage,
  type WorkspaceState,
  workspaceToSpecs,
} from '@blockforge/core';
import { create } from 'zustand';
import { blockEditors } from '../blockly/BlocklyPane';
import { diagText, t } from '../i18n';
import { getPlatform } from '../platform';
import { runActive } from '../runtime/runner';
import { activeFile, useProject } from '../state/project';
import { outputText, useRun } from '../state/run';
import { activeProvider, useSettings } from '../state/settings';
import { confirmDialog, useUi } from '../state/ui';
import { activeDoc, runnableLanguage, useWorkspace } from '../state/workspace';
import { readSession, runTask } from '../terminal/sessions';

export const transport: Transport = { send: (req) => getPlatform().aiSend(req) };

export interface Verification {
  ok: boolean;
  text: string;
}

export interface BlockProposal {
  fileId: string;
  summary?: string;
  ops: BlockOp[];
  before: WorkspaceState;
  preview?: WorkspaceState;
  created: string[];
  removed: string[];
  issues: Issue[];
  destructive: boolean;
  status: 'pending' | 'applied' | 'rejected' | 'invalid';
  callId?: string;
  checkpoint?: number;
  verify?: Verification;
}

export interface FileProposal {
  summary?: string;
  edits: FileEdit[];
  changes: FileChange[];
  issues: EditIssue[];
  destructive: boolean;
  status: 'pending' | 'applied' | 'rejected' | 'invalid';
  callId?: string;
  checkpoint?: number;
  verify?: Verification;
}

/** A terminal request of the assistant and what became of it. */
export interface CommandCard extends CommandRequest {
  status: 'pending' | 'running' | 'done' | 'rejected' | 'failed';
  /** Always needs the user's approval, whatever the setting. */
  risky: boolean;
  output?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  error?: string;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  error?: string;
  notice?: string;
  toolCalls?: ToolCall[];
  native?: unknown;
  nativeFor?: ProviderKind;
  blocks?: BlockProposal;
  files?: FileProposal;
  commands?: CommandCard[];
  /** Tool calls that could not be read, with the message returned for each. */
  failedCalls?: { callId: string; message: string }[];
  /** Problems reading the proposal payload. */
  proposalIssues?: string[];
  usage?: Usage;
  model?: string;
  /** Exactly what project content accompanied a user message. */
  context?: string;
  attached?: string[];
}

export interface Attach {
  file: boolean;
  selection: boolean;
  blocks: boolean;
  problems: boolean;
  output: boolean;
}

interface AiStore {
  messages: UiMessage[];
  streaming: boolean;
  attach: Attach;
  totals: { usage?: Usage; cost?: number; costKnown: boolean; requests: number };
  completion: { requests: number; usage?: Usage; pausedUntil: number; lastError?: string };
  /** Which providers have a key stored. */
  keys: Record<string, boolean>;
  set: (patch: Partial<AiStore>) => void;
}

export const useAi = create<AiStore>((set) => ({
  messages: [],
  streaming: false,
  attach: { file: true, selection: false, blocks: true, problems: true, output: false },
  totals: { costKnown: true, requests: 0 },
  completion: { requests: 0, pausedUntil: 0 },
  keys: {},
  set: (patch) => set(patch),
}));

let controller: AbortController | undefined;
let idCounter = 0;
const newId = () => `m${Date.now().toString(36)}${++idCounter}`;

/** Selected code of the active editor, provided by the code pane. */
export const codeSelection: { get: () => string } = { get: () => '' };

function patchMessage(id: string, patch: Partial<UiMessage> | ((m: UiMessage) => Partial<UiMessage>)): void {
  useAi.setState((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)) }));
}

export async function refreshKeys(): Promise<void> {
  const keys: Record<string, boolean> = {};
  for (const p of useSettings.getState().ai.providers) keys[p.id] = await getPlatform().hasSecret(p.id).catch(() => false);
  useAi.setState({ keys });
}

/** A provider can be used when it has a key, or is a local endpoint that needs none. */
export function providerReady(p: ProviderConfig | undefined): boolean {
  if (!p || !p.model || !p.baseUrl) return false;
  if (useAi.getState().keys[p.id]) return true;
  return (p.kind === 'openai-compatible' || p.kind === 'custom') && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(p.baseUrl);
}

function outcome(p: { status: string; issues: { message: string }[]; verify?: Verification } | undefined, what: string): string {
  if (!p) return `The ${what} proposal could not be read.`;
  switch (p.status) {
    case 'applied':
      return `The user applied the ${what} proposal.${p.verify ? ` Result reported by the application: ${p.verify.text}` : ''}`;
    case 'rejected':
      return `The user rejected the ${what} proposal.`;
    case 'invalid':
      return `The ${what} proposal failed validation and was not applied: ${p.issues.map((i) => i.message).slice(0, 8).join('; ')}`;
    default:
      return `The user has not decided on the ${what} proposal yet.`;
  }
}

/** Conversation as provider independent messages, including results of earlier proposals. */
function history(messages: UiMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let pending: ToolResult[] = [];
  let pendingText: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const body = [...pendingText, m.context, m.text].filter(Boolean).join('\n\n');
      out.push({ role: 'user', content: body, toolResults: pending.length ? pending : undefined });
      pending = [];
      pendingText = [];
      continue;
    }
    if (m.status === 'error' && !m.text) continue;
    const calls = m.status === 'done' ? m.toolCalls : undefined;
    out.push({ role: 'assistant', content: m.text, toolCalls: calls, native: m.status === 'done' ? m.native : undefined, nativeFor: m.nativeFor });
    for (const c of calls ?? []) {
      const failed = m.failedCalls?.find((f) => f.callId === c.id);
      if (failed) {
        pending.push({ callId: c.id, content: failed.message, isError: true });
        continue;
      }
      if (c.name === TOOL_RUN_COMMAND.name || c.name === TOOL_READ_TERMINAL.name) {
        const card = m.commands?.find((x) => x.callId === c.id);
        pending.push({ callId: c.id, content: commandOutcome(card), isError: !card || card.status === 'failed' });
        continue;
      }
      const isBlocks = c.name === TOOL_BLOCK_EDITS.name;
      const p = isBlocks ? m.blocks : m.files;
      pending.push({ callId: c.id, content: outcome(p && p.callId === c.id ? p : undefined, isBlocks ? 'block edit' : 'file edit'), isError: !p || p.status === 'invalid' });
    }
    // Proposals written as fenced JSON have no call to answer, so the outcome travels as text.
    if (m.blocks && !m.blocks.callId) pendingText.push(`[Application] ${outcome(m.blocks, 'block edit')}`);
    if (m.files && !m.files.callId) pendingText.push(`[Application] ${outcome(m.files, 'file edit')}`);
  }
  // Results with no user message after them: the assistant continues on its own after a command.
  if (pending.length || pendingText.length) out.push({ role: 'user', content: pendingText.join('\n\n'), toolResults: pending.length ? pending : undefined });
  return out;
}

function commandOutcome(c: CommandCard | undefined): string {
  if (!c) return 'The request could not be read.';
  switch (c.status) {
    case 'done':
      if (c.kind === 'read') return terminalEnvelope(c.output || '(the terminal shows nothing)');
      return `${c.timedOut ? 'The command was stopped at the time limit.' : `Exit code ${c.exitCode ?? 'unknown'}.`}\n${terminalEnvelope(c.output || '(no output)')}`;
    case 'rejected':
      return c.error ?? 'The user did not allow this.';
    case 'failed':
      return `It could not be run: ${c.error ?? 'unknown error'}`;
    default:
      return 'The user has not decided yet.';
  }
}

function gatherContext(attach: Attach): { parts: ContextParts; labels: string[] } {
  const project = useProject.getState().project;
  const file = activeFile();
  const parts: ContextParts = {};
  const labels: string[] = [];
  const doc = activeDoc();
  if (doc) {
    // A text tab: its content, the selection and the last output can be attached.
    parts.fileName = doc.name;
    parts.language = runnableLanguage(doc.language);
    if (attach.file && doc.text.trim()) {
      parts.code = doc.text;
      labels.push(t('ai.ctxFile', { name: doc.name }));
    }
    if (attach.selection) {
      const sel = codeSelection.get();
      if (sel) {
        parts.selection = sel;
        labels.push(t('ai.ctxSelection'));
      }
    }
    if (attach.output) {
      const out = outputText();
      if (out.trim()) {
        parts.output = out;
        labels.push(t('ai.ctxOutput'));
      }
    }
    return { parts, labels };
  }
  if (!project || !file) return { parts, labels };
  const excluded = project.settings.aiExclude.some((g) => matchesGlob(file.name, g));
  if (excluded) return { parts, labels: [t('ai.excludedFile', { name: file.name })] };
  const result = useProject.getState().results[file.id];
  parts.fileName = file.name;
  parts.language = file.language;
  if (attach.blocks && file.mode === 'blocks') {
    const state = blockEditors.get(file.id)?.getState() ?? file.blocks;
    parts.blocks = workspaceToSpecs(state);
    labels.push(t('ai.ctxBlocks', { count: countBlocks(state) }));
    const selected = blockEditors.get(file.id)?.selectedIds() ?? [];
    if (selected.length) {
      const flat = parts.blocks.flat();
      const find = (list: typeof flat, id: string): (typeof flat)[number] | undefined => {
        for (const b of list) {
          if (b.id === id) return b;
          const hit = find([...Object.values(b.inputs ?? {}), ...Object.values(b.statements ?? {}).flat()], id);
          if (hit) return hit;
        }
        return undefined;
      };
      parts.selectedBlocks = selected.flatMap((id) => find(flat, id) ?? []);
    }
  }
  if (attach.file) {
    parts.code = file.code;
    labels.push(t('ai.ctxFile', { name: file.name }));
  }
  if (attach.selection) {
    const sel = codeSelection.get();
    if (sel) {
      parts.selection = sel;
      labels.push(t('ai.ctxSelection'));
    }
  }
  if (attach.problems) {
    const diags = [...(file.mode === 'blocks' ? (result?.diagnostics ?? []) : []), ...useRun.getState().diagnostics].filter((d) => d.severity !== 'info');
    if (diags.length) {
      parts.diagnostics = diags.map((d) => ({ ...d, message: d.message }));
      labels.push(t('ai.ctxProblems', { count: diags.length }));
    }
  }
  if (attach.output) {
    const out = outputText();
    if (out.trim()) {
      parts.output = out;
      labels.push(t('ai.ctxOutput'));
    }
  }
  return { parts, labels };
}

async function consent(provider: ProviderConfig, labels: string[]): Promise<'send' | 'omit' | 'cancel'> {
  const ai = useSettings.getState().ai;
  if (!labels.length) return 'omit';
  if (ai.context === 'never') return 'omit';
  if (ai.context === 'always' || ai.consented.includes(provider.id)) return 'send';
  const ok = await confirmDialog({ title: t('ai.consentTitle', { name: provider.name }), message: t('ai.consentMessage', { url: provider.baseUrl }), detail: labels.join('\n'), confirmLabel: t('ai.consentAllow') });
  if (!ok) return 'cancel';
  useSettings.getState().update({ ai: { consented: [...ai.consented, provider.id] } });
  return 'send';
}

function evaluateProposals(m: UiMessage, text: string, calls: ToolCall[]): Partial<UiMessage> {
  const project = useProject.getState().project;
  const file = activeFile();
  const found = extractProposals(text, calls);
  const patch: Partial<UiMessage> = { proposalIssues: found.issues.length ? found.issues : undefined };
  void m;
  if (found.blocks && file && project) {
    if (file.mode !== 'blocks') patch.proposalIssues = [...(patch.proposalIssues ?? []), t('ai.blocksDetached')];
    else {
      const before = blockEditors.get(file.id)?.getState() ?? file.blocks;
      const parsed = parseBlockOps(found.blocks.raw);
      const applied = parsed.issues.length ? undefined : applyBlockOps(before, parsed.ops, domainOf(file.language));
      const issues = [...parsed.issues, ...(applied?.issues ?? [])];
      patch.blocks = { fileId: file.id, summary: found.blocks.summary, ops: parsed.ops, before, preview: applied?.ok ? applied.state : undefined, created: applied?.created ?? [], removed: applied?.removed ?? [], issues, destructive: !!applied?.destructive, status: issues.length ? 'invalid' : 'pending', callId: found.blocks.callId };
    }
  }
  if (found.files && project) {
    const parsed = parseFileEdits(found.files.raw, project.settings.aiExclude);
    const files = Object.fromEntries(project.files.map((f) => [f.name, f.code]));
    const applied = parsed.issues.length ? undefined : applyFileEdits(files, parsed.edits);
    const issues = [...parsed.issues, ...(applied?.issues ?? [])];
    patch.files = { summary: found.files.summary, edits: parsed.edits, changes: applied?.ok ? applied.changes : [], issues, destructive: !!applied?.destructive, status: issues.length ? 'invalid' : 'pending', callId: found.files.callId };
  }
  if (found.failedCalls?.length) patch.failedCalls = found.failedCalls;
  if (found.commands?.length) {
    const allowed = terminalAllowed();
    patch.commands = found.commands.map((c) => ({ ...c, risky: c.kind === 'run' && isRiskyCommand(c.command ?? ''), status: allowed ? 'pending' : 'rejected', error: allowed ? undefined : 'Terminal access is turned off in the application settings.' }));
  }
  return patch;
}

/** The assistant may use the terminal: the desktop app, the setting, and somewhere to run. */
export function terminalAllowed(): boolean {
  if (useSettings.getState().ai.commands === 'off' || !getPlatform().terminal.available) return false;
  return !!useWorkspace.getState().folder || !!useProject.getState().project;
}

let commandAbort: AbortController | undefined;

export function stopChat(): void {
  controller?.abort();
  commandAbort?.abort();
}

function patchCommand(messageId: string, callId: string, patch: Partial<CommandCard>): void {
  patchMessage(messageId, (m) => ({ commands: m.commands?.map((c) => (c.callId === callId ? { ...c, ...patch } : c)) }));
}

const findCommand = (messageId: string, callId: string) => useAi.getState().messages.find((m) => m.id === messageId)?.commands?.find((c) => c.callId === callId);

/** Longest unattended chain of assistant steps before the user has to speak again. */
const MAX_AUTO_STEPS = 12;

async function execute(messageId: string, callId: string): Promise<void> {
  const card = findCommand(messageId, callId);
  if (!card || card.status !== 'pending') return;
  patchCommand(messageId, callId, { status: 'running' });
  try {
    if (card.kind === 'read') {
      // Terminal text can hold keys and tokens; anything that looks like one is removed.
      patchCommand(messageId, callId, { status: 'done', output: redactSecrets(readSession(undefined, card.lines ?? 80)) });
    } else {
      commandAbort = new AbortController();
      const r = await runTask(card.command ?? '', { timeoutMs: 120_000, signal: commandAbort.signal });
      patchCommand(messageId, callId, { status: 'done', output: redactSecrets(r.output), exitCode: r.code, timedOut: r.timedOut });
    }
  } catch (err) {
    patchCommand(messageId, callId, { status: 'failed', error: redactSecrets(String((err as Error)?.message ?? err)) });
  } finally {
    commandAbort = undefined;
  }
}

/** Run a command the user allowed, then let the assistant see the result. */
export async function approveCommand(messageId: string, callId: string): Promise<void> {
  await execute(messageId, callId);
  await continueAfterCommands(messageId);
}

export async function rejectCommand(messageId: string, callId: string): Promise<void> {
  if (findCommand(messageId, callId)?.status !== 'pending') return;
  patchCommand(messageId, callId, { status: 'rejected' });
  await continueAfterCommands(messageId);
}

/** With "run without asking", commands that are not risky start on their own. */
async function autoRun(messageId: string): Promise<void> {
  if (useSettings.getState().ai.commands !== 'auto') return;
  for (const c of useAi.getState().messages.find((m) => m.id === messageId)?.commands ?? []) {
    if (c.status === 'pending' && !c.risky) await execute(messageId, c.callId);
  }
  await continueAfterCommands(messageId);
}

/** Once every request of the last assistant message is settled, send the results back. */
async function continueAfterCommands(messageId: string): Promise<void> {
  const state = useAi.getState();
  const last = state.messages[state.messages.length - 1];
  if (state.streaming || !last || last.id !== messageId || !last.commands?.length) return;
  if (last.commands.some((c) => c.status === 'pending' || c.status === 'running')) return;
  let steps = 0;
  for (let i = state.messages.length - 1; i >= 0 && state.messages[i].role === 'assistant'; i--) steps++;
  if (steps >= MAX_AUTO_STEPS) {
    patchMessage(messageId, { notice: t('ai.cmd.limit', { count: steps }) });
    return;
  }
  const provider = activeProvider();
  if (!provider || !providerReady(provider)) return;
  const reply: UiMessage = { id: newId(), role: 'assistant', text: '', status: 'streaming', nativeFor: provider.kind, model: provider.model };
  useAi.setState((s) => ({ messages: [...s.messages, reply], streaming: true }));
  await runTurn(provider, reply.id);
}

export function clearChat(): void {
  stopChat();
  useAi.setState({ messages: [], totals: { costKnown: true, requests: 0 } });
}

export async function sendChat(text: string, opts: { attach?: Partial<Attach> } = {}): Promise<void> {
  const state = useAi.getState();
  const provider = activeProvider();
  if (state.streaming || !text.trim()) return;
  if (!provider || !providerReady(provider)) {
    useUi.getState().open('settings', 'ai');
    useUi.getState().toast(t('ai.setupFirst'), 'info');
    return;
  }
  const attach = { ...state.attach, ...(opts.attach ?? {}) };
  const { parts, labels } = gatherContext(attach);
  const decision = await consent(provider, labels);
  if (decision === 'cancel') return;
  const context = decision === 'send' ? buildContext(parts) : '';

  const userMsg: UiMessage = { id: newId(), role: 'user', text: text.trim(), status: 'done', context: context || undefined, attached: decision === 'send' ? labels : undefined };
  const reply: UiMessage = { id: newId(), role: 'assistant', text: '', status: 'streaming', nativeFor: provider.kind, model: provider.model };
  useAi.setState((s) => ({ messages: [...s.messages, userMsg, reply], streaming: true }));
  await runTurn(provider, reply.id);
}

/** One request to the provider, streamed into the given assistant message. */
async function runTurn(provider: ProviderConfig, replyId: string): Promise<void> {
  const reply = { id: replyId };
  // A text tab in front is what the conversation is about; otherwise the project file.
  const doc = activeDoc();
  const file = doc ? undefined : activeFile();
  const lang = (doc ? runnableLanguage(doc.language) : file?.language) ?? 'python';
  const useTools = provider.capabilities.tools && useSettings.getState().ai.preferTools;
  const blocksEditable = !!file && file.mode === 'blocks';
  // Terminal requests need native tool calls, so each one can be answered with its result.
  const terminal = useTools && terminalAllowed();
  const system = systemPrompt({ lang, useTools, blocksEditable, filesEditable: !!file, terminal });
  const tools = useTools ? [...(blocksEditable ? [TOOL_BLOCK_EDITS] : []), ...(file ? [TOOL_FILE_EDITS] : []), ...(terminal ? [TOOL_RUN_COMMAND, TOOL_READ_TERMINAL] : [])] : undefined;
  controller = new AbortController();
  const signal = controller.signal;
  let buffer = '';
  let thinking = '';
  const calls: ToolCall[] = [];
  let frame = 0;
  const flush = () => {
    frame = 0;
    patchMessage(reply.id, { text: buffer, thinking: thinking || undefined });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(flush);
  };
  try {
    const adapter = await loadAdapter(provider.kind);
    const messages = history(useAi.getState().messages.filter((m) => m.id !== reply.id));
    for await (const ev of adapter.chat(provider, { system, messages, tools: tools?.length ? tools : undefined, signal }, transport)) {
      switch (ev.type) {
        case 'text':
          buffer += ev.text;
          schedule();
          break;
        case 'thinking':
          thinking += ev.text;
          schedule();
          break;
        case 'tool_call':
          calls.push(ev.call);
          break;
        case 'retry':
          patchMessage(reply.id, { notice: t(ev.reason === 'rate_limit' ? 'ai.retryRate' : 'ai.retry', { attempt: ev.attempt, seconds: Math.ceil(ev.delayMs / 1000) }) });
          break;
        case 'usage': {
          const model = provider.model;
          const cost = estimateCost(ev.usage, pricingFor(provider, model));
          useAi.setState((s) => ({ totals: { usage: addUsage(s.totals.usage, ev.usage), cost: cost === undefined ? s.totals.cost : (s.totals.cost ?? 0) + cost, costKnown: s.totals.costKnown && cost !== undefined, requests: s.totals.requests + 1 } }));
          patchMessage(reply.id, { usage: ev.usage });
          break;
        }
        case 'done': {
          cancelAnimationFrame(frame);
          const refusal = ev.stopReason === 'refusal';
          const truncated = ev.stopReason === 'max_tokens' || ev.stopReason === 'length';
          const base: Partial<UiMessage> = { text: buffer, thinking: thinking || undefined, status: refusal ? 'error' : 'done', toolCalls: calls.length ? calls : undefined, native: ev.native, model: ev.model ?? provider.model, notice: refusal ? undefined : truncated ? t('ai.truncated') : ev.note, error: refusal ? t('ai.refused', { detail: ev.note ?? '' }).trim() : undefined };
          patchMessage(reply.id, (m) => ({ ...base, ...(refusal ? {} : evaluateProposals(m, buffer, calls)) }));
          break;
        }
      }
    }
  } catch (err) {
    cancelAnimationFrame(frame);
    const e = err instanceof AiError ? err : new AiError(String((err as Error)?.message ?? err), 'network');
    if (e.kind === 'aborted' || signal.aborted) patchMessage(reply.id, { text: buffer, thinking: thinking || undefined, status: 'cancelled' });
    else {
      const key = `ai.err.${e.kind}`;
      // Error text may echo request details, so anything key-like is removed before display.
      patchMessage(reply.id, { text: buffer, status: 'error', error: `${t(key)} ${redactSecrets(e.message)}`.trim() });
    }
  } finally {
    controller = undefined;
    useAi.setState({ streaming: false });
  }
  if (!signal.aborted) await autoRun(reply.id);
}

/** Display text of an assistant message without the machine-readable proposal payload. */
export function displayText(m: UiMessage): string {
  return m.role === 'assistant' ? stripProposalFences(m.text) : m.text;
}

function waitForIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (useRun.getState().status === 'idle') return resolve();
    const un = useRun.subscribe((s) => {
      if (s.status === 'idle') {
        un();
        resolve();
      }
    });
  });
}

/** Regenerate, and optionally run, to report what really happened after an edit. */
async function verify(fileId: string, runIt: boolean): Promise<Verification> {
  const result = await useProject.getState().regenerate(fileId);
  const file = useProject.getState().project?.files.find((f) => f.id === fileId);
  const diags = (file?.mode === 'blocks' ? (result ?? useProject.getState().results[fileId])?.diagnostics : []) ?? [];
  const errors = diags.filter((d) => d.severity === 'error');
  if (errors.length) return { ok: false, text: t('ai.verifyErrors', { count: errors.length, first: diagText(errors[0]) }) };
  if (!runIt) return { ok: true, text: t('ai.verifyGenerated') };
  await runActive('run');
  await waitForIdle();
  const exit = useRun.getState().lastExit;
  if (!exit) return { ok: true, text: t('ai.verifyGenerated') };
  if (exit.ok) return { ok: true, text: t('ai.verifyRunOk') };
  const first = useRun.getState().diagnostics[0];
  return { ok: false, text: t('ai.verifyRunFailed', { detail: first ? `${first.line ? `${first.line}: ` : ''}${first.message}` : (exit.note ?? '') }) };
}

export async function applyBlockProposal(messageId: string): Promise<void> {
  const m = useAi.getState().messages.find((x) => x.id === messageId);
  const p = m?.blocks;
  if (!p || p.status !== 'pending' || !p.preview) return;
  const settings = useSettings.getState().ai;
  if (p.destructive && settings.confirmDestructive) {
    const ok = await confirmDialog({ title: t('ai.confirmDestructiveTitle'), message: t('ai.confirmDestructiveBlocks', { count: p.removed.length }), danger: true, confirmLabel: t('ai.apply') });
    if (!ok) return;
  }
  const store = useProject.getState();
  const file = store.project?.files.find((f) => f.id === p.fileId);
  if (!file) return;
  // The proposal was computed against an earlier state; refuse if the blocks moved on.
  const current = blockEditors.get(p.fileId)?.getState() ?? file.blocks;
  if (JSON.stringify(current) !== JSON.stringify(p.before)) {
    patchMessage(messageId, { blocks: { ...p, status: 'invalid', issues: [{ path: '', message: t('ai.stale') }] } });
    return;
  }
  const checkpoint = store.checkpoint(t('ai.checkpointBlocks'));
  const editor = blockEditors.get(p.fileId);
  if (editor) editor.applyState(p.preview);
  else store.replaceBlocks(p.fileId, p.preview);
  patchMessage(messageId, { blocks: { ...p, status: 'applied', checkpoint } });
  const result = await verify(p.fileId, false);
  patchMessage(messageId, (x) => ({ blocks: x.blocks ? { ...x.blocks, verify: result } : undefined }));
}

export function rejectProposal(messageId: string, kind: 'blocks' | 'files'): void {
  patchMessage(messageId, (m) => (kind === 'blocks' ? { blocks: m.blocks ? { ...m.blocks, status: 'rejected' } : undefined } : { files: m.files ? { ...m.files, status: 'rejected' } : undefined }));
}

export function undoProposal(messageId: string, kind: 'blocks' | 'files'): void {
  const m = useAi.getState().messages.find((x) => x.id === messageId);
  const p = kind === 'blocks' ? m?.blocks : m?.files;
  if (!p || p.status !== 'applied' || p.checkpoint === undefined) return;
  useProject.getState().restore(p.checkpoint);
  patchMessage(messageId, kind === 'blocks' ? { blocks: { ...(p as BlockProposal), status: 'pending', verify: undefined } } : { files: { ...(p as FileProposal), status: 'pending', verify: undefined } });
  useUi.getState().toast(t('ai.undone'), 'ok');
}

export async function applyFileProposal(messageId: string): Promise<void> {
  const m = useAi.getState().messages.find((x) => x.id === messageId);
  const p = m?.files;
  const store = useProject.getState();
  const project = store.project;
  if (!p || p.status !== 'pending' || !project) return;
  const detaches = p.changes.filter((c) => c.kind === 'modify' && project.files.find((f) => f.name === c.path)?.mode === 'blocks');
  if ((p.destructive && useSettings.getState().ai.confirmDestructive) || detaches.length) {
    const ok = await confirmDialog({ title: t('ai.confirmDestructiveTitle'), message: detaches.length ? t('ai.confirmDetach', { names: detaches.map((d) => d.path).join(', ') }) : t('ai.confirmDestructiveFiles'), detail: p.changes.map((c) => `${c.kind}: ${c.path}`).join('\n'), danger: true, confirmLabel: t('ai.apply') });
    if (!ok) return;
  }
  // Refuse when the files changed since the proposal was made.
  for (const c of p.changes) {
    const now = project.files.find((f) => f.name === c.path)?.code;
    if (now !== c.before) {
      patchMessage(messageId, { files: { ...p, status: 'invalid', issues: [{ path: c.path, message: t('ai.stale') }] } });
      return;
    }
  }
  const checkpoint = store.checkpoint(t('ai.checkpointFiles'));
  for (const c of p.changes) {
    const existing = useProject.getState().project!.files.find((f) => f.name === c.path);
    if (c.kind === 'create') {
      const lang = languageByExtension(c.path.split('.').pop() ?? '') ?? project.files[0].language;
      store.addFile(lang, c.path, undefined, c.after ?? '');
    } else if (c.kind === 'modify' && existing) {
      if (existing.mode === 'blocks') store.setMode(existing.id, 'code');
      store.updateCode(existing.id, c.after ?? '');
    } else if (c.kind === 'delete' && existing) store.deleteFile(existing.id);
  }
  patchMessage(messageId, { files: { ...p, status: 'applied', checkpoint } });
  const file = activeFile();
  if (file && useSettings.getState().ai.verifyAfterApply) {
    const result = await verify(file.id, true);
    patchMessage(messageId, (x) => ({ files: x.files ? { ...x.files, verify: result } : undefined }));
  }
}

/** Run the program again after an applied block edit and record the real outcome. */
export async function verifyByRunning(messageId: string): Promise<void> {
  const m = useAi.getState().messages.find((x) => x.id === messageId);
  if (!m?.blocks || m.blocks.status !== 'applied') return;
  const result = await verify(m.blocks.fileId, true);
  patchMessage(messageId, (x) => ({ blocks: x.blocks ? { ...x.blocks, verify: result } : undefined }));
}

/** Ask the assistant to fix the current problems, sending only what is relevant. */
export async function fixWithAi(): Promise<void> {
  const file = activeFile();
  if (!file) return;
  useSettings.getState().update({ layout: { rightOpen: true, rightTab: 'assistant' } });
  const result = useProject.getState().results[file.id];
  const errors = [...(file.mode === 'blocks' ? (result?.diagnostics ?? []) : []), ...useRun.getState().diagnostics].filter((d) => d.severity === 'error');
  const hasOutputError = useRun.getState().lastExit && !useRun.getState().lastExit!.ok;
  const prompt = errors.length || hasOutputError ? t(file.mode === 'blocks' ? 'ai.fixPromptBlocks' : 'ai.fixPromptCode') : t('ai.reviewPrompt');
  await sendChat(prompt, { attach: { problems: true, output: !!hasOutputError, blocks: file.mode === 'blocks', file: true } });
}

export function hasGenerationErrors(fileId: string): boolean {
  return hasErrors(useProject.getState().results[fileId]?.diagnostics ?? []);
}
