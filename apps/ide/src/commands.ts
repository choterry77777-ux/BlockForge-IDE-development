import { blockEditors } from './blockly/BlocklyPane';
import { addFileDialog, convertCodeToBlocks, duplicateCurrent, exportActiveFile, exportZip, importSourceFile, openProjectFile, renameProject, saveProject, saveProjectAs } from './actions';
import { clearChat, fixWithAi } from './ai/engine';
import { t } from './i18n';
import { runActive, stopRun } from './runtime/runner';
import { activeFile, useProject } from './state/project';
import { type RightTab, useSettings } from './state/settings';
import { useUi } from './state/ui';
import { activeDoc, goHome, newDoc, openFileDialog, openFolder, runTarget, saveDoc } from './state/workspace';
import { cloneRepository } from './terminal/clone';
import { openShell } from './terminal/sessions';

export interface Command {
  id: string;
  /** Translation key of the title. */
  title: string;
  icon?: string;
  /** Shortcut in "Mod+Shift+K" form; Mod is Command on macOS and Control elsewhere. */
  keys?: string;
  /** Requires an open project; 'target' also accepts a text tab that can run. */
  project?: boolean | 'target';
  run: () => void | Promise<void>;
}

const layout = () => useSettings.getState().layout;
const setLayout = (patch: Partial<ReturnType<typeof layout>>) => useSettings.getState().update({ layout: patch });
const right = (tab: RightTab) => () => setLayout({ rightOpen: true, rightTab: tab });

export const COMMANDS: Command[] = [
  { id: 'palette', title: 'cmd.palette', icon: 'command', keys: 'Mod+K', run: () => useUi.getState().open('palette') },
  { id: 'run', title: 'cmd.run', icon: 'play', keys: 'Mod+Enter', project: 'target', run: () => runActive('run') },
  { id: 'stop', title: 'cmd.stop', icon: 'stop', keys: 'Mod+.', project: 'target', run: stopRun },
  { id: 'build', title: 'cmd.build', icon: 'build', keys: 'Mod+B', project: 'target', run: () => runActive('build') },
  { id: 'rebuild', title: 'cmd.rebuild', icon: 'rebuild', project: 'target', run: () => runActive('rebuild') },
  { id: 'clean', title: 'cmd.clean', icon: 'clean', project: 'target', run: () => runActive('clean') },
  { id: 'check', title: 'cmd.check', icon: 'check', project: 'target', run: () => runActive('check') },
  { id: 'runBuiltin', title: 'cmd.runBuiltin', icon: 'play', project: 'target', run: () => runActive('run', 'builtin') },
  { id: 'new', title: 'cmd.newProject', icon: 'plus', keys: 'Mod+N', run: () => useUi.getState().open('newProject') },
  { id: 'projects', title: 'cmd.projects', icon: 'files', keys: 'Mod+O', run: () => useUi.getState().open('projects') },
  { id: 'openFile', title: 'cmd.openProjectFile', icon: 'folderOpen', run: openProjectFile },
  // Save acts on the tab in front: a text tab saves its file, otherwise the project is saved.
  { id: 'save', title: 'cmd.save', icon: 'save', keys: 'Mod+S', run: () => (activeDoc() ? void saveDoc(activeDoc()!.id) : useProject.getState().project ? saveProject() : undefined) },
  { id: 'saveAs', title: 'cmd.saveAs', icon: 'save', keys: 'Mod+Shift+S', run: () => (activeDoc() ? void saveDoc(activeDoc()!.id, true) : useProject.getState().project ? saveProjectAs() : undefined) },
  { id: 'home', title: 'cmd.home', icon: 'home', run: goHome },
  { id: 'newText', title: 'cmd.newText', icon: 'filePlus', keys: 'Mod+T', run: () => void newDoc() },
  { id: 'openTextFile', title: 'cmd.openTextFile', icon: 'file', run: openFileDialog },
  { id: 'openFolder', title: 'explorer.open', icon: 'folder', keys: 'Mod+Shift+O', run: openFolder },
  { id: 'cloneRepo', title: 'explorer.clone', icon: 'download', run: cloneRepository },
  { id: 'terminal', title: 'cmd.terminal', icon: 'terminal', keys: 'Mod+Shift+J', run: () => setLayout({ dockOpen: true, dockTab: 'terminal' }) },
  { id: 'newTerminal', title: 'term.new', icon: 'terminal', run: () => void openShell() },
  { id: 'exportZip', title: 'cmd.exportZip', icon: 'download', project: true, run: () => exportZip() },
  { id: 'exportFile', title: 'cmd.exportFile', icon: 'download', project: true, run: exportActiveFile },
  { id: 'importSource', title: 'cmd.importSource', icon: 'import', run: importSourceFile },
  { id: 'duplicate', title: 'cmd.duplicate', icon: 'copy', project: true, run: duplicateCurrent },
  { id: 'rename', title: 'cmd.renameProject', icon: 'edit', project: true, run: renameProject },
  { id: 'newFile', title: 'cmd.newFile', icon: 'filePlus', project: true, run: () => addFileDialog(activeFile()?.language ?? 'python') },
  { id: 'examples', title: 'cmd.examples', icon: 'book', run: () => useUi.getState().open('examples') },
  { id: 'toBlocks', title: 'cmd.codeToBlocks', icon: 'blocks', project: true, run: convertCodeToBlocks },
  { id: 'viewBlocks', title: 'cmd.viewBlocks', icon: 'blocks', keys: 'Mod+1', project: true, run: () => setLayout({ view: 'blocks' }) },
  { id: 'viewSplit', title: 'cmd.viewSplit', icon: 'split', keys: 'Mod+2', project: true, run: () => setLayout({ view: 'split' }) },
  { id: 'viewCode', title: 'cmd.viewCode', icon: 'code', keys: 'Mod+3', project: true, run: () => setLayout({ view: 'code' }) },
  { id: 'toggleSidebar', title: 'cmd.toggleSidebar', icon: 'sidebar', keys: 'Mod+\\', run: () => setLayout({ sidebarCollapsed: !layout().sidebarCollapsed }) },
  { id: 'toggleRight', title: 'cmd.toggleRight', icon: 'panelRight', keys: 'Mod+Shift+\\', run: () => setLayout({ rightOpen: !layout().rightOpen }) },
  { id: 'toggleDock', title: 'cmd.toggleDock', icon: 'panelBottom', keys: 'Mod+J', run: () => setLayout({ dockOpen: !layout().dockOpen }) },
  { id: 'assistant', title: 'cmd.assistant', icon: 'sparkle', keys: 'Mod+L', run: right('assistant') },
  { id: 'compare', title: 'cmd.compare', icon: 'compare', project: true, run: right('compare') },
  { id: 'preview', title: 'cmd.preview', icon: 'eye', project: true, run: right('preview') },
  { id: 'browser', title: 'cmd.browser', icon: 'globe', run: right('browser') },
  { id: 'tools', title: 'cmd.tools', icon: 'tools', run: right('tools') },
  { id: 'packages', title: 'cmd.packages', icon: 'package', project: true, run: right('packages') },
  { id: 'toolchains', title: 'cmd.toolchains', icon: 'toolchain', run: right('toolchains') },
  { id: 'fix', title: 'cmd.fixWithAi', icon: 'wand', project: true, run: fixWithAi },
  { id: 'clearChat', title: 'cmd.clearChat', icon: 'trash', run: clearChat },
  { id: 'search', title: 'cmd.search', icon: 'search', keys: 'Mod+Shift+F', project: true, run: () => {
      useSettings.getState().update({ layout: { sidebarCollapsed: false } });
      useUi.setState({ sidebarView: 'search' });
    },
  },
  { id: 'undoBlocks', title: 'cmd.undoBlocks', icon: 'undo', project: true, run: () => blockEditors.get(activeFile()?.id ?? '')?.undo(false) },
  { id: 'redoBlocks', title: 'cmd.redoBlocks', icon: 'redo', project: true, run: () => blockEditors.get(activeFile()?.id ?? '')?.undo(true) },
  { id: 'settings', title: 'cmd.settings', icon: 'settings', keys: 'Mod+,', run: () => useUi.getState().open('settings', 'general') },
  { id: 'shortcuts', title: 'cmd.shortcuts', icon: 'command', run: () => useUi.getState().open('shortcuts') },
  { id: 'themeLight', title: 'cmd.themeLight', icon: 'eye', run: () => useSettings.getState().update({ theme: 'light' }) },
  { id: 'themeDark', title: 'cmd.themeDark', icon: 'eye', run: () => useSettings.getState().update({ theme: 'dark' }) },
  { id: 'themeSystem', title: 'cmd.themeSystem', icon: 'eye', run: () => useSettings.getState().update({ theme: 'system' }) },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function formatKeys(keys: string): string {
  return keys
    .split('+')
    .map((k) => (k === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : k === 'Shift' ? (isMac ? '⇧' : 'Shift') : k === 'Alt' ? (isMac ? '⌥' : 'Alt') : k === 'Enter' ? (isMac ? '↩' : 'Enter') : k))
    .join(isMac ? '' : '+');
}

function matches(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.split('+');
  const key = parts[parts.length - 1];
  const mod = parts.includes('Mod');
  if (mod !== (isMac ? e.metaKey : e.ctrlKey)) return false;
  if (parts.includes('Shift') !== e.shiftKey) return false;
  if (parts.includes('Alt') !== e.altKey) return false;
  return e.key.toLowerCase() === key.toLowerCase() || (key === '\\' && e.code === 'Backslash') || (/^\d$/.test(key) && e.code === `Digit${key}`);
}

export function runCommand(id: string): void {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) return;
  if (cmd.project === 'target' ? !runTarget() : cmd.project && !useProject.getState().project) {
    useUi.getState().toast(t('cmd.needsProject'), 'info');
    return;
  }
  void cmd.run();
}

/** Global keyboard shortcuts. */
export function installShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    for (const cmd of COMMANDS) {
      if (cmd.keys && matches(e, cmd.keys)) {
        e.preventDefault();
        e.stopPropagation();
        runCommand(cmd.id);
        return;
      }
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
