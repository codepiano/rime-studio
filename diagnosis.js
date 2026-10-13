import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {safeFile,digest} from './file-transactions.js';
import {searchResources} from './search.js';
import {phraseFiles,dictionaryHeader} from './library.js';
const exec=promisify(execFile),native=fileURLToPath(new URL('./native/',import.meta.url));
const fail=message=>{throw new Error(message);};
export function diagnosisInput(body){
 if(typeof body.schema!=='string'||!/^[a-z0-9_.-]+$/.test(body.schema)||body.schema.length>100)fail('请选择有效方案');
 if(typeof body.code!=='string'||!body.code||body.code.length>80||/[^\x20-\x7e]/.test(body.code))fail('请输入 1–80 个可打印的 ASCII 按键，空格表示选词');
 if(body.expected!==undefined&&(typeof body.expected!=='string'||body.expected.length>100||/[\x00-\x1f\x7f]/.test(body.expected)))fail('期望词条不能超过 100 个字符或包含控制字符');
 return {schema:body.schema,code:body.code,expected:body.expected?.trim()||''};
}
const canonical=value=>{try{return realpathSync(value);}catch{return path.resolve(value);}};
function permitted(file){
 const parts=file.split('/');if(parts.some(p=>p.startsWith('.')||p.endsWith('.userdb')||['sync','backup','trash'].includes(p)))return false;
 if(['user.yaml','installation.yaml'].includes(file)||/\.userdb\.txt$/.test(file))return false;
 // Rebuild source configurations; retain only shared prebuilt binary dictionaries.
 if(parts[0]==='build')return /\.(bin|gram|db|ocd2?)$/.test(file);
 return /\.(yaml|txt|lua|json|gram|db|ocd2?)$/.test(file);
}
async function diagnosisFiles(root,origin){
 const files=[];
 async function walk(prefix='',depth=0){if(depth>6)fail('诊断资源目录层级过深');
  for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
   const file=prefix?prefix+'/'+entry.name:entry.name;
   if(entry.name.startsWith('.')||entry.name.endsWith('.userdb')||['sync','backup','trash'].includes(entry.name))continue;
   if(entry.isDirectory()){if(file==='build'&&origin==='user')continue;await safeFile(root,file+'/placeholder');await walk(file,depth+1);}
   else if(permitted(file)){await safeFile(root,file);files.push(file);}
   if(files.length>2000)fail('诊断资源超过 2000 个文件');
  }
 }await walk();return files.sort();
}
export async function stageDiagnosis(store,dir){
 const guards=[],manifests={};let bytes=0,count=0;
 for(const [origin,root] of [['shared',store.sharedDir],['user',store.userDir]]){
  const files=await diagnosisFiles(root,origin);manifests[origin]=files;
  for(const file of files){
   const source=await safeFile(root,file),stat=await fs.stat(source);if(bytes+stat.size>512*1024*1024||++count>2000)fail('诊断资源超过 512 MB 或 2000 个文件，请使用较小的配置目录');
   bytes+=stat.size;const buffer=await fs.readFile(source);guards.push({origin,file,hash:digest(buffer)});
   const dest=path.join(dir,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,buffer,{mode:0o600});
  }
 }
 return {guards,manifests,bytes,count};
}
export function diagnosisSandbox(dir,frameworks,protectedRoots){
 const quote=value=>JSON.stringify(value),allowed=`(require-any (subpath ${quote(dir)}) (subpath ${quote(frameworks)}))`;
 return '(version 1)\n(allow default)\n(deny network*)\n(deny process-exec (require-not (literal '+quote(path.join(dir,'probe'))+')))\n'+
  `(deny file-write* (require-not (require-any (subpath ${quote(dir)}) (subpath "/dev"))))\n`+
  [...new Set(['/Users','/Volumes',os.homedir(),...protectedRoots].map(canonical))].map(root=>`(deny file-read-data (require-all (subpath ${quote(root)}) (require-not ${allowed})))`).join('\n')+
  '\n(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))\n';
}
async function runProbe(dir,frameworks,store,args){
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/sandbox-exec',['-p',diagnosisSandbox(dir,frameworks,[store.userDir,store.sharedDir]),path.join(dir,'probe'),...args],{cwd:dir,detached:true,env:{PATH:'/usr/bin:/bin',HOME:dir,TMPDIR:path.join(dir,'tmp'),LC_ALL:'C'},stdio:['ignore','pipe','pipe']});
  let output='',bytes=0,failure;const stop=message=>{failure=new Error(message);try{process.kill(-child.pid,'SIGKILL');}catch{}};
  const timer=setTimeout(()=>stop('隔离输入诊断超时（60 秒），请检查方案和词库'),60000);
  for(const [stream,keep] of [[child.stdout,true],[child.stderr,false]])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024)stop('诊断输出超过限制');else if(keep)output+=chunk.toString();});
  child.on('error',()=>{clearTimeout(timer);reject(new Error('无法启动隔离诊断，请检查 macOS sandbox-exec'));});
  child.on('close',code=>{clearTimeout(timer);if(failure)return reject(failure);if(code!==0)return reject(new Error('隔离 Rime 运行失败，请检查方案、扩展和词库'));try{resolve(JSON.parse(output));}catch{reject(new Error('隔离引擎未返回有效诊断结果'));}});
 });
}
const helperBuilds=new Map();
async function helper(dataDir){
 if(!helperBuilds.has(dataDir))helperBuilds.set(dataDir,(async()=>{
  const files=['input-diagnosis.m','librime/rime_api.h'],hash=crypto.createHash('sha256');for(const file of files)hash.update(await fs.readFile(path.join(native,file)));hash.update(process.arch);
  const dir=path.join(dataDir,'native',hash.digest('hex').slice(0,20)),binary=path.join(dir,'input-diagnosis');await fs.mkdir(dir,{recursive:true,mode:0o700});
  try{await fs.access(binary,fs.constants.X_OK);}catch{const temp=binary+'-'+crypto.randomUUID();try{await exec('/usr/bin/clang',[path.join(native,'input-diagnosis.m'),'-O2','-framework','Foundation','-o',temp],{timeout:30000,maxBuffer:500000});await fs.chmod(temp,0o700);await fs.rename(temp,binary);}catch{fail('输入诊断需要 macOS 命令行工具（clang）');}finally{await fs.rm(temp,{force:true});}}
  return binary;
 })().catch(e=>{helperBuilds.delete(dataDir);throw e;}));
 return helperBuilds.get(dataDir);
}
async function staticChecks(store,snapshot,schema,dir,input){
 const checks=[{level:snapshot.enabled.includes(schema.id)?'ok':'warning',title:'方案菜单',message:snapshot.enabled.includes(schema.id)?'已保存为启用方案':'该方案未启用，系统菜单中可能无法选择'},
 {level:schema.deployed?'ok':'warning',title:'部署记录',message:schema.deployed?'发现已部署配置；试输使用当前保存的源配置':'没有已部署配置，保存后还需要重新部署'}];
 if(snapshot.enabled.includes(schema.id)&&!snapshot.deployedEnabled.includes(schema.id))checks.push({level:'warning',title:'已部署菜单',message:'已保存为启用，但现有部署菜单中没有该方案'});
 const custom=await fs.stat(await safeFile(store.userDir,schema.id+'.custom.yaml')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 const stamp=schema.deployedConfig.__build_info?.timestamps?.[schema.id+'.custom'];
 if(custom&&(!stamp||stamp<Math.floor(custom.mtimeMs/1000)))checks.push({level:'warning',title:'配置新旧',message:'自定义配置的保存时间晚于编译记录，试输成功后仍需部署'});
 const cfg=schema.config,alphabet=cfg.speller?.alphabet;
 if(typeof alphabet==='string'){const unsupported=[...new Set(input.code.replace(/ /g,'').split('').filter(c=>!alphabet.includes(c)))];checks.push({level:unsupported.length?'warning':'ok',title:'按键范围',message:unsupported.length?`这些按键不在 speller/alphabet 中：${unsupported.join(' ')}；可能被其他组件处理`:'按键均在当前方案的字母表中'});}
 const dictionaries=new Set();for(const item of cfg.engine?.translators||[]){const namespace=typeof item==='string'?(item.split('@')[1]||'translator'):'';if(cfg[namespace]?.dictionary)dictionaries.add(cfg[namespace].dictionary);}
 const visited=new Set();async function check(name){if(visited.has(name))return;visited.add(name);const file=name+'.dict.yaml';try{const raw=await fs.readFile(await safeFile(dir,file),'utf8'),head=dictionaryHeader(raw);checks.push({level:'ok',title:'词库文件',message:file+' 可读取'});for(const imported of head.imports)await check(imported);}catch(error){checks.push({level:'error',title:'词库文件',message:file+'：'+(error.code==='ENOENT'?'缺少源词库（内置二进制词库仍可能可用）':error.message)});}}
 for(const name of dictionaries)await check(name);
 for(const {file} of phraseFiles(schema)){try{await fs.access(await safeFile(dir,file));checks.push({level:'ok',title:'短语挂载',message:file+' 已挂载，可在隔离会话中验证短码'});}catch{checks.push({level:'error',title:'短语挂载',message:file+' 不存在'});}}
 if(input.expected){
  const matches=(await searchResources(store,input.expected)).results.filter(row=>row.text===input.expected&&(!row.schema||row.schema===schema.id));
  for(const row of matches.slice(0,8)){
   const attached=row.kind==='phrase'||row.kind==='personal'&&visited.has(row.file.replace(/\.dict\.yaml$/,''));
   checks.push({level:attached?'ok':'warning',title:'期望词的来源',message:`${row.source}：保存编码 ${row.code}${row.kind==='learned'?'；隔离会话不载入真实学习记录':attached?'；已发现方案引用，按键仍受拼写规则影响':'；未静态发现该个人词库被当前方案引用'}`});
  }
 }
 return checks;
}
export async function diagnoseInput(store,connection,dataDir,body){
 const input=diagnosisInput(body);if(store.busy)fail('配置正在保存或诊断，请稍后重试');store.busy=true;
 let dir;try{
  const snapshot=await store.snapshot(),schema=snapshot.schemas.find(x=>x.id===input.schema);if(!schema)fail('方案未安装');
  if(process.platform!=='darwin'||!connection.appPath)fail('隔离试输需要本机安装的 macOS 鼠须管');
  const frameworks=await fs.realpath(path.join(connection.appPath,'Contents/Frameworks')),library=await fs.realpath(path.join(frameworks,'librime.1.dylib'));
  if(!library.startsWith(frameworks+path.sep))fail('Rime 引擎必须位于已检测的鼠须管应用中');
  const binary=await helper(dataDir);dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'rime-studio-diagnosis-')));
  const staged=await stageDiagnosis(store,dir);await fs.mkdir(path.join(dir,'tmp'));await fs.mkdir(path.join(dir,'build'),{recursive:true});await fs.copyFile(binary,path.join(dir,'probe'));await fs.chmod(path.join(dir,'probe'),0o700);
  const checks=await staticChecks(store,snapshot,schema,dir,input);
  const trial=await runProbe(dir,frameworks,store,[library,dir,input.schema,input.code]);
  for(const [origin,root] of [['user',store.userDir],['shared',store.sharedDir]])if(JSON.stringify(await diagnosisFiles(root,origin))!==JSON.stringify(staged.manifests[origin]))fail('资源文件清单在诊断期间变化，请重新运行');
  for(const guard of staged.guards){const bytes=await fs.readFile(await safeFile(guard.origin==='user'?store.userDir:store.sharedDir,guard.file));if(digest(bytes)!==guard.hash)fail('资源在诊断期间变化，请重新运行');}
  if((await store.snapshot()).revision!==snapshot.revision)fail('配置在诊断期间变化，请重新运行');
  const texts=[...(trial.candidates||[]).map(x=>x.text),...(trial.commits||[])];
  if(input.expected)checks.push({level:texts.includes(input.expected)?'ok':'warning',title:'期望词条',message:texts.includes(input.expected)?'期望词条已出现在隔离试输结果中':`前 ${(trial.candidates||[]).length} 个候选及提交文本中未找到期望词条；可核对完整编码、词库挂载、过滤器和候选翻页`});
  return {input,schemaName:schema.name,revision:snapshot.revision,checks,trial,resources:{files:staged.count,bytes:staged.bytes},scope:'当前保存的源配置 · 临时 Rime 会话 · 未载入真实学习数据库 · 中文／半角模式；真实应用的按键和输入效果需另行确认'};
 }finally{try{if(dir)await fs.rm(dir,{recursive:true,force:true});}finally{store.busy=false;}}
}
