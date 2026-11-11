/// <reference lib="webworker" />
import ts from 'typescript';

export interface TranspileResult {
  js: string;
  errors: { line: number; column: number; message: string }[];
}

self.onmessage = (e: MessageEvent<{ code: string; fileName: string }>) => {
  const out = ts.transpileModule(e.data.code, {
    fileName: e.data.fileName,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true, removeComments: false },
  });
  const errors = (out.diagnostics ?? [])
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
      return { line: pos.line + 1, column: pos.character + 1, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') };
    });
  const result: TranspileResult = { js: out.outputText, errors };
  self.postMessage(result);
};
