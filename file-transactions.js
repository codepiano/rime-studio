import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {withFileDiff} from './review-diff.js';

export const digest = (text,encoding='utf8') => crypto.createHash('sha256').update(encoding==='base64'?Buffer.from(text,'base64'):text).digest('hex');
const sizeOf=(text,encoding)=>encoding==='base64'?Buffer.from(text,'base64').length:Buffer.byteLength(text);
const fail = message => { throw new Error(message); };
const maxBytes = 120 * 1024 * 1024;
export async function safeFile(root, relative) {
  if (typeof relative !== 'string' || relative.length > 240 || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(relative) || relative.split('/').some(x => x === '.' || x === '..')) fail('无效文件路径');
  const parts = relative.split('/');
  let current = root;
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('配置目录必须是真实目录');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await fs.lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (stat && (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()))) fail('文件及父目录不能是符号链接或特殊文件');
  }
  return current;
}
export async function readResource(root, relative, encoding='utf8') {
  const file = await safeFile(root, relative);
  try {
    const stat = await fs.stat(file);
    if (stat.size > maxBytes) fail('文件超过 120 MB');
    const bytes = await fs.readFile(file);
    const text = encoding==='base64'?bytes.toString('base64'):new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(bytes);
    if (encoding!=='base64' && text.includes('\0')) fail('只支持 UTF-8 文本文件');
    return {text, exists:true};
  } catch (e) { if (e.code === 'ENOENT') return {text:'', exists:false}; throw e; }
}
export const readText=(root,relative)=>readResource(root,relative);
export async function previewFiles(store, changes, summary, metadata = {}, expectedRevision, guards = []) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 500) fail('文件数量必须在 1–500 之间');
  if (new Set(changes.map(x => x.file)).size !== changes.length) fail('目标文件重复');
  const revision = (await store.snapshot()).revision;
  if (expectedRevision && expectedRevision !== revision) fail('配置已变化，请重新读取');
  const files = [];
  let total = 0;
  for (const change of changes) {
    if (typeof change.after !== 'string') fail('需要文本内容');
    const encoding=change.encoding||'utf8';
    if(!['utf8','base64'].includes(encoding))fail('无效文件编码');
    total += sizeOf(change.after,encoding);
    if (total > maxBytes) fail('修改总量超过 120 MB');
    const before = await readResource(store.userDir, change.file,encoding);
    if (change.expected && (before.exists !== change.expected.exists || digest(before.text,encoding) !== change.expected.hash)) fail('文件已变化，请重新读取');
    const afterExists = change.afterExists !== false;
    if (before.exists !== afterExists || before.text !== change.after) files.push({file:change.file, encoding, before:before.text, beforeExists:before.exists, after:change.after, afterExists});
  }
  if (!files.length) fail('没有需要写入的修改');
  await checkGuards(store,guards);
  const id = crypto.randomUUID();
  const preview = {id, revision, files, summary, created:Date.now(), kind:'resources', metadata, guards};
  for (const [key, value] of store.previews) if (Date.now() - value.created > 600000) store.previews.delete(key);
  store.previews.set(id, preview);
  return presentPreview(preview);
}
export function presentPreview(preview) {
  const countLines = text => text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  return {...preview, files:preview.files.map(f => {
    const detail = f.file!=='.rime-studio-packages.json' && f.encoding!=='base64' && Buffer.byteLength(f.before) + Buffer.byteLength(f.after) <= 64000 && countLines(f.before) + countLines(f.after) <= 2000;
    const common = {file:f.file, isNew:!f.beforeExists, isDeleted:f.afterExists === false, record:f.file==='.rime-studio-packages.json', binary:f.encoding==='base64', beforeBytes:sizeOf(f.before,f.encoding), afterBytes:sizeOf(f.after,f.encoding), beforeHash:digest(f.before,f.encoding), afterHash:digest(f.after,f.encoding)};
    if (detail) return {...withFileDiff({files:[f]}).files[0], ...common};
    return {...common, summaryOnly:true, additions:0, deletions:0, beforeLines:f.encoding==='base64'?0:countLines(f.before), afterLines:f.encoding==='base64'?0:countLines(f.after)};
  })};
}
export async function writeResource(store, relative, text, exists = true, encoding='utf8') {
  const dest = await safeFile(store.userDir, relative);
  if (!exists) { await fs.unlink(dest).catch(e => { if (e.code !== 'ENOENT') throw e; }); return; }
  await fs.mkdir(path.dirname(dest), {recursive:true, mode:0o700});
  await safeFile(store.userDir, relative);
  await store.atomicWrite(dest, encoding==='base64'?Buffer.from(text,'base64'):text);
}
async function checkGuards(store,guards){
  for(const guard of guards){const now=await readResource(guard.origin==='shared'?store.sharedDir:store.userDir,guard.file,guard.encoding);if(now.exists!==guard.exists||digest(now.text,guard.encoding)!==guard.hash)fail('词库依赖或方案文件已变化，请重新读取');}
}
export async function applyFiles(store, preview) {
  const check = async f => {
    const now = await readResource(store.userDir, f.file,f.encoding);
    if (now.exists !== f.beforeExists || now.text !== f.before) fail('文件已变化，请重新预览');
  };
  if ((await store.snapshot()).revision !== preview.revision) fail('配置已变化，请重新预览');
  await checkGuards(store,preview.guards||[]);
  for (const f of preview.files) await check(f);
  const dir = path.join(store.dataDir, crypto.randomUUID());
  await fs.mkdir(dir, {recursive:true, mode:0o700});
  const record = {id:path.basename(dir), time:new Date().toISOString(), kind:'resources', summary:preview.summary, files:preview.files.map(f => ({...f, afterHash:digest(f.after,f.encoding)})), metadata:preview.metadata};
  await fs.writeFile(path.join(dir, 'record.json'), JSON.stringify(record), {mode:0o600});
  const written = [];
  try {
    for (const f of preview.files) { await check(f); await writeResource(store, f.file, f.after, f.afterExists,f.encoding); written.push(f); }
  } catch (error) {
    for (const f of written.reverse()) { const now = await readResource(store.userDir, f.file,f.encoding); if (now.text === f.after && now.exists === f.afterExists) await writeResource(store, f.file, f.before, f.beforeExists,f.encoding); }
    record.failed = true;
    await fs.writeFile(path.join(dir, 'record.json'), JSON.stringify(record), {mode:0o600});
    throw error;
  }
  store.previews.delete(preview.id);
  return {id:record.id, files:preview.files.map(f => f.file), message:'已保存并备份，请重新部署'};
}
export async function restoreFiles(store, record, dir) {
  for (const f of record.files) {
    const now = await readResource(store.userDir, f.file,f.encoding);
    if (now.exists !== f.afterExists || digest(now.text,f.encoding) !== f.afterHash) fail('这些文件后来又被修改，不能直接覆盖恢复');
  }
  const written = [];
  try {
    for (const f of record.files) {
      const now = await readResource(store.userDir, f.file,f.encoding);
      if (now.exists !== f.afterExists || digest(now.text,f.encoding) !== f.afterHash) fail('恢复前发现文件变化');
      await writeResource(store, f.file, f.before, f.beforeExists,f.encoding); written.push(f);
    }
  } catch (error) {
    for (const f of written.reverse()) { const now = await readResource(store.userDir, f.file,f.encoding); if (now.exists === f.beforeExists && now.text === f.before) await writeResource(store, f.file, f.after, f.afterExists,f.encoding); }
    throw error;
  }
  record.restored = new Date().toISOString();
  await fs.writeFile(path.join(dir, 'record.json'), JSON.stringify(record), {mode:0o600});
  return {message:'已恢复修改前文件，请重新部署'};
}
