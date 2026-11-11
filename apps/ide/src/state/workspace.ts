import { createProject, emptyWorkspace, languageByExtension, type LanguageId, LANGUAGES, type Project, type ProjectFile } from '@blockforge/core';
import { create } from 'zustand';
import { t } from '../i18n';
import { getPlatform } from '../platform';
import type { FolderRef, FsEntry } from '../platform/types';
import { db } from './db';
import { activeFile, useProject } from './project';
import { confirmDialog, promptDialog, useUi } from './ui';

/** A text document in an editor tab: a file on disk or an unsaved buffer. */
export interface TextDoc {
  id: string;
  name: string;
  /** Path on disk; absent for a document that was never saved. */
  path?: string;
  /** How the path was approved: inside the opened folder, or chosen in a file dialog. */
  via?: 'folder' | 'dialog';
  /** A BlockForge language id or one of the extra text formats. */
  language: string;
  text: string;
  /** Text as last saved, to know whether there are unsaved changes. */
  saved: string;
}

export interface TextLanguage {
  id: string;
  name: string;
  monaco: string;
}

const EXTRA: TextLanguage[] = [
  { id: 'json', name: 'JSON', monaco: 'json' },
  { id: 'markdown', name: 'Markdown', monaco: 'markdown' },
  { id: 'yaml', name: 'YAML', monaco: 'yaml' },
  { id: 'xml', name: 'XML', monaco: 'xml' },
  { id: 'toml', name: 'TOML', monaco: 'ini' },
  { id: 'ini', name: 'INI', monaco: 'ini' },
  { id: 'dockerfile', name: 'Dockerfile', monaco: 'dockerfile' },
  { id: 'swift', name: 'Swift', monaco: 'swift' },
  { id: 'powershell', name: 'PowerShell', monaco: 'powershell' },
];

/** Languages offered by the text editor; plain text first. */
export function textLanguages(): TextLanguage[] {
  const code = (Object.keys(LANGUAGES) as LanguageId[]).map((id) => ({ id, name: LANGUAGES[id].name, monaco: LANGUAGES[id].monaco }));
  return [{ id: 'plaintext', name: t('text.plain'), monaco: 'plaintext' }, ...code, ...EXTRA];
}

export function monacoLanguage(id: string): string {
  return (LANGUAGES as Record<string, { monaco: string } | undefined>)[id]?.monaco ?? EXTRA.find((e) => e.id === id)?.monaco ?? 'plaintext';
}

/** The BlockForge language of a text language id, when it is one the app can run. */
export function runnableLanguage(id: string): LanguageId | undefined {
  return id in LANGUAGES ? (id as LanguageId) : undefined;
}

const EXTENSIONS: Record<string, string> = {
  txt: 'plaintext', log: 'plaintext', json: 'json', md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml', plist: 'xml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini',
  h: 'c', hpp: 'cpp', hh: 'cpp', cc: 'cpp', cxx: 'cpp', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', tsx: 'typescript', mts: 'typescript', htm: 'html', zsh: 'bash', sh: 'bash', s: 'assembly', asm: 'assembly', kts: 'kotlin', pyw: 'python', swift: 'swift', ps1: 'powershell',
};

export function languageOfName(name: string): string {
  if (/^dockerfile$/i.test(name)) return 'dockerfile';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXTENSIONS[ext] ?? languageByExtension(ext) ?? 'plaintext';
}

interface WorkspaceStore {
  folder?: FolderRef;
  /** Directory listings by directory path. */
  tree: Record<string, FsEntry[] | undefined>;
  expanded: Record<string, boolean>;
  recentFolders: FolderRef[];
  docs: TextDoc[];
  /** The text document in front; when unset the project file is in front. */
  activeDoc?: string;
  /** Show the home screen instead of the editor. */
  home: boolean;
}

export const useWorkspace = create<WorkspaceStore>(() => ({ tree: {}, expanded: {}, recentFolders: [], docs: [], home: false }));

const ws = () => useWorkspace.getState();
const toastError = (err: unknown) => useUi.getState().toast(String((err as Error)?.message ?? err), 'err');
const sep = () => (getPlatform().os === 'windows' ? '\\' : '/');
export const joinPath = (dir: string, name: string) => (dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}${sep()}${name}`);
const parentOf = (path: string) => path.replace(/[\\/][^\\/]+$/, '');
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function isDirty(doc: TextDoc): boolean {
  return doc.text !== doc.saved;
}

export function activeDoc(s: WorkspaceStore = ws()): TextDoc | undefined {
  return s.activeDoc ? s.docs.find((d) => d.id === s.activeDoc) : undefined;
}

// ----- tabs -----

let docSeq = 0;
const nextDocId = () => `doc-${Date.now().toString(36)}-${++docSeq}`;

function untitledName(): string {
  const used = new Set(ws().docs.map((d) => d.name));
  for (let n = 1; ; n++) {
    const name = `${t('text.untitled')}-${n}`;
    if (!used.has(name)) return name;
  }
}

/** Open a new, empty text tab. Plain text until a language is chosen. */
export function newDoc(language = 'plaintext', text = ''): TextDoc {
  const doc: TextDoc = { id: nextDocId(), name: untitledName(), language, text, saved: '' };
  useWorkspace.setState((s) => ({ docs: [...s.docs, doc], activeDoc: doc.id, home: false }));
  return doc;
}

export function focusDoc(id: string): void {
  useWorkspace.setState({ activeDoc: id, home: false });
}

/** Bring the block project back in front of the text tabs. */
export function focusProject(fileId?: string): void {
  if (fileId) useProject.getState().setActive(fileId);
  useWorkspace.setState({ activeDoc: undefined, home: false });
}

export function goHome(): void {
  useWorkspace.setState({ home: true });
}

export function leaveHome(): void {
  useWorkspace.setState({ home: false });
}

export function setDocText(id: string, text: string): void {
  useWorkspace.setState((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, text } : d)) }));
}

export function setDocLanguage(id: string, language: string): void {
  useWorkspace.setState((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, language } : d)) }));
}

export async function closeDoc(id: string): Promise<void> {
  const doc = ws().docs.find((d) => d.id === id);
  if (!doc) return;
  if (isDirty(doc) && doc.text.trim()) {
    const ok = await confirmDialog({ title: t('text.closeTitle', { name: doc.name }), message: t('text.closeMessage'), confirmLabel: t('text.closeDiscard'), danger: true });
    if (!ok) return;
  }
  useWorkspace.setState((s) => {
    const docs = s.docs.filter((d) => d.id !== id);
    const index = s.docs.findIndex((d) => d.id === id);
    const next = s.activeDoc === id ? (docs[Math.min(index, docs.length - 1)]?.id ?? undefined) : s.activeDoc;
    return { docs, activeDoc: next };
  });
}

/** Open a file of the opened folder in a tab. */
export async function openPath(path: string): Promise<void> {
  const existing = ws().docs.find((d) => d.path === path);
  if (existing) return focusDoc(existing.id);
  try {
    const r = await getPlatform().workspace.read(path);
    if (r.binary || r.text === undefined) {
      useUi.getState().toast(t('explorer.binary', { name: baseName(path) }), 'info');
      return;
    }
    const name = baseName(path);
    const doc: TextDoc = { id: nextDocId(), name, path, via: 'folder', language: languageOfName(name), text: r.text, saved: r.text };
    useWorkspace.setState((s) => ({ docs: [...s.docs, doc], activeDoc: doc.id, home: false }));
  } catch (err) {
    toastError(err);
  }
}

/** Open a single file chosen in the system file dialog. */
export async function openFileDialog(): Promise<void> {
  try {
    const file = await getPlatform().openTextFile([]);
    if (!file) return;
    const existing = file.path ? ws().docs.find((d) => d.path === file.path) : undefined;
    if (existing) return focusDoc(existing.id);
    const doc: TextDoc = { id: nextDocId(), name: file.name, path: file.path, via: file.path ? 'dialog' : undefined, language: languageOfName(file.name), text: file.text, saved: file.text };
    useWorkspace.setState((s) => ({ docs: [...s.docs, doc], activeDoc: doc.id, home: false }));
  } catch (err) {
    toastError(err);
  }
}

/** Save a text tab. A document without a path asks where to save. */
export async function saveDoc(id: string, saveAs = false): Promise<boolean> {
  const doc = ws().docs.find((d) => d.id === id);
  if (!doc) return false;
  const platform = getPlatform();
  try {
    if (doc.path && doc.via === 'folder' && !saveAs) {
      await platform.workspace.write(doc.path, doc.text);
      useWorkspace.setState((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, saved: doc.text } : d)) }));
      return true;
    }
    const lang = runnableLanguage(doc.language);
    const suggested = doc.path || /\.\w+$/.test(doc.name) ? doc.name : `${doc.name}.${lang ? LANGUAGES[lang].ext : doc.language === 'plaintext' ? 'txt' : doc.language === 'markdown' ? 'md' : doc.language}`;
    const saved = await platform.saveTextFile(suggested, doc.text, saveAs ? undefined : doc.path);
    if (!saved) return false;
    useWorkspace.setState((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, name: saved.name, path: saved.path, via: saved.path ? 'dialog' : undefined, saved: doc.text, language: d.language === 'plaintext' ? languageOfName(saved.name) : d.language } : d)),
    }));
    // A file saved into the opened folder should show up in the tree.
    if (saved.path && ws().folder && saved.path.startsWith(ws().folder!.path)) void loadDir(parentOf(saved.path));
    return true;
  } catch (err) {
    toastError(err);
    return false;
  }
}

// ----- folder -----

export async function loadDir(path: string): Promise<void> {
  try {
    const entries = await getPlatform().workspace.list(path);
    useWorkspace.setState((s) => ({ tree: { ...s.tree, [path]: entries } }));
  } catch (err) {
    toastError(err);
  }
}

export async function toggleDir(path: string): Promise<void> {
  const open = !ws().expanded[path];
  useWorkspace.setState((s) => ({ expanded: { ...s.expanded, [path]: open } }));
  if (open) await loadDir(path);
}

/** Read again every directory that is shown. */
export async function refreshTree(): Promise<void> {
  const { folder, expanded } = ws();
  if (!folder) return;
  await Promise.all([folder.path, ...Object.keys(expanded).filter((p) => expanded[p])].map(loadDir));
}

async function adoptFolder(folder: FolderRef): Promise<void> {
  useWorkspace.setState({ folder, tree: {}, expanded: {} });
  await loadDir(folder.path);
  void refreshRecentFolders();
}

export async function refreshRecentFolders(): Promise<void> {
  try {
    useWorkspace.setState({ recentFolders: await getPlatform().workspace.recentFolders() });
  } catch {
    // The list is a convenience; without it the folder can still be picked.
  }
}

export async function openFolder(): Promise<void> {
  try {
    const folder = await getPlatform().workspace.pickFolder();
    if (folder) await adoptFolder(folder);
  } catch (err) {
    toastError(err);
  }
}

export async function openRecentFolder(path: string): Promise<void> {
  try {
    await adoptFolder(await getPlatform().workspace.reopenFolder(path));
  } catch (err) {
    toastError(err);
    void refreshRecentFolders();
  }
}

export function closeFolder(): void {
  useWorkspace.setState({ folder: undefined, tree: {}, expanded: {} });
}

const validName = (name: string) => !!name && name !== '.' && name !== '..' && !/[\\/\0]/.test(name);

export async function createEntry(parent: string, dir: boolean): Promise<void> {
  const name = (await promptDialog({ title: t(dir ? 'explorer.newFolder' : 'explorer.newFile'), message: '', placeholder: dir ? 'src' : 'main.py', confirmLabel: t('explorer.create') }))?.trim();
  if (name === undefined) return;
  if (!validName(name)) return useUi.getState().toast(t('explorer.badName'), 'err');
  const path = joinPath(parent, name);
  try {
    await getPlatform().workspace.create(path, dir);
    useWorkspace.setState((s) => ({ expanded: { ...s.expanded, [parent]: true } }));
    await loadDir(parent);
    if (!dir) await openPath(path);
  } catch (err) {
    toastError(err);
  }
}

export async function renameEntry(entry: FsEntry): Promise<void> {
  const name = (await promptDialog({ title: t('explorer.rename'), message: '', value: entry.name, confirmLabel: t('explorer.rename') }))?.trim();
  if (name === undefined || name === entry.name) return;
  if (!validName(name)) return useUi.getState().toast(t('explorer.badName'), 'err');
  const parent = parentOf(entry.path);
  const to = joinPath(parent, name);
  try {
    await getPlatform().workspace.rename(entry.path, to);
    // Open tabs follow the file to its new name.
    useWorkspace.setState((s) => ({
      docs: s.docs.map((d) => (d.path === entry.path ? { ...d, path: to, name } : d.path?.startsWith(entry.path + sep()) ? { ...d, path: to + d.path.slice(entry.path.length) } : d)),
    }));
    await loadDir(parent);
  } catch (err) {
    toastError(err);
  }
}

export async function trashEntry(entry: FsEntry): Promise<void> {
  const ok = await confirmDialog({ title: t('explorer.deleteTitle', { name: entry.name }), message: t(entry.dir ? 'explorer.deleteFolderMessage' : 'explorer.deleteMessage'), confirmLabel: t('explorer.moveToTrash'), danger: true });
  if (!ok) return;
  try {
    await getPlatform().workspace.trash(entry.path);
    useWorkspace.setState((s) => {
      const docs = s.docs.filter((d) => d.path !== entry.path && !d.path?.startsWith(entry.path + sep()));
      return { docs, activeDoc: docs.some((d) => d.id === s.activeDoc) ? s.activeDoc : undefined };
    });
    await loadDir(parentOf(entry.path));
  } catch (err) {
    toastError(err);
  }
}

// ----- running -----

/**
 * What the Run button acts on: the active block-project file, or the text tab in
 * front, wrapped as a one-file project so the same build pipeline applies.
 */
export function runTarget(): { file: ProjectFile; project: Project } | undefined {
  const doc = activeDoc();
  if (doc) {
    const lang = runnableLanguage(doc.language);
    if (!lang) return undefined;
    // An unsaved buffer takes the conventional entry name (Java needs Main.java).
    const name = doc.path || new RegExp(`\\.${LANGUAGES[lang].ext}$`, 'i').test(doc.name) ? doc.name : LANGUAGES[lang].entry;
    const file: ProjectFile = { id: doc.id, name, language: lang, mode: 'code', blocks: emptyWorkspace(), code: doc.text };
    const project = createProject('scratch', lang);
    return { file, project: { ...project, id: `scratch-${doc.id}`.slice(0, 64), files: [file], activeFileId: file.id } };
  }
  const project = useProject.getState().project;
  const file = activeFile();
  return project && file ? { file, project } : undefined;
}

// ----- persistence -----

interface Saved {
  folder?: string;
  docs: TextDoc[];
  activeDoc?: string;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
let restored = false;

let frozen = false;

/** Stop saving tabs and the folder, for runs that must leave the user's state alone. */
export function freezeWorkspace(): void {
  frozen = true;
  clearTimeout(persistTimer);
}

function persist(): void {
  if (!restored || frozen) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = ws();
    // Very large buffers are left out so the saved state stays small.
    const docs = s.docs.filter((d) => d.text.length < 2_000_000);
    void db.set('kv', 'workspace', { folder: s.folder?.path, docs, activeDoc: s.activeDoc } satisfies Saved);
  }, 500);
}

/** Bring back the folder and the text tabs of the last session. */
export async function restoreWorkspace(): Promise<void> {
  try {
    const saved = await db.get<Saved>('kv', 'workspace');
    const platform = getPlatform();
    if (saved?.docs?.length) {
      const docs: TextDoc[] = [];
      for (const d of saved.docs) {
        if (typeof d?.id !== 'string' || typeof d.text !== 'string') continue;
        docs.push({ id: d.id, name: String(d.name ?? 'file'), path: d.path, via: d.via, language: String(d.language ?? 'plaintext'), text: d.text, saved: String(d.saved ?? '') });
      }
      useWorkspace.setState({ docs, activeDoc: docs.some((d) => d.id === saved.activeDoc) ? saved.activeDoc : undefined });
    }
    if (platform.workspace.available) {
      await refreshRecentFolders();
      if (saved?.folder) {
        try {
          await adoptFolder(await platform.workspace.reopenFolder(saved.folder));
        } catch {
          // The folder moved or was removed; start without one.
        }
      }
    }
  } finally {
    restored = true;
  }
}

useWorkspace.subscribe((s, prev) => {
  if (s.docs !== prev.docs || s.folder !== prev.folder || s.activeDoc !== prev.activeDoc) persist();
});

// Activating or loading a project file brings the project in front of the text tabs.
useProject.subscribe((s, prev) => {
  if (s.project && (s.project.id !== prev.project?.id || s.project.activeFileId !== prev.project?.activeFileId)) useWorkspace.setState({ activeDoc: undefined, home: false });
});
