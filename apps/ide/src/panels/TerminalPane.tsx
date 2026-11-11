import { useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { getPlatform } from '../platform';
import { resolveTheme, useSettings } from '../state/settings';
import { attachSession, closeSession, fitSession, openShell, refreshTerminalTheme, useTerminals } from '../terminal/sessions';

/** Tabs of the terminal sessions, shown in the dock header. */
export function TerminalTabs() {
  const sessions = useTerminals((s) => s.sessions);
  const active = useTerminals((s) => s.active);
  if (!getPlatform().terminal.available) return null;
  return (
    <div className="row gap-4 scroll grow" style={{ overflowY: 'hidden', minWidth: 0 }} data-testid="terminal-tabs">
      {sessions.map((s) => (
        <button key={s.id} className={`tab sm ${s.id === active ? 'active' : ''}`} onClick={() => useTerminals.setState({ active: s.id })} title={s.title} data-testid="terminal-tab">
          <Icon name={s.kind === 'task' ? 'play' : 'terminal'} size={13} />
          <span className="ellipsis" style={{ maxWidth: 140 }}>
            {s.title}
          </span>
          {s.exited && <span className={`dot ${s.code === 0 ? 'ok' : 'err'}`} />}
          <span
            className="close"
            role="button"
            aria-label={t('common.close')}
            onClick={(e) => {
              e.stopPropagation();
              closeSession(s.id);
            }}
          >
            <Icon name="x" size={11} />
          </span>
        </button>
      ))}
      <button className="btn sm icon" title={t('term.new')} onClick={() => void openShell()} data-testid="terminal-new">
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

export function TerminalPane() {
  const host = useRef<HTMLDivElement>(null);
  const active = useTerminals((s) => s.active);
  const count = useTerminals((s) => s.sessions.length);
  const theme = useSettings((s) => s.theme);
  const available = getPlatform().terminal.available;

  // The first visit to the tab starts a shell.
  useEffect(() => {
    if (available && !useTerminals.getState().sessions.length) void openShell();
  }, [available]);

  useEffect(() => {
    if (!active || !host.current) return;
    attachSession(active, host.current);
    const el = host.current;
    const observer = new ResizeObserver(() => fitSession(active));
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    // Wait for the theme attribute to be applied before reading its colours.
    const id = requestAnimationFrame(refreshTerminalTheme);
    return () => cancelAnimationFrame(id);
  }, [theme, resolveTheme(theme)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!available) {
    return (
      <div className="empty grow" data-testid="terminal-unavailable">
        <Icon name="terminal" size={20} />
        <div>{t('term.desktopOnly')}</div>
      </div>
    );
  }
  return (
    <div className="col grow" style={{ minHeight: 0 }} data-testid="terminal-pane">
      {count === 0 && (
        <div className="empty grow">
          <button className="btn sm outline" onClick={() => void openShell()}>
            <Icon name="plus" size={14} />
            {t('term.new')}
          </button>
        </div>
      )}
      <div ref={host} className="terminal-view grow" style={{ display: count ? undefined : 'none' }} />
    </div>
  );
}
