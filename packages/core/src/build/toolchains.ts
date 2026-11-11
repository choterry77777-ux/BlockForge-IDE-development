import type { LanguageId } from '../types';

export type HostPlatform = 'macos' | 'windows' | 'linux';

export interface ToolchainSpec {
  id: string;
  name: string;
  /** Executable names tried in order. */
  candidates: string[];
  versionArgs: string[];
  languages: LanguageId[];
  /** Shown to the user; BlockForge never installs toolchains by itself. */
  install: Record<HostPlatform, string>;
  url: string;
}

const brew = (pkg: string) => `brew install ${pkg}`;
const winget = (pkg: string) => `winget install ${pkg}`;

export const TOOLCHAINS: ToolchainSpec[] = [
  { id: 'python', name: 'Python', candidates: ['python3', 'python'], versionArgs: ['--version'], languages: ['python'], install: { macos: brew('python'), windows: winget('Python.Python.3.13'), linux: 'sudo apt install python3' }, url: 'https://www.python.org/downloads/' },
  { id: 'node', name: 'Node.js', candidates: ['node'], versionArgs: ['--version'], languages: ['javascript', 'typescript'], install: { macos: brew('node'), windows: winget('OpenJS.NodeJS.LTS'), linux: 'sudo apt install nodejs' }, url: 'https://nodejs.org/' },
  { id: 'tsc', name: 'TypeScript compiler', candidates: ['tsc'], versionArgs: ['--version'], languages: ['typescript'], install: { macos: 'npm install -g typescript', windows: 'npm install -g typescript', linux: 'npm install -g typescript' }, url: 'https://www.typescriptlang.org/download' },
  { id: 'cc', name: 'C compiler', candidates: ['clang', 'gcc', 'cc'], versionArgs: ['--version'], languages: ['c', 'assembly'], install: { macos: 'xcode-select --install', windows: winget('LLVM.LLVM'), linux: 'sudo apt install build-essential' }, url: 'https://clang.llvm.org/get_started.html' },
  { id: 'cxx', name: 'C++ compiler', candidates: ['clang++', 'g++', 'c++'], versionArgs: ['--version'], languages: ['cpp'], install: { macos: 'xcode-select --install', windows: winget('LLVM.LLVM'), linux: 'sudo apt install build-essential' }, url: 'https://clang.llvm.org/get_started.html' },
  { id: 'javac', name: 'Java compiler (JDK)', candidates: ['javac'], versionArgs: ['-version'], languages: ['java'], install: { macos: brew('openjdk'), windows: winget('EclipseAdoptium.Temurin.21.JDK'), linux: 'sudo apt install default-jdk' }, url: 'https://adoptium.net/' },
  { id: 'java', name: 'Java runtime', candidates: ['java'], versionArgs: ['-version'], languages: ['java', 'kotlin'], install: { macos: brew('openjdk'), windows: winget('EclipseAdoptium.Temurin.21.JDK'), linux: 'sudo apt install default-jdk' }, url: 'https://adoptium.net/' },
  { id: 'dotnet', name: '.NET SDK', candidates: ['dotnet'], versionArgs: ['--version'], languages: ['csharp'], install: { macos: brew('dotnet'), windows: winget('Microsoft.DotNet.SDK.9'), linux: 'sudo apt install dotnet-sdk-9.0' }, url: 'https://dotnet.microsoft.com/download' },
  { id: 'lua', name: 'Lua', candidates: ['lua', 'lua5.4', 'luajit'], versionArgs: ['-v'], languages: ['lua'], install: { macos: brew('lua'), windows: winget('DEVCOM.Lua'), linux: 'sudo apt install lua5.4' }, url: 'https://www.lua.org/download.html' },
  { id: 'php', name: 'PHP', candidates: ['php'], versionArgs: ['--version'], languages: ['php'], install: { macos: brew('php'), windows: winget('PHP.PHP'), linux: 'sudo apt install php-cli' }, url: 'https://www.php.net/downloads' },
  { id: 'go', name: 'Go', candidates: ['go'], versionArgs: ['version'], languages: ['go'], install: { macos: brew('go'), windows: winget('GoLang.Go'), linux: 'sudo apt install golang' }, url: 'https://go.dev/dl/' },
  { id: 'rustc', name: 'Rust compiler', candidates: ['rustc'], versionArgs: ['--version'], languages: ['rust'], install: { macos: brew('rustup') + ' && rustup default stable', windows: winget('Rustlang.Rustup'), linux: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" }, url: 'https://www.rust-lang.org/tools/install' },
  { id: 'cargo', name: 'Cargo', candidates: ['cargo'], versionArgs: ['--version'], languages: ['rust'], install: { macos: brew('rustup') + ' && rustup default stable', windows: winget('Rustlang.Rustup'), linux: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" }, url: 'https://www.rust-lang.org/tools/install' },
  { id: 'sqlite3', name: 'SQLite', candidates: ['sqlite3'], versionArgs: ['--version'], languages: ['sql'], install: { macos: brew('sqlite'), windows: winget('SQLite.SQLite'), linux: 'sudo apt install sqlite3' }, url: 'https://www.sqlite.org/download.html' },
  { id: 'dart', name: 'Dart SDK', candidates: ['dart'], versionArgs: ['--version'], languages: ['dart'], install: { macos: 'brew tap dart-lang/dart && brew install dart', windows: winget('Google.DartSDK'), linux: 'sudo apt install dart' }, url: 'https://dart.dev/get-dart' },
  { id: 'ruby', name: 'Ruby', candidates: ['ruby'], versionArgs: ['--version'], languages: ['ruby'], install: { macos: brew('ruby'), windows: winget('RubyInstallerTeam.Ruby.3.3'), linux: 'sudo apt install ruby' }, url: 'https://www.ruby-lang.org/en/downloads/' },
  { id: 'kotlinc', name: 'Kotlin compiler', candidates: ['kotlinc'], versionArgs: ['-version'], languages: ['kotlin'], install: { macos: brew('kotlin'), windows: 'Download the compiler zip from the Kotlin releases page', linux: 'sudo snap install --classic kotlin' }, url: 'https://kotlinlang.org/docs/command-line.html' },
  { id: 'bash', name: 'Bash', candidates: ['bash'], versionArgs: ['--version'], languages: ['bash'], install: { macos: brew('bash'), windows: winget('Git.Git'), linux: 'sudo apt install bash' }, url: 'https://www.gnu.org/software/bash/' },
  // package managers
  { id: 'npm', name: 'npm', candidates: ['npm'], versionArgs: ['--version'], languages: [], install: { macos: brew('node'), windows: winget('OpenJS.NodeJS.LTS'), linux: 'sudo apt install npm' }, url: 'https://nodejs.org/' },
  { id: 'composer', name: 'Composer', candidates: ['composer'], versionArgs: ['--version'], languages: [], install: { macos: brew('composer'), windows: 'Download Composer-Setup.exe from getcomposer.org', linux: 'sudo apt install composer' }, url: 'https://getcomposer.org/download/' },
  { id: 'gem', name: 'RubyGems', candidates: ['gem'], versionArgs: ['--version'], languages: [], install: { macos: brew('ruby'), windows: winget('RubyInstallerTeam.Ruby.3.3'), linux: 'sudo apt install ruby' }, url: 'https://rubygems.org/pages/download' },
  { id: 'mvn', name: 'Maven', candidates: ['mvn'], versionArgs: ['--version'], languages: [], install: { macos: brew('maven'), windows: winget('Apache.Maven'), linux: 'sudo apt install maven' }, url: 'https://maven.apache.org/download.cgi' },
  { id: 'gradle', name: 'Gradle', candidates: ['gradle'], versionArgs: ['--version'], languages: [], install: { macos: brew('gradle'), windows: winget('Gradle.Gradle'), linux: 'sudo apt install gradle' }, url: 'https://gradle.org/install/' },
];

export const TOOLCHAIN_BY_ID: Record<string, ToolchainSpec> = Object.fromEntries(TOOLCHAINS.map((t) => [t.id, t]));

/** Every executable name the desktop backend is allowed to launch. */
export const ALLOWED_EXECUTABLES: string[] = [...new Set(TOOLCHAINS.flatMap((t) => t.candidates))];

export interface DetectedToolchain {
  id: string;
  found: boolean;
  path?: string;
  version?: string;
}
