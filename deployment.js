import fs from 'node:fs/promises';
import path from 'node:path';
import {phraseFiles} from './library.js';
import {phraseRows} from './public/phrase-format.js';
import {safeFile,digest} from './file-transactions.js';

// Rime can rewrite a compiled file with identical YAML bytes. Observe generation
// metadata for all build artifacts, not just configuration text differences.
export async function buildGeneration(userDir){
 const dir=path.join(userDir,'build'),out={};
 const st=await fs.lstat(dir).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(!st)return out;if(!st.isDirectory()||st.isSymbolicLink())throw new Error('编译目录必须是真实目录');
 async function scan(prefix='',depth=0){if(depth>4)return;for(const entry of await fs.readdir(path.join(dir,prefix),{withFileTypes:true})){
  const file=prefix?prefix+'/'+entry.name:entry.name;if(entry.name.startsWith('.'))continue;
  if(entry.isDirectory())await scan(file,depth+1);
  else if(entry.isFile()&&/\.(yaml|bin|prism|table|reverse|txt)$/.test(file)){const stat=await fs.stat(await safeFile(dir,file));out[file]=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;}
  if(Object.keys(out).length>2000)throw new Error('编译产物超过检查数量限制');
 }}await scan();return out;
}
export async function deploymentBaseline(store){
 const snap=await store.snapshot(),targets=['default','squirrel',...snap.enabled.map(id=>`${id}.schema`)];
 const expected={};for(const name of targets){const custom=name.replace(/\.schema$/,'')+'.custom.yaml';const st=await fs.stat(await safeFile(store.userDir,custom)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});const entries={};if(st)entries[custom.replace('.yaml','')]=Math.floor(st.mtimeMs/1000);
  const source=name+'.yaml';let sourceStat=await fs.stat(await safeFile(store.userDir,source)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!sourceStat)sourceStat=await fs.stat(await safeFile(store.sharedDir,source)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(sourceStat)entries[name]=Math.floor(sourceStat.mtimeMs/1000);expected[name]=entries;}
 return {revision:snap.revision,targets,expected,generation:await buildGeneration(store.userDir),pending:await pendingChanges(store)};
}
export async function observeDeployment(store,baseline,{wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=60,interval=500,probe}={}){
 let last='',stable=0,resourceTried=false;
 for(let i=0;i<attempts;i++){
  await wait(interval);
  if((await store.snapshot()).revision!==baseline.revision)return {state:'unconfirmed',message:'部署期间源配置发生变化，请重新部署；未确认输入效果。'};
  let ready=true;
  for(const name of baseline.targets){const built=await store.readFile(path.join(store.userDir,'build',name+'.yaml')),timestamps=built.data.__build_info?.timestamps||{};if(!built.text||Object.entries(baseline.expected[name]||{}).some(([key,time])=>!timestamps[key]||timestamps[key]<time))ready=false;}
  const generation=await buildGeneration(store.userDir),serialized=JSON.stringify(generation);
  const changed=Object.entries(generation).some(([file,signature])=>signature!==baseline.generation[file]);
  stable=ready&&changed?(last===serialized?stable+1:1):0;last=serialized;
  await checkChanges(store,baseline.pending||[]);
  if(ready&&i>=1&&probe&&!resourceTried){resourceTried=true;try{const checked=await verifyFixedResources(store,baseline,probe);if(checked)return checked;}catch(error){return {state:'unconfirmed',message:'重载请求已发送，但固定资源的隔离核对未完成：'+error.message};}}
  if(stable>=2)return {state:'verified',message:'已观察到编译产物更新（含内容不变的重新生成），自定义配置时间检查通过。真实输入框效果仍需确认。'};
 }
 return {state:'unconfirmed',message:'部署请求已发送，尚未观察到新的编译产物；配置内容相同也可能无需重编译。可用输入诊断检查已保存的方案，再在真实输入框确认效果。'};
}

// Save resource scope across web-service restarts; never store learning records here.
export async function recordDeploymentChanges(store,files){
 const current=await pendingChanges(store),changed=new Map(current.map(x=>[x.file,x]));
 for(const file of files||[]){if(file.startsWith('.'))continue;const full=await safeFile(store.userDir,file),bytes=await fs.readFile(full).catch(e=>{if(e.code==='ENOENT')return null;throw e;});changed.set(file,{file,hash:bytes?digest(bytes):null});}
 await fs.mkdir(store.dataDir,{recursive:true});await store.atomicWrite(path.join(store.dataDir,'pending-deployment.json'),JSON.stringify([...changed.values()]));
}
export async function pendingChanges(store){try{const rows=JSON.parse(await fs.readFile(path.join(store.dataDir,'pending-deployment.json'),'utf8'));if(!Array.isArray(rows)||rows.length>2000||rows.some(x=>typeof x.file!=='string'||!(x.hash===null||/^[a-f0-9]{64}$/.test(x.hash))))throw new Error('待部署记录无效');return rows;}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function checkChanges(store,changes){for(const row of changes){const bytes=await fs.readFile(await safeFile(store.userDir,row.file)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if((bytes?digest(bytes):null)!==row.hash)throw new Error('待部署的资源后来被修改，请重新保存或运行输入诊断');}}
export async function verifyFixedResources(store,baseline,probe){
 const changes=baseline.pending||[];
 if(!changes.length||!changes.every(x=>x.file.endsWith('.txt')&&x.hash))return null;
 await checkChanges(store,changes);
 const snapshot=await store.snapshot();let trials=0;
 for(const change of changes){
  const schemas=snapshot.schemas.filter(s=>phraseFiles(s).some(p=>p.file===change.file));if(!schemas.length)return null;
  const rows=phraseRows(await fs.readFile(await safeFile(store.userDir,change.file),'utf8'));
  for(const schema of schemas){
   const row=rows.find(x=>x.code.length<=80&&/^[\x21-\x7e]+$/.test(x.code));
   if(rows.length&&!row)return null;
   // An empty table can be compiled, but has no positive candidate to verify.
   const result=await probe({schema:schema.id,code:row?.code||'a',expected:row?.text?.length<=100?row.text:''});
   if(result.trial.error||!result.trial.compiled)return null;
   if(row&&!result.trial.candidates.some(x=>x.text===row.text))return null;
   trials++;
  }
 }
 await checkChanges(store,changes);
 return {state:'resources-checked',message:`重载请求已发送；${changes.length} 份固定短语表及 ${trials} 个隔离会话已核对。此类修改可能无需重编译 YAML，真实输入法效果仍需确认。`};
}
