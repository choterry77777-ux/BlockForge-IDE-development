import { createProject, type LanguageId, parseProject } from '@blockforge/core';
import { invoke } from '@tauri-apps/api/core';
import { starterBlocks } from './actions';
import { getPlatform, isTauri } from './platform';
import { detectToolchains, runActive, toolchainFound } from './runtime/runner';
import { db, type StoredProject } from './state/db';
import { useProject } from './state/project';
import { outputText, useRun } from './state/run';
import { freezeWorkspace, joinPath } from './state/workspace';
import { runTask } from './terminal/sessions';

const SETTINGS_KEY = 'bf.settings.v1';
const PROJECT_NAME = 'selftest';
const created: string[] = [];

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms))]);
}

/** Open a fresh one-file project, run it and return what it printed. */
async function runHello(language: LanguageId, prefer: 'builtin' | 'toolchain'): Promise<string> {
  // The starter program of a new project, loaded without saving it to the project list.
  const project = createProject(PROJECT_NAME, language, starterBlocks(language));
  created.push(project.id);
  useProject.getState().load(project);
  await sleep(300);
  await runActive('run', prefer);
  for (let i = 0; i < 600 && useRun.getState().status !== 'idle'; i++) await sleep(100);
  const exit = useRun.getState().lastExit;
  const text = outputText();
  if (!text.includes('Hello, World!')) throw new Error(`expected "Hello, World!" in the output, got: ${text.slice(-600)}`);
  if (exit && !exit.ok) throw new Error(`the run did not succeed: ${text.slice(-600)}`);
  return text.trim().split('\n').slice(-3).join(' | ');
}

/**
 * A scripted check of what only a real desktop build can prove: toolchains,
 * processes, the terminal, files and the credential store. It runs only when the
 * backend says the app was started for a self-test, writes a report and exits.
 */
export async function maybeSelfTest(): Promise<void> {
  if (!isTauri) return;
  let info: { enabled: boolean; folder?: string | null };
  try {
    info = await invoke('selftest_begin');
  } catch {
    return;
  }
  if (!info.enabled) return;

  // The check must not change what the user has saved: tabs, layout and the project list.
  freezeWorkspace();
  const savedSettings = localStorage.getItem(SETTINGS_KEY);

  const platform = getPlatform();
  const steps: Step[] = [];
  const step = async (name: string, work: () => Promise<string>, ms = 120_000) => {
    try {
      steps.push({ name, ok: true, detail: await withTimeout(work(), ms) });
    } catch (err) {
      steps.push({ name, ok: false, detail: String((err as Error)?.message ?? err) });
    }
  };
  const skipped = (name: string, why: string) => steps.push({ name, ok: true, detail: `skipped: ${why}` });

  await step('host', async () => `${platform.kind} ${platform.os} ${platform.arch}`);
  await step('toolchains', async () => {
    await detectToolchains(true);
    const found = useRun.getState().toolchains.filter((x) => x.found);
    if (!found.length) throw new Error('no toolchain was detected');
    return found.map((x) => `${x.id}=${x.version ?? '?'}`).join('; ');
  });
  await step('run javascript (built-in runtime)', () => runHello('javascript', 'builtin'));
  await step('run python (built-in runtime)', () => runHello('python', 'builtin'), 180_000);
  for (const [language, tools] of [
    ['javascript', ['node']],
    ['python', ['python']],
    ['c', ['cc']],
    ['cpp', ['cxx']],
    ['go', ['go']],
    ['rust', ['rustc']],
  ] as const) {
    if (tools.every((id) => toolchainFound(id))) await step(`run ${language} (toolchain)`, () => runHello(language, 'toolchain'), 240_000);
    else skipped(`run ${language} (toolchain)`, 'toolchain not installed');
  }

  await step('terminal', async () => {
    const r = await runTask('echo bf-selftest-terminal', { timeoutMs: 60_000 });
    if (r.code !== 0 || !r.output.includes('bf-selftest-terminal')) throw new Error(`exit ${r.code}, output: ${r.output.slice(-300)}`);
    return `exit ${r.code}`;
  });

  if (info.folder) {
    const fs = platform.workspace;
    const root = info.folder;
    const file = joinPath(root, 'note one.txt');
    const moved = joinPath(root, 'renamed.txt');
    const text = 'line 1\nhéllo 한글 日本語\n';
    await step('folder: create, write, read', async () => {
      await fs.create(joinPath(root, 'sub'), true);
      await fs.create(file, false);
      await fs.write(file, text);
      const back = await fs.read(file);
      if (back.text !== text) throw new Error(`read back ${JSON.stringify(back.text)}`);
      const names = (await fs.list(root)).map((e) => `${e.name}${e.dir ? '/' : ''}`);
      if (!names.includes('note one.txt') || !names.includes('sub/')) throw new Error(`listing: ${names.join(', ')}`);
      return names.join(', ');
    });
    await step('folder: rename, search', async () => {
      await fs.rename(file, moved);
      const hits = await fs.search(root, '한글', 10);
      if (hits.length !== 1 || !hits[0].path.endsWith('renamed.txt')) throw new Error(`search: ${JSON.stringify(hits)}`);
      return hits[0].rel;
    });
    await step('folder: refuses paths outside', async () => {
      const outside = joinPath(root, `..${platform.os === 'windows' ? '\\' : '/'}bf-outside.txt`);
      const failed = await fs.write(outside, 'x').then(
        () => false,
        () => true,
      );
      if (!failed) throw new Error('a path outside the folder was written');
      return 'refused';
    });
    await step('folder: move to trash', async () => {
      await fs.trash(moved);
      const names = (await fs.list(root)).map((e) => e.name);
      if (names.includes('renamed.txt')) throw new Error('the file is still there');
      return 'moved';
    });
  }

  await step('credential store', async () => {
    const id = 'selftest';
    await platform.setSecret(id, 'bf-selftest-value', 'https://example.invalid');
    if (!(await platform.hasSecret(id))) throw new Error('the saved value was not found');
    await platform.deleteSecret(id);
    if (await platform.hasSecret(id)) throw new Error('the value is still there after deleting it');
    return 'saved, found, removed';
  });

  // Put things back: no project of this run stays in the list, and the layout is as it was.
  useProject.getState().close();
  try {
    for (const id of created) await db.del('projects', id);
    for (const stored of await db.all<StoredProject>('projects')) {
      if (stored.name !== PROJECT_NAME) continue;
      const parsed = parseProject(stored.data);
      // Only empty leftovers of an earlier self-test are removed, never a project with content.
      const empty = parsed.project?.files.every((f) => !(f.blocks.blocks?.blocks ?? []).length && !f.code.trim());
      if (empty) await db.del('projects', stored.id);
    }
  } catch {
    // Cleaning up is best effort; the report matters more.
  }
  if (savedSettings === null) localStorage.removeItem(SETTINGS_KEY);
  else localStorage.setItem(SETTINGS_KEY, savedSettings);

  const failed = steps.filter((s) => !s.ok).length;
  const report = JSON.stringify({ app: 'BlockForge', os: platform.os, arch: platform.arch, failed, steps }, null, 2);
  await invoke('selftest_finish', { report, failed }).catch(() => undefined);
}
