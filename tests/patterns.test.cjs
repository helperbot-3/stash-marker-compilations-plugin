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


test('frame timecodes use fixed-width non-drop-frame numbering and round trip fractional rates',()=>{
  for(const fps of [24,25,30,60,24000/1001,30000/1001,60000/1001,120]){
    for(const n of [0,1,23,24,100,1800,108000]){
      const text=patterns.frameTime(n/fps,fps);
      assert.ok(Math.abs(patterns.parseFrameTime(text,fps)-n/fps)<1e-8);
      assert.equal(text.length,fps===120?12:11);
    }
  }
  assert.equal(patterns.frameTime(1+1/24,24),'00:00:01:01');
  assert.equal(patterns.parseFrameTime('00:00:01:24',24),null);
  assert.equal(patterns.parseFrameTime('0:01.25',24),1.25);
  assert.equal(patterns.frameTime(2,null),'--:--:--:--');
});

test('frame stepping uses timestamps, including unequal frame durations and window edges',()=>{
  const window={times:[0,.04,.1,.12,.2],at_start:true,at_end:true};
  assert.equal(patterns.frameStep(window,.05,1),.1);
  assert.equal(patterns.frameStep(window,.1,-1),.04);
  assert.equal(patterns.frameStep(window,0,-1),0);
  assert.equal(patterns.frameStep(window,.2,10),.2);
  assert.equal(patterns.frameStep({...window,at_end:false},.5,-1),null);
  assert.equal(patterns.frameStep({...window,at_start:false},0,-1),null);
  assert.equal(patterns.frameStep({...window,at_end:false},.2,1),null);
});

test('hot zone applies only to middle plays across phase boundaries',()=>{
  const clip={scene_id:'1',start:10,end:20,hot_zone:{start:14,end:16},phases:patterns.presets['3-2-3']};
  const passes=patterns.expand([clip]);
  assert.deepEqual(passes.map(p=>[p.start,p.end]),[[10,20],[14,16],[14,16],[14,16],[14,16],[14,16],[14,16],[10,20]]);
  assert.deepEqual(passes.map(p=>p.speed),[1,1,1,.5,.5,1,1,1]);
  assert.deepEqual(passes.map(p=>p.cacheOffset),[0,4,4,4,4,4,4,0]);
  assert.deepEqual(patterns.phaseDurations(clip),[14,8,14]);
  assert.equal(patterns.duration(clip),36);
  assert.equal(passes.at(-1).timelineEnd,36);
  assert.deepEqual(patterns.locate(passes,15),{index:3,offset:.5});
  assert.equal(patterns.timeline([clip,{start:0,end:2}])[1].start,36);
  const twice=patterns.expand([clip,clip]);
  assert.equal(twice[8].isHotZone,false);
  assert.equal(twice.at(-1).isHotZone,false);
});

test('one or two plays retain full range, and disabling hot zone restores old timing',()=>{
  for(const repeats of [1,2]){
    const clip={start:10,end:20,hot_zone:{start:14,end:16},phases:[{repeat:repeats,speed:.5}]};
    assert.equal(patterns.duration(clip),20*repeats);
    assert.ok(patterns.expand([clip]).every(p=>p.start===10&&p.end===20&&!p.isHotZone));
  }
  const clip={start:10,end:20,hot_zone:null,phases:patterns.presets['3-2-3']};
  assert.equal(patterns.duration(clip),100);
});

test('hot zones survive independent clipboard and catalog copies; invalid zones are rejected',()=>{
  const clip={scene_id:'1',marker_id:'2',title:'Hot',start:10,end:20,hot_zone:{start:14,end:16},phases:patterns.presets['3-2-3']};
  const copy=patterns.decodeClip(patterns.encodeClip(clip));
  assert.deepEqual(copy.hot_zone,clip.hot_zone);
  copy.hot_zone.start=15;
  assert.equal(clip.hot_zone.start,14);
  assert.deepEqual(patterns.catalog({clips:[clip]})[0].hot_zone,clip.hot_zone);
  for(const zone of [{start:9,end:16},{start:14,end:21},{start:16,end:14},{start:14,end:14},{start:null,end:16}]){
    assert.equal(patterns.decodeClip(patterns.encodeClip({...clip,hot_zone:zone})),null);
  }
});

test('explicit repetition ranges override first and last and keep duration, seeking and copies consistent',()=>{
  const clip={scene_id:'1',start:10,end:20,hot_zone:{start:12,end:14},phases:[{repeat:3,speed:.5,ranges:['hot','full','hot']}]};
  const passes=patterns.expand([clip]);
  assert.deepEqual(passes.map(p=>p.isHotZone),[true,false,true]);
  assert.deepEqual(passes.map(p=>p.cacheOffset),[2,0,2]);
  assert.equal(patterns.duration(clip),28);
  assert.equal(passes.at(-1).timelineEnd,28);
  assert.deepEqual(patterns.locate(passes,5),{index:1,offset:.5});
  const copy=patterns.decodeClip(patterns.encodeClip(clip));
  assert.deepEqual(copy.phases,clip.phases);
  const inserted=patterns.insertClip([],clip,0)[0];
  inserted.phases[0].ranges[0]='full';
  assert.equal(clip.phases[0].ranges[0],'hot');
  assert.equal(patterns.duration({...clip,hot_zone:undefined}),60);
  for(const ranges of [['hot'],['bad','full','hot'],null])assert.equal(patterns.decodeClip(patterns.encodeClip({...clip,phases:[{repeat:3,speed:1,ranges}]})),null);
});
test('auto ranges preserve legacy rules alongside explicit choices across phases',()=>{
  const clip={start:0,end:10,hot_zone:{start:2,end:3},phases:[{repeat:2,speed:1,ranges:['hot','auto']},{repeat:2,speed:1,ranges:['full','auto']}]};
  assert.deepEqual(patterns.expand([clip]).map(p=>p.isHotZone),[true,true,false,false]);
  assert.equal(patterns.duration(clip),22);
});
test('multiple hot zones play chronologically within each repetition, including cached offsets',()=>{
  const clip={scene_id:'1',start:10,end:30,hot_zones:[{start:22,end:25},{start:12,end:14}],phases:[{repeat:2,speed:.5,ranges:['hot','full']},{repeat:1,speed:1,ranges:['hot']}]};
  const passes=patterns.expand([clip]);
  assert.deepEqual(passes.map(p=>[p.start,p.end,p.speed]),[[12,14,.5],[22,25,.5],[10,30,.5],[12,14,1],[22,25,1]]);
  assert.deepEqual(passes.map(p=>p.cacheOffset),[2,12,0,2,12]);
  assert.deepEqual(passes.map(p=>p.repeatIndex),[0,0,1,0,0]);
  assert.equal(patterns.duration(clip),55);
  assert.equal(passes.at(-1).timelineEnd,55);
  assert.deepEqual(patterns.locate(passes,4),{index:1,offset:0});
  const copy=patterns.decodeClip(patterns.encodeClip(clip));
  assert.deepEqual(copy.hot_zones,clip.hot_zones);
  const inserted=patterns.insertClip([],clip,0)[0];inserted.hot_zones[0].start=23;
  assert.equal(clip.hot_zones[0].start,22);
  assert.equal(patterns.duration({...clip,hot_zones:[]}),100);
});
test('zone validation rejects overlap and invalid ranges; adding uses a free gap',()=>{
  const clip={start:0,end:10,hot_zone:{start:2,end:4}};
  assert.deepEqual(patterns.hotZones(clip),[{start:2,end:4}]);
  assert.deepEqual(patterns.newHotZone(clip,5),{start:5,end:6});
  assert.equal(patterns.newHotZone({...clip,hot_zones:[{start:0,end:10}]},5),null);
  for(const hot_zones of [null,[null],[{start:2,end:4},{start:3,end:5}],[{start:-1,end:2}],[{start:9,end:11}]])assert.equal(patterns.validHotZone({...clip,hot_zones}),false);
  assert.equal(patterns.validHotZone({...clip,hot_zones:[{start:2,end:4},{start:4,end:5}]}),true);
});
