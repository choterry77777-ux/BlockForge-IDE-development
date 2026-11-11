import { LANGUAGES, TOOLCHAINS } from '@blockforge/core';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { getPlatform } from '../platform';
import { detectToolchains } from '../runtime/runner';
import { useRun } from '../state/run';
import { useUi } from '../state/ui';

export function ToolchainsPane() {
  const toolchains = useRun((s) => s.toolchains);
  const checked = useRun((s) => s.toolchainsChecked);
  const [busy, setBusy] = useState(false);
  const platform = getPlatform();
  useEffect(() => {
    void detectToolchains();
  }, []);
  const refresh = async () => {
    setBusy(true);
    await detectToolchains(true);
    setBusy(false);
  };
  const found = toolchains.filter((x) => x.found).length;
  return (
    <div className="col grow" data-testid="toolchains-pane">
      <div className="row pad-8 gap-6" style={{ borderBottom: 'var(--hairline) solid var(--border-2)', flex: 'none' }}>
        <span className="secondary muted grow">{platform.kind === 'desktop' ? t('toolchains.summary', { found, total: TOOLCHAINS.length }) : t('toolchains.webOnly')}</span>
        {platform.kind === 'desktop' && (
          <button className="btn sm outline" onClick={() => void refresh()} disabled={busy}>
            {busy ? <span className="dot busy" /> : <Icon name="refresh" size={14} />}
            {t('toolchains.rescan')}
          </button>
        )}
      </div>
      <div className="scroll grow pad-8 col gap-4">
        {platform.kind === 'web' && <div className="notice info">{t('toolchains.webNote')}</div>}
        <div className="notice">{t('toolchains.noInstall')}</div>
        {TOOLCHAINS.map((spec) => {
          const d = toolchains.find((x) => x.id === spec.id);
          const hint = spec.install[platform.os];
          return (
            <div key={spec.id} className="list-row" style={{ alignItems: 'flex-start' }} data-testid={`toolchain-${spec.id}`}>
              <span className={`dot ${!checked ? 'busy' : d?.found ? 'ok' : ''}`} style={{ marginTop: 7 }} />
              <div className="col grow gap-4">
                <div className="row">
                  <span className="strong">{spec.name}</span>
                  <span className="faint small ellipsis">{spec.languages.map((l) => LANGUAGES[l].name).join(', ')}</span>
                </div>
                {d?.found ? (
                  <div className="mono faint selectable" style={{ wordBreak: 'break-all' }}>
                    {d.version ?? ''}
                    {d.path ? ` · ${d.path}` : ''}
                  </div>
                ) : (
                  checked &&
                  platform.kind === 'desktop' && (
                    <div className="col gap-4">
                      <div className="small muted">{t('toolchains.missing')}</div>
                      <div className="row gap-4">
                        <code className="mono selectable grow ellipsis" style={{ background: 'var(--bg-hover)', padding: '3px 8px', borderRadius: 8 }}>
                          {hint}
                        </code>
                        <button
                          className="btn sm icon"
                          title={t('common.copy')}
                          onClick={() => {
                            void navigator.clipboard.writeText(hint);
                            useUi.getState().toast(t('common.copied'), 'ok');
                          }}
                        >
                          <Icon name="copy" size={14} />
                        </button>
                        <button className="btn sm icon" title={t('toolchains.website')} onClick={() => void platform.openExternal(spec.url)}>
                          <Icon name="external" size={14} />
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
