import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {digest,safeFile,readResource} from './file-transactions.js';
import {withFileDiff} from './review-diff.js';
const exec=promisify(execFile);
const baseDir=store=>path.join(store.dataDir,'package-bases');
export async function saveBase(store,text,encoding='utf8'){
 const hash=digest(text,encoding),dir=baseDir(store);await fs.mkdir(dir,{recursive:true,mode:0o700});
 const file=await safeFile(dir,hash);try{await fs.writeFile(file,encoding==='base64'?Buffer.from(text,'base64'):text,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
 return hash;
}
export async function readBase(store,hash,encoding='utf8'){
 if(!/^[a-f0-9]{64}$/.test(hash||''))return null;
 const dir=baseDir(store);if(!await fs.access(dir).then(()=>true,()=>false))return null;
 const data=await readResource(dir,hash,encoding);if(!data.exists)return null;if(digest(data.text,encoding)!==hash)throw new Error('安装基线内容校验失败');return data.text;
}
export async function mergeText(local,base,incoming){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rime-package-merge-'));
 try{for(const [name,text] of [['local',local],['base',base],['upstream',incoming]])await fs.writeFile(path.join(dir,name),text,{mode:0o600});
  let stdout,code=0;try{({stdout}=await exec('git',['merge-file','-p','--diff3','-L','本地','-L','上次上游','-L','新版上游',...['local','base','upstream'].map(x=>path.join(dir,x))],{timeout:10000,maxBuffer:1024*1024}));}catch(error){if(!Number.isInteger(error.code)||error.code<1||error.code>127)throw new Error('无法生成合并建议');stdout=error.stdout;code=error.code;}
  return {text:stdout,clean:code===0};
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
export function validateResolution(value,binary){
 if(!value||!['keep','upstream','merge'].includes(value.choice))throw new Error('请选择保留本地、使用上游或手动合并');
 if(value.choice==='merge'&&(binary||typeof value.text!=='string'||Buffer.byteLength(value.text)>1000000||value.text.includes('\0')||/^(?:<{7}|={7}|>{7}|\|{7})(?: |$)/m.test(value.text)))throw new Error('合并文本超过 1 MB、包含未解决的冲突标记或不支持的内容');
 return value;
}
export async function conflictDetail(store,preview,idFile){
 const plan=store.previews.get(preview);if(!plan?.packagePlan||Date.now()-plan.created>600000)throw new Error('更新预览已过期，请重新生成');
 const row=plan.packagePlan.conflicts.find(x=>x.file===idFile);if(!row)throw new Error('文件不在冲突清单内');
 const now=await readResource(store.userDir,row.file,row.encoding);if(!now.exists||digest(now.text,row.encoding)!==row.localHash)throw new Error('本地文件已变化，请重新生成预览');
 const base=await readBase(store,row.baseHash,row.encoding),incoming=await readResource(plan.packagePlan.sourceDir,row.file,row.encoding);if(digest(incoming.text,row.encoding)!==row.incomingHash)throw new Error('暂存上游文件已变化，请重新下载');
 const editable=row.encoding!=='base64'&&Buffer.byteLength(now.text)+Buffer.byteLength(incoming.text)+(base?Buffer.byteLength(base):0)<=1000000;
 const suggestion=editable&&base!==null?await mergeText(now.text,base,incoming.text):null;
 const diff=editable&&Buffer.byteLength(now.text)+Buffer.byteLength(incoming.text)<=64000?withFileDiff({files:[{file:row.file,before:now.text,after:incoming.text}]}).files[0]:null;
 return {resolution:plan.packagePlan.resolutions?.[row.file]||{choice:'keep'},file:row.file,localHash:row.localHash,incomingHash:row.incomingHash,baseAvailable:base!==null,editable,binary:row.encoding==='base64',localBytes:Buffer.byteLength(now.text,row.encoding==='base64'?'base64':'utf8'),incomingBytes:Buffer.byteLength(incoming.text,row.encoding==='base64'?'base64':'utf8'),local:editable?now.text:null,incoming:editable?incoming.text:null,base:editable?base:null,suggestion,diff};
}
