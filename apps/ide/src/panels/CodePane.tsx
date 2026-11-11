import { type Diagnostic, LANGUAGES, linesOfBlock, type ProjectFile } from '@blockforge/core';
import { useEffect, useMemo, useRef } from 'react';
import { convertCodeToBlocks } from '../actions';
import { codeSelection } from '../ai/engine';
import { completableModels, registerInlineCompletion } from '../ai/complete';
import { CodeEditor, type Marker } from '../editor/CodeEditor';
import { type monaco, monacoLanguage } from '../editor/monaco';
import { Icon } from '../components/Icon';
import { diagText, t } from '../i18n';
import { blockForLine, useProject } from '../state/project';
import { useRun } from '../state/run';
import { confirmDialog, useUi } from '../state/ui';

function toMarkers(diags: Diagnostic[], entry: string): Marker[] {
  return diags.filter((d) => d.line && (!d.file || d.file === entry)).map((d) => ({ line: d.line!, endLine: d.endLine, column: d.column, message: diagText(d), severity: d.severity }));
}

/** Languages whose code can be read back into blocks as it is typed. */
export function blocksFollowCode(language: string): boolean {
  return language === 'javascript' || language === 'typescript';
}

/**
 * Make the blocks the source again: the code is replaced by what they generate, after asking.
 * When the blocks were following the code they already hold its logic, and only comments
 * and formatting are lost. A checkpoint is kept either way.
 */
export async function regenerateFromBlocks(fileId: string, following = false): Promise<void> {
  const ok = following
    ? await confirmDialog({ title: t('blocks.editTitle'), message: t('blocks.editMessage'), confirmLabel: t('blocks.editBlocks') })
    : await confirmDialog({ title: t('code.reattachTitle'), message: t('code.reattachMessage'), danger: true, confirmLabel: t('code.reattach') });
  if (!ok) return;
  useProject.getState().checkpoint(t('code.reattachCheckpoint'));
  useProject.getState().setMode(fileId, 'blocks');
}

export function CodePane({ file }: { file: ProjectFile }) {
  const result = useProject((s) => s.results[file.id]);
  const selectedBlock = useUi((s) => s.selectedBlock);
  const revealLine = useUi((s) => s.revealLine);
  const runDiags = useRun((s) => (s.fileId === file.id ? s.diagnostics : undefined));
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const blocksMode = file.mode === 'blocks';
  const entry = result?.meta.entryFile ?? file.name;

  const markers = useMemo(() => [...(blocksMode ? toMarkers(result?.diagnostics ?? [], entry) : []), ...toMarkers(runDiags ?? [], entry)], [result, runDiags, blocksMode, entry]);
  const highlight = useMemo(() => {
    if (!blocksMode || !result || !selectedBlock) return undefined;
    const r = linesOfBlock(result, selectedBlock);
    return r ? { start: r.startLine, end: r.endLine } : undefined;
  }, [result, selectedBlock, blocksMode]);

  useEffect(() => {
    registerInlineCompletion();
    return () => {
      const uri = editorRef.current?.getModel()?.uri.toString();
      if (uri) completableModels.delete(uri);
    };
  }, [file.id]);

  // Inline AI completion is offered only where the user owns the text.
  useEffect(() => {
    const uri = editorRef.current?.getModel()?.uri.toString();
    if (!uri) return;
    if (blocksMode) completableModels.delete(uri);
    else completableModels.set(uri, { language: LANGUAGES[file.language].name, fileName: file.name });
  }, [blocksMode, file.language, file.name, file.id]);

  // Typing into generated code makes the file hand-edited right away: the blocks are kept
  // and paused, and a checkpoint allows going back to the state before the first edit.
  const edit = (code: string) => {
    const store = useProject.getState();
    if (blocksMode && code !== file.code) {
      store.checkpoint(t('code.detachCheckpoint'));
      store.setMode(file.id, 'code');
      useUi.getState().toast(t('code.autoDetached'), 'info');
    }
    store.updateCode(file.id, code);
  };

  const detach = async () => {
    const ok = await confirmDialog({ title: t('code.detachTitle'), message: t('code.detachMessage'), confirmLabel: t('code.detach') });
    if (ok) useProject.getState().setMode(file.id, 'code');
  };
  const reattach = () => regenerateFromBlocks(file.id, blocksFollowCode(file.language));

  return (
    <div className="col grow" data-testid="code-pane">
      <div className="row gap-6" style={{ height: 32, padding: '0 6px 0 12px', borderBottom: 'var(--hairline) solid var(--border-2)', flex: 'none' }}>
        <span className={`dot ${blocksMode ? 'info' : 'warn'}`} />
        <span className="secondary muted ellipsis grow" data-testid="code-mode">
          {blocksMode ? t('code.generated') : t('code.owned')}
        </span>
        {blocksMode ? (
          <button className="btn sm" onClick={() => void detach()} data-testid="code-detach">
            <Icon name="edit" size={14} />
            {t('code.edit')}
          </button>
        ) : (
          <>
            <button className="btn sm" onClick={() => void convertCodeToBlocks()} title={t('code.convertHint')} data-testid="code-to-blocks">
              <Icon name="blocks" size={14} />
              {t('code.toBlocks')}
            </button>
            <button className="btn sm" onClick={() => editorRef.current?.getAction('editor.action.formatDocument')?.run()} title={t('code.formatHint')}>
              {t('code.format')}
            </button>
            <button className="btn sm" onClick={() => void reattach()} data-testid="code-reattach">
              <Icon name="refresh" size={14} />
              {t('code.regenerate')}
            </button>
          </>
        )}
        <button
          className="btn sm icon"
          title={t('common.copy')}
          onClick={() => {
            void navigator.clipboard.writeText(file.code);
            useUi.getState().toast(t('common.copied'), 'ok');
          }}
        >
          <Icon name="copy" size={14} />
        </button>
      </div>
      <CodeEditor
        docId={file.id}
        value={file.code}
        language={monacoLanguage(file.language)}
        markers={markers}
        highlight={highlight}
        revealLine={revealLine && revealLine.file === entry ? { line: revealLine.line, n: revealLine.n } : undefined}
        onChange={edit}
        onLineClick={(line) => {
          if (!blocksMode) return;
          const id = blockForLine(file.id, line);
          if (id) useUi.setState({ revealBlock: { id, n: Date.now() } });
        }}
        onMount={(editor) => {
          editorRef.current = editor;
          codeSelection.get = () => {
            const sel = editor.getSelection();
            const model = editor.getModel();
            return sel && model && !sel.isEmpty() ? model.getValueInRange(sel) : '';
          };
        }}
      />
    </div>
  );
}
