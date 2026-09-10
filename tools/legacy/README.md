# 초기 실험·진단 도구

루트에 흩어져 있던 독립 스크립트를 원형에 가깝게 보관한 폴더입니다.
현재 앱의 실행 엔진은 `../../ui/runner.mjs`이며, 이 폴더는 앱·Docker 배포에 포함되지 않습니다.

- `probe.mjs`, `mapping.json`, `summary.mjs`, `SUMMARY.txt`: 과거 지점·테마·시간표 조사
- `flow.mjs`, `reserve-*.mjs`, `step1*`: 초기 예약 흐름 실험
- `check-*`, `inspect-*`, `verify.mjs`, `smoke-test.mjs`: 화면·연결 진단
- `console-fill.js`, `rescue.js`, `unlock.js` 등: 당시 브라우저 주입 스크립트
- `start.sh`, `load-ext.mjs`: 초기 Chrome·확장 기동 도구

파일별 주석의 명령은 이 폴더에서 실행하는 기준입니다. 과거 고정 날짜·좌표가
남아 있고 실제 페이지에 입력하거나 클릭하는 도구도 있으므로 일괄 실행하지 않습니다.
기존 루트 로그·스크린샷은 `../../.local/legacy/`에 보관했습니다.
