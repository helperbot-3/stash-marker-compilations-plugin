const {test}=require('node:test');
const assert=require('node:assert/strict');
const patterns=require('../plugins/marker-compilations/ui/patterns.js');
test('3 normal, 2 slow, 3 normal stays ordered and computes viewing duration',()=>{
  const clip={start:10,end:20,phases:patterns.presets['3-2-3'],cached:'one-file.mp4'};
  const passes=patterns.expand([clip]);
  assert.deepEqual(passes.map(p=>p.speed),[1,1,1,.5,.5,1,1,1]);
  assert.equal(patterns.duration(clip),100);
  assert.equal(new Set(passes.map(p=>p.cached)).size,1);
  assert.deepEqual(passes.map(p=>p.repeatIndex),[0,1,2,0,1,0,1,2]);
});
test('patterns complete for each clip before proceeding to the next',()=>{
  const passes=patterns.expand([{scene_id:'1',phases:[{repeat:2,speed:.75}]},{scene_id:'2'}]);
  assert.deepEqual(passes.map(p=>[p.scene_id,p.speed]),[['1',.75],['1',.75],['2',1]]);
});
test('old compilations default to a single normal-speed pass',()=>{
  assert.equal(patterns.duration({start:4,end:9}),5);
  assert.equal(patterns.expand([{start:4,end:9}]).length,1);
});
