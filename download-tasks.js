import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {catalog,packagePreview} from './packages.js';
import {resolveRecipes,preparePlum,plumIdentity,PLUM_COMMIT} from './plum.js';
import {safeFile,readResource,digest} from './file-transactions.js';
import {runTask} from './task-process.js';
const fail=message=>{throw new Error(message);},uuid=/^[a-f0-9-]{36}$/;
function specification(body){
 const recipes=body.recipe!==undefined?resolveRecipes(body.recipe):null;
 const known=recipes?.length===1?catalog.find(x=>[x.repo,x.repo+'@'+x.branch,...(x.id==='frost'?[x.repo+':others/recipes/full',x.repo+'@'+x.branch+':others/recipes/full']:[])].includes(recipes[0])):null;
 const entry=recipes?(known||{id:plumIdentity(recipes),name:'plum 配方 · '+recipes.join(' '),repo:recipes.join(' '),url:'https://github.com/rime/plum',license:'以上游来源为准',schema:null}):catalog.find(x=>x.id===body.package);
 if(!entry||!['full','dictionaries'].includes(body.mode)||typeof body.enable!=='boolean')fail('请选择目录中的方案和安装方式');
 return {entry,body:{...(recipes?{recipe:recipes.join(' ')}:{package:entry.id}),mode:body.mode,enable:body.enable}};
}
export class PackageDownloads {
 constructor(cacheDir,{run=runTask,prepare=preparePlum}={}){this.cacheDir=cacheDir;this.jobs=new Map();this.running=false;this.run=run;this.prepare=prepare;this.controllers=new Map();this.plans=new Map();this.writes=Promise.resolve();this.issues=[];this.ready=this.load();this.ready.catch(()=>{});}
 async load(){
  const dir=path.join(this.cacheDir,'jobs');await fs.mkdir(dir,{recursive:true,mode:0o700});await safeFile(dir,'placeholder');
  const entries=await fs.readdir(dir);for(const file of entries.filter(x=>/^[a-f0-9-]{36}\.json$/.test(x))){
   try{const st=await fs.stat(await safeFile(dir,file));if(st.size>2*1024*1024)throw new Error('任务记录超过限制');const job=JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));
    if(!uuid.test(job.id)||file!==job.id+'.json'||!Number.isFinite(job.started)||!['downloading','ready','failed','cancelled','interrupted','applied'].includes(job.state))throw new Error('任务记录无效');specification(job.body);
    if(job.plan)this.plans.set(job.id,job.plan);delete job.plan;job.preview=null;
    if(job.state==='downloading'){job.state='interrupted';job.message='服务重启，原任务已中断；可重试创建新任务';job.finished=Date.now();try{await this.persist(job);}catch(error){job.journalError=error.message;}}
    this.jobs.set(job.id,job);
   }catch(error){this.issues.push(`${file}：${error.message}`);}
  }
 }
 persist(job){
  const {preview,done,shutdown,...fields}=job,record={...fields,log:String(job.log||'').slice(-12000),plan:this.plans.get(job.id)||null};
  this.writes=this.writes.catch(()=>{}).then(async()=>{const dir=path.join(this.cacheDir,'jobs'),dest=await safeFile(dir,job.id+'.json'),temp=dest+'-'+crypto.randomUUID();try{await fs.writeFile(temp,JSON.stringify(record),{mode:0o600,flag:'wx'});await fs.rename(temp,dest);}finally{await fs.rm(temp,{force:true});}});return this.writes;
 }
 publicJob(job,details=false){if(!job)fail('下载任务不存在');const {body,preview,done,shutdown,...fields}=job;return {...fields,canRetry:['failed','cancelled','interrupted'].includes(job.state),canCancel:job.state==='downloading',hasPreview:job.state==='ready',...(details?{preview:preview||null}:{} )};}
 async list(){await this.ready;return {jobs:[...this.jobs.values()].sort((a,b)=>b.started-a.started).map(job=>this.publicJob(job)).slice(0,100),issues:this.issues};}
 async get(id){await this.ready;if(!uuid.test(id||''))fail('无效任务');return this.publicJob(this.jobs.get(id),true);}
 async start(store,body,{retryOf=null}={}){
  const spec=specification(body);if(this.running)fail('另一个方案正在下载，请稍后再试');this.running=true;
  try{await this.ready;const id=crypto.randomUUID(),job={id,name:spec.entry.name,body:spec.body,retryOf,state:'downloading',phase:'starting',message:`正在准备${spec.entry.name}…`,started:Date.now(),log:''};this.jobs.set(id,job);const control=new AbortController();this.controllers.set(id,control);const persisted=this.persist(job);
   job.done=(async()=>{await persisted;await this.download(store,spec.entry,spec.body,job,control.signal);})().finally(()=>{this.running=false;this.controllers.delete(id);delete job.done;});job.done.catch(()=>{});await persisted;return this.publicJob(job);
  }catch(error){this.running=false;throw error;}
 }
 async download(store,entry,body,job,signal){
  const dir=path.join(this.cacheDir,job.id);let lastLog=0;
  const onOutput=text=>{job.log=(job.log+text.replace(/\x1b\[[0-9;]*m/g,'')).slice(-12000);if(Date.now()-lastLog>300){lastLog=Date.now();void this.persist(job).catch(e=>{job.journalError=e.message;});}};
  const phase=async(id,message)=>{signal.throwIfAborted();job.phase=id;job.message=message;await this.persist(job);};
  try{
   await fs.mkdir(dir,{recursive:true,mode:0o700});await safeFile(dir,'placeholder');let plan;
   if(body.recipe!==undefined){
    await phase('installer','正在通过 plum 准备配方…');const prepared=await this.prepare(store,dir,body.recipe,{signal,onOutput,onPhase:(id,message)=>{job.phase=id;job.message=message;void this.persist(job).catch(e=>{job.journalError=e.message;});}});
    plan={commit:prepared.provenance.sources[0]?.commit||PLUM_COMMIT,options:{mode:body.mode,enable:false,preparedFiles:prepared.files,provenance:prepared.provenance,baselineRevision:prepared.revision,seedGuards:prepared.seedGuards}};job.log=(job.log+'\n'+prepared.log).slice(-12000);
   }else{
    await phase('fetch','正在下载上游仓库…');
    // Clone into a child directory so the job journal is independent of Git.
    await this.run('git',['-c','core.hooksPath=/dev/null','clone','--depth','1','--single-branch','--branch',entry.branch,entry.url+'.git',path.join(dir,'source')],{signal,onOutput,timeout:180000,label:'Git 下载',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
    const {stdout}=await this.run('git',['-C',path.join(dir,'source'),'rev-parse','HEAD'],{signal,label:'Git'});plan={commit:stdout.trim(),options:{mode:body.mode,enable:body.enable}};
   }
   await phase('preview','正在核对文件、本地修改与更新冲突…');const sourceDir=path.join(dir,body.recipe!==undefined?'output':'source');job.preview=await packagePreview(store,entry,sourceDir,plan.commit,plan.options);signal.throwIfAborted();
   plan.sources=store.previews.get(job.preview.id).packagePlan.sources;this.plans.set(job.id,plan);job.state='ready';job.phase='ready';job.message='文件已暂存，可处理冲突并预览后保存';job.finished=Date.now();await this.persist(job);
  }catch(error){if(job.preview){store.previews.delete(job.preview.id);job.preview=null;}job.state=signal.aborted?(job.shutdown?'interrupted':'cancelled'):'failed';job.message=signal.aborted?(job.shutdown?'服务停止，任务已中断，可重试':'任务已取消，未保存到 Rime 目录'):`下载或预览失败：${error.message}`;job.finished=Date.now();await this.persist(job).catch(e=>{job.journalError=e.message;});}
 }
 async cancel(id,{shutdown=false}={}){await this.ready;const job=this.jobs.get(id);if(!job||job.state!=='downloading')fail('任务已结束，不能取消');job.shutdown=shutdown;this.controllers.get(id)?.abort();await job.done;return this.publicJob(job);}
 async shutdown(){await this.ready;for(const job of this.jobs.values())if(job.state==='downloading')await this.cancel(job.id,{shutdown:true});await this.writes;}
 async retry(store,id){await this.ready;const job=this.jobs.get(id);if(!job||!['failed','cancelled','interrupted'].includes(job.state))fail('此任务不能重试');return this.start(store,job.body,{retryOf:id});}
 async preview(store,id){await this.ready;if(this.running)fail('下载期间请稍后重试');const job=this.jobs.get(id),plan=this.plans.get(id);if(!job||job.state!=='ready'||!plan)fail('暂存文件不可用，请重试下载');
  const {entry}=specification(job.body),sourceDir=path.join(this.cacheDir,id,job.body.recipe!==undefined?'output':'source');for(const row of plan.sources||[]){const data=await readResource(sourceDir,row.file,row.encoding);if(!data.exists||digest(data.text,row.encoding)!==row.hash)fail('暂存上游文件已变化，请重新下载');}
  job.preview=await packagePreview(store,entry,sourceDir,plan.commit,plan.options);return job.preview;
 }
 async markApplied(previewId,recordId){for(const job of this.jobs.values())if(job.preview?.id===previewId){job.state='applied';job.phase='saved';job.message='已保存并备份，可从修改记录恢复';job.recordId=recordId;job.preview=null;await this.persist(job);}}
 replacePreview(previous,next){for(const job of this.jobs.values())if(job.preview?.id===previous)job.preview=next;}
}
