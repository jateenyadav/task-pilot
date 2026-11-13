// JavaScript that runs inside the agent's page (via the Chrome DevTools Protocol): list the visible interactive
// elements, draw numbered "set-of-marks" boxes on them for the screenshot, then remove the boxes.

export const OBSERVE = String.raw`(() => {
  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  const W = innerWidth, H = innerHeight;
  const seen = new Set();
  const out = [];
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const labelOf = (el) => {
    const byFor = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    return clean(el.getAttribute('aria-label') || (byFor && byFor.innerText) || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? (el.placeholder || el.closest('label')?.innerText) : el.innerText) || el.title || el.getAttribute('alt') || el.name || el.value || (el.querySelector('img') && el.querySelector('img').alt) || '').slice(0, 80);
  };
  for (const el of document.querySelectorAll(SEL)) {
    if (out.length >= 80) break;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
    // Skip a wrapper whose interactive child is already listed, and children of a listed link/button.
    if ([...seen].some((s) => s !== el && s.contains(el) && (s.tagName === 'A' || s.tagName === 'BUTTON'))) continue;
    const cx = Math.min(W - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) continue; // covered by something else
    seen.add(el);
    const tag = el.tagName.toLowerCase();
    out.push({
      i: out.length, tag,
      type: (el.getAttribute('type') || '').toLowerCase() || undefined,
      role: el.getAttribute('role') || undefined,
      label: labelOf(el),
      name: el.name || undefined,
      autocomplete: el.getAttribute('autocomplete') || undefined,
      href: tag === 'a' && el.href ? el.href.slice(0, 200) : undefined,
      value: (tag === 'input' || tag === 'textarea' || tag === 'select') && el.type !== 'password' ? String(el.value || '').slice(0, 60) || undefined : undefined,
      checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : (el.getAttribute('aria-checked') ?? undefined),
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
      formAction: el.form ? 'in form' : undefined,
      x: Math.round(cx), y: Math.round(cy), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top),
    });
  }
  const box = document.createElement('div');
  box.id = '__taskpilot_marks';
  box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const colours = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];
  for (const e of out) {
    const c = colours[e.i % colours.length];
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;left:' + e.left + 'px;top:' + e.top + 'px;width:' + e.w + 'px;height:' + e.h + 'px;outline:2px solid ' + c + ';outline-offset:-1px';
    const n = document.createElement('div');
    n.textContent = e.i;
    n.style.cssText = 'position:absolute;left:-2px;top:-2px;transform:translateY(-100%);background:' + c + ';color:#fff;font:bold 11px/1 system-ui;padding:2px 3px;border-radius:3px';
    if (e.top < 14) n.style.transform = 'none';
    m.appendChild(n);
    box.appendChild(m);
  }
  document.documentElement.appendChild(box);
  const a = document.activeElement;
  return {
    url: location.href, title: document.title,
    scroll: { y: Math.round(scrollY), max: Math.max(0, Math.round(document.documentElement.scrollHeight - H)) },
    elements: out,
    focusedInForm: Boolean(a && a.form),
    text: (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 2500),
  };
})()`;

export const CLEAR_MARKS = `document.getElementById('__taskpilot_marks')?.remove()`;

/** Focus an element at a point and select its contents, so typing replaces the old text. */
export const selectAt = (x, y) => `(() => {
  const el = document.elementFromPoint(${Number(x)}, ${Number(y)});
  const f = el && (el.closest('input,textarea,[contenteditable=""],[contenteditable=true]') || el);
  if (!f) return false;
  f.focus();
  if (typeof f.select === 'function') f.select();
  else if (f.isContentEditable) { const r = document.createRange(); r.selectNodeContents(f); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  return true;
})()`;

/** Pick an option in a <select> by its visible text (typing into a select picks the option). */
export const chooseOption = (x, y, text) => `(() => {
  const el = document.elementFromPoint(${Number(x)}, ${Number(y)});
  const s = el && el.closest('select');
  if (!s) return null;
  const want = ${JSON.stringify(String(text).toLowerCase())};
  const o = [...s.options].find((o) => o.text.trim().toLowerCase() === want) || [...s.options].find((o) => o.text.toLowerCase().includes(want));
  if (!o) return 'no-option';
  s.value = o.value;
  s.dispatchEvent(new Event('input', { bubbles: true }));
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return o.text;
})()`;
