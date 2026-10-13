import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
const sourceFile = fileURLToPath(new URL('./native/system-dictionary.c', import.meta.url));
export function dictionaryTerm(term) {
  if (typeof term !== 'string' || !term.trim() || term.length > 120 || /[\x00-\x1f\x7f]/.test(term)) throw new Error('请输入 1–120 个字符的字词，不能包含换行或控制字符');
  return term.trim();
}
export class SystemDictionary {
  constructor(dataDir, {platform=process.platform, run=exec}={}) {
    this.dataDir=dataDir; this.platform=platform; this.run=run; this.build=null;
  }
  async helper() {
    if (this.platform !== 'darwin') throw new Error('系统词典查询仅支持 macOS');
    if (!this.build) this.build=this.prepare().catch(error=>{this.build=null;throw error;});
    return this.build;
  }
  async prepare() {
    const source=await fs.readFile(sourceFile);
    const hash=crypto.createHash('sha256').update(source).update(process.arch).digest('hex').slice(0,20);
    const dir=path.join(this.dataDir,'native',hash), binary=path.join(dir,'system-dictionary');
    try {await fs.access(binary,fs.constants.X_OK);return binary;} catch {}
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    const temp=binary+'-'+crypto.randomUUID();
    try {
      await this.run('/usr/bin/clang',[sourceFile,'-O2','-framework','CoreServices','-o',temp],{timeout:30000,maxBuffer:500000});
      await fs.chmod(temp,0o700);await fs.rename(temp,binary);
    } catch {throw new Error('系统词典查询需要 macOS 命令行工具（clang）；请安装后重试。其他功能仍可使用');}
    finally {await fs.unlink(temp).catch(()=>{});}
    return binary;
  }
  async lookup(input) {
    const term=dictionaryTerm(input), binary=await this.helper();
    let definition='';
    try {({stdout:definition}=await this.run(binary,[term],{timeout:10000,maxBuffer:1024*1024}));}
    catch(error) {if(error.code!==3)throw new Error(error.killed?'系统词典查询超时，请重试':'系统词典查询失败，请检查 macOS 词典设置后重试');}
    return {term,found:!!definition.trim(),definition,source:'macOS 系统词典',message:definition.trim()?'返回已启用词典中首个匹配词条的释义':'未找到释义。请在 macOS“词典”应用的设置中启用相应词典，或换一个字词'};
  }
}
