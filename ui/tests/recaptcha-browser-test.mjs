// Local fixture only: no request to Keyescape or Google, no real CAPTCHA challenge.
import http from 'node:http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { cdp, sleep } from '../lib.mjs';
import { createRecaptchaClicker, recaptchaHostPage } from '../recaptcha-click.mjs';
const want = { zizum_num: '1', theme_num: '2', theme_info_num: '3', rev_days: '2030-09-17', theme_time_num: '4' };
let frameOrigin;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/anchor') res.end(`<!doctype html><style>body{margin:0}#recaptcha-anchor{position:absolute;left:12px;top:14px;width:28px;height:28px;background:#ddd}</style><div id="recaptcha-anchor" role="checkbox" aria-checked="false" class="recaptcha-checkbox-unchecked"></div><script>document.querySelector('#recaptcha-anchor').onclick=e=>{parent.postMessage({fixtureClicked:true,trusted:e.isTrusted},'*');e.currentTarget.setAttribute('aria-checked','true')}</script>`);
  else res.end(`<!doctype html><style>body{padding:180px 60px}iframe{border:2px solid #888;transform:scale(1.15);transform-origin:top left}</style><form id="form">${Object.entries(want).map(([k,v]) => `<input type="hidden" name="${k}" value="${v}">`).join('')}<textarea name="g-recaptcha-response" hidden></textarea></form><iframe src="${frameOrigin}/anchor" width="304" height="78"></iframe><script>window.clicks=0;window.trusted=false;onmessage=e=>{if(e.data.fixtureClicked){window.clicks++;window.trusted=e.data.trusted}}</script>`);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const port = server.address().port, origin = `http://127.0.0.1:${port}`;
const browser = `http://127.0.0.1:${Number(process.env.CDP_PORT || 9222)}`;
try {
  for (const separate of [false, true]) {
    frameOrigin = separate ? `http://localhost:${port}` : origin;
    let tab, c;
    try {
      tab = await fetch(browser + '/json/new?about%3Ablank', { method: 'PUT' }).then(r => r.json());
      c = cdp(tab.webSocketDebuggerUrl); await c.ready;
      await c.send('Page.enable'); await c.send('Page.navigate', { url: origin }); await sleep(600);
      // Map fixture URLs only in the host guard's lexical scope. Production validation is unchanged.
      const transport = { ...c, async send(method, params) { try { return await c.send(method, params); } catch (e) { if (process.env.DEBUG_FRAME) console.log(method, e.message); throw e; } }, evaluate(expression) {
        if (expression.startsWith(`(${recaptchaHostPage.toString()})`)) return c.evaluate(`(()=>{const location={href:'https://www.keyescape.com/reservation2.php'};class URL extends globalThis.URL{constructor(value){super(value===${JSON.stringify(frameOrigin + '/anchor')}?'https://www.google.com/recaptcha/api2/anchor':value)}}return ${expression}})()`);
        return c.evaluate(expression);
      } };
      if (separate && process.env.DEBUG_FRAME) {
        const { root } = await c.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await c.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'iframe' });
        const { node } = await c.send('DOM.describeNode', { nodeId });
        console.log('iframe', node.frameId, node.contentDocument?.frameId);
        console.log('targets', (await c.send('Target.getTargets')).targetInfos.filter(t => t.url.startsWith(frameOrigin)).map(t => ({ id: t.targetId, type: t.type, url: t.url })));
      }
      const click = createRecaptchaClicker(transport, want);
      let result;
      for (let i = 0; i < 10; i++) { result = await click(); if (result.state !== 'waiting') break; await sleep(150); }
      assert.equal(result.state, 'clicked', JSON.stringify(result)); await sleep(100);
      await click(); await createRecaptchaClicker(transport, want)();
      assert.equal(await c.evaluate('window.clicks'), 1);
      assert.equal(await c.evaluate('window.trusted'), true);
      assert.equal(await c.evaluate('document.querySelector("textarea").value'), '');
      console.log(`PASS ${separate ? 'cross-site' : 'same-site'} iframe: scaled coordinates, trusted mouse input, exactly one click, no token mutation`);
    } finally { c?.ws.close(); if (tab) await fetch(browser + '/json/close/' + tab.id).catch(() => {}); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
