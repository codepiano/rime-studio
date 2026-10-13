import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ConfigStore} from '../config.js';
import {deploymentBaseline,observeDeployment,recordDeploymentChanges} from '../deployment.js';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'rime-deployment-test-')),userDir=path.join(root,'user'),sharedDir=path.join(root,'shared');for(const dir of [userDir,sharedDir,path.join(userDir,'build')])await fs.mkdir(dir);t.after(()=>fs.rm(root,{recursive:true,force:true}));for(const file of ['default','squirrel']){await fs.writeFile(path.join(sharedDir,file+'.yaml'),file==='default'?'schema_list: []\n':'style: {}\n');await fs.writeFile(path.join(userDir,'build',file+'.yaml'),`config_version: "1"\n__build_info:\n  timestamps: {${file}: ${Math.floor(Date.now()/1000)+10}}\n`);}return new ConfigStore({userDir,sharedDir,dataDir:path.join(root,'data')});}
test('identical regenerated YAML and dictionary artifacts count as compile observations',async t=>{
 const store=await fixture(t),baseline=await deploymentBaseline(store),file=path.join(store.userDir,'build/default.yaml');
 const text=await fs.readFile(file,'utf8');await fs.writeFile(file,text);await fs.utimes(file,new Date(),new Date(Date.now()+2000));
 assert.equal((await observeDeployment(store,baseline,{wait:async()=>{},attempts:3})).state,'verified');
 const next=await deploymentBaseline(store);await fs.writeFile(path.join(store.userDir,'build/words.table.bin'),'rebuilt');
 assert.equal((await observeDeployment(store,next,{wait:async()=>{},attempts:3})).state,'verified');
});
test('a sent request with unchanged artifacts is never reported as verified',async t=>{
 const store=await fixture(t),baseline=await deploymentBaseline(store);assert.equal((await observeDeployment(store,baseline,{wait:async()=>{},attempts:3})).state,'unconfirmed');
});
test('stale custom timestamps, changed sources and unstable builds prevent confirmation',async t=>{
 const store=await fixture(t);await fs.writeFile(path.join(store.userDir,'default.custom.yaml'),'patch: {menu/page_size: 8}\n');const baseline=await deploymentBaseline(store);await fs.writeFile(path.join(store.userDir,'build/words.table.bin'),'rebuilt');
 assert.equal((await observeDeployment(store,baseline,{wait:async()=>{},attempts:3})).state,'unconfirmed');
 await fs.writeFile(path.join(store.userDir,'default.custom.yaml'),'patch: {menu/page_size: 9}\n');assert.match((await observeDeployment(store,baseline,{wait:async()=>{},attempts:3})).message,/源配置发生变化/);
 const other=await fixture(t),next=await deploymentBaseline(other);let number=0;
 assert.equal((await observeDeployment(other,next,{wait:async()=>{await fs.writeFile(path.join(other.userDir,'build/default.yaml'),`config_version: "${++number}"\n__build_info:\n  timestamps: {default: ${Math.floor(Date.now()/1000)+10}}\n`);},attempts:3})).state,'unconfirmed');
});
test('real Rime rebuild of only a phrase file is observed even when compiled YAML bytes stay identical',{skip:process.platform!=='darwin'},async t=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),exec=promisify(execFile),binary='/Library/Input Methods/Squirrel.app/Contents/MacOS/rime_deployer';
 if(!await fs.access(binary).then(()=>true,()=>false)){t.skip('鼠须管未安装');return;}
 const store=await fixture(t);
 await fs.writeFile(path.join(store.sharedDir,'default.yaml'),'config_version: "1"\nschema_list: [{schema: test}]\n');
 await fs.writeFile(path.join(store.userDir,'test.schema.yaml'),'schema: {schema_id: test, name: 测试, version: "1"}\nengine: {processors: [speller, selector, express_editor], segmentors: [abc_segmentor], translators: [table_translator@phrases]}\nspeller: {alphabet: abcdefghijklmnopqrstuvwxyz}\nphrases: {dictionary: "", user_dict: phrases, db_class: stabledb}\n');
 await fs.writeFile(path.join(store.userDir,'phrases.txt'),'知键\tzj\t100\n');
 const build=()=>exec(binary,['--build',store.userDir,store.sharedDir,path.join(store.userDir,'build')],{timeout:10000});
 await build();const before=await fs.readFile(path.join(store.userDir,'build/test.schema.yaml'),'utf8'),baseline=await deploymentBaseline(store);
 await fs.writeFile(path.join(store.userDir,'phrases.txt'),'更新短语\tzj\t100\n');await recordDeploymentChanges(store,['phrases.txt']);baseline.pending=(await deploymentBaseline(store)).pending;await build();
 assert.equal(await fs.readFile(path.join(store.userDir,'build/test.schema.yaml'),'utf8'),before);
 const {diagnoseInput}=await import('../diagnosis.js');
 assert.equal((await observeDeployment(store,baseline,{wait:async()=>{},attempts:3,probe:body=>diagnoseInput(store,{appPath:'/Library/Input Methods/Squirrel.app'},store.dataDir,body)})).state,'resources-checked');
});
test('pending resource scope survives reload and fails closed on later edits or unsuccessful probes',async t=>{
 const store=await fixture(t);await fs.writeFile(path.join(store.userDir,'phrases.txt'),'知键\tzj\t100\n');await recordDeploymentChanges(store,['phrases.txt']);
 const baseline=await deploymentBaseline(store);assert.equal(baseline.pending[0].file,'phrases.txt');
 await fs.writeFile(path.join(store.userDir,'phrases.txt'),'外部修改\twb\t100\n');
 await assert.rejects(observeDeployment(store,baseline,{wait:async()=>{},attempts:3,probe:async()=>{throw new Error('不应试输');}}),/后来被修改/);
});
test('a failed fixed-resource candidate check runs once and cannot confirm a deployment',async t=>{
 const store=await fixture(t),schema='schema: {schema_id: test, name: 测试}\nengine: {translators: [table_translator@phrases]}\nphrases: {dictionary: "", user_dict: phrases, db_class: stabledb}\n';await fs.writeFile(path.join(store.userDir,'test.schema.yaml'),schema);await fs.writeFile(path.join(store.userDir,'build/test.schema.yaml'),schema+`__build_info: {timestamps: {test.schema: ${Math.floor(Date.now()/1000)+10}}}\n`);
 await fs.writeFile(path.join(store.userDir,'phrases.txt'),'知键\tzj\t100\n');await recordDeploymentChanges(store,['phrases.txt']);const baseline=await deploymentBaseline(store);baseline.targets.push('test.schema');baseline.expected['test.schema']={'test.schema':Math.floor(Date.now()/1000)};let probes=0;
 const result=await observeDeployment(store,baseline,{wait:async()=>{},attempts:5,probe:async()=>{probes++;return {trial:{compiled:true,candidates:[]}};}});assert.equal(result.state,'unconfirmed');assert.equal(probes,1);
});
