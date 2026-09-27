(function () {
  'use strict';
  const api = window.PluginApi;
  if (!api) return;
  const patterns = window.MarkerCompilationPatterns;
  const React = api.React, h = React.createElement;
  const {useState, useEffect, useRef, useCallback} = React;
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

  function Player({clips,mode,seekRequest,onProgress,onActive,onStop}) {
    const initial=patterns.locate(clips,seekRequest.position);
    const [index,setIndex]=useState(initial.index), [sourceIndex,setSourceIndex]=useState(0);
    const [error,setError]=useState(''), [playing,setPlaying]=useState(false), [volume,setVolume]=useState(1);
    const video=useRef(null), advancing=useRef(false), pending=useRef(initial.offset);
    const shouldPlay=useRef(true), finished=useRef(false), activeIndex=useRef(index);
    const clip=clips[index], cached=mode==='cache';
    const streams=(clip.streams||[]).filter(s=>!/mpegurl|dash/i.test(s.mime_type||''));
    const url=cached?(clip.cached?new URL('plugin/marker-compilations/assets/cache/'+clip.cached,document.baseURI).href:''):(streams[sourceIndex]||{}).url;
    const start=cached?0:clip.start, end=cached?clip.end-clip.start:clip.end;
    function report() {
      if(!video.current)return;
      const offset=Math.max(0,Math.min(video.current.currentTime-start,end-start));
      onProgress(clip.timelineStart+offset/clip.speed);
    }
    function ready() {
      const v=video.current;
      if(!v||v.readyState<1||!url)return;
      const offset=pending.current==null?0:pending.current;pending.current=null;
      advancing.current=false;finished.current=false;
      v.currentTime=Math.min(start+offset,end-.001);
      v.playbackRate=clip.speed;v.preservesPitch=true;v.volume=volume;
      if(shouldPlay.current)v.play().catch(e=>{if(e.name!=='AbortError'){setPlaying(false);setError('Press play to begin playback.');}});
      else v.pause();
      onActive(clip.clipIndex);report();
    }
    function go(next) {
      if(advancing.current)return;
      advancing.current=true;
      if(next>=clips.length){finished.current=true;video.current.pause();onProgress(clips[clips.length-1].timelineEnd);setError('Compilation finished.');return;}
      pending.current=0;shouldPlay.current=true;setError('');
      if(clips[next].scene_id!==clip.scene_id)setSourceIndex(0);
      setIndex(next);
    }
    useEffect(()=>{
      setError(!url?(cached?'This clip has not been cached.':'No compatible source stream is available.'): '');
      activeIndex.current=index;onActive(clip.clipIndex);
      ready();
    },[index,url]);
    useEffect(()=>{
      const target=patterns.locate(clips,seekRequest.position);
      pending.current=target.offset;advancing.current=false;finished.current=false;
      shouldPlay.current=seekRequest.play!==false;setError('');
      if(target.index===index)ready();
      else {if(clips[target.index].scene_id!==clip.scene_id)setSourceIndex(0);setIndex(target.index);}
    },[seekRequest.serial]);
    useEffect(()=>{
      let frame,last=0;
      function tick(now){
        const v=video.current;
        if(v&&activeIndex.current===index&&!v.paused){
          if(v.currentTime>=end)go(index+1);
          if(now-last>80){report();last=now;}
        }
        frame=requestAnimationFrame(tick);
      }
      frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
    },[index,end,url]);
    function toggle(){
      const v=video.current;if(!v||!url)return;
      if(v.paused){
        shouldPlay.current=true;
        if(finished.current){pending.current=0;advancing.current=false;finished.current=false;setError('');if(index===0)ready();else setIndex(0);}
        else v.play().catch(()=>setError('Playback could not start. Try another stream.'));
      }else{shouldPlay.current=false;v.pause();}
    }
    const previous=clips.findIndex(p=>p.clipIndex===Math.max(0,clip.clipIndex-1));
    const next=clips.findIndex(p=>p.clipIndex>clip.clipIndex);
    return h(React.Fragment,null,
      h('div',{className:'mc-video-surface'},h('video',{key:url,ref:video,src:url||undefined,playsInline:true,preload:'auto',onLoadedMetadata:ready,
        onPlay:()=>{setPlaying(true);setError('');},onPause:()=>setPlaying(false),onClick:toggle,
        onTimeUpdate:()=>{if(video.current.currentTime>=end)go(index+1);report();},
        onEnded:()=>{if(video.current.currentTime>=end-.02)go(index+1);},
        onError:()=>setError('Playback failed. Choose another source stream or generate cached clips.')}),
        error&&h('div',{className:'mc-player-message',role:'status'},error)),
      h('div',{className:'mc-transport'},
        button('⏮',()=>{advancing.current=false;go(previous);},clip.clipIndex===0,{'aria-label':'Previous clip'}),
        button(playing?'Pause':'Play',toggle,!url,{className:'mc-primary','aria-label':playing?'Pause playback':'Resume playback'}),
        button('⏭',()=>{advancing.current=false;go(next);},next<0,{'aria-label':'Next clip'}),
        button('Stop',onStop,false),
        h('span',{className:'mc-pass',role:'status'},'Pass '+(index+1)+' / '+clips.length+' · '+clip.speed+'× · Repeat '+(clip.repeatIndex+1)+'/'+clip.repeatCount),
        h('label',{className:'mc-volume'},'Volume',h('input',{type:'range',min:0,max:1,step:.05,value:volume,onChange:e=>{const value=Number(e.target.value);setVolume(value);if(video.current)video.current.volume=value;}})),
        !cached&&streams.length>1&&h('select',{'aria-label':'Source stream',value:sourceIndex,onChange:e=>{pending.current=Math.max(0,video.current.currentTime-start);shouldPlay.current=!video.current.paused;setSourceIndex(Number(e.target.value));}},streams.map((s,i)=>h('option',{key:i,value:i},s.label||s.mime_type||'Source '+(i+1))))));
  }

  function Timeline({clips,selected,active,current,busy,onSelect,onSeek,onMove,onAdd}) {
    const scroller=useRef(null), dragIndex=useRef(null);
    const [width,setWidth]=useState(800), [zoom,setZoom]=useState(1), [dropTarget,setDropTarget]=useState(null);
    const entries=patterns.timeline(clips), total=entries.length?entries[entries.length-1].end:0;
    useEffect(()=>{
      const resize=new ResizeObserver(items=>setWidth(items[0].contentRect.width));
      resize.observe(scroller.current);return()=>resize.disconnect();
    },[]);
    const scale=Math.max(.01,(width-40)/Math.max(1,total))*zoom;
    const canvasWidth=Math.max(width,total*scale+40);
    const steps=[.1,.25,.5,1,2,5,10,15,30,60,120,300,600,1800,3600];
    const step=steps.find(s=>s*scale>=85)||Math.ceil(85/scale/3600)*3600;
    const ticks=Array.from({length:Math.min(300,Math.floor(total/step)+1)},(_,i)=>i*step);
    function seek(event){if(busy||!total)return;const rect=event.currentTarget.getBoundingClientRect();onSeek(Math.max(0,Math.min(total,(event.clientX-rect.left)/scale)));}
    function drop(event,to){event.preventDefault();if(dragIndex.current!=null&&!busy)onMove(dragIndex.current,to);dragIndex.current=null;setDropTarget(null);}
    return h('section',{className:'mc-timeline','aria-label':'Compilation timeline'},
      h('div',{className:'mc-panel-heading'},h('div',null,h('h2',null,'Timeline'),h('span',null,clips.length+' clips · '+time(total)+' viewing time')),
        h('div',{className:'mc-inline'},h('label',{className:'mc-zoom'},'Zoom',h('input',{type:'range',min:1,max:8,step:.25,value:zoom,onChange:e=>setZoom(Number(e.target.value))})),button('Fit',()=>setZoom(1),false),button('+ Add markers',onAdd,busy))),
      h('div',{className:'mc-timeline-scroll',ref:scroller},h('div',{className:'mc-timeline-canvas',style:{width:canvasWidth}},
        h('div',{className:'mc-ruler',onClick:seek,'aria-label':'Timeline ruler'},ticks.map(t=>h('span',{key:t,style:{left:t*scale}},time(t)))),
        h('div',{className:'mc-track'},!clips.length?h('div',{className:'mc-timeline-empty'},h('strong',null,'Build your sequence here'),h('p',null,'Add markers, then select a clip to edit its trim and playback pattern.'),button('Add your first marker',onAdd,busy)):
          entries.map(entry=>{const c=clips[entry.index];return h('button',{type:'button',key:entry.index,className:'mc-timeline-clip'+(selected===entry.index?' is-selected':'')+(active===entry.index?' is-playing':'')+(dropTarget===entry.index?' is-drop-target':''),
            style:{left:entry.start*scale,width:Math.max(1,entry.duration*scale)},disabled:busy,draggable:!busy,
            'aria-label':'Clip '+(entry.index+1)+': '+c.title,'aria-pressed':selected===entry.index,
            title:c.title+' · '+time(entry.duration)+' · '+patterns.phases(c).map(p=>p.repeat+' plays at '+p.speed+'×').join(' → '),
            onClick:()=>onSelect(entry.index),onDoubleClick:()=>onSeek(entry.start),
            onKeyDown:e=>{if(e.altKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();const to=entry.index+(e.key==='ArrowLeft'?-1:1);if(to>=0&&to<clips.length)onMove(entry.index,to);}},
            onDragStart:e=>{dragIndex.current=entry.index;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(entry.index));},
            onDragOver:e=>{if(dragIndex.current!=null){e.preventDefault();setDropTarget(entry.index);}},onDrop:e=>drop(e,entry.index),onDragEnd:()=>{dragIndex.current=null;setDropTarget(null);}},
            h('span',{className:'mc-clip-number'},String(entry.index+1).padStart(2,'0')),h('strong',null,c.title),h('small',null,time(entry.duration)),
            h('span',{className:'mc-phase-strip'},patterns.phases(c).map((p,n)=>h('i',{key:n,className:p.speed<1?'is-slow':'',style:{flex:p.repeat/p.speed},title:p.repeat+' × '+p.speed+' speed'}))));})),
        total>0&&h('div',{className:'mc-playhead',style:{left:Math.min(current,total)*scale},'aria-hidden':true},h('span',null)))),
      h('div',{className:'mc-timeline-footer'},h('span',null,'Drag to reorder · Double-click to play · Alt + ← / → to move a focused clip'),
        h('label',{className:'mc-scrub'},'Position',h('input',{'aria-label':'Compilation position',type:'range',min:0,max:total||1,step:.05,value:Math.min(current,total),disabled:busy||!total,onChange:e=>onSeek(Number(e.target.value))})),h('output',null,time(current)+' / '+time(total))));
  }

  function Inspector({clip,index,total,busy,onChange,onMove,onRemove,onPlay,onApplyAll}) {
    if(!clip)return h('aside',{className:'mc-inspector','aria-label':'Clip settings'},h('div',{className:'mc-panel-heading'},h('h2',null,'Inspector')),h('div',{className:'mc-inspector-empty'},h('span',null,'↖'),h('strong',null,'Select a timeline clip'),h('p',null,'Its source range and repeat pattern will appear here.')));
    const phases=patterns.phases(clip);
    const patchPhase=(n,patch)=>onChange({phases:phases.map((p,j)=>j===n?{...p,...patch}:p)});
    return h('aside',{className:'mc-inspector','aria-label':'Clip settings'},
      h('div',{className:'mc-panel-heading'},h('h2',null,'Inspector'),h('span',null,'CLIP '+String(index+1).padStart(2,'0'))),
      h('div',{className:'mc-inspector-content'},h('h3',null,clip.title),h(Link,{to:'/scenes/'+clip.scene_id},'Open source scene ↗'),
        h('div',{className:'mc-trim'},h(Field,{label:'Start (seconds)'},h('input',{type:'number',min:0,step:.1,value:clip.start,disabled:busy,onChange:e=>onChange({start:e.target.value===''?'':Number(e.target.value)})})),
          h(Field,{label:'End (seconds)'},h('input',{type:'number',min:0,step:.1,value:clip.end,disabled:busy,onChange:e=>onChange({end:e.target.value===''?'':Number(e.target.value)})}))),
        h('p',{className:'mc-clip-duration'},time(Math.max(0,clip.end-clip.start))+' source · '+time(patterns.duration(clip))+' with repeats'),
        h('fieldset',{className:'mc-pattern'},h('legend',null,'Repeat & speed'),
          h(Field,{label:'Apply a preset'},h('select',{value:'',disabled:busy,onChange:e=>{if(e.target.value)onChange({phases:patterns.presets[e.target.value].map(p=>({...p}))});}},
            h('option',{value:''},'Choose a pattern…'),h('option',{value:'once'},'Once at normal speed'),h('option',{value:'3-2-3'},'3 normal → 2 slow → 3 normal'),h('option',{value:'2-2-2'},'2 normal → 2 slow → 2 normal'))),
          phases.map((phase,n)=>h('div',{className:'mc-phase',key:n},h('span',{className:'mc-phase-index'},n+1),
            h(Field,{label:'Repeats'},h('input',{'aria-label':'Phase '+(n+1)+' repeats',type:'number',min:1,max:20,step:1,value:phase.repeat,disabled:busy,onChange:e=>patchPhase(n,{repeat:e.target.value===''?'':Number(e.target.value)})})),
            h(Field,{label:'Speed'},h('select',{'aria-label':'Phase '+(n+1)+' speed',value:phase.speed,disabled:busy,onChange:e=>patchPhase(n,{speed:Number(e.target.value)})},[.25,.5,.75,1,1.25,1.5,2,3].map(rate=>h('option',{key:rate,value:rate},rate+'×'+(rate===1?' normal':''))))),
            button('×',()=>onChange({phases:phases.filter((_,j)=>j!==n)}),busy||phases.length===1,{'aria-label':'Remove phase '+(n+1),className:'mc-icon-button'}))),
          button('+ Add phase',()=>onChange({phases:phases.concat({repeat:1,speed:1})}),busy||phases.length>=10),
          button('Use this pattern for all clips',onApplyAll,busy,{className:'mc-apply-pattern'})),
        h('div',{className:'mc-inspector-actions'},button('Play from this clip',onPlay,busy,{className:'mc-primary'}),
          h('div',{className:'mc-inline'},button('← Earlier',()=>onMove(index,index-1),busy||index===0),button('Later →',()=>onMove(index,index+1),busy||index===total-1)),
          button('Remove clip',onRemove,busy,{className:'mc-danger'}))));
  }

  function Page() {
    const client=useApolloClient(), Modal=api.libraries.Bootstrap.Modal;
    const [documents,setDocuments]=useState([]), [doc,setDoc]=useState(blank), [dirty,setDirty]=useState(false);
    const [selected,setSelected]=useState(null), [active,setActive]=useState(null), [current,setCurrent]=useState(0);
    const [modal,setModal]=useState(null), [mode,setMode]=useState('source'), [poster,setPoster]=useState('');
    const [markers,setMarkers]=useState([]), [tags,setTags]=useState([]), [query,setQuery]=useState(''), [tag,setTag]=useState('');
    const [page,setPage]=useState(1), [count,setCount]=useState(0), [defaultDuration,setDefaultDuration]=useState(20), [defaultPattern,setDefaultPattern]=useState('once');
    const [busy,setBusy]=useState(false), [loading,setLoading]=useState(false), [message,setMessage]=useState(''), [player,setPlayer]=useState(null);
    const [job,setJob]=useState(null), [jobStatus,setJobStatus]=useState(''), [fullscreen,setFullscreen]=useState(false);
    const [seekRequest,setSeekRequest]=useState({position:0,serial:0,play:true});
    const request=useRef(0), monitor=useRef(null), serial=useRef(0);
    const clip=selected==null?null:doc.clips[selected], entries=patterns.timeline(doc.clips);
    const total=entries.length?entries[entries.length-1].end:0;
    const progress=useCallback(position=>setCurrent(position),[]), activate=useCallback(index=>setActive(index),[]);
    async function op(args){const r=await client.mutate({mutation:OP,variables:{args}});return r.data.runPluginOperation;}
    async function load(){setDocuments(await op({action:'list'}));}
    useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);
    useEffect(()=>{
      if(modal!=='markers')return;
      client.query({query:TAGS}).then(r=>setTags(r.data.findTags.tags)).catch(e=>setMessage(e.message));
    },[modal]);
    useEffect(()=>{
      if(modal!=='markers')return;
      const id=++request.current;setLoading(true);
      const timer=setTimeout(()=>{
        client.query({query:MARKERS,variables:{filter:{q:query,page,per_page:24,sort:'title',direction:'ASC'},markers:tag?{tags:{value:[tag],modifier:'INCLUDES'}}:{}},fetchPolicy:'network-only'})
          .then(r=>{if(id===request.current){setMarkers(r.data.findSceneMarkers.scene_markers);setCount(r.data.findSceneMarkers.count);}})
          .catch(e=>{if(id===request.current)setMessage(e.message);})
          .finally(()=>{if(id===request.current)setLoading(false);});
      },250);
      return()=>{clearTimeout(timer);request.current++;};
    },[query,tag,page,modal]);
    useEffect(()=>{
      if(!dirty)return;const handler=e=>{e.preventDefault();e.returnValue='';};
      window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);
    },[dirty]);
    useEffect(()=>{
      const handler=()=>setFullscreen(document.fullscreenElement===monitor.current);
      document.addEventListener('fullscreenchange',handler);return()=>document.removeEventListener('fullscreenchange',handler);
    },[]);
    useEffect(()=>{
      setPoster('');if(!clip||player)return;
      let disposed=false;
      client.query({query:gql`query CompilationPoster($id:ID!){findScene(id:$id){paths{screenshot}}}`,variables:{id:clip.scene_id}})
        .then(r=>{if(!disposed)setPoster(r.data.findScene?.paths.screenshot||'');}).catch(()=>{});
      return()=>{disposed=true;};
    },[clip?.scene_id,!!player]);
    useEffect(()=>{
      if(!job)return;let disposed=false;
      async function poll(){try{
        const r=await client.query({query:JOB,variables:{id:job},fetchPolicy:'network-only'});if(disposed)return;
        const j=r.data.findJob;
        if(!j){setJobStatus('Job no longer available. Check Stash Tasks.');setJob(null);return;}
        setJobStatus(j.status+(j.progress!=null?' · '+Math.round(j.progress*100)+'%':''));
        if(['FINISHED','FAILED','CANCELLED'].includes(j.status)){setMessage(j.error||(j.status==='FINISHED'?'Full-duration clips are ready.':'Generation '+j.status.toLowerCase()+'.'));setJob(null);}
      }catch(e){if(!disposed)setJobStatus('Could not refresh generation status: '+e.message);}}
      poll();const timer=setInterval(poll,2000);return()=>{disposed=true;clearInterval(timer);};
    },[job]);
    function stop(){setPlayer(null);setActive(null);setCurrent(0);}
    function edit(patch){setDoc(d=>({...d,...patch}));setDirty(true);stop();}
    function choose(next){if(dirty&&!window.confirm('Discard unsaved changes?'))return;setDoc(next);setSelected(next.clips.length?0:null);setDirty(false);stop();setMessage('');}
    async function perform(work){setBusy(true);setMessage('');try{await work();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
    async function save(){const saved=await op({action:'save',document:doc});setDoc(saved);setDirty(false);await load();return saved;}
    function add(marker){
      const duration=Number(defaultDuration),start=marker.seconds;
      if(!(duration>0&&Number.isFinite(duration))){setMessage('Default duration must be positive.');return;}
      const sourceDuration=(marker.scene.files[0]||{}).duration;
      const end=marker.end_seconds>start?marker.end_seconds:Math.min(start+duration,sourceDuration||Infinity);
      if(!(end>start)){setMessage('This marker has no playable interval.');return;}
      edit({clips:doc.clips.concat({marker_id:marker.id,scene_id:marker.scene.id,title:marker.title||marker.primary_tag.name,start,end,phases:patterns.presets[defaultPattern].map(p=>({...p}))})});
      setSelected(doc.clips.length);setMessage('Added '+(marker.title||marker.primary_tag.name)+' to the timeline.');
    }
    function changeClip(patch){edit({clips:doc.clips.map((c,i)=>i===selected?{...c,...patch}:c)});}
    function move(from,to){if(from===to)return;edit({clips:patterns.reorder(doc.clips,from,to)});setSelected(to);}
    async function play(position=0){
      const saved=dirty||!doc.id?await save():doc;
      const resolved=await op({action:'resolve',id:saved.id});
      const bad=resolved.clips.find(c=>c.error||(mode==='cache'&&!c.cached));
      if(bad)throw Error(bad.error||'Generate clips first; one or more clips are missing or outdated.');
      if(mode==='source'){
        const byScene=new Map();
        for(const c of resolved.clips){
          if(!byScene.has(c.scene_id)){
            const response=await client.query({query:gql`query CompilationStreams($id:ID!){findScene(id:$id){sceneStreams{url mime_type label}}}`,variables:{id:c.scene_id},fetchPolicy:'network-only'});
            if(!response.data.findScene)throw Error('Source scene no longer exists.');
            byScene.set(c.scene_id,response.data.findScene.sceneStreams);
          }
          c.streams=byScene.get(c.scene_id);
        }
      }
      setSeekRequest({position,serial:++serial.current,play:true});
      setCurrent(position);setPlayer({clips:patterns.expand(resolved.clips),mode,key:serial.current});
    }
    function seek(position){
      if(busy)return;
      if(player){setSeekRequest({position,serial:++serial.current,play:true});setCurrent(position);}
      else perform(()=>play(position));
    }
    async function toggleFullscreen(){
      try{if(document.fullscreenElement)await document.exitFullscreen();else await monitor.current.requestFullscreen();}
      catch{setMessage('Fullscreen is unavailable in this browser. You can still use the large preview.');}
    }
    async function reload(){
      if(dirty&&!window.confirm('Discard unsaved changes and reload?'))return;
      const latest=await op({action:'list'});setDocuments(latest);
      if(doc.id){const next=latest.find(d=>d.id===doc.id)||blank();setDoc(next);setSelected(next.clips.length?0:null);setDirty(false);stop();}
    }
    async function generate(){const saved=await save();const r=await client.mutate({mutation:TASK,variables:{args:{action:'generate',id:saved.id}}});setJob(r.data.runPluginTask);setJobStatus('Queued');}
    function dialog(title,body,footer,size='lg'){
      return h(Modal,{show:true,onHide:()=>setModal(null),size,centered:true,className:'mc-modal',backdrop:true},
        h(Modal.Header,{closeButton:true},h(Modal.Title,null,title)),h(Modal.Body,null,body),h(Modal.Footer,null,footer));
    }
    return h('main',{className:'mc'},
      h(api.libraries.ReactRouterDOM.Prompt,{when:dirty,message:'Discard unsaved compilation changes?'}),
      h('header',{className:'mc-header'},h('div',{className:'mc-brand'},h('span',{className:'mc-brand-icon','aria-hidden':true},'▥'),h('h1',null,'Marker compilations')),
        h('input',{className:'mc-name','aria-label':'Compilation name',value:doc.name,maxLength:200,disabled:busy,onChange:e=>edit({name:e.target.value})}),
        h('span',{className:'mc-save-state',role:'status'},dirty?'Unsaved changes':doc.id?'Saved':'New compilation'),
        h('div',{className:'mc-inline'},button('Compilations',()=>setModal('project'),busy),button('Save',()=>perform(async()=>{await save();setMessage('Compilation saved.');}),busy),button('+ Add markers',()=>setModal('markers'),busy,{className:'mc-primary'}))),
      message&&h('div',{className:'mc-notice',role:'status'},message,button('×',()=>setMessage(''),false,{'aria-label':'Dismiss message'})),
      h('div',{className:'mc-workspace'},
        h('section',{className:'mc-monitor',ref:monitor,'aria-label':'Preview viewport'},
          h('div',{className:'mc-monitor-heading'},h('div',null,h('span',{className:'mc-eyebrow'},'COMPILATION PREVIEW'),h('strong',null,active!=null?doc.clips[active]?.title:clip?.title||'Your sequence')),
            h('div',{className:'mc-inline'},h('select',{'aria-label':'Playback mode',value:mode,disabled:busy,onChange:e=>{stop();setMode(e.target.value);}},h('option',{value:'source'},'Source videos'),h('option',{value:'cache'},'Cached clips')),
              button(fullscreen?'Exit fullscreen':'Fullscreen',toggleFullscreen,false))),
          player?h(Player,{key:player.key,clips:player.clips,mode:player.mode,seekRequest,onProgress:progress,onActive:activate,onStop:stop}):
            h(React.Fragment,null,h('div',{className:'mc-video-surface mc-idle'},poster&&h('img',{src:poster,alt:''}),h('div',null,h('span',{className:'mc-idle-glyph','aria-hidden':true},'▷'),
              h('strong',null,doc.clips.length?'Ready when you are':'Your compilation starts here'),h('p',null,doc.clips.length?'Play the full sequence, or double-click a timeline clip to start there.':'Add markers to build a timeline of your favourite moments.'),
              button(doc.clips.length?'Play compilation':'+ Add markers',()=>doc.clips.length?perform(()=>play(0)):setModal('markers'),busy,{className:'mc-primary'}))),
              h('div',{className:'mc-transport'},button('Play from start',()=>perform(()=>play(0)),busy||!doc.clips.length),h('span',{className:'mc-pass'},'Source trims · Repeats · Variable speed'))),
          h('div',{className:'mc-monitor-footer'},h('output',{'aria-label':'Preview time'},time(current)+' / '+time(total)),h('span',null,mode==='source'?'Playing from original scenes':'Full-duration cached clips'))),
        h(Inspector,{key:selected,clip,index:selected,total:doc.clips.length,busy,onChange:changeClip,onMove:move,onApplyAll:()=>edit({clips:doc.clips.map(c=>({...c,phases:patterns.phases(clip).map(p=>({...p}))}))}),onRemove:()=>{const clips=doc.clips.filter((_,i)=>i!==selected);edit({clips});setSelected(clips.length?Math.min(selected,clips.length-1):null);},onPlay:()=>perform(()=>play(entries[selected].start))})),
      h(Timeline,{clips:doc.clips,selected,active,current,busy,onSelect:setSelected,onSeek:seek,onMove:move,onAdd:()=>setModal('markers')}),
      h('footer',{className:'mc-editor-footer'},h('span',null,'One timeline. Your own rhythm.'),button('Clip cache'+(job?' · generating…':''),()=>setModal('cache'),busy)),
      modal==='markers'&&dialog('Add markers to timeline',h(React.Fragment,null,
        h('div',{className:'mc-browser-filters'},h(Field,{label:'Search markers'},h('input',{type:'search',value:query,autoFocus:true,onChange:e=>{setQuery(e.target.value);setPage(1);}})),
          h(Field,{label:'Topic / tag'},h('select',{value:tag,onChange:e=>{setTag(e.target.value);setPage(1);}},h('option',{value:''},'All tags'),tags.map(t=>h('option',{key:t.id,value:t.id},t.name))))),
        h('details',{className:'mc-add-options'},h('summary',null,'Options for added clips'),
          h('div',{className:'mc-browser-filters'},h(Field,{label:'Duration without an end (seconds)'},h('input',{type:'number',min:.1,step:.1,value:defaultDuration,onChange:e=>setDefaultDuration(e.target.value)})),
            h(Field,{label:'Pattern for newly added clips'},h('select',{value:defaultPattern,onChange:e=>setDefaultPattern(e.target.value)},h('option',{value:'once'},'Once at normal speed'),h('option',{value:'3-2-3'},'3 normal → 2 half-speed → 3 normal'),h('option',{value:'2-2-2'},'2 normal → 2 half-speed → 2 normal'))))),
        h('p',{className:'mc-muted',role:'status'},loading?'Loading markers…':count+' markers'),
        message&&h('p',{role:'status'},message),
        h('div',{className:'mc-marker-grid'},!loading&&!markers.length&&h('p',null,'No markers match these filters.'),markers.map(m=>h('article',{key:m.id,className:'mc-marker'},
          h('img',{src:m.screenshot,alt:'',loading:'lazy'}),h('div',null,h('strong',null,m.title||m.primary_tag.name),h('p',null,m.scene.title||'Scene '+m.scene.id),h('small',null,time(m.seconds)+' → '+(m.end_seconds>m.seconds?time(m.end_seconds):'default duration'))),button('+ Add',()=>add(m),busy,{'aria-label':'Add '+(m.title||m.primary_tag.name)})))),
        h('div',{className:'mc-pagination'},button('Previous page',()=>setPage(page-1),page===1||loading),h('span',null,'Page '+page),button('Next page',()=>setPage(page+1),page*24>=count||loading))),
        h(React.Fragment,null,h('span',{role:'status'},doc.clips.length+' clips on timeline'),button('Done',()=>setModal(null),false,{className:'mc-primary'})),'xl'),
      modal==='project'&&dialog('Compilations',h(React.Fragment,null,
        h(Field,{label:'Saved compilations'},h('select',{value:doc.id||'',disabled:busy,onChange:e=>{choose(documents.find(d=>d.id===e.target.value)||blank());setModal(null);}},h('option',{value:''},'New compilation'),documents.map(d=>h('option',{key:d.id,value:d.id},d.name)))),
        h('div',{className:'mc-inline'},button('New compilation',()=>{choose(blank());setModal(null);},busy),button('Reload saved list',()=>perform(reload),busy)),
        doc.id&&button('Delete compilation',()=>{if(window.confirm('Delete this saved compilation? Source videos and markers will be kept.'))perform(async()=>{await op({action:'delete',id:doc.id,revision:doc.revision});setDoc(blank());setSelected(null);setDirty(false);stop();await load();setModal(null);});},busy,{className:'mc-danger'})),button('Done',()=>setModal(null),false)),
      modal==='cache'&&dialog('Full-duration clip cache',h(React.Fragment,null,h('p',null,'Generate each interval once and reuse it across compilations. Repeats and speed changes do not duplicate media.'),
        h(Field,{label:'Maximum clip width'},h('select',{value:doc.width,disabled:busy,onChange:e=>edit({width:Number(e.target.value)})},[640,1280,1920].map(w=>h('option',{key:w,value:w},w+' px')))),
        h('label',null,h('input',{type:'checkbox',checked:doc.audio,disabled:busy,onChange:e=>edit({audio:e.target.checked})}),' Include audio'),
        h('p',{role:'status'},jobStatus),message&&h('p',{role:'status'},message),
        h('div',{className:'mc-inline'},button('Generate clips',()=>perform(generate),busy||!!job||!doc.clips.length,{className:'mc-primary'}),job&&button('Cancel generation',()=>perform(async()=>{await client.mutate({mutation:gql`mutation($id:ID!){stopJob(job_id:$id)}`,variables:{id:job}});}),busy))),button('Done',()=>setModal(null),false)));
  }
  api.register.route('/marker-compilations',Page);
  api.patch.before('SettingsToolsSection',props=>[{...props,children:h(React.Fragment,null,props.children,h(api.components.Setting,{heading:h(Link,{to:'/marker-compilations'},'Open Marker Compilations')}))}]);
})();
