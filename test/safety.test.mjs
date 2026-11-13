import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, review } from '../electron/agent/safety.mjs';

test('LinkedIn is always blocked, even when sensitive sites are allowed', () => {
  assert.equal(checkUrl('https://www.linkedin.com/jobs').ok, false);
  assert.equal(checkUrl('https://in.linkedin.com/feed', { allowSensitive: true }).ok, false);
});

test('job, bank, payment and email sites are blocked by default', () => {
  for (const u of ['https://www.naukri.com', 'https://netbanking.hdfcbank.com', 'https://mail.google.com/mail', 'https://www.paypal.com', 'https://retail.onlinesbi.sbi', 'https://mybank.com/login']) assert.equal(checkUrl(u).ok, false, u);
  assert.equal(checkUrl('https://www.naukri.com', { allowSensitive: true }).ok, true);
  assert.equal(checkUrl('https://en.wikipedia.org/wiki/Chai').ok, true);
  assert.equal(checkUrl('file:///etc/passwd').ok, false);
  assert.equal(checkUrl('bench://sites/todo.html').ok, true);
});

test('risky clicks need confirmation; links to blocked sites are refused', () => {
  const obs = {};
  assert.equal(review({ action: 'click', element: 1 }, { i: 1, label: 'Place order', tag: 'button' }, obs).verdict, 'confirm');
  assert.equal(review({ action: 'click', element: 1 }, { i: 1, label: '', type: 'submit', tag: 'input' }, obs).verdict, 'confirm');
  assert.equal(review({ action: 'click', element: 1 }, { i: 1, label: 'Next page', tag: 'a' }, obs).verdict, 'allow');
  assert.equal(review({ action: 'click', element: 1 }, { i: 1, label: 'Jobs', tag: 'a', href: 'https://linkedin.com/jobs' }, obs).verdict, 'refuse');
  assert.equal(review({ action: 'click', element: 9 }, undefined, obs).verdict, 'refuse');
});

test('never types secrets', () => {
  assert.equal(review({ action: 'type', element: 1, text: 'hunter2' }, { i: 1, type: 'password', label: 'Password' }, {}).verdict, 'refuse');
  assert.equal(review({ action: 'type', element: 1, text: '123456' }, { i: 1, type: 'text', label: 'Enter OTP' }, {}).verdict, 'refuse');
  assert.equal(review({ action: 'type', element: 1, text: '4111 1111 1111 1111' }, { i: 1, type: 'text', label: 'Notes' }, {}).verdict, 'refuse');
  assert.equal(review({ action: 'type', element: 1, text: 'electric kettle' }, { i: 1, type: 'search', label: 'Search' }, {}).verdict, 'allow');
});

test('Enter inside a form needs confirmation; goto is checked', () => {
  assert.equal(review({ action: 'key', key: 'Enter' }, undefined, { focusedInForm: true }).verdict, 'confirm');
  assert.equal(review({ action: 'key', key: 'Tab' }, undefined, { focusedInForm: true }).verdict, 'allow');
  assert.equal(review({ action: 'goto', url: 'https://gmail.com' }, undefined, {}).verdict, 'refuse');
});
