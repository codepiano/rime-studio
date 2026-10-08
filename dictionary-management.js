import path from 'node:path';
import YAML from 'yaml';
import {readText,digest,previewFiles} from './file-transactions.js';
import {dictionaryHeader,patchText} from './library.js';
const fail=message=>{throw new Error(message);},marker='.rime-studio-dictionaries.json';
const valid=name=>typeof name==='string'&&/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name)&&!name.split('/').some(x=>x==='.'||x==='..');
export async function managementState(store){const source=await readText(store.userDir,marker);let data={version:1,schemas:{},imported:{}};if(source.exists){try{data=JSON.parse(source.text);}catch{fail('词库管理记录无法解析');}if(data.version!==1||!data.schemas||typeof data.schemas!=='object'||Array.isArray(data.schemas))fail('词库管理记录格式不受支持');}return {source,data};}
async function resource(store,name,virtual=new Map()){
 if(!valid(name))fail('无效词库名称');const file=name+'.dict.yaml';let source=await readText(store.userDir,file),origin='user';
 if(!source.exists){source=await readText(store.sharedDir,file);origin='shared';}
 const text=virtual.has(name)?virtual.get(name):source.text;if(!text)fail(`缺少词库 ${name}`);
 return {name,file,origin,source,text,header:dictionaryHeader(text),guard:{origin,file,exists:source.exists,hash:digest(source.text)}};
}
export async function managedContext(store,id,virtual=new Map()){
 if(typeof id!=='string'||!/^[a-z][a-z0-9_.-]*$/.test(id)||id.includes('..'))fail('无效方案');
 const snapshot=await store.snapshot(),schema=snapshot.schemas.find(x=>x.id===id);if(!schema)fail('请选择已安装方案');const cfg=schema.config,dictionary=cfg.translator?.dictionary;if(!valid(dictionary||''))fail('所选方案没有可管理的主词库');
 const state=await managementState(store),wrapper=`studio_${id}_extended`,personal=`studio_${id}_personal`,own=await readText(store.userDir,wrapper+'.dict.yaml'),saved=Object.hasOwn(state.data.schemas,id)?state.data.schemas[id]:null;
 let original=dictionary;
 if(dictionary===wrapper){if(!own.exists)fail('独立扩展入口缺失');original=saved?.original||dictionaryHeader(own.text).imports.find(x=>x!==personal);if(!valid(original||'')||original===wrapper)fail('独立扩展入口没有基础词库');}
 else if(own.exists&&!own.text.includes('# 独立扩展入口'))fail('已存在同名词库入口，不能自动接管');
 const record=saved&&saved.original===original?saved:{original,disabled:[],extra:[]};if(!Array.isArray(record.disabled)||!Array.isArray(record.extra)||[...record.disabled,...record.extra].some(x=>!valid(x)))fail('词库管理记录无效');
 if(record.disabled.includes(original))fail('管理记录不能停用主词库');const base=await resource(store,original,virtual);return {id,schema,cfg,snapshot,state,wrapper,personal,own,original,base,record:{original,disabled:[...record.disabled],extra:[...record.extra]},virtual};
}
export async function managedChanges(store,context,{virtual=context.virtual,personalExists=null}={}){
 const {id,cfg,wrapper,personal,own,original,record,state}=context,disabled=new Set(record.disabled),tables=[],guards=[],seen=new Set(),visiting=new Set();
 async function walk(name){if(disabled.has(name))return;if(visiting.has(name))fail('词库引用循环');if(seen.has(name))return;visiting.add(name);const item=await resource(store,name,virtual);tables.push(name);guards.push(item.guard);for(const child of item.header.imports)await walk(child);visiting.delete(name);seen.add(name);}
 await walk(original);for(const name of record.extra)await walk(name);
 const personalSource=await readText(store.userDir,personal+'.dict.yaml');if(personalExists??(personalSource.exists||virtual.has(personal)))await walk(personal);
 const header={...context.base.header.data,name:wrapper,version:'1',import_tables:tables};const custom=id+'.custom.yaml',source=await readText(store.userDir,custom);
 state.data.schemas[id]=record;
 return {changes:[{file:wrapper+'.dict.yaml',after:'# 独立扩展入口，保留上游词库\n---\n'+YAML.stringify(header)+'...\n',expected:{hash:digest(own.text),exists:own.exists}},{file:custom,after:patchText(source.text,{'translator/dictionary':wrapper,'translator/user_dict':cfg.translator?.user_dict||original}),expected:{hash:digest(source.text),exists:source.exists}},{file:marker,after:JSON.stringify(state.data,null,2)+'\n',expected:{hash:digest(state.source.text),exists:state.source.exists}}],guards};
}
export async function activeTables(store,schema){
 const name=schema.config.translator?.dictionary||schema.deployedConfig?.translator?.dictionary;if(!valid(name||''))return [];
 const item=await resource(store,name);return [...new Set([name,...item.header.imports])];
}
function namedDictionaries(config){const names=new Set();function walk(value){if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if((key==='dictionary'||key==='reverse_lookup')&&typeof child==='string'&&valid(child))names.add(child);else if(typeof child==='object')walk(child);}}walk(config);return [...names];}
export async function dictionaryReferences(store,name){
 if(!valid(name))fail('无效词库名称');const snapshot=await store.snapshot(),references=[],guards=[];
 for(const schema of snapshot.schemas){for(const root of [...new Set([...namedDictionaries(schema.config),...namedDictionaries(schema.deployedConfig||{})])]){
  try{const item=await resource(store,root);guards.push(item.guard);if(root===name||item.header.imports.includes(name)){references.push({schema:schema.id,name:schema.name,root,primary:root===name});break;}}catch(error){fail(`无法确认 ${schema.name} 的词库依赖：${error.message}`);}
 }}return {references,guards,revision:snapshot.revision};
}
export async function previewDictionaryAction(store,body){
 const name=body.file?.replace(/\.dict\.yaml$/,'');if(!valid(name||'')||body.file!==name+'.dict.yaml')fail('无效词库文件');
 const target=await resource(store,name);
 if(body.action==='delete'){
  if(target.origin!=='user')fail('内置词库不能删除，只能在方案中停用');if(body.hash!==digest(target.source.text))fail('词库已变化，请重新读取');const refs=await dictionaryReferences(store,name);if(refs.references.length)fail('词库仍被这些方案引用：'+refs.references.map(x=>x.name).join('、'));
  const state=await managementState(store);delete (state.data.imported||{})[body.file];
  const fallback=await readText(store.sharedDir,body.file);
  return previewFiles(store,[{file:body.file,after:'',afterExists:false,expected:{hash:body.hash,exists:true}},{file:marker,after:JSON.stringify(state.data,null,2)+'\n',expected:{hash:digest(state.source.text),exists:state.source.exists}}],[{title:'卸载用户词库',file:body.file}],{type:'dictionary-delete',fallback:fallback.exists},refs.revision,refs.guards);
 }
 if(!['enable','disable'].includes(body.action))fail('无效词库操作');const context=await managedContext(store,body.schema);if(name===context.original&&body.action==='disable')fail('主词库不能停用，请管理其扩展词库或切换输入方案');
 const current=await activeTables(store,context.schema);
 if(body.action==='disable'){if(!current.includes(name))fail('词库没有在当前方案中使用');context.record.disabled=[...new Set([...context.record.disabled,name])];}
 else{context.record.disabled=context.record.disabled.filter(x=>x!==name);if(!current.includes(name)&&name!==context.personal&&!context.base.header.imports.includes(name))context.record.extra=[...new Set([...context.record.extra,name])];}
 const planned=await managedChanges(store,context);
 return previewFiles(store,planned.changes,[{title:body.action==='enable'?'启用词库':'停用词库',schema:body.schema,file:body.file}],{type:'dictionary-toggle'},context.snapshot.revision,[...planned.guards,target.guard]);
}
export async function previewDictionaryInstall(store,body){
 if(typeof body.text!=='string'||Buffer.byteLength(body.text)>20*1024*1024||body.text.includes('\0')||typeof body.activate!=='boolean')fail('需要不超过 20 MB 的 UTF-8 Rime 词库');
 const header=dictionaryHeader(body.text),name=header.data.name,file=name+'.dict.yaml',source=await readText(store.userDir,file),revision=(await store.snapshot()).revision;
 const virtual=new Map([[name,body.text]]),state=await managementState(store),changes=[{file,after:body.text,expected:{hash:digest(source.text),exists:source.exists}}],guards=[];
 state.data.imported=state.data.imported||{};state.data.imported[file]={name,time:new Date().toISOString()};
 for(const dependency of header.imports)guards.push((await resource(store,dependency,virtual)).guard);
 if(body.activate){const context=await managedContext(store,body.schema,virtual);if(context.wrapper===name||context.original===name)fail('请使用扩展词库名称，不能用导入功能替换当前主词库');context.state.data.imported=state.data.imported;context.record.extra=[...new Set([...context.record.extra,name])];context.record.disabled=context.record.disabled.filter(x=>x!==name);const planned=await managedChanges(store,context,{virtual});changes.push(...planned.changes);guards.push(...planned.guards);}
 else changes.push({file:marker,after:JSON.stringify(state.data,null,2)+'\n',expected:{hash:digest(state.source.text),exists:state.source.exists}});
 return previewFiles(store,changes,[{title:'安装独立词库',file,schema:body.activate?body.schema:null}],{type:'dictionary-install'},revision,guards);
}
