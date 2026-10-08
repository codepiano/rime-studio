import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import YAML from 'yaml';
import {readText,readResource,digest,previewFiles,safeFile} from './file-transactions.js';
import {patchText,dictionaryHeader} from './library.js';
import {parseRecipes,preparePlum,plumIdentity,PLUM_COMMIT,runSandbox} from './plum.js';
const exec=promisify(execFile);
const manifestFile='.rime-studio-packages.json';
export const catalog=[
 {id:'ice',name:'雾凇拼音',repo:'iDvel/rime-ice',branch:'main',schema:'rime_ice',license:'GPL-3.0-only',description:'全拼、双拼与中英词库，适合常规拼音输入。'},
 {id:'frost',name:'白霜拼音',repo:'gaboolic/rime-frost',branch:'master',schema:'rime_frost',license:'GPL-3.0',description:'源自雾凇，重点维护字词频与词库。'},
].map(x=>({...x,url:'https://github.com/'+x.repo}));
const fail=message=>{throw new Error(message);};
export async function packageState(store) {
 const source=await readText(store.userDir,manifestFile);
 if(!source.exists)return {};
 let data;try{data=JSON.parse(source.text);}catch{fail('方案安装记录无法解析');}
 if(data.version!==1||!data.packages||typeof data.packages!=='object'||Array.isArray(data.packages))fail('方案安装记录版本不受支持');
 return data.packages;
}
function accepted(file) {
 if(file.endsWith('.custom.yaml')||file==='custom_phrase.txt')return false;
 if(file.includes('/'))return /^(cn_dicts(?:_[a-z0-9_]+)?|en_dicts(?:_[a-z0-9_]+)?|lua|opencc)\/[a-zA-Z0-9_./-]+\.(yaml|txt|lua|json|ocd|ocd2|db)$/.test(file);
 return /^[a-zA-Z0-9_.-]+\.(yaml|txt|lua|gram)$/.test(file)&&!['recipe.yaml'].includes(file);
}
export async function packagePreview(store,entry,sourceDir,commit,{mode='full',enable=true,preparedFiles=null,provenance={},baselineRevision=null,seedGuards=[]}={}) {
 const viaPlum=provenance.backend==='plum';
 if(!(catalog.some(x=>x.id===entry.id)||(viaPlum&&/^plum-[0-9a-f]{16}$/.test(entry.id)))||!['full','dictionaries'].includes(mode)||typeof enable!=='boolean'||!/^[0-9a-f]{40}$/.test(commit))fail('无效安装参数');
 let all;
 if(preparedFiles)all=preparedFiles;else{const {stdout}=await exec('git',['-C',sourceDir,'ls-files','-z'],{maxBuffer:1024*1024});all=stdout.split('\0').filter(Boolean).filter(accepted);}
 const selected=mode==='dictionaries'?all.filter(file=>file.endsWith('.dict.yaml')):all;
 const revision=(await store.snapshot()).revision;if(baselineRevision&&baselineRevision!==revision)fail('配置在准备期间已变化，请重新下载');
 const installed=await packageState(store),previous=installed[entry.id],changes=[],guards=[...seedGuards],conflicts=[],managed={...(previous?.files||{})};
 if(mode==='dictionaries'&&!previous)fail('请先完整安装此方案，再更新词库');
 const bases={};
 let bytes=0;
 for(const file of selected){
   const encoding=/\.(gram|ocd|ocd2|db)$/.test(file)?'base64':'utf8';
   const incoming=await readResource(sourceDir,file,encoding);bytes+=encoding==='base64'?Buffer.from(incoming.text,'base64').length:Buffer.byteLength(incoming.text);if(bytes>120*1024*1024)fail('方案文件超过 120 MB');
   if(file.endsWith('.dict.yaml'))dictionaryHeader(incoming.text);
   else if(file.endsWith('.yaml')){const doc=YAML.parseDocument(incoming.text);if(doc.errors.length)fail(`${file} 无法解析`);const config=doc.toJS({maxAliasCount:100});if(!config||typeof config!=='object'||Array.isArray(config))fail(`${file} 需要是配置映射`);}
   const current=await readResource(store.userDir,file,encoding),currentHash=digest(current.text,encoding),nextHash=digest(incoming.text,encoding);
   bases[file]=incoming.text;guards.push({file,encoding,exists:current.exists,hash:currentHash});
   if(viaPlum&&current.exists&&file.endsWith('custom_phrase.txt')){conflicts.push({file,reason:'个人短语已保留'});continue;}
   const owners=Object.values(installed).filter(x=>x.files?.[file]).sort((a,b)=>String(b.time).localeCompare(String(a.time)));
   const baseline=owners[0]?.files?.[file];
   if(current.exists&&baseline&&currentHash!==baseline){conflicts.push({file,reason:'本地修改已保留'});continue;}
   if(current.text!==incoming.text||!current.exists)changes.push({file,encoding,after:incoming.text,expected:{hash:currentHash,exists:current.exists}});
   managed[file]=nextHash;
 }
 for(const [file,text] of Object.entries(bases))if(file.endsWith('.dict.yaml'))for(const dependency of dictionaryHeader(text).imports){
   const target=dependency+'.dict.yaml';
   if(!Object.hasOwn(bases,target)&&!(await readText(store.userDir,target)).exists&&!(await readText(store.sharedDir,target)).exists)fail(`${file} 缺少词库依赖 ${target}`);
 }
 // Never remove files automatically when an upstream release drops them.
 const removed=viaPlum||previous?.backend==='plum'?[]:Object.keys(previous?.files||{}).filter(file=>!all.includes(file));
 let schemaIds=[];
 if(mode==='full'){
   for(const [file,text] of Object.entries(bases))if(file.endsWith('.schema.yaml')){const id=YAML.parse(text).schema?.schema_id;if(typeof id==='string'&&/^[a-z0-9_.-]+$/.test(id))schemaIds.push(id);}
   if(entry.schema&&!schemaIds.includes(entry.schema)&&!(viaPlum&&(await readText(sourceDir,entry.schema+'.schema.yaml')).exists))fail('下载的方案缺少主入口');
   if(enable&&entry.schema){
     const snapshot=await store.snapshot(),source=await readText(store.userDir,'default.custom.yaml');
     changes.push({file:'default.custom.yaml',after:patchText(source.text,{schema_list:[...new Set(previous?[...snapshot.enabled]:[entry.schema,...snapshot.enabled])].map(schema=>({schema}))}),expected:{hash:digest(source.text),exists:source.exists}});
   }
 }
 const manifest=await readText(store.userDir,manifestFile);
 const recordedPackages={...installed,[entry.id]:{id:entry.id,name:entry.name,repo:entry.repo,commit,mode,time:new Date().toISOString(),license:entry.license,...provenance,files:managed,retained:conflicts.map(x=>x.file),removedUpstream:removed}};
 changes.push({file:manifestFile,after:JSON.stringify({version:1,packages:recordedPackages},null,2)+'\n',expected:{hash:digest(manifest.text),exists:manifest.exists}});
 return previewFiles(store,changes,[{title:`${previous?'更新':'安装'}${entry.name}`,value:commit.slice(0,12)}],{type:'package',package:entry.id,commit,mode,conflicts,removedUpstream:removed,schemas:schemaIds,source:entry.url,license:entry.license,...provenance},revision,guards);
}
async function supplementKnownPackage(entry,{outputDir,sourceDirs,workDir,restriction}){
 if(!catalog.some(x=>x.id===entry.id))return [];
 const source=sourceDirs.find(x=>x.repo===entry.repo);if(!source)return [];
 const {stdout}=await runSandbox(workDir,['git','-C',source.dir,'ls-files','-z'],restriction),added=[];
 for(const file of stdout.split('\0').filter(Boolean).filter(accepted)){
  const dest=await safeFile(outputDir,file);if(await fs.lstat(dest).catch(()=>null))continue;
  const encoding=/\.(gram|db|ocd|ocd2)$/.test(file)?'base64':'utf8';
  await safeFile(workDir,path.relative(workDir,path.join(source.dir,file)));
  const resource=await readResource(source.dir,file,encoding);await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});await fs.writeFile(dest,encoding==='base64'?Buffer.from(resource.text,'base64'):resource.text,{mode:0o600});added.push(file);
 }
 return added;
}
export class PackageDownloads {
 constructor(cacheDir){this.cacheDir=cacheDir;this.jobs=new Map();this.running=false;}
 start(store,body){
  if(this.running)fail('另一个方案正在下载，请稍后再试');
  const recipes=body.recipe!==undefined?parseRecipes(body.recipe):null;
  const known=recipes?.length===1?catalog.find(x=>[x.repo,x.repo+'@'+x.branch].includes(recipes[0])):null;
  const entry=recipes?(known||{id:plumIdentity(recipes),name:'plum 配方 · '+recipes.join(' '),repo:recipes.join(' '),url:'https://github.com/rime/plum',license:'以上游来源为准',schema:null}):catalog.find(x=>x.id===body.package);
  if(!entry||!['full','dictionaries'].includes(body.mode)||typeof body.enable!=='boolean')fail('请选择目录中的方案和安装方式');
  const id=crypto.randomUUID(),job={id,state:'downloading',message:`正在下载${entry.name}…`,started:Date.now()};
  this.jobs.set(id,job);this.running=true;
  for(const [key,value]of this.jobs)if(Date.now()-value.started>3600000)this.jobs.delete(key);
  void this.download(store,entry,body,job).finally(()=>{this.running=false;});
  return {id,state:job.state,message:job.message};
 }
 async download(store,entry,body,job){
  const dir=path.join(this.cacheDir,job.id);
  try{
   await fs.mkdir(this.cacheDir,{recursive:true,mode:0o700});
   if(body.recipe!==undefined){
    job.message='正在通过 plum 准备配方…';
    const prepared=await preparePlum(store,dir,body.recipe,{supplement:context=>supplementKnownPackage(entry,context)});job.log=prepared.log;
    job.message='plum 已完成准备，正在生成文件预览…';
    job.preview=await packagePreview(store,entry,prepared.outputDir,prepared.provenance.sources[0]?.commit||PLUM_COMMIT,{mode:body.mode,enable:false,preparedFiles:prepared.files,provenance:prepared.provenance,baselineRevision:prepared.revision,seedGuards:prepared.seedGuards});
   }else{
   await exec('git',['-c','core.hooksPath=/dev/null','clone','--depth','1','--single-branch','--branch',entry.branch,entry.url+'.git',dir],{timeout:180000,maxBuffer:2*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
   const {stdout}=await exec('git',['-C',dir,'rev-parse','HEAD']);const commit=stdout.trim();
   job.message='下载完成，正在核对文件与本地修改…';
   job.preview=await packagePreview(store,entry,dir,commit,body);
   }
   job.state='ready';job.message='文件已暂存，请预览后保存';
  }catch(error){job.state='failed';job.message=error.code==='ENOENT'?'未找到 Git，请安装 Git 后重试':`下载或预览失败：${error.message}`;}
 }
 get(id){const job=this.jobs.get(id);if(!job)fail('下载任务不存在或已过期');return job;}
}
