import { useCallback, useEffect, useRef, useState } from 'react';
import { tp, type Ask, type End, type Run, type RunSummary, type Settings as S, type Step } from './api';

type Panel = 'task' | 'history' | 'settings';
const EXAMPLES = ['Find the cheapest electric kettle in the Chai Gear shop and add it to the cart.', 'Open the recipe wiki and tell me the first ingredient of the monsoon pakora.', 'Add three to-dos: milk, bread and eggs.'];

const KIND: Record<Step['kind'], { label: string; cls: string }> = {
  action: { label: 'step', cls: 'bg-slate-800 text-slate-300' },
  done: { label: 'done', cls: 'bg-emerald-500/20 text-emerald-300' },
  ask: { label: 'question', cls: 'bg-sky-500/20 text-sky-300' },
  confirm: { label: 'needs OK', cls: 'bg-amber-500/20 text-amber-300' },
  refused: { label: 'refused', cls: 'bg-rose-500/20 text-rose-300' },
  blocked: { label: 'blocked', cls: 'bg-rose-500/20 text-rose-300' },
  error: { label: 'error', cls: 'bg-rose-500/20 text-rose-300' },
  stuck: { label: 'stuck', cls: 'bg-amber-500/20 text-amber-300' },
};

export default function App() {
  const [panel, setPanel] = useState<Panel>('task');
  const [settings, setSettings] = useState<S | null>(null);
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [end, setEnd] = useState<End | null>(null);
  const [url, setUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [replay, setReplay] = useState<Run | null>(null);
  const viewBox = useRef<HTMLDivElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void tp().getSettings().then((s) => { setSettings(s); if (!s.hasKey) setPanel('settings'); });
    const offs = [
      tp().onStep((s) => setSteps((x) => [...x, s])),
      tp().onAsk((a) => setAsk(a)),
      tp().onEnd((e) => { setRunning(false); setAsk(null); setEnd(e); }),
      tp().onUrl((u) => setUrl(u)),
      tp().onBlocked((b) => setNotice(b.reason)),
      tp().onStopping(() => setNotice('Stopping…')),
    ];
    return () => offs.forEach((o) => o());
  }, []);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }); }, [steps.length, ask]);

  // Keep the agent's browser view exactly over the placeholder box.
  useEffect(() => {
    const el = viewBox.current;
    if (!el) return;
    const send = () => { const r = el.getBoundingClientRect(); void tp().setViewBounds({ x: r.left, y: r.top, width: r.width, height: r.height }); };
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    send();
    return () => { ro.disconnect(); window.removeEventListener('resize', send); };
  }, []);
  useEffect(() => { void tp().showView(!replay); }, [replay]);

  const start = async (t: string) => {
    setNotice(''); setEnd(null); setSteps([]); setReplay(null);
    try { await tp().start(t); setRunning(true); setTask(t); } catch (e) { setNotice(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not start.'); }
  };
  const reply = async (r: boolean | string | null) => { if (ask) { await tp().answer(ask.id, r); setAsk(null); } };

  return (
    <div className="flex h-full">
      <aside className="flex w-[420px] shrink-0 flex-col border-r border-slate-800 bg-slate-900/60">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <p className="flex items-center gap-2 text-lg font-extrabold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">✈</span>Task<span className="text-brand-400">Pilot</span></p>
          <nav className="flex gap-1 text-xs font-semibold" aria-label="Panels">
            {(['task', 'history', 'settings'] as Panel[]).map((p) => <button key={p} onClick={() => { setPanel(p); if (p !== 'history') setReplay(null); }} aria-current={panel === p ? 'page' : undefined} className={`rounded-lg px-2.5 py-1.5 capitalize ${panel === p ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}>{p}</button>)}
          </nav>
        </header>

        {panel === 'task' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <form className="space-y-2 border-b border-slate-800 p-4" onSubmit={(e) => { e.preventDefault(); if (!running) void start(task); }}>
              <label htmlFor="task" className="text-xs font-bold uppercase tracking-wider text-slate-400">Task</label>
              <textarea id="task" className="field min-h-[84px] resize-none" value={task} maxLength={600} disabled={running} onChange={(e) => setTask(e.target.value)} placeholder="Tell TaskPilot what to do on the page on the right…" />
              <div className="flex gap-2">
                {running
                  ? <button type="button" className="btn flex-1 bg-rose-600 text-white hover:bg-rose-500" onClick={() => tp().stop()}>■ Stop (Esc)</button>
                  : <button className="btn flex-1 bg-brand-600 text-white hover:bg-brand-500" disabled={task.trim().length < 3 || !settings?.hasKey}>▶ Run task</button>}
              </div>
              {!running && !steps.length && <div className="space-y-1 pt-1">{EXAMPLES.map((x) => <button type="button" key={x} className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => setTask(x)}>{x}</button>)}</div>}
              {notice && <p role="status" className="text-xs text-amber-300">{notice}</p>}
            </form>
            <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4" data-testid="log" aria-live="polite">
              {steps.map((s, i) => <StepRow key={i} s={s} />)}
              {ask && (
                <li className="rounded-xl border-2 border-amber-400 bg-amber-500/10 p-3" data-testid="ask">
                  <p className="text-sm font-semibold">{ask.kind === 'confirm' ? '✋ TaskPilot needs your OK' : '❓ TaskPilot has a question'}</p>
                  <p className="mt-1 text-sm">{ask.text}</p>
                  {ask.kind === 'confirm' ? (
                    <div className="mt-3 flex gap-2"><button className="btn bg-emerald-600 text-white" onClick={() => reply(true)}>Yes, do it</button><button className="btn bg-slate-700 text-white" onClick={() => reply(false)}>No</button></div>
                  ) : <AskForm onSend={(t) => reply(t)} />}
                </li>
              )}
              {end && (
                <li className={`rounded-xl p-3 text-sm ${end.status === 'done' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-slate-800 text-slate-200'}`} data-testid="end">
                  <p className="font-bold">{({ done: '✅ Finished', stopped: '■ Stopped', blocked: '⛔ Blocked', limit: '⏱ Step limit reached', stuck: '🔁 Stopped: no progress', error: '⚠️ Error' } as Record<string, string>)[end.status] || end.status} · {end.steps} steps</p>
                  {end.answer && <p className="mt-1">{end.answer}</p>}
                  {end.reason && <p className="mt-1 text-xs opacity-80">{end.reason}</p>}
                </li>
              )}
              <div ref={logEnd} />
            </ol>
          </div>
        )}
        {panel === 'history' && <History onOpen={setReplay} />}
        {panel === 'settings' && settings && <SettingsPanel s={settings} onSave={setSettings} />}
        <footer className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">Asks before submit / pay / send / sign-in · never types passwords · job, bank and email sites blocked</footer>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <form className="flex items-center gap-2 border-b border-slate-800 px-3 py-2" onSubmit={async (e) => { e.preventDefault(); const r = await tp().go(url); if (!r.ok) setNotice(r.reason || 'Blocked.'); }}>
          <button type="button" className="btn bg-slate-800 px-3 py-1.5" onClick={() => tp().back()} aria-label="Back" disabled={running}>←</button>
          <input className="field py-1.5 font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Address" disabled={running} />
          <button className="btn bg-slate-800 px-3 py-1.5" disabled={running}>Go</button>
          {running && <span className="flex items-center gap-2 whitespace-nowrap text-xs text-brand-400"><span className="h-2 w-2 animate-pulse rounded-full bg-brand-400" />Agent driving</span>}
        </form>
        <div className="relative min-h-0 flex-1">
          <div ref={viewBox} className="absolute inset-0" data-testid="viewbox" />
          {replay && <Replay run={replay} onClose={() => setReplay(null)} />}
        </div>
      </main>
    </div>
  );
}

function StepRow({ s }: { s: Step }) {
  const k = KIND[s.kind];
  return (
    <li className="rounded-xl bg-slate-900 p-3 ring-1 ring-slate-800">
      <div className="flex items-center gap-2 text-xs"><span className="num font-bold text-slate-500">#{s.n}</span><span className={`rounded-full px-2 py-0.5 font-semibold ${k.cls}`}>{k.label}</span><span className="truncate font-semibold text-slate-200">{s.describe || ''}</span></div>
      {s.thought && <p className="mt-1.5 text-xs text-slate-400">{s.thought}</p>}
      {s.result && s.result !== 'ok' && <p className="mt-1 text-xs text-amber-300">{s.result}</p>}
    </li>
  );
}

function AskForm({ onSend }: { onSend: (t: string) => void }) {
  const [t, setT] = useState('');
  return (
    <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (t.trim()) onSend(t.trim()); }}>
      <input className="field" value={t} onChange={(e) => setT(e.target.value)} aria-label="Your answer" autoFocus />
      <button className="btn bg-brand-600 text-white">Send</button>
    </form>
  );
}

function SettingsPanel({ s, onSave }: { s: S; onSave: (s: S) => void }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(s.model);
  const [blocked, setBlocked] = useState(s.blocked.join('\n'));
  const [allow, setAllow] = useState(s.allowSensitive);
  const [msg, setMsg] = useState('');
  const save = async () => {
    try { onSave(await tp().setSettings({ ...(key ? { key } : {}), model, blocked: blocked.split(/\s+/), allowSensitive: allow })); setKey(''); setMsg('Saved ✓'); } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not save.'); }
  };
  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
      <section className="space-y-2">
        <h2 className="font-bold">Your Gemini API key {s.hasKey && <span className="text-emerald-400">· saved</span>}</h2>
        <p className="text-xs text-slate-400">Free from aistudio.google.com → Get API key. It is stored encrypted on this computer (system keychain) and only sent to Google.</p>
        <input className="field font-mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.hasKey ? '•••••••• (leave empty to keep)' : 'AIza…'} aria-label="Gemini API key" autoComplete="off" />
      </section>
      <label className="block space-y-1"><span className="font-bold">Model</span><input className="field" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" /></label>
      <label className="block space-y-1"><span className="font-bold">Extra blocked sites</span><span className="block text-xs text-slate-400">One domain per line, e.g. example.com</span><textarea className="field min-h-[80px] font-mono text-xs" value={blocked} onChange={(e) => setBlocked(e.target.value)} aria-label="Blocked sites" /></label>
      <label className="flex items-start gap-2 rounded-xl bg-slate-900 p-3 ring-1 ring-slate-800">
        <input type="checkbox" className="mt-1" checked={allow} onChange={(e) => setAllow(e.target.checked)} />
        <span><b>Allow job, banking and email sites</b><span className="block text-xs text-slate-400">Off by default. LinkedIn stays blocked either way, and risky actions always ask first.</span></span>
      </label>
      <button className="btn w-full bg-brand-600 text-white" onClick={save}>Save settings</button>
      {msg && <p role="status" className="text-xs text-emerald-300">{msg}</p>}
    </div>
  );
}

function History({ onOpen }: { onOpen: (r: Run) => void }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const load = useCallback(() => tp().listRuns().then(setRuns), []);
  useEffect(() => { void load(); }, [load]);
  if (!runs) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (!runs.length) return <p className="p-4 text-sm text-slate-500">No runs yet.</p>;
  return (
    <ul className="flex-1 space-y-2 overflow-y-auto p-4" data-testid="runs">
      {runs.map((r) => (
        <li key={r.id} className="rounded-xl bg-slate-900 p-3 text-sm ring-1 ring-slate-800">
          <p className="font-semibold">{r.task}</p>
          <p className="mt-1 text-xs text-slate-400">{new Date(r.startedAt).toLocaleString()} · {r.status} · {r.steps} steps</p>
          <div className="mt-2 flex gap-3 text-xs font-semibold">
            <button className="text-brand-400 hover:underline" onClick={async () => { const run = await tp().getRun(r.id); if (run) onOpen(run); }}>▶ Replay</button>
            <button className="text-slate-500 hover:text-rose-400" onClick={async () => { await tp().deleteRun(r.id); void load(); }}>Delete</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Replay({ run, onClose }: { run: Run; onClose: () => void }) {
  const shots = run.steps.filter((s) => s.screenshot);
  const [i, setI] = useState(0);
  const [exporting, setExporting] = useState(false);
  const s = shots[i];

  // Export: draw each step (screenshot + caption) on a canvas and record it as a WebM video.
  const exportVideo = async () => {
    setExporting(true);
    const imgs = await Promise.all(shots.map((st) => new Promise<HTMLImageElement>((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = `data:image/jpeg;base64,${st.screenshot}`; })));
    const W = 1280; const H = 800 + 90;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((ok) => { rec.onstop = () => ok(); });
    rec.start();
    for (let k = 0; k < imgs.length; k++) {
      ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(imgs[k], 0, 0, W, 800);
      ctx.fillStyle = '#e2e8f0'; ctx.font = '600 24px system-ui'; ctx.fillText(`#${shots[k].n} ${shots[k].describe || shots[k].kind}`.slice(0, 90), 24, 840);
      ctx.fillStyle = '#94a3b8'; ctx.font = '18px system-ui'; ctx.fillText((shots[k].thought || '').slice(0, 120), 24, 872);
      await new Promise((r) => setTimeout(r, 1400));
    }
    rec.stop();
    await done;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    a.download = `taskpilot-${run.id.slice(0, 8)}.webm`;
    a.click();
    setExporting(false);
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-slate-950" data-testid="replay">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-2 text-sm">
        <p className="truncate font-semibold">Replay: {run.task}</p>
        <div className="flex gap-2">
          <button className="btn bg-slate-800 px-3 py-1.5" onClick={exportVideo} disabled={exporting || !shots.length}>{exporting ? 'Recording…' : '⬇ Export video'}</button>
          <button className="btn bg-slate-800 px-3 py-1.5" onClick={onClose}>Close</button>
        </div>
      </div>
      {s ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 p-4">
          <img src={`data:image/jpeg;base64,${s.screenshot}`} alt={`Step ${s.n}`} className="min-h-0 flex-1 rounded-xl object-contain ring-1 ring-slate-800" />
          <p className="text-sm"><b>#{s.n}</b> {s.describe || s.kind} <span className="text-slate-400">— {s.thought}</span></p>
          <div className="flex items-center gap-3">
            <button className="btn bg-slate-800" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>‹ Prev</button>
            <input type="range" min={0} max={shots.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Step" />
            <button className="btn bg-slate-800" onClick={() => setI(Math.min(shots.length - 1, i + 1))} disabled={i === shots.length - 1}>Next ›</button>
          </div>
        </div>
      ) : <p className="p-6 text-slate-500">This run has no screenshots.</p>}
    </div>
  );
}
