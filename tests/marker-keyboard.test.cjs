const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../plugins/marker-compilations/ui/compilations.js'),'utf8');
class Target {
  constructor(editing=false){this.editing=editing;}
  closest(){return this.editing;}
}
function setup(options={}) {
  const calls=[];
  const make=vm.runInNewContext(source.slice(source.indexOf('  function markerKeyboard('),source.indexOf('  function MarkerWorkspace('))+';markerKeyboard',{Element:Target});
  const handlers=make({controls:{current:{toggle:()=>calls.push('toggle'),frame:n=>calls.push(['frame',n]),second:n=>calls.push(['second',n]),mark:n=>calls.push(['mark',n])}},save:()=>calls.push('save'),focus:()=>calls.push('focus'),captured:new Set(),enabled:true,busy:false,...options});
  function event(key,editing=false,extra={}){return {key,target:new Target(editing),preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};}
  return {...handlers,calls,event};
}
test('marker shortcuts work on non-editable controls and suppress their native keyup actions',()=>{
  const ui=setup();
  for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','i','o',' ','Enter']){
    const down=ui.event(key);ui.key(down);assert.ok(down.prevented&&down.stopped);
    const up=ui.event(key);ui.release(up);assert.ok(up.prevented&&up.stopped);
  }
  assert.deepEqual(ui.calls,[['frame',-1],['frame',1],['second',-1],['second',1],['mark','start'],['mark','end'],'toggle','save']);
});
test('holding Space or Enter acts once, while held navigation continues stepping',()=>{
  const ui=setup();
  for(const key of [' ','Enter','i','o']){ui.key(ui.event(key));ui.key(ui.event(key,false,{repeat:true}));}
  ui.key(ui.event('ArrowRight',false,{repeat:true}));
  assert.deepEqual(ui.calls,['toggle','save',['mark','start'],['mark','end'],['frame',1]]);
});
test('typing, dropdown navigation, composition and modified shortcuts stay native; Escape returns focus',()=>{
  const ui=setup();
  for(const key of [' ','i','o','ArrowLeft','Enter']){const e=ui.event(key,true);ui.key(e);assert.ok(!e.prevented);}
  ui.key(ui.event('i',false,{isComposing:true}));ui.key(ui.event('ArrowLeft',false,{altKey:true}));
  assert.deepEqual(ui.calls,[]);
  const escape=ui.event('Escape',true);ui.key(escape);assert.ok(escape.prevented);assert.deepEqual(ui.calls,['focus']);
});
test('seeking preserves playback in marker creation and still pauses in the compilation inspector',async()=>{
  const methods=source.slice(source.indexOf('    async function stepFrames('),source.indexOf('    function enqueueStep('));
  for(const captureWhilePlaying of [true,false]){
    const video={currentTime:5,paused:false,pause(){this.paused=true;}};
    const destinations=[];
    const {seek,stepFrames}=vm.runInNewContext(methods+';({seek,stepFrames})',{
      video:{current:video},ready:true,busy:false,onBeforePlay(){},captureWhilePlaying,limit:{current:10},duration:30,
      navigation:{current:{position:()=>5,request:n=>destinations.push(n)}},navigationGeneration:{current:0},step:1,
      patterns:{frameStep:()=>5.04},frameData:{current:{}},setFrameError:assert.fail
    });
    seek(8);assert.equal(video.paused,!captureWhilePlaying);assert.deepEqual(destinations,[8]);
    video.paused=false;await stepFrames(1);assert.equal(video.paused,!captureWhilePlaying);assert.deepEqual(destinations,[8,5.04]);
  }
});
