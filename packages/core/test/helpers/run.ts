import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from '../../src/build/recipes';
import { TOOLCHAIN_BY_ID } from '../../src/build/toolchains';
import type { GenResult, LanguageId } from '../../src/types';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

/** Extra locations where toolchains commonly live on macOS. */
const EXTRA_PATHS = [
  join(repoRoot, 'node_modules/.bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/homebrew/opt/openjdk/bin',
  '/opt/homebrew/opt/rustup/bin',
  join(homedir(), '.cargo/bin'),
  '/opt/homebrew/opt/dart/libexec/bin',
];

export const TEST_PATH = [...EXTRA_PATHS, process.env.PATH ?? ''].join(delimiter);

const found = new Map<string, string | undefined>();

export function findTool(id: string): string | undefined {
  if (found.has(id)) return found.get(id);
  const spec = TOOLCHAIN_BY_ID[id];
  let hit: string | undefined;
  for (const name of spec?.candidates ?? [id]) {
    for (const dir of TEST_PATH.split(delimiter)) {
      const p = join(dir, name);
      if (dir && existsSync(p)) {
        hit = p;
        break;
      }
    }
    if (hit) break;
  }
  // /usr/bin/java is a stub on macOS when no JDK is installed.
  if (hit && (id === 'java' || id === 'javac') && hit.startsWith('/usr/bin/')) {
    const r = spawnSync(hit, ['-version'], { encoding: 'utf8' });
    if (r.status !== 0) hit = undefined;
  }
  found.set(id, hit);
  return hit;
}

export function hasTools(ids: string[]): boolean {
  return ids.every((id) => !!findTool(id));
}

export interface RunOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  stage: 'build' | 'run' | 'skipped';
  missing?: string[];
}

/** Write generated files to a temp dir, then build and run them with real toolchains. */
export function runGenerated(result: GenResult, lang: LanguageId, stdin = '', asmArch?: 'arm64' | 'x86_64'): RunOutcome {
  const plan = buildPlan({ language: lang, entry: result.meta.entryFile, asmArch });
  const missing = plan.requires.filter((id) => !findTool(id));
  if (missing.length) return { ok: false, stdout: '', stderr: '', stage: 'skipped', missing };
  const dir = mkdtempSync(join(tmpdir(), `bf-${lang}-`));
  try {
    for (const f of [...result.files, ...plan.configFiles]) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    mkdirSync(join(dir, 'build'), { recursive: true });
    const env = { ...process.env, PATH: TEST_PATH, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
    for (const step of plan.build) {
      const r = spawnSync(findTool(step.tool)!, step.args, { cwd: dir, encoding: 'utf8', env, timeout: 180000 });
      if (r.status !== 0) return { ok: false, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : ''), stage: 'build' };
    }
    if (!plan.run) return { ok: true, stdout: '', stderr: '', stage: 'run' };
    const program = plan.run.tool === 'artifact' ? join(dir, plan.run.args[0]) : findTool(plan.run.tool)!;
    const args = plan.run.tool === 'artifact' ? [] : plan.run.args;
    const r = spawnSync(program, args, { cwd: dir, encoding: 'utf8', env, input: stdin, timeout: 60000 });
    return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : ''), stage: 'run' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
