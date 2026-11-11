# BlockForge IDE

BlockForge is a desktop IDE where you build programs from visual blocks and get real, readable source code in 19 programming languages. The same blocks can be switched between languages, run immediately, compared side by side, and edited as text when you outgrow the blocks.

It is a macOS app (Tauri 2 + React + Blockly + Monaco). A Windows build configuration is included but has not been run yet; see [Status](#status).

## What it does

**Blocks to code**

- One block program generates source for Python, JavaScript, TypeScript, C, C++, Java, C#, Lua, PHP, Go, Rust, Dart, Ruby, Kotlin and Bash. HTML, CSS, SQL and Assembly (ARM64 and x86-64) have their own block sets.
- Generation goes through a typed intermediate representation with scope and type analysis, so each language gets idiomatic output (declarations, types, imports, entry points) instead of string templates.
- Every block maps to its lines of code and back: select a block to highlight its code, click a line to find its block.
- When a language cannot express a block, the block gets an explicit diagnostic. Nothing is silently approximated. See the [feature support matrix](docs/SUPPORT.md).

**Run and build**

- Runs inside the app with no tools installed: JavaScript, TypeScript, Python (Pyodide), Lua, SQL (SQLite) and HTML/CSS (sandboxed preview).
- Uses the compilers and interpreters already on your machine for everything else. Toolchains are detected, never installed for you.
- Build, rebuild, clean, syntax check, standard input, time and output limits, and compiler errors mapped back to lines and blocks.

**Editor**

- Tabs that mix block files and plain text files. A new tab is a text editor; pick its language from the language menu.
- Folder explorer: open a folder, browse, create, rename, move to Trash, search, or clone a Git repository.
- A real terminal (PTY) in the bottom panel, with multiple sessions.
- Type straight into the generated code whenever you want. For JavaScript and TypeScript the blocks are rebuilt from your code as you type; for other languages the blocks pause and can take over again later.
- Compare the generated code of several languages side by side, with notes on where their behaviour differs.
- Package manifests for pip, npm, Cargo, Go modules, NuGet, Maven, Composer, RubyGems and pub.
- Projects in a versioned `.bfproj` format, autosave with recovery, ZIP export.
- An in-app browser for documentation and a set of developer utilities (JSON, Base64, hashes, regular expressions, timestamps, and more).

**Assistant (optional)**

- Bring your own API key: Anthropic Claude, OpenAI, DeepSeek, or any OpenAI-compatible endpoint including local servers.
- Streaming chat that knows the blocks, code, problems and output you choose to attach.
- Proposes block edits and file patches as reviewable cards: preview, Apply, Reject, Undo. Proposals are validated before they can be applied.
- Can ask to run a command in the terminal or read its output. Each request shows the exact command and runs only after you allow it.
- Everything else in the app works without the assistant and without a network connection.

**Interface**

- English, Korean, Japanese, Simplified Chinese and Traditional Chinese. Block labels follow the interface language too.
- Light, dark and system themes. Command palette and keyboard shortcuts.

## Status

| Area | State |
| --- | --- |
| Code generation, 19 languages | Implemented. Generated programs for 16 languages are compiled and executed by the test suite and their output compared across languages. Dart is generated but has never been executed. |
| macOS app | Built and run on Apple Silicon. Ad-hoc signed, not notarised. |
| Windows app | Build workflow included (`.github/workflows/build.yml`). **Not built or tested yet.** |
| Assistant | Tested against simulated provider responses. No live provider calls were made during development. |
| Debugger | Not implemented. |

The complete list is in [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Getting started

Requirements: Node.js 20 or newer. For the desktop app also Rust (stable) and, on macOS, the Xcode command line tools.

```bash
npm install
```

Run in a browser for development (no local toolchains, folders or terminal there):

```bash
npm run dev
```

Run the desktop app in development:

```bash
npm run tauri -- dev
```

Build the macOS app and disk image:

```bash
npm run app:mac
```

The results are written to `apps/ide/src-tauri/target/release/bundle/` (`macos/BlockForge.app` and `dmg/BlockForge_<version>_aarch64.dmg`).

The app is not notarised. On another Mac, open it the first time with right-click > Open, or remove the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/BlockForge.app
```

### Windows

Not verified. The intended route is the GitHub Actions workflow: open the Actions tab, choose "Build desktop app" and run it. It builds NSIS and MSI installers on a Windows runner and attaches them to the run. To build locally on Windows, install Node.js, Rust (MSVC toolchain) and the WebView2 runtime, then run `npm install` and `npm run tauri -- build`.

## Tests

```bash
npm run typecheck     # TypeScript, both packages
npm run lint          # ESLint
npm test              # unit tests and execution tests
npm run test:rust     # backend unit tests
npm run test:e2e      # interface tests (needs Google Chrome and the dev server)
```

- **Execution tests** generate a set of example programs in every language, build and run them with the real toolchain, and compare the output. A language whose toolchain is not installed is skipped and reported as skipped.
- **Interface tests** drive the app in Chrome: creating projects, dragging blocks, running code, tabs and the folder explorer (against an in-memory folder), the assistant (against simulated provider responses), and a layout audit that walks every panel and dialog in all five languages and fails on overlapping or cut-off text, collapsed panels and crashed views.
- `docs/SUPPORT.md` is generated from the generators and checked by a test. Regenerate it with `npm run docs:support`.

## Repository layout

```
packages/core        Pure TypeScript engine, no UI
  src/ir             Typed intermediate representation, conversion from blocks, analysis
  src/blocks         Block definitions, toolbox, validation
  src/generators     One generator per language
  src/build          Toolchain table, build recipes, compiler output parsing
  src/ai             Provider adapters, structured block and file edits, prompts
  src/project        Project file format
apps/ide             The application
  src                React interface (Blockly, Monaco, panels, state, i18n)
  src/runtime        Built-in runtimes that run in workers
  src-tauri          Desktop backend in Rust
  e2e                Interface tests
docs                 Support matrix and known limitations
```

## How the desktop app is secured

The interface runs in a web view; everything that touches the machine goes through a small set of Rust commands.

- **Processes**: only executables from a fixed allow-list of toolchains can be started, plus programs built inside the project's own work folder. Arguments are passed as a list, never through a shell. Runs have time and output limits and are killed as a group.
- **Files**: paths must resolve inside a folder you picked in the system folder dialog. Symbolic links that lead outside are refused. Single files are read and written only where a system file dialog approved them.
- **API keys** are stored in the system keychain. The interface can save, delete and ask whether a key exists; it cannot read one back. Requests to a provider are made by the backend, which attaches the key only for the server address it was saved for, never follows redirects with it, and never sends it over plain HTTP to another machine. Keys are not written to project files, exports, settings or logs.
- **Terminal**: the terminal is a normal shell with your permissions; that is its purpose. The assistant cannot type into it. It can only propose a command, which you approve or reject. Output returned to the assistant is treated as data and key-like strings are removed first.
- **In-app browser**: a separate web view with no access to the app's commands. Only http and https pages are loaded.
- **Generated HTML** is previewed in a sandboxed frame.

## License

MIT. See [LICENSE](LICENSE).

Third-party components keep their own licenses, among them Blockly (Apache-2.0), Monaco Editor (MIT), Pyodide (MPL-2.0), Tauri (MIT/Apache-2.0), xterm.js (MIT) and the Anthropic TypeScript SDK (MIT).
