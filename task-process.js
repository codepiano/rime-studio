import {spawn} from 'node:child_process';
export function runTask(file,args,{cwd,env=process.env,timeout=180000,signal,onOutput=()=>{},label='任务',maxBuffer=2*1024*1024}={}){
 if(signal?.aborted)return Promise.reject(new Error('任务已取消'));
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',bytes=0,failure=null;
  const stop=message=>{failure=new Error(message);try{process.kill(-child.pid,'SIGKILL');}catch{}};
  const abort=()=>stop('任务已取消');signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>stop(`${label}超时`),timeout);
  for(const [stream,error] of [[child.stdout,false],[child.stderr,true]])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBuffer){stop(`${label}输出超过限制`);return;}const text=chunk.toString();if(error)stderr+=text;else stdout+=text;onOutput(text);});
  child.on('error',error=>{failure=new Error(error.code==='ENOENT'?`未找到${label}所需的程序`:error.message);});
  child.on('close',(code,sig)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure)return reject(failure);if(code!==0)return reject(new Error(`${label}失败（${sig||code}）：${stderr.slice(-2000)||stdout.slice(-2000)}`));resolve({stdout,stderr});});
 });
}
