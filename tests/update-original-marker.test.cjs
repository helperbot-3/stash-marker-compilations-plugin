const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('node:fs').readFileSync(require.resolve('../plugins/marker-compilations/ui/compilations.js'),'utf8');
const code=source.slice(source.indexOf('    async function updateOriginalMarker('),source.indexOf('    function removeClip('));
test('one-click update waits for pending trim edits and preserves existing marker tags',async()=>{
  const ref={current:{scene_id:'1',marker_id:'2',start:1,end:8,title:'Edited'}},calls=[];
  const marker={id:'2',title:'Original',primary_tag:{id:'3'},tags:[{id:'4'}]};
  let message='';
  const update=vm.runInNewContext(code+';updateOriginalMarker',{
    selectedClipRef:ref,trimControls:{current:{flush:async()=>{ref.current={...ref.current,start:2,hot_zones:[{id:'zone',start:3,end:4}]};}}},
    op:async args=>{calls.push(args);return args.action==='marker_context'?{marker}:{marker:{...marker,title:args.title}};},setMessage:value=>message=value
  });
  await update();
  assert.equal(calls.length,2);assert.equal(calls[1].mode,'update');assert.equal(calls[1].clip.start,2);
  assert.equal(calls[1].clip.hot_zones[0].start,3);assert.equal(calls[1].title,'Edited');
  assert.equal(calls[1].primary_tag_id,'3');assert.equal(calls[1].tag_ids.join(','),'4');assert.equal(calls[1].expected,marker);
  assert.match(message,/Updated original marker/);
});
test('a missing original marker fails without creating a replacement or claiming success',async()=>{
  let calls=0;
  const update=vm.runInNewContext(code+';updateOriginalMarker',{
    selectedClipRef:{current:{scene_id:'1',marker_id:'2'}},trimControls:{current:null},
    op:async()=>{calls++;throw Error('Original marker no longer exists');},setMessage:assert.fail
  });
  await assert.rejects(update(),/no longer exists/);assert.equal(calls,1);
});
