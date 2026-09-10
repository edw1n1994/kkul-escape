#!/usr/bin/env node
/**
 * keyescape 예약 Step1 데이터 조회 클라이언트 (읽기 전용)
 *
 *   node probe.mjs branches
 *   node probe.mjs themes  <zizumNum>
 *   node probe.mjs times   <zizumNum> <themeNum> [YYYY-MM-DD]
 *   node probe.mjs all     [YYYY-MM-DD]        # 지점->테마->시간대 전체 매트릭스, mapping.json 저장
 *
 * 실제 페이지가 쓰는 엔드포인트와 동일하게 POST 한다 (읽기 호출만 사용).
 */
import fs from 'node:fs';

const BASE = 'https://www.keyescape.com/controller/run_proc.php';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const HERE = new URL('.', import.meta.url).pathname;

// reservation1.php 의 #zizum 옵션 그대로
const BRANCHES = [
  [26, '에버랜드'], [23, '후즈데어'], [22, 'STATION'], [19, 'LOG_IN 1'], [20, 'LOG_IN 2'],
  [18, '메모리컴퍼니'], [16, '우주라이크'], [14, '더오름'], [3, '강남점'], [10, '홍대점'],
  [9, '부산점'], [7, '전주점'], [25, '무비무드'], [29, '무비무드 전주'],
];

async function rpc(t, params = {}) {
  const body = new URLSearchParams({ t, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://www.keyescape.com/reservation1.php',
    },
    body,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: false, raw: text.slice(0, 200) }; }
}

const themeList = (zizumNum) => rpc('get_theme_info_list', { zizum_num: zizumNum });
const themeDate = (infoNum) => rpc('get_theme_date', { num: infoNum });
const themeTime = (zizumNum, themeNum, date) => rpc('get_theme_time', { date, zizumNum, themeNum });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (s, n) => String(s).padEnd(n);
const hhmm = (i) => `${i.hh}:${i.mm}`;

const cmd = process.argv[2] || 'branches';

if (cmd === 'branches') {
  for (const [num, name] of BRANCHES) {
    const d = await themeList(num);
    const n = d.status ? d.data.length : 0;
    console.log(`${pad(num, 4)} ${pad(name, 14)} 테마 ${n}개`);
    await sleep(120);
  }
}

if (cmd === 'themes') {
  const z = Number(process.argv[3]);
  const d = await themeList(z);
  if (!d.status) { console.error('조회 실패', d); process.exit(1); }
  console.log(`지점 ${z} 테마 목록  (themeInfoNum=option value, themeNum=data-themenum)`);
  console.log(pad('infoNum', 9) + pad('themeNum', 10) + pad('doing', 7) + '테마명');
  for (const it of d.data) console.log(pad(it.info_num, 9) + pad(it.theme_num, 10) + pad(it.doing, 7) + it.info_name);
}

if (cmd === 'times') {
  const z = Number(process.argv[3]); const th = Number(process.argv[4]);
  let date = process.argv[5];
  if (!date) {
    const lt = await themeList(z);
    const info = (lt.data || []).find((i) => Number(i.theme_num) === th);
    if (!info) { console.error(`지점 ${z} 에 테마 ${th} 없음`); process.exit(1); }
    const c = await themeDate(info.info_num);
    date = c.calendarData?.today;
    if (!date) { console.error('serverToday 응답 없음'); process.exit(1); }
  }
  const d = await themeTime(z, th, date);
  console.log(`지점${z} 테마${th} ${date}`);
  if (!d.status) { console.error('실패:', d.msg || d); process.exit(1); }
  for (const i of d.data) console.log(`value=${pad(i.num, 7)} ${hhmm(i)}  ${i.enable === 'N' ? '마감/비활성' : '선택가능'}  ${i.sale_txt || ''}`);
}

if (cmd === 'all') {
  const out = { generatedAt: new Date().toISOString(), forcedDate: process.argv[3] || null, branches: [] };
  for (const [zNum, zName] of BRANCHES) {
    const list = await themeList(zNum);
    const branch = { zizumNum: zNum, name: zName, themes: [] };
    if (!list.status) { out.branches.push(branch); await sleep(120); continue; }

    for (const it of list.data) {
      const cal = await themeDate(it.info_num);
      const today = cal.calendarData?.today || null;
      const date = out.forcedDate || today;
      const t = {
        themeInfoNum: it.info_num, themeNum: it.theme_num, doing: it.doing,
        name: it.info_name, serverToday: today,
        calendar: cal.calendarData ? { today, daysInMonth: cal.calendarData.days_in_month, firstDayOfMonth: cal.calendarData.first_day_of_month } : null,
        queryDate: date, times: [],
      };
      if (date) {
        const tt = await themeTime(zNum, it.theme_num, date);
        t.timeStatus = tt.status; t.timeMsg = tt.msg || '';
        t.times = (tt.data || []).map((i) => ({ value: i.num, time: hhmm(i), enable: i.enable, sale: i.sale_txt || '' }));
      }
      branch.themes.push(t);
      console.log(`지점 ${zNum} ${pad(zName, 12)} | themeInfoNum=${pad(it.info_num, 4)} themeNum=${pad(it.theme_num, 4)} doing=${pad(it.doing, 3)} | ${pad(it.info_name, 26)} | ${date} 시간 ${t.times.length}개`);
      await sleep(140);
    }
    out.branches.push(branch);
    await sleep(120);
  }
  fs.writeFileSync(HERE + 'mapping.json', JSON.stringify(out, null, 2));
  console.log('\nmapping.json 저장 완료');
}
