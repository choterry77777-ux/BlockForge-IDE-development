import { expect, test } from '@playwright/test';
import { codeText, expectCode, expectOutput, freshApp, openExample, run, setLanguage, startProject } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshApp(page);
});

test('home lists all 19 languages and starts a project', async ({ page }) => {
  await expect(page.getByTestId('language-grid').locator('button')).toHaveCount(19);
  await startProject(page, 'python');
  await expectCode(page, 'print("Hello, World!")');
  await expect(page.getByTestId('code-mode')).toContainText('Generated from blocks');
});

test('runs Python in the built-in runtime', async ({ page }) => {
  await startProject(page, 'python');
  await run(page);
  await expectOutput(page, 'Hello, World!');
  await expect(page.getByTestId('run-result')).toContainText('Succeeded');
});

test('the same blocks generate and run in other languages', async ({ page }) => {
  await openExample(page, 'python', 'fizzbuzz');
  await expectCode(page, 'elif i % 3 == 0:');
  await setLanguage(page, 'javascript');
  await expectCode(page, '} else if (i % 3 === 0) {');
  await run(page);
  await expectOutput(page, /1\n2\nFizz\n4\nBuzz[\s\S]*FizzBuzz/);

  await setLanguage(page, 'typescript');
  await expectCode(page, 'for (let i: number = 1; i <= 15; i++) {');
  await run(page);
  await expectOutput(page, 'Transpiling TypeScript');
  await expectOutput(page, /14\nFizzBuzz/);

  await setLanguage(page, 'lua');
  await expectCode(page, 'elseif i % 3 == 0 then');
  await run(page);
  await expectOutput(page, /14\nFizzBuzz/);

  // Languages without a browser runtime still generate, and say honestly that they cannot run here.
  await setLanguage(page, 'rust');
  await expectCode(page, 'for i in 1..=15 {');
  await run(page);
  await expectOutput(page, 'Rust cannot run in a browser');
});

test('reads input from the Input tab', async ({ page }) => {
  await openExample(page, 'python', 'input');
  await page.getByTestId('dock-input').click();
  await page.getByTestId('stdin').fill('Ada\n20\n');
  await run(page);
  await expectOutput(page, 'Hello, Ada');
  await expectOutput(page, '20.5');
});

test('runs SQL and shows result tables', async ({ page }) => {
  await openExample(page, 'sql', 'sql-shop');
  await expectCode(page, 'INNER JOIN orders ON orders.customer_id = customers.id');
  await run(page);
  const table = page.getByTestId('result-table').first();
  await expect(table).toContainText('Min');
  await expect(table).toContainText('40');
  await expect(table.locator('tbody tr')).toHaveCount(2);
});

test('previews HTML in a sandboxed frame and reacts to clicks', async ({ page }) => {
  await openExample(page, 'html', 'html-page');
  await expectCode(page, '<title>Counter</title>');
  await run(page);
  const frame = page.frameLocator('[data-testid=preview-frame]');
  await expect(frame.locator('h1')).toHaveText('Click counter');
  await frame.locator('#add').click();
  await frame.locator('#add').click();
  await expect(frame.locator('#output')).toHaveText('Clicks: 2');
  // The frame has no same-origin access to the IDE.
  await expect(page.getByTestId('preview-frame')).toHaveAttribute('sandbox', /^(?!.*allow-same-origin).*$/);
});

test('generates assembly for both architectures', async ({ page }) => {
  await openExample(page, 'assembly', 'asm-sum-arm64');
  await expectCode(page, 'b.le loop');
  await openExample(page, 'assembly', 'asm-sum-x64');
  await expectCode(page, '.intel_syntax noprefix');
});

test('shows block problems and links them to the source', async ({ page }) => {
  await startProject(page, 'c');
  await page.evaluate(() => {
    const w = window as unknown as { __bf: { useProject: { getState: () => { project: { activeFileId: string }; replaceBlocks: (id: string, s: unknown) => void } } } };
    const s = w.__bf.useProject.getState();
    s.replaceBlocks(s.project.activeFileId, { blocks: { languageVersion: 0, blocks: [{ type: 'bf_start', id: 's', x: 20, y: 20, next: { block: { type: 'bf_try', id: 't', fields: { ERR: { id: 'v1' } } } } }] }, variables: [{ name: 'error', id: 'v1' }] });
  });
  await page.getByTestId('dock-problems').click();
  await expect(page.getByTestId('problems')).toContainText('C does not support exception handling');
  await run(page);
  // A program with block errors is not run; the reason is in the output.
  await page.getByTestId('dock-output').click();
  await expectOutput(page, 'Fix the block errors');
});

test('compares languages side by side with semantic notes', async ({ page }) => {
  await openExample(page, 'python', 'lists');
  await page.getByTestId('nav-compare').click();
  await expect(page.getByTestId('compare-python')).toBeVisible();
  await expect(page.getByTestId('compare-rust')).toBeVisible();
  await page.getByTestId('compare-notes-tab').click();
  await expect(page.getByTestId('compare-notes')).toContainText('Passing a list to a function');
});

test('block search and code ownership', async ({ page }) => {
  await startProject(page, 'javascript');
  await page.getByTestId('block-search').fill('repeat');
  await expect(page.locator('.blocklyFlyout .blocklyDraggable').first()).toBeVisible();
  await page.getByTestId('block-search').fill('');

  // Editing the code detaches it from the blocks, explicitly.
  await page.getByTestId('code-detach').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('code-mode')).toContainText('Edited as code');
  await page.evaluate(() => {
    const w = window as unknown as { __bf: { useProject: { getState: () => { project: { activeFileId: string }; updateCode: (id: string, code: string) => void } } } };
    const s = w.__bf.useProject.getState();
    s.updateCode(s.project.activeFileId, 'let total = 0;\nfor (let i = 1; i <= 4; i++) {\n  total += i;\n}\nconsole.log("sum " + total);\nsetTimeout(() => {}, 0);\n');
  });
  await run(page);
  await expectOutput(page, 'sum 10');

  // Supported JavaScript becomes blocks; the rest is kept as raw code and reported.
  await page.getByTestId('code-to-blocks').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('1 parts are outside the block vocabulary');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('code-mode')).toContainText('Generated from blocks');
  await expectCode(page, 'setTimeout(() => {}, 0);');
  await setLanguage(page, 'python');
  await expectCode(page, 'for i in range(1, 5):');
  expect(await codeText(page)).toContain('# skipped raw javascript code');
});

test('drags a block from the toolbox into the workspace', async ({ page }) => {
  await startProject(page, 'python');
  await page.locator('.blocklyToolboxCategory', { hasText: 'Input and output' }).click();
  const source = page.locator('.blocklyFlyout .blocklyDraggable').first();
  await expect(source).toBeVisible();
  const from = await source.boundingBox();
  // The last block of the main stack: the new block is dropped just below it.
  // The flyout has block canvases of its own, so the workspace block is picked by type: it comes last in the document.
  const target = await page.getByTestId('blocks-editor').locator('.blocklyDraggable.text_print').last().locator('> .blocklyPath').boundingBox();
  await page.mouse.move(from!.x + 30, from!.y + 20);
  await page.mouse.down();
  await page.mouse.move(from!.x + 60, from!.y + 40, { steps: 4 });
  await page.mouse.move(target!.x + 80, target!.y + target!.height + 70, { steps: 12 });
  await page.mouse.move(target!.x + 30, target!.y + target!.height + 22, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await codeText(page)).match(/print\(/g)?.length ?? 0).toBe(2);
});
