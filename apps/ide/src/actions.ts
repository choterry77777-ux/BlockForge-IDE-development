import { domainOf, duplicateProject, type Example, examplesFor, generate, importJavaScript, LANGUAGES, languageByExtension, type LanguageId, manifestsFor, parseProject, PROJECT_EXTENSION, serializeProject, type WorkspaceState } from '@blockforge/core';
import { strToU8, zipSync } from 'fflate';
import * as dsl from '../../../packages/core/src/blocks/dsl';
import { t } from './i18n';
import { getPlatform } from './platform';
import { db } from './state/db';
import { activeFile, newProject, useProject } from './state/project';
import { confirmDialog, promptDialog, useUi } from './state/ui';

const toast = (text: string, kind?: 'ok' | 'err' | 'info') => useUi.getState().toast(text, kind);

/** Starting blocks for a new file, so the workspace is never a blank page. */
export function starterBlocks(lang: LanguageId): WorkspaceState {
  switch (domainOf(lang)) {
    case 'imperative':
      return dsl.workspace(dsl.start(dsl.print(dsl.text('Hello, World!'))));
    case 'web':
      return lang === 'css' ? examplesFor('css')[0].build() : dsl.workspace([{ type: 'web_document', fields: { TITLE: 'My page', LANG: 'en' }, statements: { BODY: [{ type: 'web_text_element', fields: { TAG: 'h1', TEXT: 'Hello, World!', ID: '', CLASS: '' } }] } }]);
    case 'sql':
      return dsl.workspace([
        { type: 'sql_create_table', fields: { NAME: 'notes', IFNE: true }, statements: { COLUMNS: [{ type: 'sql_column', fields: { NAME: 'id', TYPE: 'INTEGER', PK: true, AI: true, NN: false, UQ: false, DEFAULT: '' } }, { type: 'sql_column', fields: { NAME: 'body', TYPE: 'TEXT', PK: false, AI: false, NN: true, UQ: false, DEFAULT: '' } }] } },
        { type: 'sql_insert', fields: { TABLE: 'notes', COLUMNS: 'body' }, inputs: { VALUES: dsl.list(dsl.text('Hello, World!')) } },
        { type: 'sql_select', fields: { DISTINCT: false, FROM: 'notes' } },
      ]);
    case 'asm': {
      const arch = getPlatform().arch === 'x86_64' ? 'x86_64' : 'arm64';
      return dsl.workspace([{ type: 'asm_program', fields: { ARCH: arch, PLATFORM: getPlatform().os === 'linux' ? 'linux' : 'macos' }, statements: { BODY: [{ type: 'asm_print_text', fields: { TEXT: 'Hello, World!', NEWLINE: true } }, { type: 'asm_exit', fields: { CODE: 0 } }] } }]);
    }
  }
}

export async function guardUnsaved(): Promise<boolean> {
  const s = useProject.getState();
  if (!s.project || !s.dirty) return true;
  await s.save();
  return true;
}

export async function createNewProject(lang: LanguageId, name?: string, blocks?: WorkspaceState): Promise<void> {
  await guardUnsaved();
  newProject(name?.trim() || t('project.untitled'), lang, blocks ?? starterBlocks(lang));
  useUi.getState().close();
}

export async function openExample(ex: Example, lang: LanguageId): Promise<void> {
  await guardUnsaved();
  newProject(t(`example.${ex.id}`) === `example.${ex.id}` ? ex.title : t(`example.${ex.id}`), lang, ex.build());
  useUi.getState().close();
}

export async function openProjectFile(): Promise<void> {
  const picked = await getPlatform().openTextFile([PROJECT_EXTENSION, 'json']);
  if (!picked) return;
  const parsed = parseProject(picked.text);
  if (!parsed.project) {
    toast(parsed.errors[0] ?? t('project.openFailed'), 'err');
    return;
  }
  await guardUnsaved();
  useProject.getState().load(parsed.project, picked.path);
  await useProject.getState().save();
  if (parsed.warnings.length) toast(parsed.warnings[0], 'info');
  useUi.getState().close();
}

export async function saveProject(): Promise<void> {
  const s = useProject.getState();
  if (!s.project) return;
  await s.save();
  // A project opened from disk is written back to the same file.
  if (s.filePath) await getPlatform().saveTextFile(`${s.project.name}.${PROJECT_EXTENSION}`, serializeProject(s.project), s.filePath);
  toast(t('project.saved'), 'ok');
}

export async function saveProjectAs(): Promise<void> {
  const s = useProject.getState();
  if (!s.project) return;
  const r = await getPlatform().saveTextFile(`${s.project.name.replace(/[\\/:*?"<>|]+/g, '_')}.${PROJECT_EXTENSION}`, serializeProject(s.project));
  if (!r) return;
  if (r.path) useProject.setState({ filePath: r.path });
  await s.save();
  toast(t('project.exported', { name: r.name }), 'ok');
}

export async function renameProject(): Promise<void> {
  const p = useProject.getState().project;
  if (!p) return;
  const name = await promptDialog({ title: t('project.rename'), message: '', value: p.name });
  if (name?.trim()) useProject.getState().patch((x) => (x.name = name.trim()));
}

export async function duplicateCurrent(): Promise<void> {
  const p = useProject.getState().project;
  if (!p) return;
  await useProject.getState().save();
  const copy = duplicateProject(p, t('project.copyOf', { name: p.name }));
  useProject.getState().load(copy);
  await useProject.getState().save();
  toast(t('project.duplicated'), 'ok');
}

export async function deleteProject(id: string, name: string): Promise<void> {
  const ok = await confirmDialog({ title: t('project.deleteTitle'), message: t('project.deleteMessage', { name }), danger: true, confirmLabel: t('common.delete') });
  if (ok) await useProject.getState().remove(id);
}

/** Source files, dependency manifests and the project file in one archive. */
export async function exportZip(languages?: LanguageId[]): Promise<void> {
  const s = useProject.getState();
  const p = s.project;
  if (!p) return;
  const files: Record<string, Uint8Array> = {};
  for (const f of p.files) files[f.name] = strToU8(f.code);
  // The same blocks in other languages, when asked for.
  for (const lang of languages ?? []) {
    for (const f of p.files) {
      if (f.mode !== 'blocks' || f.language === lang || domainOf(f.language) !== domainOf(lang)) continue;
      const r = await generate(f.blocks, lang, { baseName: f.name.replace(/\.[^.]*$/, '') });
      if (!r.diagnostics.some((d) => d.severity === 'error')) files[`${LANGUAGES[lang].name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${r.files[0].path}`] = strToU8(r.files[0].content);
    }
  }
  for (const m of manifestsFor(p.dependencies, p.name)) files[m.path] = strToU8(m.content);
  files[`${p.name.replace(/[\\/:*?"<>|]+/g, '_')}.${PROJECT_EXTENSION}`] = strToU8(serializeProject(p));
  const ok = await getPlatform().saveBinaryFile(`${p.name.replace(/[\\/:*?"<>|]+/g, '_')}.zip`, zipSync(files, { level: 6 }));
  if (ok) toast(t('project.zipExported', { count: Object.keys(files).length }), 'ok');
}

export async function exportActiveFile(): Promise<void> {
  const f = activeFile();
  if (!f) return;
  const r = await getPlatform().saveTextFile(f.name, f.code);
  if (r) toast(t('project.exported', { name: r.name }), 'ok');
}

/** Bring an existing source file into the project as editable code. */
export async function importSourceFile(): Promise<void> {
  const exts = Object.values(LANGUAGES).map((l) => l.ext);
  const picked = await getPlatform().openTextFile([...exts, 'htm', 'h', 'hpp', 'cc', 'asm', 'mjs']);
  if (!picked) return;
  const lang = languageByExtension(picked.name.split('.').pop() ?? '');
  if (!lang) {
    toast(t('project.unknownType', { name: picked.name }), 'err');
    return;
  }
  if (!useProject.getState().project) newProject(picked.name.replace(/\.[^.]*$/, ''), lang, starterBlocks(lang));
  const file = useProject.getState().addFile(lang, picked.name, undefined, picked.text);
  if (file) toast(t('project.imported', { name: file.name }), 'ok');
}

/**
 * Turn the code of the active file into blocks. Only JavaScript has a parser;
 * anything outside the block subset is kept verbatim in raw code blocks.
 */
export async function convertCodeToBlocks(): Promise<void> {
  const f = activeFile();
  if (!f) return;
  if (f.language !== 'javascript') {
    toast(t('code.convertUnsupported', { name: LANGUAGES[f.language].name }), 'info');
    return;
  }
  const r = importJavaScript(f.code);
  if (!r.ok || !r.state) {
    toast(t('code.convertSyntax', { error: r.error ?? '' }), 'err');
    return;
  }
  const detail = r.warnings.slice(0, 12).map((w) => `${t('code.line', { line: w.line })}: ${w.message}`).join('\n');
  const ok = await confirmDialog({ title: t('code.convertTitle'), message: t('code.convertMessage', { converted: r.converted, raw: r.raw }), detail: detail || undefined, confirmLabel: t('code.convert') });
  if (!ok) return;
  const store = useProject.getState();
  store.checkpoint(t('code.convertCheckpoint'));
  store.replaceBlocks(f.id, r.state);
  store.setMode(f.id, 'blocks');
  toast(t('code.converted'), 'ok');
}

export async function addFileDialog(lang: LanguageId): Promise<void> {
  if (!useProject.getState().project) return;
  useProject.getState().addFile(lang, undefined, starterBlocks(lang));
}

export async function renameFileDialog(fileId: string): Promise<void> {
  const f = useProject.getState().project?.files.find((x) => x.id === fileId);
  if (!f) return;
  const name = await promptDialog({ title: t('file.rename'), message: '', value: f.name });
  if (name?.trim()) useProject.getState().renameFile(fileId, name);
}

export async function deleteFileDialog(fileId: string): Promise<void> {
  const p = useProject.getState().project;
  const f = p?.files.find((x) => x.id === fileId);
  if (!p || !f) return;
  if (p.files.length <= 1) {
    toast(t('file.lastFile'), 'info');
    return;
  }
  const ok = await confirmDialog({ title: t('file.deleteTitle'), message: t('file.deleteMessage', { name: f.name }), danger: true, confirmLabel: t('common.delete') });
  if (ok) useProject.getState().deleteFile(fileId);
}

/** Offer to bring back work from a session that ended without saving. */
export async function checkRecovery(): Promise<void> {
  const rec = await db.get<{ at: number; data: string }>('kv', 'recovery');
  if (!rec) return;
  const parsed = parseProject(rec.data);
  if (!parsed.project) return;
  const stored = (await db.all<{ id: string; updatedAt: string }>('projects')).find((x) => x.id === parsed.project!.id);
  if (stored && stored.updatedAt >= parsed.project.updatedAt) return;
  const ok = await confirmDialog({ title: t('project.recoverTitle'), message: t('project.recoverMessage', { name: parsed.project.name, time: new Date(rec.at).toLocaleString() }), confirmLabel: t('project.recover') });
  if (ok) {
    useProject.getState().load(parsed.project);
    await useProject.getState().save();
  } else await db.del('kv', 'recovery');
}
