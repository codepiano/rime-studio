import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {ConfigStore} from '../config.js';
import {inventory,readDictionary,readPhrases,previewPhrases,readPersonalDictionary,previewPersonalDictionary} from '../library.js';
async function setup(t,{phrase=false}={}) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rime-library-')),userDir=path.join(root,'user'),sharedDir=path.join(root,'shared');await fs.mkdir(userDir);await fs.mkdir(sharedDir);
 await fs.writeFile(path.join(sharedDir,'default.yaml'),'schema_list: [{schema: test}]\n');await fs.writeFile(path.join(sharedDir,'squirrel.yaml'),'style: {}\n');
 await fs.writeFile(path.join(userDir,'test.schema.yaml'),YAML.stringify({schema:{schema_id:'test',name:'测试'},engine:{translators:['script_translator',...(phrase?['table_translator@custom_phrase']:[])]},translator:{dictionary:'base'},...(phrase?{custom_phrase:{dictionary:'',user_dict:'custom_phrase',db_class:'tabledb'}}:{})}));
 await fs.writeFile(path.join(sharedDir,'base.dict.yaml'),'---\nname: base\nversion: "1"\n...\n基础\tji chu\t100\n');
 t.after(()=>fs.rm(root,{recursive:true,force:true}));return new ConfigStore({userDir,sharedDir,dataDir:path.join(root,'backups')});
}
test('dictionary inventory links imports and schema roots, handles UTF-8 header and search',async t=>{
 const s=await setup(t);await fs.mkdir(path.join(s.userDir,'cn_dicts'));await fs.writeFile(path.join(s.userDir,'cn_dicts/extra.dict.yaml'),'---\nname: extra\nimport_tables: [base]\n...\n知键\tzhi jian\t200\n');
 const result=await inventory(s);assert.equal(result.schemas[0].dictionary,'base');assert.equal(result.dictionaries.length,2);
 const detail=await readDictionary(s,'cn_dicts/extra.dict.yaml','知');assert.equal(detail.rows[0].text,'知键');assert.equal(detail.rows[0].code,'zhi jian');assert.deepEqual(detail.imports,['base']);
 await assert.rejects(readDictionary(s,'../base.dict.yaml'));assert.equal((await readDictionary(s,'base.dict.yaml')).origin,'shared');
});
test('existing phrase table supports preview, backup, external edits and restore',async t=>{
 const s=await setup(t,{phrase:true});await fs.writeFile(path.join(s.userDir,'custom_phrase.txt'),'# 保留说明\n旧词\told\t10\n');
 const source=await readPhrases(s,'test'),p=await previewPhrases(s,{...source,text:'# 保留说明\n知键\tzj\t100\n'});
 assert.equal(p.files.length,1);assert.match((await readPhrases(s,'test')).text,/旧词/);
 const applied=await s.apply(p.id);assert.match((await readPhrases(s,'test')).text,/知键/);await s.restore(applied.id);assert.match((await readPhrases(s,'test')).text,/旧词/);
 await fs.appendFile(path.join(s.userDir,'custom_phrase.txt'),'外部\tout\t1\n');await assert.rejects(previewPhrases(s,{...source,text:'知键\tzj\t1\n'}),/已变化/);
});
test('new phrase table wires translator without losing existing settings',async t=>{
 const s=await setup(t);await fs.writeFile(path.join(s.userDir,'test.custom.yaml'),'# 保留\npatch:\n  menu/page_size: 6\n');const source=await readPhrases(s,'test');
 const p=await previewPhrases(s,{...source,text:'知键\tzj\t100\n'});await s.apply(p.id);
 const cfg=(await s.snapshot()).schemas[0].config;assert.deepEqual(cfg.engine.translators,['script_translator','table_translator@studio_phrases']);assert.equal(cfg.studio_phrases.user_dict,'studio_test_phrases');assert.equal(cfg.menu.page_size,6);assert.equal((await readPhrases(s,'test')).attached,true);
});
test('invalid rows and advanced overlays are rejected before writing',async t=>{
 const s=await setup(t),source=await readPhrases(s,'test');
 for(const text of ['无编码','字\tz\t-1','字\tz\t1\t多列','字\tz\t1\n字\tz\t2'])await assert.rejects(previewPhrases(s,{...source,text}));
 await fs.writeFile(path.join(s.userDir,'test.custom.yaml'),'patch:\n  engine/translators/+: [table_translator]\n');await assert.rejects(previewPhrases(s,{...await readPhrases(s,'test'),text:'字\tz\t1\n'}),/高级补丁/);
});
test('personal dictionary wraps upstream while preserving learned dictionary identity',async t=>{
 const s=await setup(t),source=await readPersonalDictionary(s,'test'),p=await previewPersonalDictionary(s,{...source,text:'知键\tzhi jian\t100\n'}),result=await s.apply(p.id);
 const cfg=(await s.snapshot()).schemas[0].config;assert.equal(cfg.translator.dictionary,'studio_test_extended');assert.equal(cfg.translator.user_dict,'base');
 assert.deepEqual((await readDictionary(s,'studio_test_extended.dict.yaml')).imports,['base','studio_test_personal']);assert.match((await readPersonalDictionary(s,'test')).text,/知键/);
 const next=await readPersonalDictionary(s,'test');const update=await previewPersonalDictionary(s,{...next,text:'新词\txin ci\t200\n'});await s.apply(update.id);assert.equal((await readDictionary(s,'studio_test_personal.dict.yaml')).rows[0].text,'新词');
 await assert.rejects(s.restore(result.id),/后来又被修改/);
});
test('dictionary search paginates without losing custom column order',async t=>{
 const s=await setup(t);await fs.writeFile(path.join(s.userDir,'many.dict.yaml'),'---\nname: many\ncolumns: [code, text, weight]\n...\n'+Array.from({length:205},(_,i)=>`code${i}\t词${i}\t${i}`).join('\n'));
 const first=await readDictionary(s,'many.dict.yaml'),second=await readDictionary(s,'many.dict.yaml','',100);assert.equal(first.rows.length,100);assert.equal(first.hasMore,true);assert.equal(second.rows[0].text,'词100');
});
test('personal extension expands aggregate dictionary imports and preserves compiler settings',async t=>{
 const s=await setup(t);await fs.writeFile(path.join(s.sharedDir,'base.dict.yaml'),'---\nname: base\nuse_preset_vocabulary: true\nimport_tables: [words]\n...\n');await fs.writeFile(path.join(s.sharedDir,'words.dict.yaml'),'---\nname: words\n...\n你好\tni hao\t100\n');
 const source=await readPersonalDictionary(s,'test'),p=await previewPersonalDictionary(s,{...source,text:'知键\tzhi jian\t100\n'});await s.apply(p.id);const text=await fs.readFile(path.join(s.userDir,'studio_test_extended.dict.yaml'),'utf8');assert.match(text,/use_preset_vocabulary: true/);assert.deepEqual((await readDictionary(s,'studio_test_extended.dict.yaml')).imports,['base','words','studio_test_personal']);
});
test('personal dictionary preview expires if an imported base table changes',async t=>{
 const s=await setup(t),source=await readPersonalDictionary(s,'test'),p=await previewPersonalDictionary(s,{...source,text:'字\tzi\t100\n'});
 await fs.appendFile(path.join(s.sharedDir,'base.dict.yaml'),'外部词\twai bu ci\t1\n');await assert.rejects(s.apply(p.id),/依赖.*已变化/);await assert.rejects(fs.stat(path.join(s.userDir,'studio_test_personal.dict.yaml')),/ENOENT/);
});

test('stable phrase tables use saved configuration instead of stale deployment and never attach twice',async t=>{
 const s=await setup(t);await fs.writeFile(path.join(s.userDir,'test.custom.yaml'),YAML.stringify({patch:{'engine/translators':['script_translator','table_translator@custom_phrase'],custom_phrase:{dictionary:'',user_dict:'shortcuts',db_class:'stabledb'}}}));
 await fs.mkdir(path.join(s.userDir,'build'));await fs.copyFile(path.join(s.userDir,'test.schema.yaml'),path.join(s.userDir,'build/test.schema.yaml'));
 const before='\uFEFF# 保留\r\n邮箱\tyx\r\n';await fs.writeFile(path.join(s.userDir,'shortcuts.txt'),before);
 const source=await readPhrases(s,'test');assert.equal(source.attached,true);assert.equal(source.file,'shortcuts.txt');
 const p=await previewPhrases(s,{...source,text:before+'地址\tdz\t20\r\n'});assert.deepEqual(p.files.map(x=>x.file),['shortcuts.txt']);const saved=await s.apply(p.id);await s.restore(saved.id);assert.equal(await fs.readFile(path.join(s.userDir,'shortcuts.txt'),'utf8'),before);
});
test('shared phrase table changes expire a preview and user copies can be restored to absence',async t=>{
 const s=await setup(t,{phrase:true});await fs.writeFile(path.join(s.sharedDir,'custom_phrase.txt'),'# 内置\n签名\tqm\n');
 let source=await readPhrases(s,'test');assert.equal(source.shared,true);const p=await previewPhrases(s,{...source,text:'签名\tqm\n地址\tdz\n'});
 await fs.appendFile(path.join(s.sharedDir,'custom_phrase.txt'),'外部\twb\n');await assert.rejects(s.apply(p.id),/依赖.*变化/);assert.equal((await readPhrases(s,'test')).exists,false);
 source=await readPhrases(s,'test');const saved=await s.apply((await previewPhrases(s,{...source,text:source.text+'邮箱\tyx\n'})).id);assert.equal((await readPhrases(s,'test')).shared,false);await s.restore(saved.id);assert.equal((await readPhrases(s,'test')).shared,true);
});
test('multiple fixed tables can be selected without accepting arbitrary files and expose sharing',async t=>{
 const s=await setup(t,{phrase:true}),config=YAML.parse(await fs.readFile(path.join(s.userDir,'test.schema.yaml'),'utf8'));config.engine.translators.push('table_translator@other');config.other={dictionary:'',user_dict:'other_phrases',db_class:'stabledb'};await fs.writeFile(path.join(s.userDir,'test.schema.yaml'),YAML.stringify(config));
 await fs.writeFile(path.join(s.userDir,'other.schema.yaml'),YAML.stringify({...config,schema:{schema_id:'other',name:'其他'}}));
 const source=await readPhrases(s,'test','other_phrases.txt');assert.equal(source.choices.length,2);assert.equal(source.usedBy.length,2);
 const p=await previewPhrases(s,{...source,text:'邮箱\tyx\t10\n邮编\tyx\t20\n'});assert.equal(p.metadata.duplicateCodes.length,1);assert.deepEqual(p.files.map(x=>x.file),['other_phrases.txt']);
 await assert.rejects(readPhrases(s,'test','outside.txt'),/当前方案/);
 await assert.rejects(readPhrases(s,'test','../other_phrases.txt'),/当前方案/);
});
test('phrase editor refuses configuration changes since reading and blank initial activation',async t=>{
 const s=await setup(t),source=await readPhrases(s,'test');await assert.rejects(previewPhrases(s,{...source,text:''}),/添加一条/);
 await fs.writeFile(path.join(s.userDir,'test.custom.yaml'),'patch:\n  menu/page_size: 7\n');await assert.rejects(previewPhrases(s,{...source,text:'邮箱\tyx\n'}),/方案配置已变化/);
});

test('a shared phrase file appearing after preview cannot be shadowed silently',async t=>{
 const s=await setup(t,{phrase:true}),source=await readPhrases(s,'test'),p=await previewPhrases(s,{...source,text:'邮箱\tyx\n'});
 await fs.writeFile(path.join(s.sharedDir,'custom_phrase.txt'),'后来提供的短语\txx\n');await assert.rejects(s.apply(p.id),/依赖.*变化/);await assert.rejects(fs.stat(path.join(s.userDir,'custom_phrase.txt')),/ENOENT/);
});
