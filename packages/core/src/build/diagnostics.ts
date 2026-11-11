import type { Diagnostic, LanguageId } from '../types';

interface Pattern {
  re: RegExp;
  /** Capture group indexes. */
  file?: number;
  line: number;
  column?: number;
  severity?: number;
  message?: number;
  /** The message is on the line before / after the location. */
  messageFrom?: 'previous' | 'next' | 'rest';
}

const P = {
  // clang, gcc, go, kotlinc, dart: file:line:col: error: message
  colon: { re: /^(?:\.\/)?([^\s:()]+\.[A-Za-z]+):(\d+):(\d+):\s*(?:(fatal error|error|warning|note|Error|Warning)\s*:\s*)?(.*)$/, file: 1, line: 2, column: 3, severity: 4, message: 5 } as Pattern,
  // javac: File.java:6: error: message
  javac: { re: /^([^\s:]+\.java):(\d+):\s*(error|warning):\s*(.*)$/, file: 1, line: 2, severity: 3, message: 4 } as Pattern,
  // tsc, dotnet: file(line,col): error CODE: message
  paren: { re: /^(?:.*[\\/])?([^\s\\/()]+\.[A-Za-z]+)\((\d+),(\d+)\):\s*(error|warning)\s+\w+:\s*(.*?)(?:\s+\[.*\])?$/, file: 1, line: 2, column: 3, severity: 4, message: 5 } as Pattern,
  // rustc:  --> main.rs:2:27 (message on the "error...: msg" line above)
  rust: { re: /^\s*-->\s*([^\s:]+):(\d+):(\d+)$/, file: 1, line: 2, column: 3, messageFrom: 'previous' } as Pattern,
  // python:   File "main.py", line 3, in <module>
  python: { re: /^\s*File "([^"]+)", line (\d+)/, file: 1, line: 2, messageFrom: 'rest' } as Pattern,
  // node:  /tmp/x/main.js:3
  node: { re: /^(?:file:\/\/)?(?:.*[\\/])?([^\s\\/:]+\.(?:js|mjs|cjs)):(\d+)(?::(\d+))?$/, file: 1, line: 2, column: 3, messageFrom: 'rest' } as Pattern,
  // php: PHP Parse error: message in /x/main.php on line 3
  php: { re: /^(?:PHP )?(Parse error|Fatal error|Warning|Notice|Deprecated):\s*(.*) in (?:.*[\\/])?([^\s\\/]+\.php)(?: on line |:)(\d+)$/, severity: 1, message: 2, file: 3, line: 4 } as Pattern,
  // ruby: main.rb:3:in `<main>': message (Error)
  ruby: { re: /^(?:.*[\\/])?([^\s\\/:]+\.rb):(\d+):(?:in [`'][^']*':\s*)?(.*)$/, file: 1, line: 2, message: 3 } as Pattern,
  // lua: lua: main.lua:3: message
  lua: { re: /^(?:lua[\d.]*:\s*)?(?:.*[\\/])?([^\s\\/:]+\.lua):(\d+):\s*(.*)$/, file: 1, line: 2, message: 3 } as Pattern,
  // bash: main.sh: line 3: message
  bash: { re: /^(?:.*[\\/])?([^\s\\/:]+\.sh): line (\d+):\s*(.*)$/, file: 1, line: 2, message: 3 } as Pattern,
  // sqlite3: Parse error near line 3: message   /   Runtime error near line 3: message
  sqlite: { re: /^(?:Parse|Runtime) error near line (\d+):\s*(.*)$/, line: 1, message: 2 } as Pattern,
  // sqlite3 older: Error: near line 3: message
  sqliteOld: { re: /^Error: near line (\d+):\s*(.*)$/, line: 1, message: 2 } as Pattern,
};

const BY_LANGUAGE: Record<LanguageId, Pattern[]> = {
  python: [P.python],
  javascript: [P.node],
  typescript: [P.paren, P.node],
  c: [P.colon],
  cpp: [P.colon],
  java: [P.javac],
  csharp: [P.paren],
  lua: [P.lua],
  html: [],
  css: [],
  php: [P.php],
  go: [P.colon],
  rust: [P.rust],
  sql: [P.sqlite, P.sqliteOld],
  dart: [P.colon],
  assembly: [P.colon],
  ruby: [P.ruby],
  kotlin: [P.colon],
  bash: [P.bash],
};

function severityOf(text: string | undefined): Diagnostic['severity'] {
  const s = (text ?? 'error').toLowerCase();
  if (s.includes('warn') || s.includes('deprecated') || s.includes('notice')) return 'warning';
  if (s === 'note') return 'info';
  return 'error';
}

/**
 * Extract file/line diagnostics from compiler or interpreter output. Only lines
 * that match a known format are reported; nothing is invented.
 */
export function parseToolOutput(lang: LanguageId, output: string, source: 'compiler' | 'runtime' = 'compiler'): Diagnostic[] {
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  // The last non-empty line usually carries the message of interpreter tracebacks.
  const lastLine = [...lines].reverse().find((l) => l.trim()) ?? '';
  lines.forEach((text, i) => {
    for (const p of BY_LANGUAGE[lang]) {
      const m = p.re.exec(text);
      if (!m) continue;
      let message = p.message ? m[p.message] : '';
      let sev = severityOf(p.severity ? m[p.severity] : undefined);
      if (p.messageFrom === 'previous') {
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
          const prev = /^(error|warning)(?:\[\w+\])?:\s*(.*)$/.exec(lines[j]);
          if (prev) {
            message = prev[2];
            sev = severityOf(prev[1]);
            break;
          }
        }
      } else if (p.messageFrom === 'rest') {
        message = lastLine.trim();
      }
      if (!message) message = text.trim();
      const d: Diagnostic = { severity: sev, code: `tool.${source}`, message, source, file: p.file ? m[p.file] : undefined, line: Number(m[p.line]), column: p.column && m[p.column] ? Number(m[p.column]) : undefined };
      const key = `${d.file}:${d.line}:${d.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(d);
      }
      break;
    }
  });
  // Interpreter tracebacks list every frame; the innermost one in the user's file is the useful one.
  if ((lang === 'python' || lang === 'javascript') && out.length > 1) return [out[lang === 'python' ? out.length - 1 : 0]];
  return out.slice(0, 50);
}
