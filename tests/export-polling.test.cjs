const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('node:fs').readFileSync(require.resolve('../plugins/marker-compilations/ui/compilations.js'),'utf8');
function setup(fetch){
  let timer=null;const updates=[],errors=[];
  const poll=vm.runInNewContext(source.slice(source.indexOf('  function pollActiveExports('),source.indexOf('  function restoreMarkerPlaybackFocus('))+';pollActiveExports',{
    setTimeout:fn=>{assert.equal(timer,null,'requests must not overlap');timer=fn;return 1;},clearTimeout:()=>timer=null
  });
  const stop=poll(fetch,items=>updates.push(items),e=>errors.push(e));
  return {stop,updates,errors,pending:()=>!!timer,tick:()=>{const fn=timer;timer=null;return fn();}};
}
test('idle, completed and other-compilation exports do not start polling',()=>{
  const effect=source.slice(source.indexOf('    const exportActive='),source.indexOf('    async function openRender('));
  for(const items of [[],[{compilation_id:'a',status:'ready'}],[{compilation_id:'a',status:'failed'}],[{compilation_id:'b',status:'rendering'}]]){
    vm.runInNewContext(effect,{doc:{id:'a'},exports:items,useEffect:fn=>fn(),pollActiveExports:assert.fail});
  }
});
test('polling follows render and import, then stops on completion',async()=>{
  const states=['rendering','importing','ready'];let calls=0;
  const ui=setup(async()=>[{status:states[calls++]}]);
  for(let i=0;i<3;i++)await ui.tick();
  assert.equal(calls,3);assert.equal(ui.pending(),false);assert.equal(ui.updates.length,3);
});
test('slow requests never overlap and switching compilations ignores the late response',async()=>{
  let resolve;const ui=setup(()=>new Promise(r=>resolve=r));
  const pending=ui.tick();assert.equal(ui.pending(),false);ui.stop();resolve([{status:'rendering'}]);await pending;
  assert.equal(ui.updates.length,0);assert.equal(ui.pending(),false);
});
test('active polling retries temporary errors but stops on failure or cancellation',async()=>{
  for(const status of ['failed','cancelled','import_error']){
    let calls=0;const ui=setup(async()=>{if(!calls++)throw Error('Temporary network failure');return [{status}];});
    await ui.tick();assert.equal(ui.errors.length,1);assert.equal(ui.pending(),true);
    await ui.tick();assert.equal(ui.pending(),false);
  }
});
