import * as OpenCC from 'opencc-js';

export const conversionModes = [
  {id:'s2t',name:'简体 → 标准繁体',from:'cn',to:'t'},
  {id:'t2s',name:'繁体 → 简体',from:'t',to:'cn'},
  {id:'s2tw',name:'简体 → 台湾正体',from:'cn',to:'tw'},
  {id:'s2twp',name:'简体 → 台湾正体与常用词',from:'cn',to:'twp'},
  {id:'s2hk',name:'简体 → 香港繁体',from:'cn',to:'hk'},
  {id:'tw2s',name:'台湾正体 → 简体',from:'tw',to:'cn'},
  {id:'tw2sp',name:'台湾正体与常用词 → 大陆简体',from:'twp',to:'cn'},
  {id:'hk2s',name:'香港繁体 → 简体',from:'hk',to:'cn'},
];
const converters=new Map();
export function convertText({text,mode}={}) {
  if(typeof text!=='string'||!text.trim()||text.length>30000||text.includes('\0'))throw new Error('请输入不超过 30,000 个字符的文本');
  const selected=conversionModes.find(x=>x.id===mode);
  if(!selected)throw new Error('请选择支持的繁简转换方式');
  if(!converters.has(mode))converters.set(mode,OpenCC.Converter({from:selected.from,to:selected.to}));
  const output=converters.get(mode)(text);
  return {text:output,mode,label:selected.name,changed:output!==text,engine:'opencc-js 1.4.2'};
}
