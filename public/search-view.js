const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountSearch(root,{api,query,connection,open,delay=180}){
 if(!root)return;
 root.innerHTML='<p class="library-meta" role="status">正在搜索本机词条…</p>';
 setTimeout(async()=>{
  if(!root.isConnected)return;
  try{
   const data=await api(`/api/search?q=${encodeURIComponent(query)}&connectionId=${encodeURIComponent(connection)}`);
   if(!root.isConnected||data.connectionId!==connection)return;
   root.innerHTML=`<section class="card"><div class="cardhead"><div><h2>词条与快捷短语</h2><p>搜索已保存的个人词库、已挂载的短语表和已加载的学习记录。未自动同步或读取学习数据库。</p></div><span class="tag">${data.total} 个匹配${data.hasMore?' · 展示前 120 个':''}</span></div><div class="cardbody">${!data.learnedLoaded?'<p class="library-meta">学习记录尚未加载。可在“学会的词”中手动读取或同步，再回到这里搜索。</p>':''}${data.warnings.length?`<div class="notice">${data.warnings.map(esc).join('<br>')}</div>`:''}<div class="search-resource-list">${data.results.map((row,index)=>`<div class="search-resource"><div><strong>${esc(row.text)}</strong><code>${esc(row.code)}</code><p class="library-meta">${esc(row.source)} · ${esc(row.schemaName||row.dictionary)}${row.file?' · '+esc(row.file):''}${row.time?' · '+esc(new Date(row.time).toLocaleString()):''}</p></div><div class="library-actions"><button class="btn small" data-search-open="${index}">查看来源</button>${row.schema&&row.code?`<button class="btn small" data-search-diagnose="${index}">诊断输入</button>`:''}</div></div>`).join('')||'<p class="library-meta">已搜索的来源中没有匹配词条。</p>'}</div><p class="library-meta">“已保存”表示文件内容；“最近读取”和“快照”保留当时的学习记录，不代表当前输入法的实时状态。</p></div></section>`;
   root.querySelectorAll('[data-search-open]').forEach(button=>button.onclick=()=>open(data.results[Number(button.dataset.searchOpen)].target));
   root.querySelectorAll('[data-search-diagnose]').forEach(button=>button.onclick=()=>{const row=data.results[Number(button.dataset.searchDiagnose)];open({diagnosis:true,schema:row.schema,code:row.code,expected:row.text});});
  }catch(error){if(root.isConnected)root.innerHTML=`<div class="notice">词条搜索未完成：${esc(error.message)}</div>`;}
 },delay);
}
