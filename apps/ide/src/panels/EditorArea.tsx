import { computeSupport, domainOf, importJavaScript, LANGUAGE_IDS, LANGUAGES, type LanguageId, type ProjectFile, type SupportMatrix, unsupportedBlocks } from '@blockforge/core';
import { useEffect, useMemo, useState } from 'react';
import { CodeEditor } from '../editor/CodeEditor';
import { BlocklyPane } from '../blockly/BlocklyPane';
import { formatKeys, runCommand } from '../commands';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Icon } from '../components/Icon';
import { MenuButton, SplitHandle } from '../components/ui';
import { t } from '../i18n';
import { getPlatform } from '../platform';
import { runActive, runCapabilities, stopRun, transpile } from '../runtime/runner';
import { activeFile, useProject } from '../state/project';
import { useRun } from '../state/run';
import { type CenterView, useSettings } from '../state/settings';
import { confirmDialog } from '../state/ui';
import { closeDoc, focusDoc, focusProject, isDirty, monacoLanguage, newDoc, runnableLanguage, saveDoc, setDocLanguage, setDocText, type TextDoc, textLanguages, useWorkspace } from '../state/workspace';
import { blocksFollowCode, CodePane, regenerateFromBlocks } from './CodePane';
import { Dock, useProblems } from './Dock';
import { LangBadge } from './Sidebar';

let supportCache: SupportMatrix | undefined;

/** Measured once per session: which blocks each language cannot express. */
function useUnsupported(lang: LanguageId): Set<string> | undefined {
  const [matrix, setMatrix] = useState(supportCache);
  useEffect(() => {
    if (supportCache) return;
    let live = true;
    // Deferred so the first paint is never delayed by the probe generation.
    const id = setTimeout(() => {
      void computeSupport().then((m) => {
        supportCache = m;
        if (live) setMatrix(m);
      });
    }, 1200);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, []);
  return useMemo(() => (matrix && domainOf(lang) === 'imperative' ? unsupportedBlocks(matrix, lang) : undefined), [matrix, lang]);
}

function RunControls({ lang }: { lang: LanguageId }) {
  const status = useRun((s) => s.status);
  const checked = useRun((s) => s.toolchainsChecked);
  const caps = useMemo(() => runCapabilities(lang), [lang, checked]); // eslint-disable-line react-hooks/exhaustive-deps
  const desktop = getPlatform().kind === 'desktop';
  const mode = LANGUAGES[lang].kind;
  const label = caps.preview ? t('run.preview') : mode === 'query' ? t('run.query') : t('run.run');
  return (
    <div className="row gap-4">
      {status !== 'idle' ? (
        <button className="btn sm outline" onClick={stopRun} title={`${t('cmd.stop')} (${formatKeys('Mod+.')})`} data-testid="stop">
          <Icon name="stop" size={14} />
          {t('cmd.stop')}
        </button>
      ) : (
        <button className="btn sm primary" onClick={() => void runActive('run')} title={`${label} (${formatKeys('Mod+Enter')})`} data-testid="run">
          <Icon name={caps.preview ? 'eye' : 'play'} size={14} />
          {label}
        </button>
      )}
      <MenuButton
        className="btn sm icon outline"
        title={t('run.more')}
        testId="run-menu"
        items={[
          { label: t('cmd.build'), icon: 'build', hint: formatKeys('Mod+B'), disabled: !desktop || caps.preview, onSelect: () => runCommand('build') },
          { label: t('cmd.rebuild'), icon: 'rebuild', disabled: !desktop || caps.preview, onSelect: () => runCommand('rebuild') },
          { label: t('cmd.clean'), icon: 'clean', disabled: !desktop || caps.preview, onSelect: () => runCommand('clean') },
          { label: t('cmd.check'), icon: 'check', disabled: !desktop || caps.preview, onSelect: () => runCommand('check') },
          { label: '', separator: true },
          { label: t('cmd.runBuiltin'), icon: 'play', disabled: !caps.builtin, onSelect: () => runCommand('runBuiltin') },
          { label: t('run.withToolchain'), icon: 'toolchain', disabled: !caps.toolchain, onSelect: () => void runActive('run', 'toolchain') },
          { label: '', separator: true },
          { label: t('run.buildSettings'), icon: 'settings', onSelect: () => runCommand('settings') },
        ]}
      >
        <Icon name="chevronDown" size={13} />
      </MenuButton>
    </div>
  );
}

/**
 * The blocks of a file that is being edited as code, shown read-only. For JavaScript
 * and TypeScript they are rebuilt from the code as it is typed; for other languages
 * there is no reader for the code, so the blocks stay as they were.
 */
function CodeBlocksView({ file }: { file: ProjectFile }) {
  const live = blocksFollowCode(file.language);
  const [status, setStatus] = useState<{ kind: 'waiting' | 'synced' | 'error'; raw: number }>({ kind: 'waiting', raw: 0 });
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const timer = setTimeout(async () => {
      let source = file.code;
      if (file.language === 'typescript') {
        // Types are removed first; the blocks carry the logic, and types are inferred again when code is generated.
        const out = await transpile(file.code, file.name).catch(() => undefined);
        if (!alive) return;
        if (!out || out.errors.length) return setStatus({ kind: 'error', raw: 0 });
        source = out.js;
      }
      const r = importJavaScript(source.replace(/^export \{\};?[ \t]*$/gm, ''));
      if (!alive) return;
      if (!r.ok || !r.state) return setStatus({ kind: 'error', raw: 0 });
      // Parts outside the block vocabulary stay as raw code of this file's own language.
      const state = file.language === 'typescript' ? (JSON.parse(JSON.stringify(r.state).replaceAll('"LANG":"javascript"', '"LANG":"typescript"')) as typeof r.state) : r.state;
      if (JSON.stringify(state) !== JSON.stringify(file.blocks)) useProject.getState().updateBlocks(file.id, state);
      setStatus({ kind: 'synced', raw: r.raw });
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, file.id, file.language, file.code]);

  const text = !live ? t('blocks.paused') : status.kind === 'error' ? t('blocks.followError') : status.raw > 0 ? t('blocks.followRaw', { count: status.raw }) : t('blocks.follow');
  return (
    <>
      <div className="blocks-follow" data-testid="blocks-follow" data-state={live ? status.kind : 'paused'}>
        <span className={`dot ${!live ? 'warn' : status.kind === 'error' ? 'err' : status.kind === 'synced' ? 'ok' : 'busy'}`} />
        <span className="col grow" style={{ gap: 0 }}>
          <span className="secondary">{text}</span>
          {!live && <span className="faint small">{t('blocks.pausedWhy')}</span>}
        </span>
        <button className="btn sm outline" onClick={() => void regenerateFromBlocks(file.id, live)} data-testid="blocks-resume">
          <Icon name={live ? 'blocks' : 'refresh'} size={14} />
          {live ? t('blocks.editBlocks') : t('code.reattach')}
        </button>
      </div>
      <BlocklyPane key={`${file.id}-view`} fileId={file.id} language={file.language} initial={file.blocks} readOnly />
    </>
  );
}

/** A plain text editor tab: any file, any language, no blocks. */
function TextPane({ doc }: { doc: TextDoc }) {
  return (
    <div className="col grow" style={{ minWidth: 0 }} data-testid="text-pane">
      <CodeEditor docId={doc.id} value={doc.text} language={monacoLanguage(doc.language)} onChange={(v) => setDocText(doc.id, v)} testId="text-editor" />
    </div>
  );
}

function TextControls({ doc }: { doc: TextDoc }) {
  const lang = runnableLanguage(doc.language);
  const dirty = isDirty(doc);
  return (
    <>
      <select className="select sm" value={doc.language} onChange={(e) => setDocLanguage(doc.id, e.target.value)} aria-label={t('text.language')} title={t('text.language')} data-testid="text-language">
        {textLanguages().map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <button className="btn sm icon" title={`${t('common.save')} (${formatKeys('Mod+S')})`} onClick={() => void saveDoc(doc.id)} data-testid="text-save">
        <Icon name="save" />
        {dirty && <span className="dot warn badge-dot" />}
      </button>
      {lang && <RunControls lang={lang} />}
    </>
  );
}

export function EditorArea() {
  const project = useProject((s) => s.project);
  const tabs = useProject((s) => s.openTabs);
  const projectFile = useProject((s) => activeFile(s));
  const docs = useWorkspace((s) => s.docs);
  const activeDocId = useWorkspace((s) => s.activeDoc);
  const result = useProject((s) => (projectFile ? s.results[projectFile.id] : undefined));
  const layout = useSettings((s) => s.layout);
  const problems = useProblems();
  const unsupported = useUnsupported(projectFile?.language ?? 'python');
  const setLayout = (patch: Partial<typeof layout>) => useSettings.getState().update({ layout: patch });
  // The text tab in front; with no block project open, a text tab is always in front.
  const doc = docs.find((d) => d.id === activeDocId) ?? (projectFile ? undefined : docs[0]);
  const file = doc ? undefined : projectFile;
  if (!doc && !file) return null;
  const view: CenterView = file?.mode === 'code' && layout.view === 'blocks' ? 'split' : layout.view;
  const errors = problems.filter((p) => p.severity === 'error').length;

  const changeLanguage = async (lang: LanguageId) => {
    if (!file || lang === file.language) return;
    if (domainOf(lang) !== domainOf(file.language)) {
      // Blocks only carry over between languages of the same kind.
      const ok = await confirmDialog({ title: t('lang.switchTitle', { name: LANGUAGES[lang].name }), message: t('lang.switchMessage'), danger: true, confirmLabel: t('lang.switch') });
      if (!ok) return;
      useProject.getState().checkpoint(t('lang.switchCheckpoint'));
    } else if (file.mode === 'code') {
      const ok = await confirmDialog({ title: t('lang.switchTitle', { name: LANGUAGES[lang].name }), message: t('lang.switchCodeMessage'), danger: true, confirmLabel: t('lang.switch') });
      if (!ok) return;
      useProject.getState().checkpoint(t('lang.switchCheckpoint'));
    }
    useProject.getState().setLanguage(file.id, lang);
  };

  return (
    <div className="bf-main" data-testid="editor-area">
      <div className="bf-header drag" data-tauri-drag-region>
        {layout.sidebarCollapsed && <span style={{ width: 'var(--rail-header-gap, 4px)', flex: 'none' }} />}
        <div className="tabs scroll" style={{ overflowY: 'hidden', flex: '0 1 auto' }} data-testid="file-tabs">
          {project &&
            tabs.map((id) => {
              const f = project.files.find((x) => x.id === id);
              if (!f) return null;
              return (
                <button key={id} className={`tab ${file && f.id === file.id ? 'active' : ''}`} onClick={() => focusProject(id)} title={f.name} data-testid="file-tab">
                  <LangBadge lang={f.language} />
                  <span className="ellipsis tab-name">{f.name}</span>
                  {tabs.length > 1 && (
                    <span
                      className="close"
                      role="button"
                      aria-label={t('common.close')}
                      onClick={(e) => {
                        e.stopPropagation();
                        useProject.getState().closeTab(id);
                      }}
                    >
                      <Icon name="x" size={11} />
                    </span>
                  )}
                </button>
              );
            })}
          {docs.map((d) => {
            const lang = runnableLanguage(d.language);
            return (
              <button key={d.id} className={`tab ${doc?.id === d.id ? 'active' : ''}`} onClick={() => focusDoc(d.id)} title={d.path ?? d.name} data-testid="text-tab">
                {lang ? <LangBadge lang={lang} /> : <Icon name="file" size={14} className="faint" />}
                <span className="ellipsis tab-name">{d.name}</span>
                {isDirty(d) && <span className="dot warn" title={t('text.unsaved')} />}
                <span
                  className="close"
                  role="button"
                  aria-label={t('common.close')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeDoc(d.id);
                  }}
                >
                  <Icon name="x" size={11} />
                </span>
              </button>
            );
          })}
        </div>
        <button className="btn sm icon" title={`${t('cmd.newText')} (${formatKeys('Mod+T')})`} onClick={() => newDoc()} data-testid="new-tab">
          <Icon name="plus" size={14} />
        </button>
        <span className="grow" style={{ alignSelf: 'stretch', minWidth: 8 }} data-tauri-drag-region />
        {doc && <TextControls doc={doc} />}
        {file && (
          <>
            <select className="select sm" value={file.language} onChange={(e) => void changeLanguage(e.target.value as LanguageId)} aria-label={t('lang.target')} title={t('lang.target')} data-testid="language-select">
              {LANGUAGE_IDS.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGES[l].name}
                </option>
              ))}
            </select>
            <div className="segmented" role="tablist" aria-label={t('view.label')}>
              {(['blocks', 'split', 'code'] as const).map((v) => (
                <button key={v} className={view === v ? 'active' : ''} onClick={() => setLayout({ view: v })} disabled={v === 'blocks' && file.mode === 'code'} title={t(`view.${v}`)} data-testid={`view-${v}`}>
                  <Icon name={v} size={14} />
                </button>
              ))}
            </div>
            <RunControls lang={file.language} />
          </>
        )}
        {!layout.dockOpen && (
          <button className="btn sm icon" title={t('cmd.toggleDock')} onClick={() => setLayout({ dockOpen: true })} data-testid="dock-open">
            <Icon name="panelBottom" />
            {errors > 0 && <span className="dot err badge-dot" />}
          </button>
        )}
        {!layout.rightOpen && (
          <button className="btn sm icon" title={t('cmd.toggleRight')} onClick={() => setLayout({ rightOpen: true })} data-testid="right-open">
            <Icon name="panelRight" />
          </button>
        )}
      </div>

      <div className="row grow" style={{ gap: 0, alignItems: 'stretch' }} data-view={doc ? 'text' : view}>
        {doc && (
          <ErrorBoundary compact resetKey={doc.id}>
            <TextPane key={doc.id} doc={doc} />
          </ErrorBoundary>
        )}
        {file && view !== 'code' && (
          <div className="col" style={{ flex: view === 'split' ? `${layout.splitRatio} 1 0` : '1 1 0', minWidth: 0, position: 'relative' }}>
            <ErrorBoundary compact resetKey={`${file.id}-${file.mode}`}>
              {file.mode === 'blocks' ? <BlocklyPane key={file.id} fileId={file.id} language={file.language} initial={file.blocks} diagnostics={result?.diagnostics} unsupported={unsupported} /> : <CodeBlocksView file={file} />}
            </ErrorBoundary>
          </div>
        )}
        {file && view === 'split' && (
          <SplitHandle
            axis="x"
            onDrag={(dx) => {
              const total = document.querySelector('[data-view]')?.clientWidth ?? 1000;
              setLayout({ splitRatio: Math.min(0.85, Math.max(0.2, useSettings.getState().layout.splitRatio + dx / total)) });
            }}
          />
        )}
        {file && (view !== 'blocks' || file.mode === 'code') && (
          <div className="col" style={{ flex: view === 'split' ? `${1 - layout.splitRatio} 1 0` : '1 1 0', minWidth: 0, borderLeft: view === 'split' ? 'var(--hairline) solid var(--border-2)' : undefined }}>
            <ErrorBoundary compact resetKey={file.id}>
              <CodePane key={file.id} file={file} />
            </ErrorBoundary>
          </div>
        )}
      </div>

      {layout.dockOpen && (
        <>
          <SplitHandle axis="y" onDrag={(dy) => setLayout({ dockHeight: Math.min(window.innerHeight - 220, Math.max(96, useSettings.getState().layout.dockHeight - dy)) })} />
          <div className="bf-dock" style={{ height: layout.dockHeight }}>
            <ErrorBoundary compact resetKey={layout.dockTab}>
              <Dock />
            </ErrorBoundary>
          </div>
        </>
      )}
    </div>
  );
}
