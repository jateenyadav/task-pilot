// What the agent may do on its own, what needs the user's OK, and what it must never do.
// Checked in code before every action: the model's own judgement is never the only fence.

// Never: job sites (no automated job applications or messages), banking/payments, email, account logins.
export const ALWAYS_BLOCKED = ['linkedin.com', 'lnkd.in'];
export const BLOCKED_BY_DEFAULT = [
  // job portals
  'naukri.com', 'indeed.com', 'glassdoor.com', 'glassdoor.co.in', 'monster.com', 'foundit.in', 'instahyre.com', 'wellfound.com', 'internshala.com', 'shine.com', 'hirist.tech', 'cutshort.io', 'apna.co',
  // banking and payments
  'onlinesbi.sbi', 'sbi.co.in', 'hdfcbank.com', 'icicibank.com', 'axisbank.com', 'kotak.com', 'yesbank.in', 'pnbindia.in', 'bankofbaroda.in', 'paypal.com', 'paytm.com', 'phonepe.com', 'razorpay.com', 'stripe.com', 'wise.com',
  // email and accounts
  'mail.google.com', 'gmail.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com', 'proton.me', 'mail.zoho.com', 'accounts.google.com', 'login.microsoftonline.com', 'appleid.apple.com',
];
const BANKISH = /(^|\.)(net)?bank(ing)?[\w-]*\.|bank\.(com|in|co\.in)$/i;

const host = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const matches = (h, list) => list.some((d) => h === d || h.endsWith(`.${d}`));

/** Can the agent be on this URL at all? */
export function checkUrl(url, { allowSensitive = false, extraBlocked = [] } = {}) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: 'That is not a valid web address.' }; }
  if (u.protocol === 'bench:' || url === 'about:blank') return { ok: true };
  if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: `TaskPilot only opens web pages (not ${u.protocol} links).` };
  const h = host(url);
  if (matches(h, ALWAYS_BLOCKED)) return { ok: false, reason: `${h} is never automated by TaskPilot.` };
  if (matches(h, extraBlocked)) return { ok: false, reason: `${h} is on your blocked list.` };
  if (!allowSensitive && (matches(h, BLOCKED_BY_DEFAULT) || BANKISH.test(h))) return { ok: false, reason: `${h} is a job, banking, payment or email site. TaskPilot keeps away from these by default.` };
  return { ok: true };
}

const RISKY = /\b(submit|pay|pay now|buy|buy now|purchase|place (your )?order|checkout|check out|proceed to (pay|checkout)|send|post|publish|tweet|reply|sign ?in|log ?in|sign ?up|register|create account|delete|remove|unsubscribe|confirm|transfer|donate|subscribe|apply|book now|reserve)\b/i;
const SECRET_FIELD = /pass(word|code)?|pwd|otp|one.time|cvv|cvc|card.?(number|no)|cc-?(number|csc)|security.?code|pin\b|aadhaar|pan.?(number|no)|ssn/i;

/**
 * Review one action against the last observation.
 * Returns { verdict: 'allow' | 'confirm' | 'refuse', reason }.
 */
export function review(action, element, obs, opts = {}) {
  const label = element ? [element.label, element.type, element.name, element.role, element.formAction].filter(Boolean).join(' ') : '';
  switch (action.action) {
    case 'goto': {
      const c = checkUrl(action.url || '', opts);
      return c.ok ? { verdict: 'allow' } : { verdict: 'refuse', reason: c.reason };
    }
    case 'click': {
      if (!element) return { verdict: 'refuse', reason: `There is no element number ${action.element} on the page.` };
      if (element.href) {
        const c = checkUrl(element.href, opts);
        if (!c.ok) return { verdict: 'refuse', reason: c.reason };
      }
      if (element.type === 'submit' || RISKY.test(label)) return { verdict: 'confirm', reason: `Click “${element.label || element.type}”? This may submit, send, pay or sign in.` };
      return { verdict: 'allow' };
    }
    case 'type': {
      if (!element) return { verdict: 'refuse', reason: `There is no element number ${action.element} on the page.` };
      if (element.type === 'password' || SECRET_FIELD.test(`${element.label} ${element.name} ${element.autocomplete}`)) {
        return { verdict: 'refuse', reason: 'TaskPilot never types passwords, OTPs, card or ID numbers. Please type that yourself.' };
      }
      if (SECRET_FIELD.test(action.text || '') || /\b\d{12,19}\b/.test((action.text || '').replace(/[\s-]/g, ''))) {
        return { verdict: 'refuse', reason: 'That text looks like a secret or a card/ID number. TaskPilot will not type it.' };
      }
      return { verdict: 'allow' };
    }
    case 'key': {
      if (action.key === 'Enter' && obs?.focusedInForm) return { verdict: 'confirm', reason: 'Press Enter? This may submit the form.' };
      return { verdict: 'allow' };
    }
    default:
      return { verdict: 'allow' };
  }
}
