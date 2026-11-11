// Copies runtime assets that must be served as plain files (no CDN, works offline).
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pub = join(here, '..', 'public');

const pyodideDir = dirname(require.resolve('pyodide/package.json'));
const out = join(pub, 'pyodide');
mkdirSync(out, { recursive: true });
let n = 0;
for (const f of readdirSync(pyodideDir)) {
  if (/\.(wasm|zip|json|mjs|js)$/.test(f) && !/^(package\.json|console.*|ffi.*)$/.test(f) && !f.endsWith('.d.ts')) {
    cpSync(join(pyodideDir, f), join(out, f));
    n++;
  }
}
if (!existsSync(join(out, 'pyodide.asm.wasm'))) throw new Error('pyodide assets were not found');
console.log(`copied ${n} pyodide files to public/pyodide`);

// Blockly cursors, sounds and sprites.
const blocklyMedia = join(dirname(require.resolve('blockly')), 'media');
cpSync(blocklyMedia, join(pub, 'blockly-media'), { recursive: true });
console.log('copied Blockly media to public/blockly-media');
