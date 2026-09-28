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
test('timeline duration accounts for repeats and speed, and seeking maps to source offsets',()=>{
  const clips=[{start:10,end:20,phases:patterns.presets['3-2-3']},{start:30,end:35}];
  assert.deepEqual(patterns.timeline(clips),[{index:0,start:0,end:100,duration:100},{index:1,start:100,end:105,duration:5}]);
  const passes=patterns.expand(clips);
  assert.deepEqual(patterns.locate(passes,35),{index:3,offset:2.5});
  assert.deepEqual(patterns.locate(passes,50),{index:4,offset:0});
  assert.deepEqual(patterns.locate(passes,100),{index:8,offset:0});
  assert.deepEqual(patterns.locate(passes,999),{index:8,offset:5});
  assert.deepEqual(patterns.locate(passes,-2),{index:0,offset:0});
});
test('timeline reorder preserves clip trims and phase data',()=>{
  const a={title:'A',start:1,end:2}, b={title:'B',phases:patterns.presets['3-2-3']}, c={title:'C'};
  const clips=[a,b,c];
  assert.deepEqual(patterns.reorder(clips,0,2),[b,c,a]);
  assert.deepEqual(patterns.reorder(clips,2,0),[c,a,b]);
  assert.deepEqual(clips,[a,b,c]);
  assert.equal(patterns.reorder(clips,-1,2),clips);
});
test('trim timestamps convert between source seconds and player-style times',()=>{
  for(const [seconds,text] of [[0,'0:00'],[9.5,'0:09.5'],[90,'1:30'],[3599.125,'59:59.125'],[3600,'60:00'],[3723.456789,'62:03.456789']]) {
    assert.equal(patterns.formatTime(seconds),text);
    assert.equal(patterns.parseTime(text),seconds);
  }
  assert.equal(patterns.parseTime('1:02:03.5'),3723.5);
  assert.equal(patterns.parseTime(' 2:05 '),125);
  for(const text of ['', '90', '1:', '1:60', '1:99:00', '-1:00', '1:02abc', 'Infinity:00'])assert.equal(patterns.parseTime(text),null);
});
test('clipboard round trip preserves independent trims and speed phases without resolved media',()=>{
  const original={scene_id:'42',marker_id:'3',title:'Sample',start:1.25,end:3.5,phases:[{repeat:3,speed:.5}],streams:[{url:'private-url'}]};
  const encoded=patterns.encodeClip(original), pasted=patterns.decodeClip(encoded);
  assert.equal(encoded.includes('private-url'),false);
  assert.deepEqual(pasted,{scene_id:'42',marker_id:'3',title:'Sample',start:1.25,end:3.5,phases:[{repeat:3,speed:.5}]});
  pasted.phases[0].repeat=9;
  assert.equal(original.phases[0].repeat,3);
  assert.equal(patterns.decodeClip(encoded).phases[0].repeat,3);
  for(const value of ['hello','{}','null',encoded.replace('"end":3.5','"end":0'),encoded.replace('"speed":0.5','"speed":999'),encoded.replace('"version":1','"version":2')])assert.equal(patterns.decodeClip(value),null);
});

test('catalog preserves imported media independently of timeline instances',()=>{
  const clip={scene_id:'1',marker_id:'7',title:'Original',start:1,end:4};
  const media=patterns.catalog({clips:[clip,{...clip,start:2}]});
  assert.equal(media.length,1);
  assert.equal(patterns.catalog({media,clips:[]}).length,1);
  const timeline=patterns.insertClip([],media[0],0);
  timeline[0].phases[0].repeat=5;timeline[0].start=2;
  assert.equal(media[0].start,1);assert.equal(media[0].phases[0].repeat,1);
  assert.equal(patterns.insertClip(timeline,media[0],1).length,2);
});

test('all labeled presets expand into supported positive-duration sequences',()=>{
  assert.equal(Object.keys(patterns.presets).length,Object.keys(patterns.presetLabels).length);
  for(const phases of Object.values(patterns.presets)){
    assert.ok(phases.length<=10);
    for(const phase of phases){assert.ok(Number.isInteger(phase.repeat)&&phase.repeat>=1&&phase.repeat<=20);assert.ok([.25,.5,.75,1,1.25,1.5,2,3].includes(phase.speed));}
    assert.ok(patterns.duration({start:1,end:2,phases})>0);
  }
});
