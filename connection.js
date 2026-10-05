import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export function resolveDirectory(value,home=os.homedir()){
 if(value===undefined||value==='')return '';
 if(typeof value!=='string'||value.length>4096||value.includes('\0'))throw new Error('请输入有效的目录路径');
 let result=value.trim();if(result==='~')result=home;else if(result.startsWith('~/'))result=path.join(home,result.slice(2));
 if(!path.isAbsolute(result))throw new Error('目录需要是绝对路径，或以 ~/ 开头');
 return path.normalize(result);
}
async function directory(value,writable=false){
 if(!value)return null;
 try{const canonical=await fs.realpath(value);if(!(await fs.stat(canonical)).isDirectory())return null;await fs.access(canonical,constants.R_OK|(writable?constants.W_OK:0));return canonical;}catch{return null;}
}
async function resourceDir(value){
 const canonical=await directory(value);if(!canonical)return null;
 try{for(const file of ['default.yaml','squirrel.yaml']){const target=path.join(canonical,file);if(!(await fs.stat(target)).isFile())return null;await fs.access(target,constants.R_OK);}return canonical;}catch{return null;}
}
async function installation(appPath){
 try{const plist=await fs.readFile(path.join(appPath,'Contents/Info.plist'),'utf8');if(!/<key>CFBundleIdentifier<\/key>\s*<string>im\.rime\.inputmethod\.Squirrel<\/string>/.test(plist))return null;
 const sharedDir=await resourceDir(path.join(appPath,'Contents/SharedSupport'));if(!sharedDir)return null;
 const binary=path.join(appPath,'Contents/MacOS/Squirrel');let executable=false;try{executable=(await fs.stat(binary)).isFile();await fs.access(binary,constants.X_OK);}catch{executable=false;}
 return {appPath:await fs.realpath(appPath),sharedDir,binary:executable?binary:null,version:plist.match(/<key>CFBundleVersion<\/key>\s*<string>(.*?)<\/string>/)?.[1]||'未知'};
 }catch{return null;}
}
export async function discoverConnection({home=os.homedir(),systemApp='/Library/Input Methods/Squirrel.app',platform=process.platform,env=process.env,preferences={}}={}){
 const checks=[];let app=null;
 // Probe system resources first, then per-user installation and data. Never create Rime folders.
 for(const [label,candidate] of [['系统鼠须管',systemApp],['当前用户的鼠须管',path.join(home,'Library/Input Methods/Squirrel.app')]]){
  const found=await installation(candidate);checks.push({label,path:candidate,found:!!found});if(found&&!app)app=found;
 }
 const expectedUserDir=path.join(home,'Library/Rime');const nativeUserDir=await directory(expectedUserDir,true);checks.push({label:'当前用户的 Rime 配置',path:expectedUserDir,found:!!nativeUserDir});
 const choose=(key,envKey,automatic)=>{const source=env[envKey]?'environment':preferences[key]?'saved':'automatic';try{return {path:resolveDirectory(source==='environment'?env[envKey]:source==='saved'?preferences[key]:automatic||'',home),source};}catch(e){return {path:'',source,invalid:e.message};}};
 const user=choose('userDir','RIME_USER_DIR',nativeUserDir),shared=choose('sharedDir','RIME_SHARED_DIR',app?.sharedDir);
 const userDir=await directory(user.path,true),sharedDir=await resourceDir(shared.path);const issues=[];
 if(user.invalid)issues.push(`用户目录设置无效：${user.invalid}`);if(shared.invalid)issues.push(`内置目录设置无效：${shared.invalid}`);
 if(!userDir)issues.push('没有找到可读写的 Rime 用户目录，请在连接设置中指定。');
 if(!sharedDir)issues.push('没有找到包含 default.yaml 和 squirrel.yaml 的内置配置目录，请在连接设置中指定。');
 const id=userDir&&sharedDir?crypto.createHash('sha256').update(userDir+'\0'+sharedDir).digest('hex').slice(0,24):null;
 const canDeploy=!!(platform==='darwin'&&app?.binary&&nativeUserDir===userDir&&app.sharedDir===sharedDir);
 return {ready:!!id,confirmed:!!(id&&(preferences.confirmed||env.RIME_USER_DIR||env.RIME_SHARED_DIR)),id,userDir:userDir||user.path||'',sharedDir:sharedDir||shared.path||'',expectedUserDir,nativeUserDir,appPath:app?.appPath||null,binary:app?.binary||null,version:app?.version||'未检测到',platform,canDeploy,source:{userDir:user.source,sharedDir:shared.source},checks,issues};
}
export async function loadPreferences(file){try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('连接设置文件格式无效');return {userDir:value.userDir||'',sharedDir:value.sharedDir||'',confirmed:value.confirmed===true};}catch(e){if(e.code==='ENOENT')return {};throw e;}}
export async function savePreferences(file,value){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+crypto.randomUUID();try{await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}}
export function backupDirectory(root,connection,dataDir=path.join(root,'.data')){return connection.userDir===connection.nativeUserDir?path.join(dataDir,'backups'):path.join(dataDir,'backups',crypto.createHash('sha256').update(connection.userDir).digest('hex').slice(0,24));}
