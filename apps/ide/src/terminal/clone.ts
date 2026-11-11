import { t } from '../i18n';
import { getPlatform } from '../platform';
import { promptDialog, useUi } from '../state/ui';
import { joinPath, openRecentFolder } from '../state/workspace';
import { runTask } from './sessions';

/** Addresses git can clone: https, ssh and the scp-like form. No option-like or shell text. */
export function validRepositoryUrl(url: string): boolean {
  if (url.length > 400 || url.startsWith('-')) return false;
  return /^(https:\/\/|ssh:\/\/|git:\/\/)[A-Za-z0-9._~:/@%+-]+$/.test(url) || /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/%+-]+$/.test(url);
}

export function repositoryName(url: string): string {
  const last = url.replace(/[/:]+$/, '').split(/[/:]/).pop() ?? 'repository';
  return last.replace(/\.git$/i, '') || 'repository';
}

/** Clone a repository into a folder the user picks, then open it. */
export async function cloneRepository(): Promise<void> {
  const platform = getPlatform();
  if (!platform.workspace.available || !platform.terminal.available) return;
  const url = (await promptDialog({ title: t('explorer.cloneTitle'), message: t('explorer.cloneMessage'), placeholder: 'https://github.com/owner/repository.git', confirmLabel: t('explorer.cloneNext') }))?.trim();
  if (!url) return;
  if (!validRepositoryUrl(url)) {
    useUi.getState().toast(t('explorer.cloneBadUrl'), 'err');
    return;
  }
  // The destination is chosen in the system dialog; the clone becomes a folder inside it.
  const parent = await platform.workspace.pickFolder();
  if (!parent) return;
  const name = repositoryName(url);
  try {
    const result = await runTask(`git clone -- '${url}' '${name}'`, { cwd: parent.path, title: `git clone ${name}`, timeoutMs: 15 * 60_000 });
    if (result.code === 0) {
      await openRecentFolder(joinPath(parent.path, name));
      useUi.getState().toast(t('explorer.cloned', { name }), 'ok');
    } else {
      useUi.getState().toast(t('explorer.cloneFailed'), 'err');
    }
  } catch (err) {
    useUi.getState().toast(String((err as Error)?.message ?? err), 'err');
  }
}
