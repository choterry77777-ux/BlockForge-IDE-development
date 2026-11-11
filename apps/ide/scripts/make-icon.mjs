// Renders public/icon.svg to the 1024px PNG that `tauri icon` turns into every
// platform icon. The art is inset the way macOS app icons are (824px in 1024px).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icon.svg'), 'utf8');
const out = join(root, 'src-tauri/icons/source.png');
mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;background:transparent}div{width:1024px;height:1024px;display:flex;align-items:center;justify-content:center}svg{width:824px;height:824px}</style><div>${svg}</div>`);
await page.screenshot({ path: out, omitBackground: true });
await browser.close();
console.log(out);
