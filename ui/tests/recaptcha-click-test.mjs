import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRecaptchaClicker, recaptchaHostPage, recaptchaCheckboxPoint, recaptchaMousePoint, readRecaptchaFrame } from '../recaptcha-click.mjs';
const want = { zizum_num: '1', theme_num: '2', theme_info_num: '3', rev_days: '2030-09-17', theme_time_num: '4' };
function hostFixture(o = {}) {
  const frame = { src: o.src || 'https://www.google.com/recaptcha/api2/anchor?k=fixture', offsetWidth: 304, offsetHeight: 78, clientLeft: 0, clientTop: 0, getBoundingClientRect: () => ({ x: 10, y: 20, width: 304, height: 78 }), scrollIntoView() {} };
  const context = vm.createContext({ URL, location: { href: o.url || 'https://www.keyescape.com/reservation2.php' }, window: {}, innerWidth: 900, innerHeight: 800, getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }), document: {
    querySelector: s => s === '#form' ? { elements: { namedItem: k => ({ value: o.wrong ? 'wrong' : want[k] }) } } : { value: o.token || '' },
    querySelectorAll: () => o.challenge ? [frame, { ...frame, src: 'https://www.google.com/recaptcha/api2/bframe' }] : o.ambiguous ? [frame, frame] : [frame],
  } });
  return action => vm.runInContext(`(${recaptchaHostPage.toString()})(${JSON.stringify({ want, action })})`, context);
}
test('only the exact Keyescape form and official anchor are eligible', () => {
  assert.equal(hostFixture()('read').state, 'ready');
  for (const o of [{ url: 'https://zeroworldkorea.com/reservation2.php' }, { url: 'https://www.keyescape.com/reservation1.php' }, { wrong: true }, { token: 'fixture' }, { challenge: true }]) assert.equal(hostFixture(o)('read').state, 'stop');
  for (const o of [{ src: 'https://evil.example/recaptcha/api2/anchor' }, { ambiguous: true }]) assert.equal(hostFixture(o)('read').state, 'waiting');
});
test('page marker prevents duplicate requests across clicker instances', () => {
  const read = hostFixture(); assert.equal(read('mark').state, 'ready'); assert.equal(read('read').state, 'stop');
});
test('checkbox reader allows unchecked class but leaves checked and busy widgets alone', () => {
  for (const [className, checked, expected] of [['recaptcha-checkbox-unchecked', 'false', 'ready'], ['recaptcha-checkbox-checked', 'true', 'stop'], ['recaptcha-checkbox-loading', 'false', 'stop']]) {
    const checkbox = { className, getAttribute: k => k === 'aria-checked' ? checked : null, getBoundingClientRect: () => ({ x: 12, y: 14, width: 28, height: 28 }), contains: () => true };
    const context = vm.createContext({ document: { querySelector: () => checkbox, elementFromPoint: () => checkbox }, getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }) });
    assert.equal(vm.runInContext(`(${recaptchaCheckboxPoint.toString()})()`, context).state, expected);
  }
});
test('mouse coordinates account for frame border and scaling and reject offscreen clicks', () => {
  const h = { state: 'ready', box: { x: 100, y: 200, width: 608, height: 156, borderX: 2, borderY: 2, scaleX: 2, scaleY: 2 }, viewport: { width: 900, height: 800 } };
  assert.deepEqual(recaptchaMousePoint(h, { state: 'ready', x: 28, y: 28 }), { x: 160, y: 260 });
  assert.equal(recaptchaMousePoint(h, { state: 'ready', x: 999, y: 28 }), null);
});
function transport({ lost = false, overlay = false } = {}) {
  let marked = false; const mouse = [];
  const h = { state: 'ready', index: 0, box: { x: 10, y: 20, width: 304, height: 78, borderX: 0, borderY: 0, scaleX: 1, scaleY: 1 }, viewport: { width: 900, height: 800 } };
  const c = { events: [], evaluate: async expression => {
    if (expression.startsWith('document.elementFromPoint')) return !overlay;
    if (marked) return { state: 'stop' };
    if (expression.includes('"action":"mark"')) marked = true;
    return h;
  }, send: async (method, params) => {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [2] };
    if (method === 'DOM.describeNode') return { node: { frameId: 'child' } };
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 9 };
    if (method === 'Runtime.evaluate') return { result: { value: { state: 'ready', x: 28, y: 28 } } };
    if (method === 'Input.dispatchMouseEvent') { assert.ok(marked); mouse.push(params.type); if (lost && params.type === 'mousePressed') throw Error('lost response'); return {}; }
    throw Error('unexpected ' + method);
  } };
  return { c, mouse };
}
test('real input pair dispatched once, with marker before press', async () => {
  const f = transport(), click = createRecaptchaClicker(f.c, want);
  assert.equal((await click()).state, 'clicked'); await click(); await createRecaptchaClicker(f.c, want)();
  assert.deepEqual(f.mouse, ['mousePressed', 'mouseReleased']);
});
test('lost press response releases mouse and never retries', async () => {
  const f = transport({ lost: true }), click = createRecaptchaClicker(f.c, want);
  assert.equal((await click()).state, 'stop'); await click(); assert.deepEqual(f.mouse, ['mousePressed', 'mouseReleased']);
});
test('overlay prevents any mouse input', async () => {
  const f = transport({ overlay: true }); assert.equal((await createRecaptchaClicker(f.c, want)()).state, 'waiting'); assert.deepEqual(f.mouse, []);
});
test('out of process iframe replies are read and session is detached', async () => {
  let detached = false;
  const c = { events: [], send: async (method) => {
    if (method === 'Page.createIsolatedWorld') throw Error('separate target');
    if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'frame', type: 'iframe' }] };
    if (method === 'Target.attachToTarget') return { sessionId: 'ours' };
    if (method === 'Target.sendMessageToTarget') { c.events.push({ method: 'Target.receivedMessageFromTarget', params: { sessionId: 'ours', message: JSON.stringify({ id: 1, result: { result: { value: { state: 'ready', x: 28, y: 28 } } } }) } }); return {}; }
    if (method === 'Target.detachFromTarget') { detached = true; return {}; }
    throw Error(method);
  } };
  assert.equal((await readRecaptchaFrame(c, 'frame')).state, 'ready'); assert.equal(detached, true);
});
