import { describe, expect, it } from 'vitest';
import { parseToolOutput } from '../src/build/diagnostics';

describe('tool output parsing', () => {
  it('reads clang, go, kotlin and dart style messages', () => {
    expect(parseToolOutput('c', "main.c:4:5: error: use of undeclared identifier 'Counter'\n    4 |     Counter c;\n1 error generated.\n")).toEqual([{ severity: 'error', code: 'tool.compiler', message: "use of undeclared identifier 'Counter'", source: 'compiler', file: 'main.c', line: 4, column: 5 }]);
    expect(parseToolOutput('go', './main.go:28:18: cannot convert 7.9 (untyped float constant) to type int')[0]).toMatchObject({ file: 'main.go', line: 28, column: 18 });
    expect(parseToolOutput('kotlin', 'Main.kt:3:5: warning: variable is never used')[0]).toMatchObject({ severity: 'warning', line: 3 });
    expect(parseToolOutput('cpp', 'main.cpp:9:36: warning: unused variable')[0].severity).toBe('warning');
  });

  it('reads javac, tsc and dotnet formats', () => {
    expect(parseToolOutput('java', 'Main.java:6: error: unreachable statement\n            System.out.println("skipped");\n            ^\n1 error')[0]).toMatchObject({ file: 'Main.java', line: 6, message: 'unreachable statement' });
    expect(parseToolOutput('typescript', "main.ts(25,7): error TS2451: Cannot redeclare block-scoped variable 'name'.")[0]).toMatchObject({ file: 'main.ts', line: 25, column: 7, message: "Cannot redeclare block-scoped variable 'name'." });
    expect(parseToolOutput('csharp', '/tmp/x/Program.cs(10,13): error CS1002: ; expected [/tmp/x/app.csproj]')[0]).toMatchObject({ file: 'Program.cs', line: 10, message: '; expected' });
  });

  it('takes the rustc message from the line above the location', () => {
    const out = 'error[E0277]: cannot add `f64` to `{integer}`\n --> main.rs:2:27\n  |\n2 |     let x = 3 + 4.0;\n';
    expect(parseToolOutput('rust', out)).toEqual([{ severity: 'error', code: 'tool.compiler', message: 'cannot add `f64` to `{integer}`', source: 'compiler', file: 'main.rs', line: 2, column: 27 }]);
  });

  it('reads interpreter errors', () => {
    const py = 'Traceback (most recent call last):\n  File "main.py", line 7, in <module>\n    f()\n  File "main.py", line 3, in f\n    raise Exception("boom")\nException: boom\n';
    expect(parseToolOutput('python', py, 'runtime')).toEqual([{ severity: 'error', code: 'tool.runtime', message: 'Exception: boom', source: 'runtime', file: 'main.py', line: 3, column: undefined }]);
    expect(parseToolOutput('php', 'PHP Parse error:  syntax error, unexpected token ";" in /tmp/x/main.php on line 3', 'runtime')[0]).toMatchObject({ file: 'main.php', line: 3 });
    expect(parseToolOutput('ruby', "main.rb:3:in `<main>': boom (RuntimeError)", 'runtime')[0]).toMatchObject({ line: 3, message: 'boom (RuntimeError)' });
    expect(parseToolOutput('lua', 'lua: main.lua:5: attempt to call a nil value', 'runtime')[0]).toMatchObject({ line: 5 });
    expect(parseToolOutput('bash', 'main.sh: line 4: nosuchcmd: command not found', 'runtime')[0]).toMatchObject({ line: 4, message: 'nosuchcmd: command not found' });
    expect(parseToolOutput('sql', 'Parse error near line 3: no such table: users', 'runtime')[0]).toMatchObject({ line: 3, message: 'no such table: users' });
    expect(parseToolOutput('javascript', '/private/tmp/x/main.js:3\n  throw new Error("boom");\n  ^\n\nError: boom\n    at Object.<anonymous> (/private/tmp/x/main.js:3:9)\n', 'runtime')[0]).toMatchObject({ file: 'main.js', line: 3 });
  });

  it('reports nothing for output it does not recognise', () => {
    expect(parseToolOutput('c', 'Hello, World!\n42\n')).toEqual([]);
    expect(parseToolOutput('html', 'anything')).toEqual([]);
  });
});
