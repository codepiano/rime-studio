import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLearned} from '../public/learned-view.js';
const data=text=>({coverage:{loaded:true,incomplete:false},dictionaries:[],rows:text?[{id:text,text,code:'abc',count:1,dictionary:'test',canDelete:false}]:[],total:text?1:0,hasMore:false});
function rootStub(){const elements=new Map();return {isConnected:true,innerHTML:'',elements,querySelector(selector){if(/data-learn-(sync|pause|start)/.test(selector))return null;if(!elements.has(selector))elements.set(selector,{addEventListener(){}});return elements.get(selector);},querySelectorAll(){return [];}};}
function pending(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test('latest filter wins when learned requests finish out of order; obsolete errors remain silent',async()=>{
 const root=rootStub(),requests=[],messages=[];let initial=true;
 await mountLearned(root,{api(){if(initial){initial=false;return Promise.resolve(data('初始'));}const request=pending();requests.push(request);return request.promise;},notify:message=>messages.push(message)});
 const toggle=root.querySelector('#learned-hide-single').onchange;
 const old=toggle({target:{checked:false}}),latest=toggle({target:{checked:true}});
 requests[1].resolve(data('新结果'));await latest;requests[0].resolve(data('旧结果'));await old;
 assert.match(root.innerHTML,/新结果/);assert.doesNotMatch(root.innerHTML,/旧结果/);assert.match(root.innerHTML,/id="learned-hide-single"\s+checked/);
 const obsolete=toggle({target:{checked:false}}),current=toggle({target:{checked:true}});requests[3].resolve(data('当前'));await current;requests[2].reject(new Error('过期错误'));await obsolete;assert.deepEqual(messages,[]);
});
test('refresh invalidates older queries and detached learned views do not render or notify',async()=>{
 const root=rootStub(),requests=[],messages=[];let initial=true;
 await mountLearned(root,{api(){if(initial){initial=false;return Promise.resolve(data('初始'));}const request=pending();requests.push(request);return request.promise;},notify:message=>messages.push(message)});
 const old=root.querySelector('#learned-hide-single').onchange({target:{checked:false}}),refresh=root.querySelector('[data-learn-refresh]').onclick();
 requests[0].resolve(data('旧结果'));await old;assert.doesNotMatch(root.innerHTML,/旧结果/);
 requests[1].resolve(data('读取'));await Promise.resolve();requests[2].resolve(data('读取结果'));await refresh;assert.match(root.innerHTML,/读取结果/);
 const detached=root.querySelector('#learned-hide-single').onchange({target:{checked:true}}),before=root.innerHTML;root.isConnected=false;requests[3].reject(new Error('离开页面'));await detached;assert.equal(root.innerHTML,before);assert.deepEqual(messages,[]);
});
test('a failed current query clears old rows rather than enabling destructive actions on mismatched results',async()=>{
 const root=rootStub();let initial=true;
 await mountLearned(root,{api(){if(initial){initial=false;return Promise.resolve(data('旧行'));}return Promise.reject(new Error('查询失败'));},notify(){}});
 await root.querySelector('#learned-hide-single').onchange({target:{checked:false}});assert.doesNotMatch(root.innerHTML,/旧行/);assert.match(root.innerHTML,/查询未完成：查询失败/);assert.match(root.innerHTML,/data-learn-delete disabled/);
});
