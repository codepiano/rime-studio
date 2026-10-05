import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupSymbols} from '../public/symbols.js';
const schema={deployed:true,deployedConfig:{punctuator:{half_shape:{'|':['·','|','｜','§','¦'],'/':['、','/'],'"':{pair:['“','”']},'^':{commit:'……'}},full_shape:{'|':['·','｜','§','¦']}}}};
test('natural descriptions find middle dot with its actual candidate position',()=>{
 const result=lookupSymbols(schema,'外国人名中间那个圆点');assert.equal(result.length,1);assert.equal(result[0].character,'·');assert.equal(result[0].routes[0].keyLabel,'Shift + \\');assert.equal(result[0].routes[0].index,1);assert.deepEqual(result[0].routes[0].modes,['半角','全角']);
});
test('pasted character reverse lookup retains paired and direct output semantics',()=>{
 assert.equal(lookupSymbols(schema,'“')[0].routes[0].kind,'pair');assert.equal(lookupSymbols(schema,'省略号')[0].character,'……');assert.equal(lookupSymbols(schema,'……')[0].routes[0].kind,'direct');
});
test('lookup reflects configuration changes instead of inventing a default mapping',()=>{
 const changed=structuredClone(schema);changed.deployedConfig.punctuator.half_shape['|']='•';changed.deployedConfig.punctuator.full_shape['|']='•';assert.deepEqual(lookupSymbols(changed,'人名间隔号'),[]);assert.equal(lookupSymbols(changed,'•')[0].routes[0].kind,'direct');
});
test('schemes without compiled symbol maps do not return unverified shortcuts',()=>{
 assert.deepEqual(lookupSymbols({deployed:false},'圆点'),[]);assert.deepEqual(lookupSymbols({deployed:true,deployedConfig:{}},'圆点'),[]);
});
test('the suggested route prefers the first candidate over harder alternatives',()=>{
 const modified=structuredClone(schema);modified.deployedConfig.punctuator.half_shape={'*':['*','＊','·'],...modified.deployedConfig.punctuator.half_shape};const result=lookupSymbols(modified,'外国人名')[0];assert.equal(result.routes[0].key,'|');assert.equal(result.routes[0].index,1);
});
