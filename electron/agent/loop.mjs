// The agent loop: observe → decide → check safety → (ask the user) → act → repeat.
// The browser "driver" and the brain are passed in, so the loop is tested without Electron or a real AI.

import { review, checkUrl } from './safety.mjs';

export const MAX_STEPS = 25;

/**
 * @param {object} o
 * @param {string} o.task
 * @param {{observe: Function, act: Function}} o.driver      observe() → obs (with screenshot); act(action, element) → note
 * @param {{decide: Function}} o.brain
 * @param {(q: {kind:'confirm'|'ask', text:string}) => Promise<boolean|string|null>} o.askUser
 * @param {(step: object) => void} o.onStep
 * @param {{stopped: boolean}} o.signal
 * @param {object} [o.safety]  options for safety.review (allowSensitive, extraBlocked)
 */
export async function runAgent({ task, driver, brain, askUser, onStep, signal, safety = {}, maxSteps = MAX_STEPS }) {
  const history = [];
  let lastKey = '';
  let repeats = 0;
  for (let n = 1; n <= maxSteps; n++) {
    if (signal.stopped) return { status: 'stopped', steps: n - 1 };
    let obs;
    try {
      obs = await driver.observe();
    } catch (e) {
      const msg = String(e?.message || e);
      onStep({ n, kind: 'error', thought: `Could not read the page: ${msg}`, url: '' });
      return { status: 'error', reason: msg, steps: n };
    }
    const where = checkUrl(obs.url, safety);
    if (!where.ok) {
      onStep({ n, kind: 'blocked', thought: where.reason, url: obs.url, screenshot: obs.screenshot });
      return { status: 'blocked', reason: where.reason, steps: n };
    }
    let d;
    try {
      d = await brain.decide({ task, obs, history });
    } catch (e) {
      const msg = String(e?.message || e);
      onStep({ n, kind: 'error', thought: `The AI did not answer: ${msg}`, url: obs.url, screenshot: obs.screenshot });
      return { status: 'error', reason: msg, steps: n };
    }
    if (signal.stopped) return { status: 'stopped', steps: n };
    const el = d.element != null ? obs.elements.find((e) => e.i === d.element) : undefined;
    const describe = describeAction(d, el);
    const step = { n, kind: 'action', thought: d.thought, action: d, describe, url: obs.url, screenshot: obs.screenshot };

    if (d.action === 'done') {
      onStep({ ...step, kind: 'done' });
      return { status: 'done', answer: d.answer || '', steps: n };
    }
    if (d.action === 'ask') {
      onStep({ ...step, kind: 'ask' });
      const reply = await askUser({ kind: 'ask', text: d.question });
      if (reply == null || signal.stopped) return { status: 'stopped', steps: n };
      history.push(`Asked the user: "${d.question}" → they said: "${String(reply).slice(0, 300)}"`);
      continue;
    }

    // The same action three times in a row means it's stuck.
    const key = `${d.action}|${d.element}|${d.text}|${d.url}|${d.direction}|${d.key}`;
    repeats = key === lastKey ? repeats + 1 : 0;
    lastKey = key;
    if (repeats >= 2) {
      onStep({ ...step, kind: 'stuck', thought: 'Stopped: the same action kept repeating without progress.' });
      return { status: 'stuck', steps: n };
    }

    const verdict = review(d, el, obs, safety);
    if (verdict.verdict === 'refuse') {
      onStep({ ...step, kind: 'refused', result: verdict.reason });
      history.push(`${describe} → REFUSED by safety rules: ${verdict.reason}`);
      continue;
    }
    if (verdict.verdict === 'confirm') {
      onStep({ ...step, kind: 'confirm', result: verdict.reason });
      const ok = await askUser({ kind: 'confirm', text: verdict.reason });
      if (signal.stopped) return { status: 'stopped', steps: n };
      if (!ok) {
        history.push(`${describe} → the user said NO. Do not try this again; finish or ask what to do instead.`);
        continue;
      }
    }
    let note;
    try {
      note = await driver.act(d, el);
    } catch (e) {
      note = `failed: ${String(e?.message || e)}`;
    }
    onStep({ ...step, result: note || 'ok' });
    history.push(`${describe}${note ? ` → ${note}` : ''}`);
  }
  return { status: 'limit', steps: maxSteps };
}

export function describeAction(d, el) {
  const what = el ? `[${el.i}] “${el.label || el.tag}”` : d.element != null ? `[${d.element}]` : '';
  switch (d.action) {
    case 'click': return `Click ${what}`;
    case 'type': return `Type “${d.text}” into ${what}`;
    case 'scroll': return `Scroll ${d.direction || 'down'}`;
    case 'key': return `Press ${d.key}`;
    case 'goto': return `Open ${d.url}`;
    case 'wait': return 'Wait for the page';
    case 'done': return 'Done';
    case 'ask': return `Ask: ${d.question}`;
    default: return d.action;
  }
}
