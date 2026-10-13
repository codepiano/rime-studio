import {readText} from './file-transactions.js';
import {dictionaryHeader,parseRows,phraseFiles} from './library.js';
import {phraseRows} from './public/phrase-format.js';

export async function searchResources(store,query,{limit=120}={}) {
 if(typeof query!=='string'||!query.trim()||query.length>100)throw new Error('请输入 1–100 个字符的搜索内容');
 const terms=query.trim().toLowerCase().split(/\s+/),matches=text=>terms.every(t=>text.toLowerCase().includes(t));
 const snapshot=await store.snapshot(),results=[],warnings=[],seen=new Map();let total=0;
 const add=row=>{if(!matches([row.text,row.code,row.file,row.schemaName,row.dictionary].filter(Boolean).join(' ')))return;total++;if(results.length<limit)results.push(row);};
 for(const schema of snapshot.schemas){
  const common={schema:schema.id,schemaName:schema.name};
  try{
   const file=`studio_${schema.id}_personal.dict.yaml`,source=await readText(store.userDir,file);
   if(source.exists){if(Buffer.byteLength(source.text)>1024*1024)throw new Error('个人词库超过搜索大小限制');
    const {columns,body}=dictionaryHeader(source.text);
    for(const row of parseRows(body,columns))add({...row,...common,file,kind:'personal',source:'个人词库 · 已保存',origin:'user',target:{tab:'dictionaries',schema:schema.id,personal:true}});
   }
  }catch(error){warnings.push(`${schema.name}：${error.message}`);}
  for(const {file} of phraseFiles(schema)){
   if(seen.has(file)){const group=seen.get(file);group.schemas.push(common);continue;}
   const group={schemas:[common]};seen.set(file,group);
   try{let source=await readText(store.userDir,file),origin='user';if(!source.exists){source=await readText(store.sharedDir,file);origin='shared';}if(!source.exists)throw new Error(`短语表 ${file} 不存在`);if(Buffer.byteLength(source.text)>100000)throw new Error(`短语表 ${file} 超过搜索大小限制`);
    for(const row of phraseRows(source.text))add({...row,...common,schemas:group.schemas,file,kind:'phrase',origin,source:origin==='user'?'快捷短语 · 已保存':'快捷短语 · 内置只读',target:{tab:'phrases',schema:schema.id,file,q:query}});
   }catch(error){warnings.push(`${schema.name}：${error.message}`);}
  }
 }
 for(const db of store.learned?.cache?.values()||[]){
  for(const row of db.rows){if(row.deleted)continue;add({...row,kind:'learned',dictionary:db.name,source:db.source==='live'?'学习记录 · 最近读取':db.syncObserved?'学习记录 · 刚同步的只读快照':'学习记录 · 只读快照，可能过时',time:db.time,canDelete:false,target:{tab:'learned',dictionary:db.name,q:query,hideSingle:false}});}
 }
 if((await store.snapshot()).revision!==snapshot.revision)throw new Error('配置在搜索期间变化，请重试');
 return {query,results,total,hasMore:total>limit,warnings:warnings.slice(0,20),learnedLoaded:!!store.learned?.loaded,revision:snapshot.revision};
}
