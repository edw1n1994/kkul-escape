// Click the visible checkbox once. Challenge solving and token creation are never performed.
export function recaptchaHostPage({ want, action = 'read' }) {
  const url = new URL(location.href);
  const stop = reason => ({ state: 'stop', reason });
  if (url.protocol !== 'https:' || !['www.keyescape.com', 'keyescape.com'].includes(url.hostname) || url.pathname !== '/reservation2.php') return stop('예약창 아님');
  const form = document.querySelector('#form');
  const keys = ['zizum_num', 'theme_num', 'theme_info_num', 'rev_days', 'theme_time_num'];
  if (!form || !want || Object.keys(want).length !== 5 || keys.some(k => want[k] == null || !String(want[k]).trim() || String(form.elements.namedItem(k)?.value || '') !== String(want[k]))) return stop('예약좌표 불일치');
  if (document.querySelector('textarea[name="g-recaptcha-response"]')?.value.trim()) return stop('이미 인증 완료');
  if (window.__KE_RECAPTCHA_CLICKED) return stop('이미 체크박스 클릭 요청함');
  const visible = e => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.visibility !== 'visible' || s.display === 'none' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const frames = [...document.querySelectorAll('iframe')];
  const kind = e => {
    try { const u = new URL(e.src); return u.protocol === 'https:' && ['www.google.com', 'www.recaptcha.net', 'recaptcha.net'].includes(u.hostname) && /^\/recaptcha\/(api2|enterprise)\/(anchor|bframe)$/.test(u.pathname) ? u.pathname.split('/').pop() : ''; }
    catch { return ''; }
  };
  if (frames.some(e => {
    if (kind(e) !== 'bframe' || !visible(e)) return false;
    const r = e.getBoundingClientRect();
    return r.x + r.width > 0 && r.y + r.height > 0 && r.x < innerWidth && r.y < innerHeight;
  })) return stop('문제가 표시됨 — 직접 풀어 주세요');
  const anchors = frames.filter(e => kind(e) === 'anchor' && visible(e));
  if (anchors.length !== 1) return { state: 'waiting', reason: '체크박스 표시 대기' };
  const frame = anchors[0];
  if (action === 'scroll') frame.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const r = frame.getBoundingClientRect();
  if (!frame.offsetWidth || !frame.offsetHeight) return { state: 'waiting' };
  if (action === 'mark') window.__KE_RECAPTCHA_CLICKED = true;
  return { state: 'ready', index: frames.indexOf(frame), box: { x: r.x, y: r.y, width: r.width, height: r.height, scaleX: r.width / frame.offsetWidth, scaleY: r.height / frame.offsetHeight, borderX: frame.clientLeft, borderY: frame.clientTop }, viewport: { width: innerWidth, height: innerHeight } };
}

export function recaptchaCheckboxPoint() {
  const checkbox = document.querySelector('#recaptcha-anchor[role="checkbox"]');
  if (!checkbox) return { state: 'waiting' };
  if (checkbox.getAttribute('aria-checked') === 'true' || checkbox.getAttribute('aria-busy') === 'true' || /(?:^|\s)recaptcha-checkbox-(?:checked|loading)(?:\s|$)/.test(checkbox.className)) return { state: 'stop', reason: '사용자가 이미 인증을 시작했거나 완료함' };
  const r = checkbox.getBoundingClientRect(), style = getComputedStyle(checkbox);
  if (r.width <= 0 || r.height <= 0 || style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0 || checkbox.getAttribute('aria-disabled') === 'true') return { state: 'waiting' };
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  if (!hit || !(hit === checkbox || checkbox.contains(hit))) return { state: 'waiting' };
  return { state: 'ready', x, y };
}

export function recaptchaMousePoint(host, inner) {
  if (host?.state !== 'ready' || inner?.state !== 'ready') return null;
  const { box, viewport } = host;
  const x = box.x + (box.borderX + inner.x) * box.scaleX;
  const y = box.y + (box.borderY + inner.y) * box.scaleY;
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height || x < box.x || x >= box.x + box.width || y < box.y || y >= box.y + box.height) return null;
  return { x, y };
}

async function bounded(promise, ms = 1800) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('체크박스 읽기 시간 초과')), ms); })]); }
  finally { clearTimeout(timer); }
}

// An iframe may live in the page process or in a separate Chrome target (OOPIF).
export async function readRecaptchaFrame(c, frameId) {
  const expression = `(${recaptchaCheckboxPoint.toString()})()`;
  try {
    const { executionContextId } = await bounded(c.send('Page.createIsolatedWorld', { frameId, worldName: 'kkul-checkbox-read' }));
    const r = await bounded(c.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true }));
    if (!r.exceptionDetails && r.result?.value) return r.result.value;
  } catch { /* A separate target is attached below, without changing its content. */ }
  let sessionId;
  try {
    // Refresh Chrome's target registry after an iframe moves into a separate process.
    const { targetInfos } = await bounded(c.send('Target.getTargets'));
    if (!targetInfos.some(t => t.targetId === frameId && t.type === 'iframe')) return { state: 'waiting' };
    ({ sessionId } = await bounded(c.send('Target.attachToTarget', { targetId: frameId, flatten: false })));
    await bounded(c.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }) }));
    const until = Date.now() + 1800;
    while (Date.now() < until) {
      const index = c.events.findIndex(e => e.method === 'Target.receivedMessageFromTarget' && e.params.sessionId === sessionId && JSON.parse(e.params.message).id === 1);
      if (index >= 0) {
        const reply = JSON.parse(c.events.splice(index, 1)[0].params.message);
        if (reply.error || reply.result?.exceptionDetails) throw Error('체크박스를 읽지 못함');
        return reply.result?.result?.value || { state: 'waiting' };
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return { state: 'waiting' };
  } finally {
    if (sessionId) await bounded(c.send('Target.detachFromTarget', { sessionId })).catch(() => {});
  }
}

export function createRecaptchaClicker(c, want) {
  let finished = false;
  return async function attempt() {
    if (finished) return { state: 'stop', reason: '체크박스 자동 클릭 종료' };
    const hostRead = action => bounded(c.evaluate(`(${recaptchaHostPage.toString()})(${JSON.stringify({ want, action })})`));
    try {
      let host = await hostRead('read');
      if (host.state === 'stop') { finished = true; return host; }
      if (host.state !== 'ready') return host;
      host = await hostRead('scroll');
      const { root } = await bounded(c.send('DOM.getDocument', { depth: 0 }));
      const { nodeIds } = await bounded(c.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'iframe' }));
      const { node } = await bounded(c.send('DOM.describeNode', { nodeId: nodeIds[host.index] }));
      if (!node.frameId) return { state: 'waiting' };
      const inner = await readRecaptchaFrame(c, node.frameId);
      if (inner.state === 'stop') { finished = true; return inner; }
      const fresh = await hostRead('read');
      if (fresh.state === 'stop') { finished = true; return fresh; }
      if (fresh.index !== host.index || JSON.stringify(fresh.box) !== JSON.stringify(host.box)) return { state: 'waiting' };
      const point = recaptchaMousePoint(fresh, inner);
      if (!point) return { state: 'waiting' };
      // Make sure no overlay covers the iframe in the parent page.
      const clear = await bounded(c.evaluate(`document.elementFromPoint(${point.x},${point.y}) === document.querySelectorAll('iframe')[${fresh.index}]`));
      if (!clear) return { state: 'waiting' };
      const marked = await hostRead('mark');
      if (marked.state !== 'ready') { finished = true; return marked; }
      finished = true; // A lost CDP response after dispatch must not trigger another click.
      try {
        await bounded(c.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }));
      } finally {
        await bounded(c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }));
      }
      return { state: 'clicked', reason: '체크박스 1회 클릭 — 문제가 나오면 직접 풀어 주세요' };
    } catch {
      return { state: finished ? 'stop' : 'waiting', reason: finished ? '클릭 응답 미확인 — 다시 클릭하지 않습니다' : '체크박스 준비 대기' };
    }
  };
}
