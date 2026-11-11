import { expect, type Page } from '@playwright/test';

/** Start from a clean browser profile state and wait for the home screen. */
export async function freshApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('blockforge');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByTestId('hero')).toBeVisible();
}

export async function startProject(page: Page, lang: string): Promise<void> {
  await page.getByTestId(`start-${lang}`).click();
  await expect(page.getByTestId('editor-area')).toBeVisible();
  await expect(page.getByTestId('blocks-editor').locator('.blocklyDraggable').first()).toBeVisible();
}

/** Text of the code editor. Monaco renders non-breaking spaces, which are normalised. */
export async function codeText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { __bf: { useProject: { getState: () => { project?: { activeFileId?: string; files: { id: string; code: string }[] } } } } };
    const p = w.__bf.useProject.getState().project;
    return p?.files.find((f) => f.id === p.activeFileId)?.code ?? '';
  });
}

export async function expectCode(page: Page, text: string | RegExp): Promise<void> {
  await expect.poll(() => codeText(page)).toMatch(typeof text === 'string' ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : text);
}

export async function run(page: Page): Promise<void> {
  await page.getByTestId('run').click();
}

export async function expectOutput(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByTestId('output')).toContainText(text, { timeout: 60_000 });
}

export async function setLanguage(page: Page, lang: string): Promise<void> {
  await page.getByTestId('language-select').selectOption(lang);
}

export async function openExample(page: Page, lang: string, id: string): Promise<void> {
  await page.getByTestId('open-examples').click();
  await page.getByTestId('example-language').selectOption(lang);
  await page.getByTestId(`example-${id}`).click();
  await expect(page.getByTestId('editor-area')).toBeVisible();
}

/** Replace the blocks of the active file through the same path a project load uses. */
export async function setBlocks(page: Page, state: unknown): Promise<void> {
  await page.evaluate((s) => {
    const w = window as unknown as { __bf: { useProject: { getState: () => { project?: { activeFileId?: string }; replaceBlocks: (id: string, state: unknown) => void } } } };
    const st = w.__bf.useProject.getState();
    st.replaceBlocks(st.project!.activeFileId!, s);
  }, state);
}
