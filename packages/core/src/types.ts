/** Shared public types for BlockForge core. */

export const LANGUAGE_IDS = [
  'python',
  'javascript',
  'typescript',
  'c',
  'cpp',
  'java',
  'csharp',
  'lua',
  'html',
  'css',
  'php',
  'go',
  'rust',
  'sql',
  'dart',
  'assembly',
  'ruby',
  'kotlin',
  'bash',
] as const;

export type LanguageId = (typeof LANGUAGE_IDS)[number];

/** A block domain decides which block vocabulary and IR a file uses. */
export type Domain = 'imperative' | 'web' | 'sql' | 'asm';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  /** Stable machine code, also used as the localisation key. */
  code: string;
  /** English fallback message. */
  message: string;
  /** Values interpolated into the localised message. */
  params?: Record<string, string | number>;
  blockId?: string;
  file?: string;
  /** 1-based line and column. */
  line?: number;
  column?: number;
  endLine?: number;
  source: 'blocks' | 'analysis' | 'generator' | 'compiler' | 'runtime';
}

export interface SourceMapping {
  blockId: string;
  file: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
}

export interface GeneratedFile {
  path: string;
  content: string;
  role: 'main' | 'config' | 'aux';
}

export interface DependencyRef {
  manager: string;
  name: string;
  version?: string;
}

export type AsmArch = 'arm64' | 'x86_64';
export type AsmPlatform = 'macos' | 'linux';
export type SqlDialect = 'sqlite' | 'postgres' | 'mysql';

export interface GenOptions {
  /** Base file name without extension. */
  baseName?: string;
  indent?: number;
  sqlDialect?: SqlDialect;
  /** Fallbacks when an assembly program block does not specify them. */
  asmArch?: AsmArch;
  asmPlatform?: AsmPlatform;
  /** Emit comment blocks into the output. */
  comments?: boolean;
}

export interface GenResult {
  language: LanguageId;
  files: GeneratedFile[];
  mappings: SourceMapping[];
  dependencies: DependencyRef[];
  diagnostics: Diagnostic[];
  meta: {
    entryFile: string;
    languageName: string;
    /** e.g. "arm64-macos" for assembly, "sqlite" for SQL. */
    variant?: string;
    /** Feature keys used by the program, for the support matrix. */
    features: string[];
  };
  requirements: {
    /** Toolchain ids needed to build or run the output. */
    toolchains: string[];
    notes: string[];
  };
}

export function hasErrors(diags: Diagnostic[]): boolean {
  return diags.some((d) => d.severity === 'error');
}

export function diag(
  severity: Severity,
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic {
  return { severity, code, message, source: 'generator', ...extra };
}
