import { estimateCost, pricingFor } from '@blockforge/core';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { t, useLocale } from '../i18n';
import { getPlatform } from '../platform';
import { activeFile, useProject } from '../state/project';
import { activeProvider, useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { type Attach, clearChat, displayText, fixWithAi, providerReady, sendChat, stopChat, type UiMessage, useAi } from './engine';
import { Markdown } from './Markdown';
import { BlockProposalCard, CommandCardView, FileProposalCard } from './Proposals';

function Message({ m }: { m: UiMessage }) {
  const [showThinking, setShowThinking] = useState(false);
  const [showContext, setShowContext] = useState(false);
  if (m.role === 'user') {
    return (
      <div className="msg user" data-testid="chat-user">
        <div className="bubble selectable">{m.text}</div>
        {m.attached && m.attached.length > 0 && (
          <div className="row gap-4 wrap" style={{ justifyContent: 'flex-end' }}>
            <button className="chip" onClick={() => setShowContext(!showContext)} title={t('ai.showSent')}>
              <Icon name="paperclip" size={12} />
              {m.attached.join(' · ')}
            </button>
          </div>
        )}
        {showContext && m.context && (
          <pre className="mono selectable card flat" style={{ margin: 0, padding: 10, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', width: '100%', borderRadius: 12 }}>
            {m.context}
          </pre>
        )}
      </div>
    );
  }
  const text = displayText(m);
  return (
    <div className="msg" data-testid="chat-assistant">
      {m.thinking && (
        <>
          <button className="row gap-4 faint small" style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', width: 'fit-content' }} onClick={() => setShowThinking(!showThinking)}>
            <Icon name={showThinking ? 'chevronDown' : 'chevronRight'} size={12} />
            <span className={m.status === 'streaming' && !text ? 'shimmer' : ''}>{t('ai.reasoning')}</span>
          </button>
          {showThinking && <div className="thinking selectable">{m.thinking}</div>}
        </>
      )}
      {m.status === 'streaming' && !text && !m.thinking && (
        <div className="row gap-6 faint secondary">
          <span className="dot busy" />
          <span className="shimmer">{t('ai.thinking')}</span>
        </div>
      )}
      {text && <Markdown text={text} />}
      {m.notice && <div className="notice">{m.notice}</div>}
      {m.proposalIssues?.map((issue, i) => (
        <div key={i} className="notice warn selectable">
          {issue}
        </div>
      ))}
      {m.blocks && <BlockProposalCard messageId={m.id} p={m.blocks} />}
      {m.files && <FileProposalCard messageId={m.id} p={m.files} />}
      {m.commands?.map((c) => <CommandCardView key={c.callId} messageId={m.id} c={c} />)}
      {m.status === 'error' && <div className="notice err selectable">{m.error}</div>}
      {m.status === 'cancelled' && <div className="faint small">{t('ai.cancelled')}</div>}
      {m.status === 'done' && m.usage && (
        <div className="faint small">
          {m.model} · {t('ai.tokens', { input: m.usage.inputTokens, output: m.usage.outputTokens })}
        </div>
      )}
    </div>
  );
}

const ATTACH: { key: keyof Attach; icon: string }[] = [
  { key: 'blocks', icon: 'blocks' },
  { key: 'file', icon: 'file' },
  { key: 'selection', icon: 'edit' },
  { key: 'problems', icon: 'warning' },
  { key: 'output', icon: 'terminal' },
];

export function ChatPane() {
  useLocale();
  const { messages, streaming, attach, totals, keys } = useAi();
  const providers = useSettings((s) => s.ai.providers);
  const activeId = useSettings((s) => s.ai.activeProviderId);
  const contextMode = useSettings((s) => s.ai.context);
  const provider = activeProvider({ ...useSettings.getState(), ai: { ...useSettings.getState().ai, providers, activeProviderId: activeId } });
  const file = useProject((s) => activeFile(s));
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const ready = providerReady(provider);
  void keys;

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [draft]);

  const submit = () => {
    if (!draft.trim() || streaming) return;
    const text = draft;
    setDraft('');
    stick.current = true;
    void sendChat(text);
  };
  const pricing = provider ? pricingFor(provider, provider.model) : undefined;
  const cost = totals.usage && totals.costKnown ? (totals.cost ?? estimateCost(totals.usage, pricing)) : undefined;
  const suggestions = file ? [t('ai.suggest.explain'), t(file.mode === 'blocks' ? 'ai.suggest.blocks' : 'ai.suggest.code'), t('ai.suggest.tests')] : [];

  return (
    <div className="col grow" data-testid="chat-pane">
      <div className="row pad-8 gap-6" style={{ borderBottom: 'var(--hairline) solid var(--border-2)', flex: 'none' }}>
        <select className="select sm" style={{ maxWidth: 150 }} value={provider?.id ?? ''} onChange={(e) => useSettings.getState().update({ ai: { activeProviderId: e.target.value } })} aria-label={t('ai.provider')} data-testid="chat-provider">
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {provider && (
          <input
            className="input sm grow mono"
            list="bf-models"
            value={provider.model}
            placeholder={t('ai.model')}
            aria-label={t('ai.model')}
            onChange={(e) => useSettings.getState().update({ ai: { providers: providers.map((p) => (p.id === provider.id ? { ...p, model: e.target.value } : p)) } })}
          />
        )}
        <datalist id="bf-models">{provider?.models.map((m) => <option key={m} value={m} />)}</datalist>
        <button className="btn sm icon" title={t('ai.settings')} onClick={() => useUi.getState().open('settings', 'ai')}>
          <Icon name="settings" />
        </button>
        <button className="btn sm icon" title={t('ai.clear')} disabled={!messages.length} onClick={clearChat} data-testid="chat-clear">
          <Icon name="trash" />
        </button>
      </div>

      <div
        ref={list}
        className="scroll grow col gap-16 pad-16"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {!messages.length && (
          <div className="empty" style={{ height: 'auto', margin: 'auto 0' }}>
            <Icon name="sparkle" size={22} />
            <div className="strong" style={{ color: 'var(--label-primary)' }}>
              {t('ai.emptyTitle')}
            </div>
            <div className="secondary" style={{ maxWidth: 300 }}>
              {ready ? t('ai.emptyReady') : t('ai.emptySetup')}
            </div>
            {!ready && (
              <button className="btn sm primary" onClick={() => useUi.getState().open('settings', 'ai')} data-testid="chat-setup">
                {t('ai.setup')}
              </button>
            )}
            {ready && (
              <div className="col gap-6" style={{ width: '100%', maxWidth: 320, marginTop: 8 }}>
                {suggestions.map((s) => (
                  <button key={s} className="btn sm outline" style={{ justifyContent: 'flex-start', height: 'auto', padding: '7px 12px', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => void sendChat(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {getPlatform().kind === 'web' && !ready && <div className="small" style={{ maxWidth: 300 }}>{t('ai.browserNote')}</div>}
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
      </div>

      <div className="col gap-6" style={{ padding: '4px 12px 10px', flex: 'none' }}>
        <div className="row gap-4 wrap">
          {ATTACH.map((a) => (
            <button
              key={a.key}
              className={`chip ${attach[a.key] && contextMode !== 'never' ? 'info' : ''}`}
              disabled={contextMode === 'never' || (a.key === 'blocks' && file?.mode !== 'blocks')}
              style={{ opacity: contextMode === 'never' || (a.key === 'blocks' && file?.mode !== 'blocks') ? 0.45 : 1 }}
              onClick={() => useAi.setState({ attach: { ...attach, [a.key]: !attach[a.key] } })}
              title={t('ai.attachHint')}
              data-testid={`attach-${a.key}`}
            >
              <Icon name={a.icon} size={12} />
              {t(`ai.attach.${a.key}`)}
            </button>
          ))}
          <button className="chip" style={{ marginLeft: 'auto' }} onClick={() => void fixWithAi()} disabled={streaming || !ready}>
            <Icon name="wand" size={12} />
            {t('ai.fix')}
          </button>
        </div>
        <div className="composer">
          <textarea
            ref={input}
            rows={1}
            value={draft}
            placeholder={ready ? t('ai.placeholder') : t('ai.placeholderSetup')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            data-testid="chat-input"
          />
          <div className="row">
            <span className="faint small ellipsis grow">
              {totals.usage ? t('ai.sessionUsage', { input: totals.usage.inputTokens, output: totals.usage.outputTokens, requests: totals.requests }) : contextMode === 'never' ? t('ai.contextNever') : t('ai.contextHint')}
              {cost !== undefined && totals.usage ? ` · ${t('ai.cost', { cost: cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2) })}` : ''}
            </span>
            {streaming ? (
              <button className="send" onClick={stopChat} title={t('ai.stop')} data-testid="chat-stop">
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button className="send" onClick={submit} disabled={!draft.trim()} title={t('ai.send')} data-testid="chat-send">
                <Icon name="send" size={15} weight={1.6} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
