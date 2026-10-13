import test from 'node:test';
import assert from 'node:assert/strict';
import {convertText,conversionModes} from '../text-tools.js';
import {dictionaryTerm,SystemDictionary} from '../system-dictionary.js';
import {phraseRows,phraseProblems,rewritePhrases} from '../public/phrase-format.js';

test('OpenCC converts regional words in both directions while keeping whitespace and non-Chinese text',()=>{
  assert.equal(convertText({text:'鼠标和软件\nHello 123 😀',mode:'s2twp'}).text,'滑鼠和軟體\nHello 123 😀');
  assert.equal(convertText({text:'滑鼠與軟體\nHello 123 😀',mode:'tw2sp'}).text,'鼠标与软件\nHello 123 😀');
  assert.equal(convertText({text:'汉语',mode:'s2t'}).text,'漢語');
  assert.equal(convertText({text:'漢語',mode:'t2s'}).text,'汉语');
  for(const {id} of conversionModes)assert.equal(typeof convertText({text:'  汉语 漢語\n',mode:id}).text,'string');
  assert.equal(convertText({text:'Hello 😀',mode:'s2tw'}).changed,false);
});
test('OpenCC rejects oversized, empty and unsupported requests',()=>{
  for(const request of [{text:'汉',mode:'__proto__'},{text:'x'.repeat(30001),mode:'s2t'},{text:'\0',mode:'s2t'},{text:'  ',mode:'s2t'},{text:[],mode:'s2t'}])assert.throws(()=>convertText(request));
  assert.equal(convertText({text:'x'.repeat(30000),mode:'s2t'}).text.length,30000);
});
test('dictionary queries pass Unicode and shell punctuation as a single native argument',async()=>{
  const requests=[],dictionary=new SystemDictionary('/unused',{run:async(binary,args)=>{requests.push({binary,args});return {stdout:'释义 <b>原文</b>\n第二行'};}});
  dictionary.helper=async()=>'/local/helper';
  const result=await dictionary.lookup('  𠮷 $(echo unsafe)  ');
  assert.equal(result.found,true);assert.equal(result.definition,'释义 <b>原文</b>\n第二行');assert.deepEqual(requests,[{binary:'/local/helper',args:['𠮷 $(echo unsafe)']}]);
  for(const term of ['',null,'x'.repeat(121),'hello\n','a\0b'])assert.throws(()=>dictionaryTerm(term));
});
test('dictionary distinguishes missing entries, unavailable platform and failed native execution',async()=>{
  const dictionary=new SystemDictionary('/unused',{run:async()=>{throw Object.assign(new Error('missing'),{code:3});}});dictionary.helper=async()=>'/local/helper';
  const missing=await dictionary.lookup('不存在');assert.equal(missing.found,false);assert.equal(missing.definition,'');assert.match(missing.message,/未找到/);
  dictionary.run=async()=>{throw Object.assign(new Error('timed out'),{killed:true});};await assert.rejects(dictionary.lookup('hello'),/超时/);
  const other=new SystemDictionary('/unused',{platform:'linux'});await assert.rejects(other.lookup('hello'),/仅支持 macOS/);
});
test('phrase round trips retain BOM, comments, CRLF, optional columns and the absence of a final newline',()=>{
  const text='\uFEFF# Rime table\r\n#@/db_name\tcustom_phrase.txt\r\n\r\n地址\tdz\r\n# 行间说明\r\n签名\tqm\t20';
  const rows=phraseRows(text);assert.equal(rows.length,2);assert.equal(rewritePhrases(text,rows),text);
  rows[1].weight='30';assert.equal(rewritePhrases(text,rows),text.replace('qm\t20','qm\t30'));
  rows.push({text:'邮箱',code:'yx',weight:''});assert.equal(rewritePhrases(text,rows),text.replace('qm\t20','qm\t30')+'\r\n邮箱\tyx\r\n');
  assert.equal(rewritePhrases(text,[rows[1]]),'\uFEFF# Rime table\r\n#@/db_name\tcustom_phrase.txt\r\n\r\n# 行间说明\r\n签名\tqm\t30');
});
test('phrase validation distinguishes candidate collisions from repeated entries and invalid imports',()=>{
  const candidates=phraseRows('邮箱\tyx\t10\n邮编\tyx\t20\n');assert.equal(phraseProblems(candidates).errors.length,0);assert.equal(phraseProblems(candidates).conflicts[0].code,'yx');
  candidates.push({...candidates[0],weight:'30'});assert.match(phraseProblems(candidates).errors.join(' '),/重复/);
  for(const text of ['缺少分隔符','字\tz\t1\t多列'])assert.throws(()=>phraseRows(text));
  assert.ok(phraseProblems([{text:'   ',code:'x',weight:''},{text:'字',code:'x',weight:'-1'}]).errors.length>=2);
});
