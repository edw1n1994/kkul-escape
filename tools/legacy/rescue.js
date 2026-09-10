/**
 * keyescape.com 개발자도구 차단 - CDP 없는 응급 해제 스니펫
 *
 * 용도: ./unlock.sh(격리 크롬) 를 못 쓰는 상황(평소 쓰는 Chrome, 원격 단말 등)에서
 *       콘솔에 바로 붙여넣어 우클릭·F12 차단을 먼저 풀고, 디텍터를 선점하는 것.
 *
 * 사용법
 *   1) 개발자도구 열기: 메뉴(⋮) → 더 많은 도구 → 개발자 도구  또는 F12
 *      (단축키가 막혀 있으면 메뉴로 연다. 이 스니펫 실행 후에는 F12 가 열린다)
 *   2) Console 에 이 파일 전체를 붙여넣고 Enter
 *   3) 북마크릿으로 쓰려면 아래 한 줄을 북마크 URL 로 저장 → 페이지에서 클릭
 *      javascript:(function(){var n=function(){};try{Object.defineProperty(window,'devtoolsDetector',{value:{addListener:n,removeListener:n,launch:n,stop:n,setLogger:n,isDevToolsOpened:function(){return false},isDevToolsCmdKeyHotkey:function(){return false}},configurable:false,writable:false})}catch(e){}try{Object.defineProperty(document,'onkeydown',{set:n,get:function(){return null},configurable:true})}catch(e){document.onkeydown=null}document.addEventListener('contextmenu',function(e){e.stopImmediatePropagation()},true);return 'unlocked'})();
 *
 * 한계 (정직하게)
 *   - 디텍터가 이미 body 를 검은 화면으로 교체한 뒤라면 복구하지 못한다 → 새로고침 후 먼저 실행.
 *   - 사이트 스크립트 "전에" 실행되는 것이 정석이다. 그러려면 확장(exp/) 설치 또는 ./unlock.sh 가 필요하다.
 *     이 스니펫은 사후 조치라, 디텍터가 주기 검사 중이면 그 시점부터는 무력화된다.
 */
(function () {
  'use strict';
  var noop = function () {};

  // 1) devtools-detector 선점 (이미 로드됐더라도 이후 launch()/검사 호출은 무동작)
  var dummy = {
    addListener: noop, removeListener: noop, launch: noop, stop: noop, setLogger: noop,
    isDevToolsOpened: function () { return false; },
    isDevToolsCmdKeyHotkey: function () { return false; }
  };
  try {
    Object.defineProperty(window, 'devtoolsDetector', { value: dummy, configurable: false, writable: false });
  } catch (e) {
    try { window.devtoolsDetector = dummy; } catch (e2) {
      // 이미 읽기 전용으로 설치된 상태(우리가 먼저 선점했거나 사이트가 freeze 한 경우) -> 필드만 무력화
      var d = window.devtoolsDetector;
      if (d) {
        ['addListener', 'removeListener', 'launch', 'stop', 'setLogger'].forEach(function (k) {
          try { d[k] = noop; } catch (e3) {}
        });
        try { Object.defineProperty(d, 'isDevToolsOpened', { value: function () { return false; }, configurable: true }); } catch (e4) {}
        try { d.stop && d.stop(); } catch (e5) {}
      }
    }
  }

  // 2) 키 차단 해제: 사이트는 document.onkeydown 에 함수를 대입한다
  try {
    Object.defineProperty(document, 'onkeydown', { set: noop, get: function () { return null; }, configurable: true });
  } catch (e) { document.onkeydown = null; }

  // 3) 우클릭: 사이트 핸들러보다 먼저 잡아 전파를 끊는다 (이미 등록된 핸들러도 무력화)
  document.addEventListener('contextmenu', function (e) { e.stopImmediatePropagation(); }, true);

  var ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  (document.body || document.documentElement).dispatchEvent(ev);
  var st = '디텍터=' + (window.devtoolsDetector.addListener.name === 'noop' ? '선점됨' : '미선점') +
           ' / 키차단=' + (typeof document.onkeydown === 'function' ? '여전' : '해제') +
           ' / 우클릭=' + (ev.defaultPrevented ? '여전' : '해제');
  console.log('[keyescape unlock]', st);
  return st;
})();
