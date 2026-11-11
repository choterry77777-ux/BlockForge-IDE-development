import { A64_REGS, type LanguageId, LANGUAGES, X64_REGS } from '@blockforge/core';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

let ready = false;

/** One-time editor setup: workers, themes and the assembly language. */
export function setupMonaco(): typeof monaco {
  if (ready) return monaco;
  ready = true;
  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker(_id, label) {
      if (label === 'json') return new JsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
      if (label === 'typescript' || label === 'javascript') return new TsWorker();
      return new EditorWorker();
    },
  };

  monaco.languages.register({ id: 'bf-asm', extensions: ['.s', '.asm'] });
  monaco.languages.setLanguageConfiguration('bf-asm', { comments: { lineComment: '//' }, brackets: [['[', ']']] });
  monaco.languages.setMonarchTokensProvider('bf-asm', {
    registers: [...A64_REGS, ...X64_REGS, 'x29', 'x30', 'sp', 'xzr', 'wzr', 'rsp', 'rip', 'eax', 'ebx', 'ecx', 'edx', 'dl', 'al', ...Array.from({ length: 31 }, (_, i) => `w${i}`)],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/#(?![-\d]).*$/, 'comment'],
        [/^\s*[A-Za-z_.$][\w.$]*:/, 'type.identifier'],
        [/^\s*\d+:/, 'type.identifier'],
        [/\.[a-zA-Z_]\w*/, 'keyword.directive'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/#?-?0x[0-9a-fA-F]+|#?-?\d+/, 'number'],
        [/[a-zA-Z_][\w.]*/, { cases: { '@registers': 'variable.predefined', '@default': 'keyword' } }],
        [/@[A-Z]+/, 'annotation'],
      ],
    },
  } as monaco.languages.IMonarchLanguage);

  const rules = (dark: boolean): monaco.editor.ITokenThemeRule[] => [
    { token: 'comment', foreground: dark ? '8a9099' : '81858c', fontStyle: 'italic' },
    { token: 'keyword', foreground: dark ? '7aaaff' : '3a63c8' },
    { token: 'keyword.directive', foreground: dark ? 'a78bfa' : '7c3aed' },
    { token: 'string', foreground: dark ? '6fcf97' : '0f7a3d' },
    { token: 'number', foreground: dark ? 'f0b072' : 'b45309' },
    { token: 'type', foreground: dark ? '67c7d9' : '0e7490' },
    { token: 'type.identifier', foreground: dark ? '67c7d9' : '0e7490' },
    { token: 'variable.predefined', foreground: dark ? 'f28b82' : 'ba2723' },
    { token: 'annotation', foreground: dark ? 'a78bfa' : '7c3aed' },
  ];
  monaco.editor.defineTheme('bf-light', {
    base: 'vs',
    inherit: true,
    rules: rules(false),
    colors: { 'editor.background': '#ffffff', 'editor.foreground': '#0f1115', 'editorLineNumber.foreground': '#b4b8be', 'editorLineNumber.activeForeground': '#61666b', 'editor.lineHighlightBackground': '#f6f7f9', 'editor.selectionBackground': '#cfdefb', 'editorIndentGuide.background1': '#eceef1', 'editorWidget.background': '#ffffff', 'editorWidget.border': '#e2e5e9', 'editorGutter.background': '#ffffff', 'scrollbarSlider.background': '#00000022', 'editorGhostText.foreground': '#9aa0a8' },
  });
  monaco.editor.defineTheme('bf-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: rules(true),
    colors: { 'editor.background': '#151517', 'editor.foreground': '#f9fafb', 'editorLineNumber.foreground': '#5d6167', 'editorLineNumber.activeForeground': '#adb2b8', 'editor.lineHighlightBackground': '#1d1d20', 'editor.selectionBackground': '#2f4a85', 'editorIndentGuide.background1': '#26272a', 'editorWidget.background': '#232324', 'editorWidget.border': '#3a3b3f', 'editorGutter.background': '#151517', 'scrollbarSlider.background': '#ffffff22', 'editorGhostText.foreground': '#6f747b' },
  });

  // Generated TypeScript declares Node globals itself; lib checks stay quiet about the rest.
  const ts = monaco.typescript;
  ts.typescriptDefaults.setCompilerOptions({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, strict: true, allowNonTsExtensions: true, noEmit: true });
  ts.javascriptDefaults.setCompilerOptions({ target: ts.ScriptTarget.ESNext, allowNonTsExtensions: true, checkJs: false, noEmit: true });
  ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
  return monaco;
}

export function monacoLanguage(lang: LanguageId): string {
  return LANGUAGES[lang].monaco;
}

/** Colourise a snippet to HTML using the editor's tokenisers. */
export async function colorize(code: string, language: string): Promise<string> {
  const m = setupMonaco();
  const known = m.languages.getLanguages().some((l) => l.id === language || l.aliases?.some((a) => a.toLowerCase() === language.toLowerCase()));
  const id = known ? (m.languages.getLanguages().find((l) => l.id === language || l.aliases?.some((a) => a.toLowerCase() === language.toLowerCase()))?.id ?? 'plaintext') : 'plaintext';
  return m.editor.colorize(code, id, { tabSize: 4 });
}

export { monaco };
