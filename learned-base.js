import fs from 'node:fs/promises';
import {dictionaryHeader} from './library.js';
import {readText,safeFile} from './file-transactions.js';

// Compare text, rather than pronunciation: a different code is not a new word.
export class LearnedBaseVocabulary {
 constructor(store){this.store=store;this.files=new Map();}
 async file(name){
  const relative=name+'.dict.yaml';let root=this.store.userDir;
  let file=await safeFile(root,relative),stat=await fs.stat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!stat){root=this.store.sharedDir;file=await safeFile(root,relative);stat=await fs.stat(file);}
  const stamp=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  const cached=this.files.get(file);if(cached?.stamp===stamp)return cached;
  const source=await readText(root,relative),header=dictionaryHeader(source.text),column=header.columns.indexOf('text'),words=new Set();
  for(const line of header.body.split(/\r?\n/)){if(!line.trim()||line.startsWith('#'))continue;const word=line.split('\t')[column];if(word)words.add(word);}
  const result={stamp,words,imports:header.imports};this.files.set(file,result);return result;
 }
 async known(names){
  const {schemas}=await this.store.snapshot(),result=new Map();
  for(const name of names){
   const roots=new Set();
   for(const schema of schemas){const translator=schema.config.translator;if(translator&&(translator.user_dict||translator.dictionary)===name&&translator.dictionary)roots.add(translator.dictionary);}
   if(!roots.size)roots.add(name);
   const words=new Set(),seen=new Set(),visiting=new Set();
   const walk=async root=>{
    // Personal extensions are deliberately outside the base vocabulary.
    if(/^studio_.*_personal$/.test(root))return;
    if(visiting.has(root))throw new Error(`基础词库引用循环：${root}`);
    if(seen.has(root))return;visiting.add(root);
    const data=await this.file(root);for(const word of data.words)words.add(word);
    for(const child of data.imports)await walk(child);
    visiting.delete(root);seen.add(root);
   };
   try{for(const root of roots)await walk(root);}catch(error){throw new Error(`无法比较 ${name} 的基础词库：${error.message}。请补全词库源码或取消此筛选。`);}
   result.set(name,words);
  }
  return result;
 }
}
