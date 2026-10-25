import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
const ref=process.argv[2];
if(!ref) throw new Error('用法：node scripts/bundle-size.mjs <迁移前的提交>');
const beforeNames=execFileSync('git',['ls-tree','-r','--name-only',ref,'public'],{encoding:'utf8'}).trim().split('\n').filter(name=>/\.(js|css)$/.test(name));
const afterNames=fs.readdirSync('dist/assets').filter(name=>/\.(js|css)$/.test(name));
function sum(buffers){return buffers.reduce((total,bytes)=>({raw:total.raw+bytes.length,gzip:total.gzip+gzipSync(bytes).length}),{raw:0,gzip:0});}
const before=sum(beforeNames.map(name=>execFileSync('git',['show',`${ref}:${name}`])));
const after=sum(afterNames.map(name=>fs.readFileSync('dist/assets/'+name)));
// Vendor files are unchanged, delivered separately by Express; include them on both sides.
const vendor=sum(['node_modules/diff2html/bundles/js/diff2html.min.js','node_modules/diff2html/bundles/css/diff2html.min.css'].map(name=>fs.readFileSync(name)));
console.log(JSON.stringify({baseline:ref,unit:'bytes; gzip per HTTP resource; excludes HTML, favicon and source maps',application:{before,after,delta:{raw:after.raw-before.raw,gzip:after.gzip-before.gzip}},includingUnchangedVendor:{before:{raw:before.raw+vendor.raw,gzip:before.gzip+vendor.gzip},after:{raw:after.raw+vendor.raw,gzip:after.gzip+vendor.gzip}}},null,2));
