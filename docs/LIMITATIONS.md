# Known limitations

This list is kept honest on purpose: anything here is either not built, not verified, or works differently from what you might expect.

## Platforms

- **macOS** is the only platform the desktop app has been built and run on (Apple Silicon, `aarch64`). The bundle is ad-hoc signed, not notarised, so Gatekeeper asks for confirmation the first time it is opened on another Mac.
- **Windows**: the backend is written to be cross-platform and a GitHub Actions job builds NSIS and MSI installers (`.github/workflows/build.yml`), but no Windows build has been produced or run yet. Treat Windows as untested.
- **Linux**: not built, not tested.
- **Browser build** (`npm run dev`): everything that needs the machine is unavailable there by design: local toolchains, opening folders, the terminal, the system keychain and the native in-app browser. API keys are kept in page memory only.

## Languages

- **Dart**: code is generated and covered by generator tests, but the generated programs have never been executed, because the Dart SDK was not installed on the development machine.
- **HTML and CSS**: the generated documents are checked structurally and shown in a sandboxed preview; there is no browser-compatibility testing.
- **Assembly**: ARM64 (macOS, Linux) and x86-64 (macOS, Linux) output is generated. ARM64/macOS runs natively in the tests and x86-64/macOS runs under Rosetta; the Linux variants are generated but not executed.
- Some block/language combinations cannot be expressed (for example exceptions in C, classes in Bash). These produce an explicit "unsupported" diagnostic on the block instead of approximate code. The full matrix is in [SUPPORT.md](SUPPORT.md).
- **Code to blocks** exists for JavaScript only (a subset; everything else is kept in raw-code blocks). For other languages a file switched to "Edit code" cannot be converted back to blocks.

## Running and debugging

- There is **no debugger** (no breakpoints, stepping or variable inspection). "Debug" and "Release" only select compiler flags.
- A text tab is run as a single file copied into a work folder. Multi-file programs that live in an opened folder should be run from the terminal.
- Built-in runtimes (JavaScript, TypeScript, Python through Pyodide, Lua, SQLite) run in workers with a time and output limit. They have no file system and no network access of their own.
- Toolchains are detected, never installed. A missing compiler is reported together with a suggested install command.

## Folders and files

- The folder tree is refreshed after the app's own changes and with the Refresh button; it does not watch the disk for changes made by other programs.
- Files over 10 MB and files that are not UTF-8 text are not opened in the editor.
- Deleting moves items to the system Trash.
- Search in an opened folder skips dependency and build folders (`node_modules`, `target`, `.git`, ...) and files over 1 MB.

## Assistant

- The assistant is optional and needs your own API key. Nothing is sent to a provider until you send a message; project content is attached only after you allow it for that provider.
- Terminal access for the assistant requires a model with native tool calling. Each command runs in a fresh shell in the opened folder (or the project work folder), with a two-minute limit. Commands are approved one by one by default; the "run without asking" setting still stops for commands classified as risky. That classification is a pattern list, not a sandbox: an approved command runs with your permissions.
- File edits proposed by the assistant apply to files of the block project. For files of an opened folder the assistant can explain changes or, with your approval, run commands, but it does not produce reviewable patches for them yet.
- Inline completion needs a provider that offers a completion endpoint or a fast chat model; it is off by default.
- Provider behaviour was tested against recorded and simulated responses. Live calls to Anthropic, OpenAI and DeepSeek were not made during development, because no API key was available.

## In-app browser

- On desktop it is a separate web view without access to the app. New-window links (`target="_blank"`) are not opened.
- In the browser build it is a sandboxed frame, which many sites refuse to load into.

## Other

- Package management writes manifest files (`requirements.txt`, `package.json`, `Cargo.toml`, ...) and can run the install command after confirmation. Install scripts of third-party packages are not sandboxed.
- The interface is translated into English, Korean, Japanese, Simplified Chinese and Traditional Chinese. The translations were written with AI assistance and reviewed for completeness by tests; they have not been reviewed by professional translators.
