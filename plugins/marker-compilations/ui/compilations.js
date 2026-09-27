(function () {
  'use strict';
  const api = window.PluginApi;
  if (!api) return;
  const patterns = window.MarkerCompilationPatterns;
  const React = api.React, h = React.createElement;
  const {useState, useEffect, useRef} = React;
  const {gql, useApolloClient} = api.libraries.Apollo;
  const Link = api.libraries.ReactRouterDOM.Link;
  const OP = gql`mutation CompilationOperation($args:Map!){runPluginOperation(plugin_id:"marker-compilations",args:$args)}`;
  const TASK = gql`mutation CompilationGenerate($args:Map!){runPluginTask(plugin_id:"marker-compilations",task_name:"Generate compilation clips",args_map:$args)}`;
  const MARKERS = gql`query CompilationMarkers($filter:FindFilterType,$markers:SceneMarkerFilterType){findSceneMarkers(filter:$filter,scene_marker_filter:$markers){count scene_markers{id title seconds end_seconds screenshot primary_tag{id name} tags{id name} scene{id title files{duration}}}}}`;
  const TAGS = gql`query CompilationTags{findTags(filter:{per_page:-1,sort:"name",direction:ASC}){tags{id name}}}`;
  const JOB = gql`query CompilationJob($id:ID!){findJob(input:{id:$id}){id status progress error}}`;
  const blank = () => ({name:'Untitled compilation',clips:[],width:1280,audio:true});
  const time = seconds => {const s = Math.max(0, seconds || 0); return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');};
  const button = (text, onClick, disabled, props) => h('button', Object.assign({type:'button',onClick,disabled:!!disabled},props),text);
  function Field({label,children}) {return h('label',{className:'mc-field'},h('span',null,label),children);}

  function Player({clips,mode,onClose}) {
    const [index,setIndex] = useState(0), [error,setError] = useState(''), [sourceIndex,setSourceIndex] = useState(0);
    const video = useRef(null), advancing = useRef(false);
    const clip = clips[index];
    const cached = mode === 'cache';
    const streams = (clip.streams || []).filter(s => !/mpegurl|dash/i.test(s.mime_type || ''));
    const url = cached ? (clip.cached ? new URL('plugin/marker-compilations/assets/cache/'+clip.cached,document.baseURI).href : '') : (streams[sourceIndex] || {}).url;
    const start = cached ? 0 : clip.start, end = cached ? clip.end-clip.start : clip.end;
    function go(next) {
      if (advancing.current) return;
      advancing.current = true;
      if (next >= clips.length) {video.current.pause(); setError('Compilation finished.'); return;}
      setError(''); if(clips[next].scene_id!==clip.scene_id)setSourceIndex(0); setIndex(next);
    }
    useEffect(() => {advancing.current=false; if(video.current.readyState>=1 && url)ready(); setError(clip.error || (!url ? (cached ? 'This clip has not been cached. Generate clips or use source playback.' : 'No browser-compatible stream is available.') : ''));},[index,url]);
    useEffect(() => {
      const player = video.current;
      let frame;
      function tick() {
        if (!player.paused && player.currentTime >= end) go(index+1);
        frame = requestAnimationFrame(tick);
      }
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    },[index,end]);
    function ready() {
      advancing.current=false;
      video.current.currentTime=start;
      video.current.playbackRate=clip.speed || 1;
      video.current.preservesPitch=true;
      video.current.play().catch(() => setError('Press play to begin playback.'));
    }
    return h('section',{className:'mc-player','aria-label':'Compilation player'},
      h('div',{className:'mc-toolbar'},h('strong',null,(index+1)+' / '+clips.length+' · '+clip.title+' · '+(clip.speed||1)+'× speed · repeat '+(clip.repeatIndex+1)+'/'+clip.repeatCount),button('Close player',onClose)),
      h('video',{key:url,ref:video,src:url || undefined,controls:true,playsInline:true,preload:'auto',onLoadedMetadata:ready,
        onPlay:()=>{if(video.current.currentTime>=end){advancing.current=false;video.current.currentTime=start;setError('');}},
        onTimeUpdate:() => {if(video.current.currentTime>=end) go(index+1);},
        onSeeking:() => {if(video.current.currentTime<start) video.current.currentTime=start; if(video.current.currentTime>=end) go(index+1);},
        onEnded:() => {if(video.current.currentTime>=end-.02)go(index+1);},onError:() => setError('Playback failed. Try another source stream or generate cached clips.')}),
      error && h('p',{role:'status'},error),
      h('div',{className:'mc-toolbar'},button('Previous',() => {advancing.current=false; go(index-1);},index===0),
        h('span',null,time(clip.start)+' – '+time(clip.end)),
        !cached && h('select',{'aria-label':'Source stream',value:sourceIndex,onChange:e=>{advancing.current=false;setSourceIndex(Number(e.target.value));}},streams.map((s,i)=>h('option',{key:i,value:i},s.label || s.mime_type || 'Source '+(i+1)))),
        button('Next',()=>{advancing.current=false;go(index+1);},index===clips.length-1)));
  }

  function Page() {
    const client = useApolloClient();
    const [documents,setDocuments] = useState([]), [doc,setDoc] = useState(blank), [dirty,setDirty] = useState(false);
    const [markers,setMarkers] = useState([]), [tags,setTags] = useState([]), [query,setQuery] = useState(''), [tag,setTag] = useState('');
    const [page,setPage] = useState(1), [count,setCount] = useState(0), [defaultDuration,setDefaultDuration] = useState(20);
    const [busy,setBusy] = useState(false), [loading,setLoading] = useState(false), [message,setMessage] = useState(''), [player,setPlayer] = useState(null);
    const [defaultPattern,setDefaultPattern] = useState('once');
    const [job,setJob] = useState(null), [jobStatus,setJobStatus] = useState('');
    const request = useRef(0);
    async function op(args) {const r=await client.mutate({mutation:OP,variables:{args}});return r.data.runPluginOperation;}
    async function load() {setDocuments(await op({action:'list'}));}
    useEffect(()=>{load().catch(e=>setMessage(e.message));client.query({query:TAGS}).then(r=>setTags(r.data.findTags.tags)).catch(e=>setMessage(e.message));},[]);
    useEffect(()=>{
      const current=++request.current; setLoading(true);
      const timer=setTimeout(()=>{
        client.query({query:MARKERS,variables:{filter:{q:query,page,per_page:24,sort:'title',direction:'ASC'},markers:tag?{tags:{value:[tag],modifier:'INCLUDES'}}:{}},fetchPolicy:'network-only'})
          .then(r=>{if(current===request.current){setMarkers(r.data.findSceneMarkers.scene_markers);setCount(r.data.findSceneMarkers.count);}})
          .catch(e=>{if(current===request.current)setMessage(e.message);})
          .finally(()=>{if(current===request.current)setLoading(false);});
      },250);
      return ()=>{clearTimeout(timer); request.current++;};
    },[query,tag,page]);
    useEffect(()=>{
      if(!dirty)return;
      const handler=e=>{e.preventDefault();e.returnValue='';};
      window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);
    },[dirty]);
    useEffect(()=>{
      if(!job)return;
      let disposed=false;
      async function poll(){try{
        const r=await client.query({query:JOB,variables:{id:job},fetchPolicy:'network-only'});
        if(disposed)return;
        const j=r.data.findJob;
        if(!j){setJobStatus('Job no longer available. Check Stash Tasks.');setJob(null);return;}
        setJobStatus(j.status+(j.progress!=null?' · '+Math.round(j.progress*100)+'%':''));
        if(['FINISHED','FAILED','CANCELLED'].includes(j.status)){setMessage(j.error || (j.status==='FINISHED'?'Full-duration clips are ready.':'Generation '+j.status.toLowerCase()+'.'));setJob(null);}
      }catch(e){if(!disposed)setJobStatus('Could not refresh generation status: '+e.message);}}
      poll();const timer=setInterval(poll,2000);return()=>{disposed=true;clearInterval(timer);};
    },[job]);
    function edit(patch){setDoc(d=>Object.assign({},d,patch));setDirty(true);setPlayer(null);}
    function choose(next){if(dirty&&!window.confirm('Discard unsaved changes?'))return;setDoc(next);setDirty(false);setPlayer(null);setMessage('');}
    async function perform(work){setBusy(true);setMessage('');try{await work();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
    async function save(){const saved=await op({action:'save',document:doc});setDoc(saved);setDirty(false);await load();return saved;}
    function add(marker){
      const duration=Number(defaultDuration),start=marker.seconds;
      if(!(duration>0&&Number.isFinite(duration))){setMessage('Default duration must be positive.');return;}
      const sourceDuration=(marker.scene.files[0]||{}).duration;
      const end=marker.end_seconds>start?marker.end_seconds:Math.min(start+duration,sourceDuration || Infinity);
      if(!(end>start)){setMessage('This marker has no playable interval.');return;}
      edit({clips:doc.clips.concat({marker_id:marker.id,scene_id:marker.scene.id,title:marker.title || marker.primary_tag.name,start,end,phases:patterns.presets[defaultPattern].map(p=>({...p}))})});
    }
    function changeClip(index,patch){edit({clips:doc.clips.map((c,i)=>i===index?Object.assign({},c,patch):c)});}
    function move(index,delta){const clips=doc.clips.slice();[clips[index],clips[index+delta]]=[clips[index+delta],clips[index]];edit({clips});}
    async function play(mode){
      const saved=dirty||!doc.id?await save():doc;
      const resolved=await op({action:'resolve',id:saved.id});
      const bad=resolved.clips.find(c=>c.error || (mode==='cache'&&!c.cached));
      if(bad)throw Error(bad.error || 'Generate clips first; one or more clips are missing or outdated.');
      if(mode==='source') {
        const byScene = new Map();
        for(const clip of resolved.clips) {
          if(!byScene.has(clip.scene_id)) {
            const response=await client.query({query:gql`query CompilationStreams($id:ID!){findScene(id:$id){sceneStreams{url mime_type label}}}`,variables:{id:clip.scene_id},fetchPolicy:'network-only'});
            if(!response.data.findScene)throw Error('Source scene no longer exists.');
            byScene.set(clip.scene_id,response.data.findScene.sceneStreams);
          }
          clip.streams=byScene.get(clip.scene_id);
        }
      }
      setPlayer({clips:patterns.expand(resolved.clips),mode,key:Date.now()});
    }
    const total=doc.clips.reduce((s,c)=>s+patterns.duration(c),0);
    return h('main',{className:'mc'},
      h(api.libraries.ReactRouterDOM.Prompt,{when:dirty,message:'Discard unsaved compilation changes?'}),
      h('header',{className:'mc-heading'},h('div',null,h('p',{className:'mc-eyebrow'},'YOUR LIBRARY · YOUR SEQUENCE'),h('h1',null,'Marker compilations'),h('p',null,'Collect the moments. Set the order. Press play.')),
        h('div',{className:'mc-total'},h('strong',null,time(total)),h('span',null,doc.clips.length+' clips · including repeats'))),
      message&&h('div',{className:'mc-notice',role:'status'},message),
      h('div',{className:'mc-toolbar'},h('select',{'aria-label':'Saved compilations',value:doc.id||'',disabled:busy,onChange:e=>choose(documents.find(d=>d.id===e.target.value)||blank())},h('option',{value:''},'New compilation'),documents.map(d=>h('option',{key:d.id,value:d.id},d.name))),
        button('New',()=>choose(blank()),busy),button('Reload saved list',()=>perform(async()=>{
          if(dirty&&!window.confirm('Discard unsaved changes and reload?'))return;
          const latest=await op({action:'list'});setDocuments(latest);
          if(doc.id){setDoc(latest.find(d=>d.id===doc.id)||blank());setDirty(false);setPlayer(null);}
        }),busy)),
      h('div',{className:'mc-layout'},
        h('section',{className:'mc-browser'},h('h2',null,'Find markers'),
          h(Field,{label:'Search markers'},h('input',{type:'search',value:query,onChange:e=>{setQuery(e.target.value);setPage(1);}})),
          h(Field,{label:'Topic / tag'},h('select',{value:tag,onChange:e=>{setTag(e.target.value);setPage(1);}},h('option',{value:''},'All tags'),tags.map(t=>h('option',{key:t.id,value:t.id},t.name)))),
          h(Field,{label:'Duration when an end is missing (seconds)'},h('input',{type:'number',min:.1,step:.1,value:defaultDuration,onChange:e=>setDefaultDuration(e.target.value)})),
          h(Field,{label:'Pattern for newly added clips'},h('select',{value:defaultPattern,onChange:e=>setDefaultPattern(e.target.value)},
            h('option',{value:'once'},'Once at normal speed'),h('option',{value:'3-2-3'},'3 normal → 2 half-speed → 3 normal'),h('option',{value:'2-2-2'},'2 normal → 2 half-speed → 2 normal'))),
          button('Apply pattern to all clips',()=>edit({clips:doc.clips.map(c=>({...c,phases:patterns.presets[defaultPattern].map(p=>({...p}))}))}),busy||!doc.clips.length),
          h('p',{className:'mc-muted',role:'status'},loading?'Loading markers…':count+' markers'),
          h('div',{className:'mc-markers'},markers.map(m=>h('article',{key:m.id,className:'mc-marker'},
            h('img',{src:m.screenshot,alt:'',loading:'lazy'}),h('div',null,h('strong',null,m.title||m.primary_tag.name),h('p',null,m.scene.title||'Scene '+m.scene.id),h('small',null,time(m.seconds)+' → '+(m.end_seconds>m.seconds?time(m.end_seconds):'default duration'))),button('Add',()=>add(m),busy,{'aria-label':'Add '+(m.title||m.primary_tag.name)})))),
          h('div',{className:'mc-toolbar'},button('Previous page',()=>setPage(page-1),page===1||loading),h('span',null,'Page '+page),button('Next page',()=>setPage(page+1),page*24>=count||loading))),
        h('section',{className:'mc-editor'},h('h2',null,'Your sequence'),
          h(Field,{label:'Compilation name'+(dirty?' · unsaved':'')},h('input',{value:doc.name,maxLength:200,disabled:busy,onChange:e=>edit({name:e.target.value})})),
          h('div',{className:'mc-toolbar'},button('Save',()=>perform(async()=>{await save();setMessage('Compilation saved.');}),busy),
            button('Play sources',()=>perform(()=>play('source')),busy||!doc.clips.length),button('Play cached clips',()=>perform(()=>play('cache')),busy||!doc.clips.length)),
          player&&h(Player,{key:player.key,clips:player.clips,mode:player.mode,onClose:()=>setPlayer(null)}),
          !doc.clips.length&&h('div',{className:'mc-empty'},h('strong',null,'A compilation starts with one moment.'),h('p',null,'Add markers from the left, then arrange and trim them here.')),
          h('ol',{className:'mc-sequence'},doc.clips.map((c,i)=>h('li',{key:i},
            h('div',{className:'mc-clip-heading'},h('span',{className:'mc-index'},String(i+1).padStart(2,'0')),h(Link,{to:'/scenes/'+c.scene_id},c.title),h('small',null,time(patterns.duration(c))+' with repeats')),
            h('div',{className:'mc-trim'},h(Field,{label:'Start (seconds)'},h('input',{type:'number',min:0,step:.1,value:c.start,disabled:busy,onChange:e=>changeClip(i,{start:e.target.value===''?'':Number(e.target.value)})})),
              h(Field,{label:'End (seconds)'},h('input',{type:'number',min:0,step:.1,value:c.end,disabled:busy,onChange:e=>changeClip(i,{end:e.target.value===''?'':Number(e.target.value)})}))),
            h('fieldset',{className:'mc-pattern'},h('legend',null,'Repeat & speed pattern'),
              h('div',{className:'mc-toolbar'},button('Once',()=>changeClip(i,{phases:patterns.presets.once.map(p=>({...p}))}),busy),
                button('3 normal / 2 slow / 3 normal',()=>changeClip(i,{phases:patterns.presets['3-2-3'].map(p=>({...p}))}),busy)),
              patterns.phases(c).map((phase,n)=>h('div',{className:'mc-phase',key:n},h('span',null,(n+1)+'.'),
                h(Field,{label:'Repeats'},h('input',{'aria-label':'Clip '+(i+1)+' phase '+(n+1)+' repeats',type:'number',min:1,max:20,step:1,value:phase.repeat,disabled:busy,onChange:e=>changeClip(i,{phases:patterns.phases(c).map((p,j)=>j===n?{...p,repeat:e.target.value===''?'':Number(e.target.value)}:p)})})),
                h(Field,{label:'Speed'},h('select',{'aria-label':'Clip '+(i+1)+' phase '+(n+1)+' speed',value:phase.speed,disabled:busy,onChange:e=>changeClip(i,{phases:patterns.phases(c).map((p,j)=>j===n?{...p,speed:Number(e.target.value)}:p)})},[.25,.5,.75,1,1.25,1.5,2,3].map(rate=>h('option',{key:rate,value:rate},rate+'×'+(rate===1?' normal':''))))),
                button('Remove phase',()=>changeClip(i,{phases:patterns.phases(c).filter((_,j)=>j!==n)}),busy||patterns.phases(c).length===1))),
              button('Add phase',()=>changeClip(i,{phases:patterns.phases(c).concat({repeat:1,speed:1})}),busy||patterns.phases(c).length>=10)),
            h('div',{className:'mc-toolbar'},button('↑',()=>move(i,-1),busy||i===0,{'aria-label':'Move clip '+(i+1)+' up'}),button('↓',()=>move(i,1),busy||i===doc.clips.length-1,{'aria-label':'Move clip '+(i+1)+' down'}),button('Remove',()=>edit({clips:doc.clips.filter((_,n)=>n!==i)}),busy))))),
          h('details',{className:'mc-cache'},h('summary',null,'Full-duration clip cache'),h('p',null,'Generate each interval once and reuse it across compilations. Stash’s built-in previews stay untouched.'),
            h(Field,{label:'Maximum clip width'},h('select',{value:doc.width,disabled:busy,onChange:e=>edit({width:Number(e.target.value)})},[640,1280,1920].map(w=>h('option',{key:w,value:w},w+' px')))),
            h('label',null,h('input',{type:'checkbox',checked:doc.audio,disabled:busy,onChange:e=>edit({audio:e.target.checked})}),' Include audio'),
            h('div',{className:'mc-toolbar'},button('Generate clips',()=>perform(async()=>{const saved=await save();const r=await client.mutate({mutation:TASK,variables:{args:{action:'generate',id:saved.id}}});setJob(r.data.runPluginTask);setJobStatus('Queued');}),busy||!!job||!doc.clips.length),
              job&&button('Cancel generation',()=>perform(async()=>{await client.mutate({mutation:gql`mutation($id:ID!){stopJob(job_id:$id)}`,variables:{id:job}});}),busy)),h('p',{role:'status'},jobStatus)),
          doc.id&&button('Delete compilation',()=>{if(window.confirm('Delete this saved compilation? Source videos and markers will be kept.'))perform(async()=>{await op({action:'delete',id:doc.id,revision:doc.revision});setDoc(blank());setDirty(false);setPlayer(null);await load();});},busy,{className:'mc-delete'})
        )
      )
    );
  }
  api.register.route('/marker-compilations',Page);
  api.patch.before('SettingsToolsSection',props=>[{...props,children:h(React.Fragment,null,props.children,h(api.components.Setting,{heading:h(Link,{to:'/marker-compilations'},'Open Marker Compilations')}))}]);
})();
