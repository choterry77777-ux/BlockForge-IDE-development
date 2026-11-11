import { Icon } from '../components/Icon';
import { MenuButton } from '../components/ui';
import { t } from '../i18n';
import { getPlatform } from '../platform';
import type { FsEntry } from '../platform/types';
import { useUi } from '../state/ui';
import { activeDoc, closeFolder, createEntry, openFolder, openPath, openRecentFolder, refreshTree, renameEntry, toggleDir, trashEntry, useWorkspace } from '../state/workspace';
import { cloneRepository } from '../terminal/clone';
import { openShell } from '../terminal/sessions';

function EntryRow({ entry, depth }: { entry: FsEntry; depth: number }) {
  const open = useWorkspace((s) => !!s.expanded[entry.path]);
  const children = useWorkspace((s) => s.tree[entry.path]);
  const current = useWorkspace((s) => activeDoc(s)?.path === entry.path);
  const activate = () => (entry.dir ? void toggleDir(entry.path) : void openPath(entry.path));
  return (
    <>
      <div
        className={`nav-row tree-row ${current ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        role="treeitem"
        aria-expanded={entry.dir ? open : undefined}
        tabIndex={0}
        title={entry.path}
        onClick={activate}
        onKeyDown={(e) => e.key === 'Enter' && activate()}
        data-testid="tree-row"
      >
        {entry.dir ? <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="faint" /> : <span style={{ width: 12, flex: 'none' }} />}
        <Icon name={entry.dir ? (open ? 'folderOpen' : 'folder') : 'file'} size={14} className="faint" />
        <span className="ellipsis grow">{entry.name}</span>
        <span className="trail" onClick={(e) => e.stopPropagation()}>
          <MenuButton
            className="btn sm icon"
            title={t('common.more')}
            items={[
              ...(entry.dir
                ? [
                    { label: t('explorer.newFile'), icon: 'filePlus', onSelect: () => void createEntry(entry.path, false) },
                    { label: t('explorer.newFolder'), icon: 'folderPlus', onSelect: () => void createEntry(entry.path, true) },
                    { label: t('explorer.openTerminal'), icon: 'terminal', onSelect: () => void openShell(entry.path) },
                    { label: '', separator: true },
                  ]
                : []),
              { label: t('explorer.rename'), icon: 'edit', onSelect: () => void renameEntry(entry) },
              { label: t('explorer.reveal'), icon: 'external', onSelect: () => void getPlatform().workspace.reveal(entry.path) },
              {
                label: t('explorer.copyPath'),
                icon: 'copy',
                onSelect: () => {
                  void navigator.clipboard.writeText(entry.path);
                  useUi.getState().toast(t('common.copied'), 'ok');
                },
              },
              { label: '', separator: true },
              { label: t('explorer.moveToTrash'), icon: 'trash', danger: true, onSelect: () => void trashEntry(entry) },
            ]}
          >
            <Icon name="more" />
          </MenuButton>
        </span>
      </div>
      {entry.dir && open && (children ? children.map((c) => <EntryRow key={c.path} entry={c} depth={depth + 1} />) : <div className="faint small" style={{ padding: `4px 12px 4px ${32 + depth * 12}px` }}>{t('common.loading')}</div>)}
      {entry.dir && open && children?.length === 0 && (
        <div className="faint small" style={{ padding: `4px 12px 4px ${32 + depth * 12}px` }}>
          {t('explorer.emptyFolder')}
        </div>
      )}
    </>
  );
}

/** Actions shown next to the folder name. */
export function ExplorerActions() {
  const folder = useWorkspace((s) => s.folder);
  if (!folder) return null;
  return (
    <span className="row gap-4" onClick={(e) => e.stopPropagation()}>
      <button className="btn sm icon" title={t('explorer.newFile')} onClick={() => void createEntry(folder.path, false)} data-testid="explorer-new-file">
        <Icon name="filePlus" size={14} />
      </button>
      <button className="btn sm icon" title={t('explorer.newFolder')} onClick={() => void createEntry(folder.path, true)}>
        <Icon name="folderPlus" size={14} />
      </button>
      <button className="btn sm icon" title={t('explorer.refresh')} onClick={() => void refreshTree()}>
        <Icon name="refresh" size={14} />
      </button>
      <MenuButton
        className="btn sm icon"
        title={t('common.more')}
        items={[
          { label: t('explorer.openTerminal'), icon: 'terminal', onSelect: () => void openShell(folder.path) },
          { label: t('explorer.reveal'), icon: 'external', onSelect: () => void getPlatform().workspace.reveal(folder.path) },
          { label: t('explorer.openOther'), icon: 'folderOpen', onSelect: () => void openFolder() },
          { label: '', separator: true },
          { label: t('explorer.close'), icon: 'x', onSelect: closeFolder },
        ]}
      >
        <Icon name="more" />
      </MenuButton>
    </span>
  );
}

/** The folder tree, or the invitation to open a folder. */
export function Explorer() {
  const folder = useWorkspace((s) => s.folder);
  const root = useWorkspace((s) => (s.folder ? s.tree[s.folder.path] : undefined));
  const recent = useWorkspace((s) => s.recentFolders);
  const available = getPlatform().workspace.available;

  if (!folder) {
    return (
      <div className="explorer-empty" data-testid="explorer-empty">
        <div>{t('explorer.none')}</div>
        <button className="btn sm primary block" onClick={() => void openFolder()} disabled={!available} data-testid="open-folder">
          {t('explorer.open')}
        </button>
        <div>{t('explorer.cloneHint')}</div>
        <button className="btn sm outline block" onClick={() => void cloneRepository()} disabled={!available} data-testid="clone-repo">
          {t('explorer.clone')}
        </button>
        {!available && <div className="faint small">{t('explorer.desktopOnly')}</div>}
        {available && recent.length > 0 && (
          <div className="col" style={{ gap: 0, marginTop: 4 }}>
            <div className="faint small" style={{ padding: '2px 0 4px' }}>
              {t('explorer.recent')}
            </div>
            {recent.slice(0, 5).map((r) => (
              <button key={r.path} className="nav-row" style={{ margin: '0 -8px' }} title={r.path} onClick={() => void openRecentFolder(r.path)} data-testid="recent-folder">
                <Icon name="folder" size={14} className="faint" />
                <span className="ellipsis grow">{r.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div role="tree" data-testid="explorer-tree">
      {root === undefined && <div className="faint small" style={{ padding: '6px 20px' }}>{t('common.loading')}</div>}
      {root?.length === 0 && <div className="faint small" style={{ padding: '6px 20px' }}>{t('explorer.emptyFolder')}</div>}
      {root?.map((e) => <EntryRow key={e.path} entry={e} depth={0} />)}
    </div>
  );
}
