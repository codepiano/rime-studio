import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {ConfigStore} from './config.js';
import {previewDictionaryInstall,previewDictionaryAction,dictionaryReferences} from './dictionary-management.js';
import {LearnedManager,isSingleCharacter} from './learned.js';
import {inventory,readDictionary,readPhrases,previewPhrases,readPersonalDictionary,previewPersonalDictionary} from './library.js';
import {catalog,packageState,PackageDownloads} from './packages.js';
import {articles,components} from './content.js';
import {withFileDiff} from './review-diff.js';
import {SystemDictionary} from './system-dictionary.js';
import {conversionModes,convertText} from './text-tools.js';
import {discoverConnection,loadPreferences,savePreferences,backupDirectory,resolveDirectory} from './connection.js';
const exec=promisify(execFile),root=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await fs.readFile(path.join(root,'control-panel.json'),'utf8'));
const port=Number(process.env.PORT||manifest.ports[0]);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 必须是 1 到 65535 的整数');
const sourceRoot=process.env.RIME_SOURCE_DIR||path.resolve(root,'../../work');
const dataDir=process.env.RIME_STUDIO_DATA_DIR||path.join(root,'.data');
const systemDictionary=new SystemDictionary(dataDir);
const preferencesFile=path.join(dataDir,'settings.json');
let preferenceError='',preferences={};try{preferences=await loadPreferences(preferencesFile);}catch(e){preferenceError=e.message;}
let connection=await discoverConnection({preferences});if(preferenceError)connection.issues.push(`已保存的连接设置无法读取：${preferenceError}`);
let store=connection.ready?new ConfigStore({userDir:connection.userDir,sharedDir:connection.sharedDir,dataDir:backupDirectory(root,connection,dataDir)}):null;
attachLearned(store,connection);
function attachLearned(active,c){if(active)new LearnedManager(active,{tool:c.binary?path.join(path.dirname(c.binary),'rime_dict_manager'):null});}
let switching=false;
const downloads=new WeakMap();
function downloader(active){if(!downloads.has(active))downloads.set(active,new PackageDownloads(path.join(dataDir,'packages',crypto.createHash('sha256').update(active.userDir).digest('hex').slice(0,24))));return downloads.get(active);}
function resourceStore(req){const active=connected(req);if(deployment.state==='running'||active.busy||downloader(active).running)throw new Error('保存、部署或方案下载期间请稍后再试');return active;}
function readableStore(){if(switching||!connection.ready||!store)throw new Error('请先连接配置目录');return store;}
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
app.use('/api/library/install/preview',express.json({limit:'25mb'}));
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
app.get('/api/tools',route(async()=>({dictionary:{supported:process.platform==='darwin',source:'macOS 系统词典'},conversionModes:conversionModes.map(({id,name})=>({id,name})),textLimit:30000})));
app.post('/api/dictionary/query',route(async req=>systemDictionary.lookup(req.body.term)));
app.post('/api/tools/convert',route(async req=>convertText(req.body)));
app.post('/api/connection',route(async req=>{
 if(switching||store?.busy||deployment.state==='running'||(store&&downloader(store).running))throw new Error('配置保存或部署期间不能切换目录');
 switching=true;try{
  const next=req.body.reset?{}:{userDir:resolveDirectory(req.body.userDir),sharedDir:resolveDirectory(req.body.sharedDir),confirmed:true};
  const candidate=await discoverConnection({preferences:next});
  if(!req.body.reset&&!candidate.ready)throw new Error(candidate.issues.join(' '));
  const active=candidate.ready?new ConfigStore({userDir:candidate.userDir,sharedDir:candidate.sharedDir,dataDir:backupDirectory(root,candidate,dataDir)}):null;
  if(active){await active.snapshot();attachLearned(active,candidate);}
  await savePreferences(preferencesFile,next);preferences=next;connection=candidate;store=active;
  deployment={state:'idle',message:'尚未发起部署'};
  return await state();
 }finally{switching=false;}
}));
function learnedLifecycle(){return {canControl:connection.canDeploy&&connection.confirmed&&process.env.RIME_DISABLE_DEPLOY!=='1'};}
app.get('/api/learned',route(async req=>({...readableStore().learned.query({dictionary:req.query.dictionary||'',q:req.query.q||'',offset:Number(req.query.offset||0),deleted:req.query.deleted==='true',hideSingle:req.query.hideSingle!=='false'}),lifecycle:learnedLifecycle()})));
app.post('/api/learned/lifecycle',route(async req=>{
 resourceStore(req);if(!learnedLifecycle().canControl)throw new Error('所选目录不是当前鼠须管原生目录，不能操作系统输入法');
 if(req.body.action==='start'){await exec('/usr/bin/open',['-a',connection.appPath],{timeout:10000});return {message:'已请求启动鼠须管，可从输入法菜单重新选择'};}
 if(req.body.action!=='pause')throw new Error('无效输入法操作');
 const script=`ObjC.import('AppKit'); const apps=$.NSWorkspace.sharedWorkspace.runningApplications;let count=0;for(let i=0;i<apps.count;i++){const app=apps.objectAtIndex(i),url=app.executableURL;if(url&&ObjC.unwrap(url.path)===${JSON.stringify(connection.binary)}){if(!app.terminate)throw new Error('应用未接受退出请求');count++;}}JSON.stringify({requested:count});`;
 const {stdout}=await exec('/usr/bin/osascript',['-l','JavaScript','-e',script],{timeout:10000});const result=JSON.parse(stdout);return {message:result.requested?'已请求退出鼠须管。请切换到系统输入法，退出完成后读取最新记录':'鼠须管未在运行，可读取最新记录'};
}));
app.post('/api/learned/refresh',route(async req=>({...await resourceStore(req).learned.refresh(),lifecycle:learnedLifecycle()})));
app.post('/api/learned/sync',route(async req=>{const active=resourceStore(req);if(!learnedLifecycle().canControl)throw new Error('当前目录不能请求系统鼠须管同步');const binary=connection.binary;return {...await active.learned.syncFromInputMethod(()=>exec(binary,['--sync'],{timeout:10000})),lifecycle:learnedLifecycle()};}));
app.post('/api/learned/preview',route(async req=>resourceStore(req).learned.preview(req.body)));
app.get('/api/learned/export',route(async req=>{const manager=readableStore().learned,data=manager.query({dictionary:req.query.dictionary||'',q:req.query.q||'',hideSingle:req.query.hideSingle!=='false'});const rows=[...manager.cache.values()].filter(x=>!req.query.dictionary||x.name===req.query.dictionary).flatMap(x=>x.rows).filter(x=>!x.deleted&&(req.query.hideSingle==='false'||!isSingleCharacter(x.text))&&(!req.query.q||x.text.includes(req.query.q)||x.code.includes(req.query.q)));return {filename:'学习词条.tsv',text:'# 文字\t完整编码\t使用次数\t学习词典\n'+rows.map(x=>[x.text,x.code,x.count,x.dictionary].join('\t')).join('\n')+'\n'};}));
app.get('/api/library',route(async()=>inventory(readableStore())));
app.get('/api/library/references',route(async req=>dictionaryReferences(readableStore(),String(req.query.file||'').replace(/\.dict\.yaml$/,''))));
app.post('/api/library/manage/preview',route(async req=>previewDictionaryAction(resourceStore(req),req.body)));
app.post('/api/library/install/preview',route(async req=>previewDictionaryInstall(resourceStore(req),req.body)));
app.get('/api/library/dictionary',route(async req=>readDictionary(readableStore(),req.query.file,req.query.q||'',Number(req.query.offset||0))));
app.get('/api/library/phrases',route(async req=>readPhrases(readableStore(),req.query.schema,req.query.file)));
app.get('/api/library/personal',route(async req=>readPersonalDictionary(readableStore(),req.query.schema)));
app.post('/api/library/phrases/preview',route(async req=>previewPhrases(resourceStore(req),req.body)));
app.post('/api/library/personal/preview',route(async req=>previewPersonalDictionary(resourceStore(req),req.body)));
app.get('/api/packages',route(async()=>({catalog,installed:store?await packageState(readableStore()):{}})));
app.post('/api/packages/download',route(async req=>{const active=resourceStore(req);return downloader(active).start(active,req.body);}));
app.get('/api/packages/download/:id',route(async req=>downloader(readableStore()).get(req.params.id)));
app.post('/api/preview',route(async req=>withFileDiff(await connected(req).preview(req.body.changes,req.body.revision))));
app.post('/api/apply',route(async req=>{if(deployment.state==='running')throw new Error('部署期间请等待后再保存');return resourceStore(req).apply(req.body.id);}));
app.post('/api/restore',route(async req=>{if(deployment.state==='running')throw new Error('部署期间请等待后再恢复');return resourceStore(req).restore(req.body.id);}));
app.get('/api/source',route(async req=>{const repo=repos.find(r=>r.id===req.query.repo);if(!repo?.available||!repo.files.includes(req.query.file))throw new Error('源码文件不在浏览清单内');let stdout=offlineSources[repo.id]?.files[req.query.file];if(stdout===undefined)({stdout}=await exec('git',['-C',path.join(sourceRoot,repo.id),'show',`${repo.commit}:${req.query.file}`],{maxBuffer:2*1024*1024}));return {text:stdout,commit:repo.commit,url:repo.id==='rime-wiki'?`${repo.url}/${String(req.query.file).replace('.md','')}`:`${repo.url}/blob/${repo.commit}/${req.query.file}`};}));
app.get('/api/deployment',route(async()=>deployment));
app.post('/api/deploy',route(async req=>{
 if(process.env.RIME_DISABLE_DEPLOY==='1')throw new Error('测试环境禁用了真实部署');connected(req);if(!connection.canDeploy)throw new Error('所选目录不是当前鼠须管的原生配置目录，不能请求系统重载；保存仍只作用于所选目录');if(store.busy||downloader(store).running)throw new Error('配置正在保存或下载');if(deployment.state==='running')throw new Error('正在部署，请等待');
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
