import { blockAtLine, createFile, createProject, defaultFileName, type DependencyRef, domainOf, generate, type GenResult, LANGUAGES, type LanguageId, parseProject, type Project, type ProjectFile, serializeProject, uniqueFileName, type WorkspaceState } from '@blockforge/core';
import { create } from 'zustand';
import { db, type StoredProject } from './db';
import { useSettings } from './settings';

export interface Checkpoint {
  id: number;
  label: string;
  at: number;
  snapshot: string;
}

interface ProjectStore {
  project?: Project;
  /** Path on disk when the project was opened from or saved to a file (desktop). */
  filePath?: string;
  dirty: boolean;
  /** Latest generation result per file id. */
  results: Record<string, GenResult>;
  /** Bumped whenever blocks are replaced from outside the block editor. */
  blocksRevision: number;
  openTabs: string[];
  checkpoints: Checkpoint[];
  recent: StoredProject[];

  load: (p: Project, filePath?: string) => void;
  close: () => void;
  setActive: (fileId: string) => void;
  closeTab: (fileId: string) => void;
  updateBlocks: (fileId: string, blocks: WorkspaceState) => void;
  replaceBlocks: (fileId: string, blocks: WorkspaceState) => void;
  updateCode: (fileId: string, code: string) => void;
  setMode: (fileId: string, mode: ProjectFile['mode']) => void;
  setLanguage: (fileId: string, lang: LanguageId) => void;
  addFile: (lang: LanguageId, name?: string, blocks?: WorkspaceState, code?: string) => ProjectFile | undefined;
  renameFile: (fileId: string, name: string) => void;
  deleteFile: (fileId: string) => void;
  patch: (fn: (p: Project) => void) => void;
  setDependencies: (deps: DependencyRef[]) => void;
  regenerate: (fileId: string) => Promise<GenResult | undefined>;
  checkpoint: (label: string) => number;
  restore: (id: number) => void;
  save: () => Promise<void>;
  refreshRecent: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

let checkpointId = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function genOptions(p: Project) {
  return { sqlDialect: p.settings.sqlDialect, asmArch: p.settings.asmArch, asmPlatform: p.settings.asmPlatform };
}

function scheduleSave() {
  const { autosave } = useSettings.getState();
  clearTimeout(saveTimer);
  // The recovery copy is always written; the project store follows the autosave setting.
  saveTimer = setTimeout(() => {
    const s = useProject.getState();
    if (!s.project) return;
    void db.set('kv', 'recovery', { at: Date.now(), data: serializeProject(s.project) });
    if (autosave.enabled) void s.save();
  }, autosave.delayMs);
}

export const useProject = create<ProjectStore>((set, get) => {
  const touch = (fn: (p: Project) => void, opts: { dirty?: boolean } = {}) => {
    const cur = get().project;
    if (!cur) return;
    const next: Project = { ...cur, files: cur.files.map((f) => ({ ...f })), dependencies: [...cur.dependencies], settings: { ...cur.settings }, build: { ...cur.build } };
    fn(next);
    next.updatedAt = new Date().toISOString();
    set({ project: next, dirty: opts.dirty ?? true });
    scheduleSave();
  };

  const queueGenerate = (fileId: string, delay = 120) => {
    clearTimeout(timers.get(fileId));
    timers.set(
      fileId,
      setTimeout(() => void get().regenerate(fileId), delay),
    );
  };

  return {
    dirty: false,
    results: {},
    blocksRevision: 0,
    openTabs: [],
    checkpoints: [],
    recent: [],

    load: (p, filePath) => {
      set({ project: p, filePath, dirty: false, results: {}, openTabs: p.activeFileId ? [p.activeFileId] : p.files.slice(0, 1).map((f) => f.id), checkpoints: [], blocksRevision: get().blocksRevision + 1 });
      for (const f of p.files) queueGenerate(f.id, 0);
    },
    close: () => set({ project: undefined, filePath: undefined, dirty: false, results: {}, openTabs: [], checkpoints: [] }),

    setActive: (fileId) => {
      const tabs = get().openTabs;
      set({ openTabs: tabs.includes(fileId) ? tabs : [...tabs, fileId] });
      touch((p) => (p.activeFileId = fileId), { dirty: get().dirty });
    },
    closeTab: (fileId) => {
      const tabs = get().openTabs.filter((t) => t !== fileId);
      set({ openTabs: tabs });
      const p = get().project;
      if (p?.activeFileId === fileId) touch((x) => (x.activeFileId = tabs[tabs.length - 1]), { dirty: get().dirty });
    },

    updateBlocks: (fileId, blocks) => {
      touch((p) => {
        const f = p.files.find((x) => x.id === fileId);
        if (f) f.blocks = blocks;
      });
      queueGenerate(fileId);
    },
    replaceBlocks: (fileId, blocks) => {
      touch((p) => {
        const f = p.files.find((x) => x.id === fileId);
        if (f) f.blocks = blocks;
      });
      set({ blocksRevision: get().blocksRevision + 1 });
      queueGenerate(fileId, 0);
    },
    updateCode: (fileId, code) =>
      touch((p) => {
        const f = p.files.find((x) => x.id === fileId);
        if (f) f.code = code;
      }),
    setMode: (fileId, mode) => {
      touch((p) => {
        const f = p.files.find((x) => x.id === fileId);
        if (f) f.mode = mode;
      });
      if (mode === 'blocks') queueGenerate(fileId, 0);
    },
    setLanguage: (fileId, lang) => {
      touch((p) => {
        const f = p.files.find((x) => x.id === fileId);
        if (!f) return;
        const sameDomain = domainOf(f.language) === domainOf(lang);
        const wasDefault = f.name === defaultFileName(f.language) || f.name.replace(/\.[^.]*$/, '') === defaultFileName(f.language).replace(/\.[^.]*$/, '');
        const stem = f.name.replace(/\.[^.]*$/, '');
        f.language = lang;
        const wanted = wasDefault ? defaultFileName(lang) : `${stem}.${LANGUAGES[lang].ext}`;
        f.name = f.name === wanted ? wanted : uniqueFileName({ ...p, files: p.files.filter((x) => x.id !== fileId) }, wanted);
        // Blocks of another domain do not carry over; they are kept only within a domain.
        if (!sameDomain) f.blocks = { blocks: { languageVersion: 0, blocks: [] }, variables: [] };
        f.mode = 'blocks';
      });
      set({ blocksRevision: get().blocksRevision + 1 });
      queueGenerate(fileId, 0);
    },
    addFile: (lang, name, blocks, code) => {
      const p = get().project;
      if (!p) return undefined;
      const file = createFile(lang, uniqueFileName(p, name ?? defaultFileName(lang)), blocks);
      if (code !== undefined) {
        file.code = code;
        file.mode = 'code';
      }
      touch((x) => {
        x.files.push(file);
        x.activeFileId = file.id;
      });
      set({ openTabs: [...get().openTabs, file.id] });
      queueGenerate(file.id, 0);
      return file;
    },
    renameFile: (fileId, name) =>
      touch((p) => {
        const f = p.files.find((x) => x.id === fileId);
        const clean = name.trim().replace(/[\\/]+/g, '_');
        if (f && clean) f.name = uniqueFileName({ ...p, files: p.files.filter((x) => x.id !== fileId) }, clean);
      }),
    deleteFile: (fileId) => {
      const p = get().project;
      if (!p || p.files.length <= 1) return;
      const tabs = get().openTabs.filter((t) => t !== fileId);
      touch((x) => {
        x.files = x.files.filter((f) => f.id !== fileId);
        if (x.activeFileId === fileId) x.activeFileId = tabs[tabs.length - 1] ?? x.files[0].id;
      });
      const results = { ...get().results };
      delete results[fileId];
      set({ openTabs: tabs.length ? tabs : [get().project!.activeFileId!], results });
    },
    patch: (fn) => touch(fn),
    setDependencies: (deps) => touch((p) => (p.dependencies = deps)),

    regenerate: async (fileId) => {
      const p = get().project;
      const f = p?.files.find((x) => x.id === fileId);
      if (!p || !f) return undefined;
      const base = f.name.replace(/\.[^.]*$/, '');
      const result = await generate(f.blocks, f.language, { ...genOptions(p), baseName: base });
      // The file may have changed while generating; only the newest result is kept.
      const now = get().project?.files.find((x) => x.id === fileId);
      if (!now || now.blocks !== f.blocks || now.language !== f.language) return undefined;
      set({ results: { ...get().results, [fileId]: result } });
      if (now.mode === 'blocks' && now.code !== result.files[0].content) {
        const cur = get().project!;
        set({ project: { ...cur, files: cur.files.map((x) => (x.id === fileId ? { ...x, code: result.files[0].content } : x)) } });
      }
      return result;
    },

    checkpoint: (label) => {
      const p = get().project;
      if (!p) return -1;
      const id = ++checkpointId;
      set({ checkpoints: [...get().checkpoints.slice(-19), { id, label, at: Date.now(), snapshot: serializeProject(p) }] });
      return id;
    },
    restore: (id) => {
      const cp = get().checkpoints.find((c) => c.id === id);
      if (!cp) return;
      const parsed = parseProject(cp.snapshot);
      if (!parsed.project) return;
      set({ project: parsed.project, dirty: true, blocksRevision: get().blocksRevision + 1, results: {} });
      for (const f of parsed.project.files) queueGenerate(f.id, 0);
      scheduleSave();
    },

    save: async () => {
      const p = get().project;
      if (!p) return;
      const stored: StoredProject = { id: p.id, name: p.name, updatedAt: p.updatedAt, languages: [...new Set(p.files.map((f) => f.language))], data: serializeProject(p) };
      await db.set('projects', p.id, stored);
      set({ dirty: false });
      await get().refreshRecent();
    },
    refreshRecent: async () => {
      const all = await db.all<StoredProject>('projects');
      set({ recent: all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    },
    remove: async (id) => {
      await db.del('projects', id);
      if (get().project?.id === id) get().close();
      await get().refreshRecent();
    },
  };
});

export function activeFile(s: { project?: Project } = useProject.getState()): ProjectFile | undefined {
  const p = s.project;
  return p?.files.find((f) => f.id === p.activeFileId) ?? p?.files[0];
}

/** Open a stored project by id. */
export async function openStored(id: string): Promise<boolean> {
  const stored = await db.get<StoredProject>('projects', id);
  if (!stored) return false;
  const parsed = parseProject(stored.data);
  if (!parsed.project) return false;
  useProject.getState().load(parsed.project);
  return true;
}

export function newProject(name: string, lang: LanguageId, blocks?: WorkspaceState): Project {
  const p = createProject(name, lang, blocks);
  useProject.getState().load(p);
  void useProject.getState().save();
  return p;
}

/** Block that produced a source line of the active file, if any. */
export function blockForLine(fileId: string, line: number): string | undefined {
  const r = useProject.getState().results[fileId];
  return r ? blockAtLine(r, r.meta.entryFile, line) : undefined;
}
