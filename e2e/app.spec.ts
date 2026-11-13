import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain JS helper
import { startFakeAi } from '../test/fake-ai.mjs';

/** A fake "brain" that does the to-do task by reading the element list the app sends. */
const todoBrain = (body: { messages: { role: string; content: unknown }[] }) => {
  const user = body.messages.find((m) => m.role === 'user')!.content as { type: string; text?: string }[];
  const p = (Array.isArray(user) ? user.find((c) => c.type === 'text')?.text : String(user)) || '';
  const done = (p.split('Previous steps:')[1].match(/^\d+\. /gm) || []).length;
  const input = Number(p.match(/\[(\d+)\] input[^\n]*"New todo"/)?.[1]);
  const add = Number(p.match(/\[(\d+)\] button "Add"/)?.[1]);
  const items = ['milk', 'bread', 'eggs'];
  if (done >= 6) return { thought: 'All three are in the list.', action: 'done', answer: 'Added milk, bread and eggs.' };
  return done % 2 === 0 ? { thought: `Type ${items[done / 2]}`, action: 'type', element: input, text: items[done / 2] } : { thought: 'Add it', action: 'click', element: add };
};

test('the agent does a task in its own browser; blocked sites stay blocked; replay works', async () => {
  const fake = await startFakeAi({ fixtures: { 'TASK: Add three': todoBrain } });
  const app = await electron.launch({
    args: ['.'],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>, TP_USER_DATA: mkdtempSync(join(tmpdir(), 'tp-')), TP_GEMINI_KEY: 'fake', TP_AI_BASE_URL: fake.url },
  });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await expect(win.getByText('Pilot', { exact: true })).toBeVisible();

  await win.getByLabel('Address').fill('bench://sites/todo.html');
  await win.getByRole('button', { name: 'Go' }).click();
  await win.getByLabel('Task').fill('Add three to-dos: milk, bread and eggs.');
  await win.getByRole('button', { name: '▶ Run task' }).click();
  await expect(win.getByTestId('end')).toContainText('Finished', { timeout: 60000 });
  await expect(win.getByTestId('end')).toContainText('Added milk, bread and eggs');
  await expect(win.getByTestId('log')).toContainText('Type “bread” into');
  await win.screenshot({ path: 'test-results/run.png' });

  // The page really changed: read it from the main process.
  const todos = await app.evaluate(async ({ webContents }) => {
    const agent = webContents.getAllWebContents().find((w) => w.getURL().startsWith('bench://'));
    return agent?.executeJavaScript('sessionStorage.getItem("todos")');
  });
  expect(JSON.parse(todos)).toEqual(['milk', 'bread', 'eggs']);
  expect(fake.calls.filter((c: { path: string }) => c.path === '/chat/completions').length).toBe(7);

  await win.getByLabel('Address').fill('https://www.linkedin.com/feed');
  await win.getByRole('button', { name: 'Go' }).click();
  await expect(win.getByText(/never automated by TaskPilot/)).toBeVisible();

  await win.getByRole('button', { name: 'history' }).click();
  await win.getByRole('button', { name: '▶ Replay' }).first().click();
  await expect(win.getByTestId('replay')).toContainText('Replay: Add three');
  await win.screenshot({ path: 'test-results/replay.png' });

  expect(errors).toEqual([]);
  await app.close();
  await fake.close();
});
