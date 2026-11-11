import { expect, type Page, type Route, test } from '@playwright/test';
import { expectCode, freshApp, startProject } from './helpers';

type Delta = { content?: string; tool_calls?: { index: number; id?: string; function: { name?: string; arguments: string } }[] };

/** A streamed chat-completions answer, the way OpenAI-compatible providers send it. */
function sse(deltas: Delta[], finish = 'stop'): string {
  const events = deltas.map((delta) => ({ choices: [{ delta }] }));
  events.push({ choices: [{ delta: {}, finish_reason: finish }] } as never);
  return `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\ndata: [DONE]\n\n`;
}

const toolCall = (id: string, name: string, args: unknown): Delta[] => [{ tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] }, { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }];

/** Answer the provider's requests in order and record what the app sent. */
async function mockProvider(page: Page, answers: string[]): Promise<{ bodies: Record<string, unknown>[]; headers: Record<string, string>[] }> {
  const seen = { bodies: [] as Record<string, unknown>[], headers: [] as Record<string, string>[] };
  let i = 0;
  await page.route('https://api.deepseek.com/**', async (route: Route) => {
    seen.bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    seen.headers.push(route.request().headers());
    await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body: answers[Math.min(i++, answers.length - 1)] });
  });
  return seen;
}

async function useDeepSeek(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const bf = (window as unknown as { __bf: { platform: { setSecret: (id: string, v: string, o: string) => Promise<void> }; useSettings: { getState: () => { update: (p: unknown) => void } }; refreshKeys: () => Promise<void> } }).__bf;
    await bf.platform.setSecret('deepseek', 'sk-test-0123456789abcdef0123', 'https://api.deepseek.com');
    bf.useSettings.getState().update({ ai: { activeProviderId: 'deepseek', context: 'always' }, layout: { rightOpen: true, rightTab: 'assistant' } });
    await bf.refreshKeys();
  });
}

/** A terminal that records what it was asked to run and answers with canned output. */
async function fakeTerminal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __bf: { platform: Record<string, unknown> }; __ran: string[] };
    w.__ran = [];
    const enc = new TextEncoder();
    w.__bf.platform.terminal = {
      available: true,
      open: async (options: { command?: string }, onData: (b: Uint8Array) => void) => {
        let finish!: (code: number | null) => void;
        const done = new Promise<number | null>((r) => (finish = r));
        if (options.command) {
          w.__ran.push(options.command);
          setTimeout(() => {
            onData(enc.encode(`\x1b[32mran:\x1b[0m ${options.command}\r\nAPI_KEY=sk-live-abcdefghijklmnopqrstuvwx\r\n`));
            finish(options.command!.includes('fail') ? 2 : 0);
          }, 30);
        } else onData(enc.encode('shell ready\r\n$ '));
        return { id: 'fake', cwd: '/work', write: async (d: string) => onData(enc.encode(d)), resize: async () => undefined, close: async () => finish(null), done };
      },
    };
  });
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
}

test.beforeEach(async ({ page }) => {
  await freshApp(page);
  await startProject(page, 'python');
});

test('a block edit proposed through a tool call is previewed, applied and undone', async ({ page }) => {
  // The proposal refers to an existing block by its id, the way the assistant sees the workspace.
  const startId = await page.evaluate(() => {
    const p = (window as unknown as { __bf: { useProject: { getState: () => { project: { files: { blocks: { blocks: { blocks: { id: string; type: string }[] } } }[] } } } } }).__bf.useProject.getState().project;
    return p.files[0].blocks.blocks.blocks.find((b) => b.type === 'bf_start')!.id;
  });
  const seen = await mockProvider(page, [
    sse([{ content: 'I will add a print block.' }, ...toolCall('call_1', 'propose_block_edits', { summary: 'Print a greeting', ops: [{ op: 'append', target: startId, blocks: [{ type: 'text_print', inputs: { TEXT: { type: 'text', fields: { TEXT: 'from the assistant' } } } }] }] })], 'tool_calls'),
  ]);
  await useDeepSeek(page);
  await send(page, 'Add a print block');
  await expect(page.getByTestId('block-proposal')).toBeVisible();
  // The request carried the key in a header, never in the body.
  expect(seen.headers[0].authorization).toBe('Bearer sk-test-0123456789abcdef0123');
  expect(JSON.stringify(seen.bodies[0])).not.toContain('sk-test');
  expect((seen.bodies[0].tools as { function: { name: string } }[]).map((t) => t.function.name)).toContain('propose_block_edits');
  // Nothing changes until the user applies it.
  await expectCode(page, /^(?![\s\S]*from the assistant)/);
  await page.getByTestId('proposal-apply').click();
  await expectCode(page, 'from the assistant');
  await page.getByTestId('proposal-undo').click();
  await expectCode(page, /^(?![\s\S]*from the assistant)/);
});

test('the key is kept out of saved settings and exported projects', async ({ page }) => {
  await useDeepSeek(page);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('sk-test');
  const project = await page.evaluate(() => JSON.stringify((window as unknown as { __bf: { useProject: { getState: () => { project: unknown } } } }).__bf.useProject.getState().project));
  expect(project).not.toContain('sk-test');
});

test('a command the assistant asks for runs only after approval and its result goes back', async ({ page }) => {
  await fakeTerminal(page);
  const seen = await mockProvider(page, [sse([{ content: 'Let me check the files.' }, ...toolCall('call_a', 'run_command', { command: 'ls -la', reason: 'See what is in the folder.' })], 'tool_calls'), sse([{ content: 'The folder holds your project files.' }])]);
  await useDeepSeek(page);
  await send(page, 'What files are here?');
  const card = page.getByTestId('command-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('command-text')).toHaveText('ls -la');
  await expect(card).toContainText('See what is in the folder.');
  await expect(card).toContainText('The output is sent to DeepSeek');
  // The terminal tools were offered and nothing has run yet.
  expect((seen.bodies[0].tools as { function: { name: string } }[]).map((t) => t.function.name)).toEqual(expect.arrayContaining(['run_command', 'read_terminal']));
  expect(await page.evaluate(() => (window as unknown as { __ran: string[] }).__ran)).toEqual([]);
  expect(seen.bodies).toHaveLength(1);
  await page.getByTestId('command-run').click();
  await expect(card).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('The folder holds your project files.');
  expect(await page.evaluate(() => (window as unknown as { __ran: string[] }).__ran)).toEqual(['ls -la']);
  // The follow-up request answers the tool call with the output, as data and with the secret removed.
  const messages = seen.bodies[1].messages as { role: string; content: string; tool_call_id?: string }[];
  const result = messages.find((m) => m.role === 'tool');
  expect(result?.tool_call_id).toBe('call_a');
  expect(result?.content).toContain('Exit code 0.');
  expect(result?.content).toContain('ran: ls -la');
  expect(result?.content).toContain('<terminal_output>');
  expect(result?.content).not.toContain('sk-live-abcdefghijklmnopqrstuvwx');
  expect(result?.content).not.toContain('\u001b[');
  // The command shows in a terminal tab of its own.
  await expect(page.getByTestId('terminal-tab')).toContainText('ls -la');
  await page.getByTestId('command-output-toggle').click();
  await expect(page.getByTestId('command-output')).toContainText('ran: ls -la');
});

test('a rejected command never runs and the assistant is told', async ({ page }) => {
  await fakeTerminal(page);
  const seen = await mockProvider(page, [sse(toolCall('call_r', 'run_command', { command: 'rm -rf build', reason: 'Clean up.' }), 'tool_calls'), sse([{ content: 'Understood, I will not remove anything.' }])]);
  await useDeepSeek(page);
  await send(page, 'Clean the project');
  await expect(page.getByTestId('command-risky')).toBeVisible();
  await page.getByTestId('command-reject').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('I will not remove anything.');
  expect(await page.evaluate(() => (window as unknown as { __ran: string[] }).__ran)).toEqual([]);
  const result = (seen.bodies[1].messages as { role: string; content: string }[]).find((m) => m.role === 'tool');
  expect(result?.content).toBe('The user did not allow this.');
});

test('running without asking still stops for risky commands', async ({ page }) => {
  await fakeTerminal(page);
  await mockProvider(page, [sse(toolCall('call_s', 'run_command', { command: 'git status', reason: 'Check the state.' }), 'tool_calls'), sse(toolCall('call_t', 'run_command', { command: 'git push origin main', reason: 'Publish.' }), 'tool_calls'), sse([{ content: 'Done.' }])]);
  await useDeepSeek(page);
  await page.evaluate(() => (window as unknown as { __bf: { useSettings: { getState: () => { update: (p: unknown) => void } } } }).__bf.useSettings.getState().update({ ai: { commands: 'auto' } }));
  await send(page, 'Publish my work');
  // The harmless command ran on its own; the push waits for the user.
  await expect(page.getByTestId('command-card').first()).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('command-card').nth(1)).toHaveAttribute('data-status', 'pending');
  await expect(page.getByTestId('command-risky')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __ran: string[] }).__ran)).toEqual(['git status']);
});

test('with terminal access off the tools are not offered', async ({ page }) => {
  await fakeTerminal(page);
  const seen = await mockProvider(page, [sse([{ content: 'Hello.' }])]);
  await useDeepSeek(page);
  await page.evaluate(() => (window as unknown as { __bf: { useSettings: { getState: () => { update: (p: unknown) => void } } } }).__bf.useSettings.getState().update({ ai: { commands: 'off' } }));
  await send(page, 'Hi');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Hello.');
  const names = ((seen.bodies[0].tools as { function: { name: string } }[] | undefined) ?? []).map((t) => t.function.name);
  expect(names).not.toContain('run_command');
  expect(JSON.stringify(seen.bodies[0])).toContain('You cannot run commands');
});

test('the terminal tab opens a shell and takes typed input', async ({ page }) => {
  await fakeTerminal(page);
  await page.getByTestId('dock-terminal').click();
  await expect(page.getByTestId('terminal-pane')).toBeVisible();
  await expect(page.getByTestId('terminal-tab')).toHaveCount(1);
  await expect(page.locator('.xterm-rows')).toContainText('shell ready');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('echo typed');
  await expect(page.locator('.xterm-rows')).toContainText('echo typed');
  await page.getByTestId('terminal-new').click();
  await expect(page.getByTestId('terminal-tab')).toHaveCount(2);
});
