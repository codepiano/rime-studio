import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import {safeConfigKeys} from './yaml-safety.js';
import {ConfigStore} from './config.js';
import {readText,safeFile,digest,previewFiles} from './file-transactions.js';
import {phraseFiles,dictionaryHeader} from './library.js';
import {phraseRows,phraseProblems} from './public/phrase-format.js';
import {withFileDiff} from './review-diff.js';
const marker='.rime-studio-dictionaries.json',fail=message=>{throw new Error(message);},maxBytes=20*1024*1024;
function dictionaryConfig(text){let value;try{value=JSON.parse(text);}catch{fail('词库管理记录不是有效 JSON');}if(value.version!==1||!value.schemas||typeof value.schemas!=='object'||Array.isArray(value.schemas))fail('词库管理记录无效');return value;}
export async function exportMigration(store){
 if(store.busy)fail('配置正在操作，请稍后导出');const snapshot=await store.snapshot(),files=[],seen=new Set(),warnings=['基础方案、上游词库、Lua 扩展、系统词典与真实学习数据库不包含在迁移包中；请先在目标电脑安装对应方案。'];let bytes=0;
 const names=['default.custom.yaml','squirrel.custom.yaml',marker,...snapshot.schemas.flatMap(schema=>[schema.id+'.custom.yaml',`studio_${schema.id}_personal.dict.yaml`,`studio_${schema.id}_extended.dict.yaml`,...phraseFiles(schema).map(x=>x.file)])];
 for(const file of names){if(seen.has(file))continue;seen.add(file);const resource=await readText(store.userDir,file);if(!resource.exists)continue;bytes+=Buffer.byteLength(resource.text);if(bytes>maxBytes||files.length>=200)fail('迁移包超过 20 MB 或 200 个文件');files.push({file,text:resource.text,hash:digest(resource.text)});}
 if(!files.length)fail('当前目录没有可导出的自定义设置、个人词条或用户短语');
 for(const item of files){const current=await readText(store.userDir,item.file);if(!current.exists||digest(current.text)!==item.hash)fail('文件在导出期间变化，请重试');}
 if((await store.snapshot()).revision!==snapshot.revision)fail('配置在导出期间变化，请重试');
 const bundle={format:'rime-studio-migration',version:1,createdAt:new Date().toISOString(),schemas:snapshot.schemas.map(x=>({id:x.id,name:x.name})),files,warnings};
 return {filename:'知键迁移-'+new Date().toISOString().slice(0,10)+'.json',text:JSON.stringify(bundle,null,2)+'\n',files:files.length,bytes,warnings};
}
function parseBundle(input){
 if(typeof input!=='string'||Buffer.byteLength(input)>maxBytes*1.5)fail('请导入不超过 30 MB 的知键 JSON 迁移包');let bundle;try{bundle=JSON.parse(input);}catch{fail('迁移包不是有效 JSON');}
 if(bundle.format!=='rime-studio-migration'||bundle.version!==1||!Array.isArray(bundle.schemas)||!Array.isArray(bundle.files)||!bundle.files.length||bundle.files.length>200||bundle.schemas.length>200)fail('不支持的迁移包格式或文件数量');
 if(bundle.schemas.some(x=>!x||typeof x.id!=='string'||! /^[a-z0-9_.-]+$/.test(x.id)||x.id.includes('..')))fail('迁移包方案名称无效');
 const seen=new Set();let bytes=0;for(const item of bundle.files){if(!item||typeof item.file!=='string'||typeof item.text!=='string'||item.text.includes('\0')||seen.has(item.file))fail('迁移包文件无效或重复');seen.add(item.file);bytes+=Buffer.byteLength(item.text);if(bytes>maxBytes)fail('迁移数据超过 20 MB');if(digest(item.text)!==item.hash)fail(`${item.file} 内容校验失败`);}
 return bundle;
}
async function inspectBundle(store,bundle){
 const dependencies=[],snapshot=await store.snapshot(),ids=new Set(snapshot.schemas.map(x=>x.id));
 const customAllowed=new Set(['default.custom.yaml','squirrel.custom.yaml',...bundle.schemas.map(x=>x.id+'.custom.yaml')]),dictAllowed=new Set(bundle.schemas.flatMap(x=>[`studio_${x.id}_personal.dict.yaml`,`studio_${x.id}_extended.dict.yaml`]));
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'rime-migration-check-'));
 try{
  // Read-only virtual configuration: no incoming file reaches the actual directory.
  for(const file of await fs.readdir(store.userDir))if(/^[a-z0-9_.-]+\.yaml$/.test(file)&&!file.endsWith('.dict.yaml')&&!['user.yaml','installation.yaml'].includes(file)){const current=await readText(store.userDir,file);await fs.writeFile(path.join(temp,file),current.text);}
  for(const item of bundle.files){await safeFile(temp,item.file);if(item.file.endsWith('.custom.yaml')){
   if(!customAllowed.has(item.file))fail('迁移包含有未声明的方案配置');const id=item.file.replace('.custom.yaml','');if(!['default','squirrel'].includes(id)&&!ids.has(id))fail(`请先在目标电脑安装方案 ${id}`);
   const doc=YAML.parseDocument(item.text),value=doc.toJS({maxAliasCount:100});safeConfigKeys(value);if(doc.errors.length||!value||typeof value!=='object'||!value.patch||typeof value.patch!=='object'||Array.isArray(value.patch))fail(`${item.file} 需要有效 patch 配置`);await fs.writeFile(path.join(temp,item.file),item.text);
  }}
  const virtual=new ConfigStore({userDir:temp,sharedDir:store.sharedDir,dataDir:path.join(temp,'backups')}),proposed=await virtual.snapshot(),phraseAllowed=new Set([...snapshot.schemas,...proposed.schemas].flatMap(x=>phraseFiles(x).map(p=>p.file)));
  if(proposed.enabled.some(id=>!ids.has(id)))fail('迁移包启用了未安装的输入方案，请先安装对应方案');
  for(const item of bundle.files){
   if(customAllowed.has(item.file))continue;
   if(dictAllowed.has(item.file)){if(!ids.has(item.file.replace(/^studio_/,'').replace(/_(personal|extended)\.dict\.yaml$/,'')))fail('迁移包个人词库对应的方案尚未安装');const head=dictionaryHeader(item.text);if(head.data.name+'.dict.yaml'!==item.file)fail('迁移词库名称与文件不一致');for(const name of head.imports){const file=name+'.dict.yaml';if(!bundle.files.some(x=>x.file===file)){const user=await readText(store.userDir,file),shared=await readText(store.sharedDir,file);if(!user.exists&&!shared.exists)fail(`请先安装迁移词库依赖 ${file}`);dependencies.push({file,origin:'user',exists:user.exists,hash:digest(user.text)},{file,origin:'shared',exists:shared.exists,hash:digest(shared.text)});}}
   }else if(item.file===marker){const registry=dictionaryConfig(item.text);if(Object.keys(registry.schemas).some(id=>!ids.has(id)))fail('词库管理记录含未安装方案');}
   else if(item.file.endsWith('.txt')&&phraseAllowed.has(item.file)){const rows=phraseRows(item.text);if(Buffer.byteLength(item.text)>100000||rows.length>2000||phraseProblems(rows).errors.length)fail('迁移短语表超过限制或格式无效');}
   else fail(`迁移包含有不支持的文件 ${item.file}`);
  }
  return {snapshot,proposed,dependencies};
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}
export class MigrationManager {
 constructor(store){this.store=store;this.plans=new Map();}
 async inspect(input){const bundle=parseBundle(input);const {snapshot,dependencies}=await inspectBundle(this.store,bundle),conflicts=[],guards=[];
  for(const item of bundle.files){const current=await readText(this.store.userDir,item.file);guards.push({file:item.file,exists:current.exists,hash:digest(current.text)});if(current.exists&&current.text!==item.text){const editable=Buffer.byteLength(current.text)+Buffer.byteLength(item.text)<=64000;conflicts.push({file:item.file,localHash:digest(current.text),incomingHash:item.hash,local:editable?current.text:null,incoming:editable?item.text:null,editable,diff:editable?withFileDiff({files:[{file:item.file,before:current.text,after:item.text}]}).files[0]:null});}}
  const id=crypto.randomUUID();for(const [key,value] of this.plans)if(Date.now()-value.created>600000)this.plans.delete(key);this.plans.set(id,{bundle,dependencies,revision:snapshot.revision,guards,created:Date.now()});return {id,files:bundle.files.map(x=>({file:x.file,bytes:Buffer.byteLength(x.text)})),conflicts,warnings:['基础方案和真实学习数据库未导入。现有不同文件默认保留，可逐项选择使用迁移包。']};
 }
 async preview({id,choices={}}){const plan=this.plans.get(id);if(!plan||Date.now()-plan.created>600000)fail('迁移检查已过期，请重新选择文件');const {bundle}=plan;const {snapshot}=await inspectBundle(this.store,bundle);if(snapshot.revision!==plan.revision)fail('目标配置已变化，请重新检查迁移包');
  if(!choices||typeof choices!=='object'||Array.isArray(choices)||Object.keys(choices).some(file=>!bundle.files.some(x=>x.file===file)))fail('无效的迁移文件选择');for(const guard of plan.dependencies){const data=await readText(guard.origin==='shared'?this.store.sharedDir:this.store.userDir,guard.file);if(data.exists!==guard.exists||digest(data.text)!==guard.hash)fail('迁移依赖在检查后变化，请重新检查');}
  const changes=[],kept=[];
  for(const item of bundle.files){const guard=plan.guards.find(x=>x.file===item.file),current=await readText(this.store.userDir,item.file);if(current.exists!==guard.exists||digest(current.text)!==guard.hash)fail('目标文件已变化，请重新检查迁移包');const choice=choices[item.file]||(current.exists&&current.text!==item.text?'keep':'import');if(!['keep','import'].includes(choice))fail('请选择保留本地或使用迁移包');if(choice==='keep'){kept.push(item.file);continue;}let text=item.text;
   if(item.file===marker&&current.exists){const local=dictionaryConfig(current.text),incoming=dictionaryConfig(item.text);text=JSON.stringify({...local,schemas:{...local.schemas,...incoming.schemas},imported:{...local.imported,...incoming.imported}},null,2)+'\n';}
   changes.push({file:item.file,after:text,expected:guard});
  }
  const result=await previewFiles(this.store,changes,[{title:'导入知键迁移包'}],{type:'migration',kept,createdAt:bundle.createdAt},plan.revision,[...plan.guards,...plan.dependencies]);this.plans.delete(id);return result;
 }
}
