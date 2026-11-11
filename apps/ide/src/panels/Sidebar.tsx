import { IMPERATIVE_LANGUAGES, LANGUAGE_IDS, LANGUAGES, type LanguageId } from '@blockforge/core';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { getPlatform } from '../platform';
import type { FsMatch } from '../platform/types';
import { openPath } from '../state/workspace';
import { addFileDialog, deleteFileDialog, renameFileDialog } from '../actions';
import { blockSearchText } from '../blockly/setup';
import { formatKeys, runCommand } from '../commands';
import { Icon, Logo } from '../components/Icon';
import { MenuButton } from '../components/ui';
import { t } from '../i18n';
import { useProject } from '../state/project';
import { type RightTab, useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import { focusProject, goHome, useWorkspace } from '../state/workspace';
import { Explorer, ExplorerActions } from './Explorer';

const BADGES: Record<LanguageId, string> = { python: 'PY', javascript: 'JS', typescript: 'TS', c: 'C', cpp: 'C++', java: 'JV', csharp: 'C#', lua: 'LUA', html: 'HTML', css: 'CSS', php: 'PHP', go: 'GO', rust: 'RS', sql: 'SQL', dart: 'DART', assembly: 'ASM', ruby: 'RB', kotlin: 'KT', bash: 'SH' };

export function LangBadge({ lang }: { lang: LanguageId }) {
  return <span className="lang-badge">{BADGES[lang]}</span>;
}

const NAV: { tab: RightTab; icon: string }[] = [
  { tab: 'assistant', icon: 'sparkle' },
  { tab: 'compare', icon: 'compare' },
  { tab: 'packages', icon: 'package' },
  { tab: 'toolchains', icon: 'toolchain' },
  { tab: 'browser', icon: 'globe' },
  { tab: 'tools', icon: 'tools' },
];

interface Hit {
  fileId: string;
  file: string;
  line?: number;
  blockId?: string;
  text: string;
}

function SearchView() {
  const query = useUi((s) => s.search);
  const project = useProject((s) => s.project);
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Hit[] = [];
    if (!project || q.length < 2) return out;
    for (const f of project.files) {
      f.code.split('\n').forEach((line, i) => {
        if (out.length < 200 && line.toLowerCase().includes(q)) out.push({ fileId: f.id, file: f.name, line: i + 1, text: line.trim() });
      });
      // Block labels and field values are searched too.
      const visit = (b: { type: string; id?: string; fields?: Record<string, unknown>; inputs?: Record<string, { block?: unknown; shadow?: unknown }>; next?: { block?: unknown } } | undefined): void => {
        if (!b || out.length >= 200) return;
        const fields = Object.values(b.fields ?? {}).filter((v) => typeof v !== 'object').join(' ');
        if (`${blockSearchText(b.type)} ${fields}`.toLowerCase().includes(q) && b.id) out.push({ fileId: f.id, file: f.name, blockId: b.id, text: `${b.type}${fields ? `: ${fields}` : ''}` });
        for (const l of Object.values(b.inputs ?? {})) visit((l.block ?? l.shadow) as never);
        visit(b.next?.block as never);
      };
      for (const top of f.blocks.blocks?.blocks ?? []) visit(top as never);
    }
    return out;
  }, [query, project]);
  // Files of the opened folder are searched by the desktop backend.
  const folder = useWorkspace((s) => s.folder);
  const [disk, setDisk] = useState<FsMatch[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!folder || q.length < 2) {
      setDisk([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      void getPlatform()
        .workspace.search(folder.path, q, 200)
        .then((r) => live && setDisk(r))
        .catch(() => live && setDisk([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, folder]);
  return (
    <div className="col grow">
      <div className="bf-sidebar-section" style={{ paddingBottom: 6 }}>
        <input className="input sm" autoFocus value={query} onChange={(e) => useUi.setState({ search: e.target.value })} placeholder={t('search.placeholder')} data-testid="global-search" />
      </div>
      <div className="scroll grow bf-sidebar-section">
        {query.trim().length >= 2 && !hits.length && !disk.length && <div className="faint secondary" style={{ padding: 12 }}>{t('search.none')}</div>}
        {disk.map((h, i) => (
          <button
            key={`d${i}`}
            className="nav-row"
            style={{ height: 'auto', padding: '5px 12px', alignItems: 'flex-start' }}
            data-testid="search-hit-disk"
            onClick={() => {
              void openPath(h.path).then(() => useUi.setState({ revealLine: { file: h.path, line: h.line, n: Date.now() } }));
            }}
          >
            <Icon name="file" size={13} className="faint" />
            <span className="col grow" style={{ gap: 0 }}>
              <span className="mono ellipsis" style={{ fontSize: 12 }}>
                {h.text}
              </span>
              <span className="faint small ellipsis">
                {h.rel}:{h.line}
              </span>
            </span>
          </button>
        ))}
        {hits.map((h, i) => (
          <button
            key={i}
            className="nav-row"
            style={{ height: 'auto', padding: '5px 12px', alignItems: 'flex-start' }}
            data-testid="search-hit"
            onClick={() => {
              focusProject(h.fileId);
              if (h.blockId) setTimeout(() => useUi.setState({ revealBlock: { id: h.blockId!, n: Date.now() } }), 60);
              if (h.line) setTimeout(() => useUi.setState({ revealLine: { file: h.file, line: h.line!, n: Date.now() } }), 60);
            }}
          >
            <Icon name={h.blockId ? 'blocks' : 'code'} size={13} className="faint" />
            <span className="col grow" style={{ gap: 0 }}>
              <span className="mono ellipsis" style={{ fontSize: 12 }}>
                {h.text}
              </span>
              <span className="faint small">
                {h.file}
                {h.line ? `:${h.line}` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A collapsible sidebar section with a small header, like the panels of a code editor. */
function Section({ id, title, actions, children, testId }: { id: string; title: string; actions?: ReactNode; children: ReactNode; testId?: string }) {
  const closed = useSettings((s) => !!s.sidebarClosed[id]);
  const toggle = () => useSettings.getState().update({ sidebarClosed: { ...useSettings.getState().sidebarClosed, [id]: !closed } });
  return (
    <div className="side-section" data-testid={testId}>
      <div className="side-section-head" role="button" tabIndex={0} aria-expanded={!closed} onClick={toggle} onKeyDown={(e) => e.key === 'Enter' && toggle()}>
        <Icon name={closed ? 'chevronRight' : 'chevronDown'} size={12} />
        <span className="ellipsis grow" title={title}>
          {title}
        </span>
        {!closed && actions}
      </div>
      {!closed && children}
    </div>
  );
}

function ProjectFiles() {
  const project = useProject((s) => s.project);
  const front = useWorkspace((s) => !s.activeDoc && !s.home);
  if (!project) return null;
  return (
    <div data-testid="file-list">
      {project.files.map((f) => (
        <div key={f.id} className={`nav-row tree-row ${front && project.activeFileId === f.id ? 'active' : ''}`} role="button" tabIndex={0} onClick={() => focusProject(f.id)} onKeyDown={(e) => e.key === 'Enter' && focusProject(f.id)} data-testid="file-row">
          <LangBadge lang={f.language} />
          <span className="ellipsis grow">{f.name}</span>
          {f.mode === 'code' && <span className="dot warn" title={t('file.codeMode')} />}
          <span className="trail" onClick={(e) => e.stopPropagation()}>
            <MenuButton
              className="btn sm icon"
              title={t('common.more')}
              items={[
                { label: t('file.rename'), icon: 'edit', onSelect: () => void renameFileDialog(f.id) },
                { label: t('file.delete'), icon: 'trash', danger: true, onSelect: () => void deleteFileDialog(f.id) },
              ]}
            >
              <Icon name="more" />
            </MenuButton>
          </span>
        </div>
      ))}
    </div>
  );
}

function NewFileMenu() {
  const groups: [string, LanguageId[]][] = [
    [t('lang.groupGeneral'), IMPERATIVE_LANGUAGES],
    [t('lang.groupOther'), LANGUAGE_IDS.filter((l) => !IMPERATIVE_LANGUAGES.includes(l))],
  ];
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <MenuButton
        className="btn sm icon"
        title={t('file.new')}
        testId="new-file"
        items={groups.flatMap(([label, langs], gi) => [...(gi ? [{ label: '', separator: true }] : []), { label, disabled: true }, ...langs.map((l) => ({ label: LANGUAGES[l].name, hint: `.${LANGUAGES[l].ext}`, onSelect: () => void addFileDialog(l) }))])}
      >
        <Icon name="filePlus" size={14} />
      </MenuButton>
    </span>
  );
}

export function Sidebar() {
  const collapsed = useSettings((s) => s.layout.sidebarCollapsed);
  const rightTab = useSettings((s) => s.layout.rightTab);
  const rightOpen = useSettings((s) => s.layout.rightOpen);
  const view = useUi((s) => s.sidebarView);
  const dirty = useProject((s) => s.dirty);
  const hasProject = useProject((s) => !!s.project);
  const projectName = useProject((s) => s.project?.name);
  const folder = useWorkspace((s) => s.folder);
  const home = useWorkspace((s) => s.home);
  const canSearch = hasProject || !!folder;
  const openRight = (tab: RightTab) => useSettings.getState().update({ layout: { rightOpen: !(rightOpen && rightTab === tab), rightTab: tab } });
  const toggle = () => useSettings.getState().update({ layout: { sidebarCollapsed: !collapsed } });

  if (collapsed) {
    return (
      <div className="bf-sidebar rail" data-testid="sidebar-rail">
        <div className="bf-brand" style={{ padding: 0, justifyContent: 'center' }}>
          <button className="btn icon rail-btn" onClick={goHome} title={t('cmd.home')} data-testid="rail-home">
            <Logo size={22} />
          </button>
        </div>
        <button className="btn icon rail-btn" onClick={toggle} title={t('cmd.toggleSidebar')} data-testid="sidebar-expand">
          <Icon name="sidebar" />
        </button>
        <button className="btn icon rail-btn" title={t('cmd.newProject')} onClick={() => runCommand('new')}>
          <Icon name="plus" />
        </button>
        <button className="btn icon rail-btn" title={t('cmd.projects')} onClick={() => runCommand('projects')}>
          <Icon name="files" />
        </button>
        <button
          className="btn icon rail-btn"
          title={t('cmd.search')}
          onClick={() => {
            toggle();
            useUi.setState({ sidebarView: 'search' });
          }}
        >
          <Icon name="search" />
        </button>
        {NAV.map((n) => (
          <button key={n.tab} className={`btn icon rail-btn ${rightOpen && rightTab === n.tab ? 'on' : ''}`} title={t(`right.${n.tab}`)} onClick={() => openRight(n.tab)}>
            <Icon name={n.icon} />
          </button>
        ))}
        <span className="grow" />
        <button className="btn icon rail-btn" title={t('cmd.settings')} onClick={() => runCommand('settings')} style={{ marginBottom: 8 }}>
          <Icon name="settings" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="bf-brand" data-tauri-drag-region>
        <button className="bf-brand-home" onClick={goHome} title={t('cmd.home')} data-testid="brand-home">
          <Logo size={22} />
          <span>BlockForge</span>
        </button>
        <span className="grow" data-tauri-drag-region />
        <button className="btn sm icon" onClick={toggle} title={`${t('cmd.toggleSidebar')} (${formatKeys('Mod+\\')})`} data-testid="sidebar-collapse">
          <Icon name="sidebar" />
        </button>
      </div>
      <div className="bf-sidebar-section">
        <button className="btn sm outline" style={{ justifyContent: 'flex-start', height: 32 }} onClick={() => runCommand('new')} data-testid="new-project">
          <Icon name="plus" />
          {t('cmd.newProject')}
          <span className="kbd" style={{ marginLeft: 'auto' }}>
            {formatKeys('Mod+N')}
          </span>
        </button>
        <button className={`nav-row ${home ? 'active' : ''}`} onClick={goHome} data-testid="nav-home">
          <Icon name="home" />
          <span className="grow">{t('cmd.home')}</span>
        </button>
        <button className="nav-row" onClick={() => runCommand('projects')} data-testid="open-projects">
          <Icon name="files" />
          <span className="grow">{t('cmd.projects')}</span>
        </button>
        <button className="nav-row" onClick={() => runCommand('examples')} data-testid="open-examples">
          <Icon name="book" />
          <span className="grow">{t('cmd.examples')}</span>
        </button>
        <button className={`nav-row ${view === 'search' ? 'active' : ''}`} onClick={() => useUi.setState({ sidebarView: view === 'search' ? 'files' : 'search' })} disabled={!canSearch} data-testid="open-search">
          <Icon name="search" />
          <span className="grow">{t('cmd.search')}</span>
        </button>
        <button className="nav-row" onClick={() => runCommand('palette')}>
          <Icon name="command" />
          <span className="grow">{t('cmd.palette')}</span>
          <span className="kbd">{formatKeys('Mod+K')}</span>
        </button>
      </div>
      {view === 'search' && canSearch ? (
        <>
          <div className="bf-sidebar-label">{t('cmd.search')}</div>
          <SearchView />
        </>
      ) : (
        <div className="scroll grow side-sections" data-testid="side-sections">
          <Section id="panels" title={t('sidebar.panels')}>
            <div className="bf-sidebar-section">
              {NAV.map((n) => (
                <button key={n.tab} className={`nav-row ${rightOpen && rightTab === n.tab ? 'active' : ''}`} onClick={() => openRight(n.tab)} data-testid={`nav-${n.tab}`}>
                  <Icon name={n.icon} />
                  <span className="grow">{t(`right.${n.tab}`)}</span>
                </button>
              ))}
            </div>
          </Section>
          {hasProject && (
            <Section id="project" title={projectName ?? ''} actions={<NewFileMenu />} testId="project-section">
              <div className="bf-sidebar-section">
                <ProjectFiles />
              </div>
            </Section>
          )}
          <Section id="explorer" title={folder ? folder.name : t('explorer.noFolder')} actions={<ExplorerActions />} testId="explorer-section">
            <div className="bf-sidebar-section">
              <Explorer />
            </div>
          </Section>
        </div>
      )}
      <div className="bf-sidebar-section" style={{ padding: 8, flex: 'none' }}>
        <button className="nav-row" onClick={() => runCommand('settings')} data-testid="open-settings">
          <Icon name="settings" />
          <span className="grow">{t('cmd.settings')}</span>
          {hasProject && <span className={`dot ${dirty ? 'warn' : 'ok'}`} title={dirty ? t('project.unsaved') : t('project.allSaved')} data-testid="save-state" />}
        </button>
      </div>
    </>
  );
}
