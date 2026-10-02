// Local API fixtures only: no site traffic, reservation, login or payment.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { once } from 'node:events';
import { cdp, sleep } from '../lib.mjs';
const files = new URL('../public/', import.meta.url);
const sites = [{key:'keyescape',label:'키이스케이프'},{key:'zeroworld',label:'제로월드'},{key:'dps',label:'단편선'},{key:'naver',label:'네이버 예약'},{key:'rhe',label:'방탈출 토끼굴'}];
const fixture = { naverBank:true, unlock:{cdp:'OK',count:0,allUnlocked:true}, unlockPosts:0, unlockReads:0, unlockFail:false, running:false, connected:true, logged:true, fail:false, calls:[], selection:null, streams:new Set() };
const server = http.createServer(async (req,res) => {
 const url=new URL(req.url,'http://local'), site=url.searchParams.get('site')||'naver';
 const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(['index.html','classic.html','app.js','guided.js','guided.css'].includes(name)) {res.setHeader('content-type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');return res.end(fs.readFileSync(new URL(name,files)));}
 const json=data=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
 if(url.pathname==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(':ready\n\n');fixture.streams.add(res);req.on('close',()=>fixture.streams.delete(res));return;}
 if(url.pathname==='/api/env')return json({site,sites,cdp:fixture.connected?'OK':'DOWN',desktop:true,cdp_port:1,serverToday:'2099-09-10',deposit:site==='dps',naverBank:fixture.naverBank,branches:[{num:'1',name:'테스트 지점'}],running:fixture.running,selection:fixture.selection,exit:null});
 if(url.pathname==='/api/themes')return json({ok:true,themes:[{theme:'2',info:'3',name:'테스트 테마'}]});
 if(url.pathname==='/api/matrix')return json({ok:true,days:[{date:'2099-09-17',dow:'목',total:0,past:false}]});
 if(url.pathname==='/api/slots')return json({ok:true,slots:[{num:4,time:'19:20',open:true}]});
 if(url.pathname==='/api/openinfo')return json({ok:true,openAt:'2099-09-11T00:00:00+09:00',openDate:'2099-09-11',openTime:'00:00',msUntil:1000000});
 if(url.pathname==='/api/login')return json({ok:true,required:['naver','dps'].includes(site),loggedIn:fixture.logged,msg:'테스트 로그인'});
 if(url.pathname==='/api/step2')return json({ok:false,msg:'아직 예약창 없음'});
 if(url.pathname==='/api/unlock'){
  if(req.method==='POST'){
   fixture.unlockPosts++;await sleep(100);
   if(fixture.unlockFail){res.statusCode=409;return json({ok:false,msg:'테스트 활성화 실패'});}
   fixture.unlock={cdp:'OK',count:1,allUnlocked:true};return json({fixed:true,...fixture.unlock});
  }
  fixture.unlockReads++;return json(fixture.connected?fixture.unlock:{cdp:'DOWN',count:0,allUnlocked:false});
 }
 if(url.pathname==='/api/run'){
  let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);fixture.calls.push(data);
  if(fixture.fail)return json({ok:false,msg:'테스트 연결 실패'});
  fixture.running=true;fixture.selection=data;return json({ok:true,pid:123});
 }
 if(url.pathname==='/api/stop'){fixture.running=false;return json({ok:true});}
 if(url.pathname==='/api/log')return json({running:fixture.running,lines:[]});
 return json({ok:true});
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port,host='http://127.0.0.1:'+(process.env.CDP_PORT||9222);
let tab,c;
try{
 tab=await (await fetch(host+'/json/new?about%3Ablank',{method:'PUT'})).json();c=cdp(tab.webSocketDebuggerUrl);await c.ready;await c.send('Page.enable');await c.send('Runtime.enable');
 await c.send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('ke.site','naver');window.confirm=()=>true;"});
 const ev=s=>c.evaluate(s), click=sel=>ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
 const wait=async expr=>{for(let i=0;i<100;i++){if(await ev(expr).catch(()=>false))return;await sleep(40);}throw Error('Timeout: '+expr);};
 await c.send('Page.navigate',{url:origin});await wait("typeof window.bookingUI==='object' && document.querySelector('.chip') && OPEN_ISO");
 for(const {key} of sites){
  await ev(`setSite(${JSON.stringify(key)})`);await wait("!!document.querySelector('.chip') && !!OPEN_ISO");
  await ev('loadEnv()');await ev('checkLogin(true)');
  if(key==='keyescape'){
   await ev('checkLock(true)');assert.equal(await ev("$('developerStatus').dataset.state"),'no-tab');
   assert.equal(await ev("$('developerControls').hidden"),false);
   assert.equal(await ev("$('enableDeveloper').closest('.browser-actions').contains($('prepareBrowser'))"),true);
   fixture.unlockFail=true;await click('#enableDeveloper');await wait("$('developerStatus').dataset.state==='error'");
   fixture.unlockFail=false;
   const posts=fixture.unlockPosts;await click('#enableDeveloper');await click('#enableDeveloper');
   assert.equal(await ev("$('wizardNext').disabled"),true);
   await wait("$('developerStatus').dataset.state==='active'");assert.equal(fixture.unlockPosts,posts+1);
   assert.equal(await ev("$('enableDeveloper').disabled"),true);
   fixture.unlock={cdp:'OK',count:1,allUnlocked:false};const reads=fixture.unlockReads;
   await ev('checkLock()');assert.equal(fixture.unlockReads,reads+1);
   assert.equal(await ev("$('developerStatus').dataset.state"),'inactive');
   assert.equal(await ev("$('enableDeveloper').disabled"),false);
   fixture.connected=false;await ev('loadEnv()');await click('#wizardNext');assert.match(await ev("$('wizardError').textContent"),/브라우저/);
   assert.equal(await ev("$('developerStatus').dataset.state"),'disconnected');
   fixture.connected=true;await ev('loadEnv()');
   await click('#enableDeveloper');await wait("$('developerStatus').dataset.state==='active'");
  }
  if(key!=='keyescape')assert.equal(await ev("$('developerStatus').hidden"),true);
  if(key==='dps'||key==='naver'){
   fixture.logged=false;await ev('checkLogin(true)');await click('#wizardNext');assert.match(await ev("$('wizardError').textContent"),/로그인/);
   fixture.logged=true;await ev('checkLogin(true)');
  }
  await click('#wizardNext');assert.equal(await ev("document.querySelector('[data-panel]:not([hidden])').dataset.panel"),'1');
  await click('#wizardNext');assert.match(await ev("$('wizardError').textContent"),/시간/);
  await click('.chip');await click('#wizardNext');assert.equal(await ev("document.querySelector('[data-panel]:not([hidden])').dataset.panel"),'2');
  if(key!=='naver')await ev("$('pname').value='테스트유저';$('hp').value='010-0000-0000';$('dep').value='테스트유저'");
  if(key==='rhe')await ev("$('rhePerson').value='4';$('rhePerson').onchange()");   // 토끼굴 신청서의 '예약 인원'
  if(key==='keyescape'){
   fixture.fail=true;await click('#wizardNext');await wait("$('wizardError').textContent.includes('테스트 연결 실패')");assert.equal(await ev("$('wizardNext').disabled"),false);fixture.fail=false;
  }
  if(key==='naver'){
   fixture.naverBank=false;await ev('loadEnv()');   // 배포 기본값: 검증 전 무통장입금 확정 옵션은 보이지 않는다
   assert.equal(await ev("$('naverBankOptions').hidden"),true);assert.match(await ev("$('autoHelp').textContent"),/직접 해 주세요/);
   fixture.naverBank=true;await ev('loadEnv()');
   await click('#naverConfirm');assert.equal(await ev("$('naverBankLimit').hidden"),false);
   await click('#wizardNext');assert.match(await ev("$('wizardError').textContent"),/상한/);
   await ev("$('naverBankMax').value='70000'");
  }
  const before=fixture.calls.length;await click('#wizardNext');await click('#wizardNext');await wait("$('wizardNext').textContent==='예약 진행 중'");assert.equal(fixture.calls.length,before+1);
  if(key==='keyescape'){assert.equal(await ev("$('developerStatus').hidden"),false);assert.equal(await ev("$('developerStatus').dataset.state"),'active');assert.equal(await ev("$('enableDeveloper').disabled"),true);}
  const body=fixture.calls.at(-1);assert.equal(body.site,key);assert.equal(body.times,'19:20');assert.equal(body.date,'2099-09-17');assert.equal(body.paySubmit,undefined);
  if(key==='naver'){assert.equal(body.name,undefined);assert.equal(body.bankConfirm,true);assert.equal(body.bankMax,70000);}else {assert.equal(body.name,'테스트유저');assert.equal(body.bankConfirm,undefined);}
  assert.equal(await ev("$('rhePersonWrap').style.display"),key==='rhe'?'':'none');   // '예약 인원' 은 토끼굴 신청서에만 있다
  if(key==='rhe'){   // 인원·넓은 마감 창은 실려가고, 최종 '예약하기' 자동 클릭은 체크박스로만 켠다 (기본 꺼짐)
   assert.equal(body.person,'4');assert.ok(body.deadline>=600);assert.equal(body.autoSubmit,undefined);assert.equal(body.paySubmit,undefined);
   assert.equal(body.finalSubmit,false);assert.match(await ev("$('autosubLabel').textContent"),/최종 '예약하기'까지 자동 클릭/);
   assert.equal(await ev("$('subRow').style.display"),'flex');assert.match(await ev("$('autoHelp').textContent"),/직접 눌러 주세요/);}
  else if(key!=='naver')assert.equal(body.finalSubmit,undefined);
  else assert.equal(body.person,undefined);
  assert.equal(await ev("$('siteFields').disabled"),true);assert.equal(await ev("document.querySelector('[data-design-link]')"),null);
  if(key==='naver'){
   await c.send('Page.reload');await wait("typeof window.bookingUI==='object' && $('wizardNext').textContent==='예약 진행 중'");
   assert.equal(await ev("$('summaryTime').textContent"),'19:20');assert.equal(await ev("$('summaryDate').textContent"),'2099-09-17');assert.equal(fixture.calls.length,before+1);
   for(const stream of fixture.streams)stream.write('data: '+JSON.stringify({line:'[HANDOFF] 직접 확인 필요'})+'\n\n');
   await wait("$('runTitle').textContent==='예약창에서 확인해 주세요'");
  }
  await click('#wizardBack');await wait("$('wizardNext').textContent==='예약 설정으로 돌아가기'");await click('#wizardNext');await click('#wizardBack');await click('#wizardBack');
  console.log('PASS guided booking payload, guard and stop:',key);
 }
 await ev("setSite('keyescape')");await ev('checkLock(true)');
 for(const width of [1024,736,360])for(const theme of ['light','dark']){
  await c.send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});await c.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
  assert(await ev('document.documentElement.scrollWidth<=innerWidth+1'),`overflow ${width} ${theme}`);
 }
 if(process.env.TEST_SCREENSHOTS){await c.send('Emulation.setDeviceMetricsOverride',{width:1024,height:1000,deviceScaleFactor:1,mobile:false});await c.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});const r=await c.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.TEST_SCREENSHOTS,Buffer.from(r.data,'base64'));}
 await c.send('Page.navigate',{url:origin+'/classic.html'});await wait("location.pathname==='/classic.html' && !!document.querySelector('.chip')");assert.equal(await ev('typeof fire'),'function');assert.equal(await ev('typeof window.bookingUI'),'undefined');
 await click('[data-design-link]');await wait("location.pathname==='/' && typeof window.bookingUI==='object'");
 const errors=c.events.filter(e=>e.method==='Runtime.exceptionThrown');assert.equal(errors.length,0,JSON.stringify(errors));
 console.log('GUIDED_UI_OK: five sites, payloads, duplicate prevention, failures, stop, layout, no design switch, archived classic');
}finally{c?.ws.close();if(tab)await fetch(host+'/json/close/'+tab.id);for(const s of fixture.streams)s.end();server.closeAllConnections();server.close();}
