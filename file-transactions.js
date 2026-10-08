import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {withFileDiff} from './review-diff.js';

export const digest = text => crypto.createHash('sha256').update(text).digest('hex');
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
export async function readText(root, relative) {
  const file = await safeFile(root, relative);
  try {
    const stat = await fs.stat(file);
    if (stat.size > maxBytes) fail('文件超过 120 MB');
    const bytes = await fs.readFile(file);
    const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    if (text.includes('\0')) fail('只支持 UTF-8 文本文件');
    return {text, exists:true};
  } catch (e) { if (e.code === 'ENOENT') return {text:'', exists:false}; throw e; }
}
export async function previewFiles(store, changes, summary, metadata = {}) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 500) fail('文件数量必须在 1–500 之间');
  if (new Set(changes.map(x => x.file)).size !== changes.length) fail('目标文件重复');
  const revision = (await store.snapshot()).revision;
  const files = [];
  let total = 0;
  for (const change of changes) {
    if (typeof change.after !== 'string') fail('需要文本内容');
    total += Buffer.byteLength(change.after);
    if (total > maxBytes) fail('修改总量超过 120 MB');
    const before = await readText(store.userDir, change.file);
    if (change.expected && (before.exists !== change.expected.exists || digest(before.text) !== change.expected.hash)) fail('文件已变化，请重新读取');
    const afterExists = change.afterExists !== false;
    if (before.exists !== afterExists || before.text !== change.after) files.push({file:change.file, before:before.text, beforeExists:before.exists, after:change.after, afterExists});
  }
  if (!files.length) fail('没有需要写入的修改');
  const id = crypto.randomUUID();
  const preview = {id, revision, files, summary, created:Date.now(), kind:'resources', metadata};
  for (const [key, value] of store.previews) if (Date.now() - value.created > 600000) store.previews.delete(key);
  store.previews.set(id, preview);
  return presentPreview(preview);
}
export function presentPreview(preview) {
  const countLines = text => text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  return {...preview, files:preview.files.map(f => {
    const detail = Buffer.byteLength(f.before) + Buffer.byteLength(f.after) <= 64000 && countLines(f.before) + countLines(f.after) <= 2000;
    const common = {file:f.file, isNew:!f.beforeExists, isDeleted:f.afterExists === false, beforeBytes:Buffer.byteLength(f.before), afterBytes:Buffer.byteLength(f.after), beforeHash:digest(f.before), afterHash:digest(f.after)};
    if (detail) return {...withFileDiff({files:[f]}).files[0], ...common};
    return {...common, summaryOnly:true, additions:0, deletions:0, beforeLines:countLines(f.before), afterLines:countLines(f.after)};
  })};
}
export async function writeResource(store, relative, text, exists = true) {
  const dest = await safeFile(store.userDir, relative);
  if (!exists) { await fs.unlink(dest).catch(e => { if (e.code !== 'ENOENT') throw e; }); return; }
  await fs.mkdir(path.dirname(dest), {recursive:true, mode:0o700});
  await safeFile(store.userDir, relative);
  await store.atomicWrite(dest, text);
}
export async function applyFiles(store, preview) {
  const check = async f => {
    const now = await readText(store.userDir, f.file);
    if (now.exists !== f.beforeExists || now.text !== f.before) fail('文件已变化，请重新预览');
  };
  if ((await store.snapshot()).revision !== preview.revision) fail('配置已变化，请重新预览');
  for (const f of preview.files) await check(f);
  const dir = path.join(store.dataDir, crypto.randomUUID());
  await fs.mkdir(dir, {recursive:true, mode:0o700});
  const record = {id:path.basename(dir), time:new Date().toISOString(), kind:'resources', summary:preview.summary, files:preview.files.map(f => ({...f, afterHash:digest(f.after)})), metadata:preview.metadata};
  await fs.writeFile(path.join(dir, 'record.json'), JSON.stringify(record), {mode:0o600});
  const written = [];
  try {
    for (const f of preview.files) { await check(f); await writeResource(store, f.file, f.after, f.afterExists); written.push(f); }
  } catch (error) {
    for (const f of written.reverse()) { const now = await readText(store.userDir, f.file); if (now.text === f.after && now.exists === f.afterExists) await writeResource(store, f.file, f.before, f.beforeExists); }
    record.failed = true;
    await fs.writeFile(path.join(dir, 'record.json'), JSON.stringify(record), {mode:0o600});
    throw error;
  }
  store.previews.delete(preview.id);
  return {id:record.id, files:preview.files.map(f => f.file), message:'已保存并备份，请重新部署'};
}
export async function restoreFiles(store, record, dir) {
  for (const f of record.files) {
    const now = await readText(store.userDir, f.file);
    if (now.exists !== f.afterExists || digest(now.text) !== f.afterHash) fail('这些文件后来又被修改，不能直接覆盖恢复');
  }
  const written = [];
  try {
    for (const f of record.files) {
      const now = await readText(store.userDir, f.file);
      if (now.exists !== f.afterExists || digest(now.text) !== f.afterHash) fail('恢复前发现文件变化');
      await writeResource(store, f.file, f.before, f.beforeExists); written.push(f);
    }
  } catch (error) {
    for (const f of written.reverse()) { const now = await readText(store.userDir, f.file); if (now.exists === f.beforeExists && now.text === f.before) await writeResource(store, f.file, f.after, f.afterExists); }
    throw error;
  }
  record.restored = new Date().toISOString();
  await fs.writeFile(path.join(dir, 'record.json'), JSON.stringify(record), {mode:0o600});
  return {message:'已恢复修改前文件，请重新部署'};
}
