import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
async function launch(t,extra={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rime-api-connection-'));
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const env={...process.env,PORT:String(port),RIME_STUDIO_DATA_DIR:path.join(dir,'data'),RIME_DISABLE_DEPLOY:'1'};delete env.RIME_USER_DIR;delete env.RIME_SHARED_DIR;Object.assign(env,extra);
 const child=spawn(process.execPath,['server.js'],{cwd:root,env,stdio:'ignore'});
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await fs.rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,20));}
 return {dir,base,async request(url,body,token){const response=await fetch(base+url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','x-rime-token':token}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}};
}
async function dirs(dir,name){const user=path.join(dir,name),shared=path.join(dir,'shared');await fs.mkdir(user);await fs.mkdir(shared,{recursive:true});await fs.writeFile(path.join(shared,'default.yaml'),'menu: {page_size: 5}\nschema_list: [{schema: test}]\n');await fs.writeFile(path.join(shared,'squirrel.yaml'),'style: {font_point: 16}\n');await fs.writeFile(path.join(user,'test.schema.yaml'),'schema: {schema_id: test, name: test}\n');return {userDir:user,sharedDir:shared};}
test('setup, invalid path rejection, persistence, and directory switching are isolated',async t=>{
 const app=await launch(t),initial=(await app.request('/api/state')).data;assert.equal(typeof initial.connection.ready,'boolean');assert.ok(initial.token);
 const invalid=await app.request('/api/connection',{userDir:'/nonexistent/rime-studio-fixture',sharedDir:'/nonexistent/resources'},initial.token);assert.equal(invalid.status,400);await assert.rejects(fs.stat(path.join(app.dir,'data/settings.json')),/ENOENT/);
 const one=await dirs(app.dir,'one'),two=await dirs(app.dir,'two');
 const connected=await app.request('/api/connection',one,initial.token);assert.equal(connected.status,200);assert.equal(connected.data.connection.confirmed,true);assert.equal(connected.data.connection.canDeploy,false);
 const a=connected.data;const preview=await app.request('/api/preview',{connectionId:a.connection.id,revision:a.revision,changes:[{field:'page_size',value:7}]},a.token);assert.equal(preview.status,200);
 const b=(await app.request('/api/connection',two,a.token)).data;assert.notEqual(a.connection.id,b.connection.id);
 const stale=await app.request('/api/apply',{connectionId:a.connection.id,id:preview.data.id},b.token);assert.equal(stale.status,400);assert.match(stale.data.error,/目录已变化/);
 await assert.rejects(fs.stat(path.join(two.userDir,'default.custom.yaml')),/ENOENT/);
 const stored=JSON.parse(await fs.readFile(path.join(app.dir,'data/settings.json'),'utf8'));assert.equal(stored.confirmed,true);assert.equal(stored.userDir,two.userDir);
 const noId=await app.request('/api/preview',{revision:b.revision,changes:[{field:'page_size',value:6}]},b.token);assert.equal(noId.status,400);
});
test('missing directories still bootstrap the settings page and reject configuration writes',async t=>{
 const app=await launch(t,{RIME_USER_DIR:'/nonexistent/rime-studio-user',RIME_SHARED_DIR:'/nonexistent/rime-studio-shared'});const response=await app.request('/api/state');assert.equal(response.status,200);assert.equal(response.data.connection.ready,false);assert.deepEqual(response.data.schemas,[]);assert.ok(response.data.connection.issues.length);assert.ok(response.data.token);const write=await app.request('/api/preview',{changes:[{field:'page_size',value:6}]},response.data.token);assert.equal(write.status,400);assert.match(write.data.error,/连接设置/);
});
