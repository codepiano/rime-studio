const words=[
 {id:'good',word:'你好',kind:'原词库'},
 {id:'mistake',word:'拟好',kind:'用户词 · 误选记录'},
 {id:'polite',word:'您好',kind:'原词库'},
];
function exercise({selected,removed}){
 const visible=words.filter(item=>!removed||item.id!=='mistake');
 const current=visible.find(item=>item.id===selected);
 const ready=current?.id==='mistake';
 return `<div class="forget-heading"><h3>练习：让“拟好”不再被误选记忆推荐</h3><span class="tag">教学示例</span></div>
 <p>这里模拟重新输入 <span class="key">ni hao</span> 后的候选。先点选“拟好”，也可以在候选区用 ↑ ↓ 移动。</p>
 <div class="forget-steps" aria-label="练习进度"><span class="${ready||removed?'done':'active'}">${ready||removed?'✓':'1'} 选中误选词</span><span class="${removed?'done':ready?'active':''}">${removed?'✓':'2'} 移除用户记忆</span><span class="${removed?'done':''}">${removed?'✓':'3'} 观察候选变化</span></div>
 <div class="forget-candidates" role="listbox" aria-label="示例候选词，使用上下方向键选择" tabindex="0" ${current?`aria-activedescendant="forget-option-${current.id}"`:''}>
  ${visible.map((item,i)=>`<button type="button" role="option" tabindex="-1" id="forget-option-${item.id}" data-forget-word="${item.id}" aria-selected="${item.id===selected}" class="forget-option ${item.id===selected?'selected':''}"><span class="forget-number">${i+1}</span><span class="forget-word">${item.word}<small>${item.kind}</small></span><span class="forget-selected">${item.id===selected?'✓ 已选中':''}</span></button>`).join('')}
 </div>
 <div class="forget-status ${removed?'success':''}" role="status" aria-live="polite">
  ${removed?'<strong>“拟好”已从示例用户词库移除。</strong><p>候选列表现在只保留“你好”和“您好”。再输入相同编码，不再受到这条误选记录的影响。</p>':`<strong>当前选中：${current?`“${current.word}”`:'未选择'}</strong><p>${ready?'下一步：点击下面的按钮，或在候选区按 Shift + Fn + Delete。':'这次要移除的是用户词“拟好”。点击第二个候选，看到“已选中”后再移除。'}</p>`}
 </div>
 <div class="forget-actions"><button class="btn primary" type="button" data-forget-remove ${ready?'':'disabled'}>移除选中的用户词${ready?'：“拟好”':''}</button><button class="btn small" type="button" data-forget-restart>重新练习</button></div>
 <p class="forget-note">这是练习，不会修改真实词库。实际操作不会删除文档中已经打出的文字；原词库里的词不能删除，只能取消调频。</p>`;
}
export function renderForgetDemo(){return `<section class="playground forget-demo" data-forget-demo>${exercise({selected:'good',removed:false})}</section>`;}
export function bindForgetDemo(root){
 if(!root)return;
 const state={selected:'good',removed:false};
 function update(focus){root.innerHTML=exercise(state);if(focus==='list')root.querySelector('.forget-candidates').focus({preventScroll:true});if(focus==='result')root.querySelector('[data-forget-restart]').focus({preventScroll:true});}
 function remove(){if(state.selected!=='mistake'||state.removed)return;state.removed=true;state.selected=null;update('result');}
 root.addEventListener('click',event=>{
  const word=event.target.closest('[data-forget-word]');
  if(word){state.selected=word.dataset.forgetWord;update('list');return;}
  if(event.target.closest('[data-forget-remove]'))remove();
  if(event.target.closest('[data-forget-restart]')){state.selected='good';state.removed=false;update('list');}
 });
 root.addEventListener('keydown',event=>{
  if(!event.target.closest('.forget-candidates')||event.isComposing)return;
  if(event.shiftKey&&event.key==='Delete'){event.preventDefault();remove();return;}
  if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();
  const visible=words.filter(item=>!state.removed||item.id!=='mistake');
  const index=visible.findIndex(item=>item.id===state.selected);
  const next=event.key==='Home'?0:event.key==='End'?visible.length-1:event.key==='ArrowDown'?Math.min(index+1,visible.length-1):Math.max(index-1,0);
  state.selected=visible[next].id;update('list');
 });
}
