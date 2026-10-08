import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {digest,readText} from './file-transactions.js';
const exec=promisify(execFile),fail=message=>{throw new Error(message);};
const valid=name=>typeof name==='string'&&/^[\p{L}\p{N}_][\p{L}\p{N}_. -]{0,100}$/u.test(name)&&!name.includes('..');
const rowId=(name,code,text)=>digest(name+'\0'+code+'\0'+text);
const sourceFile=fileURLToPath(new URL('./native/db-lock.c',import.meta.url));
export function parseSnapshot(text,name){
 const meta={},rows=[];
 for(const line of text.split(/\r?\n/)){
  if(line.startsWith('#@/')){const at=line.indexOf('\t');if(at>0)meta[line.slice(3,at)]=line.slice(at+1);continue;}
  if(!line.trim()||line.startsWith('#'))continue;
  const parts=line.split('\t');if(parts.length!==3)fail('学习词典快照格式无效');
  const code=parts[0].trim(),word=parts[1],values=Object.fromEntries(parts[2].split(' ').map(item=>item.split('=')));
  if(!code||!word||!/^-?\d+$/.test(values.c||''))fail('学习词条格式无效');
  const count=Number(values.c);if(!Number.isSafeInteger(count)||word.length>2000||code.length>2000)fail('学习词条超出限制');
  rows.push({id:rowId(name,code,word),dictionary:name,text:word,code,count,deleted:count<0});
 }
 if(meta.db_type!=='userdb'||(meta.db_name!==name&&meta.db_name?.replace(/\.userdb(?:\.txt)?$/,'')!==name))fail('快照与所选学习词典不匹配');
 if(new Set(rows.map(row=>row.id)).size!==rows.length)fail('学习词条重复');
 const basis=Object.entries(meta).sort().map(([k,v])=>`${k}\t${v}`).join('\n')+'\n'+text.split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).sort().join('\n');
 return {meta,rows,hash:digest(basis)};
}
function rewriteCounts(text,name,rows,toDeleted){
 const counts=new Map(rows.map(row=>[row.id,toDeleted?-Math.max(1,row.count):row.count]));
 return text.split(/\r?\n/).map(line=>{if(!line||line.startsWith('#'))return line;const cells=line.split('\t'),id=rowId(name,cells[0].trim(),cells[1]);if(counts.has(id))cells[2]=cells[2].replace(/(^| )c=-?\d+(?= |$)/,(_,space)=>space+'c='+counts.get(id));return cells.join('\t');}).join('\n');
}
function compatibleDeletion(group,current){
 if(current.hash===group.beforeHash)return true;
 const rows=new Map(current.rows.map(row=>[row.id,row]));
 if(group.rows.some(row=>!rows.has(row.id)||![row.count,-Math.max(1,row.count)].includes(rows.get(row.id).count)))return false;
 return parseSnapshot(rewriteCounts(current.text,group.name,group.rows,false),group.name).hash===group.beforeHash;
}
async function regularDirectory(dir){const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())fail('学习数据库必须是真实目录');return dir;}
async function databaseFiles(dir){
 await regularDirectory(dir);const result=[];let bytes=0;
 for(const file of await fs.readdir(dir)){if(!/^[a-zA-Z0-9_.-]+$/.test(file))fail('数据库文件名无效');const stat=await fs.lstat(path.join(dir,file));if(!stat.isFile()||stat.isSymbolicLink())fail('数据库包含特殊文件或链接');bytes+=stat.size;if(bytes>256*1024*1024||result.length>=1000)fail('学习数据库超过备份限制');result.push(file);}
 return result.sort();
}
async function treeHash(dir){const list=[];for(const file of await databaseFiles(dir))list.push([file,digest(await fs.readFile(path.join(dir,file)))]);return digest(JSON.stringify(list));}
async function copyDatabase(source,dest){await fs.mkdir(dest,{recursive:true,mode:0o700});for(const file of await databaseFiles(source)){await fs.copyFile(path.join(source,file),path.join(dest,file));await fs.chmod(path.join(dest,file),0o600);}}
async function replaceDatabase(source,dest){
 const wanted=await databaseFiles(source),current=await databaseFiles(dest);
 // Preserve the locked inode throughout restore; all other processes remain excluded.
 for(const file of current)if(file!=='LOCK'&&!wanted.includes(file))await fs.unlink(path.join(dest,file));
 for(const file of wanted)if(file!=='LOCK'){const temp=path.join(dest,'.studio-'+crypto.randomUUID());await fs.copyFile(path.join(source,file),temp);await fs.chmod(temp,0o600);await fs.rename(temp,path.join(dest,file));}
}
export class LearnedManager{
 constructor(store,{tool=null,workDir=path.join(store.dataDir,'learned-cache')}={}){this.store=store;this.tool=tool;this.workDir=workDir;this.cache=new Map();this.loaded=false;this.busy=false;store.learned=this;}
 async helper(){
  if(!this.tool)fail('没有检测到鼠须管词典管理工具');
  const source=await fs.readFile(sourceFile),dir=path.join(this.workDir,'native',digest(source).slice(0,16)),binary=path.join(dir,'db-lock');
  if(await fs.stat(binary).catch(()=>null))return binary;
  await fs.mkdir(dir,{recursive:true,mode:0o700});const temp=binary+'.'+crypto.randomUUID();
  try{await exec('/usr/bin/clang',[sourceFile,'-O2','-o',temp],{timeout:60000,maxBuffer:500000});await fs.chmod(temp,0o700);await fs.rename(temp,binary);}catch(error){fail('学习词典操作需要 macOS 命令行工具（clang）；安装后重试');}finally{await fs.unlink(temp).catch(()=>{});}
  return binary;
 }
 async dbDir(name){if(!valid(name))fail('无效学习词典名称');const root=await fs.realpath(this.store.userDir);return regularDirectory(path.join(root,name+'.userdb'));}
 async locked(name,cwd,args,onReady=async()=>{}){
  const dir=await this.dbDir(name),helper=await this.helper();
  return new Promise((resolve,reject)=>{
   const child=spawn(helper,[dir,...(args.length?[this.tool,...args]:[])],{cwd,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',error=null,started=false;
   const timer=setTimeout(()=>{error=new Error('词典操作超时');child.kill('SIGKILL');},60000);
   child.stdout.on('data',data=>{stdout+=data.toString();if(!started&&stdout.includes('LOCKED\n')){started=true;void onReady(dir).then(()=>child.stdin.end(args.length?'RUN\n':'DONE\n')).catch(e=>{error=e;child.stdin.end('ABORT\n');});}});
   child.stderr.on('data',data=>{if(stderr.length<20000)stderr+=data.toString();});child.stdin.on('error',()=>{});
   child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('close',code=>{clearTimeout(timer);if(error)return reject(error);if(code!==0)return reject(new Error(code===75?'学习词典正在被输入法占用，请退出鼠须管后再刷新':`词典工具未完成操作：${stderr.slice(-1200)}`));resolve({stdout,stderr});});
  });
 }
 async dump(name){
  await fs.mkdir(this.workDir,{recursive:true,mode:0o700});const job=await fs.mkdtemp(path.join(this.workDir,'read-')),table=path.join(job,'export.txt');
  try{
   await this.locked(name,this.store.userDir,['--export',name,table]);const exported=await fs.readFile(table,'utf8'),userId=exported.match(/^#@\/user_id\t(.*)$/m)?.[1];if(!userId||!/^[\p{L}\p{N}_. -]{1,120}$/u.test(userId)||userId.includes('..'))fail('学习词典用户身份无效');
   const dir=await this.dbDir(name),basis=await treeHash(dir);await fs.symlink(dir,path.join(job,name+'.userdb'),'dir');await fs.writeFile(path.join(job,'installation.yaml'),YAML.stringify({installation_id:userId,sync_dir:path.join(job,'sync')}),{mode:0o600});
   await this.locked(name,job,['--backup',name],async current=>{if(await treeHash(current)!==basis)fail('学习词典在读取期间发生变化，请重试');});
   const full=path.join(job,'sync',userId,name+'.userdb.txt');if(!path.resolve(full).startsWith(path.resolve(job)+path.sep))fail('学习词典身份路径无效');const text=await fs.readFile(full,'utf8');if(Buffer.byteLength(text)>32*1024*1024)fail('词典超过 32 MB 读取限制');
   return {...parseSnapshot(text,name),text,source:'live',time:new Date().toISOString(),canDelete:true};
  }finally{await fs.rm(job,{recursive:true,force:true});}
 }
 async snapshotCandidates(){
  const results=new Map();let sync=path.join(this.store.userDir,'sync'),own='';
  try{const installation=(await this.store.readFile(path.join(this.store.userDir,'installation.yaml'))).data;own=installation.installation_id||'';if(typeof installation.sync_dir==='string'&&path.isAbsolute(installation.sync_dir))sync=installation.sync_dir;}catch{}
  const roots=[this.store.userDir];const stat=await fs.lstat(sync).catch(()=>null);if(stat?.isDirectory()&&!stat.isSymbolicLink())for(const entry of await fs.readdir(sync,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink())roots.push(path.join(sync,entry.name));
  for(const root of roots)for(const entry of await fs.readdir(root,{withFileTypes:true}).catch(()=>[]))if(entry.isFile()&&!entry.isSymbolicLink()&&entry.name.endsWith('.userdb.txt')){
   const name=entry.name.slice(0,-11);if(!valid(name))continue;const file=path.join(root,entry.name),st=await fs.stat(file);if(st.size>32*1024*1024)continue;
   try{const data=parseSnapshot(await fs.readFile(file,'utf8'),name),candidate={...data,source:'snapshot',time:st.mtime.toISOString(),canDelete:false,preferred:own&&data.meta.user_id===own};const previous=results.get(name);if(!previous||(candidate.preferred&&!previous.preferred)||(candidate.preferred===previous.preferred&&candidate.time>previous.time))results.set(name,candidate);}catch{}
  }
  return results;
 }
 async refresh(){
  if(this.busy||this.store.busy)fail('词典正在操作，请稍后重试');this.busy=true;this.store.busy=true;
  try{const snapshots=await this.snapshotCandidates(),names=new Set(snapshots.keys());for(const entry of await fs.readdir(this.store.userDir,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink()&&entry.name.endsWith('.userdb')&&valid(entry.name.slice(0,-7)))names.add(entry.name.slice(0,-7));
   const nextCache=new Map();for(const name of names){let data,error='';try{data=await this.dump(name);}catch(e){error=e.message;data=snapshots.get(name)||{rows:[],hash:null,source:'unavailable',time:null,canDelete:false};}nextCache.set(name,{name,...data,error});}this.cache=nextCache;this.loaded=true;return this.query();
  }finally{this.busy=false;this.store.busy=false;}
 }
 async syncFromInputMethod(requestSync,{timeout=15000,interval=250}={}){
  if(this.busy||this.store.busy)fail('词典正在操作，请稍后重试');this.busy=true;this.store.busy=true;
  try{
   const before=await this.snapshotCandidates(),started=Date.now();await requestSync();let previous='',stable=0;
   while(Date.now()-started<timeout){
    await new Promise(resolve=>setTimeout(resolve,interval));const current=await this.snapshotCandidates();
    const updated=[...current].filter(([name,data])=>{const old=before.get(name);return !old||old.hash!==data.hash||old.time!==data.time;});
    const fingerprint=digest(JSON.stringify([...current].map(([name,data])=>[name,data.hash,data.time]).sort()));
    stable=fingerprint===previous?stable+1:0;previous=fingerprint;
    if(updated.length&&stable>=2){
     const nextCache=new Map();for(const [name,data]of current)nextCache.set(name,{name,...data,syncObserved:updated.some(([id])=>id===name),error:data.preferred?'':'这是未确认属于当前用户实例的同步快照'});
     for(const entry of await fs.readdir(this.store.userDir,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink()&&entry.name.endsWith('.userdb')){const name=entry.name.slice(0,-7);if(valid(name)&&!nextCache.has(name))nextCache.set(name,{name,rows:[],hash:null,source:'unavailable',canDelete:false,error:'没有观察到这份词典的同步快照'});}
     this.cache=nextCache;this.loaded=true;return {...this.query(),sync:{state:'observed',message:'已观察到同步快照更新；运行中的新输入可能继续增加记录，快照只用于查阅'}};
    }
   }
   return {...this.query(),sync:{state:'unconfirmed',message:'同步请求已发送，但没有观察到快照更新；旧快照不能代表当前学习总量'}};
  }finally{this.busy=false;this.store.busy=false;}
 }
 query({dictionary='',q='',offset=0,deleted=false}={}){
  if(typeof q!=='string'||q.length>100||!Number.isSafeInteger(offset)||offset<0||typeof deleted!=='boolean'||(dictionary&&!valid(dictionary)))fail('无效学习词条查询');
  const dictionaries=[...this.cache.values()].map(data=>({name:data.name,count:data.rows.filter(x=>!x.deleted).length,deletedCount:data.rows.filter(x=>x.deleted).length,hash:data.hash,source:data.source,time:data.time,canDelete:data.canDelete,error:data.error,syncObserved:!!data.syncObserved}));
  const all=[...this.cache.values()].filter(x=>!dictionary||x.name===dictionary).flatMap(x=>x.rows.map(row=>({...row,canDelete:x.canDelete&&!row.deleted}))).filter(row=>(deleted||!row.deleted)&&(!q||row.text.includes(q)||row.code.includes(q))).sort((a,b)=>b.count-a.count||a.text.localeCompare(b.text));
  const live=dictionaries.filter(x=>x.source==='live').length,snapshots=dictionaries.filter(x=>x.source==='snapshot').length,unavailable=dictionaries.filter(x=>x.source==='unavailable').length;
  return {coverage:{loaded:this.loaded,live,snapshots,unavailable,incomplete:!this.loaded||snapshots>0||unavailable>0},dictionaries,total:all.length,rows:all.slice(offset,offset+100),offset,hasMore:offset+100<all.length};
 }
 async preview(body){
  if(this.busy||this.store.busy)fail('词典正在操作');this.busy=true;this.store.busy=true;try{
  if(!['delete','clear'].includes(body.action))fail('无效清理操作');const selected=[];
  if(body.action==='clear'){const data=this.cache.get(body.dictionary);if(!data?.canDelete)fail('请退出鼠须管并刷新最新词典后再清空');selected.push(...data.rows.filter(x=>!x.deleted));}
  else{if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>1000||new Set(body.ids).size!==body.ids.length)fail('请选择 1–1000 条不同学习词条');const rows=new Map([...this.cache.values()].flatMap(data=>data.rows.map(row=>[row.id,{...row,canDelete:data.canDelete}])));for(const id of body.ids){const row=rows.get(id);if(!row||!row.canDelete||row.deleted)fail('所选词条不是可编辑的最新学习记录');selected.push(row);}}
  if(!selected.length||selected.length>100000)fail('清理范围必须在 1–100000 条之间');const names=[...new Set(selected.map(x=>x.dictionary))],groups=[];
  for(const name of names){const current=await this.dump(name),cached=this.cache.get(name);if(current.hash!==cached.hash)fail('学习词典已变化，请刷新后重新选择');groups.push({name,beforeHash:current.hash,rows:selected.filter(row=>row.dictionary===name)});}
  const id=crypto.randomUUID(),p={id,kind:'learned',created:Date.now(),groups,summary:[{title:body.action==='clear'?'清空学习词典':'删除学习词条',value:`${selected.length} 条`}],files:[]};this.store.previews.set(id,p);
  return {id,kind:'learned',files:[],summary:p.summary,metadata:{type:'learned-delete',total:selected.length,dictionaries:names},rows:selected.slice(0,100).map(({dictionary,text,code,count})=>({dictionary,text,code,count}))};
  }finally{this.busy=false;this.store.busy=false;}
 }
 async apply(p){
  for(const group of p.groups)if((await this.dump(group.name)).hash!==group.beforeHash)fail('学习词典已变化，请重新预览');
  const dir=path.join(this.store.dataDir,crypto.randomUUID());await fs.mkdir(dir,{recursive:true,mode:0o700});const record={id:path.basename(dir),kind:'learned',time:new Date().toISOString(),summary:p.summary,groups:p.groups,files:[],pending:true};await fs.writeFile(path.join(dir,'record.json'),JSON.stringify(record),{mode:0o600});const completed=[],updated=new Map();this.store.previews.delete(p.id);
  try{
   for(const group of record.groups){const delta=path.join(dir,group.name+'.delete.txt');await fs.writeFile(delta,group.rows.map(row=>`${row.text}\t${row.code}\t-1`).join('\n')+'\n',{mode:0o600});
    const baseline=await this.dump(group.name);if(baseline.hash!==group.beforeHash)fail('学习词典已变化，请重新预览');group.beforeText=baseline.text;group.afterHash=parseSnapshot(rewriteCounts(baseline.text,group.name,group.rows,true),group.name).hash;const physical=await treeHash(await this.dbDir(group.name));
    await this.locked(group.name,this.store.userDir,['--import',group.name,delta],async db=>{if(await treeHash(db)!==physical)fail('学习数据库在写入前发生变化');await copyDatabase(db,path.join(dir,group.name));group.started=true;completed.push(group);await fs.writeFile(path.join(dir,'record.json'),JSON.stringify(record),{mode:0o600});});
    const after=await this.dump(group.name),deletedIds=new Set(group.rows.map(row=>row.id));if(after.hash!==group.afterHash||after.rows.some(row=>deletedIds.has(row.id)&&!row.deleted))fail('删除结果发生变化，需重新核对');updated.set(group.name,{name:group.name,...after,error:''});
   }
   record.pending=false;await fs.writeFile(path.join(dir,'record.json'),JSON.stringify(record),{mode:0o600});this.store.previews.delete(p.id);for(const [name,data] of updated)this.cache.set(name,data);return {id:record.id,message:'学习记录已删除并备份；重新启用鼠须管即可使用',requiresDeploy:false};
  }catch(error){let rollbackFailed=false;for(const group of completed.reverse())try{const now=await this.dump(group.name);if(!compatibleDeletion(group,now))fail('学习词典又有变化');const basis=await treeHash(await this.dbDir(group.name));await this.locked(group.name,this.store.userDir,[],async db=>{if(await treeHash(db)!==basis)fail('学习词典又有变化');await replaceDatabase(path.join(dir,group.name),db);});}catch{rollbackFailed=true;}record.failed=!rollbackFailed;record.uncertain=rollbackFailed;record.pending=rollbackFailed;await fs.writeFile(path.join(dir,'record.json'),JSON.stringify(record),{mode:0o600});if(rollbackFailed)fail('操作结果需要核对，未覆盖后来变化；请退出鼠须管后在修改记录检查这次备份');throw error;}
 }
 async restore(record,dir){
  const groups=record.groups.filter(group=>group.started);if(!groups.length)fail('这次记录没有已开始的数据修改');
  for(const group of groups){const now=await this.dump(group.name);if((record.pending||record.uncertain)?!compatibleDeletion(group,now):now.hash!==group.afterHash)fail('学习词典后来又有变化，不能直接覆盖恢复');}
  const completed=[];
  try{for(const group of groups){const basis=await treeHash(await this.dbDir(group.name));await this.locked(group.name,this.store.userDir,[],async db=>{if(await treeHash(db)!==basis)fail('恢复前发现词典变化');await copyDatabase(db,path.join(dir,group.name+'-after'));completed.push(group);await replaceDatabase(path.join(dir,group.name),db);});}}
  catch(error){for(const group of completed.reverse())try{await this.locked(group.name,this.store.userDir,[],db=>replaceDatabase(path.join(dir,group.name+'-after'),db));}catch{}throw error;}
  for(const group of groups)if((await this.dump(group.name)).hash!==group.beforeHash)fail('恢复结果未通过校验，请保留备份');record.pending=false;record.uncertain=false;record.restored=new Date().toISOString();await fs.writeFile(path.join(dir,'record.json'),JSON.stringify(record),{mode:0o600});for(const group of groups)this.cache.set(group.name,{name:group.name,...await this.dump(group.name),error:''});return {message:'已恢复删除前的学习词典，重新启用鼠须管即可使用',requiresDeploy:false};
 }
}
