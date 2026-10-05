import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPatch} from 'diff';
import {html} from 'diff2html';
import {withFileDiff} from '../review-diff.js';

test('display diff reconstructs exact preview bytes including Unicode and no final newline',()=>{
 const original={id:'preview-id',revision:'revision',files:[{file:'default.custom.yaml',before:'# 候选设置\npatch:\n  menu/page_size: 9',after:'# 候选设置\npatch:\n  menu/page_size: 7'}]};
 const result=withFileDiff(original);
 assert.equal(result.id,original.id);assert.equal(result.revision,original.revision);
 assert.equal(applyPatch(result.files[0].before,result.files[0].diff),result.files[0].after);
 assert.equal(result.files[0].additions,1);assert.equal(result.files[0].deletions,1);
 assert.equal(original.files[0].diff,undefined);
});
test('multi-file diffs retain each target and identify a newly created config',()=>{
 const result=withFileDiff({files:[{file:'default.custom.yaml',before:'patch: {}\n',after:'patch:\n  menu/page_size: 7\n'},{file:'flypy.custom.yaml',before:'',after:'patch:\n  switches/@0/reset: 1\n'}]});
 assert.equal(result.files.length,2);assert.equal(result.files[0].isNew,false);assert.equal(result.files[1].isNew,true);
 assert.equal(result.files[1].additions,2);assert.equal(result.files[1].deletions,0);
 for(const file of result.files){assert.equal(applyPatch(file.before,file.diff),file.after);assert.ok(file.diff.includes(file.file));}
});
test('component renders YAML comment markup as text in both display modes',()=>{
 const file=withFileDiff({files:[{file:'default.custom.yaml',before:'patch: {}\n',after:'# <img src=x onerror=alert(1)>\npatch: {}\n'}]}).files[0];
 for(const outputFormat of ['side-by-side','line-by-line']){
  const rendered=html(file.diff,{drawFileList:false,outputFormat,matching:'lines'});
  assert.ok(rendered.includes('d2h-ins'));assert.ok(rendered.includes('&lt;img'));
  assert.ok(!rendered.includes('<img src=x'));
 }
});
