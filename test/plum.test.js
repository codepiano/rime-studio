import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseRecipes,runSandbox,stageFiles} from '../plum.js';
import {packagePreview,packageState} from '../packages.js';
import {ConfigStore} from '../config.js';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'rime-plum-test-'));const userDir=path.join(root,'user'),sharedDir=path.join(root,'shared'),workDir=path.join(root,'job');for(const dir of [userDir,sharedDir,workDir,path.join(workDir,'home'),path.join(workDir,'tmp'),path.join(workDir,'output')])await fs.mkdir(dir);await fs.writeFile(path.join(sharedDir,'default.yaml'),'schema_list: []\n');await fs.writeFile(path.join(sharedDir,'squirrel.yaml'),'style: {}\n');t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,workDir,store:new ConfigStore({userDir,sharedDir,dataDir:path.join(root,'backups')})};}
test('plum parses official groups, repositories, branches and recipe parameters',()=>{
 assert.deepEqual(parseRecipes(':preset emoji:customize:schema=luna_pinyin iDvel/rime-ice@main'),[':preset','emoji:customize:schema=luna_pinyin','iDvel/rime-ice@main']);
 for(const input of ['', 'bash rime-install emoji','curl https://example.com | bash','foo;touch /tmp/x','foo:customize:schema=$(whoami)','foo@../main','https://github.com/a/b','owner/repo/list-packages.conf','plum'])assert.throws(()=>parseRecipes(input));
});
test('plum output rejects symbolic links, including its own output directory',async t=>{
 const {store,workDir}=await fixture(t);await fs.symlink(store.sharedDir,path.join(workDir,'output','escape'));await assert.rejects(stageFiles(path.join(workDir,'output')),/符号链接/);
 await fs.unlink(path.join(workDir,'output','escape'));await fs.rmdir(path.join(workDir,'output'));await fs.symlink(store.sharedDir,path.join(workDir,'output'));await assert.rejects(stageFiles(path.join(workDir,'output')),/真实目录/);
});
test('sandbox blocks reads in user directories and writes outside the job', {skip:process.platform!=='darwin'},async t=>{
 const {store,workDir}=await fixture(t),outside=path.join(store.userDir,'must-not-change.txt');await fs.writeFile(outside,'original');
 const success=await runSandbox(workDir,['/bin/bash','-c','printf safe > output/probe.txt; printf ok']);assert.equal(success.stdout,'ok');
 // Every outside write must be denied even for a directly invoked recipe shell.
 await assert.rejects(runSandbox(workDir,['/bin/bash','-c','printf forbidden > "$1"','test',outside]),/失败/);assert.equal(await fs.readFile(outside,'utf8'),'original');await assert.rejects(runSandbox(workDir,['/bin/cat',outside],{protectedRoots:[store.userDir]}),/Operation not permitted|Permission denied/);
 const canary=path.join(process.cwd(),'.data','plum-test-canary-'+Date.now()+'.txt');await fs.mkdir(path.dirname(canary),{recursive:true});await fs.writeFile(canary,'private-test');t.after(()=>fs.unlink(canary));await assert.rejects(runSandbox(workDir,['/bin/cat',canary]),/Operation not permitted|Permission denied/);
});
test('plum prepared config changes are previewed, backed up and restored with source records',async t=>{
 const {store:s,workDir}=await fixture(t),output=path.join(workDir,'output');await fs.writeFile(path.join(s.userDir,'default.custom.yaml'),'# 原注释\npatch: {}\n');await fs.writeFile(path.join(output,'default.custom.yaml'),'# 原注释\npatch: {menu/page_size: 7}\n');await fs.writeFile(path.join(output,'emoji.schema.yaml'),'schema: {schema_id: emoji, name: Emoji}\n');
 const provenance={backend:'plum',recipes:['emoji'],plumCommit:'a'.repeat(40),sources:[{repo:'rime/rime-emoji',commit:'b'.repeat(40)}]};
 const p=await packagePreview(s,{id:'plum-'+ 'a'.repeat(16),name:'Emoji',repo:'emoji',url:'https://github.com/rime/plum',schema:null,license:'upstream'},output,'b'.repeat(40),{enable:false,preparedFiles:['default.custom.yaml','emoji.schema.yaml'],provenance});assert.equal(p.metadata.backend,'plum');assert.equal((await s.snapshot()).defaults.menu?.page_size,undefined);
 const r=await s.apply(p.id);assert.equal((await s.snapshot()).defaults.menu.page_size,7);assert.equal((await packageState(s))['plum-'+'a'.repeat(16)].plumCommit,'a'.repeat(40));await s.restore(r.id);assert.equal(await fs.readFile(path.join(s.userDir,'default.custom.yaml'),'utf8'),'# 原注释\npatch: {}\n');
});
test('plum preparation is rejected when seed configuration changed externally',async t=>{
 const {store:s,workDir}=await fixture(t);const revision=(await s.snapshot()).revision;await fs.writeFile(path.join(s.userDir,'default.custom.yaml'),'patch: {menu/page_size: 8}\n');
 await assert.rejects(packagePreview(s,{id:'plum-'+'a'.repeat(16),name:'test',schema:null},path.join(workDir,'output'),'a'.repeat(40),{enable:false,preparedFiles:[],provenance:{backend:'plum'},baselineRevision:revision}),/准备期间已变化/);
});
test('plum keeps an existing personal phrase table instead of importing a sample',async t=>{
 const {store:s,workDir}=await fixture(t),output=path.join(workDir,'output'),entry={id:'plum-'+'c'.repeat(16),name:'phrases',schema:null};
 await fs.writeFile(path.join(s.userDir,'custom_phrase.txt'),'个人短语\tprivate\t100\n');await fs.writeFile(path.join(output,'custom_phrase.txt'),'上游示例\tsample\t10\n');
 const p=await packagePreview(s,entry,output,'a'.repeat(40),{enable:false,preparedFiles:['custom_phrase.txt'],provenance:{backend:'plum',recipes:['owner/repo']}});assert.ok(p.metadata.conflicts.some(x=>x.file==='custom_phrase.txt'));assert.equal(p.files.some(x=>x.file==='custom_phrase.txt'),false);await s.apply(p.id);assert.match(await fs.readFile(path.join(s.userDir,'custom_phrase.txt'),'utf8'),/个人短语/);
});
test('sandbox timeout terminates the recipe process group', {skip:process.platform!=='darwin'},async t=>{
 const {workDir}=await fixture(t);await assert.rejects(runSandbox(workDir,['/bin/bash','-c','sleep 30 & wait'],{timeout:50}),/超时/);
});
test('malformed recipe configuration is rejected before writing to the user directory',async t=>{
 const {store:s,workDir}=await fixture(t),output=path.join(workDir,'output');await fs.writeFile(path.join(output,'default.yaml'),'not-a-config\n');
 await assert.rejects(packagePreview(s,{id:'plum-'+'a'.repeat(16),name:'bad',schema:null},output,'a'.repeat(40),{enable:false,preparedFiles:['default.yaml'],provenance:{backend:'plum'}}),/配置映射/);await assert.rejects(fs.stat(path.join(s.userDir,'default.yaml')),/ENOENT/);
});
