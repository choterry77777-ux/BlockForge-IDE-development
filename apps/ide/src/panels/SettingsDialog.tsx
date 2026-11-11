import { anthropicModel, CAPABILITY_PRESETS, createProviderConfig, type Effort, loadAdapter, pricingFor, PROVIDER_PRESETS, type ProviderCapabilities, type ProviderConfig, type ProviderKind, redactSecrets } from '@blockforge/core';
import { useEffect, useState } from 'react';
import { clearCompletionCache } from '../ai/complete';
import { refreshKeys, transport, useAi } from '../ai/engine';
import { Icon } from '../components/Icon';
import { Dialog, Setting, Switch } from '../components/ui';
import { type LocaleId, LOCALES, t } from '../i18n';
import { getPlatform } from '../platform';
import { setWebKeyStorage, webKeyStorage } from '../platform/web';
import { useProject } from '../state/project';
import { type ThemeMode, useSettings } from '../state/settings';
import { confirmDialog, useUi } from '../state/ui';

const TABS = ['general', 'editor', 'blocks', 'run', 'ai', 'privacy', 'about'] as const;
const ICONS: Record<(typeof TABS)[number], string> = { general: 'settings', editor: 'code', blocks: 'blocks', run: 'play', ai: 'sparkle', privacy: 'lock', about: 'info' };

function Num({ value, min, max, step = 1, onChange, width = 90 }: { value: number; min: number; max: number; step?: number; onChange: (n: number) => void; width?: number }) {
  return <input className="input sm" type="number" style={{ width }} value={value} min={min} max={max} step={step} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(Math.min(max, Math.max(min, e.target.valueAsNumber)))} />;
}

function General() {
  const s = useSettings();
  return (
    <>
      <Setting title={t('settings.language')} hint={t('settings.languageHint')}>
        <select className="select sm" value={s.locale} onChange={(e) => s.update({ locale: e.target.value as LocaleId | 'auto' })} data-testid="locale-select">
          <option value="auto">{t('settings.system')}</option>
          {LOCALES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Setting>
      <Setting title={t('settings.theme')}>
        <div className="segmented" data-testid="theme-select">
          {(['system', 'light', 'dark'] as ThemeMode[]).map((m) => (
            <button key={m} className={s.theme === m ? 'active' : ''} onClick={() => s.update({ theme: m })} data-testid={`theme-${m}`}>
              {t(`settings.theme.${m}`)}
            </button>
          ))}
        </div>
      </Setting>
      <Setting title={t('settings.autosave')} hint={t('settings.autosaveHint')}>
        <Switch checked={s.autosave.enabled} onChange={(enabled) => s.update({ autosave: { enabled } })} label={t('settings.autosave')} />
      </Setting>
      <Setting title={t('settings.autosaveDelay')}>
        <Num value={s.autosave.delayMs} min={500} max={30000} step={500} onChange={(delayMs) => s.update({ autosave: { delayMs } })} />
      </Setting>
      <Setting title={t('settings.browserHome')}>
        <input className="input sm" style={{ width: 260 }} value={s.browserHome} onChange={(e) => s.update({ browserHome: e.target.value })} spellCheck={false} />
      </Setting>
      <Setting title={t('settings.reset')} hint={t('settings.resetHint')}>
        <button
          className="btn sm outline danger"
          onClick={async () => {
            if (await confirmDialog({ title: t('settings.reset'), message: t('settings.resetConfirm'), danger: true, confirmLabel: t('settings.reset') })) s.reset();
          }}
        >
          {t('settings.reset')}
        </button>
      </Setting>
    </>
  );
}

function Editor() {
  const s = useSettings();
  return (
    <>
      <Setting title={t('settings.fontSize')}>
        <Num value={s.editor.fontSize} min={10} max={24} onChange={(fontSize) => s.update({ editor: { fontSize } })} />
      </Setting>
      <Setting title={t('settings.wordWrap')}>
        <Switch checked={s.editor.wordWrap} onChange={(wordWrap) => s.update({ editor: { wordWrap } })} label={t('settings.wordWrap')} />
      </Setting>
      <Setting title={t('settings.lineNumbers')}>
        <Switch checked={s.editor.lineNumbers} onChange={(lineNumbers) => s.update({ editor: { lineNumbers } })} label={t('settings.lineNumbers')} />
      </Setting>
      <Setting title={t('settings.codeMinimap')}>
        <Switch checked={s.editor.minimap} onChange={(minimap) => s.update({ editor: { minimap } })} label={t('settings.codeMinimap')} />
      </Setting>
    </>
  );
}

function Blocks() {
  const s = useSettings();
  return (
    <>
      <Setting title={t('settings.grid')}>
        <Switch checked={s.blocks.grid} onChange={(grid) => s.update({ blocks: { grid } })} label={t('settings.grid')} />
      </Setting>
      <Setting title={t('settings.snap')}>
        <Switch checked={s.blocks.snap} onChange={(snap) => s.update({ blocks: { snap } })} label={t('settings.snap')} />
      </Setting>
      <Setting title={t('settings.blockMinimap')} hint={t('settings.blockMinimapHint')}>
        <Switch checked={s.blocks.minimap} onChange={(minimap) => s.update({ blocks: { minimap } })} label={t('settings.blockMinimap')} />
      </Setting>
      <Setting title={t('settings.sounds')}>
        <Switch checked={s.blocks.sounds} onChange={(sounds) => s.update({ blocks: { sounds } })} label={t('settings.sounds')} />
      </Setting>
      <Setting title={t('settings.blockScale')}>
        <Num value={s.blocks.scale} min={0.4} max={1.6} step={0.05} onChange={(scale) => s.update({ blocks: { scale } })} />
      </Setting>
      <Setting title={t('settings.favorites')} hint={t('settings.favoritesHint', { count: s.favorites.length })}>
        <button className="btn sm outline" disabled={!s.favorites.length} onClick={() => s.update({ favorites: [] })}>
          {t('common.clear')}
        </button>
      </Setting>
      <Setting title={t('settings.customBlocks')} hint={t('settings.customBlocksHint', { count: s.customBlocks.length })}>
        <button className="btn sm outline" disabled={!s.customBlocks.length} onClick={() => s.update({ customBlocks: [] })}>
          {t('common.clear')}
        </button>
      </Setting>
    </>
  );
}

function Run() {
  const s = useSettings();
  const project = useProject((x) => x.project);
  const patch = useProject((x) => x.patch);
  return (
    <>
      <Setting title={t('settings.timeout')} hint={t('settings.timeoutHint')}>
        <Num value={s.run.timeoutSec} min={1} max={3600} onChange={(timeoutSec) => s.update({ run: { timeoutSec } })} />
      </Setting>
      <Setting title={t('settings.outputLimit')} hint={t('settings.outputLimitHint')}>
        <Num value={s.run.maxOutputKb} min={16} max={16384} step={16} onChange={(maxOutputKb) => s.update({ run: { maxOutputKb } })} />
      </Setting>
      {!project && <div className="notice">{t('settings.buildNeedsProject')}</div>}
      {project && (
        <>
          <div className="bf-sidebar-label" style={{ padding: '14px 0 2px' }}>
            {t('settings.buildFor', { name: project.name })}
          </div>
          <Setting title={t('settings.profile')} hint={t('settings.profileHint')}>
            <div className="segmented">
              {(['debug', 'release'] as const).map((p) => (
                <button key={p} className={project.build.profile === p ? 'active' : ''} onClick={() => patch((x) => (x.build.profile = p))}>
                  {t(`settings.profile.${p}`)}
                </button>
              ))}
            </div>
          </Setting>
          <Setting title={t('settings.optimization')}>
            <select className="select sm" value={project.build.optimization ?? '0'} onChange={(e) => patch((x) => (x.build.optimization = e.target.value as '0'))}>
              {['0', '1', '2', '3', 's'].map((o) => (
                <option key={o} value={o}>
                  -O{o}
                </option>
              ))}
            </select>
          </Setting>
          <Setting title={t('settings.arch')} hint={t('settings.archHint')}>
            <select className="select sm" value={project.build.arch ?? 'native'} onChange={(e) => patch((x) => (x.build.arch = e.target.value as 'native'))}>
              <option value="native">{t('settings.archNative')}</option>
              <option value="arm64">arm64</option>
              <option value="x86_64">x86_64</option>
            </select>
          </Setting>
          <Setting title={t('settings.standard')} hint={t('settings.standardHint')}>
            <input className="input sm" style={{ width: 120 }} value={project.build.standard ?? ''} placeholder="c11 / c++17" onChange={(e) => patch((x) => (x.build.standard = e.target.value.trim() || undefined))} spellCheck={false} />
          </Setting>
          <Setting title={t('settings.extraArgs')} hint={t('settings.extraArgsHint')}>
            <input className="input sm" style={{ width: 220 }} value={(project.build.extraArgs ?? []).join(' ')} onChange={(e) => patch((x) => (x.build.extraArgs = e.target.value.split(/\s+/).filter(Boolean)))} spellCheck={false} />
          </Setting>
          <Setting title={t('settings.sqlDialect')} hint={t('settings.sqlDialectHint')}>
            <select className="select sm" value={project.settings.sqlDialect} onChange={(e) => patch((x) => (x.settings.sqlDialect = e.target.value as 'sqlite'))}>
              <option value="sqlite">SQLite</option>
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
            </select>
          </Setting>
        </>
      )}
    </>
  );
}

function ProviderEditor({ p, onChange, onRemove }: { p: ProviderConfig; onChange: (next: ProviderConfig) => void; onRemove?: () => void }) {
  const hasKey = useAi((s) => !!s.keys[p.id]);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | 'busy' | undefined>();
  const [advanced, setAdvanced] = useState(false);
  const platform = getPlatform();
  const preset = PROVIDER_PRESETS[p.kind];
  // Notes and hints of the presets are shown in the language of the interface.
  const local = p.kind === 'openai-compatible' || p.kind === 'custom';
  const browserNote = t(p.kind === 'anthropic' ? 'ai.note.anthropic' : local ? 'ai.note.local' : 'ai.note.cors');
  const keyHint = p.kind === 'openai-compatible' ? t('ai.keyHint.local') : p.kind === 'custom' ? t('ai.keyHint.custom') : preset.keyHint;
  const caps = p.capabilities;
  const setCap = (patch: Partial<ProviderCapabilities>) => onChange({ ...p, capabilities: { ...caps, ...patch } });
  const origin = (() => {
    try {
      return new URL(p.baseUrl).origin;
    } catch {
      return '';
    }
  })();
  const price = pricingFor(p, p.model);

  const saveKey = async () => {
    if (!key.trim()) return;
    if (!origin) {
      setStatus({ ok: false, text: t('ai.badUrl') });
      return;
    }
    // The key is handed to the keychain (desktop) or kept in memory (browser) and never written to settings.
    await platform.setSecret(p.id, key.trim(), origin);
    setKey('');
    await refreshKeys();
    useUi.getState().toast(t('ai.keySaved'), 'ok');
  };
  const test = async () => {
    setStatus('busy');
    try {
      const adapter = await loadAdapter(p.kind);
      const r = await adapter.test(p, transport);
      setStatus({ ok: true, text: r.detail });
    } catch (err) {
      setStatus({ ok: false, text: redactSecrets(String((err as Error).message ?? err)) });
    }
  };
  const fetchModels = async () => {
    setStatus('busy');
    try {
      const adapter = await loadAdapter(p.kind);
      const models = await adapter.listModels(p, transport);
      onChange({ ...p, models, model: p.model || models[0] || '' });
      setStatus({ ok: true, text: t('ai.modelsFound', { count: models.length }) });
    } catch (err) {
      setStatus({ ok: false, text: redactSecrets(String((err as Error).message ?? err)) });
    }
  };

  return (
    <div className="col gap-12" data-testid={`provider-${p.id}`}>
      <div className="row gap-12" style={{ alignItems: 'flex-end' }}>
        <div className="field grow">
          <label>{t('ai.providerName')}</label>
          <input className="input sm" value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} />
        </div>
        <div className="field">
          <label>{t('ai.providerKind')}</label>
          <select className="select sm" value={p.kind} onChange={(e) => onChange({ ...createProviderConfig(e.target.value as ProviderKind, p.id), name: p.name })}>
            {(Object.keys(PROVIDER_PRESETS) as ProviderKind[]).map((k) => (
              <option key={k} value={k}>
                {k === 'openai-compatible' || k === 'custom' ? t(`ai.kind.${k}`) : PROVIDER_PRESETS[k].name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>{t('ai.baseUrl')}</label>
        <input className="input sm mono" value={p.baseUrl} placeholder={preset.baseUrl || 'https://example.com/v1'} onChange={(e) => onChange({ ...p, baseUrl: e.target.value.trim() })} spellCheck={false} data-testid="provider-url" />
      </div>
      <div className="row gap-12" style={{ alignItems: 'flex-end' }}>
        <div className="field grow">
          <label>{t('ai.model')}</label>
          <input className="input sm mono" list={`models-${p.id}`} value={p.model} placeholder={t('ai.modelPlaceholder')} onChange={(e) => onChange({ ...p, model: e.target.value.trim() })} spellCheck={false} data-testid="provider-model" />
          <datalist id={`models-${p.id}`}>
            {p.models.map((m) => (
              <option key={m} value={m}>
                {anthropicModel(m)?.label ?? m}
              </option>
            ))}
          </datalist>
        </div>
        <div className="field grow">
          <label>{t('ai.autocompleteModel')}</label>
          <input className="input sm mono" list={`models-${p.id}`} value={p.autocompleteModel ?? ''} placeholder={t('ai.sameAsChat')} onChange={(e) => onChange({ ...p, autocompleteModel: e.target.value.trim() || undefined })} spellCheck={false} />
        </div>
        <button className="btn sm outline" onClick={() => void fetchModels()} disabled={status === 'busy'} title={t('ai.fetchModelsHint')}>
          <Icon name="refresh" size={14} />
          {t('ai.fetchModels')}
        </button>
      </div>
      <div className="field">
        <label>{t('ai.apiKey')}</label>
        <div className="row gap-6">
          <input className="input sm grow mono" type="password" autoComplete="off" value={key} placeholder={hasKey ? t('ai.keyStored') : keyHint} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveKey()} data-testid="provider-key" />
          <button className="btn sm outline" onClick={() => void saveKey()} disabled={!key.trim()} data-testid="provider-key-save">
            {t('common.save')}
          </button>
          {hasKey && (
            <button
              className="btn sm outline danger"
              onClick={async () => {
                await platform.deleteSecret(p.id);
                await refreshKeys();
              }}
            >
              {t('ai.removeKey')}
            </button>
          )}
        </div>
        <div className="hint-text">
          <span className={`dot ${hasKey ? 'ok' : ''}`} style={{ display: 'inline-block', marginRight: 6 }} />
          {hasKey ? t('ai.keyPresent') : t('ai.keyAbsent')} {platform.kind === 'desktop' ? t('ai.keyDesktop') : t('ai.keyWeb')}
        </div>
        {platform.kind === 'web' && <div className="hint-text">{browserNote}</div>}
      </div>
      <div className="row gap-6">
        <button className="btn sm outline" onClick={() => void test()} disabled={status === 'busy'} data-testid="provider-test">
          {status === 'busy' ? <span className="dot busy" /> : <Icon name="check" size={14} />}
          {t('ai.test')}
        </button>
        <button className="btn sm" onClick={() => setAdvanced(!advanced)}>
          <Icon name={advanced ? 'chevronDown' : 'chevronRight'} size={13} />
          {t('ai.advanced')}
        </button>
        <span className="grow" />
        {onRemove && (
          <button className="btn sm danger" onClick={onRemove}>
            <Icon name="trash" size={14} />
            {t('ai.removeProvider')}
          </button>
        )}
      </div>
      {status && status !== 'busy' && (
        <div className={`notice ${status.ok ? 'info' : 'err'} selectable`} data-testid="provider-status">
          {status.text}
        </div>
      )}
      {advanced && (
        <div className="col">
          <Setting title={t('ai.maxTokens')} hint={t('ai.maxTokensHint')}>
            <Num value={p.maxTokens} min={256} max={128000} step={256} width={110} onChange={(maxTokens) => onChange({ ...p, maxTokens })} />
          </Setting>
          {caps.effort && (
            <Setting title={t('ai.effort')} hint={t('ai.effortHint')}>
              <select className="select sm" value={p.effort ?? ''} onChange={(e) => onChange({ ...p, effort: (e.target.value || undefined) as Effort | undefined })}>
                <option value="">{t('ai.effortDefault')}</option>
                {(['low', 'medium', 'high', 'xhigh', 'max'] as Effort[]).map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </Setting>
          )}
          {caps.sampling && (
            <Setting title={t('ai.temperature')} hint={t('ai.temperatureHint')}>
              <input className="input sm" type="number" style={{ width: 90 }} min={0} max={2} step={0.1} value={p.temperature ?? ''} placeholder="-" onChange={(e) => onChange({ ...p, temperature: e.target.value === '' ? undefined : Math.min(2, Math.max(0, e.target.valueAsNumber)) })} />
            </Setting>
          )}
          <Setting title={t('ai.retries')} hint={t('ai.retriesHint')}>
            <Num value={p.maxRetries} min={0} max={6} onChange={(maxRetries) => onChange({ ...p, maxRetries })} />
          </Setting>
          {p.kind === 'anthropic' && (
            <Setting title={t('ai.refusalFallback')} hint={t('ai.refusalFallbackHint')}>
              <Switch checked={p.refusalFallback !== false} onChange={(refusalFallback) => onChange({ ...p, refusalFallback })} label={t('ai.refusalFallback')} />
            </Setting>
          )}
          {p.kind !== 'anthropic' && (
            <>
              <Setting title={t('ai.apiStyle')} hint={t('ai.apiStyleHint')}>
                <select className="select sm" value={caps.apiStyle} onChange={(e) => setCap({ apiStyle: e.target.value as 'responses' })}>
                  <option value="chat-completions">chat/completions</option>
                  <option value="responses">responses</option>
                </select>
              </Setting>
              {(
                [
                  ['streaming', 'ai.capStreaming'],
                  ['tools', 'ai.capTools'],
                  ['usageInStream', 'ai.capUsage'],
                  ['sampling', 'ai.capSampling'],
                  ['effort', 'ai.capEffort'],
                  ['fim', 'ai.capFim'],
                  ['modelList', 'ai.capModelList'],
                ] as [keyof ProviderCapabilities, string][]
              ).map(([k, label]) => (
                <Setting key={k} title={t(label)} hint={t(`${label}Hint`)}>
                  <Switch checked={!!caps[k]} onChange={(v) => setCap({ [k]: v } as Partial<ProviderCapabilities>)} label={t(label)} />
                </Setting>
              ))}
              <Setting title={t('ai.maxTokensParam')}>
                <select className="select sm" value={caps.maxTokensParam} onChange={(e) => setCap({ maxTokensParam: e.target.value as 'max_tokens' })}>
                  <option value="max_tokens">max_tokens</option>
                  <option value="max_completion_tokens">max_completion_tokens</option>
                </select>
              </Setting>
              <Setting title={t('ai.systemRole')}>
                <select className="select sm" value={caps.systemRole} onChange={(e) => setCap({ systemRole: e.target.value as 'system' })}>
                  <option value="system">system</option>
                  <option value="developer">developer</option>
                </select>
              </Setting>
              <Setting title={t('ai.resetCaps')} hint={t('ai.resetCapsHint')}>
                <button className="btn sm outline" onClick={() => onChange({ ...p, capabilities: { ...CAPABILITY_PRESETS[p.kind] } })}>
                  {t('settings.reset')}
                </button>
              </Setting>
            </>
          )}
          <Setting title={t('ai.pricing')} hint={price ? t('ai.pricingKnown', { input: price.inputPerMTok, output: price.outputPerMTok, source: price.source }) : t('ai.pricingUnknown')}>
            <div className="row gap-4">
              <input className="input sm" type="number" style={{ width: 80 }} min={0} step={0.01} placeholder={t('ai.priceIn')} value={p.pricing?.[p.model]?.inputPerMTok ?? ''} onChange={(e) => onChange({ ...p, pricing: { ...p.pricing, [p.model]: { inputPerMTok: e.target.valueAsNumber || 0, outputPerMTok: p.pricing?.[p.model]?.outputPerMTok ?? 0, source: t('ai.priceUser') } } })} />
              <input className="input sm" type="number" style={{ width: 80 }} min={0} step={0.01} placeholder={t('ai.priceOut')} value={p.pricing?.[p.model]?.outputPerMTok ?? ''} onChange={(e) => onChange({ ...p, pricing: { ...p.pricing, [p.model]: { inputPerMTok: p.pricing?.[p.model]?.inputPerMTok ?? 0, outputPerMTok: e.target.valueAsNumber || 0, source: t('ai.priceUser') } } })} />
            </div>
          </Setting>
        </div>
      )}
    </div>
  );
}

function Ai() {
  const s = useSettings();
  const [open, setOpen] = useState<string | undefined>(s.ai.activeProviderId ?? s.ai.providers[0]?.id);
  const keys = useAi((x) => x.keys);
  const usage = useAi((x) => x.completion);
  useEffect(() => {
    void refreshKeys();
  }, []);
  const setProviders = (providers: ProviderConfig[]) => s.update({ ai: { providers } });
  const add = () => {
    const id = `custom-${Date.now().toString(36)}`;
    setProviders([...s.ai.providers, { ...createProviderConfig('openai-compatible', id), name: t('ai.newProvider') }]);
    setOpen(id);
  };
  return (
    <div className="col gap-12">
      <div className="notice">{t('ai.optionalNote')}</div>
      <div className="col gap-4">
        {s.ai.providers.map((p) => (
          <div key={p.id} className="card flat" style={{ borderRadius: 16, overflow: 'hidden' }}>
            <div className="list-row click" role="button" tabIndex={0} onClick={() => setOpen(open === p.id ? undefined : p.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(open === p.id ? undefined : p.id)} data-testid={`provider-row-${p.id}`}>
              <Icon name={open === p.id ? 'chevronDown' : 'chevronRight'} size={13} />
              <span className="strong">{p.name}</span>
              <span className="mono faint ellipsis grow">{p.model || t('ai.noModel')}</span>
              <span className={`dot ${keys[p.id] ? 'ok' : ''}`} title={keys[p.id] ? t('ai.keyPresent') : t('ai.keyAbsent')} />
              <button
                className={`chip ${s.ai.activeProviderId === p.id ? 'info' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  s.update({ ai: { activeProviderId: p.id } });
                }}
              >
                {s.ai.activeProviderId === p.id ? t('ai.active') : t('ai.use')}
              </button>
            </div>
            {open === p.id && (
              <div style={{ padding: '4px 14px 14px' }}>
                <ProviderEditor
                  p={p}
                  onChange={(next) => setProviders(s.ai.providers.map((x) => (x.id === p.id ? next : x)))}
                  onRemove={
                    s.ai.providers.length > 1
                      ? async () => {
                          await getPlatform().deleteSecret(p.id);
                          setProviders(s.ai.providers.filter((x) => x.id !== p.id));
                          if (s.ai.activeProviderId === p.id) s.update({ ai: { activeProviderId: s.ai.providers.find((x) => x.id !== p.id)?.id } });
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        ))}
        <button className="btn sm outline" style={{ alignSelf: 'flex-start' }} onClick={add} data-testid="provider-add">
          <Icon name="plus" size={14} />
          {t('ai.addProvider')}
        </button>
      </div>
      <div className="bf-sidebar-label" style={{ padding: '6px 0 0' }}>
        {t('ai.chatSection')}
      </div>
      <div className="col">
        <Setting title={t('ai.preferTools')} hint={t('ai.preferToolsHint')}>
          <Switch checked={s.ai.preferTools} onChange={(preferTools) => s.update({ ai: { preferTools } })} label={t('ai.preferTools')} />
        </Setting>
      </div>
      <div className="bf-sidebar-label" style={{ padding: '6px 0 0' }}>
        {t('ai.completionSection')}
      </div>
      <div className="col">
        <Setting title={t('ai.completionEnabled')} hint={t('ai.completionEnabledHint')}>
          <Switch checked={s.ai.autocomplete.enabled} onChange={(enabled) => s.update({ ai: { autocomplete: { enabled } } })} label={t('ai.completionEnabled')} testId="completion-enabled" />
        </Setting>
        <Setting title={t('ai.completionAuto')} hint={t('ai.completionAutoHint')}>
          <Switch checked={s.ai.autocomplete.automatic} onChange={(automatic) => s.update({ ai: { autocomplete: { automatic } } })} label={t('ai.completionAuto')} />
        </Setting>
        <Setting title={t('ai.completionDelay')} hint={t('ai.completionDelayHint')}>
          <Num value={s.ai.autocomplete.delayMs} min={200} max={5000} step={100} onChange={(delayMs) => s.update({ ai: { autocomplete: { delayMs } } })} />
        </Setting>
        <Setting title={t('ai.completionTokens')}>
          <Num value={s.ai.autocomplete.maxTokens} min={32} max={2048} step={32} onChange={(maxTokens) => s.update({ ai: { autocomplete: { maxTokens } } })} />
        </Setting>
        <Setting title={t('ai.completionUsage')} hint={t('ai.completionUsageValue', { requests: usage.requests, input: usage.usage?.inputTokens ?? 0, output: usage.usage?.outputTokens ?? 0 })}>
          <button
            className="btn sm outline"
            onClick={() => {
              clearCompletionCache();
              useAi.setState({ completion: { requests: 0, pausedUntil: 0 } });
            }}
          >
            {t('settings.reset')}
          </button>
        </Setting>
      </div>
    </div>
  );
}

function Privacy() {
  const s = useSettings();
  const project = useProject((x) => x.project);
  const patch = useProject((x) => x.patch);
  const [storage, setStorage] = useState(webKeyStorage());
  const platform = getPlatform();
  return (
    <div className="col">
      <div className="notice">{t('privacy.intro')}</div>
      <Setting title={t('privacy.context')} hint={t('privacy.contextHint')}>
        <select className="select sm" value={s.ai.context} onChange={(e) => s.update({ ai: { context: e.target.value as 'ask' } })} data-testid="privacy-context">
          <option value="ask">{t('privacy.context.ask')}</option>
          <option value="always">{t('privacy.context.always')}</option>
          <option value="never">{t('privacy.context.never')}</option>
        </select>
      </Setting>
      <Setting title={t('privacy.consents')} hint={t('privacy.consentsHint', { count: s.ai.consented.length })}>
        <button className="btn sm outline" disabled={!s.ai.consented.length} onClick={() => s.update({ ai: { consented: [] } })}>
          {t('privacy.forget')}
        </button>
      </Setting>
      <Setting title={t('privacy.confirmDestructive')} hint={t('privacy.confirmDestructiveHint')}>
        <Switch checked={s.ai.confirmDestructive} onChange={(confirmDestructive) => s.update({ ai: { confirmDestructive } })} label={t('privacy.confirmDestructive')} />
      </Setting>
      <Setting title={t('privacy.verify')} hint={t('privacy.verifyHint')}>
        <Switch checked={s.ai.verifyAfterApply} onChange={(verifyAfterApply) => s.update({ ai: { verifyAfterApply } })} label={t('privacy.verify')} />
      </Setting>
      <Setting title={t('settings.ai.commands')} hint={platform.terminal.available ? t('settings.ai.commandsHint') : t('term.desktopOnly')}>
        <select className="select sm" value={s.ai.commands} disabled={!platform.terminal.available} onChange={(e) => s.update({ ai: { commands: e.target.value as 'off' | 'ask' | 'auto' } })} aria-label={t('settings.ai.commands')} data-testid="ai-commands">
          <option value="off">{t('settings.ai.commands.off')}</option>
          <option value="ask">{t('settings.ai.commands.ask')}</option>
          <option value="auto">{t('settings.ai.commands.auto')}</option>
        </select>
      </Setting>
      {s.ai.commands === 'auto' && platform.terminal.available && (
        <div className="notice warn" data-testid="ai-commands-warning">
          <Icon name="warning" size={14} />
          <span>{t('settings.ai.commandsAutoWarning')}</span>
        </div>
      )}
      {project && (
        <Setting title={t('privacy.exclude')} hint={t('privacy.excludeHint')}>
          <input className="input sm mono" style={{ width: 260 }} value={project.settings.aiExclude.join(', ')} onChange={(e) => patch((x) => (x.settings.aiExclude = e.target.value.split(',').map((g) => g.trim()).filter(Boolean)))} spellCheck={false} />
        </Setting>
      )}
      {platform.kind === 'web' ? (
        <Setting title={t('privacy.keyStorage')} hint={t('privacy.keyStorageHint')}>
          <select
            className="select sm"
            value={storage}
            onChange={(e) => {
              setWebKeyStorage(e.target.value as 'session');
              setStorage(e.target.value as 'session');
            }}
          >
            <option value="session">{t('privacy.keySession')}</option>
            <option value="device">{t('privacy.keyDevice')}</option>
          </select>
        </Setting>
      ) : (
        <div className="notice info">{t('privacy.keychain')}</div>
      )}
      <div className="notice">{t('privacy.guarantees')}</div>
    </div>
  );
}

function About() {
  const platform = getPlatform();
  return (
    <div className="col gap-12">
      <div className="row gap-12">
        <div className="col">
          <div className="strong" style={{ fontSize: 16 }}>
            BlockForge IDE
          </div>
          <div className="muted secondary">{t('about.version', { version: '0.1.0', edition: platform.kind === 'desktop' ? t('about.desktop') : t('about.browser'), os: platform.os, arch: platform.arch })}</div>
        </div>
      </div>
      <div className="notice">{t('about.body')}</div>
      <div className="notice">{t('about.design')}</div>
      <button className="btn sm outline" style={{ alignSelf: 'flex-start' }} onClick={() => useUi.getState().open('shortcuts')}>
        <Icon name="command" size={14} />
        {t('cmd.shortcuts')}
      </button>
    </div>
  );
}

export function SettingsDialog() {
  const tab = useUi((s) => s.settingsTab) as (typeof TABS)[number];
  const set = (settingsTab: string) => useUi.setState({ settingsTab });
  return (
    <Dialog title={t('cmd.settings')} onClose={() => useUi.getState().close()} wide testId="settings-dialog">
      <div className="settings-layout">
        <div className="settings-nav">
          {TABS.map((x) => (
            <button key={x} className={`nav-row ${tab === x ? 'active' : ''}`} onClick={() => set(x)} data-testid={`settings-${x}`}>
              <Icon name={ICONS[x]} />
              {t(`settings.tab.${x}`)}
            </button>
          ))}
        </div>
        <div className="settings-content scroll" data-testid="settings-content">
          {tab === 'general' && <General />}
          {tab === 'editor' && <Editor />}
          {tab === 'blocks' && <Blocks />}
          {tab === 'run' && <Run />}
          {tab === 'ai' && <Ai />}
          {tab === 'privacy' && <Privacy />}
          {tab === 'about' && <About />}
        </div>
      </div>
    </Dialog>
  );
}
