// Takes screenshots of the main screens for a visual check: node scripts/shots.mjs <outDir> [locale] [theme]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [out = 'shots', locale = 'ko', theme = 'light', width = '1440', height = '900'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:1420/');
await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((r) => {
    const q = indexedDB.deleteDatabase('blockforge');
    q.onsuccess = q.onerror = q.onblocked = () => r();
  });
});
await page.reload();
await page.waitForSelector('[data-testid=hero]');
const set = (patch) => page.evaluate((p) => window.__bf.useSettings.getState().update(p), patch);
const shot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${locale}-${theme}-${name}.png` });
};
await set({ locale, theme });
await shot('home');
await page.click('[data-testid=start-python]');
await page.waitForSelector('.blocklyDraggable');
await page.waitForTimeout(600);
await shot('editor');
// Open a toolbox category so block labels in this language are visible.
const cats = page.locator('.blocklyToolboxCategory');
await cats.nth(3).click();
await shot('toolbox-math');
await cats.nth(5).click();
await shot('toolbox-lists');
await page.keyboard.press('Escape');
await page.evaluate(() => window.__bf.runCommand('settings'));
for (const tab of ['general', 'ai', 'privacy']) {
  await page.click(`[data-testid=settings-${tab}]`);
  await shot(`settings-${tab}`);
}
await page.keyboard.press('Escape');
await page.evaluate(() => window.__bf.runCommand('newText'));
await set({ layout: { dockOpen: true, dockTab: 'terminal', rightOpen: true, rightTab: 'tools' } });
await shot('text-terminal');
await browser.close();
console.log('done');
