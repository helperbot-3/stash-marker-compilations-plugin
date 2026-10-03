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
  assert.deepEqual(ui.calls,[['second',-1],['second',1],['frame',1],['frame',-1],['mark','start'],['mark','end'],'focus','toggle','save']);
});
test('holding Space or Enter acts once, while held navigation continues stepping',()=>{
  const ui=setup();
  for(const key of [' ','Enter','i','o']){ui.key(ui.event(key));ui.key(ui.event(key,false,{repeat:true}));}
  ui.key(ui.event('ArrowRight',false,{repeat:true}));
  assert.deepEqual(ui.calls,['focus','toggle','focus','save',['mark','start'],['mark','end'],['second',1]]);
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

test('marking after queued frame navigation uses the destination rather than the old decoded frame',async()=>{
  let position=5,releaseStep;const stepped=new Promise(resolve=>{releaseStep=resolve;});
  const marks=[],controls={current:null},queuedNavigation={current:0},navigationGeneration={current:0},inputQueue={current:Promise.resolve()};
  const queue=source.slice(source.indexOf('    function enqueueStep('),source.indexOf('    function stepSecond('));
  const controller=source.slice(source.indexOf('    useEffect(()=>{controls.current={',source.indexOf('  function TrimPreview(')),source.indexOf("    return h('section',{className:'mc-trimmer'"));
  vm.runInNewContext(queue+controller,{
    controls,queuedNavigation,navigationGeneration,inputQueue,useEffect:fn=>fn(),
    navigation:{current:{position:()=>position}},video:{current:{currentTime:5}},
    mark:(which,point)=>marks.push([which,point]),stepFrames:async()=>{await stepped;position=6;},
    setFrameError:assert.fail
  });
  const move=controls.current.frame(1),mark=controls.current.mark('end');
  releaseStep();await move;await mark;
  assert.deepEqual(marks,[['end',6]]);
  assert.equal(queuedNavigation.current,0);
});

test('capture marks survive playback generation changes while navigation is cancelled',async()=>{
  const marks=[],navigationGeneration={current:0},inputQueue={current:Promise.resolve()};
  const queue=source.slice(source.indexOf('    function enqueueStep('),source.indexOf('    function stepSecond('));
  const enqueue=vm.runInNewContext(queue+';enqueueStep',{navigationGeneration,inputQueue,setFrameError:assert.fail});
  const first=enqueue(()=>marks.push('in'),false);
  const stale=enqueue(()=>marks.push('stale seek'));
  navigationGeneration.current++;
  const last=enqueue(()=>marks.push('out'),false);
  await Promise.all([first,stale,last]);
  assert.deepEqual(marks,['in','out']);
});
