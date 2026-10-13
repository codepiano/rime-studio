import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ConfigStore} from '../config.js';
import {diagnoseInput,diagnosisInput,stageDiagnosis,diagnosisSandbox} from '../diagnosis.js';
import {searchResources} from '../search.js';
const exec=promisify(execFile),appPath='/Library/Input Methods/Squirrel.app';
const native=process.platform==='darwin'&&await fs.access(path.join(appPath,'Contents/Frameworks/librime.1.dylib')).then(()=>true,()=>false);
export async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'rime-diagnosis-test-'))),userDir=path.join(root,'user'),sharedDir=path.join(root,'shared');
 await fs.mkdir(userDir);await fs.mkdir(sharedDir);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(sharedDir,'default.yaml'),'config_version: "1"\nschema_list: [{schema: test}]\nmenu: {page_size: 5}\n');await fs.writeFile(path.join(sharedDir,'squirrel.yaml'),'style: {}\n');
 await fs.writeFile(path.join(userDir,'test.schema.yaml'),`schema: {schema_id: test, name: 测试, version: "1"}\nengine:\n  processors: [speller, selector, navigator, express_editor]\n  segmentors: [abc_segmentor, fallback_segmentor]\n  translators: [table_translator, table_translator@phrases]\nspeller: {alphabet: abcdefghijklmnopqrstuvwxyz}\ntranslator: {dictionary: test, enable_user_dict: false}\nphrases: {dictionary: "", user_dict: phrases, db_class: stabledb, initial_quality: 99}\n`);
 await fs.writeFile(path.join(userDir,'test.dict.yaml'),'---\nname: test\nversion: "1"\nsort: by_weight\n...\n测试\tcs\t100\n');await fs.writeFile(path.join(userDir,'phrases.txt'),'知键\tzj\t100\n');
 const store=new ConfigStore({userDir,sharedDir,dataDir:path.join(root,'data')});return {root,store};
}
test('diagnosis validates keys and never accepts arbitrary paths',()=>{
 assert.throws(()=>diagnosisInput({schema:'../outside',code:'zj'}),/有效方案/);assert.throws(()=>diagnosisInput({schema:'test',code:'中文'}),/ASCII/);assert.throws(()=>diagnosisInput({schema:'test',code:'zj\n'}),/ASCII/);assert.throws(()=>diagnosisInput({schema:'test',code:'zj',expected:'\0'}),/控制字符/);assert.equal(diagnosisInput({schema:'test',code:'cs '}).code,'cs ');
});
test('staging excludes learning databases, sync, identity and stale user builds',async t=>{
 const {root,store}=await fixture(t),stage=path.join(root,'stage');await fs.mkdir(stage);
 for(const dir of ['sync','test.userdb','build']){await fs.mkdir(path.join(store.userDir,dir));await fs.writeFile(path.join(store.userDir,dir,'secret.txt'),'private');}
 for(const file of ['user.yaml','installation.yaml','words.userdb.txt'])await fs.writeFile(path.join(store.userDir,file),'private');
 const data=await stageDiagnosis(store,stage);assert.ok(data.count>=5);for(const file of ['sync/secret.txt','test.userdb/secret.txt','build/secret.txt','user.yaml','installation.yaml','words.userdb.txt'])await assert.rejects(fs.access(path.join(stage,file)),/ENOENT/);
 await fs.symlink(path.join(root,'private'),path.join(store.userDir,'escape.txt'));await assert.rejects(stageDiagnosis(store,stage),/符号链接/);
});
test('native trial returns real dictionary and fixed-phrase candidates and leaves source data untouched',{skip:!native},async t=>{
 const {root,store}=await fixture(t),before=await fs.readFile(path.join(store.userDir,'phrases.txt'),'utf8');
 const first=await diagnoseInput(store,{appPath},path.join(root,'data'),{schema:'test',code:'zj',expected:'知键'});assert.equal(first.trial.compiled,true);assert.ok(first.trial.candidates.some(x=>x.text==='知键'));assert.equal(first.checks.find(x=>x.title==='期望词条').level,'ok');assert.equal(store.busy,false);assert.equal(await fs.readFile(path.join(store.userDir,'phrases.txt'),'utf8'),before);await assert.rejects(fs.stat(path.join(store.userDir,'build')),/ENOENT/);
 await fs.writeFile(path.join(store.userDir,'phrases.txt'),'更新短语\tzj\t100\n');
 const second=await diagnoseInput(store,{appPath},path.join(root,'data'),{schema:'test',code:'zj'});assert.ok(second.trial.candidates.some(x=>x.text==='更新短语'));assert.ok(!second.trial.candidates.some(x=>x.text==='知键'));
 const commit=await diagnoseInput(store,{appPath},path.join(root,'data'),{schema:'test',code:'cs ',expected:'测试'});assert.deepEqual(commit.trial.commits,['测试']);
});
test('diagnosis reports missing resources and alphabet mismatch, and releases lock after errors',{skip:!native},async t=>{
 const {root,store}=await fixture(t);await fs.unlink(path.join(store.userDir,'test.dict.yaml'));
 const result=await diagnoseInput(store,{appPath},path.join(root,'data'),{schema:'test',code:'1',expected:'缺少'});assert.equal(result.checks.find(x=>x.title==='按键范围').level,'warning');assert.equal(result.checks.find(x=>x.title==='词库文件').level,'error');assert.ok(result.trial.error);
 await assert.rejects(diagnoseInput(store,{appPath},path.join(root,'data'),{schema:'missing',code:'cs'}),/未安装/);assert.equal(store.busy,false);
 store.busy=true;await assert.rejects(diagnoseInput(store,{appPath},path.join(root,'data'),{schema:'test',code:'cs'}),/正在保存/);store.busy=false;
});
test('diagnosis sandbox denies source reads, writes outside staging, subprocesses and network',{skip:!native},async t=>{
 const {root,store}=await fixture(t),stage=path.join(root,'stage');await fs.mkdir(stage);const source=path.join(stage,'sandbox.c');await fs.writeFile(source,`#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
int main(int argc,char**argv){if(argv[1][0]=='r'){FILE*f=fopen(argv[2],"r");if(!f)return 1;return 0;}if(argv[1][0]=='w'){FILE*f=fopen(argv[2],"w");if(!f)return 1;fputs("safe",f);fclose(f);return 0;}if(argv[1][0]=='n'){int s=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={.sin_family=AF_INET,.sin_port=htons(atoi(argv[2]))};inet_pton(AF_INET,"127.0.0.1",&a.sin_addr);return connect(s,(void*)&a,sizeof(a))==0?0:1;}execl("/bin/echo","echo","unsafe",NULL);return 1;}`);await exec('/usr/bin/clang',[source,'-o',path.join(stage,'probe')]);
 const frameworks=await fs.realpath(path.join(appPath,'Contents/Frameworks')),profile=diagnosisSandbox(stage,frameworks,[store.userDir,store.sharedDir]);
 const run=(...args)=>exec('/usr/bin/sandbox-exec',['-p',profile,path.join(stage,'probe'),...args]);
 await assert.rejects(run('r',path.join(store.userDir,'phrases.txt')));await assert.rejects(run('w',path.join(root,'outside')));await assert.rejects(run('exec'));const listener=net.createServer(socket=>socket.end());listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=String(listener.address().port);t.after(()=>new Promise(resolve=>listener.close(resolve)));await exec(path.join(stage,'probe'),['n',port]);await assert.rejects(run('n',port));
 await run('w',path.join(stage,'safe'));assert.equal(await fs.readFile(path.join(stage,'safe'),'utf8'),'safe');
});
test('unified search preserves source provenance, shares phrase navigation and only queries loaded learning cache',async t=>{
 const {store}=await fixture(t);await fs.writeFile(path.join(store.userDir,'studio_test_personal.dict.yaml'),'---\nname: studio_test_personal\n...\n知键\tzhi jian\t100\n');
 let refreshCalled=false;store.learned={loaded:true,refresh(){refreshCalled=true;throw new Error('must not read');},cache:new Map([['test',{name:'test',source:'snapshot',time:'2026-10-01T00:00:00Z',rows:[{text:'知键',code:'zhi jian',count:7,deleted:false},{text:'知键',code:'deleted',deleted:true}]}]])};
 const result=await searchResources(store,'知键');assert.equal(result.total,3);assert.deepEqual(result.results.map(x=>x.kind),['personal','phrase','learned']);assert.equal(result.results[1].target.file,'phrases.txt');assert.match(result.results[2].source,/可能过时/);assert.equal(result.results[2].canDelete,false);assert.equal(refreshCalled,false);
 assert.equal((await searchResources(store,'zhi jian')).total,2);assert.equal((await searchResources(store,'知键',{limit:1})).hasMore,true);
await assert.rejects(searchResources(store,''),/搜索内容/);
});
test('a user Lua filter runs in the restricted process and cannot alter or read original data',{skip:!native},async t=>{
 const {root,store}=await fixture(t),schemaFile=path.join(store.userDir,'test.schema.yaml');let schema=await fs.readFile(schemaFile,'utf8');
 schema=schema.replace('  translators: [table_translator, table_translator@phrases]','  translators: [table_translator, table_translator@phrases]\n  filters: [lua_filter@guard]');
 await fs.writeFile(schemaFile,schema);
 const outside=path.join(root,'outside'),source=path.join(store.userDir,'phrases.txt');
 await fs.writeFile(path.join(store.userDir,'rime.lua'),`function guard(input, env)\n local write=io.open(${JSON.stringify(outside)}, "w")\n if write then write:write("escaped"); write:close() end\n local original=io.open(${JSON.stringify(source)}, "r")\n for candidate in input:iter() do\n  if original then candidate.text="ESCAPED" end\n  yield(candidate)\n end\nend\n`);
 const result=await diagnoseInput(store,{appPath},path.join(root,'data'),{schema:'test',code:'zj'});assert.ok(result.trial.candidates.some(x=>x.text==='知键'));assert.ok(!result.trial.candidates.some(x=>x.text==='ESCAPED'));await assert.rejects(fs.access(outside),/ENOENT/);assert.equal(await fs.readFile(source,'utf8'),'知键\tzj\t100\n');
});
test('unified search deduplicates shared phrase tables and rejects unsafe personal sources',async t=>{
 const {store}=await fixture(t);await fs.copyFile(path.join(store.userDir,'test.schema.yaml'),path.join(store.userDir,'other.schema.yaml'));await fs.symlink('/etc/hosts',path.join(store.userDir,'studio_test_personal.dict.yaml'));
 const result=await searchResources(store,'知键');assert.equal(result.total,1);assert.equal(result.results[0].schemas.length,2);assert.ok(result.warnings.some(x=>x.includes('符号链接')));assert.equal(result.learnedLoaded,false);
});
