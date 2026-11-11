import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useUi } from '../state/ui';
import { Icon } from './Icon';

/** Drag handle between two panes. Reports pixel deltas while dragging. */
export function SplitHandle({ axis, onDrag, onEnd }: { axis: 'x' | 'y'; onDrag: (delta: number) => void; onEnd?: () => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`split-handle ${axis}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      onPointerDown={(e) => {
        e.preventDefault();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        setDragging(true);
        let last = axis === 'x' ? e.clientX : e.clientY;
        const move = (ev: PointerEvent) => {
          const now = axis === 'x' ? ev.clientX : ev.clientY;
          onDrag(now - last);
          last = now;
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          setDragging(false);
          onEnd?.();
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      }}
    />
  );
}

export function Dialog({ title, onClose, children, footer, wide, testId }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; testId?: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" data-testid={testId}>
        <div className="dialog-head">
          <span className="grow ellipsis">{title}</span>
          <button className="btn sm icon" onClick={onClose} title={t('common.close')} data-testid="dialog-close">
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-body scroll grow col">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const req = useUi((s) => s.confirm);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setValue(req?.input?.value ?? '');
    if (req?.input) setTimeout(() => input.current?.select(), 30);
  }, [req]);
  if (!req) return null;
  const done = (ok: boolean) => {
    useUi.setState({ confirm: undefined });
    req.resolve({ ok, value });
  };
  return (
    <div className="backdrop" style={{ zIndex: 320 }} onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div
        className="dialog"
        style={{ width: 'min(440px, 100%)' }}
        role="alertdialog"
        aria-modal="true"
        data-testid="confirm-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') done(false);
          if (e.key === 'Enter' && (req.input || !req.danger)) done(true);
        }}
      >
        <div className="dialog-head">{req.title}</div>
        <div className="dialog-body col gap-12">
          {req.message && <div className="muted">{req.message}</div>}
          {req.detail && (
            <pre className="mono selectable scroll" style={{ margin: 0, padding: 10, borderRadius: 12, background: 'var(--bg-hover)', maxHeight: 200, whiteSpace: 'pre-wrap' }}>
              {req.detail}
            </pre>
          )}
          {req.input && <input ref={input} className="input" value={value} placeholder={req.input.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus data-testid="confirm-input" />}
        </div>
        <div className="dialog-foot">
          <button className="btn sm outline" onClick={() => done(false)} data-testid="confirm-cancel">
            {t('common.cancel')}
          </button>
          <button className={`btn sm ${req.danger ? 'outline danger' : 'primary'}`} onClick={() => done(true)} autoFocus={!req.input} data-testid="confirm-ok">
            {req.confirmLabel ?? t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className="toast" data-testid="toast">
          {x.kind && <span className={`dot ${x.kind === 'err' ? 'err' : x.kind === 'ok' ? 'ok' : 'info'}`} />}
          <span>{x.text}</span>
        </div>
      ))}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
}

/** Popup menu anchored to a button. */
export function MenuButton({ items, children, className, title, testId }: { items: MenuItem[]; children: ReactNode; className?: string; title?: string; testId?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!pos || !menu.current) return;
    // Keep the menu on screen.
    const r = menu.current.getBoundingClientRect();
    const x = Math.min(pos.x, window.innerWidth - r.width - 8);
    const y = pos.y + r.height > window.innerHeight - 8 ? Math.max(8, pos.y - r.height - 36) : pos.y;
    menu.current.style.left = `${Math.max(8, x)}px`;
    menu.current.style.top = `${y}px`;
  }, [pos]);
  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && menu.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
    };
  }, [pos]);
  return (
    <>
      <button
        ref={btn}
        className={className ?? 'btn sm icon'}
        title={title}
        data-testid={testId}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setPos(pos ? null : { x: r.left, y: r.bottom + 4 });
        }}
      >
        {children}
      </button>
      {pos && (
        <div ref={menu} className="menu scroll" style={{ left: pos.x, top: pos.y }} role="menu">
          {items.map((it, i) =>
            it.separator ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                className={`menu-item${it.danger ? ' danger' : ''}`}
                style={it.danger ? { color: 'var(--error)' } : undefined}
                disabled={it.disabled}
                role="menuitem"
                onClick={() => {
                  setPos(null);
                  it.onSelect?.();
                }}
              >
                {it.icon && <Icon name={it.icon} />}
                <span>{it.label}</span>
                {it.hint && <span className="hint">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}

export function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label?: string; testId?: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} data-testid={testId} />;
}

export function Setting({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="text">
        <div>{title}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
