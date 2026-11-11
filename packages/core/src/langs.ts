import type { Domain, LanguageId } from './types';

export interface LanguageInfo {
  id: LanguageId;
  name: string;
  ext: string;
  /** Monaco language id. */
  monaco: string;
  domain: Domain;
  /** How the output is turned into something that runs. */
  kind: 'interpreted' | 'compiled' | 'transpiled' | 'markup' | 'query';
  /** Line comment prefix used by generators and editors. */
  lineComment: string;
  /** Default entry file name. */
  entry: string;
  /** Toolchain ids (see build/toolchains) that can run the output on desktop. */
  toolchains: string[];
  /** Runs inside the browser edition without a local toolchain. */
  browserRuntime: boolean;
  /** Package managers usable for this language. */
  packageManagers: string[];
}

export const LANGUAGES: Record<LanguageId, LanguageInfo> = {
  python: {
    id: 'python', name: 'Python', ext: 'py', monaco: 'python', domain: 'imperative', kind: 'interpreted',
    lineComment: '#', entry: 'main.py', toolchains: ['python'], browserRuntime: true, packageManagers: ['pip'],
  },
  javascript: {
    id: 'javascript', name: 'JavaScript', ext: 'js', monaco: 'javascript', domain: 'imperative', kind: 'interpreted',
    lineComment: '//', entry: 'main.js', toolchains: ['node'], browserRuntime: true, packageManagers: ['npm'],
  },
  typescript: {
    id: 'typescript', name: 'TypeScript', ext: 'ts', monaco: 'typescript', domain: 'imperative', kind: 'transpiled',
    lineComment: '//', entry: 'main.ts', toolchains: ['node', 'tsc'], browserRuntime: true, packageManagers: ['npm'],
  },
  c: {
    id: 'c', name: 'C', ext: 'c', monaco: 'c', domain: 'imperative', kind: 'compiled',
    lineComment: '//', entry: 'main.c', toolchains: ['cc'], browserRuntime: false, packageManagers: [],
  },
  cpp: {
    id: 'cpp', name: 'C++', ext: 'cpp', monaco: 'cpp', domain: 'imperative', kind: 'compiled',
    lineComment: '//', entry: 'main.cpp', toolchains: ['cxx'], browserRuntime: false, packageManagers: [],
  },
  java: {
    id: 'java', name: 'Java', ext: 'java', monaco: 'java', domain: 'imperative', kind: 'compiled',
    lineComment: '//', entry: 'Main.java', toolchains: ['javac', 'java'], browserRuntime: false, packageManagers: ['maven', 'gradle'],
  },
  csharp: {
    id: 'csharp', name: 'C#', ext: 'cs', monaco: 'csharp', domain: 'imperative', kind: 'compiled',
    lineComment: '//', entry: 'Program.cs', toolchains: ['dotnet'], browserRuntime: false, packageManagers: ['nuget'],
  },
  lua: {
    id: 'lua', name: 'Lua', ext: 'lua', monaco: 'lua', domain: 'imperative', kind: 'interpreted',
    lineComment: '--', entry: 'main.lua', toolchains: ['lua'], browserRuntime: true, packageManagers: [],
  },
  html: {
    id: 'html', name: 'HTML', ext: 'html', monaco: 'html', domain: 'web', kind: 'markup',
    lineComment: '', entry: 'index.html', toolchains: [], browserRuntime: true, packageManagers: [],
  },
  css: {
    id: 'css', name: 'CSS', ext: 'css', monaco: 'css', domain: 'web', kind: 'markup',
    lineComment: '', entry: 'style.css', toolchains: [], browserRuntime: true, packageManagers: [],
  },
  php: {
    id: 'php', name: 'PHP', ext: 'php', monaco: 'php', domain: 'imperative', kind: 'interpreted',
    lineComment: '//', entry: 'main.php', toolchains: ['php'], browserRuntime: false, packageManagers: ['composer'],
  },
  go: {
    id: 'go', name: 'Go', ext: 'go', monaco: 'go', domain: 'imperative', kind: 'compiled',
    lineComment: '//', entry: 'main.go', toolchains: ['go'], browserRuntime: false, packageManagers: ['gomod'],
  },
  rust: {
    id: 'rust', name: 'Rust', ext: 'rs', monaco: 'rust', domain: 'imperative', kind: 'compiled',
    lineComment: '//', entry: 'main.rs', toolchains: ['rustc', 'cargo'], browserRuntime: false, packageManagers: ['cargo'],
  },
  sql: {
    id: 'sql', name: 'SQL', ext: 'sql', monaco: 'sql', domain: 'sql', kind: 'query',
    lineComment: '--', entry: 'query.sql', toolchains: ['sqlite3'], browserRuntime: true, packageManagers: [],
  },
  dart: {
    id: 'dart', name: 'Dart', ext: 'dart', monaco: 'dart', domain: 'imperative', kind: 'compiled',
    lineComment: '//', entry: 'main.dart', toolchains: ['dart'], browserRuntime: false, packageManagers: ['pub'],
  },
  assembly: {
    id: 'assembly', name: 'Assembly', ext: 's', monaco: 'bf-asm', domain: 'asm', kind: 'compiled',
    lineComment: '//', entry: 'main.s', toolchains: ['cc'], browserRuntime: false, packageManagers: [],
  },
  ruby: {
    id: 'ruby', name: 'Ruby', ext: 'rb', monaco: 'ruby', domain: 'imperative', kind: 'interpreted',
    lineComment: '#', entry: 'main.rb', toolchains: ['ruby'], browserRuntime: false, packageManagers: ['gem'],
  },
  kotlin: {
    id: 'kotlin', name: 'Kotlin', ext: 'kt', monaco: 'kotlin', domain: 'imperative', kind: 'compiled',
    lineComment: '//', entry: 'Main.kt', toolchains: ['kotlinc', 'java'], browserRuntime: false, packageManagers: ['gradle', 'maven'],
  },
  bash: {
    id: 'bash', name: 'Bash', ext: 'sh', monaco: 'shell', domain: 'imperative', kind: 'interpreted',
    lineComment: '#', entry: 'main.sh', toolchains: ['bash'], browserRuntime: false, packageManagers: [],
  },
};

export const IMPERATIVE_LANGUAGES: LanguageId[] = (Object.keys(LANGUAGES) as LanguageId[]).filter(
  (id) => LANGUAGES[id].domain === 'imperative',
);

export function domainOf(lang: LanguageId): Domain {
  return LANGUAGES[lang].domain;
}

export function languageByExtension(ext: string): LanguageId | undefined {
  const clean = ext.replace(/^\./, '').toLowerCase();
  const alias: Record<string, LanguageId> = { htm: 'html', mjs: 'javascript', cjs: 'javascript', h: 'c', hpp: 'cpp', cc: 'cpp', asm: 'assembly', S: 'assembly', kts: 'kotlin', zsh: 'bash' };
  return (Object.values(LANGUAGES).find((l) => l.ext === clean)?.id) ?? alias[clean];
}
