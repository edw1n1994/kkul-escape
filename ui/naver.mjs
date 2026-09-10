import fs from 'node:fs';
import { cdp, cdpList, sleep } from './lib.mjs';
import { naverPage, naverLoginRead } from './naver-browser.mjs';

const validTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export function validNaverDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function parseNaverProduct(entry) {
  const url = new URL(entry.url);
  const match = url.pathname.match(/^\/booking\/12\/bizes\/(\d+)\/items\/(\d+)\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'booking.naver.com' || url.username || url.password || url.port || !match) throw new Error('네이버 예약 유형 12의 상품 URL을 입력하세요');
  if (typeof entry.name !== 'string' || !entry.name.trim() || !Array.isArray(entry.times) || !entry.times.length || !entry.times.every(validTime)) throw new Error('네이버 상품명과 HH:MM 시간표가 필요합니다');
  const timesByWeekday = entry.timesByWeekday || {};
  for (const [day, times] of Object.entries(timesByWeekday)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(times) || !times.every(validTime)) throw new Error('요일별 시간표가 잘못되었습니다');
  }
  const leadDays = entry.leadDays, openTime = entry.openTime;
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365 || !validTime(openTime)) throw new Error('상품별 오픈 시각과 일수 설정이 필요합니다');
  return { name: entry.name.trim(), branch: String(entry.branch || '네이버 예약'), url: url.origin + url.pathname.replace(/\/$/, ''), business: match[1], theme: match[2], info: match[2], times: [...new Set(entry.times)].sort(), timesByWeekday, leadDays, openTime };
}
export function naverProducts() {
  const entries = JSON.parse(fs.readFileSync(new URL('./naver-products.json', import.meta.url), 'utf8'));
  if (!Array.isArray(entries)) throw new Error('naver-products.json은 상품 배열이어야 합니다');
  const products = entries.map(parseNaverProduct);
  if (new Set(products.map(p => p.url)).size !== products.length) throw new Error('중복 네이버 상품입니다');
  return products;
}
export function naverProduct(business, theme) {
  const product = naverProducts().find(p => p.business === String(business) && p.theme === String(theme));
  if (!product) throw new Error('등록되지 않은 네이버 상품입니다');
  return product;
}
export const naverToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
export function naverTimes(product, date) {
  if (!validNaverDate(date)) throw new Error('올바른 날짜를 선택하세요');
  return product.timesByWeekday[new Date(date).getUTCDay()] || product.times;
}
export function naverPreview(business, theme, date) {
  const product = naverProduct(business, theme);
  return { ok: true, preview: true, slots: naverTimes(product, date).map(time => ({ num: '시간표 참고', time, open: false })), msg: '요일별 참고 시간표입니다. 실제 회차와 예약 가능 여부는 실행 시 네이버 화면에서 확인합니다.' };
}
export function naverOpenInfo(business, theme, date, now = Date.now()) {
  const product = naverProduct(business, theme);
  if (!validNaverDate(date)) throw new Error('올바른 날짜를 선택하세요');
  const openDate = new Date(Date.parse(date) - product.leadDays * 86400000).toISOString().slice(0, 10);
  const openAt = `${openDate}T${product.openTime}:00+09:00`;
  return { ok: true, branch: product.branch, openTime: product.openTime, openDate, openAt, leadDays: product.leadDays,
    openTimeSource: '등록 시간표 (실제 오픈은 네이버 화면에서 확인)', leadSource: '등록된 예약 창 기준', msUntil: Date.parse(openAt) - now, past: Date.parse(openAt) <= now };
}
export function validateNaverRun(args) {
  const product = naverProduct(args.zizum, args.theme);
  const date = String(args.date || ''), time = String(args.times || '');
  const times = naverTimes(product, date);
  if (!args.dry && !times.includes(time)) throw new Error('목표 날짜의 시간대를 하나 선택하세요');
  if (!args.dry && date < naverToday()) throw new Error('지난 날짜에는 예약할 수 없습니다');
  const givenOpenAt = args['open-at'] || args.openAt;
  const openAt = givenOpenAt ? Date.parse(String(givenOpenAt)) : Date.parse(naverOpenInfo(args.zizum, args.theme, date).openAt);
  if (!Number.isFinite(openAt)) throw new Error('오픈 시각이 올바르지 않습니다');
  return { product, date, time, openAt };
}
function productUrl(product, date) {
  const url = new URL(product.url);
  url.searchParams.set('tab', 'book');
  if (date) url.searchParams.set('startDateTime', date + 'T00:00:00+09:00');
  return url.href;
}
async function timed(promise, ms = 6000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('브라우저 응답 시간 초과')), ms); })]); }
  finally { clearTimeout(timer); }
}
export async function openNaver(port, product, date) {
  const base = `http://127.0.0.1:${Number(port)}`;
  const tab = await fetch(base + '/json/new?about%3Ablank', { method: 'PUT', signal: AbortSignal.timeout(4000) }).then(r => r.json());
  if (!tab.webSocketDebuggerUrl) throw new Error('네이버 예약 탭을 만들지 못했습니다');
  const c = cdp(tab.webSocketDebuggerUrl);
  try { await timed(c.ready); await timed(c.send('Page.navigate', { url: productUrl(product, date) })); await timed(c.send('Page.bringToFront')); }
  finally { c.ws.close(); }
  return tab;
}
async function readTab(port, business, theme, fn) {
  const list = await cdpList(port);
  if (!list) return { ok: false, loggedIn: null, msg: '예약용 브라우저 연결 없음' };
  const products = business && theme ? [naverProduct(business, theme)] : naverProducts();
  const tab = list.find(t => t.type === 'page' && products.some(p => {
    try { const u = new URL(t.url); return u.origin === new URL(p.url).origin && [new URL(p.url).pathname, new URL(p.url).pathname + '/request'].includes(u.pathname); } catch { return false; }
  }));
  if (!tab) return { ok: false, loggedIn: null, msg: '네이버 예약창을 열고 로그인해 주세요' };
  const c = cdp(tab.webSocketDebuggerUrl);
  try { await timed(c.ready); return await timed(fn(c)); } finally { c.ws.close(); }
}
export async function naverLogin(port, business, theme) {
  return readTab(port, business, theme, c => c.evaluate(`(${naverLoginRead.toString()})()`));
}
export async function naverStatus(port, business, theme, date, time) {
  const product = naverProduct(business, theme);
  return readTab(port, business, theme, c => c.evaluate(`(${naverPage.toString()})(${JSON.stringify({ product, date, time })})`));
}

// Injected transport makes the real scheduler testable without a live reservation.
export async function driveNaver({ read, refresh, focus, deadline, auto = true, now = Date.now, nap = sleep, log = console.log }) {
  let refreshedAt = now(), lastMsg = '', nextClicked = false;
  while (now() < deadline) {
    const state = await read('read');
    if (state?.blocked) throw new Error(state.msg);
    if (state?.request) { log('[HANDOFF] 네이버 신청서 도착 — 브라우저에서 최종 확인·결제를 진행하세요'); return 'request'; }
    if (state?.nextRequested) nextClicked = true;
    if (nextClicked) { await nap(100); continue; } // Never refresh/retry after the next request.
    if (now() - refreshedAt >= 10000) { await refresh(); refreshedAt = now(); await nap(500); continue; }
    if (!state?.loaded) {
      if (state?.msg !== lastMsg) { log('[POLL] ' + (state?.msg || '달력 로딩 대기')); lastMsg = state?.msg; }
      await read('date'); // Reversible selection: click, then verify on the next iteration (hydration).
      await nap(100); continue;
    }
    const slot = state.slots.find(s => s.time === state.wantTime);
    if (!slot?.open) { await nap(200); continue; }
    if (!auto) { await focus(); log('[HANDOFF] 목표 회차가 열렸습니다. 브라우저에서 진행하세요'); return 'manual'; }
    if (!state.loggedIn) throw new Error('네이버 로그인이 필요합니다. 예약창에서 로그인 후 다시 실행하세요');
    if (!slot.selected) { await read('time'); await nap(70); continue; }
    const result = await read('next');
    if (result?.blocked) throw new Error(result.msg);
    if (result?.clicked || result?.uncertain) { nextClicked = true; log('[NEXT] 다음 1회 클릭 — 신청서 도착 확인 중'); await focus(); }
    await nap(100);
  }
  throw new Error(nextClicked ? '신청서 이동을 확인하지 못했습니다. 중복 클릭하지 않고 종료합니다. 브라우저를 확인하세요.' : '대기 시간 안에 목표 회차가 열리지 않았습니다');
}
export async function runNaver(args) {
  const { product, date, time, openAt } = validateNaverRun(args);
  if (args.dry) { console.log('[PREVIEW] ' + JSON.stringify(naverPreview(args.zizum, args.theme, date))); return; }
  const port = Number(args.port || process.env.CDP_PORT || 9222);
  const waitMs = Math.min(600, Math.max(10, Number(args.deadline) || 60)) * 1000;
  console.log(`[RUN] 네이버 ${product.name} ${date} ${time} / 오픈 ${new Date(openAt).toISOString()}`);
  const tab = await openNaver(port, product, date);
  const c = cdp(tab.webSocketDebuggerUrl);
  const read = action => timed(c.evaluate(`(${naverPage.toString()})(${JSON.stringify({ product, date, time, action })})`));
  const refresh = () => timed(c.send('Page.navigate', { url: productUrl(product, date) }));
  try {
    await timed(c.ready);
    console.log('[READY] 네이버 예약 탭을 열었습니다. 네이버 로그인 상태를 확인하세요.');
    let lastMinute;
    while (Date.now() < openAt) {
      const minute = Math.ceil((openAt - Date.now()) / 60000);
      if (lastMinute !== minute) { console.log(`[WAIT] 오픈까지 약 ${minute}분`); lastMinute = minute; }
      await sleep(Math.min(1000, openAt - Date.now()));
    }
    await refresh();
    await driveNaver({ read: async action => {
      try { return await read(action); } catch (e) {
        if (/context|navigat|Cannot find/i.test(e.message)) return { ok: false, uncertain: action === 'next', msg: '화면 전환 중' };
        throw e;
      }
    }, refresh, focus: () => timed(c.send('Page.bringToFront')), deadline: Date.now() + waitMs,
      auto: !args['no-auto-submit'] && !args['watch-only'] && !args['submit-preview'] });
  } finally { c.ws.close(); }
}
