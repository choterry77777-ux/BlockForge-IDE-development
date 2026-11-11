import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initPlatform } from './platform';
import './styles/app.css';

async function start() {
  await initPlatform();
  if (import.meta.env.DEV) {
    // Handles for automated UI tests; not present in production builds.
    const [project, settings, ai, run, blocks, commands, ui, workspace, platform, terminals] = await Promise.all([import('./state/project'), import('./state/settings'), import('./ai/engine'), import('./state/run'), import('./blockly/BlocklyPane'), import('./commands'), import('./state/ui'), import('./state/workspace'), import('./platform'), import('./terminal/sessions')]);
    (window as unknown as { __bf: unknown }).__bf = { useProject: project.useProject, useSettings: settings.useSettings, useAi: ai.useAi, useRun: run.useRun, useUi: ui.useUi, blockEditors: blocks.blockEditors, runCommand: commands.runCommand, useWorkspace: workspace.useWorkspace, workspace, platform: platform.getPlatform(), terminals, refreshKeys: ai.refreshKeys };
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // Only acts when the desktop app was started for a self-test.
  void import('./selftest').then((m) => setTimeout(() => void m.maybeSelfTest(), 1500));
}

void start();
