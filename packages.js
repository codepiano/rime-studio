import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import YAML from 'yaml';
import {readText,readResource,digest,previewFiles} from './file-transactions.js';
import {safeConfigKeys} from './yaml-safety.js';
import {saveBase,validateResolution} from './package-conflicts.js';
import {patchText,dictionaryHeader} from './library.js';
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
export async function packagePreview(store,entry,sourceDir,commit,{mode='full',enable=true,preparedFiles=null,provenance={},baselineRevision=null,seedGuards=[],resolutions={},expectedConflicts=null}={}) {
 const viaPlum=provenance.backend==='plum';
 if(!(catalog.some(x=>x.id===entry.id)||(viaPlum&&/^plum-[0-9a-f]{16}$/.test(entry.id)))||!['full','dictionaries'].includes(mode)||typeof enable!=='boolean'||!/^[0-9a-f]{40}$/.test(commit))fail('无效安装参数');
 let all;
 if(preparedFiles)all=preparedFiles;else{const {stdout}=await exec('git',['-C',sourceDir,'ls-files','-z'],{maxBuffer:1024*1024});all=stdout.split('\0').filter(Boolean).filter(accepted);}
 const selected=mode==='dictionaries'?all.filter(file=>file.endsWith('.dict.yaml')):all;
 const revision=(await store.snapshot()).revision;if(baselineRevision&&baselineRevision!==revision)fail('配置在准备期间已变化，请重新下载');
 const installed=await packageState(store),previous=installed[entry.id],changes=[],guards=[...seedGuards],conflicts=[],managed={...(previous?.files||{})};
 if(mode==='dictionaries'&&!previous)fail('请先完整安装此方案，再更新词库');
 const sourceHashes=[];
 const bases={},upstreamFiles={...(previous?.upstreamFiles||previous?.files||{})},conflictRows=[];
 let bytes=0;
 for(const file of selected){
   const encoding=/\.(gram|ocd|ocd2|db)$/.test(file)?'base64':'utf8';
   const incoming=await readResource(sourceDir,file,encoding);bytes+=encoding==='base64'?Buffer.from(incoming.text,'base64').length:Buffer.byteLength(incoming.text);if(bytes>120*1024*1024)fail('方案文件超过 120 MB');
   if(file.endsWith('.dict.yaml'))dictionaryHeader(incoming.text);
   else if(file.endsWith('.yaml')){const doc=YAML.parseDocument(incoming.text);if(doc.errors.length)fail(`${file} 无法解析`);const config=doc.toJS({maxAliasCount:100});safeConfigKeys(config);if(!config||typeof config!=='object'||Array.isArray(config))fail(`${file} 需要是配置映射`);}
   const current=await readResource(store.userDir,file,encoding),currentHash=digest(current.text,encoding),nextHash=digest(incoming.text,encoding);
   sourceHashes.push({file,encoding,hash:nextHash});await saveBase(store,incoming.text,encoding);upstreamFiles[file]=nextHash;
   bases[file]=incoming.text;guards.push({file,encoding,exists:current.exists,hash:currentHash});
   const owners=Object.values(installed).filter(x=>x.files?.[file]).sort((a,b)=>String(b.time).localeCompare(String(a.time)));
   const owner=owners[0],baseline=owner?.files?.[file];
   const conflict=current.exists&&currentHash!==nextHash&&((viaPlum&&file.endsWith('custom_phrase.txt'))||(baseline&&currentHash!==baseline));
   if(conflict){
    const row={file,encoding,localHash:currentHash,incomingHash:nextHash,baseHash:owner?.upstreamFiles?.[file]||baseline,reason:file.endsWith('custom_phrase.txt')?'个人短语已保留':'本地修改已保留'};conflictRows.push(row);
    const choice=resolutions[file]?validateResolution(resolutions[file],encoding==='base64'):{choice:'keep'};
    if(expectedConflicts){const expected=expectedConflicts.find(x=>x.file===file);if(!expected||expected.localHash!==currentHash||expected.incomingHash!==nextHash)fail('冲突文件已变化，请重新生成预览');}
    if(choice.choice==='keep'){conflicts.push({...row,choice:'keep'});continue;}
    if(choice.choice==='merge'){
     if(file.endsWith('.dict.yaml'))dictionaryHeader(choice.text);else if(file.endsWith('.yaml')){const doc=YAML.parseDocument(choice.text);const config=doc.toJS({maxAliasCount:100});safeConfigKeys(config);if(doc.errors.length||!config||typeof config!=='object'||Array.isArray(config))fail('合并后的 YAML 无效');}
     bases[file]=choice.text;changes.push({file,encoding,after:choice.text,expected:{hash:currentHash,exists:true}});managed[file]=nextHash;conflicts.push({...row,choice:'merge',reason:'使用核对后的合并文本'});continue;
    }
    conflicts.push({...row,choice:'upstream',reason:'使用新版上游'});
   }
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
 const recordedPackages={...installed,[entry.id]:{id:entry.id,name:entry.name,repo:entry.repo,commit,mode,time:new Date().toISOString(),license:entry.license,...provenance,files:managed,upstreamFiles,retained:conflicts.filter(x=>x.choice==='keep').map(x=>x.file),removedUpstream:removed}};
 changes.push({file:manifestFile,after:JSON.stringify({version:1,packages:recordedPackages},null,2)+'\n',expected:{hash:digest(manifest.text),exists:manifest.exists}});
 if(Object.keys(resolutions).some(file=>!conflictRows.some(x=>x.file===file)))fail('解决选择包含非冲突文件');
 const result=await previewFiles(store,changes,[{title:`${previous?'更新':'安装'}${entry.name}`,value:commit.slice(0,12)}],{type:'package',package:entry.id,commit,mode,conflicts,removedUpstream:removed,schemas:schemaIds,source:entry.url,license:entry.license,...provenance},revision,guards);
 store.previews.get(result.id).packagePlan={entry,sourceDir,commit,options:{mode,enable,preparedFiles,provenance,baselineRevision,seedGuards},conflicts:conflictRows,sources:sourceHashes,resolutions};return result;
}
export async function resolvePackagePreview(store,{id,resolutions}){
 const preview=store.previews.get(id);if(!preview?.packagePlan||Date.now()-preview.created>600000)fail('更新预览已过期，请重新生成');
 if(!resolutions||typeof resolutions!=='object'||Array.isArray(resolutions))fail('需要逐文件解决选择');
 if((await store.snapshot()).revision!==preview.revision)fail('配置已变化，请重新生成预览');
 for(const guard of preview.guards){const now=await readResource(guard.origin==='shared'?store.sharedDir:store.userDir,guard.file,guard.encoding);if(now.exists!==guard.exists||digest(now.text,guard.encoding)!==guard.hash)fail('本地文件已变化，请重新生成预览');}
 const plan=preview.packagePlan;for(const source of plan.sources){const now=await readResource(plan.sourceDir,source.file,source.encoding);if(!now.exists||digest(now.text,source.encoding)!==source.hash)fail('暂存上游文件已变化，请重新下载');}
 const next=await packagePreview(store,plan.entry,plan.sourceDir,plan.commit,{...plan.options,resolutions,expectedConflicts:plan.conflicts});store.previews.delete(id);return next;
}
export {PackageDownloads} from './download-tasks.js';
