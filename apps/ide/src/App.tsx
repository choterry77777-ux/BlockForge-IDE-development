import { useEffect } from 'react';
import { checkRecovery } from './actions';
import { refreshKeys } from './ai/engine';
import { installShortcuts } from './commands';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfirmHost, SplitHandle, Toasts } from './components/ui';
import { matchLocale, setLocale, useLocale } from './i18n';
import { getPlatform } from './platform';
import { CommandPalette, ExamplesDialog, NewProjectDialog, ProjectsDialog, ShortcutsDialog } from './panels/Dialogs';
import { EditorArea } from './panels/EditorArea';
import { Hero } from './panels/Hero';
import { RightPanel } from './panels/RightPanel';
import { SettingsDialog } from './panels/SettingsDialog';
import { Sidebar } from './panels/Sidebar';
import { detectToolchains } from './runtime/runner';
import { useProject } from './state/project';
import { resolveTheme, useSettings } from './state/settings';
import { useUi } from './state/ui';
import { restoreWorkspace, useWorkspace } from './state/workspace';

export function App() {
  useLocale();
  const hasProject = useProject((s) => !!s.project);
  const hasDocs = useWorkspace((s) => s.docs.length > 0);
  const home = useWorkspace((s) => s.home);
  // The home screen shows when asked for, and when nothing is open.
  const showHome = home || (!hasProject && !hasDocs);
  const layout = useSettings((s) => s.layout);
  const theme = useSettings((s) => s.theme);
  const locale = useSettings((s) => s.locale);
  const dialog = useUi((s) => s.dialog);
  const setLayout = (patch: Partial<typeof layout>) => useSettings.getState().update({ layout: patch });

  useEffect(() => {
    const apply = () => document.documentElement.setAttribute('data-theme', resolveTheme(theme));
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    void setLocale(locale === 'auto' ? matchLocale(navigator.language) : locale);
  }, [locale]);

  useEffect(() => {
    const off = installShortcuts();
    void useProject.getState().refreshRecent();
    void refreshKeys();
    void detectToolchains();
    void checkRecovery();
    void restoreWorkspace();
    // The macOS title bar overlays the window, so the top row leaves room for its controls.
    if (getPlatform().kind === 'desktop' && getPlatform().os === 'macos') {
      document.documentElement.style.setProperty('--titlebar-clearance', '28px');
      // With the sidebar collapsed, the header starts under the window controls.
      document.documentElement.style.setProperty('--rail-header-gap', '28px');
    }
    return off;
  }, []);

  // Narrow windows collapse the sidebar on their own.
  useEffect(() => {
    const check = () => {
      const l = useSettings.getState().layout;
      if (window.innerWidth < 1024 && !l.sidebarCollapsed) setLayout({ sidebarCollapsed: true });
      // The centre keeps at least 420px: the side panel narrows first, then closes.
      const side = window.innerWidth < 1024 || l.sidebarCollapsed ? 56 : l.sidebarWidth;
      const room = window.innerWidth - side - 420;
      if (l.rightOpen && room < 300) setLayout({ rightOpen: false });
      else if (l.rightOpen && l.rightWidth > room) setLayout({ rightWidth: Math.max(300, room) });
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxRight = Math.max(300, Math.round(window.innerWidth * 0.7));
  return (
    <div className="bf-app" data-testid="app">
      <div className={`bf-sidebar${layout.sidebarCollapsed ? ' rail' : ''}`} style={layout.sidebarCollapsed ? undefined : { width: layout.sidebarWidth }}>
        <Sidebar />
      </div>
      {!layout.sidebarCollapsed && <SplitHandle axis="x" onDrag={(dx) => setLayout({ sidebarWidth: Math.min(420, Math.max(264, useSettings.getState().layout.sidebarWidth + dx)) })} />}
      <ErrorBoundary resetKey={showHome ? 'home' : 'editor'}>{showHome ? <Hero /> : <EditorArea />}</ErrorBoundary>
      {layout.rightOpen && (
        <>
          <SplitHandle axis="x" onDrag={(dx) => setLayout({ rightWidth: Math.min(maxRight, Math.max(300, useSettings.getState().layout.rightWidth - dx)) })} />
          <div className="bf-right" style={{ width: Math.min(layout.rightWidth, maxRight) }}>
            <ErrorBoundary compact resetKey={layout.rightTab}>
              <RightPanel />
            </ErrorBoundary>
          </div>
        </>
      )}
      <ErrorBoundary compact resetKey={dialog ?? 'none'}>
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'projects' && <ProjectsDialog />}
      {dialog === 'newProject' && <NewProjectDialog />}
      {dialog === 'examples' && <ExamplesDialog />}
      {dialog === 'palette' && <CommandPalette />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      </ErrorBoundary>
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
