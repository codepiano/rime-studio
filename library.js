import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {digest,readText,safeFile,previewFiles} from './file-transactions.js';
import {managedContext,managedChanges,activeTables,managementState} from './dictionary-management.js';
const fail = message => { throw new Error(message); };
const identifier = /^[a-z][a-z0-9_]*$/;
const tableName = /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/;
const editableName = name => typeof name==='string' && tableName.test(name) && !name.split('/').some(x=>x==='.'||x==='..');
export function dictionaryHeader(text) {
  const match = text.match(/^\.\.\.[ \t]*\r?$/m);
  if (!match) fail('词库缺少 YAML 头部结束标记 ...');
  const head = text.slice(0, match.index);
  const doc = YAML.parseDocument(head);
  if (doc.errors.length) fail('词库头部无法解析');
  const data = doc.toJS({maxAliasCount:100});
  if(data && typeof data.name==='number')data.name=String(data.name);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !editableName(data.name || '')) fail('词库名称无效');
  const columns = data.columns || ['text','code','weight'];
  if (!Array.isArray(columns) || columns.some(x=>typeof x!=='string') || !columns.includes('text') || new Set(columns).size!==columns.length) fail('词库列定义无效');
  const imports = data.import_tables || [];
  if (!Array.isArray(imports) || imports.some(x=>typeof x!=='string'||!editableName(x))) fail('词库引用无效');
  return {data, columns, imports, body:text.slice(match.index + match[0].length).replace(/^\r?\n/,'')};
}
export function parseRows(text, columns=['text','code','weight']) {
  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.startsWith('#')) continue;
    const cells = line.split('\t');
    const row = {line:index+1, text:cells[columns.indexOf('text')]||'', code:cells[columns.indexOf('code')]||'', weight:cells[columns.indexOf('weight')]||''};
    rows.push(row);
  }
  return rows;
}
function configFor(schema) { return schema.deployed ? schema.deployedConfig : schema.config; }
export function phraseFiles(schema) {
  const config = configFor(schema), result=[];
  for (const item of config.engine?.translators || []) {
    if (typeof item !== 'string' || !item.startsWith('table_translator@')) continue;
    const key=item.slice('table_translator@'.length), table=config[key];
    if (table?.db_class === 'tabledb' && editableName(table.user_dict || '')) result.push({key, file:table.user_dict.endsWith('.txt')?table.user_dict:table.user_dict+'.txt'});
  }
  return result;
}
async function scan(root, prefix='', depth=0) {
  if (depth>4) return [];
  const files=[];
  for (const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true}).catch(()=>[])) {
    if (entry.name.startsWith('.') || ['build','sync','backup','trash','node_modules'].includes(entry.name) || entry.name.endsWith('.userdb')) continue;
    const name=prefix?prefix+'/'+entry.name:entry.name;
    if (!editableName(name)) continue;
    if (entry.isFile() && name.endsWith('.dict.yaml')) files.push(name);
    else if (entry.isDirectory()) files.push(...await scan(root,name,depth+1));
    if (files.length>500) fail('词库数量超过 500');
  }
  return files;
}
async function headerFile(root,file) {
  const handle=await fs.open(await safeFile(root,file),'r');
  try {const buffer=Buffer.alloc(65536),{bytesRead}=await handle.read(buffer,0,buffer.length,0);return {...dictionaryHeader(buffer.subarray(0,bytesRead).toString('utf8')) ,bytes:(await handle.stat()).size};} finally {await handle.close();}
}
export async function inventory(store) {
  const snapshot=await store.snapshot(), dictionaries=[], seen=new Set();
  for (const [origin,root] of [['user',store.userDir],['shared',store.sharedDir]]) for (const file of await scan(root)) {
    if(seen.has(file))continue;seen.add(file);
    try {const header=await headerFile(root,file);dictionaries.push({file,origin,name:header.data.name,version:String(header.data.version||''),imports:header.imports,bytes:header.bytes});}
    catch(error){dictionaries.push({file,origin,error:error.message});}
  }
  const registry=(await managementState(store)).data;const schemas=[];for(const schema of snapshot.schemas){const cfg=schema.config;let tables=[],error='';try{tables=await activeTables(store,schema);}catch(e){error=e.message;}schemas.push({id:schema.id,name:schema.name,dictionary:cfg.translator?.dictionary||'',phrases:phraseFiles(schema),source:'source',originalDictionary:cfg.translator?.dictionary===`studio_${schema.id}_extended`?(registry.schemas?.[schema.id]?.original||tables[1]||cfg.translator.dictionary):(cfg.translator?.dictionary||''),tables,error});}
  return {dictionaries,schemas};
}
export async function readDictionary(store,file,query='',offset=0) {
  if (typeof file!=='string'||!file.endsWith('.dict.yaml')||!editableName(file)) fail('无效词库文件');
  if(typeof query!=='string'||query.length>100||!Number.isSafeInteger(offset)||offset<0)fail('无效查询');
  let source=await readText(store.userDir,file),origin='user';
  if(!source.exists){source=await readText(store.sharedDir,file);origin='shared';}
  if(!source.exists)fail('词库不存在');
  const {data,columns,imports,body}=dictionaryHeader(source.text),rows=[];
  let total=0,matched=0,lineNumber=0;
  for(const line of body.split(/\r?\n/)){
    lineNumber++;if(!line.trim()||line.startsWith('#'))continue;total++;
    const cells=line.split('\t'),row={line:lineNumber,text:cells[columns.indexOf('text')]||'',code:cells[columns.indexOf('code')]||'',weight:cells[columns.indexOf('weight')]||''};
    if(!query||row.text.includes(query)||row.code.includes(query)){if(matched>=offset&&rows.length<100)rows.push(row);matched++;}
  }
  return {file,origin,name:data.name,columns,imports,total,matched,rows,offset,hasMore:matched>offset+100,hash:digest(source.text)};
}
async function selected(store,id) {const snapshot=await store.snapshot(),schema=snapshot.schemas.find(x=>x.id===id);if(!schema)fail('请选择已安装方案');return {snapshot,schema};}
export async function readPhrases(store,id) {
  const {schema}=await selected(store,id), choices=phraseFiles(schema);
  if(choices.length>1)fail('方案引用了多个短语表，暂不支持合并编辑');
  const file=choices[0]?.file||`studio_${id}_phrases.txt`;
  const source=await readText(store.userDir,file);
  let shared=false;
  if(!source.exists){const inherited=await readText(store.sharedDir,file);if(inherited.exists){source.text=inherited.text;shared=true;}}
  if(Buffer.byteLength(source.text)>100000)fail('短语表超过 100 KB，请使用外部编辑器');
  return {schema:id,file,text:source.text,rows:parseRows(source.text),hash:digest(source.text),exists:source.exists,shared,attached:!!choices.length};
}
export function patchText(text, values) {
  const doc=YAML.parseDocument(text||'patch: {}\n');
  if(doc.errors.length)fail('自定义配置无法解析');
  if(!doc.has('patch'))doc.set('patch',{});
  const patch=doc.get('patch',true);
  if(!YAML.isMap(patch))fail('patch 必须是映射');
  for(const [key,value] of Object.entries(values)) {
    // Refuse ancestor/descendant overlays; choosing one silently can change patch semantics.
    for(const pair of patch.items){const old=String(pair.key.value);if(old!==key&&(old.startsWith(key+'/')||key.startsWith(old+'/')))fail(`配置包含 ${old} 的整段或高级补丁，请先整理冲突`);}
    doc.setIn(['patch',key],value);
  }
  return String(doc);
}
function validateRows(text) {
  if(typeof text!=='string'||Buffer.byteLength(text)>100000||text.includes('\0'))fail('请输入不超过 100 KB 的短语或词条');
  const rows=parseRows(text),seen=new Set();
  if(rows.length>2000)fail('最多支持 2000 条');
  for(const row of rows){if(!row.text||!row.code||/[\t\r\n]/.test(row.text)||row.text.length>500||row.code.length>120||!/^[a-zA-Z0-9 /;,.`'_-]+$/.test(row.code))fail(`第 ${row.line} 行需要文字和有效编码，以 Tab 分隔`);if(row.weight&&!/^\d{1,9}$/.test(row.weight))fail(`第 ${row.line} 行权重需为非负整数`);const key=row.text+'\0'+row.code;if(seen.has(key))fail(`第 ${row.line} 行词条重复`);seen.add(key);}
  for(const line of text.split(/\r?\n/))if(line.trim()&&!line.startsWith('#')&&line.split('\t').length>3)fail('每行最多三列：文字、编码、权重');
  return rows;
}
export async function previewPhrases(store, body) {
  validateRows(body.text);
  const revision=(await store.snapshot()).revision;
  const current=await readPhrases(store,body.schema);
  if(current.hash!==body.hash||current.exists!==body.exists)fail('短语表已变化，请重新读取');
  const changes=[{file:current.file,after:body.text,expected:{hash:current.exists?current.hash:digest(''),exists:current.exists}}];
  if(!current.attached){
    const {schema}=await selected(store,body.schema),cfg=configFor(schema),custom=`${body.schema}.custom.yaml`,source=await readText(store.userDir,custom);
    const translators=cfg.engine?.translators;
    if(!Array.isArray(translators)||translators.some(x=>typeof x!=='string'))fail('无法识别方案翻译器，请先部署方案');
    if(cfg.studio_phrases)fail('方案已占用 studio_phrases 名称');
    changes.push({file:custom,after:patchText(source.text,{'engine/translators':[...translators,'table_translator@studio_phrases'],studio_phrases:{dictionary:'',user_dict:current.file.replace(/\.txt$/,''),db_class:'tabledb',enable_completion:false,enable_sentence:false,initial_quality:1}}),expected:{hash:digest(source.text),exists:source.exists}});
  }
  return previewFiles(store,changes,[{title:'快捷短语',schema:body.schema,file:current.file}],{type:'phrases'},revision);
}
export async function previewPersonalDictionary(store,body) {
 if(!identifier.test(body.schema||''))badSchema();const rows=validateRows(body.text),context=await managedContext(store,body.schema),name=context.personal,file=name+'.dict.yaml',current=await readText(store.userDir,file);
 if(!rows.length&&!current.exists)fail('没有需要保存的个人词条');if(body.hash!==digest(current.text)||body.exists!==current.exists)fail('个人词库已变化，请重新读取');
 if(context.base.header.columns.some(x=>!['text','code','weight'].includes(x))||!context.base.header.columns.includes('code'))fail('此词库使用特殊列结构，暂不支持个人扩展');
 const after=`# 由知键维护的个人词库\n---\nname: ${name}\nversion: "1"\nsort: by_weight\ncolumns: [text, code, weight]\n...\n`+rows.map(row=>[row.text,row.code,row.weight||'100'].join('\t')).join('\n')+'\n',virtual=new Map([[name,after]]),planned=await managedChanges(store,context,{virtual,personalExists:true});
 return previewFiles(store,[{file,after,expected:{hash:digest(current.text),exists:current.exists}},...planned.changes],[{title:rows.length?'个人扩展词库':'清空个人扩展词库',schema:body.schema,file}],{type:'personal-dictionary'},context.snapshot.revision,planned.guards);
}
function badSchema(){fail('无效方案');}
export async function readPersonalDictionary(store,id) {
  await selected(store,id);if(!identifier.test(id))fail('无效方案');
  const file=`studio_${id}_personal.dict.yaml`,source=await readText(store.userDir,file);
  return {schema:id,file,text:source.exists?dictionaryHeader(source.text).body:'',hash:digest(source.text),exists:source.exists};
}
