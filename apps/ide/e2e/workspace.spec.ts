import { expect, type Page, test } from '@playwright/test';
import { expectOutput, freshApp, run, startProject } from './helpers';

/** An in-memory folder standing in for the desktop backend, so the explorer can be driven in a browser. */
async function fakeDesktop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __bf: { platform: Record<string, unknown> }; __fs: Record<string, string | null>; __trashed: string[] };
    w.__fs = { '/work/demo': null, '/work/demo/src': null, '/work/demo/src/main.py': "print('from disk')\n", '/work/demo/README.md': '# Demo\nhello folder\n', '/work/demo/data.bin': '\u0000binary' };
    w.__trashed = [];
    const fs = w.__fs;
    const base = (p: string) => p.split('/').pop()!;
    const parent = (p: string) => p.slice(0, p.lastIndexOf('/'));
    w.__bf.platform.workspace = {
      available: true,
      pickFolder: async () => ({ path: '/work/demo', name: 'demo' }),
      recentFolders: async () => [{ path: '/work/demo', name: 'demo' }],
      reopenFolder: async (path: string) => ({ path, name: base(path) }),
      forgetFolder: async () => undefined,
      list: async (dir: string) =>
        Object.keys(fs)
          .filter((p) => parent(p) === dir)
          .map((p) => ({ name: base(p), path: p, dir: fs[p] === null, size: fs[p]?.length ?? 0 }))
          .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)),
      read: async (p: string) => (fs[p]?.includes('\u0000') ? { binary: true, size: 7 } : { text: fs[p] ?? '', binary: false, size: fs[p]?.length ?? 0 }),
      write: async (p: string, text: string) => void (fs[p] = text),
      create: async (p: string, dir: boolean) => {
        if (p in fs) throw new Error('Something with this name already exists.');
        fs[p] = dir ? null : '';
      },
      rename: async (from: string, to: string) => {
        for (const p of Object.keys(fs).filter((k) => k === from || k.startsWith(`${from}/`))) {
          fs[to + p.slice(from.length)] = fs[p];
          delete fs[p];
        }
      },
      trash: async (p: string) => {
        for (const k of Object.keys(fs).filter((x) => x === p || x.startsWith(`${p}/`))) delete fs[k];
        w.__trashed.push(p);
      },
      reveal: async () => undefined,
      search: async (_root: string, query: string) =>
        Object.entries(fs)
          .filter(([, v]) => typeof v === 'string')
          .flatMap(([p, v]) => (v as string).split('\n').flatMap((line, i) => (line.toLowerCase().includes(query.toLowerCase()) ? [{ path: p, rel: p.replace('/work/demo/', ''), line: i + 1, text: line }] : []))),
    };
  });
}

const fsText = (page: Page, path: string) => page.evaluate((p) => (window as unknown as { __fs: Record<string, string | null> }).__fs[p], path);

test('the logo and the Home row lead to the home screen and back', async ({ page }) => {
  await freshApp(page);
  await startProject(page, 'python');
  await page.getByTestId('brand-home').click();
  await expect(page.getByTestId('hero')).toBeVisible();
  await expect(page.getByTestId('nav-home')).toHaveClass(/active/);
  await page.getByTestId('back-to-editor').click();
  await expect(page.getByTestId('editor-area')).toBeVisible();
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('hero')).toBeVisible();
  // A file of the open project brings the editor back.
  await page.getByTestId('file-row').first().click();
  await expect(page.getByTestId('editor-area')).toBeVisible();
});

test('a new tab is a plain text editor whose language can be chosen and run', async ({ page }) => {
  await freshApp(page);
  await page.getByTestId('hero-new-text').click();
  await expect(page.getByTestId('text-pane')).toBeVisible();
  await expect(page.getByTestId('text-language')).toHaveValue('plaintext');
  // Plain text has nothing to run.
  await expect(page.getByTestId('run')).toHaveCount(0);
  await page.getByTestId('text-editor').locator('.monaco-editor').first().click();
  await page.keyboard.type('console.log("typed in a text tab")');
  await expect(page.getByTestId('text-tab').locator('.dot')).toBeVisible();
  await page.getByTestId('text-language').selectOption('javascript');
  await run(page);
  await expectOutput(page, 'typed in a text tab');
  // A second tab keeps its own text and language.
  await page.getByTestId('new-tab').click();
  await expect(page.getByTestId('text-tab')).toHaveCount(2);
  await expect(page.getByTestId('text-language')).toHaveValue('plaintext');
  await page.getByTestId('text-tab').first().click();
  await expect(page.getByTestId('text-language')).toHaveValue('javascript');
});

test('block files and text files share one tab bar', async ({ page }) => {
  await freshApp(page);
  await startProject(page, 'python');
  await page.getByTestId('new-tab').click();
  await expect(page.getByTestId('text-pane')).toBeVisible();
  await expect(page.getByTestId('blocks-editor')).toHaveCount(0);
  await page.getByTestId('text-language').selectOption('typescript');
  await page.getByTestId('text-editor').locator('.monaco-editor').first().click();
  await page.keyboard.type('const n: number = 20 + 22;\nconsole.log(`ts says ${n}`);');
  await run(page);
  await expectOutput(page, 'ts says 42');
  await page.getByTestId('file-tab').first().click();
  await expect(page.getByTestId('blocks-editor')).toBeVisible();
  await run(page);
  await expectOutput(page, 'Hello, World!');
});

test('text tabs come back after a reload', async ({ page }) => {
  await freshApp(page);
  await page.getByTestId('hero-new-text').click();
  await page.getByTestId('text-editor').locator('.monaco-editor').first().click();
  await page.keyboard.type('keep me');
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByTestId('text-pane')).toBeVisible();
  await expect(page.getByTestId('text-editor')).toContainText('keep me');
});

test('explorer: open a folder, browse, edit, create, rename, delete', async ({ page }) => {
  await freshApp(page);
  await expect(page.getByTestId('explorer-empty')).toBeVisible();
  // In a browser the buttons are disabled and say why.
  await expect(page.getByTestId('open-folder')).toBeDisabled();
  await fakeDesktop(page);
  await page.reload();
  await expect(page.getByTestId('hero')).toBeVisible();
  await fakeDesktop(page);
  await page.evaluate(() => (window as unknown as { __bf: { workspace: { openFolder: () => Promise<void> } } }).__bf.workspace.openFolder());
  const tree = page.getByTestId('explorer-tree');
  await expect(tree.getByText('src')).toBeVisible();
  await expect(tree.getByText('README.md')).toBeVisible();
  // Folders expand on click and files open in a tab.
  await tree.getByText('src').click();
  await tree.getByText('main.py').click();
  await expect(page.getByTestId('text-language')).toHaveValue('python');
  await expect(page.getByTestId('text-editor')).toContainText("print('from disk')");
  await run(page);
  await expectOutput(page, 'from disk');
  // Editing marks the tab; saving writes the file.
  await page.getByTestId('text-editor').locator('.monaco-editor').first().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type("print('edited')");
  await expect(page.getByTestId('text-tab').locator('.dot')).toBeVisible();
  await page.getByTestId('text-save').click();
  await expect(page.getByTestId('text-tab').locator('.dot')).toHaveCount(0);
  expect(await fsText(page, '/work/demo/src/main.py')).toContain("print('edited')");
  // Binary files are refused with a message.
  await tree.getByText('data.bin').click();
  await expect(page.locator('.toast')).toContainText('data.bin');
  // New file in the folder.
  await page.getByTestId('explorer-new-file').click();
  await page.locator('.dialog input').fill('notes.txt');
  await page.keyboard.press('Enter');
  await expect(tree.getByText('notes.txt')).toBeVisible();
  expect(await fsText(page, '/work/demo/notes.txt')).toBe('');
  // Rename through the row menu; the open tab follows.
  const row = tree.getByTestId('tree-row').filter({ hasText: 'notes.txt' });
  await row.hover();
  await row.locator('.trail button').click();
  await page.locator('.menu-item', { hasText: 'Rename' }).click();
  await page.locator('.dialog input').fill('todo.txt');
  await page.keyboard.press('Enter');
  await expect(tree.getByText('todo.txt')).toBeVisible();
  await expect(page.getByTestId('text-tab').filter({ hasText: 'todo.txt' })).toBeVisible();
  // Delete asks first and moves to the Trash.
  const todo = tree.getByTestId('tree-row').filter({ hasText: 'todo.txt' });
  await todo.hover();
  await todo.locator('.trail button').click();
  await page.locator('.menu-item', { hasText: 'Move to Trash' }).click();
  await expect(page.locator('.dialog')).toContainText('todo.txt');
  await page.locator('.dialog .btn', { hasText: 'Move to Trash' }).click();
  await expect(tree.getByText('todo.txt')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __trashed: string[] }).__trashed)).toEqual(['/work/demo/todo.txt']);
  // Search covers the files of the folder.
  await page.getByTestId('open-search').click();
  await page.getByTestId('global-search').fill('hello folder');
  await expect(page.getByTestId('search-hit-disk')).toContainText('hello folder');
});
