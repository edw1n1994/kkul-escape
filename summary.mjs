#!/usr/bin/env node
/** mapping.json 을 사람이 읽기 좋은 표로 정리 + 시간대 value 샘플 출력 */
import fs from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;
const m = JSON.parse(fs.readFileSync(HERE + 'mapping.json', 'utf8'));
const L = [];
L.push('기준일(serverToday) = ' + (m.branches[0]?.themes[0]?.serverToday || '?'));
L.push('');
for (const b of m.branches) {
  L.push(`### 지점 ${b.zizumNum}  ${b.name}   [테마 ${b.themes.length}개]`);
  if (!b.themes.length) L.push('   (테마 없음 / 예약 미오픈)');
  for (const t of b.themes) {
    const open = t.times.filter((x) => x.enable !== 'N').length;
    L.push(`   themeNum=${String(t.themeNum).padEnd(4)} themeInfoNum=${String(t.themeInfoNum).padEnd(4)} doing=${String(t.doing).padEnd(3)} ${t.name.padEnd(26)} ${t.queryDate} 가능 ${open}/${t.times.length}`);
  }
  L.push('');
}
L.push('=== 시간대 value 샘플 (지점/테마/날짜별 themeTimeNum) ===');
for (const b of m.branches.slice(0, 4)) {
  for (const t of (b.themes || []).slice(0, 1)) {
    L.push(`\n지점 ${b.zizumNum} ${b.name} / themeNum ${t.themeNum} ${t.name} / ${t.queryDate}`);
    L.push('   ' + t.times.map((x) => `${x.time}=${x.value}${x.enable === 'N' ? '(마감)' : ''}`).join('  '));
  }
}
L.push('\n전체 데이터는 mapping.json 에 지점/테마/시간별로 전부 들어 있음');
fs.writeFileSync(HERE + 'SUMMARY.txt', L.join('\n'));
console.log(L.join('\n'));
