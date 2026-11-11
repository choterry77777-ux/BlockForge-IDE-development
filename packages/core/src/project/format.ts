import { containsSecretLikeKeys } from '../ai/secrets';
import { emptyWorkspace, genId, type WorkspaceState } from '../blocks/state';
import { validateWorkspace } from '../blocks/validate';
import { type BuildConfig, DEFAULT_BUILD_CONFIG } from '../build/recipes';
import { domainOf, LANGUAGES } from '../langs';
import { type AsmArch, type AsmPlatform, type DependencyRef, LANGUAGE_IDS, type LanguageId, type SqlDialect } from '../types';

export const PROJECT_FORMAT = 'blockforge-project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = 'bfproj';

/**
 * Who owns the text of a file.
 * blocks: the code is regenerated from blocks on every change.
 * code: the user edited the text; blocks are kept but no longer drive it.
 */
export type FileMode = 'blocks' | 'code';

export interface ProjectFile {
  id: string;
  name: string;
  language: LanguageId;
  mode: FileMode;
  blocks: WorkspaceState;
  /** Generated code (blocks mode) or user-owned source (code mode). */
  code: string;
}

export interface ProjectSettings {
  sqlDialect: SqlDialect;
  asmArch: AsmArch;
  asmPlatform: AsmPlatform;
  /** Text fed to programs that read input. */
  stdin: string;
  /** Glob patterns of files the AI assistant may never read or change. */
  aiExclude: string[];
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  files: ProjectFile[];
  activeFileId?: string;
  dependencies: DependencyRef[];
  build: BuildConfig;
  settings: ProjectSettings;
  /** Layout hints restored with the project. Never contains credentials. */
  ui?: Record<string, unknown>;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { sqlDialect: 'sqlite', asmArch: 'arm64', asmPlatform: 'macos', stdin: '', aiExclude: ['.env', '*.pem', '*.key', 'secrets/**'] };

export function defaultFileName(lang: LanguageId): string {
  return LANGUAGES[lang].entry;
}

export function createFile(lang: LanguageId, name = defaultFileName(lang), blocks: WorkspaceState = emptyWorkspace()): ProjectFile {
  return { id: genId(12), name, language: lang, mode: 'blocks', blocks, code: '' };
}

export function createProject(name: string, lang: LanguageId, blocks?: WorkspaceState): Project {
  const now = new Date().toISOString();
  const file = createFile(lang, defaultFileName(lang), blocks);
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, id: genId(12), name, createdAt: now, updatedAt: now, files: [file], activeFileId: file.id, dependencies: [], build: { ...DEFAULT_BUILD_CONFIG }, settings: { ...DEFAULT_PROJECT_SETTINGS } };
}

/** Text of a project file. Refuses to write anything that looks like a credential. */
export function serializeProject(p: Project): string {
  const clean: Project = { ...p, format: PROJECT_FORMAT, version: PROJECT_VERSION };
  if (containsSecretLikeKeys(clean.ui) || containsSecretLikeKeys(clean.settings) || containsSecretLikeKeys(clean.build)) {
    throw new Error('Refusing to save: the project data contains what looks like an API key or password.');
  }
  return JSON.stringify(clean, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Read and validate a project file, upgrading older versions. */
export function parseProject(text: string): { project?: Project; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { errors: [`The file is not valid JSON: ${(err as Error).message}`], warnings };
  }
  if (!isObj(raw) || raw.format !== PROJECT_FORMAT) return { errors: ['This is not a BlockForge project file.'], warnings };
  const version = Number(raw.version);
  if (!Number.isInteger(version) || version < 1) return { errors: ['The project file has no valid version.'], warnings };
  if (version > PROJECT_VERSION) return { errors: [`The project was saved by a newer BlockForge (format ${version}). This version reads up to format ${PROJECT_VERSION}.`], warnings };
  if (!Array.isArray(raw.files) || !raw.files.length) return { errors: ['The project contains no files.'], warnings };

  const files: ProjectFile[] = [];
  const names = new Set<string>();
  raw.files.forEach((f, i) => {
    if (!isObj(f)) return errors.push(`File ${i + 1} is malformed.`);
    const language = f.language as LanguageId;
    if (!LANGUAGE_IDS.includes(language)) return errors.push(`File ${i + 1} uses an unknown language "${String(f.language)}".`);
    let name = typeof f.name === 'string' && f.name.trim() ? f.name.trim().replace(/[\\/]+/g, '_') : defaultFileName(language);
    while (names.has(name)) name = name.replace(/(\.[^.]*)?$/, (ext) => `_${i + 1}${ext}`);
    names.add(name);
    const blocks = isObj(f.blocks) ? (f.blocks as WorkspaceState) : emptyWorkspace();
    const issues = validateWorkspace(blocks, domainOf(language));
    if (issues.length) warnings.push(`${name}: ${issues.length} block problem(s), first: ${issues[0].message}`);
    files.push({ id: typeof f.id === 'string' && f.id ? f.id : genId(12), name, language, mode: f.mode === 'code' ? 'code' : 'blocks', blocks, code: typeof f.code === 'string' ? f.code : '' });
  });
  if (errors.length) return { errors, warnings };

  const settings = isObj(raw.settings) ? raw.settings : {};
  const build = isObj(raw.build) ? raw.build : {};
  const now = new Date().toISOString();
  const project: Project = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: typeof raw.id === 'string' && raw.id ? raw.id : genId(12),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    files,
    activeFileId: files.some((f) => f.id === raw.activeFileId) ? (raw.activeFileId as string) : files[0].id,
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.filter((d): d is DependencyRef => isObj(d) && typeof d.manager === 'string' && typeof d.name === 'string').map((d) => ({ manager: d.manager, name: d.name, version: typeof d.version === 'string' ? d.version : undefined })) : [],
    build: { ...DEFAULT_BUILD_CONFIG, ...(build as Partial<BuildConfig>) },
    settings: {
      sqlDialect: ['sqlite', 'postgres', 'mysql'].includes(settings.sqlDialect as string) ? (settings.sqlDialect as SqlDialect) : 'sqlite',
      asmArch: settings.asmArch === 'x86_64' ? 'x86_64' : 'arm64',
      asmPlatform: settings.asmPlatform === 'linux' ? 'linux' : 'macos',
      stdin: typeof settings.stdin === 'string' ? settings.stdin : '',
      aiExclude: Array.isArray(settings.aiExclude) ? settings.aiExclude.filter((x): x is string => typeof x === 'string') : [...DEFAULT_PROJECT_SETTINGS.aiExclude],
    },
    ui: isObj(raw.ui) && !containsSecretLikeKeys(raw.ui) ? raw.ui : undefined,
  };
  if (isObj(raw.ui) && containsSecretLikeKeys(raw.ui)) warnings.push('Stored interface data looked like it contained credentials and was dropped.');
  return { project, errors, warnings };
}

export function duplicateProject(p: Project, name: string): Project {
  const copy: Project = JSON.parse(JSON.stringify(p));
  const now = new Date().toISOString();
  const idMap = new Map<string, string>();
  for (const f of copy.files) {
    const id = genId(12);
    idMap.set(f.id, id);
    f.id = id;
  }
  return { ...copy, id: genId(12), name, createdAt: now, updatedAt: now, activeFileId: copy.activeFileId ? idMap.get(copy.activeFileId) : copy.files[0]?.id };
}

/** A file name that is unique within the project. */
export function uniqueFileName(p: Project, wanted: string): string {
  const names = new Set(p.files.map((f) => f.name));
  if (!names.has(wanted)) return wanted;
  const dot = wanted.lastIndexOf('.');
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted;
  const ext = dot > 0 ? wanted.slice(dot) : '';
  for (let n = 2; ; n++) if (!names.has(`${stem}${n}${ext}`)) return `${stem}${n}${ext}`;
}
