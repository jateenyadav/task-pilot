// TaskPilot main process. The agent drives its own browser view (a separate session, so it never sees your real
// logins) through the Chrome DevTools Protocol. Every navigation and every action passes the safety rules.

import { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, safeStorage, shell, net } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runAgent } from './agent/loop.mjs';
import { makeBrain } from './agent/brain.mjs';
import { checkUrl } from './agent/safety.mjs';
import { OBSERVE, CLEAR_MARKS, selectAt, chooseOption } from './agent/page-scripts.mjs';

// bench:// pages behave like a normal secure site (storage, fetch, relative links).
protocol.registerSchemesAsPrivileged([{ scheme: 'bench', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
if (process.env.TP_USER_DATA) app.setPath('userData', process.env.TP_USER_DATA);
const DATA = app.getPath('userData');
const RUNS = join(DATA, 'runs');
const SETTINGS = join(DATA, 'settings.json');
const KEYFILE = join(DATA, 'gemini.key');
const PARTITION = 'persist:taskpilot-agent';
const VIEW = { width: 1200, height: 780 };

/* ---------- settings + key ---------- */

const defaults = { model: 'gemini-2.5-flash', allowSensitive: false, blocked: [], startUrl: 'bench://sites/index.html' };
const readSettings = () => { try { return { ...defaults, ...JSON.parse(readFileSync(SETTINGS, 'utf8')) }; } catch { return { ...defaults }; } };
const writeSettings = (s) => { mkdirSync(DATA, { recursive: true }); writeFileSync(SETTINGS, JSON.stringify(s, null, 2)); };
function readKey() {
  if (process.env.TP_GEMINI_KEY) return process.env.TP_GEMINI_KEY;
  if (process.argv.includes('--bench') && process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (!existsSync(KEYFILE)) return '';
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(readFileSync(KEYFILE)) : ''; } catch { return ''; }
}
function saveKey(key) {
  mkdirSync(DATA, { recursive: true });
  if (!key) { rmSync(KEYFILE, { force: true }); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no secure storage for the key.');
  writeFileSync(KEYFILE, safeStorage.encryptString(key));
}

/* ---------- runs (for replay) ---------- */

const saveRun = (run) => { mkdirSync(RUNS, { recursive: true }); writeFileSync(join(RUNS, `${run.id}.json`), JSON.stringify(run)); };
const listRuns = () => {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS).filter((f) => f.endsWith('.json')).map((f) => {
    try { const r = JSON.parse(readFileSync(join(RUNS, f), 'utf8')); return { id: r.id, task: r.task, status: r.status, startedAt: r.startedAt, steps: r.steps.length, answer: r.answer ?? null }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt);
};

/* ---------- windows ---------- */

let win;
let view;
let running = null; // { signal, pending: Map }

function serveBench(ses) {
  ses.protocol.handle('bench', (req) => {
    const u = new URL(req.url);
    const file = normalize(join(ROOT, 'bench', u.hostname, decodeURIComponent(u.pathname)));
    if (!file.startsWith(join(ROOT, 'bench'))) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
}

function lockDown(wc) {
  const settings = () => ({ allowSensitive: readSettings().allowSensitive, extraBlocked: readSettings().blocked });
  const guard = (e, url) => {
    const c = checkUrl(url, settings());
    if (!c.ok) { e.preventDefault(); win?.webContents.send('agent:blocked', { url, reason: c.reason }); }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('will-frame-navigate', (e) => { if (e.isMainFrame) guard(e, e.url); });
  wc.setWindowOpenHandler(({ url }) => {
    if (checkUrl(url, settings()).ok) wc.loadURL(url); // open pop-ups in the same view
    return { action: 'deny' };
  });
  wc.on('before-input-event', (_e, input) => { if (input.key === 'Escape' && running) stopRun('Esc'); });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1640, height: 960, minWidth: 1100, minHeight: 700, title: 'TaskPilot', backgroundColor: '#0b1220',
    show: process.env.TP_HIDDEN !== '1',
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const agentSession = session.fromPartition(PARTITION);
  serveBench(agentSession);
  agentSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); // no camera, mic, location, notifications…
  agentSession.setPermissionCheckHandler(() => false);
  agentSession.on('will-download', (e) => { e.preventDefault(); win?.webContents.send('agent:blocked', { url: '', reason: 'Downloads are blocked in the agent browser.' }); });
  agentSession.setUserAgent(agentSession.getUserAgent().replace(/Electron\/\S+\s?/, '').replace(/TaskPilot\/\S+\s?/, ''));

  view = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 420, y: 60, ...VIEW });
  lockDown(view.webContents);
  view.webContents.on('did-navigate', (_e, url) => win?.webContents.send('agent:url', url));
  view.webContents.on('did-navigate-in-page', (_e, url) => win?.webContents.send('agent:url', url));
  view.webContents.loadURL(readSettings().startUrl);

  win.webContents.on('before-input-event', (_e, input) => { if (input.key === 'Escape' && running) stopRun('Esc'); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.TP_DEV_URL) win.loadURL(process.env.TP_DEV_URL);
  else win.loadFile(join(ROOT, 'dist', 'index.html'));
}

/* ---------- the browser driver (CDP) ---------- */

function makeDriver(wc) {
  const dbg = wc.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const send = (method, params = {}) => dbg.sendCommand(method, params);
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`.slice(0, 300));
    return r.result?.value;
  };
  const settle = async (ms = 700) => {
    await new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 20 && wc.isLoading(); i++) await new Promise((r) => setTimeout(r, 250));
  };
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const KEYCODES = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38, PageDown: 34, PageUp: 33 };
  return {
    async observe() {
      const obs = await evaluate(OBSERVE);
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
      await evaluate(CLEAR_MARKS);
      return { ...obs, screenshot: shot.data };
    },
    async act(a, el) {
      switch (a.action) {
        case 'click': await click(el.x, el.y); await settle(); return null;
        case 'type': {
          if (el.tag === 'select') { const r = await evaluate(chooseOption(el.x, el.y, a.text)); await settle(300); return r === 'no-option' ? `no option “${a.text}”` : null; }
          await click(el.x, el.y);
          await evaluate(selectAt(el.x, el.y));
          await send('Input.insertText', { text: a.text });
          await settle(300);
          return null;
        }
        case 'scroll': await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: VIEW.width / 2, y: VIEW.height / 2, deltaX: 0, deltaY: a.direction === 'up' ? -600 : 600 }); await settle(400); return null;
        case 'key': {
          const p = { key: a.key, code: a.key, windowsVirtualKeyCode: KEYCODES[a.key], nativeVirtualKeyCode: KEYCODES[a.key] };
          await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p });
          if (a.key === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...p });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
          await settle();
          return null;
        }
        case 'goto': await wc.loadURL(a.url).catch(() => {}); await settle(); return null;
        case 'wait': await settle(1500); return null;
        default: return 'unknown action';
      }
    },
  };
}

/* ---------- running a task ---------- */

function stopRun(why) {
  if (!running) return;
  running.signal.stopped = true;
  for (const resolve of running.pending.values()) resolve(null);
  running.pending.clear();
  win?.webContents.send('agent:stopping', why);
}

async function startRun({ task, autoConfirm = false }) {
  if (running) throw new Error('A task is already running.');
  const key = readKey();
  const settings = readSettings();
  const brain = makeBrain({ apiKey: key, baseUrl: process.env.TP_AI_BASE_URL || undefined, model: settings.model });
  if (!brain.configured()) throw new Error('Add your free Gemini API key in Settings first.');
  const run = { id: randomUUID(), task, startedAt: Date.now(), steps: [], status: 'running' };
  const signal = { stopped: false };
  running = { signal, pending: new Map() };
  const askUser = (q) => {
    if (autoConfirm && q.kind === 'confirm') return Promise.resolve(true);
    return new Promise((resolve) => {
      const id = randomUUID();
      running.pending.set(id, resolve);
      win.webContents.send('agent:ask', { id, ...q });
    });
  };
  try {
    const out = await runAgent({
      task, brain, askUser, signal,
      driver: makeDriver(view.webContents),
      safety: { allowSensitive: settings.allowSensitive, extraBlocked: settings.blocked },
      onStep: (s) => { run.steps.push(s); win?.webContents.send('agent:step', s); },
    });
    const { steps: _count, ...rest } = out; // keep run.steps (the list), not the count
    Object.assign(run, rest, { endedAt: Date.now() });
  } catch (e) {
    Object.assign(run, { status: 'error', reason: String(e?.message || e), endedAt: Date.now() });
  } finally {
    running = null;
  }
  saveRun(run);
  win?.webContents.send('agent:end', { id: run.id, status: run.status, answer: run.answer ?? null, reason: run.reason ?? null, steps: run.steps.length });
  return run;
}

/* ---------- IPC ---------- */

function ipc() {
  ipcMain.handle('settings:get', () => ({ ...readSettings(), hasKey: Boolean(readKey()), secureStorage: safeStorage.isEncryptionAvailable() }));
  ipcMain.handle('settings:set', (_e, patch) => {
    const s = readSettings();
    if (typeof patch.key === 'string') saveKey(patch.key.trim());
    const next = {
      ...s,
      ...(typeof patch.model === 'string' ? { model: patch.model.slice(0, 60) } : {}),
      ...(typeof patch.allowSensitive === 'boolean' ? { allowSensitive: patch.allowSensitive } : {}),
      ...(Array.isArray(patch.blocked) ? { blocked: patch.blocked.map(String).map((d) => d.trim().toLowerCase()).filter(Boolean).slice(0, 200) } : {}),
      ...(typeof patch.startUrl === 'string' && checkUrl(patch.startUrl).ok ? { startUrl: patch.startUrl } : {}),
    };
    writeSettings(next);
    return { ...next, hasKey: Boolean(readKey()) };
  });
  ipcMain.handle('view:bounds', (_e, b) => {
    const r = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(200, Math.round(b.width)), height: Math.max(200, Math.round(b.height)) };
    view.setBounds(r);
    VIEW.width = r.width; VIEW.height = r.height;
  });
  ipcMain.handle('view:go', async (_e, url) => {
    const c = checkUrl(url, { allowSensitive: readSettings().allowSensitive, extraBlocked: readSettings().blocked });
    if (!c.ok) return { ok: false, reason: c.reason };
    await view.webContents.loadURL(url).catch(() => {});
    return { ok: true };
  });
  ipcMain.handle('view:visible', (_e, on) => view.setVisible(Boolean(on)));
  ipcMain.handle('view:back', () => { if (view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack(); });
  ipcMain.handle('agent:start', (_e, { task }) => {
    if (typeof task !== 'string' || task.trim().length < 3) throw new Error('Describe the task in a few words.');
    if (running) throw new Error('A task is already running.');
    void startRun({ task: task.trim().slice(0, 600) });
    return { ok: true };
  });
  ipcMain.handle('agent:stop', () => { stopRun('button'); return { ok: true }; });
  ipcMain.handle('agent:answer', (_e, { id, reply }) => { const r = running?.pending.get(id); if (r) { running.pending.delete(id); r(reply); } return { ok: Boolean(r) }; });
  ipcMain.handle('runs:list', () => listRuns());
  ipcMain.handle('runs:get', (_e, id) => { const f = join(RUNS, `${String(id).replace(/[^\w-]/g, '')}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; });
  ipcMain.handle('runs:delete', (_e, id) => { rmSync(join(RUNS, `${String(id).replace(/[^\w-]/g, '')}.json`), { force: true }); return { ok: true }; });
}

/* ---------- benchmark mode (npm run bench) ---------- */

async function bench() {
  const { TASKS } = await import('../bench/tasks.mjs');
  const results = [];
  for (const t of TASKS) {
    await view.webContents.loadURL(`bench://sites/${t.page}`);
    await view.webContents.executeJavaScript('sessionStorage.clear()');
    await new Promise((r) => setTimeout(r, 500));
    const t0 = Date.now();
    const run = await startRun({ task: t.task, autoConfirm: true });
    const state = await view.webContents.executeJavaScript(`JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))`).then(JSON.parse).catch(() => ({}));
    const ok = t.check({ state, answer: run.answer || '', run });
    results.push({ id: t.id, task: t.task, ok, status: run.status, steps: run.steps.length, seconds: Math.round((Date.now() - t0) / 1000), answer: run.answer ?? null });
    console.log(`${ok ? '✓' : '✗'} ${t.id} (${run.status}, ${run.steps.length} steps)`);
    await new Promise((r) => setTimeout(r, 4000)); // free-tier requests per minute
  }
  const { writeResults } = await import('../bench/report.mjs');
  writeResults(results, readSettings().model);
  app.quit();
}

app.whenReady().then(() => {
  ipc();
  createWindow();
  if (process.argv.includes('--bench')) win.webContents.once('did-finish-load', () => setTimeout(bench, 1500));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || process.env.TP_USER_DATA) app.quit(); });
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault()); // no <webview> tags anywhere
});
