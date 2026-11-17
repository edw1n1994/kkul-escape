#!/usr/bin/env node
/**
 * 예약 스케줄 CLI — 실행 중인 UI 서버(ui/server.mjs) 의 API 로 '오픈 시각 예약 대기' 를 건다.
 * 화면에서 고르는 것과 같은 값(지점·테마·날짜·시간·오픈 시각)을 이름으로 찾아 /api/run 한 번으로 넘긴다.
 *
 *   node scripts/schedule.mjs plan   --site keyescape --zizum 백산방역 --theme 미명도감 --date 2026-11-23 --times 13:00,13:55
 *   node scripts/schedule.mjs start  (plan 과 같은 인자) --yes      ← --yes 없이는 시작하지 않는다
 *   node scripts/schedule.mjs status [--lines 30]
 *   node scripts/schedule.mjs stop
 *
 * 공통   --server http://127.0.0.1:8899   (UI 서버 주소)
 * 선택   --person 3            신청서형 사이트의 예약 인원 (미지정 시 화면의 테마 최소 인원)
 *        --deadline 600        오픈 후 슬롯을 기다리는 초 (기본: 신청서형 600, 그 외 60 — 화면과 같음)
 *        --open-at <ISO>       오픈 시각을 직접 지정 (사이트가 오픈 시각을 아직 알려 주지 않을 때만)
 *        --auto-submit         제로월드 '예약하기' 자동 클릭 (이미지 코드를 사람이 넣은 뒤 1회, 기본 off)
 *        --no-auto-submit      키이스케이프 '예약하기' 자동 클릭 끄기 (키이스케이프는 기본 on — reCAPTCHA 체크박스 자동,
 *                              문제는 사람, 토큰이 생기면 예약 정보 검증 후 1회 클릭)
 *        --final-submit        신청서형 최종 버튼 자동 1회 (기본 off — 사용자가 명시적으로 요청한 경우에만)
 *        --dry                 슬롯 조회만 (아무것도 누르지 않음)
 *
 * 예약자 이름·연락처는 이 스크립트가 다루지 않는다 — 서버가 ui/local.env(또는 환경변수) 에서 읽는다.
 * 출력 마지막 줄은 기계용 JSON (`PLAN_JSON {...}` / `RESULT_JSON {...}`) 이다. 개인 값은 출력하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORM = new Set(['rhe', 'jgb', 'p33', 'ptd', 'oas']);
const FLAGS = new Set(['yes', 'auto-submit', 'no-auto-submit', 'final-submit', 'dry', 'json']);

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    const k = t.slice(2);
    if (FLAGS.has(k)) a[k] = true;
    else a[k] = argv[++i];
  }
  return a;
}
const A = parseArgs(process.argv.slice(2));
const CMD = A._[0] || 'plan';
const SERVER = String(A.server || process.env.KKUL_SERVER || 'http://127.0.0.1:8899').replace(/\/$/, '');

const die = (msg, extra = {}) => { console.error('[ERROR] ' + msg); console.log('RESULT_JSON ' + JSON.stringify({ ok: false, msg, ...extra })); process.exit(1); };
async function api(p, opt = {}) {
  let r;
  try { r = await fetch(SERVER + p, { ...opt, signal: AbortSignal.timeout(opt.timeout || 120000) }); }
  catch (e) { die(`UI 서버(${SERVER}) 에 연결하지 못했습니다 — 먼저 서버를 띄우세요: ${e.message}`); }
  const text = await r.text();
  try { return JSON.parse(text); } catch { die(`서버 응답이 JSON 이 아닙니다 (${p}): ${text.slice(0, 120)}`); }
}
const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const kst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' KST';
const dowOf = (d) => '일월화수목금토'[new Date(d + 'T00:00:00Z').getUTCDay()];
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const until = (ms) => { if (ms <= 0) return '이미 지남'; const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분 후` : `${m}분 후`; };

/** 번호가 정확히 맞거나, 이름에 검색어가 들어간 항목 하나 */
function pick(list, want, what, keyNum, keyName) {
  if (want === undefined || want === '' || want === true) die(`--${what} 를 지정하세요. 후보: ${list.map((x) => `${x[keyNum]}:${x[keyName]}`).join(', ')}`);
  const byNum = list.filter((x) => String(x[keyNum]) === String(want));
  if (byNum.length === 1) return byNum[0];
  const byName = list.filter((x) => norm(x[keyName]).includes(norm(want)));
  if (byName.length === 1) return byName[0];
  die(`${what} '${want}' 를 ${byName.length ? '하나로 정하지' : '찾지'} 못했습니다. 후보: ${(byName.length ? byName : list).map((x) => `${x[keyNum]}:${x[keyName]}`).join(', ')}`);
}

/** ui/local.env · 환경변수에 예약자 값이 있는지만 본다 (값은 읽어 출력하지 않는다) */
function buyerReady() {
  let env = '';
  try { env = fs.readFileSync(path.join(ROOT, 'ui', 'local.env'), 'utf8'); } catch { env = ''; }
  const has = (k) => !!String(process.env[k] || '').trim() || new RegExp(`^\\s*${k}\\s*=\\s*\\S`, 'm').test(env);
  return { name: has('KEYESCAPE_NAME'), hp: has('KEYESCAPE_HP'), dep: has('KEYESCAPE_DEP'), file: !!env };
}

async function plan() {
  const site = String(A.site || '').toLowerCase();
  const env = await api(`/api/env?${q({ site })}`);
  const sites = (env.sites || []).map((s) => s.key);
  if (!sites.includes(site)) die(`--site 는 ${sites.join(' / ')} 중 하나여야 합니다`);
  const branch = pick(env.branches || [], A.zizum, 'zizum', 'num', 'name');
  const th = await api(`/api/themes?${q({ site, zizum: branch.num })}`);
  if (!th.ok && !(th.themes || []).length) die(`테마 목록을 읽지 못했습니다: ${th.msg || '-'}`);
  const theme = pick(th.themes || [], A.theme, 'theme', 'theme', 'name');
  const date = String(A.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die('--date 는 YYYY-MM-DD 형식이어야 합니다');
  const times = String(A.times || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((t) => (/^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, '0') : die(`--times 의 '${t}' 는 HH:MM 이 아닙니다`)));
  if (!A.dry && !times.length) die('--times 를 지정하세요 (쉼표로 여러 개 = 우선순위 순)');

  const base = { site, zizum: branch.num, theme: theme.theme, info: theme.info };
  const oi = await api(`/api/openinfo?${q({ ...base, date })}`);
  const openAt = A['open-at'] ? new Date(String(A['open-at'])).toISOString() : oi.openAt || '';
  if (!openAt && !A.dry) die(`이 날짜의 오픈 시각을 계산하지 못했습니다: ${oi.note || oi.msg || '-'} (--open-at 으로 직접 지정할 수 있습니다)`, { openinfo: oi });

  // 참고 시간표: 그 날짜가 이미 조회되면 그 날, 아니면 같은 요일(7일 전) 의 시간표
  const now = await api(`/api/slots?${q({ ...base, date })}`);
  let ref = { date, slots: now.slots || [], same: true };
  if (!ref.slots.length) {
    const prev = await api(`/api/slots?${q({ ...base, date: addDays(date, -7) })}`);
    ref = { date: addDays(date, -7), slots: prev.slots || [], same: false };
  }
  const refTimes = ref.slots.map((s) => s.time);
  const unknown = times.filter((t) => refTimes.length && !refTimes.includes(t));

  const form = FORM.has(site);
  const body = {
    site, zizum: branch.num, theme: theme.theme, info: theme.info, date, tname: theme.name,
    times: times.join(','), deadline: Number(A.deadline || (form ? 600 : 60)),
  };
  if (openAt) body.openAt = openAt;
  if (A.person) body.person = String(A.person);
  if (A.dry) body.dry = true;
  // 키이스케이프는 '예약하기' 자동 클릭이 기본 on (사용자 결정 2026-11-16), 제로월드는 opt-in
  if (site === 'keyescape' ? !A['no-auto-submit'] : (A['auto-submit'] && site === 'zeroworld')) body.autoSubmit = true;
  if (A['final-submit'] && form && env.finalAuto !== false) body.finalSubmit = true;

  const buyer = buyerReady();
  const warns = [];
  if (unknown.length) warns.push(`참고 시간표(${ref.date})에 없는 시간: ${unknown.join(', ')}`);
  if (oi.past || (openAt && Date.parse(openAt) <= Date.now())) warns.push('이미 열린 날짜입니다 — 시작하면 즉시 시도합니다 (남은 자리가 있어야 잡힙니다)');
  if (site !== 'naver' && (!buyer.name || !buyer.hp)) warns.push('예약자 이름/연락처가 ui/local.env(또는 환경변수 KEYESCAPE_NAME/KEYESCAPE_HP) 에 없습니다 — 자동 입력이 비게 됩니다');
  if (site === 'dps' && !buyer.dep) warns.push('단편선 입금자명(KEYESCAPE_DEP) 이 없습니다');
  if (A['final-submit'] && !form) warns.push('--final-submit 은 신청서형 사이트에서만 쓰입니다 (무시)');
  if (A['final-submit'] && form && env.finalAuto === false) warns.push(`${env.siteLabel} 은 최종 버튼 자동 클릭을 지원하지 않습니다 — 신청서 입력까지만 합니다`);
  if (env.running) warns.push(`UI 서버에 이미 실행 중인 작업이 있습니다 (pid ${env.pid}) — 동시에 1개만 됩니다`);

  const summary = {
    사이트: `${env.siteLabel} (${site})`, 지점: `${branch.name} (${branch.num})`, 테마: `${theme.name} (${theme.theme})`,
    날짜: `${date} (${dowOf(date)})`, 시간_우선순위: times.join(' → ') || '-',
    오픈: openAt ? `${kst(openAt)} · ${until(Date.parse(openAt) - Date.now())}` : '-',
    오픈_근거: [oi.openTimeSource, oi.leadSource].filter(Boolean).join(' / ') || '-',
    대기_마감: `오픈 후 ${body.deadline}초`,
    참고_시간표: `${ref.date}${ref.same ? '' : ' (같은 요일)'}: ${ref.slots.map((s) => s.time + (ref.same ? (s.open ? '○' : '×') : '')).join(' ') || '없음'}`,
    최종_버튼: form ? (body.finalSubmit ? `'${env.finalButton}' 자동 1회 (opt-in)` : `'${env.finalButton}' 은 사람이 클릭`)
      : site === 'keyescape' ? (body.autoSubmit ? "reCAPTCHA 체크박스 자동 → 문제는 사람 → 통과하면 '예약하기' 자동 1회" : "reCAPTCHA 체크박스 자동 → '예약하기'는 사람이 클릭")
        : (body.autoSubmit ? "'예약하기' 자동 (opt-in)" : '자동 제출 없음'),
    예약자_정보: site === 'naver' ? '네이버 계정' : `local.env 이름 ${buyer.name ? '있음' : '없음'} · 연락처 ${buyer.hp ? '있음' : '없음'}`,
  };
  return { body, summary, warns, env };
}

async function main() {
  if (CMD === 'status') {
    const env = await api('/api/env?site=keyescape');
    const log = await api('/api/log');
    const n = Number(A.lines || 30);
    console.log(`실행: ${env.running ? `중 (pid ${env.pid})` : env.preparing ? '준비 중' : '없음'}${env.exit ? ` · 마지막 결과: ${env.exit}` : ''}`);
    if (env.selection) console.log('대상: ' + JSON.stringify(env.selection));
    console.log(`CDP: ${env.cdp} (:${env.cdp_port})`);
    console.log('--- 최근 로그 ---\n' + (log.lines || []).slice(-n).join('\n'));
    console.log('RESULT_JSON ' + JSON.stringify({ ok: true, running: !!env.running, pid: env.pid || null, exit: env.exit || null, selection: env.selection || null, cdp: env.cdp }));
    return;
  }
  if (CMD === 'stop') {
    const r = await api('/api/stop', { method: 'POST' });
    console.log(r.ok ? '중단 요청을 보냈습니다.' : `중단할 작업이 없습니다: ${r.msg || ''}`);
    console.log('RESULT_JSON ' + JSON.stringify(r));
    return;
  }
  if (CMD !== 'plan' && CMD !== 'start') die(`알 수 없는 명령: ${CMD} (plan | start | status | stop)`);
  const { body, summary, warns, env } = await plan();
  console.log('=== 예약 스케줄 ' + (CMD === 'start' ? '시작' : '계획') + ' ===');
  for (const [k, v] of Object.entries(summary)) console.log(`${k.replace(/_/g, ' ').padEnd(8)} ${v}`);
  for (const w of warns) console.log('[WARN] ' + w);
  if (CMD === 'plan') { console.log('PLAN_JSON ' + JSON.stringify({ ok: true, body, warns })); return; }
  if (!A.yes) die('사용자 확인 후 --yes 를 붙여 다시 실행하세요 (확인 없이 예약 대기를 시작하지 않습니다)');
  if (env.running) die('이미 실행 중인 작업이 있습니다 — status 로 확인하고 필요하면 stop 후 다시 시작하세요');
  if (env.cdp !== 'OK' && !body.dry) die(`예약 브라우저(CDP :${env.cdp_port}) 가 연결되어 있지 않습니다 — ./unlock.sh 또는 sh ui/ui.sh 로 크롬을 먼저 띄우세요`);
  const r = await api('/api/run', { method: 'POST', body: JSON.stringify(body), timeout: 60000 });
  if (!r.ok) die(`시작하지 못했습니다: ${r.msg || '-'}`);
  console.log(`예약 대기를 시작했습니다 (pid ${r.pid}). 진행: node scripts/schedule.mjs status · 중단: node scripts/schedule.mjs stop`);
  console.log('RESULT_JSON ' + JSON.stringify({ ok: true, pid: r.pid, body }));
}
main().catch((e) => die(e && e.message ? e.message : String(e)));
