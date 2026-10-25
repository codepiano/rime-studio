import {renderHTML} from './render.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let remembered={connection:'',schema:'',code:'',expected:'',result:null};
export function mountDiagnosis(root,{api,schemas,schema,connection,revision,initial=null}){
 if(!root)return;
 if(remembered.connection!==connection)remembered={connection,schema,code:'',expected:'',result:null};
 if(remembered.result?.revision&&remembered.result.revision!==revision)remembered.result=null;
 if(initial)remembered={...initial,connection,result:null};
 if(!schemas.some(x=>x.id===remembered.schema))remembered.schema=schemas[0]?.id||'';
 let busy=false,request=0;
 function draw(){if(!root.isConnected)return;const value=remembered,result=value.result;
 renderHTML(root,`<section class="card"><div class="cardhead"><div><h2>真实引擎试输</h2><p>从已保存的方案和词库创建临时会话，检查按键、资源挂载与实际候选。</p></div><span class="tag">隔离 Rime 会话</span></div><div class="cardbody"><div class="notice">试输使用中文、半角模式。不会载入真实学习数据库，也不会向当前应用输入。方案的 Lua 在受限进程中执行；临时数据在诊断结束后清理。首次编译大型词库可能需要几十秒。</div><form id="diagnosis-form" class="diagnosis-form mt"><label>输入方案<select name="schema" aria-label="诊断输入方案" ${busy?'disabled':''}>${schemas.map(x=>`<option value="${esc(x.id)}" ${x.id===value.schema?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>实际按键<input name="code" ${busy?'disabled':''} aria-label="诊断按键" value="${esc(value.code)}" placeholder="例如 nihao 或 zj" maxlength="80" required autocomplete="off" spellcheck="false"></label><label>期望词条（可选）<input name="expected" ${busy?'disabled':''} aria-label="期望词条" value="${esc(value.expected)}" placeholder="例如 你好" maxlength="100"></label><button class="btn primary" ${busy||!value.schema?'disabled':''}>${busy?'正在编译并试输…':'运行输入诊断'}</button></form><p class="library-meta">按键按顺序送入引擎；空格会选择候选。输入完整编码可核对固定词库，实际学习排序需在日常输入法中确认。</p><div role="status" aria-live="polite">${busy?'<p class="library-meta">诊断进行中，请稍候…</p>':''}${result?renderResult(result):''}</div></div></section>`);
 const form=root.querySelector('#diagnosis-form');
 form.addEventListener('input',()=>{if(busy)return;const fields=new FormData(form);for(const key of ['schema','code','expected'])remembered[key]=fields.get(key);remembered.result=null;renderHTML(root.querySelector('[role=status]'),'');});
 form.onsubmit=async event=>{event.preventDefault();if(busy)return;const ticket=++request,fields=new FormData(form),input=Object.fromEntries(fields);remembered={connection,...input,result:null};busy=true;draw();try{
  const next=await api('/api/diagnosis',input);if(!root.isConnected||ticket!==request||next.connectionId!==connection)return;remembered.result=next;
 }catch(error){if(root.isConnected&&ticket===request)remembered.result={error:error.message};}finally{busy=false;if(root.isConnected&&ticket===request)draw();}};
 }
 function renderResult(result){
  if(result.error)return `<div class="notice">诊断未完成：${esc(result.error)}</div>`;
  const trial=result.trial,expected=result.input.expected;
  return `<div class="diagnosis-checks mt">${result.checks.map(check=>`<div class="diagnosis-check ${esc(check.level)}"><span class="tag">${check.level==='ok'?'通过':check.level==='error'?'需修复':'需核对'}</span><div><strong>${esc(check.title)}</strong><p>${esc(check.message)}</p></div></div>`).join('')}</div>${trial.error?`<div class="notice mt">${esc(trial.error)}</div>`:`<section class="mt"><h3>引擎返回的候选</h3><p class="library-meta">${esc(result.schemaName)} · librime ${esc(trial.version)} · 预编辑：${esc(trial.preedit)||'无'} · ${trial.candidates.length} 个候选${trial.hasMore?'（还有更多）':''}</p><div class="diagnosis-candidates">${trial.candidates.map((row,index)=>`<div class="diagnosis-candidate ${row.text===expected?'expected':''}"><small>${index+1}</small><strong>${esc(row.text)}</strong><span>${esc(row.comment)}</span></div>`).join('')||'<p class="library-meta">当前按键没有返回候选。</p>'}</div>${trial.commits.length?`<p>提交文本：${trial.commits.map(esc).join(' · ')}</p>`:''}<details class="mt"><summary>逐键处理结果</summary><p class="library-meta">${trial.keys.map(key=>`${esc(key.key===' '?'空格':key.key)}：${key.accepted?'已处理':'未处理'}`).join(' · ')}</p></details></section>`}<p class="library-meta mt">${esc(result.scope)}。本次检查 ${result.resources.files} 个资源文件，结束后已清理临时数据。</p>`;
 }
 draw();
}
