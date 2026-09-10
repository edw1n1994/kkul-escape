/** Observe only human input; never read the CAPTCHA image or generate/fill its answer. */
export function zwArmHumanInput() {
  if (window.__ZW_INPUT_ARMED) return;
  window.__ZW_INPUT_ARMED = true;
  document.addEventListener('input', event => {
    const field = document.forms.namedItem('register')?.elements.namedItem('input_captcha');
    if (event.target !== field) return;
    // Scripted events invalidate earlier human-input evidence too.
    window.__ZW_HUMAN_INPUT = event.isTrusted ? { at: Date.now(), length: field.value.trim().length } : null;
  }, true);
}

/** Validate the intended reservation before clicking the site's normal button once. */
export function zwSubmit({ want, buyer = {}, preview = false }) {
  const fail = why => ({ ok: false, why });
  const url = new URL(location.href);
  if (url.hostname !== 'zeroworldkorea.com' || url.searchParams.get('go') !== 'rev.make') return fail('제로월드 예약 페이지가 아닙니다');
  if (window.__ZW_SUBMITTED) return fail('이미 제출됨 (중복 클릭 금지)');
  const form = document.forms.namedItem('register');
  if (!form) return fail('예약 폼 없음');
  const field = name => form.elements.namedItem(name);
  const value = name => String(field(name)?.value || '').trim();
  if (new URL(form.action, location.href).href !== 'https://zeroworldkorea.com/core/res/rev.act.php' || form.method.toLowerCase() !== 'post') return fail('예약 제출 대상 불일치');
  const input = field('input_captcha');
  const length = Number(input?.maxLength);
  if (!(length >= 1 && length <= 12) || value('input_captcha').length !== length) return fail('자동입력방지 코드 입력 대기');
  const human = window.__ZW_HUMAN_INPUT;
  if (!human || human.length !== length || Date.now() - human.at < 400 || Date.now() - human.at > 10 * 60000) return fail('사용자 입력 완료 대기');
  for (const name of ['zizum_num', 'theme_num', 'rev_days', 'theme_time_num']) {
    if (!want?.[name] || value(name) !== String(want[name])) return fail('예약좌표 불일치: ' + name);
  }
  if (!value('name') || !/^01\d-\d{3,4}-\d{4}$/.test(value('mobile'))) return fail('예약자 이름/연락처 확인 필요');
  if (buyer.name && value('name') !== String(buyer.name).trim()) return fail('예약자 이름 불일치');
  if (buyer.mobile && value('mobile') !== buyer.mobile) return fail('예약자 연락처 불일치');
  const person = field('person');
  if (!/^[1-9]\d*$/.test(value('person')) || !person?.options || ![...person.options].some(o => o.value === value('person') && !o.disabled)) return fail('인원 선택 확인 필요');
  if (buyer.person && value('person') !== String(buyer.person)) return fail('인원 불일치');
  const buttons = [...form.querySelectorAll('.rese-form__button')];
  if (buttons.length !== 1) return fail('예약 버튼 개수 확인 필요');
  const button = buttons[0];
  if (button.disabled || !button.classList.contains('is-active') || !button.getClientRects().length || button.textContent.trim() !== '예약하기') return fail('예약 버튼 비활성/대상 불일치');
  if (preview) return { ok: true, preview: true, why: '제출 조건 충족 (클릭하지 않음)' };
  window.__ZW_SUBMITTED = true;
  try { button.click(); }
  catch { return fail('예약 버튼 클릭 실패 — 중복 방지를 위해 자동 재시도하지 않습니다'); }
  return { ok: true, why: '예약하기 1회 클릭 — 코드 정답과 예약 결과는 사이트에서 확인합니다' };
}
