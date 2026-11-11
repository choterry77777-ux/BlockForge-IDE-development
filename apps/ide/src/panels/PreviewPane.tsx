import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { cssPreviewDocument, runActive } from '../runtime/runner';
import { activeFile, useProject } from '../state/project';
import { useRun } from '../state/run';

/**
 * Page preview. The document runs in a sandboxed frame without same-origin
 * access, so page scripts cannot reach the IDE, its storage or the desktop backend.
 */
export function PreviewPane() {
  const file = useProject((s) => activeFile(s));
  const preview = useRun((s) => s.preview);
  const [live, setLive] = useState(true);
  const [width, setWidth] = useState<'full' | '390' | '768'>('full');
  const isWeb = file?.language === 'html' || file?.language === 'css';
  const html = live && isWeb && file ? (file.language === 'html' ? file.code : cssPreviewDocument(file.code)) : preview?.html;
  const [shown, setShown] = useState(html);
  // Typing should not reload the frame on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setShown(html), 250);
    return () => clearTimeout(id);
  }, [html]);

  return (
    <div className="col grow" data-testid="preview-pane">
      <div className="row pad-8 gap-6" style={{ borderBottom: 'var(--hairline) solid var(--border-2)', flex: 'none' }}>
        <div className="segmented">
          {(['full', '768', '390'] as const).map((w) => (
            <button key={w} className={width === w ? 'active' : ''} onClick={() => setWidth(w)}>
              {w === 'full' ? t('preview.fit') : `${w}px`}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className={`btn sm ${live ? 'on' : ''}`} onClick={() => setLive(!live)} disabled={!isWeb} title={t('preview.liveHint')}>
          <span className={`dot ${live && isWeb ? 'ok' : ''}`} />
          {t('preview.live')}
        </button>
        <button className="btn sm icon" title={t('preview.reload')} onClick={() => void runActive('run')}>
          <Icon name="refresh" />
        </button>
      </div>
      {shown ? (
        <div className="grow scroll" style={{ background: 'var(--bg-sidebar)', display: 'flex', justifyContent: 'center' }}>
          <iframe key={preview?.n} title={t('preview.title')} sandbox="allow-scripts allow-forms allow-modals" srcDoc={shown} style={{ width: width === 'full' ? '100%' : Number(width), maxWidth: '100%', height: '100%', border: 0, background: '#fff' }} data-testid="preview-frame" />
        </div>
      ) : (
        <div className="empty secondary">{t('preview.empty')}</div>
      )}
    </div>
  );
}
