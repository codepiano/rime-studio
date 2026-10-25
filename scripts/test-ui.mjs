import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-mantine-ui-'));
const user = path.join(dir,'user'), shared = path.join(dir,'shared'), data = path.join(dir,'data');
let server;
try {
  for (const folder of [user, shared, data]) await fs.mkdir(folder);
  await fs.writeFile(path.join(shared,'default.yaml'), 'menu: {page_size: 5}\nschema_list: [{schema: test}]\nascii_composer: {switch_key: {Shift_L: inline_ascii, Shift_R: commit_text}}\nswitcher: {hotkeys: [Control+grave]}\n');
  await fs.writeFile(path.join(shared,'squirrel.yaml'), 'style: {font_point: 16, font_face: PingFang SC, inline_preedit: true, show_paging: true, color_scheme: long}\npreset_color_schemes:\n  long: {name: 一个用于桌面视觉验收的很长很长的候选配色名称与说明文字，检查省略和箭头留白, back_color: 0xffffff, text_color: 0x262a24}\n');
  await fs.writeFile(path.join(user,'test.schema.yaml'), 'schema: {schema_id: test, name: 桌面隔离测试方案}\nswitches: [{name: ascii_mode, reset: 0}, {name: simplification, reset: 1}, {name: ascii_punct, reset: 0}]\nengine: {translators: [script_translator]}\ntranslator: {dictionary: base, enable_user_dict: true}\n');
  await fs.writeFile(path.join(shared,'base.dict.yaml'), '---\nname: base\n...\n你好\tni hao\t100\n');
  await fs.writeFile(path.join(data,'settings.json'), JSON.stringify({userDir:user,sharedDir:shared,confirmed:true}));
  const listener = net.createServer(); listener.listen(0,'127.0.0.1'); await once(listener,'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const env = {...process.env, PORT:String(port), RIME_USER_DIR:user, RIME_SHARED_DIR:shared, RIME_STUDIO_DATA_DIR:data, RIME_SOURCE_DIR:path.join(dir,'source'), RIME_DISABLE_DEPLOY:'1', RIME_QA_USER_DIR:user, RIME_QA_URL:`http://127.0.0.1:${port}`};
  server = spawn(process.execPath,['server.js'],{cwd:root,env,stdio:['ignore','pipe','inherit']});
  let ready = false;
  for (let i=0;i<100;i++) { if(server.exitCode!==null) throw new Error('隔离服务提前退出'); try { const response=await fetch(env.RIME_QA_URL+'/health'); if(response.ok){ready=true;break;} } catch {} await new Promise(resolve=>setTimeout(resolve,50)); }
  if(!ready) throw new Error('隔离服务未就绪');
  const test = spawn(process.execPath,['node_modules/@playwright/test/cli.js','test',...process.argv.slice(2)],{cwd:root,env,stdio:'inherit'});
  const [code] = await once(test,'exit'); process.exitCode = code ?? 1;
} finally {
  if(server && server.exitCode === null) { server.kill('SIGTERM'); await once(server,'exit'); }
  await fs.rm(dir,{recursive:true,force:true});
}
