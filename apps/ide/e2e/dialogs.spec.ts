import { expect, test } from '@playwright/test';
import { freshApp } from './helpers';

/** Every dialog must be tall enough to show its content: a collapsed body is a layout bug. */
async function bodyHeight(page: import('@playwright/test').Page): Promise<number> {
  const box = await page.locator('.dialog > .dialog-body').last().boundingBox();
  return box?.height ?? 0;
}

test('dialogs show their content at full height', async ({ page }) => {
  await freshApp(page);
  const cases: [string, number][] = [
    ['settings', 400],
    ['shortcuts', 200],
    ['examples', 200],
    ['new', 200],
    ['projects', 60],
  ];
  for (const [command, min] of cases) {
    await page.evaluate((id) => (window as unknown as { __bf: { runCommand: (id: string) => void } }).__bf.runCommand(id), command);
    await expect(page.locator('.dialog')).toBeVisible();
    expect(await bodyHeight(page), command).toBeGreaterThanOrEqual(min);
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog')).toHaveCount(0);
  }
});

test('settings tabs all render and fit the window', async ({ page }) => {
  await freshApp(page);
  await page.evaluate(() => (window as unknown as { __bf: { runCommand: (id: string) => void } }).__bf.runCommand('settings'));
  const dialog = page.getByTestId('settings-dialog');
  await expect(dialog).toBeVisible();
  for (const tab of ['general', 'editor', 'blocks', 'run', 'ai', 'privacy', 'about']) {
    await page.getByTestId(`settings-${tab}`).click();
    const box = await dialog.boundingBox();
    const view = page.viewportSize()!;
    expect(box!.height, tab).toBeGreaterThan(440);
    expect(box!.y, tab).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, tab).toBeLessThanOrEqual(view.height);
  }
});
