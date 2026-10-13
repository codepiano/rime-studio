const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={tab:'dictionary',term:'',definition:null,input:'',mode:'s2t',output:null};
let dictionaryRequest=0,conversionRequest=0;
const phraseable=text=>!!text&&text.length<=500&&!/[\x00-\x1f\x7f]/.test(text)&&!text.startsWith('#');

export async function mountTools(root,{api,notify,addPhrase,connected}) {
  if(!root)return;
  const alive=()=>root.isConnected;
  let info,busy=false;
  root.innerHTML='<div class="loading">正在读取文字工具…</div>';
  try {info=await api('/api/tools');if(alive())draw();}
  catch(error){if(alive())root.innerHTML=`<div class="notice" role="alert">${esc(error.message)}</div>`;}
  function draw(){
    if(!alive())return;
    root.innerHTML=`<div class="tabs" role="tablist">${[['dictionary','系统词典'],['convert','OpenCC 工具箱']].map(([id,label])=>`<button class="tab ${state.tab===id?'active':''}" role="tab" aria-selected="${state.tab===id}" data-tool-tab="${id}" ${busy?'disabled':''}>${label}</button>`).join('')}</div>${state.tab==='dictionary'?dictionaryView():convertView()}`;
    root.querySelectorAll('[data-tool-tab]').forEach(button=>button.onclick=()=>{state.tab=button.dataset.toolTab;draw();});
    root.querySelector('#system-dictionary-form')?.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;state.term=root.querySelector('#dictionary-term').value;const ticket=++dictionaryRequest;busy=true;state.definition=null;draw();
      try {const result=await api('/api/dictionary/query',{term:state.term});if(ticket===dictionaryRequest)state.definition=result;}
      catch(error){if(alive())notify(error.message);}finally{busy=false;draw();}
    });
    root.querySelector('#dictionary-term')?.addEventListener('input',event=>{state.term=event.target.value;});
    root.querySelector('[data-copy-definition]')?.addEventListener('click',()=>copy(state.definition.definition));
    root.querySelector('[data-phrase-term]')?.addEventListener('click',()=>addPhrase(state.definition.term));
    root.querySelector('#convert-input')?.addEventListener('input',event=>{state.input=event.target.value;invalidateOutput();updateCount();});
    root.querySelector('#convert-mode')?.addEventListener('change',event=>{state.mode=event.target.value;invalidateOutput();});
    root.querySelector('#convert-form')?.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;state.input=root.querySelector('#convert-input').value;state.mode=root.querySelector('#convert-mode').value;const ticket=++conversionRequest;busy=true;state.output=null;draw();
      try {const result=await api('/api/tools/convert',{text:state.input,mode:state.mode});if(ticket===conversionRequest)state.output=result;}
      catch(error){if(alive())notify(error.message);}finally{busy=false;draw();}
    });
    root.querySelector('[data-copy-conversion]')?.addEventListener('click',()=>copy(state.output.text));
    root.querySelector('[data-phrase-conversion]')?.addEventListener('click',()=>addPhrase(state.output.text));
    root.querySelector('[data-convert-reuse]')?.addEventListener('click',()=>{state.input=state.output.text;state.output=null;draw();root.querySelector('#convert-input').focus();});
    root.querySelector('[data-convert-clear]')?.addEventListener('click',()=>{state.input='';state.output=null;draw();root.querySelector('#convert-input').focus();});
  }
  function dictionaryView(){return `<section class="card"><div class="cardhead"><div><h2>查一个字词</h2><p>使用本机已启用的 macOS 词典，显示首个匹配词条的纯文本释义。</p></div><span class="tag">本机查询</span></div><div class="cardbody"><form id="system-dictionary-form" class="tool-query"><label for="dictionary-term">字词</label><div class="inlineform mt"><input id="dictionary-term" type="text" value="${esc(state.term)}" required maxlength="120" placeholder="例如 hello、辞典" autocomplete="off" ${busy?'disabled':''}><button class="btn primary" ${busy||!info.dictionary.supported?'disabled':''}>${busy?'正在查询…':'查询释义'}</button></div></form>${!info.dictionary.supported?'<div class="notice mt">系统词典查询仅支持 macOS。OpenCC 工具箱仍可使用。</div>':''}<p class="library-meta">查词范围取决于“词典”应用中启用的词典。首次查询会构建本机辅助程序，需要已安装 macOS 命令行工具（clang）。</p><div class="tool-result mt" role="status" aria-live="polite">${state.definition?`<h3>${esc(state.definition.term)}</h3><p class="library-meta">${esc(state.definition.source)} · ${esc(state.definition.message)}</p>${state.definition.found?`<div class="dictionary-definition">${esc(state.definition.definition)}</div><div class="library-actions mt"><button class="btn" data-copy-definition>复制释义</button><button class="btn" data-phrase-term ${!connected||!phraseable(state.definition.term)?'disabled':''}>将字词加入快捷短语</button></div>`:''}`:'<p class="library-meta">输入字词后按回车查询。查询不会修改输入法词库。</p>'}</div></div></section>`;}
  function convertView(){return `<section class="card"><div class="cardhead"><div><h2>繁简与地域用词转换</h2><p>转换整段文字，保留原文，对照结果后复制或继续转换。</p></div><span class="tag">离线转换</span></div><div class="cardbody"><form id="convert-form"><label class="tool-mode" for="convert-mode">转换方式 <select id="convert-mode" ${busy?'disabled':''}>${info.conversionModes.map(mode=>`<option value="${mode.id}" ${state.mode===mode.id?'selected':''}>${esc(mode.name)}</option>`).join('')}</select></label><div class="text-tool-columns mt"><label>原文<textarea id="convert-input" rows="10" maxlength="${info.textLimit}" placeholder="粘贴要转换的文字…" ${busy?'disabled':''}>${esc(state.input)}</textarea><span class="library-meta" id="convert-count">${state.input.length.toLocaleString()} / ${info.textLimit.toLocaleString()} 个字符</span></label><label>转换结果<textarea id="convert-output" rows="10" readonly placeholder="转换后在这里对照查看">${esc(state.output?.text||'')}</textarea><span class="library-meta" id="convert-status" role="status">${state.output?`${esc(state.output.label)} · ${state.output.changed?'文字已转换':'原文无需转换'}`:'等待转换'}</span></label></div><div class="library-actions mt"><button class="btn primary" ${busy?'disabled':''}>${busy?'正在转换…':'转换文字'}</button><button type="button" class="btn" data-convert-clear ${busy?'disabled':''}>清空</button><button type="button" class="btn" data-copy-conversion ${!state.output||busy?'disabled':''}>复制结果</button><button type="button" class="btn" data-convert-reuse ${!state.output||busy?'disabled':''}>用结果继续转换</button><button type="button" class="btn" data-phrase-conversion ${!connected||!phraseable(state.output?.text)||busy?'disabled':''}>加入快捷短语</button></div></form><p class="library-meta">OpenCC · opencc-js 1.4.2。字典随本地依赖提供，运行时无需联网。短语支持单行、最多 500 个字符；加入后还需指定短码并预览保存。</p></div></section>`;}
  function invalidateOutput(){conversionRequest++;state.output=null;root.querySelector('#convert-output').value='';root.querySelector('#convert-status').textContent='原文或转换方式已变化，请重新转换';for(const button of root.querySelectorAll('[data-copy-conversion],[data-convert-reuse],[data-phrase-conversion]'))button.disabled=true;}
  function updateCount(){root.querySelector('#convert-count').textContent=`${state.input.length.toLocaleString()} / ${info.textLimit.toLocaleString()} 个字符`;}
  async function copy(text){try{await navigator.clipboard.writeText(text);notify('已复制');}catch{notify('浏览器未允许复制，请选中文字手动复制');}}
}
