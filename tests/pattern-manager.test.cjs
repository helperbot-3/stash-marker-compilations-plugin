const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Exercise the actual manager's event handlers with a minimal hook renderer.
function manager(items, onSave) {
  const source=fs.readFileSync(require.resolve('../plugins/marker-compilations/ui/compilations.js'),'utf8');
  const component=source.slice(source.indexOf('  function PatternManager('),source.indexOf('  function Inspector('));
  const state=[];let cursor=0;
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)});
  const context={RepetitionRanges:'ranges',resizePhase:(p,repeat)=>({...p,repeat}),Set,Field:'field',h,useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},button:(text,onClick,disabled,props)=>h('button',{onClick,disabled,...props},text)};
  vm.createContext(context);
  const render=vm.runInContext(component+';PatternManager',context);
  const nodes=tree=>[tree,...tree.children.filter(x=>x&&typeof x==='object').flatMap(nodes)];
  return {find(predicate){cursor=0;return nodes(render({initial:[{repeat:1,speed:1}],items,onSave,onDelete:async()=>{}})).find(predicate);}};
}
test('Save as new persists edited phases immediately without updating the original',async()=>{
  const original={id:'a',revision:2,name:'Focus',phases:[{repeat:2,speed:1}]};
  const items=[original,{id:'b',name:'Focus copy',phases:[]}];
  const saved=[];
  const ui=manager(items,async value=>{saved.push(JSON.parse(JSON.stringify(value)));return {...value,id:'new',revision:1};});
  ui.find(n=>n.type==='select').props.onChange({target:{value:'a'}});
  ui.find(n=>n.props['aria-label']==='Pattern phase 1 repeats').props.onChange({target:{value:'5'}});
  await ui.find(n=>n.type==='button'&&n.children[0]==='Save as new').props.onClick();
  assert.deepEqual(saved,[{name:'Focus copy 2',phases:[{repeat:5,speed:1}]}]);
  assert.equal(original.phases[0].repeat,2);
  assert.equal(ui.find(n=>n.type==='select').props.value,'new');
});
test('Save pattern passes the draft rather than the click event and exposes errors',async()=>{
  const saved=[];
  const ui=manager([],async value=>{saved.push(JSON.parse(JSON.stringify(value)));throw new Error('Save failed');});
  ui.find(n=>n.type==='input'&&n.props.type==='text').props.onChange({target:{value:'Test'}});
  await ui.find(n=>n.type==='button'&&n.children[0]==='Save pattern').props.onClick({type:'click'});
  assert.deepEqual(saved,[{name:'Test',phases:[{repeat:1,speed:1}]}]);
  assert.equal(ui.find(n=>n.props.role==='alert').children[0],'Save failed');
});
test('range controls toggle individual plays and resize preserves earlier choices',()=>{
  const source=fs.readFileSync(require.resolve('../plugins/marker-compilations/ui/compilations.js'),'utf8');
  const context={patterns:require('../plugins/marker-compilations/ui/patterns.js'),h:(type,props,...children)=>({type,props,children:children.flat(Infinity)}),button:(text,onClick,disabled,props)=>({text,onClick,disabled,props})};
  vm.createContext(context);
  const api=vm.runInContext(source.slice(source.indexOf('  function resizePhase('),source.indexOf('  function PatternManager('))+';({resizePhase,RepetitionRanges})',context);
  const sequence=[{repeat:3,speed:1}];let changed;
  const tree=api.RepetitionRanges({sequence,onChange:p=>changed=p,disabled:false});
  tree.children[1].children[0].onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(changed[0].ranges)),['hot','auto','auto']);
  assert.equal(sequence[0].ranges,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(api.resizePhase(changed[0],4).ranges)),['hot','auto','auto','auto']);
  assert.deepEqual(JSON.parse(JSON.stringify(api.resizePhase(changed[0],1).ranges)),['hot']);
});
