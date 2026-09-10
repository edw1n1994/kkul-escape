#!/usr/bin/env node
/** keyescape 왕복 지연 실측: 0.1초 목표가 물리적으로 가능한지 근거를 만든다 */
const H = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': 'https://www.keyescape.com/reservation1.php',
};
const RPC = 'https://www.keyescape.com/controller/run_proc.php';

async function once(label, url, body) {
  const t = performance.now();
  const res = await fetch(url, { method: 'POST', headers: H, body });
  await res.arrayBuffer();
  const ms = performance.now() - t;
  const ip = res.url;
  return { label, ms: Math.round(ms), status: res.status, serverTiming: res.headers.get('server-timing') || '', ip: ip.slice(25, 40) };
}

const out = [];
// 1) 커넥션 콜드(첫 요청) vs 워밍(연결 재사용)
out.push(await once('run_proc 콜드', RPC, new URLSearchParams({ t: 'get_theme_time', date: '2026-09-10', zizumNum: '18', themeNum: '57' })));
for (let i = 0; i < 4; i++) {
  out.push(await once('run_proc 워밍' + (i + 1), RPC, new URLSearchParams({ t: 'get_theme_time', date: '2026-09-10', zizumNum: '18', themeNum: '57' })));
}
// 2) reservation2 페이지 자체 (Step1 NEXT 가 만드는 POST 와 동일한 크기)
const step1body = new URLSearchParams({
  zizumNum: '18', themeNum: '57', themeInfoNum: '34', revDays: '2026-09-10', themeTimeNum: '1807',
  revTimes: '19:50', themeName: 'FILM BY EDDY',
});
out.push(await once('reservation2 POST', 'https://www.keyescape.com/reservation2.php', step1body));
out.push(await once('reservation2 POST(재사용)', 'https://www.keyescape.com/reservation2.php', step1body));

console.log('=== 왕복 지연 실측 ===');
for (const r of out) console.log('  ' + r.label.padEnd(24), String(r.ms).padStart(5) + 'ms', '| http', r.status);

const warm = out.filter((r) => r.label.includes('워밍')).map((r) => r.ms);
const post = out.filter((r) => r.label.includes('reservation2')).map((r) => r.ms);
const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
console.log('\n정리');
console.log('  슬롯 조회 1회 평균      :', avg(warm), 'ms   (오픈 감지 대기해당)');
console.log('  reservation2 로드 평균  :', avg(post), 'ms   (HTML 파싱 전 TTFB+전송)');
console.log('  → 이론 최저 합계        :', avg(warm) + avg(post), 'ms + HTML 파싱/입력');
console.log('  → 요청 2회의 TTFB 만으로도 100ms 를 초과하므로 0.1초(end-to-end) 은 불가능');
