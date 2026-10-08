import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ConfigStore} from '../config.js';
import {previewFiles,readText} from '../file-transactions.js';
async function setup(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rime-resources-'));
 const userDir=path.join(root,'user'),sharedDir=path.join(root,'shared');
 await fs.mkdir(userDir);await fs.mkdir(sharedDir);
 await fs.writeFile(path.join(sharedDir,'default.yaml'),'schema_list: []\n');await fs.writeFile(path.join(sharedDir,'squirrel.yaml'),'style: {}\n');
 t.after(()=>fs.rm(root,{recursive:true,force:true}));return new ConfigStore({userDir,sharedDir,dataDir:path.join(root,'backups')});
}
test('resource preview/apply/restore preserves empty existing files and absent nested files',async t=>{
 const s=await setup(t);await fs.writeFile(path.join(s.userDir,'custom_phrase.txt'),'');
 const p=await previewFiles(s,[{file:'custom_phrase.txt',after:'知键\tzj\t10\n'},{file:'cn_dicts/studio.dict.yaml',after:'---\nname: studio\n...\n知键\tzhi jian\t10\n'}],[{title:'词库'}]);
 assert.equal(p.files[0].isNew,false);assert.equal((await readText(s.userDir,'cn_dicts/studio.dict.yaml')).exists,false);
 const r=await s.apply(p.id);assert.match((await readText(s.userDir,'custom_phrase.txt')).text,/知键/);
 await s.restore(r.id);assert.deepEqual(await readText(s.userDir,'custom_phrase.txt'),{text:'',exists:true});assert.equal((await readText(s.userDir,'cn_dicts/studio.dict.yaml')).exists,false);
});
test('resource apply refuses edits and new empty files made after preview',async t=>{
 const s=await setup(t),p=await previewFiles(s,[{file:'custom_phrase.txt',after:'字\tz\t1\n'}],[]);
 await fs.writeFile(path.join(s.userDir,'custom_phrase.txt'),'');await assert.rejects(s.apply(p.id),/文件已变化/);
});
test('resource restore refuses later dictionary modifications',async t=>{
 const s=await setup(t),p=await previewFiles(s,[{file:'x.dict.yaml',after:'first'}],[]),r=await s.apply(p.id);
 await fs.writeFile(path.join(s.userDir,'x.dict.yaml'),'later');await assert.rejects(s.restore(r.id),/后来又被修改/);
});
test('rejects traversal and symbolic parent directories',async t=>{
 const s=await setup(t);await fs.symlink(s.sharedDir,path.join(s.userDir,'cn_dicts'));
 for(const file of ['../outside.txt','cn_dicts/studio.dict.yaml','build/../../outside.txt'])await assert.rejects(previewFiles(s,[{file,after:'bad'}],[]));
 assert.deepEqual(await fs.readdir(s.sharedDir),['default.yaml','squirrel.yaml']);
});
test('multi-file failure rolls earlier writes back',async t=>{
 const s=await setup(t),p=await previewFiles(s,[{file:'a.txt',after:'a'},{file:'b.txt',after:'b'}],[]);
 const original=s.atomicWrite.bind(s);s.atomicWrite=async(dest,text)=>{if(dest.endsWith('b.txt'))throw new Error('injected failure');return original(dest,text);};
 await assert.rejects(s.apply(p.id),/injected/);assert.equal((await readText(s.userDir,'a.txt')).exists,false);assert.equal((await s.history()).length,0);
});
test('large dictionary previews return hashes and size without sending the corpus',async t=>{
 const s=await setup(t),p=await previewFiles(s,[{file:'big.dict.yaml',after:'知键\tzhi jian\t10\n'.repeat(6000)}],[]);
 assert.equal(p.files[0].summaryOnly,true);assert.equal(p.files[0].after,undefined);assert.equal(p.files[0].afterHash.length,64);
 const r=await s.apply(p.id);assert.ok(r.id);assert.equal((await readText(s.userDir,'big.dict.yaml')).text.length,'知键\tzhi jian\t10\n'.repeat(6000).length);
});
