import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
async function launch(t,extra={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rime-api-connection-'));
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const env={...process.env,PORT:String(port),RIME_STUDIO_DATA_DIR:path.join(dir,'data'),RIME_DISABLE_DEPLOY:'1'};delete env.RIME_USER_DIR;delete env.RIME_SHARED_DIR;Object.assign(env,extra);
 const child=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,20));}
 return {dir,base,async request(url,body,token){const response=await fetch(base+url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','x-rime-token':token}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}};
}
async function dirs(dir,name){const user=path.join(dir,name),shared=path.join(dir,'shared');await fs.mkdir(user);await fs.mkdir(shared,{recursive:true});await fs.writeFile(path.join(shared,'default.yaml'),'menu: {page_size: 5}\nschema_list: [{schema: test}]\n');await fs.writeFile(path.join(shared,'squirrel.yaml'),'style: {font_point: 16}\n');await fs.writeFile(path.join(user,'test.schema.yaml'),'schema: {schema_id: test, name: test}\n');return {userDir:user,sharedDir:shared};}
test('runtime metrics identify the live service and distinguish manual from managed startup',async t=>{
 for(const managed of [false,true]){
  const app=await launch(t,{RIME_STUDIO_MANAGED:managed?'1':'0'});
  const response=await fetch(app.base+'/control-panel/metrics');
  const metrics=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(metrics.status,'running');assert.equal(metrics.runtimeMode,'development');
  assert.equal(metrics.processMode,managed?'managed':'observed');
  assert.equal(metrics.pid,(await app.request('/health')).data.pid);
  assert.ok(Number.isFinite(Date.parse(metrics.updatedAt)));assert.ok(metrics.uptimeSec>0);
  assert.ok(metrics.memory.rssBytes>0);assert.ok(metrics.memory.heapUsedBytes>0);
 }
});
test('setup, invalid path rejection, persistence, and directory switching are isolated',async t=>{
 const app=await launch(t),initial=(await app.request('/api/state')).data;assert.equal(typeof initial.connection.ready,'boolean');assert.ok(initial.token);
 const invalid=await app.request('/api/connection',{userDir:'/nonexistent/rime-studio-fixture',sharedDir:'/nonexistent/resources'},initial.token);assert.equal(invalid.status,400);await assert.rejects(fs.stat(path.join(app.dir,'data/settings.json')),/ENOENT/);
 const one=await dirs(app.dir,'one'),two=await dirs(app.dir,'two');
 const connected=await app.request('/api/connection',one,initial.token);assert.equal(connected.status,200);assert.equal(connected.data.connection.confirmed,true);assert.equal(connected.data.connection.canDeploy,false);
 const a=connected.data;const preview=await app.request('/api/preview',{connectionId:a.connection.id,revision:a.revision,changes:[{field:'page_size',value:7}]},a.token);assert.equal(preview.status,200);
 const b=(await app.request('/api/connection',two,a.token)).data;assert.notEqual(a.connection.id,b.connection.id);
 const stale=await app.request('/api/apply',{connectionId:a.connection.id,id:preview.data.id},b.token);assert.equal(stale.status,400);assert.match(stale.data.error,/目录已变化/);
 await assert.rejects(fs.stat(path.join(two.userDir,'default.custom.yaml')),/ENOENT/);
 const stored=JSON.parse(await fs.readFile(path.join(app.dir,'data/settings.json'),'utf8'));assert.equal(stored.confirmed,true);assert.equal(stored.userDir,two.userDir);
 const noId=await app.request('/api/preview',{revision:b.revision,changes:[{field:'page_size',value:6}]},b.token);assert.equal(noId.status,400);
});
test('missing directories still bootstrap the settings page and reject configuration writes',async t=>{
 const app=await launch(t,{RIME_USER_DIR:'/nonexistent/rime-studio-user',RIME_SHARED_DIR:'/nonexistent/rime-studio-shared'});const response=await app.request('/api/state');assert.equal(response.status,200);assert.equal(response.data.connection.ready,false);assert.deepEqual(response.data.schemas,[]);assert.ok(response.data.connection.issues.length);assert.ok(response.data.token);const write=await app.request('/api/preview',{changes:[{field:'page_size',value:6}]},response.data.token);assert.equal(write.status,400);assert.match(write.data.error,/连接设置/);
});

test('text tools work without a Rime connection and retain local-origin and token protection',async t=>{
 const app=await launch(t,{RIME_USER_DIR:'/nonexistent/rime-tools-user',RIME_SHARED_DIR:'/nonexistent/rime-tools-shared'}),state=(await app.request('/api/state')).data;
 const tools=(await app.request('/api/tools')).data;assert.equal(tools.conversionModes.length,8);assert.equal(tools.textLimit,30000);
 const denied=await app.request('/api/tools/convert',{text:'汉语',mode:'s2t'});assert.equal(denied.status,403);
 const conversion=await app.request('/api/tools/convert',{text:'鼠标和软件',mode:'s2twp'},state.token);assert.equal(conversion.status,200);assert.equal(conversion.data.text,'滑鼠和軟體');
 const invalid=await app.request('/api/dictionary/query',{term:'bad\nquery'},state.token);assert.equal(invalid.status,400);
 const external=await fetch(app.base+'/api/tools/convert',{method:'POST',headers:{'Content-Type':'application/json','x-rime-token':state.token,Origin:'https://example.com'},body:JSON.stringify({text:'汉语',mode:'s2t'})});assert.equal(external.status,403);
 await assert.rejects(fs.stat(path.join(app.dir,'data/native')),/ENOENT/);
});
test('library APIs bind resource writes to connection identity and enforce input/token limits',async t=>{
 const app=await launch(t),initial=(await app.request('/api/state')).data,one=await dirs(app.dir,'library-one');
 await fs.writeFile(path.join(one.userDir,'test.schema.yaml'),'schema: {schema_id: test, name: 测试}\nengine: {translators: [script_translator]}\ntranslator: {dictionary: base}\n');
 await fs.writeFile(path.join(one.sharedDir,'base.dict.yaml'),'---\nname: base\n...\n基础\tji chu\t100\n');
 const state=(await app.request('/api/connection',one,initial.token)).data;
 const listing=await app.request('/api/library');assert.equal(listing.status,200);assert.equal(listing.data.schemas[0].dictionary,'base');
 const phrases=(await app.request('/api/library/phrases?schema=test')).data;
 const payload={...phrases,text:'知键\tzj\t100\n',connectionId:state.connection.id};
 assert.equal((await app.request('/api/library/phrases/preview',payload,'wrong')).status,403);
 const preview=await app.request('/api/library/phrases/preview',payload,state.token);assert.equal(preview.status,200);
 const write=await app.request('/api/apply',{id:preview.data.id,connectionId:state.connection.id},state.token);assert.equal(write.status,200);
 assert.match(await fs.readFile(path.join(one.userDir,'studio_test_phrases.txt'),'utf8'),/知键/);assert.ok((await app.request('/api/state')).data.pendingDeployment.includes('studio_test_phrases.txt'));
 const unsafe=await app.request('/api/library/dictionary?file=..%2Foutside.dict.yaml');assert.equal(unsafe.status,400);
 const arbitrary=await app.request('/api/packages/download',{package:'https://example.com/arbitrary',mode:'full',enable:true,connectionId:state.connection.id},state.token);assert.equal(arbitrary.status,400);
 const two=await dirs(app.dir,'library-two');await app.request('/api/connection',two,state.token);
 assert.equal((await app.request('/api/library/phrases/preview',payload,state.token)).status,400);
});
test('standalone dictionary install handles larger files and preserves write protection',async t=>{
 const app=await launch(t),initial=(await app.request('/api/state')).data,one=await dirs(app.dir,'dictionary-large');await fs.writeFile(path.join(one.userDir,'test.schema.yaml'),'schema: {schema_id: test, name: 测试}\ntranslator: {dictionary: base}\n');await fs.writeFile(path.join(one.sharedDir,'base.dict.yaml'),'---\nname: base\n...\n你好\tni hao\t100\n');const state=(await app.request('/api/connection',one,initial.token)).data;
 const payload={text:'---\nname: imported\n...\n'+Array.from({length:18000},(_,i)=>`词${i}\tci\t100`).join('\n'),schema:'test',activate:true,connectionId:state.connection.id};assert.ok(Buffer.byteLength(payload.text)>150000);
 assert.equal((await app.request('/api/library/install/preview',payload,'bad')).status,403);const preview=await app.request('/api/library/install/preview',payload,state.token);assert.equal(preview.status,200);const save=await app.request('/api/apply',{id:preview.data.id,connectionId:state.connection.id},state.token);assert.equal(save.status,200);assert.equal((await app.request('/api/library')).data.schemas[0].tables.includes('imported'),true);
 const bad=await app.request('/api/library/manage/preview',{action:'delete',file:'../outside.dict.yaml',hash:'x',connectionId:state.connection.id},state.token);assert.equal(bad.status,400);assert.equal((await app.request('/api/learned/lifecycle',{action:'pause',connectionId:state.connection.id},state.token)).status,400);assert.equal((await app.request('/api/learned/sync',{connectionId:state.connection.id},state.token)).status,400);
});
test('unified search and diagnosis bind to current connection and protect native requests',async t=>{
 const app=await launch(t),initial=(await app.request('/api/state')).data,one=await dirs(app.dir,'search-diagnosis');
 await fs.writeFile(path.join(one.userDir,'test.schema.yaml'),'schema: {schema_id: test, name: 测试}\nengine: {processors: [speller, selector, navigator, express_editor], segmentors: [abc_segmentor, fallback_segmentor], translators: [table_translator@phrases]}\nspeller: {alphabet: abcdefghijklmnopqrstuvwxyz}\nphrases: {dictionary: "", user_dict: phrases, db_class: stabledb}\n');
 await fs.writeFile(path.join(one.userDir,'phrases.txt'),'知键\tzj\t100\n');const state=(await app.request('/api/connection',one,initial.token)).data;
 const found=await app.request(`/api/search?q=${encodeURIComponent('知键')}&connectionId=${state.connection.id}`);assert.equal(found.status,200);assert.equal(found.data.total,1);assert.equal(found.data.results[0].target.file,'phrases.txt');assert.equal(found.data.learnedLoaded,false);
 assert.equal((await app.request('/api/search?q=word&connectionId=old')).status,400);
 assert.equal((await app.request('/api/diagnosis',{schema:'test',code:'zj',connectionId:state.connection.id},'wrong')).status,403);
 assert.equal((await app.request('/api/diagnosis',{schema:'test',code:'zj',connectionId:'old'},state.token)).status,400);
 const trial=await app.request('/api/diagnosis',{schema:'test',code:'zj',expected:'知键',connectionId:state.connection.id},state.token);assert.equal(trial.status,200);assert.ok(trial.data.trial.candidates.some(x=>x.text==='知键'));assert.equal(trial.data.connectionId,state.connection.id);
 await assert.rejects(fs.access(path.join(one.userDir,'build')),/ENOENT/);
});
