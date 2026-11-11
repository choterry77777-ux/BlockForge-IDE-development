import { LANGUAGES } from '../langs';
import { manifestsFor, runEnvFor } from '../deps/managers';
import type { DependencyRef, GeneratedFile, LanguageId } from '../types';
import type { HostPlatform } from './toolchains';

export type StepKind = 'compile' | 'transpile' | 'run' | 'preview' | 'package';

export interface BuildStep {
  kind: StepKind;
  /** Toolchain id, or 'artifact' to launch a file produced by an earlier step. */
  tool: string;
  args: string[];
  label: string;
}

export interface BuildConfig {
  profile: 'debug' | 'release';
  /** Compiler toolchain override for C family languages: clang or gcc. */
  compiler?: string;
  optimization?: '0' | '1' | '2' | '3' | 's';
  /** Target architecture where the toolchain supports it. */
  arch?: 'native' | 'arm64' | 'x86_64';
  standard?: string;
  extraArgs?: string[];
}

export const DEFAULT_BUILD_CONFIG: BuildConfig = { profile: 'debug', optimization: '0', arch: 'native' };

export interface BuildPlan {
  language: LanguageId;
  /** How the output becomes runnable. The UI labels actions accordingly. */
  mode: 'interpret' | 'compile' | 'transpile' | 'preview' | 'query';
  /** Extra project metadata files written next to the sources. */
  configFiles: GeneratedFile[];
  build: BuildStep[];
  run?: BuildStep;
  /** Syntax check without running, where the toolchain offers one. */
  check?: BuildStep;
  /** Environment variables for every step, relative paths resolved against the work directory. */
  env: Record<string, string>;
  /** Paths removed by Clean, relative to the work directory. */
  clean: string[];
  artifact?: string;
  requires: string[];
  notes: string[];
}

export interface PlanInput {
  language: LanguageId;
  entry: string;
  config?: BuildConfig;
  platform?: HostPlatform;
  /** Assembly architecture declared by the program block. */
  asmArch?: 'arm64' | 'x86_64';
  projectName?: string;
  dependencies?: DependencyRef[];
}

const exe = (name: string, platform: HostPlatform) => (platform === 'windows' ? `${name}.exe` : name);

function csproj(deps: DependencyRef[]): string {
  const refs = deps.map((d) => `    <PackageReference Include="${d.name}" Version="${d.version || '*'}" />`).join('\n');
  return [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    '    <OutputType>Exe</OutputType>',
    '    <TargetFramework>net$(BundledNETCoreAppTargetFrameworkVersion)</TargetFramework>',
    '    <Nullable>disable</Nullable>',
    '    <ImplicitUsings>disable</ImplicitUsings>',
    '    <AssemblyName>app</AssemblyName>',
    '    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>',
    '    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>',
    '  </PropertyGroup>',
    '  <ItemGroup>',
    '    <Compile Include="*.cs" />',
    '  </ItemGroup>',
    ...(refs ? ['  <ItemGroup>', refs, '  </ItemGroup>'] : []),
    '</Project>',
    '',
  ].join('\n');
}

/** Describe how to build and run generated code. The host executes the steps. */
export function buildPlan(input: PlanInput): BuildPlan {
  const { language, entry } = input;
  const cfg = { ...DEFAULT_BUILD_CONFIG, ...input.config };
  const platform = input.platform ?? 'macos';
  const info = LANGUAGES[language];
  const opt = cfg.profile === 'release' && cfg.optimization === '0' ? '2' : (cfg.optimization ?? '0');
  const extra = cfg.extraArgs ?? [];
  const deps = input.dependencies ?? [];
  const of = (manager: string) => deps.filter((d) => d.manager === manager);
  const sep = platform === 'windows' ? ';' : ':';
  const plan: BuildPlan = { language, mode: 'interpret', configFiles: [], build: [], env: runEnvFor(deps), clean: ['build'], requires: [], notes: [] };
  const out = `build/${exe('main', platform)}`;
  const archArgs = (cc: boolean): string[] => {
    if (!cfg.arch || cfg.arch === 'native') return [];
    if (platform === 'macos') return ['-arch', cfg.arch];
    return cc ? [`--target=${cfg.arch === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu`] : [];
  };
  const interpret = (tool: string, args: string[]) => {
    plan.requires = [tool];
    plan.run = { kind: 'run', tool, args, label: `${tool} ${args.join(' ')}` };
  };
  const artifact = (path: string) => {
    plan.artifact = path;
    plan.run = { kind: 'run', tool: 'artifact', args: [path], label: path };
  };

  switch (language) {
    case 'python':
      interpret('python', ['-u', entry]);
      plan.check = { kind: 'compile', tool: 'python', args: ['-m', 'py_compile', entry], label: 'Syntax check' };
      break;
    case 'javascript':
      interpret('node', [entry]);
      plan.check = { kind: 'compile', tool: 'node', args: ['--check', entry], label: 'Syntax check' };
      break;
    case 'lua':
      interpret('lua', [entry]);
      break;
    case 'php':
      interpret('php', [entry]);
      plan.check = { kind: 'compile', tool: 'php', args: ['-l', entry], label: 'Syntax check' };
      break;
    case 'ruby':
      interpret('ruby', [entry]);
      plan.check = { kind: 'compile', tool: 'ruby', args: ['-c', entry], label: 'Syntax check' };
      break;
    case 'bash':
      interpret('bash', [entry]);
      plan.check = { kind: 'compile', tool: 'bash', args: ['-n', entry], label: 'Syntax check' };
      break;
    case 'typescript':
      plan.mode = 'transpile';
      plan.requires = ['tsc', 'node'];
      plan.build.push({ kind: 'transpile', tool: 'tsc', args: [entry, '--target', 'ES2022', '--module', 'commonjs', '--strict', '--skipLibCheck', '--outDir', 'build', ...extra], label: 'Type-check and transpile to JavaScript' });
      plan.run = { kind: 'run', tool: 'node', args: [`build/${entry.replace(/\.ts$/, '.js')}`], label: 'node' };
      plan.notes.push('TypeScript is transpiled to JavaScript and then run by Node.js.');
      break;
    case 'c':
    case 'cpp': {
      plan.mode = 'compile';
      const tool = language === 'c' ? 'cc' : 'cxx';
      plan.requires = [tool];
      const std = cfg.standard ?? (language === 'c' ? 'c11' : 'c++17');
      plan.build.push({ kind: 'compile', tool, args: [entry, `-std=${std}`, `-O${opt}`, ...(cfg.profile === 'debug' ? ['-g'] : []), '-Wall', ...archArgs(true), ...extra, '-o', out, ...(platform === 'windows' ? [] : ['-lm'])], label: `Compile ${entry}` });
      artifact(out);
      break;
    }
    case 'assembly': {
      plan.mode = 'compile';
      plan.requires = ['cc'];
      const arch = input.asmArch ?? 'arm64';
      const args = platform === 'macos' ? ['-arch', arch] : [];
      plan.build.push({ kind: 'compile', tool: 'cc', args: [entry, ...args, ...extra, '-o', out], label: `Assemble and link ${entry} (${arch})` });
      artifact(out);
      plan.notes.push(`The program targets ${arch}. It only runs on a matching CPU or under emulation.`);
      break;
    }
    case 'java':
      plan.mode = 'compile';
      plan.requires = ['javac', 'java'];
      plan.build.push({ kind: 'compile', tool: 'javac', args: ['-encoding', 'UTF-8', '-d', 'build', ...(of('maven').length ? ['-cp', 'build/lib/*'] : []), ...(cfg.profile === 'debug' ? ['-g'] : []), ...extra, entry], label: `Compile ${entry} to bytecode` });
      plan.run = { kind: 'run', tool: 'java', args: ['-cp', of('maven').length ? `build${sep}build/lib/*` : 'build', entry.replace(/\.java$/, '')], label: 'java' };
      break;
    case 'kotlin':
      plan.mode = 'compile';
      plan.requires = ['kotlinc', 'java'];
      plan.build.push({ kind: 'compile', tool: 'kotlinc', args: [entry, '-include-runtime', '-d', 'build/main.jar', ...extra], label: `Compile ${entry} to a JVM jar` });
      plan.run = { kind: 'run', tool: 'java', args: ['-jar', 'build/main.jar'], label: 'java -jar' };
      break;
    case 'csharp':
      plan.mode = 'compile';
      plan.requires = ['dotnet'];
      plan.configFiles.push({ path: 'app.csproj', content: csproj(of('nuget')), role: 'config' });
      plan.build.push({ kind: 'compile', tool: 'dotnet', args: ['build', 'app.csproj', '-c', cfg.profile === 'release' ? 'Release' : 'Debug', '-o', 'build', '--nologo', '-v', 'q', ...extra], label: 'dotnet build' });
      plan.run = { kind: 'run', tool: 'dotnet', args: ['build/app.dll'], label: 'dotnet' };
      plan.clean.push('obj', 'bin');
      break;
    case 'go':
      plan.mode = 'compile';
      plan.requires = ['go'];
      plan.configFiles.push({ path: 'go.mod', content: `module ${(input.projectName ?? 'blockforge').replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'blockforge'}\n\ngo 1.21\n`, role: 'config' });
      plan.build.push({ kind: 'compile', tool: 'go', args: ['build', ...(cfg.profile === 'release' ? ['-ldflags', '-s -w'] : []), ...extra, '-o', out, '.'], label: 'go build' });
      artifact(out);
      break;
    case 'rust':
      plan.mode = 'compile';
      if (of('cargo').length) {
        // Crates need a Cargo project; the single source file stays where it is.
        plan.requires = ['cargo'];
        plan.build.push({ kind: 'compile', tool: 'cargo', args: ['build', ...(cfg.profile === 'release' ? ['--release'] : []), ...extra], label: 'cargo build' });
        artifact(`target/${cfg.profile === 'release' ? 'release' : 'debug'}/${exe('main', platform)}`);
        plan.clean.push('target');
        break;
      }
      plan.requires = ['rustc'];
      plan.build.push({ kind: 'compile', tool: 'rustc', args: [entry, '--edition', '2021', ...(opt !== '0' ? ['-C', `opt-level=${opt}`] : []), ...(cfg.profile === 'debug' ? ['-g'] : []), ...extra, '-o', out], label: `Compile ${entry}` });
      artifact(out);
      break;
    case 'dart':
      plan.mode = 'compile';
      plan.requires = ['dart'];
      if (cfg.profile === 'release') {
        plan.build.push({ kind: 'compile', tool: 'dart', args: ['compile', 'exe', entry, '-o', out, ...extra], label: 'dart compile exe' });
        artifact(out);
      } else {
        plan.run = { kind: 'run', tool: 'dart', args: ['run', entry], label: 'dart run' };
      }
      break;
    case 'sql':
      plan.mode = 'query';
      plan.requires = ['sqlite3'];
      plan.run = { kind: 'run', tool: 'sqlite3', args: ['-batch', '-header', '-column', 'build/database.sqlite', `.read ${entry}`], label: 'sqlite3' };
      plan.notes.push('Statements run against build/database.sqlite. Clean removes the database.');
      break;
    case 'html':
    case 'css':
      plan.mode = 'preview';
      plan.clean = [];
      plan.notes.push(`${info.name} is shown in a sandboxed preview; nothing is compiled.`);
      break;
  }
  // Dependency manifests (requirements.txt, package.json, Cargo.toml, ...) sit next to the sources.
  for (const file of manifestsFor(deps, input.projectName ?? 'blockforge-app')) {
    if (!plan.configFiles.some((f) => f.path === file.path)) plan.configFiles.push(file);
  }
  return plan;
}
