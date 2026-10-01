import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { naverBankPage } from '../naver-browser.mjs';
import { naverProduct, validateNaverRun, driveNaverBank } from '../naver.mjs';
const product = naverProduct('843881', '6627331');
const want = { product, date:'2030-09-16', time:'19:20', maxAmount:70000 };
function fixture(options={}) {
  let clicks=0, selections=0;
  const element = (text, extra={}) => ({ innerText:text, textContent:text, getClientRects:()=>[1], disabled:false, getAttribute:()=>null, ...extra });
  const bank=element('', {type:'radio',name:'method',value:options.bankValue || 'BANK_DEPOSIT',checked:options.selected!==false,labels:[element('무통장입금')],click(){selections++;this.checked=true;}});
  const button=element('동의하고 결제하기',{className:'btn_request',disabled:!!options.disabled,click(){clicks++;}});
  const inputs=options.missingInfo?[element('',{required:true,value:'',type:'text'})]:[];
  const radios=options.noMethod?[]:[bank];
  if(options.ambiguousMethod)radios.push(element('',{name:'method',checked:true,value:'CREDIT_CARD',labels:[element('신용카드')]}));
  const storage=new Map();
  const ctx=vm.createContext({URL,Date,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>{if(options.storageFailure)throw Error('denied');storage.set(k,v);}},location:{href:options.url||product.url+'/request?startDateTime=2030-09-16T19%3A20%3A00%2B09%3A00'},document:{title:product.name,body:{innerText:options.captcha?'로봇이 아닙니다':'신청서'},querySelectorAll(selector){
    if(selector==='iframe,[id*="captcha"],[class*="captcha"]')return [];
    if(selector==='.section_booking_info')return [element(options.wrongDisplay?'9. 17. 오후 7:20':'9. 16. 오후 7:20')];
    if(selector==='a,button')return options.loggedOut?[]:[element('로그아웃')];
    if(selector.startsWith('.booking_form_wrap'))return inputs;
    if(selector==='input[type="radio"]')return radios;
    if(selector==='.booking_price_total')return [element(options.price || '예약금 합계 60,000원')];
    if(selector==='button.btn_request')return options.ambiguousButton?[button,button]:[button];
    throw Error('Unexpected selector '+selector);
  }}});
  return {read:action=>vm.runInContext(`(${naverBankPage.toString()})(${JSON.stringify({...want,action})})`,ctx),clicks:()=>clicks,selections:()=>selections};
}
test('bank preview validates the selected method and price without confirming',()=>{const f=fixture();assert.equal(f.read('read').ready,true);assert.equal(f.clicks(),0);});
test('selecting bank deposit is reversible; confirmation records before clicking and never repeats',()=>{
 const f=fixture({selected:false});assert.equal(f.read('read').ok,false);assert.equal(f.read('select-bank').selected,true);assert.equal(f.selections(),1);
 assert.equal(f.read('confirm').clicked,true);assert.equal(f.read('confirm').ok,false);assert.equal(f.clicks(),1);
});
for(const [label,options] of Object.entries({
 'different URL':{url:'https://example.com/request'},
 'missing timestamp':{url:product.url+'/request'},
 'wrong timestamp':{url:product.url+'/request?startDateTime=2030-09-17T19:20:00'},
 'wrong visible date':{wrongDisplay:true}, 'logout':{loggedOut:true}, 'captcha':{captcha:true},
 'no explicit bank method':{noMethod:true}, 'other payment method':{bankValue:'CREDIT_CARD'},
 'ambiguous method':{ambiguousMethod:true}, 'over budget':{price:'결제금액 80,000원'},
 'multiple prices':{price:'예약금 60,000원 매장 결제 20,000원'}, 'missing buyer':{missingInfo:true},
 'disabled final button':{disabled:true}, 'ambiguous final button':{ambiguousButton:true},
}))test(label+' prevents any confirmation',()=>{const f=fixture(options);assert.equal(f.read('confirm').ok,false);assert.equal(f.clicks(),0);});
test('recording failure prevents the click',()=>{const f=fixture({storageFailure:true});assert.throws(()=>f.read('confirm'));assert.equal(f.clicks(),0);});
test('bank confirmation requires positive limit and automatic application flow',()=>{
 const args={zizum:product.business,theme:product.theme,date:'2030-09-16',times:'19:20',bankConfirm:true};
 assert.throws(()=>validateNaverRun(args),/상한/);
 assert.throws(()=>validateNaverRun({...args,bankMax:70000,autoSubmit:false}),/자동 진행/);
 assert.equal(validateNaverRun({...args,bankMax:70000}).bankConfirm,true);
});
test('uncertain final response is never retried',async()=>{
 let confirmations=0;
 await assert.rejects(driveNaverBank({read:async action=>{if(action==='confirm'){confirmations++;throw Error('navigation');}return {ready:true,amount:60000};},deadline:Date.now()+1000,log:()=>{}}),/다시 클릭하지/);
 assert.equal(confirmations,1);
});
test('blocked payment method stops immediately without clicking',async()=>{
 const actions=[];
 await assert.rejects(driveNaverBank({read:async a=>{actions.push(a);return {blocked:true,msg:'무통장입금 아님'};},deadline:Date.now()+1000,log:()=>{}}),/무통장입금/);
 assert.deepEqual(actions,['read']);
});
