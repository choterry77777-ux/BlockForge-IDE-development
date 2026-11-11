import type { Diagnostic } from '@blockforge/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fixWithAi } from '../ai/engine';
import { Icon } from '../components/Icon';
import { diagText, t } from '../i18n';
import { canSendInput, sendInput } from '../runtime/runner';
import { activeFile, useProject } from '../state/project';
import { outputText, useRun } from '../state/run';
import { type DockTab, useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { clearSession, useTerminals } from '../terminal/sessions';
import { TerminalPane, TerminalTabs } from './TerminalPane';

export function useProblems(): Diagnostic[] {
  const file = useProject((s) => activeFile(s));
  const result = useProject((s) => (file ? s.results[file.id] : undefined));
  const runDiags = useRun((s) => s.diagnostics);
  const runFile = useRun((s) => s.fileId);
  return useMemo(() => {
    const gen = file?.mode === 'blocks' ? (result?.diagnostics ?? []) : [];
    const run = file && runFile === file.id ? runDiags : [];
    const order = { error: 0, warning: 1, info: 2 };
    return [...gen, ...run].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [file, result, runDiags, runFile]);
}

function Output() {
  const output = useRun((s) => s.output);
  const tables = useRun((s) => s.tables);
  const status = useRun((s) => s.status);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [line, setLine] = useState('');
  useEffect(() => {
    if (box.current && stick.current) box.current.scrollTop = box.current.scrollHeight;
  }, [output, tables]);
  return (
    <div className="col grow">
      <div
        ref={box}
        className="scroll grow"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!output.length && !tables.length ? (
          <div className="empty secondary">{t('dock.emptyOutput')}</div>
        ) : (
          <div className="terminal selectable" data-testid="output">
            {output.map((c, i) => (
              <span key={i} className={c.kind === 'out' ? undefined : c.kind === 'in' ? 'sys' : c.kind}>
                {c.text}
              </span>
            ))}
          </div>
        )}
        {tables.map((tb, i) => (
          <div key={i} style={{ padding: '0 14px 14px' }} data-testid="result-table">
            <div className="mono faint ellipsis" style={{ padding: '4px 0' }}>
              {tb.title}
            </div>
            <div className="scroll card flat" style={{ borderRadius: 12, maxHeight: 260 }}>
              <table className="grid selectable">
                <thead>
                  <tr>
                    {tb.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tb.rows.slice(0, 500).map((r, k) => (
                    <tr key={k}>
                      {r.map((v, j) => (
                        <td key={j} className="mono">
                          {v === null ? <span className="faint">NULL</span> : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="faint small" style={{ paddingTop: 4 }}>
              {t('dock.rows', { count: tb.rows.length })}
            </div>
          </div>
        ))}
      </div>
      {status === 'running' && canSendInput() && (
        <form
          className="row pad-8"
          style={{ borderTop: 'var(--hairline) solid var(--border-2)', flex: 'none' }}
          onSubmit={(e) => {
            e.preventDefault();
            void sendInput(line);
            setLine('');
          }}
        >
          <input className="input sm grow mono" value={line} onChange={(e) => setLine(e.target.value)} placeholder={t('dock.typeInput')} />
          <button className="btn sm outline" type="submit">
            {t('dock.send')}
          </button>
        </form>
      )}
    </div>
  );
}

function Problems() {
  const problems = useProblems();
  if (!problems.length) return <div className="empty secondary">{t('dock.noProblems')}</div>;
  return (
    <div className="scroll grow" data-testid="problems">
      {problems.map((d, i) => (
        <button
          key={i}
          className="problem"
          onClick={() => {
            if (d.blockId) useUi.setState({ revealBlock: { id: d.blockId, n: Date.now() }, selectedBlock: d.blockId });
            if (d.line && d.file) useUi.setState({ revealLine: { file: d.file, line: d.line, n: Date.now() } });
          }}
        >
          <span style={{ color: d.severity === 'error' ? 'var(--error)' : d.severity === 'warning' ? 'var(--warning)' : 'var(--label-tertiary)', alignSelf: 'center', display: 'flex' }}>
            <Icon name={d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info'} size={14} />
          </span>
          <span className="grow selectable" style={{ whiteSpace: 'pre-wrap' }}>
            {diagText(d)}
          </span>
          <span className="faint small mono" style={{ whiteSpace: 'nowrap' }}>
            {d.source === 'compiler' ? t('dock.fromCompiler') : d.source === 'runtime' ? t('dock.fromRuntime') : t('dock.fromBlocks')}
            {d.line ? ` · ${d.file ?? ''}:${d.line}` : ''}
          </span>
        </button>
      ))}
    </div>
  );
}

function Input() {
  const stdin = useProject((s) => s.project?.settings.stdin ?? '');
  return (
    <div className="col grow pad-8 gap-6">
      <div className="hint-text">{t('dock.inputHint')}</div>
      <textarea className="textarea mono grow" style={{ resize: 'none' }} spellCheck={false} value={stdin} onChange={(e) => useProject.getState().patch((p) => (p.settings.stdin = e.target.value))} placeholder={t('dock.inputPlaceholder')} data-testid="stdin" />
    </div>
  );
}

export function Dock() {
  const tab = useSettings((s) => s.layout.dockTab);
  const problems = useProblems();
  const status = useRun((s) => s.status);
  const exit = useRun((s) => s.lastExit);
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;
  const activeTerminal = useTerminals((s) => s.active);
  const setTab = (dockTab: DockTab) => useSettings.getState().update({ layout: { dockTab } });
  return (
    <div className="col grow" data-testid="dock">
      <div className="row gap-4" style={{ height: 36, padding: '0 6px 0 8px', flex: 'none' }}>
        <div className="tabs">
          <button className={`tab ${tab === 'output' ? 'active' : ''}`} onClick={() => setTab('output')} data-testid="dock-output">
            <Icon name="terminal" size={14} />
            {t('dock.output')}
          </button>
          <button className={`tab ${tab === 'problems' ? 'active' : ''}`} onClick={() => setTab('problems')} data-testid="dock-problems">
            <Icon name="warning" size={14} />
            {t('dock.problems')}
            {errors > 0 && <span className="chip err">{errors}</span>}
            {warnings > 0 && <span className="chip warn">{warnings}</span>}
          </button>
          <button className={`tab ${tab === 'input' ? 'active' : ''}`} onClick={() => setTab('input')} data-testid="dock-input">
            <Icon name="edit" size={14} />
            {t('dock.input')}
          </button>
          <button className={`tab ${tab === 'terminal' ? 'active' : ''}`} onClick={() => setTab('terminal')} data-testid="dock-terminal">
            <Icon name="terminal" size={14} />
            {t('dock.terminal')}
          </button>
        </div>
        {tab === 'terminal' ? <TerminalTabs /> : <span className="grow" />}
        {status !== 'idle' && (
          <span className="row gap-6 secondary muted">
            <span className="dot busy" />
            <span className="shimmer">{status === 'building' ? t('run.building') : t('run.running')}</span>
          </span>
        )}
        {status === 'idle' && exit && (
          <span className="row gap-6 secondary muted" data-testid="run-result">
            <span className={`dot ${exit.ok ? 'ok' : 'err'}`} />
            {exit.ok ? t('run.ok', { ms: exit.ms }) : t('run.notOk')}
          </span>
        )}
        {errors > 0 && (
          <button className="btn sm" onClick={() => void fixWithAi()} data-testid="fix-with-ai">
            <Icon name="wand" size={14} />
            {t('ai.fix')}
          </button>
        )}
        {tab !== 'terminal' && (
        <button
          className="btn sm icon"
          title={t('common.copy')}
          onClick={() => {
            void navigator.clipboard.writeText(outputText());
            useUi.getState().toast(t('common.copied'), 'ok');
          }}
        >
          <Icon name="copy" size={14} />
        </button>
        )}
        <button className="btn sm icon" title={t('common.clear')} onClick={() => (tab === 'terminal' ? activeTerminal && clearSession(activeTerminal) : useRun.getState().clear())}>
          <Icon name="trash" size={14} />
        </button>
        <button className="btn sm icon" title={t('dock.hide')} onClick={() => useSettings.getState().update({ layout: { dockOpen: false } })}>
          <Icon name="chevronDown" size={14} />
        </button>
      </div>
      {tab === 'output' ? <Output /> : tab === 'problems' ? <Problems /> : tab === 'terminal' ? <TerminalPane /> : <Input />}
    </div>
  );
}
