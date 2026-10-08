import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {ConfigStore} from './config.js';
import {articles,components} from './content.js';
import {withFileDiff} from './review-diff.js';
import {discoverConnection,loadPreferences,savePreferences,backupDirectory,resolveDirectory} from './connection.js';
const exec=promisify(execFile),root=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await fs.readFile(path.join(root,'control-panel.json'),'utf8'));
const port=Number(process.env.PORT||manifest.ports[0]);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 必须是 1 到 65535 的整数');
const sourceRoot=process.env.RIME_SOURCE_DIR||path.resolve(root,'../../work');
const dataDir=process.env.RIME_STUDIO_DATA_DIR||path.join(root,'.data');
const preferencesFile=path.join(dataDir,'settings.json');
let preferenceError='',preferences={};try{preferences=await loadPreferences(preferencesFile);}catch(e){preferenceError=e.message;}
let connection=await discoverConnection({preferences});if(preferenceError)connection.issues.push(`已保存的连接设置无法读取：${preferenceError}`);
let store=connection.ready?new ConfigStore({userDir:connection.userDir,sharedDir:connection.sharedDir,dataDir:backupDirectory(root,connection,dataDir)}):null;
let switching=false;
const emptySnapshot={revision:null,defaults:{},squirrel:{},schemas:[],files:{},enabled:[],deployedEnabled:[],themes:[],history:[]};
function connected(req){if(switching)throw new Error('正在切换配置目录，请稍后重试');if(!connection.ready||!store)throw new Error('请先在连接设置中指定有效的配置目录');if(!connection.confirmed)throw new Error('请先在连接设置中确认实际正在使用的配置目录');if(req.body.connectionId!==connection.id)throw new Error('配置目录已变化，请刷新页面后重新操作');return store;}
async function state(){const current=connection,active=store;let snapshot=emptySnapshot,status={...current};if(current.ready&&active){try{snapshot=await active.snapshot();}catch(e){status={...current,ready:false,issues:[...current.issues,`配置读取失败：${e.message}`]};}}return {...snapshot,token,version:current.version,connection:status,deployment,articles,components,repos:repos.map(x=>({...x}))};}
const app=express(),token=crypto.randomBytes(32).toString('hex');
const origins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
app.use((req,res,next)=>{
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return res.status(403).json({error:'只允许本机访问'});
 if(req.headers.origin&&!origins.includes(req.headers.origin))return res.status(403).json({error:'来源不受信任'});
 if(req.path.startsWith('/api/')||req.path==='/control-panel/metrics')res.set('Cache-Control','no-store');
 res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
 res.set('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'&&req.headers['x-rime-token']!==token)return res.status(403).json({error:'请从本地界面操作'});next();
});
app.use(express.json({limit:'150kb'}));
const route=fn=>async(req,res,next)=>{try{res.json(await fn(req,res));}catch(e){next(e);}};
let deployment={state:'idle',message:'尚未发起部署'};
const repos=[
 {id:'squirrel',name:'Squirrel · macOS 外壳',url:'https://github.com/rime/squirrel',ref:'1.1.2',description:'接收 macOS 键盘事件，管理输入会话，呈现候选窗口。源码快照使用 1.1.2 标签；本机安装版本在连接设置中显示，不保证两者相同。',files:['sources/Main.swift','sources/SquirrelApplicationDelegate.swift','sources/SquirrelInputController.swift','sources/MacOSKeyCodes.swift','sources/SquirrelTheme.swift','sources/SquirrelPanel.swift','sources/SquirrelView.swift','data/squirrel.yaml','CHANGELOG.md']},
 {id:'librime',name:'librime · 输入引擎',url:'https://github.com/rime/librime',ref:'HEAD',description:'配置编译、拼写、分词、候选生成和用户词库。此处为下载时的源码快照，不保证与本机内置引擎完全一致。',files:['src/rime/engine.cc','src/rime/gear/ascii_composer.cc','src/rime/gear/speller.cc','src/rime/gear/simplifier.cc','src/rime/config/config_compiler.cc','src/rime/config/auto_patch_config_plugin.cc','src/rime/dict/user_dictionary.cc','src/rime_api.h','README.md']},
 {id:'plum',name:'plum · 配方与方案安装',url:'https://github.com/rime/plum',ref:'HEAD',description:'输入方案分发与安装流程。当前只读探索，不执行配方脚本。',files:['README.md','rime-install']},
 {id:'rime-wiki',name:'Rime Wiki · 文档原文',url:'https://github.com/rime/home/wiki',ref:'HEAD',description:'完整 Wiki 本地快照；界面中的说明卡按使用目的重新编写，原文可在这里查证。',files:['UserGuide.md','CustomizationGuide.md','RimeWithSchemata.md','RimeWithTheCode.md','Recipes.md','FAQ.md','SpellingAlgebra.md','Configuration.md','UserData.md','SharedData.md']}
];
let offlineSources={};try{offlineSources=JSON.parse(await fs.readFile(path.join(root,'research-snapshots.json'),'utf8'));}catch{}
for(const repo of repos){if(offlineSources[repo.id]){repo.commit=offlineSources[repo.id].commit;repo.files=Object.keys(offlineSources[repo.id].files);repo.available=true;continue;}try{repo.commit=(await exec('git',['-C',path.join(sourceRoot,repo.id),'rev-parse',repo.ref])).stdout.trim();const existing=[];for(const file of repo.files){try{await exec('git',['-C',path.join(sourceRoot,repo.id),'cat-file','-e',`${repo.commit}:${file}`]);existing.push(file);}catch{}}repo.files=existing;repo.available=true;}catch{repo.available=false;}}
app.get('/health',route(async()=>({ok:true,service:'rime-studio',pid:process.pid})));
app.get('/control-panel/metrics',route(async()=>{const memory=process.memoryUsage();return {status:'running',updatedAt:new Date().toISOString(),runtimeMode:'development',processMode:process.env.RIME_STUDIO_MANAGED==='1'?'managed':'observed',pid:process.pid,uptimeSec:process.uptime(),memory:{rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,heapTotalBytes:memory.heapTotal}};}));
app.get('/api/state',route(async()=>state()));
app.post('/api/connection',route(async req=>{
 if(switching||store?.busy||deployment.state==='running')throw new Error('配置保存或部署期间不能切换目录');
 switching=true;try{
  const next=req.body.reset?{}:{userDir:resolveDirectory(req.body.userDir),sharedDir:resolveDirectory(req.body.sharedDir),confirmed:true};
  const candidate=await discoverConnection({preferences:next});
  if(!req.body.reset&&!candidate.ready)throw new Error(candidate.issues.join(' '));
  const active=candidate.ready?new ConfigStore({userDir:candidate.userDir,sharedDir:candidate.sharedDir,dataDir:backupDirectory(root,candidate,dataDir)}):null;
  if(active)await active.snapshot();
  await savePreferences(preferencesFile,next);preferences=next;connection=candidate;store=active;
  deployment={state:'idle',message:'尚未发起部署'};
  return await state();
 }finally{switching=false;}
}));
app.post('/api/preview',route(async req=>withFileDiff(await connected(req).preview(req.body.changes,req.body.revision))));
app.post('/api/apply',route(async req=>{if(deployment.state==='running')throw new Error('部署期间请等待后再保存');return connected(req).apply(req.body.id);}));
app.post('/api/restore',route(async req=>{if(deployment.state==='running')throw new Error('部署期间请等待后再恢复');return connected(req).restore(req.body.id);}));
app.get('/api/source',route(async req=>{const repo=repos.find(r=>r.id===req.query.repo);if(!repo?.available||!repo.files.includes(req.query.file))throw new Error('源码文件不在浏览清单内');let stdout=offlineSources[repo.id]?.files[req.query.file];if(stdout===undefined)({stdout}=await exec('git',['-C',path.join(sourceRoot,repo.id),'show',`${repo.commit}:${req.query.file}`],{maxBuffer:2*1024*1024}));return {text:stdout,commit:repo.commit,url:repo.id==='rime-wiki'?`${repo.url}/${String(req.query.file).replace('.md','')}`:`${repo.url}/blob/${repo.commit}/${req.query.file}`};}));
app.get('/api/deployment',route(async()=>deployment));
app.post('/api/deploy',route(async req=>{
 if(process.env.RIME_DISABLE_DEPLOY==='1')throw new Error('测试环境禁用了真实部署');connected(req);if(!connection.canDeploy)throw new Error('所选目录不是当前鼠须管的原生配置目录，不能请求系统重载；保存仍只作用于所选目录');if(store.busy)throw new Error('配置正在保存');if(deployment.state==='running')throw new Error('正在部署，请等待');
 const userDir=connection.userDir,binary=connection.binary;const active=store;
 const snap=await active.snapshot();const targets=['default','squirrel',...snap.enabled.map(id=>`${id}.schema`)];const expected={};for(const name of targets){const custom=name.replace(/\.schema$/,'')+'.custom.yaml';const st=await fs.stat(path.join(userDir,custom)).catch(()=>null);if(st)expected[name]={mtime:Math.floor(st.mtimeMs/1000)};}
 const began=Date.now();const prior={};for(const name of targets){prior[name]=(await active.readFile(path.join(userDir,'build',name+'.yaml'))).text;}
 if(store!==active||connection.id!==req.body.connectionId||switching)throw new Error('连接目录已变化，请刷新后重试');if(deployment.state==='running')throw new Error('正在部署，请等待');
 deployment={state:'running',message:'正在请求鼠须管重新部署…',began:new Date().toISOString()};
 void (async()=>{try{
  await exec(binary,['--reload'],{timeout:10000});deployment.message='部署请求已发送，正在检查编译产物…';
  for(let i=0;i<60;i++){
   await new Promise(r=>setTimeout(r,500));let ready=true,changed=false;
   for(const name of targets){const built=await active.readFile(path.join(userDir,'build',name+'.yaml'));const stamp=built.data.__build_info?.timestamps?.[name.replace(/\.schema$/,'')+'.custom'];const e=expected[name];if(!built.text||(e&&(!stamp||stamp<e.mtime)))ready=false;if(built.text!==prior[name])changed=true;}
   if(ready&&changed){deployment={state:'verified',message:'编译产物已更新，已核对自定义配置的编译时间。请在真实输入框确认输入效果。',began:new Date(began).toISOString()};return;}
  }
  deployment={state:'unconfirmed',message:'请求已发送，但未观察到足够的编译更新。请从系统输入法菜单重新部署并查看日志；未宣称设置已生效。'};
 }catch(e){deployment={state:'failed',message:`部署未完成：${e.message}`};}})();return deployment;
}));
app.get('/vendor/diff2html.min.js',(req,res)=>res.sendFile(path.join(root,'node_modules/diff2html/bundles/js/diff2html.min.js')));
app.get('/vendor/diff2html.min.css',(req,res)=>res.sendFile(path.join(root,'node_modules/diff2html/bundles/css/diff2html.min.css')));
app.use(express.static(path.join(root,'public')));
app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message||'操作失败'}));
const server=app.listen(port,'127.0.0.1',()=>console.log(`Rime Studio ready: http://127.0.0.1:${port}`));
server.on('error',error=>{console.error(`服务启动失败 (${port}): ${error.message}`);process.exit(1);});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>process.exit(0));server.closeIdleConnections();});
