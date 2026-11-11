import type { DetectedToolchain, ToolchainSpec, TransportRequest, TransportResponse } from '@blockforge/core';

export type HostOs = 'macos' | 'windows' | 'linux';

export interface ProcessRequest {
  projectId: string;
  /** Toolchain executable name, resolved and checked against the allow-list by the backend. */
  tool?: string;
  /** Path of a build artifact inside the project work directory. */
  artifact?: string;
  args: string[];
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ProcessExit {
  code: number | null;
  timedOut: boolean;
  truncated: boolean;
  killed: boolean;
  error?: string;
}

export interface ProcessHandle {
  write(data: string): Promise<void>;
  kill(): Promise<void>;
  done: Promise<ProcessExit>;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FolderRef {
  path: string;
  name: string;
}

export interface FsEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
}

export interface FsMatch {
  path: string;
  rel: string;
  line: number;
  text: string;
}

export interface TerminalOptions {
  /** Working directory inside the opened folder. */
  cwd?: string;
  /** Use a project's work directory when no folder is given. */
  projectId?: string;
  cols: number;
  rows: number;
  /** Run one command line and exit, instead of an interactive shell. */
  command?: string;
}

export interface TerminalHandle {
  id: string;
  cwd: string;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  close(): Promise<void>;
  /** Resolves with the exit code when the shell or command ends. */
  done: Promise<number | null>;
}

export interface Platform {
  kind: 'desktop' | 'web';
  os: HostOs;
  arch: 'arm64' | 'x86_64';

  detectToolchains(specs: ToolchainSpec[]): Promise<DetectedToolchain[]>;
  writeWorkFiles(projectId: string, files: { path: string; content: string }[]): Promise<string>;
  cleanWork(projectId: string, paths: string[]): Promise<void>;
  spawn(req: ProcessRequest, onData: (stream: 'stdout' | 'stderr', text: string) => void): Promise<ProcessHandle>;
  revealWork(projectId: string): Promise<void>;

  /** Secrets never come back out on desktop; `hasSecret` is the only question the UI can ask. */
  setSecret(providerId: string, value: string, origin: string): Promise<void>;
  hasSecret(providerId: string): Promise<boolean>;
  deleteSecret(providerId: string): Promise<void>;
  /** HTTP for AI providers. The secret is attached outside the web view on desktop. */
  aiSend(req: TransportRequest): Promise<TransportResponse>;
  /** Package registry lookups, limited to known registry hosts. */
  registryGet(url: string, headers?: Record<string, string>): Promise<string>;

  openTextFile(extensions: string[]): Promise<{ name: string; path?: string; text: string } | undefined>;
  saveTextFile(suggestedName: string, text: string, path?: string): Promise<{ path?: string; name: string } | undefined>;
  saveBinaryFile(suggestedName: string, data: Uint8Array): Promise<boolean>;
  openExternal(url: string): Promise<void>;

  /** Folders on disk opened as a workspace. Only the desktop app can do this. */
  workspace: {
    available: boolean;
    pickFolder(): Promise<FolderRef | undefined>;
    recentFolders(): Promise<FolderRef[]>;
    reopenFolder(path: string): Promise<FolderRef>;
    forgetFolder(path: string): Promise<void>;
    list(path: string): Promise<FsEntry[]>;
    read(path: string): Promise<{ text?: string; binary: boolean; size: number }>;
    write(path: string, text: string): Promise<void>;
    create(path: string, dir: boolean): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    /** Moves the item to the system Trash. */
    trash(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
    search(root: string, query: string, max: number): Promise<FsMatch[]>;
  };

  /** Real terminal sessions. Only the desktop app can do this. */
  terminal: {
    available: boolean;
    open(options: TerminalOptions, onData: (bytes: Uint8Array) => void): Promise<TerminalHandle>;
  };

  /** Embedded browser. `native` is a real child web view; otherwise an iframe is used. */
  browser: {
    native: boolean;
    open(url: string, bounds: BrowserBounds): Promise<void>;
    navigate(url: string): Promise<void>;
    setBounds(bounds: BrowserBounds): Promise<void>;
    setVisible(visible: boolean): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    reload(): Promise<void>;
    close(): Promise<void>;
    onNavigate(cb: (url: string) => void): () => void;
  };
}
