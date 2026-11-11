import { useEffect, useRef } from 'react';
import { resolveTheme, useSettings } from '../state/settings';
import { monaco, setupMonaco } from './monaco';

export interface Marker {
  line: number;
  endLine?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface Props {
  /** Stable identity of the document; the model is recreated when it changes. */
  docId: string;
  value: string;
  language: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  markers?: Marker[];
  /** Lines to tint, e.g. the code of the selected block. */
  highlight?: { start: number; end: number };
  revealLine?: { line: number; n: number };
  onLineClick?: (line: number) => void;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  minimal?: boolean;
  testId?: string;
}

export function CodeEditor({ docId, value, language, readOnly, onChange, markers, highlight, revealLine, onLineClick, onMount, minimal, testId }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const applying = useRef(false);
  const cb = useRef({ onChange, onLineClick });
  cb.current = { onChange, onLineClick };
  const theme = useSettings((s) => s.theme);
  const editorSettings = useSettings((s) => s.editor);

  useEffect(() => {
    if (!host.current) return;
    const m = setupMonaco();
    const model = m.editor.createModel(value, language);
    const editor = m.editor.create(host.current, {
      model,
      readOnly: !!readOnly,
      theme: resolveTheme(useSettings.getState().theme) === 'dark' ? 'bf-dark' : 'bf-light',
      automaticLayout: true,
      fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, Menlo, monospace",
      fontSize: useSettings.getState().editor.fontSize,
      lineHeight: 1.6,
      minimap: { enabled: !minimal && useSettings.getState().editor.minimap },
      lineNumbers: minimal ? 'off' : useSettings.getState().editor.lineNumbers ? 'on' : 'off',
      wordWrap: useSettings.getState().editor.wordWrap ? 'on' : 'off',
      scrollBeyondLastLine: false,
      renderLineHighlight: readOnly ? 'none' : 'line',
      padding: { top: 10, bottom: 10 },
      smoothScrolling: true,
      tabSize: 4,
      glyphMargin: false,
      folding: !minimal,
      lineDecorationsWidth: minimal ? 8 : 12,
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
      inlineSuggest: { enabled: true },
      quickSuggestions: !readOnly,
      contextmenu: !minimal,
      fixedOverflowWidgets: true,
      stickyScroll: { enabled: false },
    });
    editorRef.current = editor;
    decorations.current = editor.createDecorationsCollection();
    const sub = editor.onDidChangeModelContent(() => {
      if (!applying.current) cb.current.onChange?.(editor.getValue());
    });
    const click = editor.onMouseDown((e) => {
      if (e.target.position) cb.current.onLineClick?.(e.target.position.lineNumber);
    });
    onMount?.(editor);
    return () => {
      sub.dispose();
      click.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
    if (model.getValue() !== value) {
      applying.current = true;
      // Replace through an edit so the view state survives where it can.
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null);
      applying.current = false;
    }
  }, [value, language]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !!readOnly, renderLineHighlight: readOnly ? 'none' : 'line', quickSuggestions: !readOnly });
  }, [readOnly]);

  useEffect(() => {
    monaco.editor.setTheme(resolveTheme(theme) === 'dark' ? 'bf-dark' : 'bf-light');
  }, [theme]);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: editorSettings.fontSize, wordWrap: editorSettings.wordWrap ? 'on' : 'off', minimap: { enabled: !minimal && editorSettings.minimap }, lineNumbers: minimal ? 'off' : editorSettings.lineNumbers ? 'on' : 'off' });
  }, [editorSettings, minimal]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    const count = model.getLineCount();
    monaco.editor.setModelMarkers(
      model,
      'blockforge',
      (markers ?? [])
        .filter((mk) => mk.line >= 1 && mk.line <= count)
        .map((mk) => ({
          startLineNumber: mk.line,
          endLineNumber: Math.min(mk.endLine ?? mk.line, count),
          startColumn: mk.column ?? model.getLineFirstNonWhitespaceColumn(mk.line) ?? 1,
          endColumn: model.getLineMaxColumn(Math.min(mk.endLine ?? mk.line, count)),
          message: mk.message,
          severity: mk.severity === 'error' ? monaco.MarkerSeverity.Error : mk.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
        })),
    );
  }, [markers, value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!decorations.current || !model) return;
    if (!highlight || highlight.start > model.getLineCount()) {
      decorations.current.set([]);
      return;
    }
    const end = Math.min(highlight.end, model.getLineCount());
    decorations.current.set([{ range: new monaco.Range(highlight.start, 1, end, 1), options: { isWholeLine: true, className: 'code-highlight', linesDecorationsClassName: 'code-highlight-gutter' } }]);
    editorRef.current?.revealLinesInCenterIfOutsideViewport(highlight.start, end);
  }, [highlight?.start, highlight?.end, value]);

  useEffect(() => {
    if (!revealLine) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(revealLine.line);
    editor.setPosition({ lineNumber: revealLine.line, column: 1 });
    editor.focus();
  }, [revealLine]);

  return <div ref={host} className="grow" style={{ minHeight: 0 }} data-testid={testId ?? 'code-editor'} />;
}
