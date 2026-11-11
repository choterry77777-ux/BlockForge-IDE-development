import { blockAtLine, buildPlan, type BuildPlan, type BuildStep, type Diagnostic, hasErrors, LANGUAGES, type LanguageId, parseToolOutput, type Project, type ProjectFile, TOOLCHAIN_BY_ID, TOOLCHAINS } from '@blockforge/core';
import { diagText, t } from '../i18n';
import { getPlatform } from '../platform';
import type { ProcessHandle } from '../platform/types';
import { useProject } from '../state/project';
import { runTarget } from '../state/workspace';
import { useRun } from '../state/run';
import { useSettings } from '../state/settings';
import { useUi } from '../state/ui';
import type { WorkerMessage } from './protocol';
import type { TranspileResult } from './ts.worker';

export type RunAction = 'run' | 'build' | 'rebuild' | 'clean' | 'check';

let worker: Worker | undefined;
let proc: ProcessHandle | undefined;
let stopRequested = false;
let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

const BUILTIN: Partial<Record<LanguageId, () => Worker>> = {
  javascript: () => new Worker(new URL('./js.worker.ts', import.meta.url), { type: 'module' }),
  typescript: () => new Worker(new URL('./js.worker.ts', import.meta.url), { type: 'module' }),
  python: () => new Worker(new URL('./py.worker.ts', import.meta.url), { type: 'module' }),
  lua: () => new Worker(new URL('./lua.worker.ts', import.meta.url), { type: 'module' }),
  sql: () => new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module' }),
};

export async function detectToolchains(force = false): Promise<void> {
  const run = useRun.getState();
  if (run.toolchainsChecked && !force) return;
  try {
    const found = await getPlatform().detectToolchains(TOOLCHAINS);
    useRun.setState({ toolchains: found, toolchainsChecked: true });
  } catch (err) {
    useRun.setState({ toolchains: TOOLCHAINS.map((s) => ({ id: s.id, found: false })), toolchainsChecked: true });
    console.error(err);
  }
}

export function toolchainFound(id: string): boolean {
  return !!useRun.getState().toolchains.find((x) => x.id === id)?.found;
}

/** How a file can be executed on this machine right now. */
export function runCapabilities(lang: LanguageId): { builtin: boolean; toolchain: boolean; missing: string[]; preview: boolean } {
  const plan = buildPlan({ language: lang, entry: LANGUAGES[lang].entry });
  const desktop = getPlatform().kind === 'desktop';
  // TypeScript can fall back to the bundled transpiler when tsc is not installed.
  const required = plan.requires.filter((id) => !(lang === 'typescript' && id === 'tsc'));
  const missing = required.filter((id) => !toolchainFound(id));
  return { builtin: !!BUILTIN[lang], toolchain: desktop && required.length > 0 && missing.length === 0, missing: desktop ? missing : required, preview: plan.mode === 'preview' };
}

export function stopRun(): void {
  stopRequested = true;
  clearTimeout(timeoutTimer);
  worker?.terminate();
  worker = undefined;
  void proc?.kill();
  const s = useRun.getState();
  if (s.status !== 'idle') {
    s.append('sys', `\n${t('run.stopped')}\n`);
    useRun.setState({ status: 'idle' });
  }
}

function attachBlocks(diags: Diagnostic[], fileId: string): Diagnostic[] {
  const result = useProject.getState().results[fileId];
  const file = useProject.getState().project?.files.find((f) => f.id === fileId);
  if (!result || !file || file.mode !== 'blocks') return diags;
  return diags.map((d) => (d.line && (!d.file || d.file === result.meta.entryFile) ? { ...d, file: d.file ?? result.meta.entryFile, blockId: blockAtLine(result, result.meta.entryFile, d.line) } : d));
}

function finish(fileId: string, ok: boolean, started: number, extra: { code?: number | null; note?: string; diagnostics?: Diagnostic[] } = {}): void {
  clearTimeout(timeoutTimer);
  const run = useRun.getState();
  const ms = Math.round(performance.now() - started);
  const diagnostics = attachBlocks(extra.diagnostics ?? [], fileId);
  run.append(ok ? 'ok' : 'sys', `\n${ok ? t('run.finished', { ms }) : t('run.failed', { ms })}${extra.code !== undefined && extra.code !== null && !ok ? ` (${t('run.exitCode', { code: extra.code })})` : ''}${extra.note ? ` ${extra.note}` : ''}\n`);
  useRun.setState({ status: 'idle', lastExit: { ok, code: extra.code, ms, note: extra.note }, diagnostics: [...run.diagnostics, ...diagnostics] });
  if (diagnostics.length) useSettings.getState().update({ layout: { dockOpen: true } });
}

function guard(fileId: string, started: number): { limit: (text: string) => boolean } {
  const { timeoutSec, maxOutputKb } = useSettings.getState().run;
  let bytes = 0;
  clearTimeout(timeoutTimer);
  timeoutTimer = setTimeout(() => {
    if (useRun.getState().status === 'idle') return;
    worker?.terminate();
    worker = undefined;
    void proc?.kill();
    finish(fileId, false, started, { note: t('run.timedOut', { seconds: timeoutSec }) });
  }, timeoutSec * 1000);
  return {
    limit(text) {
      bytes += text.length;
      if (bytes <= maxOutputKb * 1024) return true;
      worker?.terminate();
      worker = undefined;
      void proc?.kill();
      finish(fileId, false, started, { note: t('run.outputLimit', { kb: maxOutputKb }) });
      return false;
    },
  };
}

export function transpile(code: string, fileName: string): Promise<TranspileResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./ts.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<TranspileResult>) => {
      resolve(e.data);
      w.terminate();
    };
    w.onerror = (e) => {
      reject(new Error(e.message));
      w.terminate();
    };
    w.postMessage({ code, fileName });
  });
}

async function runBuiltin(file: ProjectFile, project: Project, code: string, started: number): Promise<void> {
  const run = useRun.getState();
  const lang = file.language;
  let source = code;
  if (lang === 'typescript') {
    run.append('sys', `${t('run.transpiling')}\n`);
    const out = await transpile(code, file.name);
    if (out.errors.length) {
      for (const e of out.errors) run.append('err', `${file.name}(${e.line},${e.column}): ${e.message}\n`);
      finish(file.id, false, started, { diagnostics: out.errors.map((e) => ({ severity: 'error', code: 'tool.compiler', message: e.message, source: 'compiler', file: file.name, line: e.line, column: e.column })) });
      return;
    }
    source = out.js;
  }
  const limits = guard(file.id, started);
  const w = BUILTIN[lang]!();
  worker = w;
  useRun.setState({ status: 'running' });
  w.onmessage = (e: MessageEvent<WorkerMessage>) => {
    if (worker !== w) return;
    const m = e.data;
    switch (m.type) {
      case 'out':
      case 'err':
      case 'in':
      case 'sys':
        if (limits.limit(m.text)) useRun.getState().append(m.type, m.text);
        break;
      case 'status':
        if (m.text === 'loading') useRun.getState().append('sys', `${t('run.loadingRuntime', { name: LANGUAGES[lang].name })}\n`);
        break;
      case 'table':
        useRun.setState({ tables: [...useRun.getState().tables, { title: m.title, columns: m.columns, rows: m.rows }] });
        break;
      case 'done': {
        const diagnostics: Diagnostic[] = m.ok || !m.line ? [] : [{ severity: 'error', code: 'tool.runtime', message: m.error ?? '', source: 'runtime', file: file.name, line: m.line }];
        // Python and Lua keep their runtime warm; JavaScript workers are single use.
        if (lang === 'javascript' || lang === 'typescript' || lang === 'sql') {
          w.terminate();
          worker = undefined;
        }
        finish(file.id, m.ok, started, { diagnostics });
        break;
      }
    }
  };
  w.onerror = (e) => {
    if (worker !== w) return;
    useRun.getState().append('err', `${e.message}\n`);
    w.terminate();
    worker = undefined;
    finish(file.id, false, started);
  };
  w.postMessage({ code: source, stdin: project.settings.stdin ?? '' });
}

async function step(projectId: string, s: BuildStep, plan: BuildPlan, stdin: string | undefined, limits: { limit: (t: string) => boolean }, collect: string[]): Promise<{ ok: boolean; code: number | null; note?: string }> {
  const platform = getPlatform();
  const { timeoutSec, maxOutputKb } = useSettings.getState().run;
  const isRun = s.kind === 'run';
  const spec = TOOLCHAIN_BY_ID[s.tool];
  const detected = useRun.getState().toolchains.find((x) => x.id === s.tool);
  const handle = await platform.spawn(
    {
      projectId,
      tool: s.tool === 'artifact' ? undefined : (detected?.path ?? spec?.candidates[0] ?? s.tool),
      artifact: s.tool === 'artifact' ? s.args[0] : undefined,
      args: s.tool === 'artifact' ? [] : s.args,
      env: plan.env,
      stdin,
      // Builds get a longer allowance than the program itself.
      timeoutMs: (isRun ? timeoutSec : Math.max(timeoutSec, 300)) * 1000,
      maxOutputBytes: maxOutputKb * 1024,
    },
    (stream, text) => {
      collect.push(text);
      if (limits.limit('')) useRun.getState().append(stream === 'stderr' ? 'err' : 'out', text);
    },
  );
  proc = handle;
  const exit = await handle.done;
  proc = undefined;
  const note = exit.timedOut ? t('run.timedOut', { seconds: timeoutSec }) : exit.truncated ? t('run.outputLimit', { kb: maxOutputKb }) : exit.error;
  return { ok: exit.code === 0 && !exit.timedOut && !exit.killed, code: exit.code, note };
}

async function runToolchain(file: ProjectFile, project: Project, files: { path: string; content: string }[], entry: string, action: RunAction, started: number): Promise<void> {
  const run = useRun.getState();
  const platform = getPlatform();
  const result = useProject.getState().results[file.id];
  const plan = buildPlan({ language: file.language, entry, config: project.build, platform: platform.os, asmArch: result?.meta.variant?.startsWith('x86_64') ? 'x86_64' : file.language === 'assembly' ? 'arm64' : undefined, projectName: project.name, dependencies: project.dependencies });
  // TypeScript without tsc: transpile here and run the JavaScript with Node.
  let buildSteps = plan.build;
  let runStep = plan.run;
  if (file.language === 'typescript' && !toolchainFound('tsc')) {
    run.append('sys', `${t('run.noTscFallback')}\n`);
    const out = await transpile(files.find((f) => f.path === entry)!.content, entry);
    if (out.errors.length) {
      for (const e of out.errors) run.append('err', `${entry}(${e.line},${e.column}): ${e.message}\n`);
      finish(file.id, false, started, { diagnostics: out.errors.map((e) => ({ severity: 'error', code: 'tool.compiler', message: e.message, source: 'compiler', file: entry, line: e.line, column: e.column })) });
      return;
    }
    files = [...files, { path: `build/${entry.replace(/\.ts$/, '.js')}`, content: out.js }];
    buildSteps = [];
  }
  if (action === 'clean' || action === 'rebuild') {
    await platform.cleanWork(project.id, plan.clean);
    run.append('sys', `${t('run.cleaned', { paths: plan.clean.join(', ') || '-' })}\n`);
    if (action === 'clean') {
      useRun.setState({ status: 'idle' });
      return;
    }
  }
  await platform.writeWorkFiles(project.id, [...files, ...plan.configFiles.map((f) => ({ path: f.path, content: f.content }))]);
  const limits = guard(file.id, started);
  const collected: string[] = [];
  if (action === 'check') {
    buildSteps = plan.check ? [plan.check] : plan.build;
    runStep = undefined;
    if (!buildSteps.length) {
      run.append('sys', `${t('run.noCheck', { name: LANGUAGES[file.language].name })}\n`);
      useRun.setState({ status: 'idle' });
      clearTimeout(timeoutTimer);
      return;
    }
  }
  for (const s of buildSteps) {
    useRun.setState({ status: 'building' });
    run.append('sys', `$ ${s.tool} ${s.args.join(' ')}\n`);
    const r = await step(project.id, s, plan, undefined, limits, collected);
    if (stopRequested) return;
    if (!r.ok) {
      finish(file.id, false, started, { code: r.code, note: r.note, diagnostics: parseToolOutput(file.language, collected.join(''), 'compiler') });
      return;
    }
  }
  const warnings = parseToolOutput(file.language, collected.join(''), 'compiler');
  if (action !== 'run' || !runStep) {
    if (plan.artifact) run.append('sys', `${t('run.artifact', { path: plan.artifact })}\n`);
    finish(file.id, true, started, { diagnostics: warnings });
    return;
  }
  useRun.setState({ status: 'running' });
  if (buildSteps.length) run.append('sys', `$ ${runStep.tool === 'artifact' ? runStep.args[0] : `${runStep.tool} ${runStep.args.join(' ')}`}\n`);
  const runOut: string[] = [];
  const r = await step(project.id, runStep, plan, project.settings.stdin, limits, runOut);
  if (stopRequested) return;
  finish(file.id, r.ok, started, { code: r.code, note: r.note, diagnostics: [...warnings, ...(r.ok ? [] : parseToolOutput(file.language, runOut.join(''), 'runtime'))] });
}

/** Text typed while a desktop program is running goes to its standard input. */
export async function sendInput(line: string): Promise<void> {
  if (!proc) return;
  useRun.getState().append('in', `${line}\n`);
  await proc.write(`${line}\n`);
}

export function canSendInput(): boolean {
  return !!proc;
}

export async function runActive(action: RunAction = 'run', prefer: 'auto' | 'builtin' | 'toolchain' = 'auto'): Promise<void> {
  // The block-project file in front, or the text tab in front as a one-file project.
  const target = runTarget();
  if (!target) return;
  const { file, project } = target;
  if (useRun.getState().status !== 'idle') stopRun();
  stopRequested = false;
  const run = useRun.getState();
  run.clear();
  useSettings.getState().update({ layout: { dockOpen: true, dockTab: 'output' } });
  useRun.setState({ status: 'building', fileId: file.id });
  const started = performance.now();
  await detectToolchains();

  // Blocks are the source of truth in blocks mode, so the code is regenerated first.
  let code = file.code;
  let entry = file.name;
  if (file.mode === 'blocks') {
    const result = (await useProject.getState().regenerate(file.id)) ?? useProject.getState().results[file.id];
    if (!result) {
      useRun.setState({ status: 'idle' });
      return;
    }
    code = result.files[0].content;
    entry = result.meta.entryFile;
    if (hasErrors(result.diagnostics)) {
      for (const d of result.diagnostics.filter((x) => x.severity === 'error')) run.append('err', `${diagText(d)}\n`);
      run.append('sys', `\n${t('run.fixBlocksFirst')}\n`);
      useRun.setState({ status: 'idle' });
      useSettings.getState().update({ layout: { dockTab: 'problems' } });
      return;
    }
  }

  const caps = runCapabilities(file.language);
  if (caps.preview) {
    const html = file.language === 'html' ? code : cssPreviewDocument(code);
    useRun.setState({ status: 'idle', preview: { html, n: (useRun.getState().preview?.n ?? 0) + 1 } });
    useSettings.getState().update({ layout: { rightOpen: true, rightTab: 'preview' } });
    run.append('sys', `${t('run.previewShown')}\n`);
    return;
  }
  const useToolchain = prefer === 'toolchain' ? caps.toolchain : prefer === 'builtin' ? false : caps.toolchain;
  try {
    if (useToolchain || (action !== 'run' && caps.toolchain)) {
      // Every file of the project is written so that files can refer to each other.
      const files = project.files.map((f) => ({ path: f.id === file.id ? entry : f.name, content: f.id === file.id ? code : f.code }));
      await runToolchain(file, project, files, entry, action, started);
      return;
    }
    if (action !== 'run') {
      run.append('sys', `${getPlatform().kind === 'web' ? t('run.desktopOnly') : missingMessage(caps.missing)}\n`);
      useRun.setState({ status: 'idle' });
      return;
    }
    if (caps.builtin) {
      await runBuiltin(file, project, code, started);
      return;
    }
    run.append('err', `${getPlatform().kind === 'web' ? t('run.noBrowserRuntime', { name: LANGUAGES[file.language].name }) : missingMessage(caps.missing)}\n`);
    useRun.setState({ status: 'idle' });
    if (getPlatform().kind === 'desktop') useSettings.getState().update({ layout: { rightOpen: true, rightTab: 'toolchains' } });
  } catch (err) {
    useRun.getState().append('err', `${String((err as Error)?.message ?? err)}\n`);
    finish(file.id, false, started);
    useUi.getState().toast(t('run.error'), 'err');
  }
}

function missingMessage(ids: string[]): string {
  const os = getPlatform().os;
  return ids.map((id) => `${t('run.missingToolchain', { name: TOOLCHAIN_BY_ID[id]?.name ?? id })}\n  ${t('run.installHint')}: ${TOOLCHAIN_BY_ID[id]?.install[os] ?? ''}`).join('\n');
}

/** A small page that shows a stylesheet applied to elements built from its selectors. */
export function cssPreviewDocument(css: string): string {
  const selectors = [...css.replace(/@media[^{]*\{/g, '').matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)].flatMap((m) => m[2].split(',').map((s) => s.trim())).filter(Boolean);
  const seen = new Set<string>();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const samples = selectors
    .filter((s) => !seen.has(s) && seen.add(s) && !/^(html|body|\*|:root)$/.test(s))
    .slice(0, 30)
    .map((sel) => {
      const last = sel.split(/\s+|>/).filter(Boolean).pop() ?? sel;
      const tag = /^[a-zA-Z][\w-]*/.exec(last)?.[0] ?? 'div';
      const id = /#([\w-]+)/.exec(last)?.[1];
      const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]).join(' ');
      const voidTag = ['img', 'input', 'br', 'hr'].includes(tag);
      const attrs = `${id ? ` id="${esc(id)}"` : ''}${classes ? ` class="${esc(classes)}"` : ''}`;
      return `<div style="margin:0 0 14px"><div style="font:11px ui-monospace,monospace;color:#81858c;margin-bottom:4px">${esc(sel)}</div>${voidTag ? `<${tag}${attrs}>` : `<${tag}${attrs}>${esc(sel)}</${tag}>`}</div>`;
    })
    .join('\n');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body>${samples || ''}</body></html>`;
}
