#!/usr/bin/env node
/**
 * keyescape.com 개발자도구 차단 해제 (멱등 · 재실행 안전)
 *
 *   node unlock.mjs [URL] [--quiet]
 *
 * 하는 일
 *   1) CDP(기본 9222) 접속. 크롬이 없어 접속 안 되면 호출자가 start.sh 로 기동한다.
 *   2) Extensions.loadUnpacked 로 ext/ 를 설치  → 모든 탭·모든 프레임에 자동 주입 (세션 전용)
 *      (이 빌드의 크롬은 로드를 거부할 수 있다. 그때도 아래 3번으로 동일한 해제가 적용된다)
 *   3) keyescape 탭 각각에 attach 후
 *        - Page.addScriptToEvaluateOnNewDocument : 이후 이동/새로고침 시 "사이트 스크립트 실행 전" 주입
 *        - Runtime.evaluate                      : 현재 이미 열려 있는 문서에 즉시 적용
 *   4) 해제 상태 검증 출력 (디텍터 더미 / 우클릭 / F12 차단기)
 *
 * 차단 3종에 대한 대응 (ext/inject.js):
 *   - window.devtoolsDetector 를 더미 객체로 선점  → 감지 자체가 무동작 (DevTools 열어도 검은화면 안 됨)
 *   - contextmenu 캡처 단계 stopImmediatePropagation → 우클릭("검사" 포함) 허용
 *   - document.onkeydown setter 를 no-op 로 치환   → F12 / Cmd+Opt+I / Cmd+U 키 차단 무력화
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.CDP_PORT || 9222);
const QUIET = process.argv.includes('--quiet');
const RELOAD = process.argv.includes('--reload');
const ARG_URL = process.argv.find((a) => /^https?:/.test(a));
const INJECT = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ext', 'inject.js'), 'utf8');
const say = (...a) => { if (!QUIET) console.log(...a); };
const die = (m) => { console.error('실패: ' + m); process.exit(1); };

/* ---------- CDP 최소 클라이언트 ---------- */
const ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())
  .catch(() => die(`CDP(:${PORT}) 연결 없음. ./unlock.sh 를 쓰면 크롬까지 자동으로 기동됩니다.`));
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('브라우저 WS 접속 실패')); });
let seq = 0; const pend = new Map(); const events = [];
ws.onmessage = (m) => {
  const g = JSON.parse(m.data);
  if (g.id && pend.has(g.id)) { pend.get(g.id)(g); pend.delete(g.id); }
  else events.push(g);
};
class C {
  constructor(sessionId) { this.sid = sessionId; }
  send(method, params = {}, ms = Number(process.env.CDP_TIMEOUT || 8000)) {
    return new Promise((res, rej) => {
      const id = ++seq;
      const t = setTimeout(() => { pend.delete(id); rej(new Error(method + ': 응답 시간 초과')); }, ms);
      pend.set(id, (m) => {
        clearTimeout(t);
        if (m.error) rej(new Error(method + ': ' + m.error.message)); else res(m.result);
      });
      ws.send(JSON.stringify({ id, method, params, sessionId: this.sid }));
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '예외');
    return r.result?.value;
  }
}

/* ---------- 1) 확장 설치 (있으면 가장 견고) ---------- */
const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ext');
const bc = new C();
const bext = await bc.send('Extensions.loadUnpacked', { path: EXT }, 3000).then(() => 'ok').catch(() => 'skip');
say(`확장(ext/)              : ${bext === 'ok' ? '설치됨 (모든 탭·프레임에 자동 주입)' : '이 빌드는 거부 → CDP 주입으로 대체'}`);

/* ---------- 2) keyescape 탭 준비 ---------- */
let targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let pages = targets.filter((t) => t.type === 'page' && /keyescape\.com/i.test(t.url));
if (!pages.length) {
  if (!ARG_URL) die('keyescape 탭이 없습니다. URL 을 인자로 주면 새로 엽니다. (예: node unlock.mjs https://www.keyescape.com/)');
  const { targetId } = await bc.send('Target.createTarget', { url: ARG_URL });
  for (let i = 0; i < 20 && !pages.length; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const t2 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    pages = t2.filter((t) => t.type === 'page' && t.id === targetId && /keyescape\.com/i.test(t.url));
  }
}
if (!pages.length) die('탭이 열리지 않았습니다. 창에서 keyescape 페이지를 수동으로 연 뒤 다시 실행하세요.');

/* ---------- 3) 탭별 주입 ---------- */
const VERIFY = `(() => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  (document.body || document.documentElement).dispatchEvent(ev);
  const d = window.devtoolsDetector;
  return JSON.stringify({
    href: location.href.slice(0, 72),
    dummy: !!(d && d.addListener && d.addListener.name === 'noop'),
    ctxOpen: !ev.defaultPrevented,
    keyBlock: typeof document.onkeydown === 'function' ? '차단기 등록됨' : '미등록(F12 열림)',
  });
})()`;

let bad = 0;
for (const t of pages) {
  const c = new C((await bc.send('Target.attachToTarget', { targetId: t.id, flatten: true })).sessionId);
  await c.send('Page.enable').catch(() => {});
  await c.send('Runtime.enable').catch(() => {});
  await c.send('Page.setBypassCSP', { enabled: true }).catch(() => {});
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT }).catch(() => {});
  if (RELOAD) {
    await c.send('Page.reload', { ignoreCache: false }).catch(() => {});
    // ★ 새 문서가 실제로 커밋될 때까지 여기서 기다려야 한다.
    //   이 대기 없이 프로세스가 끝나면 세션과 함께 addScriptToEvaluateOnNewDocument 등록이
    //   사라져, 그 뒤에 뜨는 문서 사이트 차단기가 무방비로 설치된다(컨테이너에서 실측).
    const lim = Date.now() + 25000;
    while (Date.now() < lim) {
      const rs = await c.evaluate('document.readyState').catch(() => 'loading');
      if (rs === 'complete') break;
      await new Promise((r) => setTimeout(r, 700));
    }
    await new Promise((r) => setTimeout(r, 900));   // 인라인 차단 스크립트가 한 바퀴 도는 시간
  }
  await c.evaluate(INJECT).catch(() => {});           // 이미 열린 문서에 즉시 적용
  let s = JSON.parse(await c.evaluate(VERIFY));
  if (!(s.dummy && s.ctxOpen && s.keyBlock.startsWith('미등록'))) {
    // 사이트 스크립트가 우리 더미를 덮어썼을 수 있다 → 한 번 더 적용하고 재확인
    await c.evaluate(INJECT).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    s = JSON.parse(await c.evaluate(VERIFY));
  }
  const okLine = s.dummy && s.ctxOpen && s.keyBlock.startsWith('미등록');
  if (!okLine) bad++;
  say(`탭 [${pages.indexOf(t) + 1}]          : ${okLine ? '해제됨' : '일부 미적용 → 새로고침 필요'}`);
  say(`   URL             : ${s.href}`);
  say(`   디텍터 더미     : ${s.dummy ? 'O (감지 무력화)' : 'X'}`);
  say(`   우클릭          : ${s.ctxOpen ? 'O (검사 가능)' : 'X'}`);
  say(`   F12/단축키      : ${s.keyBlock}`);
}
if (bext === 'ok') say('참고  확장 설치 상태에서는 새로고침/이동 후에도 계속 해제된 채로 유지됩니다.');
else say('참고  이 탭을 새로고침하면 사이트 차단기가 다시 설치될 수 있습니다. 해제 후 다시 실행하세요.');
say('검증   F12 로 DevTools 열기 + 페이지 우클릭 → "검사" 활성 + Console 에서 window.devtoolsDetector 확인');
process.exit(bad ? 2 : 0);
