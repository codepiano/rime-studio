import fs from 'node:fs/promises';
import path from 'node:path';
import {safeFile,presentPreview} from './file-transactions.js';
const uuid=/^[a-f0-9-]{36}$/,indexes=new Map();
export async function backupRecord(store,id){
 if(!uuid.test(id||''))throw new Error('无效备份 ID');const file=await safeFile(store.dataDir,id+'/record.json'),stat=await fs.stat(file);if(stat.size>512*1024*1024)throw new Error('备份记录超过浏览大小限制');
 const record=JSON.parse(await fs.readFile(file,'utf8'));if(record.id!==id||!Array.isArray(record.files)||!Array.isArray(record.summary)||typeof record.time!=='string')throw new Error('备份记录格式无效');return {record,stat};
}
function brief(record){
 const kind=record.kind==='learned'?'learned':record.metadata?.type==='package'?'package':record.metadata?.type==='migration'?'migration':record.kind==='resources'?'resources':'settings';
 const status=record.failed?'failed':record.restored?'restored':record.uncertain||record.pending?'uncertain':'saved';
 return {id:record.id,time:record.time,restored:record.restored||null,kind,status,summary:record.summary,files:record.files.map(x=>x.file),restorable:!record.failed&&!record.restored,uncertain:status==='uncertain'};
}
export async function queryHistory(store,{q='',kind='',status='',offset=0,limit=20}={}){
 if(typeof q!=='string'||q.length>100||!['','settings','resources','package','learned','migration'].includes(kind)||!['','saved','restored','uncertain','failed'].includes(status)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('无效备份查询');
 const entries=await fs.readdir(store.dataDir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});let cache=indexes.get(store.dataDir);if(!cache){cache=new Map();indexes.set(store.dataDir,cache);}const rows=[],warnings=[];
 for(const entry of entries.filter(x=>uuid.test(x.name))){
  try{const full=await safeFile(store.dataDir,entry.name+'/record.json'),st=await fs.stat(full),key=st.mtimeMs+':'+st.size;let item=cache.get(entry.name);
   if(!item||item.key!==key){item={key,row:brief((await backupRecord(store,entry.name)).record)};cache.set(entry.name,item);}rows.push(item.row);
  }catch(error){warnings.push(`${entry.name}：${error.message}`);}
 }
 const terms=q.trim().toLowerCase().split(/\s+/).filter(Boolean),matches=rows.filter(row=>(!kind||row.kind===kind)&&(!status||row.status===status)&&terms.every(term=>[row.id,...row.files,...row.summary.map(x=>[x.title,x.schema,x.file].filter(Boolean).join(' '))].join(' ').toLowerCase().includes(term))).sort((a,b)=>b.time.localeCompare(a.time)||b.id.localeCompare(a.id));
 return {rows:matches.slice(offset,offset+limit),total:matches.length,all:rows.length,offset,limit,hasMore:matches.length>offset+limit,warnings};
}
export async function historyDetail(store,id){
 const {record}=await backupRecord(store,id),meta=brief(record),preview=presentPreview({...record,files:record.files.map(f=>({...f,encoding:f.encoding||'utf8',beforeExists:f.beforeExists??!!f.before,afterExists:f.afterExists??true}))});
 return {...meta,metadata:record.metadata||{},files:preview.files,groups:record.kind==='learned'?(record.groups||[]).map(x=>({name:x.name,count:x.rows?.length||0})):[]};
}
