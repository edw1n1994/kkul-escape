#!/usr/bin/env node
/**
 * keyescape Step1 자동 진행 드라이버 (CDP / 잠금해제된 Chrome 필요)
 *
 *   node step1.mjs --zizum 18 --theme 58 [--date 2026-09-10] [--time 2263] [--no-submit]
 *
 *   --zizum  지점번호(#zizum value)          --theme 테마번호(option data-themenum)
 *   --date   YYYY-MM-DD (생략 시 최초 가능일)  --time themeTimeNum(생략 시 최초 가능 슬롯)
 *   --no-submit  입력까지만 하고 NEXT 하지 않음
 */
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9222);
const HERE = new URL('.', import.meta.url).pathname;
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : null; };
const OPTS = {
  zizum: arg('zizum') || '18',
  theme: arg('theme') || '58',
  date: arg('date') || '',
  time: arg('time') || '',
  submit: !process.argv.includes('--no-submit'),
};

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /keyescape/.test(t.url));
if (!page) { console.error('keyescape 탭 없음. ./start.sh 실행 후 다시 실행하세요.'); process.exit(1); }

/** 아주 얇은 CDP 클라이언트 */
function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let seq = 0;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 접속 실패')); });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval 실패');
    }
    return r.result.value;
  };
  return { ws, ready, send, evaluate };
}

const c = client(page.webSocketDebuggerUrl);
await c.ready;
await c.send('Runtime.enable');
await c.send('Page.enable');

const PAGE_SRC = fs.readFileSync(HERE + 'step1-page.js', 'utf8');
const expr = `(async () => { const OPTS = ${JSON.stringify(OPTS)};\n${PAGE_SRC}\n})()`;

console.log('요청:', JSON.stringify(OPTS));
let report;
try {
  report = await c.evaluate(expr);
} catch (e) {
  console.error('실패:', String(e.message).replace(/^Error:\s*/, ''));
  process.exit(2);
}
console.log('\n===== Step1 =====');
report.log.forEach((l) => console.log(' -', l));
console.log(' 요약:', report.reservInfo);
console.log(' 폼:', JSON.stringify(report.filledForm));

if (!OPTS.submit) { c.ws.close(); process.exit(0); }

// NEXT 이후(이동 후) 상태 확인
await new Promise((r) => setTimeout(r, 7000));
const after = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = after.find((t) => t.type === 'page' && /keyescape/.test(t.url));
console.log('\n===== 이동 후 =====');
console.log(' URL:', tab?.url);
const c2 = client(tab.webSocketDebuggerUrl);
await c2.ready;
await c2.send('Runtime.enable');
const info = await c2.evaluate(`({
  title: document.title,
  fields: [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].map(e => e.name || e.id).filter(Boolean).slice(0, 30),
  hidden: [...document.querySelectorAll('input[type=hidden]')].map(e => e.name + '=' + e.value),
  alert: [...document.querySelectorAll('.alert, .alert_text, .msg')].map(e => e.innerText.trim()).join(' / ').slice(0, 200),
  text: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300)
})`);
console.log(' 제목:', info.title);
if (info.alert) console.log(' 알림:', info.alert);
console.log(' 필드:', info.fields.join(', '));
console.log(' 숨은값:', info.hidden.join(' | '));
console.log(' 화면:', info.text);
c2.ws.close(); c.ws.close();

