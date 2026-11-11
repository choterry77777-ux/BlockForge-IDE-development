import { expect, type Page, test } from '@playwright/test';
import { freshApp, startProject } from './helpers';

interface Finding {
  kind: string;
  text: string;
  where: string;
}

/**
 * Look for the layout faults a person would notice: text cut off without an
 * ellipsis, controls sticking out of their panel or the window, and neighbours
 * drawn on top of each other.
 */
async function audit(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: { kind: string; text: string; where: string }[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
    };
    const label = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50) || el.getAttribute('title') || el.getAttribute('aria-label') || el.className.toString().slice(0, 40);
    const where = (el: Element) => {
      const host = el.closest('[data-testid]');
      return `${host?.getAttribute('data-testid') ?? '?'} <${el.tagName.toLowerCase()} class="${el.className.toString().slice(0, 50)}">`;
    };
    // Inside a scroller, only what is scrolled into view is judged.
    const clippedByScroller = (el: Element) => {
      const r = el.getBoundingClientRect();
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(`${s.overflowX}${s.overflowY}`)) {
          const pr = p.getBoundingClientRect();
          if (r.right > pr.right + 1 || r.left < pr.left - 1 || r.bottom > pr.bottom + 1 || r.top < pr.top - 1) return true;
        }
      }
      return false;
    };
    const skip = (el: Element) => !!el.closest('.monaco-editor, .blocklySvg, .blocklyToolbox, .blocklyFlyout, .blocklyWidgetDiv, .xterm, .md, pre, .diff, .terminal, iframe, .blockly-minimap, svg');

    const controls = [...document.querySelectorAll('.btn, .tab, .nav-row, .chip, .select, .input, .setting, .segmented, .lang-tile, .list-row, .tool-card-head, .dialog-head, .side-section-head, .kbd, .notice, h1, h2, h3, label, .hint, .bf-brand-home, .menu-item')].filter((el) => visible(el) && !skip(el));

    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      // 1. Sticking out of the window.
      if (!clippedByScroller(el) && (r.right > window.innerWidth + 1 || r.left < -1 || r.bottom > window.innerHeight + 1 || r.top < -1)) out.push({ kind: 'outside-window', text: label(el), where: where(el) });
      // 2. Text cut off with no ellipsis to show it.
      const cut = (n: Element) => {
        const ns = getComputedStyle(n);
        return n.scrollWidth > n.clientWidth + 1 && ns.overflowX === 'hidden' && ns.textOverflow !== 'ellipsis' && ns.whiteSpace === 'nowrap';
      };
      if (el.children.length === 0 || el.matches('.btn, .tab, .chip, .nav-row, .lang-tile')) {
        if (cut(el) && ![...el.querySelectorAll('*')].some((c) => getComputedStyle(c).textOverflow === 'ellipsis')) out.push({ kind: 'cut-text', text: label(el), where: where(el) });
      }
      // 3. Content wider than a fixed-size control with visible overflow: it paints over neighbours.
      if (el.matches('.btn, .tab, .chip, .kbd, .select') && s.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 2) out.push({ kind: 'spills-over', text: label(el), where: where(el) });
      // 4. A wrapped label in a one-line control.
      if (el.matches('.btn, .tab, .chip, .nav-row:not([style*="height: auto"])') && !el.matches('.block') && r.height > 46 && !el.closest('.hero')) out.push({ kind: 'wrapped-control', text: label(el), where: where(el) });
    }

    // 5. Neighbours in a row drawn over each other.
    for (const row of document.querySelectorAll('.row, .bf-header, .tabs, .tool-card-head, .dialog-head, .setting, .side-section-head, .bf-brand, .dialog-foot')) {
      if (!visible(row) || skip(row)) continue;
      // Split handles are thin grab strips laid over the seam on purpose.
      const kids = [...row.children].filter((k) => visible(k) && getComputedStyle(k).position !== 'absolute' && !k.matches('.badge-dot, .split-handle'));
      const cs = getComputedStyle(row);
      if (cs.flexDirection.startsWith('column') || cs.flexWrap !== 'nowrap') continue;
      for (let i = 1; i < kids.length; i++) {
        const a = kids[i - 1].getBoundingClientRect();
        const b = kids[i].getBoundingClientRect();
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 2 && overlapY > 2 && !clippedByScroller(kids[i])) out.push({ kind: 'overlap', text: `${label(kids[i - 1])} | ${label(kids[i])}`, where: where(row) });
      }
    }
    // 6. Any two pieces of text drawn over each other, and text cut off by its box.
    const top = [...document.querySelectorAll('.backdrop')].pop() ?? [...document.querySelectorAll('.menu')].pop() ?? document.body;
    const texts: { el: Element; r: DOMRect; text: string }[] = [];
    const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = (n.textContent ?? '').trim();
      if (!el || !text || skip(el) || el.closest('.toasts, option, select, script, style, .sr-only') || !visible(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // Clip to the boxes that hide overflow; note when a box cuts the text without an ellipsis.
      let left = r.left, right = r.right, topY = r.top, bottom = r.bottom, hidden = false;
      for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (Number(ps.opacity) < 0.05 || ps.visibility === 'hidden') hidden = true;
        const clipsX = ps.overflowX !== 'visible';
        const clipsY = ps.overflowY !== 'visible';
        if (!clipsX && !clipsY) continue;
        const pr = p.getBoundingClientRect();
        const scrollable = /(auto|scroll)/.test(`${ps.overflowX}${ps.overflowY}`);
        const ellipsis = ps.textOverflow === 'ellipsis' || !!el.closest('.ellipsis');
        if (!scrollable && !ellipsis && ((clipsX && (right > pr.right + 2 || left < pr.left - 2)) || (clipsY && bottom > pr.bottom + 3 && topY < pr.bottom - 2))) out.push({ kind: 'clipped-text', text: text.slice(0, 50), where: where(el) });
        if (clipsX) { left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
        if (clipsY) { topY = Math.max(topY, pr.top); bottom = Math.min(bottom, pr.bottom); }
      }
      if (hidden || right - left < 2 || bottom - topY < 2) continue;
      texts.push({ el, r: new DOMRect(left, topY, right - left, bottom - topY), text: text.slice(0, 40) });
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x > 3 && y > 4) out.push({ kind: 'text-overlap', text: `${a.text} | ${b.text}`, where: where(a.el) });
      }
    }
    // 7. A card or row squeezed flat although it has content.
    for (const el of top.querySelectorAll('.card, .panel, .tool-card, .setting, .list-row, .nav-row')) {
      if (skip(el) || !el.textContent?.trim()) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (s.display !== 'none' && r.width > 20 && r.height < 14 && !clippedByScroller(el)) out.push({ kind: 'squeezed', text: label(el), where: where(el) });
    }
    // 8. A panel squeezed to nothing.
    for (const el of document.querySelectorAll('.dialog-body, .bf-main, .bf-right, .bf-dock')) {
      const r = el.getBoundingClientRect();
      if (visible(el) && (r.height < 60 || r.width < 200)) out.push({ kind: 'collapsed', text: `${Math.round(r.width)}x${Math.round(r.height)}`, where: where(el) });
    }
    // 9. A part of the interface that stopped with an error.
    for (const el of document.querySelectorAll('[data-testid=error-panel]')) out.push({ kind: 'crashed', text: (el.querySelector('pre')?.textContent ?? el.textContent ?? '').trim().slice(0, 160), where: where(el.parentElement ?? el) });
    if (!document.getElementById('root')?.children.length) out.push({ kind: 'blank-window', text: '', where: 'root' });
    const seen = new Set<string>();
    return out.filter((f) => {
      const k = `${f.kind}|${f.text}|${f.where}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
}

const bf = (page: Page, fn: string) => page.evaluate(fn);
const command = (page: Page, id: string) => page.evaluate((c) => (window as unknown as { __bf: { runCommand: (id: string) => void } }).__bf.runCommand(c), id);
const setLayout = (page: Page, layout: Record<string, unknown>) => page.evaluate((l) => (window as unknown as { __bf: { useSettings: { getState: () => { update: (p: unknown) => void } } } }).__bf.useSettings.getState().update({ layout: l }), layout);

const RIGHT = ['assistant', 'compare', 'packages', 'toolchains', 'browser', 'tools', 'preview'];
const DOCK = ['output', 'problems', 'input', 'terminal'];
const DIALOGS = ['new', 'projects', 'examples', 'shortcuts', 'palette', 'settings'];

/** Panels and dialogs in a state without a block project: the home screen, or only a text tab. */
async function walkWithoutProject(page: Page, state: string, check: (name: string) => Promise<void>): Promise<void> {
  for (const tab of RIGHT) {
    await setLayout(page, { rightOpen: true, rightTab: tab });
    await page.waitForTimeout(120);
    await check(`${state}/right:${tab}`);
  }
  await setLayout(page, { rightTab: 'assistant' });
  for (const dialog of DIALOGS) {
    await command(page, dialog);
    await page.waitForTimeout(120);
    await check(`${state}/dialog:${dialog}`);
    await page.keyboard.press('Escape');
  }
  for (const id of ['run', 'build', 'save', 'search', 'compare', 'packages', 'fix', 'toBlocks', 'exportZip', 'newFile', 'undoBlocks', 'toggleDock', 'toggleDock', 'toggleRight', 'toggleRight', 'terminal']) {
    await command(page, id);
    await page.waitForTimeout(60);
  }
  await page.keyboard.press('Escape');
  await check(`${state}/after-commands`);
}

async function walk(page: Page, check: (name: string) => Promise<void>): Promise<void> {
  await check('home');
  await walkWithoutProject(page, 'home', check);
  await command(page, 'newText');
  await check('text-only');
  for (const tab of DOCK) {
    await setLayout(page, { dockOpen: true, dockTab: tab });
    await page.waitForTimeout(100);
    await check(`text-only/dock:${tab}`);
  }
  await walkWithoutProject(page, 'text-only', check);
  await setLayout(page, { rightOpen: true, rightTab: 'assistant', dockOpen: true, dockTab: 'output' });
  await command(page, 'home');
  await startProject(page, 'python');
  await check('editor');
  for (const tab of ['assistant', 'compare', 'packages', 'toolchains', 'browser', 'tools', 'preview']) {
    await setLayout(page, { rightOpen: true, rightTab: tab });
    await page.waitForTimeout(150);
    await check(`right:${tab}`);
  }
  for (const tab of ['output', 'problems', 'input', 'terminal']) {
    await setLayout(page, { dockOpen: true, dockTab: tab });
    await page.waitForTimeout(100);
    await check(`dock:${tab}`);
    // The header is tightest while a run is in progress and its status is shown.
    for (const status of ['building', 'running']) {
      await bf(page, `window.__bf.useRun.setState({ status: '${status}' })`);
      await page.waitForTimeout(60);
      await check(`dock:${tab}:${status}`);
    }
    await bf(page, `window.__bf.useRun.setState({ status: 'idle', lastExit: { ok: true, ms: 1234 } })`);
    await page.waitForTimeout(60);
    await check(`dock:${tab}:finished`);
    await bf(page, `window.__bf.useRun.setState({ lastExit: undefined })`);
  }
  await setLayout(page, { rightTab: 'assistant', dockTab: 'output' });
  await command(page, 'settings');
  for (const tab of ['general', 'editor', 'blocks', 'run', 'ai', 'privacy', 'about']) {
    await page.getByTestId(`settings-${tab}`).click();
    await check(`settings:${tab}`);
  }
  await page.keyboard.press('Escape');
  for (const dialog of ['new', 'projects', 'examples', 'shortcuts', 'palette']) {
    await command(page, dialog);
    await page.waitForTimeout(100);
    await check(`dialog:${dialog}`);
    await page.keyboard.press('Escape');
  }
  await command(page, 'newText');
  await check('text-tab');
  await setLayout(page, { sidebarCollapsed: true });
  await check('rail');
  await setLayout(page, { sidebarCollapsed: false });
  await bf(page, `window.__bf.useUi.setState({ sidebarView: 'search', search: 'print' })`);
  await check('search');
  await bf(page, `window.__bf.useUi.setState({ sidebarView: 'files' })`);
  await command(page, 'home');
  await check('home-with-project');
}

for (const locale of ['en', 'ko', 'ja', 'zh-CN', 'zh-TW']) {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 680 },
  ]) {
    test(`nothing is cut off, overlapping or outside the window (${locale}, ${size.width}x${size.height})`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(size);
      await freshApp(page);
      await page.evaluate((l) => (window as unknown as { __bf: { useSettings: { getState: () => { update: (p: unknown) => void } } } }).__bf.useSettings.getState().update({ locale: l }), locale);
      await page.waitForTimeout(300);
      const problems: string[] = [];
      page.on('pageerror', (e) => problems.push(`uncaught error: ${e.message.slice(0, 200)}`));
      await walk(page, async (name) => {
        for (const f of await audit(page)) problems.push(`[${name}] ${f.kind}: "${f.text}" in ${f.where}`);
      });
      expect(problems).toEqual([]);
    });
  }
}
