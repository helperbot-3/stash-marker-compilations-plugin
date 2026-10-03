const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('node:fs').readFileSync(require.resolve('../plugins/marker-compilations/ui/compilations.js'),'utf8');
const code=source.slice(source.indexOf('    async function saveCapturedMarker('),source.indexOf('    async function retryMarker('));
for(const fail of [false,true])test('direct capture '+(fail?'keeps a failed marker available for retry':'publishes once with defaults and updates the saved list'),async()=>{
  const draft={id:'capture',revision:1,title:'Age',primary:'7',clip:{scene_id:'2'}},calls=[];
  let drafts=[draft],scene={scene_markers:[]},message='';
  const save=vm.runInNewContext(code+';saveCapturedMarker',{
    markerOp:async(client,args)=>{calls.push(args);if(fail)throw Error('Offline');return {marker:{id:'10',title:'Age',seconds:1,primary_tag:{id:'7'}}};},client:{},review:{id:'review'},project:'compilation',reviewTarget:{title:'Age'},
    updateDrafts:fn=>{drafts=fn(drafts);},setScene:fn=>{scene=fn(scene);},setMessage:value=>{message=value;},persist:assert.fail
  });
  if(fail){await assert.rejects(save(draft),/Offline/);assert.equal(drafts.length,1);assert.equal(drafts[0]._saving,false);assert.equal(scene.scene_markers.length,0);}
  else{await save(draft);assert.equal(drafts.length,0);assert.equal(scene.scene_markers[0].id,'10');assert.match(message,/Press I/);}
  assert.equal(calls.length,1);assert.equal(calls[0].action,'publish_marker_draft');assert.equal(calls[0].id,'capture');assert.equal(calls[0].mode,'new');assert.equal(calls[0].add_to_timeline,true);assert.equal(calls[0].project_id,'compilation');
});
