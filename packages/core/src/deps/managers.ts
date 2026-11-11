import type { DependencyRef, GeneratedFile, LanguageId } from '../types';

export interface PackageHit {
  name: string;
  version: string;
  description: string;
}

export interface PackageInfo {
  name: string;
  latest: string;
  versions: string[];
  description: string;
}

export interface Command {
  tool: string;
  args: string[];
  env?: Record<string, string>;
}

export interface InstallOptions {
  /** Let package install scripts or native builds run. Off by default. */
  allowScripts: boolean;
}

export interface PackageManager {
  id: string;
  name: string;
  languages: LanguageId[];
  /** Toolchain id that provides the command. */
  tool: string;
  registryHost: string;
  /** What installing can execute on this computer, shown before confirmation. */
  risk: string;
  /** Extra request headers some registries require. */
  headers?: Record<string, string>;
  searchUrl?: (query: string) => string;
  parseSearch?: (json: unknown) => PackageHit[];
  infoUrl?: (name: string) => string;
  parseInfo?: (json: unknown, name: string) => PackageInfo | undefined;
  install: (dep: DependencyRef, opts: InstallOptions) => Command;
  uninstall?: (dep: DependencyRef) => Command;
  /** Project metadata listing the dependencies. */
  manifest?: (deps: DependencyRef[], projectName: string) => GeneratedFile | undefined;
  lockfile?: string;
  /** Environment needed at run time so the program finds the packages. */
  runEnv?: Record<string, string>;
}

const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const q = encodeURIComponent;
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'blockforge-app';
const NAME_RE = /^[@A-Za-z0-9][\w.@/:+-]*$/;
const VERSION_RE = /^[\w.+~^<>=*! -]+$/;

/** Reject names or versions that could smuggle command-line options. */
export function validDependency(dep: DependencyRef): boolean {
  return NAME_RE.test(dep.name) && !dep.name.startsWith('-') && (!dep.version || (VERSION_RE.test(dep.version) && !dep.version.startsWith('-')));
}

export const PACKAGE_MANAGERS: PackageManager[] = [
  {
    id: 'pip',
    name: 'pip (PyPI)',
    languages: ['python'],
    tool: 'python',
    registryHost: 'pypi.org',
    risk: 'Source distributions run their setup script while installing. With scripts off, only prebuilt wheels are accepted.',
    // PyPI has no search API, so the name is looked up exactly.
    infoUrl: (name) => `https://pypi.org/pypi/${q(name)}/json`,
    parseInfo: (json, name) => {
      const info = o(o(json).info);
      if (!info.version) return undefined;
      return { name: s(info.name) || name, latest: s(info.version), versions: Object.keys(o(o(json).releases)).reverse().slice(0, 40), description: s(info.summary) };
    },
    install: (d, opts) => ({ tool: 'python', args: ['-m', 'pip', 'install', '--disable-pip-version-check', '--target', 'packages', ...(opts.allowScripts ? [] : ['--only-binary', ':all:']), d.version ? `${d.name}==${d.version}` : d.name] }),
    manifest: (deps) => ({ path: 'requirements.txt', content: deps.map((d) => (d.version ? `${d.name}==${d.version}` : d.name)).join('\n') + '\n', role: 'config' }),
    runEnv: { PYTHONPATH: 'packages' },
  },
  {
    id: 'npm',
    name: 'npm',
    languages: ['javascript', 'typescript'],
    tool: 'npm',
    registryHost: 'registry.npmjs.org',
    risk: 'Packages can declare install scripts that run arbitrary commands. They are skipped unless you allow scripts.',
    searchUrl: (query) => `https://registry.npmjs.org/-/v1/search?text=${q(query)}&size=20`,
    parseSearch: (json) => a(o(json).objects).map((x) => o(o(x).package)).map((p) => ({ name: s(p.name), version: s(p.version), description: s(p.description) })),
    infoUrl: (name) => `https://registry.npmjs.org/${name.startsWith('@') ? name.replace('/', '%2F') : q(name)}`,
    parseInfo: (json, name) => {
      const j = o(json);
      const latest = s(o(j['dist-tags']).latest);
      if (!latest) return undefined;
      return { name: s(j.name) || name, latest, versions: Object.keys(o(j.versions)).reverse().slice(0, 40), description: s(j.description) };
    },
    install: (d, opts) => ({ tool: 'npm', args: ['install', '--no-audit', '--no-fund', ...(opts.allowScripts ? [] : ['--ignore-scripts']), d.version ? `${d.name}@${d.version}` : d.name] }),
    uninstall: (d) => ({ tool: 'npm', args: ['uninstall', '--no-audit', '--no-fund', d.name] }),
    manifest: (deps, name) => ({ path: 'package.json', content: JSON.stringify({ name: slug(name), version: '0.1.0', private: true, dependencies: Object.fromEntries(deps.map((d) => [d.name, d.version || 'latest'])) }, null, 2) + '\n', role: 'config' }),
    lockfile: 'package-lock.json',
  },
  {
    id: 'cargo',
    name: 'Cargo (crates.io)',
    languages: ['rust'],
    tool: 'cargo',
    registryHost: 'crates.io',
    risk: 'Crates may contain a build script and procedural macros that run on this computer when the project is compiled.',
    headers: { 'user-agent': 'blockforge-ide' },
    searchUrl: (query) => `https://crates.io/api/v1/crates?q=${q(query)}&per_page=20`,
    parseSearch: (json) => a(o(json).crates).map((c) => o(c)).map((c) => ({ name: s(c.name), version: s(c.max_stable_version) || s(c.max_version), description: s(c.description).trim() })),
    infoUrl: (name) => `https://crates.io/api/v1/crates/${q(name)}`,
    parseInfo: (json, name) => {
      const c = o(o(json).crate);
      if (!c.name) return undefined;
      return { name: s(c.name) || name, latest: s(c.max_stable_version) || s(c.max_version), versions: a(o(json).versions).map((v) => s(o(v).num)).slice(0, 40), description: s(c.description).trim() };
    },
    install: (d) => ({ tool: 'cargo', args: ['add', d.version ? `${d.name}@${d.version}` : d.name] }),
    uninstall: (d) => ({ tool: 'cargo', args: ['remove', d.name] }),
    manifest: (deps, name) => ({
      path: 'Cargo.toml',
      content: `[package]\nname = "${slug(name).replace(/-/g, '_')}"\nversion = "0.1.0"\nedition = "2021"\n\n[[bin]]\nname = "main"\npath = "main.rs"\n\n[dependencies]\n${deps.map((d) => `${d.name} = "${d.version || '*'}"`).join('\n')}${deps.length ? '\n' : ''}`,
      role: 'config',
    }),
    lockfile: 'Cargo.lock',
  },
  {
    id: 'gomod',
    name: 'Go modules',
    languages: ['go'],
    tool: 'go',
    registryHost: 'proxy.golang.org',
    risk: 'Modules are downloaded as source and compiled into the program. Go does not run install scripts.',
    // The module proxy lists versions for an exact module path; there is no search API.
    infoUrl: (name) => `https://proxy.golang.org/${name.toLowerCase().split('/').map(q).join('/')}/@latest`,
    parseInfo: (json, name) => {
      const v = s(o(json).Version);
      return v ? { name, latest: v, versions: [v], description: '' } : undefined;
    },
    install: (d) => ({ tool: 'go', args: ['get', d.version ? `${d.name}@${d.version}` : d.name] }),
    uninstall: (d) => ({ tool: 'go', args: ['get', `${d.name}@none`] }),
    lockfile: 'go.sum',
  },
  {
    id: 'nuget',
    name: 'NuGet',
    languages: ['csharp'],
    tool: 'dotnet',
    registryHost: 'azuresearch-usnc.nuget.org',
    risk: 'Packages can add build targets that run during compilation.',
    searchUrl: (query) => `https://azuresearch-usnc.nuget.org/query?q=${q(query)}&take=20`,
    parseSearch: (json) => a(o(json).data).map((p) => o(p)).map((p) => ({ name: s(p.id), version: s(p.version), description: s(p.description) })),
    install: (d) => ({ tool: 'dotnet', args: ['add', 'app.csproj', 'package', d.name, ...(d.version ? ['--version', d.version] : [])] }),
    uninstall: (d) => ({ tool: 'dotnet', args: ['remove', 'app.csproj', 'package', d.name] }),
  },
  {
    id: 'maven',
    name: 'Maven Central',
    languages: ['java', 'kotlin'],
    tool: 'mvn',
    registryHost: 'search.maven.org',
    risk: 'Maven plugins declared by a project can run code during the build. BlockForge only copies dependency jars.',
    searchUrl: (query) => `https://search.maven.org/solrsearch/select?q=${q(query)}&rows=20&wt=json`,
    parseSearch: (json) => a(o(o(json).response).docs).map((d) => o(d)).map((d) => ({ name: `${s(d.g)}:${s(d.a)}`, version: s(d.latestVersion), description: s(d.p) })),
    install: () => ({ tool: 'mvn', args: ['-q', '-B', 'dependency:copy-dependencies', '-DoutputDirectory=build/lib'] }),
    manifest: (deps, name) => ({
      path: 'pom.xml',
      content: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<project xmlns="http://maven.apache.org/POM/4.0.0">',
        '  <modelVersion>4.0.0</modelVersion>',
        '  <groupId>local.blockforge</groupId>',
        `  <artifactId>${slug(name)}</artifactId>`,
        '  <version>0.1.0</version>',
        '  <dependencies>',
        ...deps.map((d) => {
          const [g, art] = d.name.split(':');
          return `    <dependency>\n      <groupId>${g}</groupId>\n      <artifactId>${art ?? g}</artifactId>\n      <version>${d.version || 'LATEST'}</version>\n    </dependency>`;
        }),
        '  </dependencies>',
        '</project>',
        '',
      ].join('\n'),
      role: 'config',
    }),
  },
  {
    id: 'composer',
    name: 'Composer (Packagist)',
    languages: ['php'],
    tool: 'composer',
    registryHost: 'packagist.org',
    risk: 'Packages can register scripts and plugins that run during installation. They are disabled unless you allow scripts.',
    searchUrl: (query) => `https://packagist.org/search.json?q=${q(query)}&per_page=20`,
    parseSearch: (json) => a(o(json).results).map((p) => o(p)).map((p) => ({ name: s(p.name), version: '', description: s(p.description) })),
    install: (d, opts) => ({ tool: 'composer', args: ['require', '--no-interaction', ...(opts.allowScripts ? [] : ['--no-scripts', '--no-plugins']), d.version ? `${d.name}:${d.version}` : d.name] }),
    uninstall: (d) => ({ tool: 'composer', args: ['remove', '--no-interaction', '--no-scripts', '--no-plugins', d.name] }),
    lockfile: 'composer.lock',
  },
  {
    id: 'gem',
    name: 'RubyGems',
    languages: ['ruby'],
    tool: 'gem',
    registryHost: 'rubygems.org',
    risk: 'Gems with native extensions compile and run build code while installing.',
    searchUrl: (query) => `https://rubygems.org/api/v1/search.json?query=${q(query)}`,
    parseSearch: (json) => a(json).slice(0, 20).map((g) => o(g)).map((g) => ({ name: s(g.name), version: s(g.version), description: s(g.info).split('\n')[0] })),
    install: (d) => ({ tool: 'gem', args: ['install', d.name, ...(d.version ? ['-v', d.version] : []), '--install-dir', 'gems', '--no-document'] }),
    uninstall: (d) => ({ tool: 'gem', args: ['uninstall', d.name, '--install-dir', 'gems', '-a', '-x'] }),
    manifest: (deps) => ({ path: 'Gemfile', content: `source "https://rubygems.org"\n\n${deps.map((d) => `gem "${d.name}"${d.version ? `, "${d.version}"` : ''}`).join('\n')}\n`, role: 'config' }),
    runEnv: { GEM_PATH: 'gems' },
  },
  {
    id: 'pub',
    name: 'pub.dev',
    languages: ['dart'],
    tool: 'dart',
    registryHost: 'pub.dev',
    risk: 'Packages are downloaded as source and compiled with the program. Dart does not run install scripts.',
    searchUrl: (query) => `https://pub.dev/api/search?q=${q(query)}`,
    parseSearch: (json) => a(o(json).packages).slice(0, 20).map((p) => ({ name: s(o(p).package), version: '', description: '' })),
    infoUrl: (name) => `https://pub.dev/api/packages/${q(name)}`,
    parseInfo: (json, name) => {
      const latest = o(o(json).latest);
      if (!latest.version) return undefined;
      return { name, latest: s(latest.version), versions: a(o(json).versions).map((v) => s(o(v).version)).reverse().slice(0, 40), description: s(o(latest.pubspec).description) };
    },
    install: (d) => ({ tool: 'dart', args: ['pub', 'add', d.version ? `${d.name}:${d.version}` : d.name] }),
    uninstall: (d) => ({ tool: 'dart', args: ['pub', 'remove', d.name] }),
    manifest: (deps, name) => ({ path: 'pubspec.yaml', content: `name: ${slug(name).replace(/-/g, '_')}\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n${deps.map((d) => `  ${d.name}: ${d.version ? `"${d.version}"` : 'any'}`).join('\n')}${deps.length ? '\n' : ''}`, role: 'config' }),
    lockfile: 'pubspec.lock',
  },
];

export const PACKAGE_MANAGER_BY_ID: Record<string, PackageManager> = Object.fromEntries(PACKAGE_MANAGERS.map((m) => [m.id, m]));

export function managersFor(lang: LanguageId): PackageManager[] {
  return PACKAGE_MANAGERS.filter((m) => m.languages.includes(lang));
}

/** Hosts the desktop backend may contact for package metadata. */
export const REGISTRY_HOSTS: string[] = [...new Set(PACKAGE_MANAGERS.map((m) => m.registryHost))];

/** Manifest files for the dependencies of a project. */
export function manifestsFor(deps: DependencyRef[], projectName: string): GeneratedFile[] {
  const out: GeneratedFile[] = [];
  for (const m of PACKAGE_MANAGERS) {
    const mine = deps.filter((d) => d.manager === m.id);
    if (!mine.length || !m.manifest) continue;
    const file = m.manifest(mine, projectName);
    if (file) out.push(file);
  }
  return out;
}

export function runEnvFor(deps: DependencyRef[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const d of deps) Object.assign(env, PACKAGE_MANAGER_BY_ID[d.manager]?.runEnv ?? {});
  return env;
}
