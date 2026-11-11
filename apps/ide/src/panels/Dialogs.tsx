import { type Example, examplesFor, IMPERATIVE_LANGUAGES, LANGUAGE_IDS, LANGUAGES, type LanguageId, type ProjectFile } from '@blockforge/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createNewProject, deleteProject, duplicateCurrent, exportZip, openExample, openProjectFile, renameProject, saveProjectAs } from '../actions';
import { commandAvailable, COMMANDS, formatKeys, runCommand } from '../commands';
import { useWorkspace } from '../state/workspace';
import { Icon } from '../components/Icon';
import { Dialog } from '../components/ui';
import { t } from '../i18n';
import { openStored, useProject } from '../state/project';
import { useUi } from '../state/ui';
import { LangBadge } from './Sidebar';

/** Stable empty list: a selector that built a new array each time would re-render forever. */
const NO_FILES: ProjectFile[] = [];

const ORDERED: LanguageId[] = [...IMPERATIVE_LANGUAGES, ...LANGUAGE_IDS.filter((l) => !IMPERATIVE_LANGUAGES.includes(l))];

export function NewProjectDialog() {
  const [name, setName] = useState('');
  const [lang, setLang] = useState<LanguageId>('python');
  const close = () => useUi.getState().close();
  return (
    <Dialog
      title={t('cmd.newProject')}
      onClose={close}
      testId="new-project-dialog"
      footer={
        <>
          <button className="btn sm outline" onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="btn sm primary" onClick={() => void createNewProject(lang, name)} data-testid="create-project">
            {t('project.create')}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <div className="field">
          <label>{t('project.name')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('project.untitled')} autoFocus data-testid="project-name-input" onKeyDown={(e) => e.key === 'Enter' && void createNewProject(lang, name)} />
        </div>
        <div className="field">
          <label>{t('lang.target')}</label>
          <div className="lang-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', width: '100%' }}>
            {ORDERED.map((l) => (
              <button key={l} className="lang-tile" style={lang === l ? { boxShadow: 'inset 0 0 0 2px var(--focus)' } : undefined} onClick={() => setLang(l)} onDoubleClick={() => void createNewProject(l, name)} data-testid={`pick-${l}`}>
                <LangBadge lang={l} />
                <span className="ellipsis">{LANGUAGES[l].name}</span>
              </button>
            ))}
          </div>
          <div className="hint-text">{t('project.langHint')}</div>
        </div>
      </div>
    </Dialog>
  );
}

export function ProjectsDialog() {
  const recent = useProject((s) => s.recent);
  const current = useProject((s) => s.project);
  const close = () => useUi.getState().close();
  useEffect(() => {
    void useProject.getState().refreshRecent();
  }, []);
  return (
    <Dialog title={t('cmd.projects')} onClose={close} testId="projects-dialog">
      <div className="col gap-12">
        <div className="row gap-6 wrap">
          <button className="btn sm primary" onClick={() => useUi.getState().open('newProject')}>
            <Icon name="plus" size={14} />
            {t('cmd.newProject')}
          </button>
          <button className="btn sm outline" onClick={() => void openProjectFile()}>
            <Icon name="folderOpen" size={14} />
            {t('cmd.openProjectFile')}
          </button>
          {current && (
            <>
              <button className="btn sm outline" onClick={() => void saveProjectAs()}>
                <Icon name="save" size={14} />
                {t('cmd.saveAs')}
              </button>
              <button className="btn sm outline" onClick={() => void exportZip()}>
                <Icon name="download" size={14} />
                {t('cmd.exportZip')}
              </button>
              <button className="btn sm outline" onClick={() => void duplicateCurrent()}>
                <Icon name="copy" size={14} />
                {t('cmd.duplicate')}
              </button>
              <button className="btn sm outline" onClick={() => void renameProject()}>
                <Icon name="edit" size={14} />
                {t('cmd.renameProject')}
              </button>
            </>
          )}
        </div>
        <div className="col gap-4">
          {!recent.length && <div className="empty secondary" style={{ height: 120 }}>{t('project.noneSaved')}</div>}
          {recent.map((p) => (
            <div
              key={p.id}
              className={`list-row click ${current?.id === p.id ? 'active' : ''}`}
              role="button"
              tabIndex={0}
              data-testid="project-row"
              onClick={() => {
                void openStored(p.id).then(close);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void openStored(p.id).then(close)}
            >
              <Icon name="files" />
              <span className="grow ellipsis">{p.name}</span>
              <span className="row gap-4">
                {p.languages.slice(0, 4).map((l) => (
                  <LangBadge key={l} lang={l as LanguageId} />
                ))}
              </span>
              <span className="faint small">{new Date(p.updatedAt).toLocaleString()}</span>
              <button
                className="btn sm icon"
                title={t('common.delete')}
                data-testid="project-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteProject(p.id, p.name);
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export function ExamplesDialog() {
  const active = useProject((s) => s.project?.files.find((f) => f.id === s.project?.activeFileId)?.language);
  const [lang, setLang] = useState<LanguageId>(active ?? 'python');
  const examples = useMemo(() => examplesFor(lang), [lang]);
  const title = (ex: Example) => (t(`example.${ex.id}`) === `example.${ex.id}` ? ex.title : t(`example.${ex.id}`));
  const desc = (ex: Example) => (t(`example.${ex.id}.desc`) === `example.${ex.id}.desc` ? ex.description : t(`example.${ex.id}.desc`));
  return (
    <Dialog title={t('cmd.examples')} onClose={() => useUi.getState().close()} wide testId="examples-dialog">
      <div className="col gap-12">
        <div className="row gap-6">
          <label className="field-label">{t('lang.target')}</label>
          <select className="select sm" value={lang} onChange={(e) => setLang(e.target.value as LanguageId)} data-testid="example-language">
            {ORDERED.map((l) => (
              <option key={l} value={l}>
                {LANGUAGES[l].name}
              </option>
            ))}
          </select>
          <span className="hint-text">{t('example.hint', { count: examples.length })}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {examples.map((ex) => (
            <button key={ex.id} className="lang-tile" style={{ height: 'auto', padding: '10px 12px', alignItems: 'flex-start', flexDirection: 'column', gap: 2 }} onClick={() => void openExample(ex, lang)} data-testid={`example-${ex.id}`}>
              <span className="strong">{title(ex)}</span>
              <span className="small muted" style={{ whiteSpace: 'normal' }}>
                {desc(ex)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const hasProject = useProject((s) => !!s.project);
  const openDocs = useWorkspace((s) => s.docs.length);
  const files = useProject((s) => s.project?.files) ?? NO_FILES;
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cmds = COMMANDS.filter((c) => c.id !== 'palette' && commandAvailable(c)).map((c) => ({ key: c.id, title: t(c.title), icon: c.icon ?? 'command', keys: c.keys, run: () => runCommand(c.id) }));
    const fileItems = files.map((f) => ({ key: `file-${f.id}`, title: f.name, icon: 'file', keys: undefined as string | undefined, run: () => useProject.getState().setActive(f.id) }));
    const all = [...cmds, ...fileItems];
    if (!q) return all;
    const words = q.split(/\s+/);
    return all.filter((c) => words.every((w) => c.title.toLowerCase().includes(w) || c.key.toLowerCase().includes(w)));
  }, [query, hasProject, openDocs, files]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const close = () => useUi.getState().close();
  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    close();
    item.run();
  };
  return (
    <div className="backdrop" style={{ alignItems: 'flex-start', paddingTop: '14vh' }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" style={{ width: 'min(600px, 100%)', maxHeight: '60vh' }} role="dialog" aria-modal="true" data-testid="palette">
        <div className="row" style={{ padding: '14px 18px 10px', gap: 10, borderBottom: 'var(--hairline) solid var(--border-2)' }}>
          <Icon name="search" className="faint" />
          <input
            className="grow"
            style={{ border: 0, outline: 'none', background: 'transparent', fontSize: 15, userSelect: 'text' }}
            autoFocus
            value={query}
            placeholder={t('palette.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="palette-input"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(index);
              } else if (e.key === 'Escape') close();
            }}
          />
        </div>
        <div ref={list} className="scroll" style={{ padding: 6 }}>
          {!items.length && <div className="empty secondary" style={{ height: 80 }}>{t('palette.none')}</div>}
          {items.map((c, i) => (
            <button key={c.key} className={`menu-item ${i === index ? 'active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => choose(i)} data-testid="palette-item">
              <Icon name={c.icon} />
              <span>{c.title}</span>
              {c.keys && <span className="hint">{formatKeys(c.keys)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ShortcutsDialog() {
  return (
    <Dialog title={t('cmd.shortcuts')} onClose={() => useUi.getState().close()} testId="shortcuts-dialog">
      <div className="col">
        {COMMANDS.filter((c) => c.keys).map((c) => (
          <div key={c.id} className="setting" style={{ padding: '7px 0' }}>
            <div className="text">{t(c.title)}</div>
            <span className="kbd">{formatKeys(c.keys!)}</span>
          </div>
        ))}
        {[
          ['shortcut.acceptCompletion', 'Tab'],
          ['shortcut.dismissCompletion', 'Esc'],
          ['shortcut.triggerCompletion', formatKeys('Alt+\\')],
          ['shortcut.sendMessage', formatKeys('Enter')],
          ['shortcut.newLine', formatKeys('Shift+Enter')],
          ['shortcut.blockNav', t('shortcut.arrowKeys')],
        ].map(([k, keys]) => (
          <div key={k} className="setting" style={{ padding: '7px 0' }}>
            <div className="text">{t(k)}</div>
            <span className="kbd">{keys}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
