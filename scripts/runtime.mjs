import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const manifest=JSON.parse(await fs.readFile(path.join(root,'control-panel.json'),'utf8'));
const runtime=path.join(root,'.runtime'),pidFile=path.join(root,manifest.pidFile);
const identityFile=path.join(runtime,'server.identity.json'),lockFile=path.join(runtime,'control.lock');
const base=manifest.frontendUrl,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function identity(pid){
 if(!Number.isInteger(pid)||pid<=1)return '';
 const result=spawnSync('ps',['-p',String(pid),'-o','lstart=','-o','command='],{encoding:'utf8'});
 return result.status===0?result.stdout.trim():'';
}
async function health(){try{const response=await fetch(base+'/health',{signal:AbortSignal.timeout(700)});if(response.ok){const value=await response.json();if(value.service==='rime-studio'&&value.ok)return value;}}catch{}return null;}
async function handle(){try{const value=JSON.parse(await fs.readFile(identityFile,'utf8'));const pid=Number((await fs.readFile(pidFile,'utf8')).trim());if(value.pid!==pid||!Number.isInteger(pid)||pid<=1)throw new Error('invalid pid');return value;}catch(error){if(error.code==='ENOENT')return null;throw new Error('进程记录无效，拒绝控制：'+error.message);}}
async function clear(){await fs.rm(pidFile,{force:true});await fs.rm(identityFile,{force:true});}
async function state(){const saved=await handle();if(saved){const current=identity(saved.pid);if(current&&current!==saved.identity)throw new Error('PID 已被其他进程使用，拒绝控制');if(current){const live=await health();return {status:live?.pid===saved.pid?'running':'failed',saved};}}
 const live=await health();return {status:live?'unknown':'stopped',saved};}
async function start(){
 const current=await state();if(current.status==='running')return;
 if(current.status!=='stopped')throw new Error('服务已在脚本之外启动或尚未就绪，拒绝创建第二个进程');
 await clear();
 await fs.access(path.join(root,'node_modules/express/package.json')).catch(()=>{throw new Error('请先运行 scripts/install.sh 安装依赖');});
 const log=await fs.open(path.join(runtime,'server.log'),'a');
 const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PORT:String(manifest.ports[0]),RIME_STUDIO_MANAGED:'1'}});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await log.close();
 const saved={pid:child.pid,identity:identity(child.pid)};
 if(!saved.identity)throw new Error('启动进程提前退出，请查看 .runtime/server.log');
 await fs.writeFile(identityFile,JSON.stringify(saved));await fs.writeFile(pidFile,String(child.pid)+'\n');
 for(let i=0;i<50;i++){if(identity(saved.pid)!==saved.identity)break;const live=await health();if(live?.pid===saved.pid)return;await wait(100);}
 await stop();throw new Error('服务启动失败，请查看 .runtime/server.log（可能端口被占用）');
}
async function stop(){
 const saved=await handle();if(!saved){if(await health())throw new Error('服务由脚本之外启动，停止操作不受支持');return;}
 const current=identity(saved.pid);if(!current){await clear();return;}
 if(current!==saved.identity)throw new Error('PID 已被其他进程使用，拒绝停止');
 process.kill(saved.pid,'SIGTERM');
 for(let i=0;i<50;i++){if(identity(saved.pid)!==saved.identity){await clear();return;}await wait(100);}
 if(identity(saved.pid)===saved.identity)process.kill(saved.pid,'SIGKILL');
 for(let i=0;i<20;i++){if(identity(saved.pid)!==saved.identity){await clear();return;}await wait(100);}
 throw new Error('进程未能退出，保留记录以便排查');
}
async function acquire(){
 await fs.mkdir(runtime,{recursive:true});
 for(let i=0;i<100;i++){
  try{const lock=await fs.open(lockFile,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,identity:identity(process.pid)}));await lock.close();return;}catch(error){if(error.code!=='EEXIST')throw error;}
  try{const owner=JSON.parse(await fs.readFile(lockFile,'utf8'));if(identity(owner.pid)!==owner.identity){await fs.rm(lockFile,{force:true});continue;}}catch{}
  await wait(100);
 }
 throw new Error('另一个生命周期操作正在运行，稍后重试');
}
let locked=false;
try{
 const action=process.argv[2];
 if(action==='status'){
  const result=await state();console.log(JSON.stringify({status:result.status,updatedAt:new Date().toISOString(),runtimeMode:manifest.runtimeMode,processMode:manifest.processMode,...(result.status==='running'?{pid:result.saved.pid}:{})}));process.exitCode=result.status==='running'?0:result.status==='unknown'?3:1;
 }else{
  await acquire();locked=true;
  if(action==='start')await start();
  else if(action==='stop')await stop();
  else if(action==='restart'){await stop();await start();}
  else if(action==='uninstall'){await stop();await fs.rm(path.join(runtime,'server.log'),{force:true});}
  else if(action==='openEntry'){await start();const opened=spawnSync('open',[base],{stdio:'inherit'});if(opened.error||opened.status!==0)throw new Error('无法打开浏览器');}
  else throw new Error('不支持的操作：'+action);
  console.log(action+' complete');
 }
}catch(error){console.error(error.message);process.exitCode=2;}
finally{if(locked)await fs.rm(lockFile,{force:true});}
