# Feature support matrix

This file is generated from the code generators themselves (`computeSupport()` in `packages/core/src/support.ts`):
each feature is a small block program that is generated for every language, and a cell is "yes" only when the
generator produced code without an "unsupported" diagnostic. Regenerate it with `BF_WRITE_DOCS=1 npx vitest run packages/core/test/docs.test.ts`.

When a language cannot express a block, the IDE shows an explicit diagnostic on that block instead of generating wrong code.

## General-purpose languages

| Feature | Python | JavaScript | TypeScript | C | C++ | Java | C# | Lua | PHP | Go | Rust | Dart | Ruby | Kotlin | Bash |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Print | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Input | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Conditions | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Loops | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Functions and recursion | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Text operations | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Math functions | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Type conversion | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Random numbers | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Typed declarations and constants | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Lists | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Dictionaries | yes | yes | yes | no | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Exceptions (try / raise) | yes | yes | yes | no | yes | yes | yes | yes | yes | yes | no | yes | yes | yes | no |
| File access | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Structs | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | no |
| Classes and methods | yes | yes | yes | no | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | no |
| Interfaces | yes | yes | yes | no | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | no |
| Function values | yes | yes | yes | no | no | no | no | yes | yes | no | no | yes | yes | no | yes |
| Waiting | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| HTTP requests | yes | yes | yes | no | no | yes | yes | no | yes | yes | no | yes | yes | yes | yes |
| JSON output | yes | yes | yes | no | no | no | yes | no | yes | yes | no | yes | yes | no | no |
| JSON parsing | yes | yes | yes | no | no | no | no | no | yes | no | no | yes | yes | no | no |
| Shell commands | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Pointers and references | no | no | no | yes | yes | no | no | no | no | yes | yes | no | no | no | no |
| Manual memory | no | no | no | yes | yes | no | no | no | no | no | no | no | no | no | no |
| Web page scripting | no | yes | yes | no | no | no | no | no | no | no | no | no | no | no | no |
| Module imports | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |

## How each language runs

| Language | File | Runs inside the app without tools | Desktop toolchain | Generated code executed by the test suite |
| --- | --- | --- | --- | :-: |
| Python | `main.py` | yes | python | yes |
| JavaScript | `main.js` | yes | node | yes |
| TypeScript | `main.ts` | yes | node, tsc | yes |
| C | `main.c` | no | cc | yes |
| C++ | `main.cpp` | no | cxx | yes |
| Java | `Main.java` | no | javac, java | yes |
| C# | `Program.cs` | no | dotnet | yes |
| Lua | `main.lua` | yes | lua | yes |
| HTML | `index.html` | yes (sandboxed preview) | none needed | structure checked |
| CSS | `style.css` | yes (sandboxed preview) | none needed | structure checked |
| PHP | `main.php` | no | php | yes |
| Go | `main.go` | no | go | yes |
| Rust | `main.rs` | no | rustc, cargo | yes |
| SQL | `query.sql` | yes | sqlite3 | yes |
| Dart | `main.dart` | no | dart | no |
| Assembly | `main.s` | no | cc | yes |
| Ruby | `main.rb` | no | ruby | yes |
| Kotlin | `Main.kt` | no | kotlinc, java | yes |
| Bash | `main.sh` | no | bash | yes |

Dart code is generated and unit-checked, but it has not been executed by the test suite because the Dart SDK was not installed on the development machine.

## Example programs that a language cannot express

The shared example programs are run in every language. These combinations are expected to report "unsupported" instead:

- `dictionary`: C
- `exceptions`: C, Rust, Bash
- `structs`: Bash
- `classes`: C, Bash
- `globals`: Rust
