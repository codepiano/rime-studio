import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const clone = x => structuredClone(x);
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const bad = message => { throw new Error(message); };
export const fields = {
  page_size: { file:'default', path:'menu/page_size', title:'每页候选数量', type:'number', min:1,max:9, fallback:5 },
  hotkeys: {file:'default',path:'switcher/hotkeys',title:'方案菜单快捷键',type:'hotkeys'},
  shift_left: {file:'default',path:'ascii_composer/switch_key/Shift_L',title:'左 Shift 的行为',type:'enum',options:['inline_ascii','commit_text','commit_code','noop']},
  shift_right: {file:'default',path:'ascii_composer/switch_key/Shift_R',title:'右 Shift 的行为',type:'enum',options:['inline_ascii','commit_text','commit_code','noop']},
  caps_lock: {file:'default',path:'ascii_composer/good_old_caps_lock',title:'Caps Lock 保留大写习惯',type:'boolean'},
  layout: {file:'squirrel',path:'style/candidate_list_layout',title:'候选排列',type:'enum',options:['stacked','linear']},
  font_size: {file:'squirrel',path:'style/font_point',title:'候选字号',type:'number',min:10,max:48},
  font_face: {file:'squirrel',path:'style/font_face',title:'候选字体',type:'text'},
  inline: {file:'squirrel',path:'style/inline_preedit',title:'在输入位置显示编码',type:'boolean'},
  paging: {file:'squirrel',path:'style/show_paging',title:'显示翻页箭头',type:'boolean'},
  theme: {file:'squirrel',path:'style/color_scheme',title:'候选配色',type:'theme'},
  schemas: {file:'default',path:'schema_list',title:'启用的输入方案',type:'schemas'},
  ascii: {file:'schema',path:'switches',title:'新会话默认语言',type:'switch',name:'ascii_mode'},
  simplified: {file:'schema',path:'switches',title:'新会话默认字形',type:'switch',name:'simplification'},
  ascii_punct: {file:'schema',path:'switches',title:'新会话默认标点',type:'switch',name:'ascii_punct'},
  user_dict: {file:'schema',path:'translator/enable_user_dict',title:'学习新词并调整词频',type:'boolean',fallback:true},
  app: {file:'squirrel',path:'app_options',title:'应用默认语言',type:'app'},
  punctuation: {file:'schema',path:'punctuator/half_shape',title:'半角模式标点映射',type:'punctuation'},
};
function merge(a,b) { const out=clone(a||{}); for(const [k,v] of Object.entries(b||{})) out[k]=isObj(v)&&isObj(out[k])?merge(out[k],v):clone(v); return out; }
export function getAt(o,p) { return p.split('/').reduce((v,k)=>v?.[k.startsWith('@')?Number(k.slice(1)):k],o); }
function setAt(o,p,v) { const ks=p.split('/'); let x=o; for(const raw of ks.slice(0,-1)) { const k=raw.startsWith('@')?Number(raw.slice(1)):raw; if(!isObj(x[k])&&!Array.isArray(x[k])) x[k]={}; x=x[k]; } const last=ks.at(-1); x[last.startsWith('@')?Number(last.slice(1)):last]=clone(v); }
function applyPatch(base,patch,prefix='') { for(const [k,v] of Object.entries(patch||{}).sort(([a],[b])=>a<b?-1:a>b?1:0)) { const p=prefix?`${prefix}/${k}`:k; if(k.endsWith('/+')) { const key=p.slice(0,-2), old=getAt(base,key); setAt(base,key,Array.isArray(old)&&Array.isArray(v)?[...old,...v]:merge(old,v)); } else setAt(base,p,v); } return base; }
// Find a semantic path through either slash-style or nested YAML patch keys.
function locate(o,p,prefix=[]) { if(!isObj(o))return null; if(Object.hasOwn(o,p))return [...prefix,p]; for(const [k,v] of Object.entries(o)) if(p.startsWith(k+'/')) { const found=locate(v,p.slice(k.length+1),[...prefix,k]); if(found)return found; } return null; }
function matchesFor(o,p,prefix=[]){if(!isObj(o))return [];let found=[];for(const [k,v] of Object.entries(o)){if(k===p)found.push([...prefix,k]);else if(p.startsWith(k+'/'))found.push(...matchesFor(v,p.slice(k.length+1),[...prefix,k]));}return found;}
function checkAmbiguity(o,p,prefix='') { for(const [k,v] of Object.entries(o||{})) { const key=prefix?`${prefix}/${k}`:k; if(key===p||/^switches\/@\d+\/reset$/.test(key))continue; if(/[+@]/.test(key)&& (key.startsWith(p+'/')||p.startsWith(key.replace(/\/(?:\+|@.*)$/,'')+'/')||key.replace(/\/(?:\+|@.*)$/,'')===p))bad('此设置含高级列表补丁，请先在原配置中处理冲突。'); if(isObj(v))checkAmbiguity(v,p,key); } }
export class ConfigStore {
 constructor({userDir,sharedDir,dataDir}) { this.userDir=userDir;this.sharedDir=sharedDir;this.dataDir=dataDir;this.busy=false;this.previews=new Map(); }
 async readFile(file) { let s; try { const st=await fs.lstat(file);if(st.isSymbolicLink()||!st.isFile())bad('配置必须是普通文件，不能是符号链接');s=await fs.readFile(file,'utf8'); }catch(e){if(e.code==='ENOENT')return {text:'',data:{},doc:new YAML.Document({})};throw e;} const doc=YAML.parseDocument(s);if(doc.errors.length)bad(`${path.basename(file)} YAML 无法解析：${doc.errors[0].message}`);const data=doc.toJS({maxAliasCount:100});if(!isObj(data))bad(`${path.basename(file)} 需要是配置映射`);return {text:s,data,doc}; }
 async base(name,seen=new Set()) { if(seen.has(name))bad('配置继承存在循环'); seen.add(name);let raw=await this.readFile(path.join(this.userDir,`${name}.yaml`));if(!raw.text)raw=await this.readFile(path.join(this.sharedDir,`${name}.yaml`));let data=raw.data; if(typeof data.__include==='string'){const [ref,section]=data.__include.split(':');if(/^[a-z0-9_.-]+$/.test(ref)){let inherited=await this.base(ref,seen);if(section&&section!=='/')inherited=getAt(inherited,section.replace(/^\//,''));data=merge(inherited,data);} } return data; }
 async effective(name) { let base=await this.base(name);const custom=await this.readFile(path.join(this.userDir,`${name.replace(/\.schema$/,'')}.custom.yaml`));return applyPatch(base,custom.data.patch); }
 async snapshot() {
  const userFiles=await fs.readdir(this.userDir); const sharedFiles=await fs.readdir(this.sharedDir).catch(()=>[]);
  const names=[...new Set([...userFiles,...sharedFiles].filter(f=>/^[a-z0-9_.-]+\.schema\.yaml$/.test(f)))];const schemas=[];
  for(const f of names){const id=f.replace('.schema.yaml',''); const cfg=await this.effective(`${id}.schema`);const built=await this.readFile(path.join(this.userDir,'build',f));schemas.push({id,name:cfg.schema?.name||id,description:cfg.schema?.description||'',config:cfg,deployed:!!built.text,deployedConfig:built.data});}
  const defaults=await this.effective('default'),squirrel=await this.effective('squirrel');
  const files={}; for(const f of ['default.custom.yaml','squirrel.custom.yaml',...names.map(f=>f.replace('.schema.yaml','.custom.yaml'))])files[f]=(await this.readFile(path.join(this.userDir,f))).text;
  const deps=[...new Set([...userFiles,...sharedFiles].filter(f=>/^[a-z0-9_.-]+\.yaml$/.test(f)&&!f.endsWith('.dict.yaml')))];const basis={};for(const f of deps){basis['user/'+f]=(await this.readFile(path.join(this.userDir,f))).text;basis['shared/'+f]=(await this.readFile(path.join(this.sharedDir,f))).text;}
  const deployedDefault=(await this.readFile(path.join(this.userDir,'build','default.yaml'))).data;
  return {revision:hash(JSON.stringify({files,basis})),defaults,squirrel,schemas,files,userDir:this.userDir,enabled:(defaults.schema_list||[]).map(s=>s.schema),deployedEnabled:(deployedDefault.schema_list||[]).map(s=>s.schema),themes:Object.entries(squirrel.preset_color_schemes||{}).map(([id,x])=>({id,name:x.name||id,...x})),history:await this.history()};
 }
 validate(change,snap) {
  const f=fields[change.field];if(!f)bad('未知设置');if(change.op&&!['set','remove'].includes(change.op))bad('未知操作');const schema=snap.schemas.find(s=>s.id===change.schema);
  if(f.file==='schema'&&!schema)bad('请选择已安装的方案');let target=f.file==='schema'?change.schema:f.file;let key=f.path;let value=change.value;
  if(f.type==='switch'){const switches=schema.config.switches||[];const name=f.name==='simplification'?(schema.config.simplifier?.option_name||f.name):f.name;const i=switches.findIndex(x=>x.name===name);if(i<0)bad('这个方案没有此开关');key=`switches/@${i}/reset`;if(change.op!=='remove'&&![0,1].includes(value))bad('开关只能选 0 或 1');}
  if(f.type==='app'){if(!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(change.app||'')||change.app.length>180)bad('请输入有效的应用标识');key=`app_options/${change.app}/ascii_mode`;}
  if(f.type==='punctuation'){if(typeof change.key!=='string'||change.key.length!==1||!/[\x21-\x7e]/.test(change.key))bad('标点按键需要是单个英文可打印字符');key=f.path;}
  if(change.op!=='remove'){
   if(['boolean','app'].includes(f.type)&&typeof value!=='boolean')bad('需要布尔值');
   if(f.type==='number'&&(!Number.isInteger(value)||value<f.min||value>f.max))bad(`数值需要在 ${f.min}–${f.max} 之间`);
   if(f.type==='enum'&&!f.options.includes(value))bad('无效选项');
   if(f.type==='text'&&(typeof value!=='string'||!value.trim()||value.length>120||/[\r\n\0]/.test(value)))bad('请输入有效文本');
   if(f.type==='punctuation'&&(typeof value!=='string'||!value.trim()||value.length>12||/[\r\n\0]/.test(value)))bad('符号需要为 1–12 个字符');
   if(f.type==='theme'&&!snap.themes.some(t=>t.id===value))bad('未知配色');
   if(f.type==='schemas'&&(!Array.isArray(value)||!value.length||new Set(value).size!==value.length||value.some(id=>!snap.schemas.some(s=>s.id===id))))bad('至少保留一个已安装方案，不能重复');
   if(f.type==='hotkeys'&&(!Array.isArray(value)||!value.length||value.some(x=>!['F4','Control+grave','Control+Shift+grave'].includes(x))))bad('请选择有效的快捷键');
  }
  if(f.type==='schemas')value=value?.map(schema=>({schema}));
  return {f,file:`${target}.custom.yaml`,key,value,schema};
 }
 async preview(changes,revision) {
  if(!Array.isArray(changes)||!changes.length||changes.length>100)bad('待应用清单应为 1–100 项');const snap=await this.snapshot();if(revision!==snap.revision)bad('配置已被其他程序修改，请刷新后重新预览');
  const docs={},before={},summary=[];
  for(const change of changes){const {f,file,key,value,schema}=this.validate(change,snap);if(!docs[file]){before[file]=snap.files[file]||'';docs[file]=YAML.parseDocument(before[file]||'patch: {}\n');} const doc=docs[file];let data=doc.toJS();if(!data.patch)doc.set('patch',{});data=doc.toJS();if(!isObj(data.patch))bad('patch 不是映射');checkAmbiguity(data.patch,key);
   if(f.type==='switch'){
    // Patch a single list element; preserve other switch states and future schema additions.
    const whole=locate(data.patch,'switches');if(whole)bad('此方案覆盖了整个 switches 列表，无法安全地合并此开关');
   }
   if(matchesFor(data.patch,key).length>1)bad('同一个设置同时存在多种覆盖写法，请先清理重复覆盖。');
   let loc=locate(data.patch,key), valueToWrite=value;
   if(change.op==='remove'&&f.type!=='punctuation'&&loc&&loc.length>1){
    for(let i=1;i<loc.length;i++){const parent=doc.getIn(['patch',...loc.slice(0,i)],true);if(YAML.isMap(parent)&&parent.items.length>1)bad('此项位于整段覆盖中，删除单项不能可靠恢复继承；请先拆分该段补丁。');}
   }
   if(f.type==='punctuation'){
    let map=loc?clone(doc.getIn(['patch',...loc],true)?.toJSON()):{};if(!isObj(map))bad('标点补丁不是映射');
    const exact=`punctuator/half_shape/${change.key}`;const child=locate(data.patch,exact);
    if(child&&!loc){loc=child;if(change.op==='remove')doc.deleteIn(['patch',...loc]);else doc.setIn(['patch',...loc],value);summary.push({title:f.title,file,key:exact,op:change.op||'set',value});continue;}
    if(change.op==='remove')delete map[change.key];else map[change.key]=value;valueToWrite=map;
    if(!Object.keys(map).length&&loc)doc.deleteIn(['patch',...loc]);else if(Object.keys(map).length)doc.setIn(['patch',...(loc||[key])],map);
   }else if(change.op==='remove'){if(loc){doc.deleteIn(['patch',...loc]);for(let i=loc.length-1;i>0;i--){const parent=['patch',...loc.slice(0,i)];const node=doc.getIn(parent,true);if(YAML.isMap(node)&&node.items.length===0)doc.deleteIn(parent);else break;}}}
   else doc.setIn(['patch',...(loc||[key])],valueToWrite);
   summary.push({title:f.title+(schema?` · ${schema.name}`:''),file,key,op:change.op||'set',value});
  }
  const files=Object.entries(docs).map(([file,doc])=>({file,before:before[file],after:String(doc)})).filter(x=>x.before!==x.after);
  if(!files.length)bad('没有需要写入的修改');const id=crypto.randomUUID();const preview={id,revision:snap.revision,files,summary,created:Date.now()};this.previews.set(id,preview);for(const [k,p] of this.previews)if(Date.now()-p.created>600000)this.previews.delete(k);return preview;
 }
 async apply(id) { if(this.busy)bad('另一个配置操作正在进行');this.busy=true;try{
  const p=this.previews.get(id);if(!p||Date.now()-p.created>600000)bad('预览已过期，请重新预览');const snap=await this.snapshot();if(snap.revision!==p.revision)bad('配置已变化，请重新预览');
  const dir=path.join(this.dataDir,crypto.randomUUID());await fs.mkdir(dir,{recursive:true,mode:0o700});const record={id:path.basename(dir),time:new Date().toISOString(),summary:p.summary,files:p.files.map(f=>({...f,afterHash:hash(f.after)}))};
  await fs.writeFile(path.join(dir,'record.json'),JSON.stringify(record,null,2),{mode:0o600});
  const written=[];try{for(const f of p.files){const dest=path.join(this.userDir,f.file);if((await this.readFile(dest)).text!==f.before)bad('写入前发现配置变化');await this.atomicWrite(dest,f.after);written.push(f);}}catch(e){for(const f of written){const dest=path.join(this.userDir,f.file);if((await this.readFile(dest)).text===f.after){if(f.before)await this.atomicWrite(dest,f.before);else await fs.unlink(dest);}}record.failed=true;await fs.writeFile(path.join(dir,'record.json'),JSON.stringify(record),{mode:0o600});throw e;}
  this.previews.delete(id);return {id:record.id,files:p.files.map(f=>f.file),message:'配置已保存，需要重新部署后生效'};
 }finally{this.busy=false;} }
 async atomicWrite(dest,text){const tmp=`${dest}.rime-studio-${crypto.randomUUID()}`;await fs.writeFile(tmp,text,{mode:0o600,flag:'wx'});try{await fs.rename(tmp,dest);}finally{await fs.unlink(tmp).catch(()=>{});} }
 async history(){const dirs=await fs.readdir(this.dataDir).catch(()=>[]);const result=[];for(const id of dirs.filter(x=>/^[0-9a-f-]{36}$/.test(x))){try{const r=JSON.parse(await fs.readFile(path.join(this.dataDir,id,'record.json'),'utf8'));if(!r.failed)result.push({id:r.id,time:r.time,summary:r.summary,restored:r.restored});}catch{}}return result.sort((a,b)=>b.time.localeCompare(a.time)).slice(0,20);}
 async restore(id){if(!/^[0-9a-f-]{36}$/.test(id))bad('无效备份');if(this.busy)bad('另一个操作正在进行');this.busy=true;try{const dir=path.join(this.dataDir,id);const r=JSON.parse(await fs.readFile(path.join(dir,'record.json'),'utf8'));if(r.failed||r.restored)bad('此记录不可恢复');for(const f of r.files)if(hash((await this.readFile(path.join(this.userDir,f.file))).text)!==f.afterHash)bad('这些配置后来又被修改，不能直接覆盖恢复');const originals=[];try{for(const f of r.files){const dest=path.join(this.userDir,f.file);if(f.before)await this.atomicWrite(dest,f.before);else await fs.unlink(dest);originals.push(f);}}catch(e){for(const f of originals)await this.atomicWrite(path.join(this.userDir,f.file),f.after);throw e;}r.restored=new Date().toISOString();await fs.writeFile(path.join(dir,'record.json'),JSON.stringify(r,null,2),{mode:0o600});return {message:'已恢复修改前配置，请重新部署'};}finally{this.busy=false;}}
}
