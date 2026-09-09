#!/usr/bin/env node
/**
 * 키이스케이프 예약 사격대 UI 서버 (의존성 없음)
 *
 *   node server.mjs            → http://127.0.0.1:8899
 *   PORT=9000 CDP_PORT=9333 node server.mjs
 *
 * API
 *  GET  /api/env      CDP/탭/서버기준일 상태
 *  GET  /api/themes   ?zizum=18                     지점의 테마 목록(이름으로 고르기용)
 *  GET  /api/slots    ?zizum&theme&date             그 날짜의 시간대 + enable
 *  GET  /api/matrix   ?zizum&theme&info&days=14     날짜별 가능 개수(오픈 창 파악)
 *  GET  /api/step2    reservation2 현재 상태 (읽기 전용)
 *  POST /api/run      {zizum,theme,info,date,times,tname,openAt,deadline,person,name,hp}
 *  POST /api/stop     실행 중단
 *  GET  /api/log      최근 로그 링버퍼
 *  GET  /api/events   SSE 실시간 로그
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BRANCHES, getThemes, getTimes, getCalendar, cdpList, cdp, keTab, STEP2_READ, openInfo, noteWindow, personal } from './lib.mjs';
import { siteOf, SITES, zwThemes, apiTimes, apiOpenInfo, apiBranches, apiToday, siteTab, ZW_READ } from './sites.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8899);
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const MAXRUN_LOG = 800;

/* ------- 실행은 동시 1개 (같은 브라우저 탭을 쓰기 때문에 병렬 금지) ------- */
const run = { child: null, startedAt: 0, lines: [], exit: null, args: null, exitCode: null };
const sse = new Set();

const broadcast = (obj) => {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sse) { try { res.write(payload); } catch { sse.delete(res); } }
};

function pushLine(line) {
  if (!line) return;
  run.lines.push(line);
  if (run.lines.length > MAXRUN_LOG) run.lines.splice(0, run.lines.length - MAXRUN_LOG);
  broadcast({ t: new Date().toISOString().slice(11, 23), line });
  fs.appendFile(path.join(HERE, 'runs.log'), `[${new Date().toISOString()}] ${line}\n`, () => {});
}

function startRun(body) {
  if (run.child) return { ok: false, msg: '이미 실행 중입니다. 먼저 [중단] 하세요.' };
  const site = siteOf(body.site).key;
  const need = ['zizum', 'theme', 'date'];
  if (siteOf(site).needsInfo) need.push('info');
  if (!body.dry) need.push('times');
  const miss = need.filter((k) => !body[k]);
  if (miss.length) return { ok: false, msg: '필요 값 부족: ' + miss.join(', ') };
  const args = [
    path.join(HERE, 'runner.mjs'),
    '--site', site,
    '--zizum', String(body.zizum), '--theme', String(body.theme), '--info', String(body.info || body.theme),
    '--date', String(body.date), '--tname', String(body.tname || ''),
    '--port', String(Number(body.cdp || CDP_PORT)),
    '--deadline', String(Number(body.deadline || 60)),
    '--agrees', String(body.agrees || siteOf(site).agrees.join(',')),
  ];
  // 예약자 이름/연락처는 하드코딩하지 않는다: 요청 본문 → 환경변수 → ui/local.env 순으로 해석한다
  const pname = personal('KEYESCAPE_NAME', body.name);
  const php = personal('KEYESCAPE_HP', body.hp);
  if (pname) args.push('--name', pname);
  if (php) args.push('--hp', php);
  if (body.times) args.push('--times', String(body.times));
  if (body.openAt) args.push('--open-at', new Date(String(body.openAt)).toISOString());
  if (body.person) args.push('--person', String(body.person));
  if (body.autoSubmit) args.push('--auto-submit');   // 캡차 통과 후 '예약하기' 자동 클릭 (기본 off)
  if (body.watchOnly) args.push('--watch-only');     // 디버거 미연결 감시 전용 (차단과 무관하게 동작)
  if (body.dry) args.push('--dry');

  run.lines = []; run.exit = null; run.startedAt = Date.now(); run.args = args.slice(1);
  const child = spawn(process.execPath, args, { cwd: HERE, env: process.env });
  run.child = child;
  let buf = '';
  const onData = (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) > -1) { pushLine(buf.slice(0, i).trimEnd()); buf = buf.slice(i + 1); }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code, sig) => {
    run.exitCode = code;
    run.exit = sig ? `신호 ${sig}` : code === 0 ? '성공 종료' : `종료 코드 ${code}`;
    pushLine('[EXIT] ' + run.exit);
    broadcast({ event: 'exit', code });
    run.child = null;
  });
  return { ok: true, pid: child.pid, args: run.args };
}

/* ---------------- HTTP ---------------- */
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const qs = (raw) => Object.fromEntries(new URL(raw, 'http://x').searchParams);
const nap = (ms) => new Promise((x) => setTimeout(x, ms));

/** 자식 node 스크립트를 1회 실행하고 stdout/stderr 을 한데 모아 돌려준다 (차단 검사/복구용) */
function runNode(script, args = [], cwd = HERE, ms = 30000, env = {}) {
  return new Promise((res) => {
    const c = spawn(process.execPath, [path.isAbsolute(script) ? script : path.join(cwd, script), ...args], { cwd, env: { ...process.env, ...env } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    const t = setTimeout(() => c.kill('SIGKILL'), ms);
    c.on('exit', (code) => { clearTimeout(t); res({ code, out }); });
  });
}

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const a = qs(req.url);
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(path.join(HERE, 'public', 'index.html')));
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': ready\n\n');
      for (const l of run.lines.slice(-200)) res.write(`data: ${JSON.stringify({ t: '', line: l })}\n\n`);
      const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { clearInterval(beat); } }, 15000);
      sse.add(res);
      req.on('close', () => { clearInterval(beat); sse.delete(res); });
      return;
    }
    if (p === '/api/env') {
      const site = siteOf(a.site);
      const list = await cdpList(Number(a.cdp) || CDP_PORT);
      const cal = site.key === 'keyescape' ? await getCalendar(Number(a.info) || 34).catch(() => null) : null;
      return json(res, 200, {
        site: site.key, siteLabel: site.label, captcha: site.captcha, siteNote: site.note,
        sites: Object.values(SITES).map((s) => ({ key: s.key, label: s.label, captcha: s.captcha })),
        cdp: list ? 'OK' : 'DOWN', cdp_port: Number(a.cdp) || CDP_PORT,
        tabs: list ? list.filter((t) => t.type === 'page').map((t) => t.url.slice(0, 100)) : [],
        serverToday: await apiToday(site.key, a.info),
        serverMsg: cal?.data?.doc_time || '',
        branches: (await apiBranches(site.key)).map(([num, name]) => ({ num, name })),
        running: !!run.child, exit: run.exit, pid: run.child?.pid || null,
      });
    }
    if (p === '/api/themes') {
      if (siteOf(a.site).key === 'zeroworld') {
        const r = await zwThemes(Number(a.zizum));
        return json(res, 200, { ok: r.ok, themes: r.themes, msg: r.msg });
      }
      const d = await getThemes(Number(a.zizum));
      if (!d.status) return json(res, 200, { ok: false, msg: d.msg || '조회 실패', themes: [] });
      const themes = [];
      for (const i of d.data) {
        // 난이도/장르/러닝타임 은 get_theme_date 에만 있다 (테마당 1회, 얇게 간격 두고)
        const c = await getCalendar(Number(i.info_num)).catch(() => ({}));
        themes.push({
          info: i.info_num, theme: i.theme_num, name: (i.info_name || '').trim(), doing: i.doing,
          level: c?.data?.level || '', genre: c?.data?.genre || '', play: c?.data?.play_time || '',
          notice: c?.data?.doc_time || '',
        });
        await nap(110);
      }
      return json(res, 200, { ok: true, themes });
    }
    if (p === '/api/slots') {
      const r = await apiTimes(a.site, Number(a.zizum), Number(a.theme), a.date);
      return json(res, 200, { ...r, date: a.date });
    }
    if (p === '/api/openinfo') {
      // 선택한 날짜가 "언제 예약 열리는지" 를 알려준다 (KE: reservation.php 오픈 시각 + 슬롯 스캔 / ZW: 오픈시간 문구 + 첫 미오픈 날짜)
      const oi = await apiOpenInfo(a.site, { zizum: a.zizum, theme: a.theme, info: a.info, date: a.date });
      return json(res, 200, oi);
    }
    if (p === '/api/matrix') {
      const site = siteOf(a.site).key;
      const days = Math.min(31, Number(a.days) || 10);
      // 서버 기준일은 KST 달력 문자열. toISOString 은 9시간 밀리므로 UTC 자정 기준으로 계산한다.
      const today = await apiToday(site, a.info);
      const startUTC = Date.parse(today + 'T00:00:00Z');
      const out = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(startUTC + i * 86400000).toISOString().slice(0, 10);
        const r = await apiTimes(site, Number(a.zizum), Number(a.theme), d);
        out.push({ date: d, dow: '일월화수목금토'[new Date(d + 'T00:00:00Z').getUTCDay()], open: r.slots.filter((s) => s.open).length, total: r.slots.length, msg: r.msg || '' });
        await nap(110);
      }
      if (site === 'keyescape') {   // 오픈 창 기억 → /api/openinfo 가 재스캔 없이 답함 (제로월드는 문구 기반이라 불필요)
        const cal = await getCalendar(Number(a.info)).catch(() => null);
        if (cal?.status) noteWindow(Number(a.zizum), Number(a.theme), Number(a.info), cal.calendarData.today, out);
      }
      return json(res, 200, { ok: true, site, serverToday: today, days: out });
    }
    if (p === '/api/step2') {
      const site = siteOf(a.site);
      const t = site.key === 'zeroworld'
        ? await siteTab(Number(a.cdp) || CDP_PORT, 'zeroworld', a.zizum, false)
        : await keTab(Number(a.cdp) || CDP_PORT, null, false);
      if (!t.ok) return json(res, 200, { ok: false, msg: t.msg });
      const c = cdp(t.tab.webSocketDebuggerUrl);
      try {
        await c.ready;
        await c.send('Runtime.enable');
        const st = await c.evaluate(site.key === 'zeroworld' ? ZW_READ : STEP2_READ);
        return json(res, 200, { ok: true, site: site.key, ...st });
      } catch (e) { return json(res, 200, { ok: false, msg: String(e.message) }); }
      finally { c.ws.close(); }
    }
    if (p === '/api/log') return json(res, 200, { running: !!run.child, exit: run.exit, lines: run.lines });
    if (p === '/api/unlock') {
      const port = String(Number(a.cdp) || CDP_PORT);
      if (req.method === 'POST') {
        // --reload: 이미 검은화면(wiped)으로 바뀐 탭은 재주입만으로는 못 돌아온다.
        //           새로고침해야 document_start 주입이 사이트 스크립트보다 먼저 돈다.
        const r = await runNode('../unlock.mjs', ['--quiet', '--reload', 'https://www.keyescape.com/reservation1.php'], HERE, 60000, { CDP_PORT: port });
        // 리로드가 끝나기 전에 검사하면 더미가 없는 것처럼 보인다 → 최대 24초까지 재확인
        let j = null;
        for (let i = 0; i < 8; i++) {
          const after = await runNode('unlock-status.mjs', [port], HERE, 25000, { CDP_PORT: port });
          try { j = JSON.parse(after.out); } catch {}
          if (j && j.allUnlocked) break;
          await new Promise((r2) => setTimeout(r2, 3000));
        }
        return json(res, 200, { fixed: true, code: r.code, log: r.out.split('\n').slice(0, 30), ...(j || { ok: false, msg: '재검사 파싱 실패' }) });
      }
      const r = await runNode('unlock-status.mjs', [port], HERE, 25000, { CDP_PORT: port });
      let j = null; try { j = JSON.parse(r.out); } catch {}
      return json(res, 200, j || { ok: false, msg: '검사 출력 파싱 실패', raw: r.out.slice(0, 300) });
    }
    if (p === '/api/run' && req.method === 'POST') {
      let b = ''; req.on('data', (d) => (b += d));
      req.on('end', () => {
        let body = {}; try { body = JSON.parse(b || '{}'); } catch {}
        const r = startRun(body);
        json(res, 200, r);
      });
      return;
    }
    if (p === '/api/stop' && req.method === 'POST') {
      if (!run.child) return json(res, 200, { ok: false, msg: '실행 중인 작업 없음' });
      run.child.kill('SIGTERM');
      pushLine('[STOP] 사용자 중단 요청');
      return json(res, 200, { ok: true });
    }
    json(res, 404, { ok: false, msg: 'no route: ' + p });
  } catch (e) {
    json(res, 500, { ok: false, msg: String(e && e.message || e) });
  }
});

// BIND: 기본 127.0.0.1 (노트북 로컬 전용이 원칙). 컨테이너 안에서 포트맵을 쓰려면 BIND=0.0.0.0
const BIND = process.env.BIND || '127.0.0.1';
server.listen(PORT, BIND, () => {
  console.log(`키이스케이프/제로월드 사격대 UI  →  http://${BIND === '0.0.0.0' ? '127.0.0.1' : BIND}:${PORT}/   (CDP :${CDP_PORT})`);
});

