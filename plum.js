import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {readText,readResource,digest,safeFile} from './file-transactions.js';
export const PLUM_COMMIT='b1be1969f914cc005add4090631b855db00c2591';
const fail=message=>{throw new Error(message);};
export function parseRecipes(input){
 if(typeof input!=='string'||input.length>1000)fail('请输入不超过 1000 字符的 plum 配方');
 const recipes=input.trim().split(/\s+/);
 if(!recipes.length||recipes.length>20)fail('每次支持 1–20 个配方');
 for(const recipe of recipes){
  if([':preset',':extra',':all'].includes(recipe))continue;
  if(['plum','bash','sh','zsh','sudo','curl','git','rime-install'].includes(recipe)||recipe.includes('..')||recipe.endsWith('.conf')||! /^(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)?[A-Za-z0-9][A-Za-z0-9_.-]*(?:@[A-Za-z0-9][A-Za-z0-9_./-]*)?(?::[A-Za-z0-9][A-Za-z0-9_/-]*(?::[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_./+-]+(?:,[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_./+-]+)*)?)?$/.test(recipe))fail('请输入配方名称，不要粘贴终端命令、URL 或配置脚本');
 }
 return [...new Set(recipes)];
}
const quote=value=>JSON.stringify(value);
const canonical=value=>{try{return realpathSync(value);}catch{return path.resolve(value);}};
export function sandboxProfile(workDir,extraProtected=[]){
 // Confine writes, including recipe patch commands, to the job. /dev permits stdio.
 // Protect personal directories; system tools, certificates and OS caches remain readable.
 workDir=canonical(workDir);
 const protectedRoots=[...new Set(['/Users','/Volumes',os.homedir(),...extraProtected].filter(Boolean).map(canonical))];
 return `(version 1)\n(allow default)\n(deny file-write* (require-not (require-any (subpath ${quote(workDir)}) (subpath "/dev"))))\n`+
  protectedRoots.map(root=>`(deny file-read-data (require-all (subpath ${quote(root)}) (require-not (subpath ${quote(workDir)}))))`).join('\n')+
  '\n(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))\n';
}
export function runSandbox(workDir,args,{timeout=240000,protectedRoots=[]}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/sandbox-exec',['-p',sandboxProfile(workDir,protectedRoots),...args],{cwd:workDir,detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',HOME:os.homedir(),TMPDIR:path.join(workDir,'tmp'),LC_ALL:'C',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'/dev/null',GIT_CONFIG_KEY_1:'credential.helper',GIT_CONFIG_VALUE_1:'',GIT_CONFIG_KEY_2:'protocol.file.allow',GIT_CONFIG_VALUE_2:'never',GIT_CONFIG_KEY_3:'protocol.ext.allow',GIT_CONFIG_VALUE_3:'never'}});
  let stdout='',stderr='',failure=null,bytes=0;
  const stop=message=>{failure=new Error(message);if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}};
  const timer=setTimeout(()=>stop('plum 准备超时，请检查网络后重试'),timeout);
  for(const [stream,isError]of [[child.stdout,false],[child.stderr,true]])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){stop('plum 输出超过限制');return;}if(isError)stderr+=chunk.toString();else stdout+=chunk.toString();});
  child.on('error',error=>{clearTimeout(timer);reject(new Error(error.code==='ENOENT'?'当前系统缺少 sandbox-exec，无法安全运行 plum':error.message));});
  child.on('close',(code,signal)=>{clearTimeout(timer);if(failure)return reject(failure);if(code!==0)return reject(new Error(`plum 准备失败（${signal||code}）：${stderr.slice(-2500)||stdout.slice(-2500)}`));resolve({stdout,stderr});});
 });
}
function supported(file){
 if(file.startsWith('.')||file.split('/').some(part=>['build','sync','trash','backup'].includes(part)||part.endsWith('.userdb')))return false;
 return /\.(yaml|txt|lua|json|gram|db|ocd|ocd2)$/.test(file)&&!['user.yaml','installation.yaml','recipe.yaml'].includes(file)&&!file.endsWith('.recipe.yaml');
}
export async function stageFiles(root,prefix=''){
 const files=[];
 const rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('plum 输出目录必须是真实目录');
 for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
  const file=prefix?prefix+'/'+entry.name:entry.name;
  if(entry.isSymbolicLink())fail('plum 输出包含符号链接，无法应用');
  if(entry.isDirectory()){await safeFile(root,file+'/placeholder');files.push(...await stageFiles(root,file));}
  else if(entry.isFile()&&supported(file)){await safeFile(root,file);files.push(file);}
  else if(!entry.isFile())fail('plum 输出包含特殊文件，无法应用');
  if(files.length>500)fail('plum 文件数量超过 500');
 }
 return files;
}
export async function preparePlum(store,cacheDir,input,{supplement=null}={}){
 if(process.platform!=='darwin')fail('plum 配方执行目前仅支持 macOS');
 const restriction={protectedRoots:[store.userDir]};
 const recipes=parseRecipes(input),revision=(await store.snapshot()).revision;
 await fs.mkdir(cacheDir,{recursive:true,mode:0o700});const workDir=await fs.realpath(cacheDir);
 const outputDir=path.join(workDir,'output'),engineDir=path.join(workDir,'plum');
 for(const dir of ['output','home','tmp'])await fs.mkdir(path.join(workDir,dir),{mode:0o700});
 const before=new Map(),seedGuards=[];
 // Only configuration YAML is seeded: no learned databases or personal phrase/word tables.
 for(const [origin,root]of [['shared',store.sharedDir],['user',store.userDir]]){
  for(const file of await fs.readdir(root)){
   if(!/^[a-z0-9_.-]+\.yaml$/i.test(file)||file.endsWith('.dict.yaml')||['user.yaml','installation.yaml'].includes(file))continue;
   const resource=await readText(root,file);before.set(file,digest(resource.text));seedGuards.push({origin,file,exists:resource.exists,hash:digest(resource.text)});await fs.writeFile(path.join(outputDir,file),resource.text,{mode:0o600});
  }
 }
 // Pin the installer itself. Fetch and recipe execution share the same confinement.
 await runSandbox(workDir,['/bin/bash','-c',`git init plum && git -C plum remote add origin https://github.com/rime/plum.git && git -C plum fetch --depth 1 origin ${PLUM_COMMIT} && git -C plum checkout --detach FETCH_HEAD`],restriction);
 const result=await runSandbox(workDir,['/usr/bin/env',`rime_dir=${outputDir}`,`plum_dir=${engineDir}`,'/bin/bash',path.join(engineDir,'rime-install'),...recipes],restriction);
 const sources=[],sourceDirs=[];
 const packageRoot=path.join(engineDir,'package');
 const packageStat=await fs.lstat(packageRoot).catch(()=>null);if(packageStat?.isSymbolicLink()||!packageStat?.isDirectory())fail('plum 下载来源目录无效');
 for(const owner of await fs.readdir(packageRoot)){
  const ownerDir=path.join(packageRoot,owner),ownerStat=await fs.lstat(ownerDir);if(!ownerStat.isDirectory()||ownerStat.isSymbolicLink())fail('plum 来源目录包含符号链接');
  for(const repo of await fs.readdir(ownerDir)){
  const dir=path.join(packageRoot,owner,repo),stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())fail('plum 来源目录无效');const git=await fs.lstat(path.join(dir,'.git')).catch(()=>null);if(!git?.isDirectory()||git.isSymbolicLink())continue;
  const [{stdout:commit},{stdout:remote}]=await Promise.all([runSandbox(workDir,['git','-C',dir,'rev-parse','HEAD'],restriction),runSandbox(workDir,['git','-C',dir,'config','--get','remote.origin.url'],restriction)]);
  if(!/^[0-9a-f]{40}$/.test(commit.trim())||!/^https:\/\/github.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(remote.trim()))fail('plum 下载来源不符合 GitHub 仓库格式');
  const repoName=remote.trim().replace(/^https:\/\/github.com\//,'').replace(/\.git$/,'');sources.push({repo:repoName,commit:commit.trim()});sourceDirs.push({repo:repoName,dir});
  }
 }
 const supplementedFiles=supplement?await supplement({outputDir,sourceDirs,workDir,restriction}):[];
 const files=[],outputFiles=await stageFiles(outputDir);
 for(const file of before.keys())if(!outputFiles.includes(file))fail(`配方删除了 ${file}；暂不自动应用文件删除`);
 for(const file of outputFiles){
  const encoding=/\.(gram|db|ocd|ocd2)$/.test(file)?'base64':'utf8',resource=await readResource(outputDir,file,encoding);
  if(before.get(file)!==digest(resource.text,encoding))files.push(file);
 }
 if(!sources.length)fail('plum 未记录到下载来源');
 return {outputDir,files,revision,seedGuards,provenance:{backend:'plum',recipes,plumCommit:PLUM_COMMIT,sources,supplementedFiles},log:(result.stdout+result.stderr).slice(-12000)};
}
export function plumIdentity(recipes){return 'plum-'+crypto.createHash('sha256').update(recipes.join('\n')).digest('hex').slice(0,16);}
