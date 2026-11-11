import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { getPlatform } from '../platform';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';

function normalise(input: string): string | undefined {
  const text = input.trim();
  if (!text) return undefined;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return undefined; // file:, javascript:, data: and friends are refused
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(text)) return `http://${text}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

/**
 * Embedded browser. On desktop it is a separate native web view placed over
 * this panel, with no access to the IDE or its backend. In a browser it falls
 * back to a sandboxed frame, which many sites refuse to load into.
 */
export function BrowserPane({ visible }: { visible: boolean }) {
  const home = useSettings((s) => s.browserHome);
  const overlay = useUi((s) => !!s.dialog || !!s.confirm);
  const [url, setUrl] = useState(home);
  const [address, setAddress] = useState(home);
  const [started, setStarted] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const native = getPlatform().browser.native;

  const go = (input: string) => {
    const next = normalise(input);
    if (!next) {
      useUi.getState().toast(t('browser.badAddress'), 'err');
      return;
    }
    setUrl(next);
    setAddress(next);
    setStarted(true);
    if (native && started) void getPlatform().browser.navigate(next).catch((e) => useUi.getState().toast(String(e), 'err'));
  };

  // The native web view floats above the page, so it follows the panel's rectangle.
  useEffect(() => {
    if (!native || !started || !host.current) return;
    const el = host.current;
    const b = getPlatform().browser;
    const rect = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: Math.max(1, r.width), height: Math.max(1, r.height) };
    };
    let opened = false;
    void b
      .open(url, rect())
      .then(() => (opened = true))
      .catch((e) => useUi.getState().toast(String(e), 'err'));
    const sync = () => opened && void b.setBounds(rect());
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    observer.observe(document.body);
    window.addEventListener('resize', sync);
    const timer = setInterval(sync, 400);
    const off = b.onNavigate((u) => setAddress(u));
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
      clearInterval(timer);
      off();
      void b.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, started]);

  // Dialogs and other tabs must not be covered by the native view.
  useEffect(() => {
    if (native && started) void getPlatform().browser.setVisible(visible && !overlay);
  }, [native, started, visible, overlay]);

  return (
    <div className="col grow" data-testid="browser-pane">
      <form
        className="row pad-8 gap-4"
        style={{ borderBottom: 'var(--hairline) solid var(--border-2)', flex: 'none' }}
        onSubmit={(e) => {
          e.preventDefault();
          go(address);
        }}
      >
        <button type="button" className="btn sm icon" title={t('browser.back')} disabled={!native || !started} onClick={() => void getPlatform().browser.back()}>
          <Icon name="arrowLeft" />
        </button>
        <button type="button" className="btn sm icon" title={t('browser.forward')} disabled={!native || !started} onClick={() => void getPlatform().browser.forward()}>
          <Icon name="arrowRight" />
        </button>
        <button type="button" className="btn sm icon" title={t('browser.reload')} disabled={!started} onClick={() => (native ? void getPlatform().browser.reload() : setFrameKey((k) => k + 1))}>
          <Icon name="refresh" />
        </button>
        <input className="input sm grow" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('browser.address')} aria-label={t('browser.address')} spellCheck={false} data-testid="browser-address" />
        <button type="button" className="btn sm icon" title={t('browser.home')} onClick={() => go(home)}>
          <Icon name="home" />
        </button>
        <button type="button" className="btn sm icon" title={t('browser.external')} onClick={() => void getPlatform().openExternal(url)}>
          <Icon name="external" />
        </button>
      </form>
      <div ref={host} className="grow" style={{ position: 'relative', background: 'var(--bg-sidebar)' }}>
        {!started ? (
          <div className="empty secondary">
            <Icon name="globe" size={22} />
            <div style={{ maxWidth: 300 }}>{native ? t('browser.introDesktop') : t('browser.introWeb')}</div>
            <button className="btn sm primary" onClick={() => go(address)} data-testid="browser-open">
              {t('browser.open')}
            </button>
            <div className="row gap-4 wrap" style={{ justifyContent: 'center', maxWidth: 340 }}>
              {['https://developer.mozilla.org/', 'https://docs.python.org/3/', 'https://doc.rust-lang.org/book/', 'https://go.dev/doc/', 'https://www.sqlite.org/lang.html'].map((u) => (
                <button key={u} className="chip" onClick={() => go(u)}>
                  {new URL(u).hostname.replace(/^www\./, '')}
                </button>
              ))}
            </div>
          </div>
        ) : native ? null : (
          <iframe key={frameKey} title={t('browser.title')} src={url} sandbox="allow-scripts allow-forms allow-same-origin allow-popups" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} data-testid="browser-frame" />
        )}
      </div>
      {started && !native && <div className="hint-text" style={{ padding: '4px 10px 6px' }}>{t('browser.frameNote')}</div>}
    </div>
  );
}
