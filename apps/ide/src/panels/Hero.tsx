import { IMPERATIVE_LANGUAGES, LANGUAGE_IDS, LANGUAGES } from '@blockforge/core';
import { createNewProject, deleteProject, importSourceFile, openProjectFile } from '../actions';
import { formatKeys, runCommand } from '../commands';
import { Icon, Logo } from '../components/Icon';
import { t } from '../i18n';
import { openStored, useProject } from '../state/project';
import { getPlatform } from '../platform';
import { useSettings } from '../state/settings';
import { leaveHome, newDoc, openFileDialog, openFolder, useWorkspace } from '../state/workspace';
import { LangBadge } from './Sidebar';

/** Blank home: pick a language to start, or reopen something recent. */
export function Hero() {
  const recent = useProject((s) => s.recent);
  const collapsed = useSettings((s) => s.layout.sidebarCollapsed);
  // Both hooks run on every render; only their results are combined.
  const hasProject = useProject((s) => !!s.project);
  const hasDocs = useWorkspace((s) => s.docs.length > 0);
  const hasOpen = hasProject || hasDocs;
  const desktop = getPlatform().workspace.available;
  return (
    <div className="bf-main" data-testid="hero">
      <div className="bf-header drag" data-tauri-drag-region>
        {collapsed && <span style={{ width: 'var(--rail-header-gap, 4px)', flex: 'none' }} />}
        <span className="grow" data-tauri-drag-region />
        {hasOpen && (
          <button className="btn sm outline" onClick={leaveHome} data-testid="back-to-editor">
            <Icon name="arrowLeft" size={14} />
            {t('hero.back')}
          </button>
        )}
      </div>
      <div className="scroll grow">
        <div className="hero" style={{ minHeight: '100%', height: 'auto' }}>
          <Logo size={44} />
          <h1>{t('hero.title')}</h1>
          <div className="muted" style={{ maxWidth: 520 }}>
            {t('hero.subtitle')}
          </div>
          <div className="lang-grid" data-testid="language-grid">
            {[...IMPERATIVE_LANGUAGES, ...LANGUAGE_IDS.filter((l) => !IMPERATIVE_LANGUAGES.includes(l))].map((l) => (
              <button key={l} className="lang-tile" onClick={() => void createNewProject(l)} data-testid={`start-${l}`}>
                <LangBadge lang={l} />
                <span className="ellipsis">{LANGUAGES[l].name}</span>
              </button>
            ))}
          </div>
          <div className="row gap-6 wrap" style={{ justifyContent: 'center' }}>
            <button className="btn sm outline" onClick={() => newDoc()} data-testid="hero-new-text">
              <Icon name="filePlus" size={14} />
              {t('cmd.newText')}
            </button>
            <button className="btn sm outline" onClick={() => void openFolder()} disabled={!desktop} title={desktop ? undefined : t('explorer.desktopOnly')} data-testid="hero-open-folder">
              <Icon name="folder" size={14} />
              {t('explorer.open')}
            </button>
            <button className="btn sm outline" onClick={() => void openFileDialog()} data-testid="hero-open-file">
              <Icon name="file" size={14} />
              {t('cmd.openTextFile')}
            </button>
            <button className="btn sm outline" onClick={() => runCommand('examples')}>
              <Icon name="book" size={14} />
              {t('cmd.examples')}
            </button>
            <button className="btn sm outline" onClick={() => void openProjectFile()}>
              <Icon name="folderOpen" size={14} />
              {t('cmd.openProjectFile')}
            </button>
            <button className="btn sm outline" onClick={() => void importSourceFile()}>
              <Icon name="import" size={14} />
              {t('cmd.importSource')}
            </button>
            <button className="btn sm outline" onClick={() => runCommand('palette')}>
              <Icon name="command" size={14} />
              {t('cmd.palette')}
              <span className="kbd">{formatKeys('Mod+K')}</span>
            </button>
          </div>
          {recent.length > 0 && (
            <div className="col gap-4" style={{ width: 'min(520px, 100%)', textAlign: 'left' }}>
              <div className="bf-sidebar-label" style={{ padding: '8px 10px 2px' }}>
                {t('hero.recent')}
              </div>
              {recent.slice(0, 6).map((p) => (
                <div key={p.id} className="list-row click" role="button" tabIndex={0} onClick={() => void openStored(p.id)} onKeyDown={(e) => e.key === 'Enter' && void openStored(p.id)} data-testid="recent-project">
                  <Icon name="files" />
                  <span className="grow ellipsis">{p.name}</span>
                  <span className="faint small">{p.languages.map((l) => LANGUAGES[l as keyof typeof LANGUAGES]?.name ?? l).join(', ')}</span>
                  <span className="faint small">{new Date(p.updatedAt).toLocaleDateString()}</span>
                  <button
                    className="btn sm icon"
                    title={t('common.delete')}
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
          )}
        </div>
      </div>
    </div>
  );
}
