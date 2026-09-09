/**
 * keyescape.com 의 개발자도구 차단을 무력화하는 스크립트.
 * CDP 의 Page.addScriptToEvaluateOnNewDocument 로 "페이지 스크립트 실행 전"에 주입된다.
 *
 * 사이트 측 로직(reservation1.php 하단 인라인 스크립트):
 *   1) document.addEventListener('contextmenu', e => e.preventDefault())   : 우클릭 차단
 *   2) devtoolsDetector.addListener(...) + launch()                        : DevTools 감지 시 body 를 검은 화면으로 교체
 *   3) document.onkeydown = ...                                            : F12 / Cmd+Shift+I,J,C / Cmd+U 차단
 */
(function () {
  'use strict';
  var noop = function () {};

  // 1) devtools-detector 를 더미 객체로 선점 -> 감지 자체가 동작하지 않음
  try {
    Object.defineProperty(window, 'devtoolsDetector', {
      value: {
        addListener: noop,
        removeListener: noop,
        launch: noop,
        stop: noop,
        setLogger: noop,
        isDevToolsOpened: function () { return false; },
        isDevToolsCmdKeyHotkey: function () { return false; }
      },
      configurable: false,
      writable: false
    });
  } catch (e) {
    try { window.devtoolsDetector = window.devtoolsDetector || {}; } catch (e2) {}
  }

  // 2) 우클릭 차단 무력화
  //    사이트는 document 의 버블 단계에서 contextmenu 를 잡는다.
  //    캡처 단계에서 한 발 먼저 stopImmediatePropagation 하면 사이트 핸들러는 실행되지 않는다.
  document.addEventListener('contextmenu', function (e) {
    e.stopImmediatePropagation();
  }, true);

  // 3) 키보드 차단기 등록 자체를 무효화
  //    사이트는 document.onkeydown 에 함수를 "대입"하므로, setter 를 no-op 로 바꿔두면 등록되지 않는다.
  try {
    Object.defineProperty(document, 'onkeydown', {
      set: noop,
      get: function () { return null; },
      configurable: true
    });
  } catch (e) {}
})();
