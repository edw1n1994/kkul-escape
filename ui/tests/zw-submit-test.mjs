import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { zwArmHumanInput, zwSubmit } from '../zw-submit.mjs';

function fixture() {
  const want = { zizum_num: '5', theme_num: '1', rev_days: '2099-01-01', theme_time_num: '9' };
  const fields = Object.fromEntries(Object.entries({ ...want, name: '테스트유저', mobile: '010-0000-0000', person: '2', input_captcha: '12345' }).map(([k, value]) => [k, { value }]));
  fields.input_captcha.maxLength = 5;
  fields.person.options = [{ value: '2', disabled: false }];
  let clicks = 0, listener;
  const button = { disabled: false, classList: { contains: () => true }, getClientRects: () => [{}], textContent: '예약하기', click: () => { clicks++; } };
  const form = { action: 'https://zeroworldkorea.com/core/res/rev.act.php', method: 'post', elements: { namedItem: k => fields[k] }, querySelectorAll: () => [button] };
  const window = { __ZW_HUMAN_INPUT: { at: Date.now() - 1000, length: 5 } };
  const context = vm.createContext({ URL, Date, window, location: { href: 'https://zeroworldkorea.com/layout/res/home.php?go=rev.make&zizum_num=5' }, document: { forms: { namedItem: () => form }, addEventListener: (_name, callback) => { listener = callback; } } });
  const submit = (options = {}) => vm.runInContext(`(${zwSubmit.toString()})(${JSON.stringify({ want, ...options })})`, context);
  return { want, fields, button, form, window, context, submit, clicks: () => clicks, input: isTrusted => listener({ target: fields.input_captcha, isTrusted }) };
}

test('validated human input clicks once; repeated checks never click twice', () => {
  const f = fixture(); assert.equal(f.submit().ok, true); assert.equal(f.submit().ok, false); assert.equal(f.clicks(), 1);
});
test('preview validates but never clicks or marks submitted', () => {
  const f = fixture(); assert.equal(f.submit({ preview: true }).ok, true); assert.equal(f.clicks(), 0); assert.equal(f.window.__ZW_SUBMITTED, undefined);
});
for (const [name, mutate] of [
  ['partial input', f => { f.fields.input_captcha.value = '12'; }],
  ['no human evidence', f => { f.window.__ZW_HUMAN_INPUT = null; }],
  ['typing not finished', f => { f.window.__ZW_HUMAN_INPUT.at = Date.now(); }],
  ['wrong reservation date', f => { f.fields.rev_days.value = '2099-01-02'; }],
  ['wrong destination', f => { f.form.action = 'https://example.com/submit'; }],
  ['missing name', f => { f.fields.name.value = ''; }],
  ['invalid phone', f => { f.fields.mobile.value = '123'; }],
  ['invalid person', f => { f.fields.person.value = '3'; }],
  ['disabled button', f => { f.button.disabled = true; }],
  ['ambiguous buttons', f => { f.form.querySelectorAll = () => [f.button, f.button]; }],
]) test(name + ' prevents submission', () => {
  const f = fixture(); mutate(f); assert.equal(f.submit().ok, false); assert.equal(f.clicks(), 0);
});
test('input observer requires trusted events; scripted changes invalidate previous input', () => {
  const f = fixture(); vm.runInContext(`(${zwArmHumanInput.toString()})()`, f.context);
  f.input(true); assert.equal(f.window.__ZW_HUMAN_INPUT.length, 5);
  f.input(false); assert.equal(f.window.__ZW_HUMAN_INPUT, null);
});
