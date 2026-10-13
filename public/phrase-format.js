// Shared by the editor and server: keep comments, blank lines, BOM and line endings.
function lines(text) {
  return (text.match(/[^\n]*(?:\n|$)/g)||[]).filter(Boolean).map(raw=>({raw,content:raw.replace(/\r?\n$/,''),ending:raw.endsWith('\r\n')?'\r\n':raw.endsWith('\n')?'\n':''}));
}
export function phraseRows(text) {
  const rows=[];
  for(const [index,line] of lines(text).entries()) {
    const content=index===0?line.content.replace(/^\uFEFF/,''):line.content;
    if(!content.trim()||content.startsWith('#'))continue;
    const cells=content.split('\t');
    if(cells.length<2||cells.length>3)throw new Error(`第 ${index+1} 行需要文字、编码和可选权重，以 Tab 分隔`);
    rows.push({line:index+1,text:cells[0],code:cells[1],weight:cells[2]||''});
  }
  return rows;
}
export function phraseProblems(rows) {
  const errors=[],codes=new Map(),seen=new Set();
  rows.forEach((row,index)=>{
    const label=`第 ${index+1} 条`;
    if(!row.text?.trim()||row.text.startsWith('#')||row.text.startsWith('\uFEFF')||row.text.length>500||/[\x00-\x1f\x7f]/.test(row.text))errors.push(`${label}需要 1–500 个字符的文本，不能以 # 开头或含控制字符`);
    if(!row.code?.trim()||row.code.length>120||!/^[a-zA-Z0-9 /;,.`'_-]+$/.test(row.code))errors.push(`${label}需要有效编码`);
    if(row.weight&&!/^\d{1,9}$/.test(row.weight))errors.push(`${label}权重需为非负整数（最多 9 位）`);
    const key=row.text+'\0'+row.code;
    if(seen.has(key))errors.push(`${label}的文本与编码重复`);
    seen.add(key);
    if(!codes.has(row.code))codes.set(row.code,[]);
    codes.get(row.code).push(index+1);
  });
  return {errors,conflicts:[...codes].filter(([code,items])=>code&&items.length>1).map(([code,items])=>({code,items}))};
}
export function rewritePhrases(text, rows) {
  const original=lines(text),before=new Map(phraseRows(text).map(row=>[row.line,row]));
  const edited=new Map(rows.filter(row=>before.has(row.line)).map(row=>[row.line,row]));
  const newline=original.find(line=>line.ending)?.ending||'\n';
  let output=original.map((line,index)=>{
    const prior=before.get(index+1);
    if(!prior)return line.raw;
    const row=edited.get(index+1);
    if(!row)return index===0&&line.content.startsWith('\uFEFF')?'\uFEFF':'';
    if(['text','code','weight'].every(key=>row[key]===prior[key]))return line.raw;
    const cells=[row.text,row.code];
    if(row.weight||line.content.split('\t').length===3)cells.push(row.weight);
    return (index===0&&line.content.startsWith('\uFEFF')?'\uFEFF':'')+cells.join('\t')+line.ending;
  }).join('');
  const added=rows.filter(row=>!before.has(row.line));
  if(added.length){if(output&&!output.endsWith('\n')&&output!=='\uFEFF')output+=newline;output+=added.map(row=>[row.text,row.code,...(row.weight?[row.weight]:[])].join('\t')+newline).join('');}
  return output;
}
