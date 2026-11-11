import { buildPlan, type DependencyRef, LANGUAGES, managersFor, type PackageHit, type PackageManager, parseToolOutput, validDependency } from '@blockforge/core';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Switch } from '../components/ui';
import { t } from '../i18n';
import { getPlatform } from '../platform';
import { detectToolchains, toolchainFound } from '../runtime/runner';
import { activeFile, useProject } from '../state/project';
import { useRun } from '../state/run';
import { useSettings } from '../state/settings';
import { confirmDialog, useUi } from '../state/ui';

const NO_DEPENDENCIES: DependencyRef[] = [];

/** Run a package manager command in the project work directory and stream its log. */
async function runManager(m: PackageManager, cmd: { tool: string; args: string[]; env?: Record<string, string> }, log: (s: string) => void): Promise<boolean> {
  const platform = getPlatform();
  const project = useProject.getState().project!;
  const file = activeFile()!;
  // The manifest and sources must exist before the manager runs.
  const plan = buildPlan({ language: file.language, entry: file.name, platform: platform.os, projectName: project.name, dependencies: project.dependencies });
  await platform.writeWorkFiles(project.id, [...project.files.map((f) => ({ path: f.name, content: f.code })), ...plan.configFiles.map((f) => ({ path: f.path, content: f.content }))]);
  const detected = useRun.getState().toolchains.find((x) => x.id === cmd.tool);
  log(`$ ${cmd.tool} ${cmd.args.join(' ')}\n`);
  const handle = await platform.spawn({ projectId: project.id, tool: detected?.path ?? cmd.tool, args: cmd.args, env: cmd.env, timeoutMs: 300000, maxOutputBytes: 2_000_000 }, (_s, text) => log(text));
  const exit = await handle.done;
  void m;
  return exit.code === 0;
}

export function PackagesPane() {
  const file = useProject((s) => activeFile(s));
  // A selector must return the same value for the same state; a fresh [] on every call would re-render forever.
  const deps = useProject((s) => s.project?.dependencies) ?? NO_DEPENDENCIES;
  const [managerId, setManagerId] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PackageHit[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [allowScripts, setAllowScripts] = useState(false);
  const [log, setLog] = useState('');
  const platform = getPlatform();
  const managers = file ? managersFor(file.language) : [];
  const manager = managers.find((m) => m.id === managerId) ?? managers[0];
  const mine = deps.filter((d) => d.manager === manager?.id);

  useEffect(() => {
    setHits([]);
    setError('');
    void detectToolchains();
  }, [manager?.id]);

  if (!file) return <div className="empty secondary">{t('packages.noProject')}</div>;
  if (!manager) {
    return (
      <div className="empty secondary" data-testid="packages-pane">
        <Icon name="package" size={22} />
        {t('packages.none', { name: LANGUAGES[file.language].name })}
      </div>
    );
  }
  const installed = toolchainFound(manager.tool);
  const append = (s: string) => setLog((cur) => (cur + s).slice(-20000));

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy('search');
    setError('');
    setHits([]);
    try {
      if (manager.searchUrl && manager.parseSearch) {
        const found = manager.parseSearch(JSON.parse(await platform.registryGet(manager.searchUrl(q), manager.headers)));
        setHits(found);
        if (!found.length) setError(t('packages.noResults'));
      } else if (manager.infoUrl && manager.parseInfo) {
        // Registries without a search API are asked for the exact name.
        const info = manager.parseInfo(JSON.parse(await platform.registryGet(manager.infoUrl(q), manager.headers)), q);
        if (info) setHits([{ name: info.name, version: info.latest, description: info.description }]);
        else setError(t('packages.noResults'));
      }
    } catch (err) {
      setError(platform.kind === 'web' ? t('packages.searchBlocked') : t('packages.searchFailed', { error: String((err as Error).message ?? err) }));
    } finally {
      setBusy('');
    }
  };

  const add = async (dep: DependencyRef) => {
    if (!validDependency(dep)) {
      useUi.getState().toast(t('packages.invalidName'), 'err');
      return;
    }
    const next = [...deps.filter((d) => !(d.manager === dep.manager && d.name === dep.name)), dep];
    if (platform.kind !== 'desktop' || !installed) {
      // Without the tool the dependency is only recorded in the project manifest.
      useProject.getState().setDependencies(next);
      useUi.getState().toast(t('packages.recorded'), 'info');
      return;
    }
    const cmd = manager.install(dep, { allowScripts });
    const ok = await confirmDialog({ title: t('packages.confirmTitle', { name: dep.name }), message: `${manager.risk} ${allowScripts ? t('packages.scriptsOn') : t('packages.scriptsOff')}`, detail: `${cmd.tool} ${cmd.args.join(' ')}`, confirmLabel: t('packages.install') });
    if (!ok) return;
    setBusy(dep.name);
    useProject.getState().setDependencies(next);
    try {
      const success = await runManager(manager, cmd, append);
      if (success) useUi.getState().toast(t('packages.installed', { name: dep.name }), 'ok');
      else {
        useProject.getState().setDependencies(deps);
        useUi.getState().toast(t('packages.failed', { name: dep.name }), 'err');
      }
    } catch (err) {
      useProject.getState().setDependencies(deps);
      append(`${String((err as Error).message ?? err)}\n`);
    } finally {
      setBusy('');
    }
  };

  const remove = async (dep: DependencyRef) => {
    const ok = await confirmDialog({ title: t('packages.removeTitle', { name: dep.name }), message: t('packages.removeMessage'), danger: true, confirmLabel: t('packages.remove') });
    if (!ok) return;
    useProject.getState().setDependencies(deps.filter((d) => !(d.manager === dep.manager && d.name === dep.name)));
    if (platform.kind === 'desktop' && installed && manager.uninstall) {
      setBusy(dep.name);
      try {
        await runManager(manager, manager.uninstall(dep), append);
      } catch (err) {
        append(`${String((err as Error).message ?? err)}\n`);
      } finally {
        setBusy('');
      }
    }
  };
  void parseToolOutput;
  void useSettings;

  return (
    <div className="col grow" data-testid="packages-pane">
      <div className="row pad-8 gap-6" style={{ borderBottom: 'var(--hairline) solid var(--border-2)', flex: 'none' }}>
        <select className="select sm" value={manager.id} onChange={(e) => setManagerId(e.target.value)} aria-label={t('packages.manager')}>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <form
          className="row grow gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input className="input sm grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={manager.searchUrl ? t('packages.search') : t('packages.exactName')} spellCheck={false} data-testid="package-query" />
          <button className="btn sm outline" type="submit" disabled={busy === 'search' || !query.trim()}>
            {busy === 'search' ? <span className="dot busy" /> : <Icon name="search" size={14} />}
          </button>
        </form>
      </div>
      <div className="scroll grow col gap-8 pad-8">
        {platform.kind === 'desktop' && !installed && <div className="notice warn">{t('packages.toolMissing', { name: manager.name })}</div>}
        {platform.kind === 'web' && <div className="notice info">{t('packages.webNote')}</div>}
        <div className="row" style={{ padding: '0 4px' }}>
          <div className="grow">
            <div className="secondary">{t('packages.allowScripts')}</div>
            <div className="hint-text">{manager.risk}</div>
          </div>
          <Switch checked={allowScripts} onChange={setAllowScripts} label={t('packages.allowScripts')} />
        </div>

        <div className="bf-sidebar-label" style={{ padding: '8px 4px 0' }}>
          {t('packages.inProject', { count: mine.length })}
        </div>
        {!mine.length && <div className="faint secondary" style={{ padding: '0 4px' }}>{t('packages.empty')}</div>}
        {mine.map((d) => (
          <div key={d.name} className="list-row" data-testid="dependency">
            <Icon name="package" />
            <span className="mono grow ellipsis">{d.name}</span>
            <span className="chip">{d.version || t('packages.latest')}</span>
            <button className="btn sm icon" title={t('packages.remove')} disabled={!!busy} onClick={() => void remove(d)}>
              {busy === d.name ? <span className="dot busy" /> : <Icon name="trash" size={14} />}
            </button>
          </div>
        ))}

        {error && <div className="notice err selectable">{error}</div>}
        {hits.length > 0 && <div className="bf-sidebar-label" style={{ padding: '8px 4px 0' }}>{t('packages.results')}</div>}
        {hits.map((h) => (
          <div key={h.name} className="list-row" style={{ alignItems: 'flex-start' }} data-testid="package-hit">
            <div className="col grow gap-4">
              <div className="row">
                <span className="mono strong ellipsis">{h.name}</span>
                {h.version && <span className="chip">{h.version}</span>}
              </div>
              {h.description && <div className="small muted selectable">{h.description.slice(0, 200)}</div>}
            </div>
            <button className="btn sm outline" disabled={!!busy} onClick={() => void add({ manager: manager.id, name: h.name, version: h.version || undefined })}>
              {busy === h.name ? <span className="dot busy" /> : <Icon name="plus" size={14} />}
              {t('packages.add')}
            </button>
          </div>
        ))}
        {log && (
          <>
            <div className="row" style={{ padding: '8px 4px 0' }}>
              <span className="bf-sidebar-label grow" style={{ padding: 0 }}>
                {t('packages.log')}
              </span>
              <button className="btn sm icon" title={t('common.clear')} onClick={() => setLog('')}>
                <Icon name="trash" size={14} />
              </button>
            </div>
            <pre className="mono selectable scroll card flat" style={{ margin: 0, padding: 10, borderRadius: 12, maxHeight: 220, whiteSpace: 'pre-wrap' }} data-testid="package-log">
              {log}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
