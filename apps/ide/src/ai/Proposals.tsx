import { describeOps, type FileChange, generate, type LanguageId } from '@blockforge/core';
import { useEffect, useMemo, useState } from 'react';
import { BlocklyPane } from '../blockly/BlocklyPane';
import { Icon } from '../components/Icon';
import { t } from '../i18n';
import { useProject } from '../state/project';
import { diffLines, diffStats, foldDiff } from '../util/diff';
import { activeProvider } from '../state/settings';
import { useWorkspace } from '../state/workspace';
import { applyBlockProposal, applyFileProposal, approveCommand, type BlockProposal, type CommandCard, type FileProposal, rejectCommand, rejectProposal, undoProposal, useAi, verifyByRunning } from './engine';

export function DiffView({ before, after, max = 400 }: { before: string; after: string; max?: number }) {
  const lines = useMemo(() => foldDiff(diffLines(before, after)), [before, after]);
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, 9);
  return (
    <div className="diff selectable" style={{ maxHeight: max }}>
      {shown.map((l, i) =>
        l.kind === 'gap' ? (
          <div key={i} className="diff-line gap">
            <span className="mark">&#8943;</span>
            <span>{t('diff.unchanged', { count: l.text })}</span>
          </div>
        ) : (
          <div key={i} className={`diff-line ${l.kind === 'same' ? '' : l.kind}`}>
            <span className="mark">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}</span>
            <span>{l.text || ' '}</span>
          </div>
        ),
      )}
      {!all && lines.length > 9 && (
        <button className="btn sm" style={{ margin: 4 }} onClick={() => setAll(true)}>
          {t('diff.showAll', { count: lines.length - 9 })}
        </button>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: BlockProposal['status'] }) {
  const cls = status === 'applied' ? 'ok' : status === 'invalid' ? 'err' : status === 'rejected' ? '' : 'info';
  return <span className={`chip ${cls}`}>{t(`ai.status.${status}`)}</span>;
}

function Verify({ v }: { v?: { ok: boolean; text: string } }) {
  if (!v) return null;
  return (
    <div className="tool-row" style={{ height: 'auto', padding: '4px 12px 8px', alignItems: 'flex-start' }}>
      <span className={`dot ${v.ok ? 'ok' : 'err'}`} style={{ marginTop: 6 }} />
      <span className="selectable">{v.text}</span>
    </div>
  );
}

export function BlockProposalCard({ messageId, p }: { messageId: string; p: BlockProposal }) {
  const file = useProject((s) => s.project?.files.find((f) => f.id === p.fileId));
  const streaming = useAi((s) => s.streaming);
  const [view, setView] = useState<'blocks' | 'code'>('blocks');
  const [codes, setCodes] = useState<{ before: string; after: string }>();
  const language = (file?.language ?? 'python') as LanguageId;
  const ops = useMemo(() => describeOps(p.ops), [p.ops]);

  useEffect(() => {
    let live = true;
    if (view !== 'code' || !p.preview) return;
    void Promise.all([generate(p.before, language), generate(p.preview, language)]).then(([a, b]) => live && setCodes({ before: a.files[0].content, after: b.files[0].content }));
    return () => {
      live = false;
    };
  }, [view, p.before, p.preview, language]);

  return (
    <div className="tool-card" data-testid="block-proposal">
      <div className="tool-card-head">
        <Icon name="blocks" />
        <span className="grow ellipsis strong">{p.summary ?? t('ai.blockProposal')}</span>
        <StatusChip status={p.status} />
      </div>
      {ops.slice(0, 8).map((o, i) => (
        <div className="tool-row" key={i}>
          <span className={`dot ${['delete', 'replace', 'clear', 'disconnect'].includes(o.op) ? 'warn' : 'info'}`} />
          <span>{t(`ai.op.${o.op}`)}</span>
          <span className="faint ellipsis">{o.detail}</span>
          {o.count > 0 && <span className="faint" style={{ marginLeft: 'auto' }}>{t('ai.blockCount', { count: o.count })}</span>}
        </div>
      ))}
      {ops.length > 8 && <div className="tool-row faint">{t('ai.moreOps', { count: ops.length - 8 })}</div>}
      {p.issues.length > 0 && (
        <div className="notice err" style={{ margin: '6px 10px' }}>
          <div className="selectable">
            {p.issues.slice(0, 5).map((i, k) => (
              <div key={k}>{i.message}</div>
            ))}
          </div>
        </div>
      )}
      {p.preview && p.status !== 'rejected' && (
        <>
          <div className="row" style={{ padding: '4px 10px' }}>
            <div className="segmented">
              <button className={view === 'blocks' ? 'active' : ''} onClick={() => setView('blocks')}>
                {t('view.blocks')}
              </button>
              <button className={view === 'code' ? 'active' : ''} onClick={() => setView('code')}>
                {t('ai.codeDiff')}
              </button>
            </div>
            <span className="faint small" style={{ marginLeft: 'auto' }}>
              {t('ai.previewCounts', { added: p.created.length, removed: p.removed.length })}
            </span>
          </div>
          {view === 'blocks' ? (
            <div style={{ height: 220, position: 'relative', borderTop: 'var(--hairline) solid var(--border-2)' }}>
              <BlocklyPane fileId={`preview-${messageId}`} language={language} initial={p.preview} readOnly compact highlight={p.created} />
            </div>
          ) : (
            <div style={{ borderTop: 'var(--hairline) solid var(--border-2)' }}>{codes ? <DiffView before={codes.before} after={codes.after} max={240} /> : <div className="tool-row faint">{t('common.loading')}</div>}</div>
          )}
        </>
      )}
      <Verify v={p.verify} />
      <div className="row gap-6" style={{ padding: '8px 10px', justifyContent: 'flex-end' }}>
        {p.status === 'pending' && (
          <>
            <button className="btn sm" onClick={() => rejectProposal(messageId, 'blocks')} data-testid="proposal-reject">
              {t('ai.reject')}
            </button>
            <button className="btn sm primary" disabled={streaming} onClick={() => void applyBlockProposal(messageId)} data-testid="proposal-apply">
              {t('ai.apply')}
            </button>
          </>
        )}
        {p.status === 'applied' && (
          <>
            <button className="btn sm" onClick={() => undoProposal(messageId, 'blocks')} data-testid="proposal-undo">
              <Icon name="undo" size={14} />
              {t('common.undo')}
            </button>
            <button className="btn sm outline" onClick={() => void verifyByRunning(messageId)}>
              <Icon name="play" size={14} />
              {t('ai.runToVerify')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ChangeRow({ c }: { c: FileChange }) {
  const [open, setOpen] = useState(true);
  const stats = useMemo(() => diffStats(diffLines(c.before ?? '', c.after ?? '')), [c]);
  return (
    <div style={{ borderTop: 'var(--hairline) solid var(--border-2)' }}>
      <button className="tool-row" style={{ border: 0, background: 'transparent', width: '100%', cursor: 'pointer', height: 30 }} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
        <span className="mono ellipsis" style={{ color: 'var(--label-primary)' }}>
          {c.path}
        </span>
        <span className="chip">{t(`ai.change.${c.kind}`)}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--diff-add)' }}>+{stats.added}</span>
        <span style={{ color: 'var(--diff-del)' }}>-{stats.removed}</span>
      </button>
      {open && <DiffView before={c.before ?? ''} after={c.after ?? ''} max={260} />}
    </div>
  );
}

export function FileProposalCard({ messageId, p }: { messageId: string; p: FileProposal }) {
  const streaming = useAi((s) => s.streaming);
  return (
    <div className="tool-card" data-testid="file-proposal">
      <div className="tool-card-head">
        <Icon name="diff" />
        <span className="grow ellipsis strong">{p.summary ?? t('ai.fileProposal')}</span>
        <StatusChip status={p.status} />
      </div>
      {p.issues.length > 0 && (
        <div className="notice err" style={{ margin: '6px 10px' }}>
          <div className="selectable">
            {p.issues.slice(0, 5).map((i, k) => (
              <div key={k}>{i.message}</div>
            ))}
          </div>
        </div>
      )}
      {p.status !== 'rejected' && p.changes.map((c) => <ChangeRow key={c.path} c={c} />)}
      <Verify v={p.verify} />
      <div className="row gap-6" style={{ padding: '8px 10px', justifyContent: 'flex-end' }}>
        {p.status === 'pending' && (
          <>
            <button className="btn sm" onClick={() => rejectProposal(messageId, 'files')}>
              {t('ai.reject')}
            </button>
            <button className="btn sm primary" disabled={streaming} onClick={() => void applyFileProposal(messageId)}>
              {t('ai.apply')}
            </button>
          </>
        )}
        {p.status === 'applied' && (
          <button className="btn sm" onClick={() => undoProposal(messageId, 'files')}>
            <Icon name="undo" size={14} />
            {t('common.undo')}
          </button>
        )}
      </div>
    </div>
  );
}

/** A terminal request of the assistant: what it wants to run, and the buttons to allow or refuse it. */
export function CommandCardView({ messageId, c }: { messageId: string; c: CommandCard }) {
  const [open, setOpen] = useState(false);
  const folder = useWorkspace((s) => s.folder);
  const provider = activeProvider();
  const read = c.kind === 'read';
  const state =
    c.status === 'running' ? (
      <span className="row gap-6 muted">
        <span className="dot busy" />
        <span className="shimmer">{t('ai.cmd.running')}</span>
      </span>
    ) : c.status === 'done' ? (
      read ? (
        <span className="chip ok">{t('ai.cmd.readDone')}</span>
      ) : (
        <span className={`chip ${c.exitCode === 0 && !c.timedOut ? 'ok' : 'err'}`}>{c.timedOut ? t('ai.cmd.timedOut') : t('ai.cmd.exit', { code: c.exitCode ?? '?' })}</span>
      )
    ) : c.status === 'rejected' ? (
      <span className="chip">{t('ai.cmd.rejected')}</span>
    ) : c.status === 'failed' ? (
      <span className="chip err">{t('ai.cmd.failed')}</span>
    ) : null;
  return (
    <div className="tool-card" data-testid="command-card" data-status={c.status}>
      <div className="tool-card-head">
        <Icon name="terminal" size={14} />
        <span className="grow ellipsis">{t(read ? 'ai.cmd.readTitle' : 'ai.cmd.title')}</span>
        {state}
      </div>
      {read ? (
        <div className="tool-note">{t('ai.cmd.readDetail', { lines: c.lines ?? 80 })}</div>
      ) : (
        <pre className="command-line selectable" data-testid="command-text">
          {c.command}
        </pre>
      )}
      {c.reason && <div className="tool-note">{c.reason}</div>}
      {c.status === 'pending' && (
        <>
          {!read && <div className="tool-note faint">{t('ai.cmd.where', { where: folder ? folder.path : t('ai.cmd.workFolder') })}</div>}
          <div className="tool-note faint">{t('ai.cmd.sendNote', { name: provider?.name ?? '' })}</div>
          {c.risky && (
            <div className="notice warn" style={{ margin: '4px 12px 0' }} data-testid="command-risky">
              <Icon name="warning" size={14} />
              <span>{t('ai.cmd.risky')}</span>
            </div>
          )}
          <div className="row gap-6" style={{ padding: '8px 12px 10px', justifyContent: 'flex-end' }}>
            <button className="btn sm" onClick={() => void rejectCommand(messageId, c.callId)} data-testid="command-reject">
              {t('ai.cmd.reject')}
            </button>
            <button className="btn sm primary" onClick={() => void approveCommand(messageId, c.callId)} data-testid="command-run">
              {t(read ? 'ai.cmd.allow' : 'ai.cmd.run')}
            </button>
          </div>
        </>
      )}
      {(c.status === 'failed' || (c.status === 'rejected' && c.error)) && <div className="tool-note err">{c.status === 'rejected' ? t('ai.cmd.off') : c.error}</div>}
      {c.status === 'done' && (
        <>
          <button className="tool-row" style={{ border: 0, background: 'transparent', width: '100%', cursor: 'pointer', height: 30 }} onClick={() => setOpen(!open)} data-testid="command-output-toggle">
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
            {t(open ? 'ai.cmd.hideOutput' : 'ai.cmd.showOutput')}
          </button>
          {open && (
            <pre className="command-output selectable scroll" data-testid="command-output">
              {c.output?.trim() ? c.output : t('ai.cmd.noOutput')}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
