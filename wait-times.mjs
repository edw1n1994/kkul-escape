#!/usr/bin/env node
/**
 * 특정 시각(OPEN_AT)까지 기다렸다가, 그 뒤 성공할 때까지 재시도하며 시간대를 수집한다.
 *   OPEN_AT='2026-09-04T10:30:20+09:00' node wait-times.mjs 18 57 2026-09-10
 * 결과: times-<지점>-<테마>-<날짜>.json + 콘솔 출력 + wait-times.log
 */
import fs from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;
const [Z, T, D] = [process.argv[2] || '18', process.argv[3] || '57', process.argv[4] || '2026-09-10'];
const DEADLINE_MIN = Number(process.env.DEADLINE_MIN || 40);

const log = (...a) => {
  const l = `[${new Date().toLocaleTimeString('ko-KR')}] ${a.join(' ')}`;
  console.log(l); fs.appendFileSync(HERE + 'wait-times.log', l + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function times() {
  const res = await fetch('https://www.keyescape.com/controller/run_proc.php', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://www.keyescape.com/reservation1.php',
    },
    body: new URLSearchParams({ t: 'get_theme_time', date: D, zizumNum: Z, themeNum: T }),
  });
  return res.json();
}

const OPEN_AT = process.env.OPEN_AT;
if (OPEN_AT) {
  const at = new Date(OPEN_AT).getTime();
  if (at > Date.now()) { log(`대기: ${OPEN_AT} (=${Math.round((at - Date.now()) / 1000)}초)`); await sleep(at - Date.now() + 500); }
}

const t0 = Date.now();
for (let n = 1; (Date.now() - t0) / 60000 < DEADLINE_MIN; n++) {
  const d = await times();
  if (d.status && (d.data || []).length) {
    const rows = d.data.map((i) => ({ value: i.num, time: `${i.hh}:${i.mm}`, enable: i.enable, sale: i.sale_txt || '' }));
    const file = HERE + `times-${Z}-${T}-${D}.json`;
    fs.writeFileSync(file, JSON.stringify({ zizum: Z, theme: T, date: D, fetchedAt: new Date().toISOString(), rows }, null, 2));
    log(`성공 (${n}차) -> ${file}`);
    for (const r of rows) log(`  ${r.time}  value=${String(r.value).padEnd(6)} ${r.enable === 'N' ? '마감' : '선택가능'} ${r.sale}`);
    log('선택가능 합계: ' + rows.filter((r) => r.enable !== 'N').length + ' / ' + rows.length);
    process.exit(0);
  }
  log(`${n}차 실패: ${d.msg || '응답 없음'} -> 30초 후 재시도`);
  await sleep(30000);
}
log('기한 초과로 종료');
process.exit(2);
