import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ConfigStore} from '../config.js';
import {catalog,packagePreview,packageState} from '../packages.js';
const exec=promisify(execFile);
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rime-package-')),userDir=path.join(root,'user'),sharedDir=path.join(root,'shared'),source=path.join(root,'source');
 for(const dir of [userDir,sharedDir,source])await fs.mkdir(dir);
 await fs.writeFile(path.join(sharedDir,'default.yaml'),'schema_list: [{schema: old}]\n');await fs.writeFile(path.join(sharedDir,'squirrel.yaml'),'style: {}\n');await fs.writeFile(path.join(userDir,'old.schema.yaml'),'schema: {schema_id: old, name: 原方案}\n');
 await fs.writeFile(path.join(source,'rime_ice.schema.yaml'),'schema: {schema_id: rime_ice, name: 雾凇}\ntranslator: {dictionary: rime_ice}\n');
 await fs.writeFile(path.join(source,'rime_ice.dict.yaml'),'---\nname: rime_ice\n...\n雾凇\twu song\t100\n');await fs.writeFile(path.join(source,'default.yaml'),'schema_list: [{schema: rime_ice}]\n');await fs.writeFile(path.join(source,'custom_phrase.txt'),'上游短语\tup\t100\n');await fs.writeFile(path.join(source,'squirrel.custom.yaml'),'patch: {style/font_point: 50}\n');await fs.writeFile(path.join(source,'recipe.yaml'),'install: bad\n');
 await fs.mkdir(path.join(source,'lua'));await fs.writeFile(path.join(source,'lua/lunar.db'),Buffer.from([0,255,10,200]));
 await exec('git',['init',source]);await exec('git',['-C',source,'add','.']);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));return {source,store:new ConfigStore({userDir,sharedDir,dataDir:path.join(root,'backup')})};
}
const commit='a'.repeat(40);
test('package install is preview-only, preserves personal files, records provenance and can restore',async t=>{
 const {store:s,source}=await setup(t);await fs.writeFile(path.join(s.userDir,'custom_phrase.txt'),'我的短语\tmine\t1\n');await fs.writeFile(path.join(s.userDir,'squirrel.custom.yaml'),'patch: {style/font_point: 20}\n');
 const p=await packagePreview(s,catalog[0],source,commit);assert.equal((await packageState(s)).ice,undefined);assert.equal(p.files.some(x=>x.file==='custom_phrase.txt'),false);assert.equal(p.files.some(x=>x.file==='squirrel.custom.yaml'),false);assert.equal(p.files.some(x=>x.file==='recipe.yaml'),false);assert.equal(p.files.find(x=>x.file==='lua/lunar.db').binary,true);
 const r=await s.apply(p.id);assert.deepEqual((await s.snapshot()).enabled,['rime_ice','old']);assert.equal((await packageState(s)).ice.commit,commit);assert.match(await fs.readFile(path.join(s.userDir,'custom_phrase.txt'),'utf8'),/我的/);
 await s.restore(r.id);assert.equal((await packageState(s)).ice,undefined);assert.deepEqual((await s.snapshot()).enabled,['old']);await assert.rejects(fs.stat(path.join(s.userDir,'rime_ice.dict.yaml')),/ENOENT/);
});
test('package update preserves local edits and menu order, advances only installed file hashes',async t=>{
 const {store:s,source}=await setup(t);await s.apply((await packagePreview(s,catalog[0],source,commit)).id);
 await fs.appendFile(path.join(s.userDir,'rime_ice.dict.yaml'),'个人\tge ren\t1\n');
 await fs.writeFile(path.join(s.userDir,'default.custom.yaml'),'patch:\n  schema_list: [{schema: old}]\n');
 await fs.writeFile(path.join(source,'rime_ice.dict.yaml'),'---\nname: rime_ice\n...\n新词\txin ci\t100\n');
 const p=await packagePreview(s,catalog[0],source,'b'.repeat(40));assert.ok(p.metadata.conflicts.some(x=>x.file==='rime_ice.dict.yaml'));await s.apply(p.id);assert.match(await fs.readFile(path.join(s.userDir,'rime_ice.dict.yaml'),'utf8'),/个人/);assert.deepEqual((await s.snapshot()).enabled,['old']);
 const again=await packagePreview(s,catalog[0],source,'c'.repeat(40));assert.ok(again.metadata.conflicts.some(x=>x.file==='rime_ice.dict.yaml'));
});
test('dictionary-only update excludes schemas and global configuration',async t=>{
 const {store:s,source}=await setup(t);await assert.rejects(packagePreview(s,catalog[0],source,commit,{mode:'dictionaries',enable:false}),/完整安装/);await s.apply((await packagePreview(s,catalog[0],source,commit)).id);
 await fs.writeFile(path.join(source,'rime_ice.dict.yaml'),'---\nname: rime_ice\n...\n词库更新\tci ku geng xin\t100\n');
 const p=await packagePreview(s,catalog[0],source,'b'.repeat(40),{mode:'dictionaries',enable:false});assert.ok(p.files.every(x=>x.file.endsWith('.dict.yaml')||x.file==='.rime-studio-packages.json'));
});
test('package symlinks and malformed dictionaries are rejected',async t=>{
 const {store:s,source}=await setup(t);await fs.unlink(path.join(source,'rime_ice.dict.yaml'));await fs.symlink(path.join(s.sharedDir,'default.yaml'),path.join(source,'rime_ice.dict.yaml'));await assert.rejects(packagePreview(s,catalog[0],source,commit),/符号链接/);await fs.unlink(path.join(source,'rime_ice.dict.yaml'));await fs.writeFile(path.join(source,'rime_ice.dict.yaml'),'bad');await assert.rejects(packagePreview(s,catalog[0],source,commit),/头部/);
});
test('missing imported dictionary prevents an install preview',async t=>{
 const {store:s,source}=await setup(t);await fs.writeFile(path.join(source,'rime_ice.dict.yaml'),'---\nname: rime_ice\nimport_tables: [cn_dicts_cell/missing]\n...\n');await assert.rejects(packagePreview(s,catalog[0],source,commit),/缺少词库依赖/);assert.equal((await packageState(s)).ice,undefined);
});
