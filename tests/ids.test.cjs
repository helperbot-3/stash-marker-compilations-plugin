const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../plugins/marker-compilations/ui/patterns.js'),'utf8');
function load(crypto){const context={module:{exports:{}},crypto};vm.runInNewContext(source,context);return context.module.exports;}
test('draft and hot-zone IDs work on HTTP without randomUUID',()=>{
  let seed=0;
  const api=load({getRandomValues(bytes){bytes.fill(++seed);return bytes;}});
  const ids=Array.from({length:100},()=>api.uniqueId());
  assert.equal(new Set(ids).size,100);
  for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('IDs also work with no crypto API and retain the native UUID path',()=>{
  const api=load(undefined),ids=Array.from({length:1000},()=>api.uniqueId());
  assert.equal(new Set(ids).size,1000);
  for(const id of ids)assert.match(id,/^[A-Za-z0-9_-]{1,80}$/);
  assert.equal(load({randomUUID:()=> 'native-uuid'}).uniqueId(),'native-uuid');
});
