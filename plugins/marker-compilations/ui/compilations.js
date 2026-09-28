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
  const blank = () => ({name:'Untitled compilation',clips:[],media:[],width:1280,audio:true});
  const time = seconds => {const s=Math.floor(Math.max(0,seconds||0)),pad=n=>String(n).padStart(2,'0');return pad(Math.floor(s/3600))+':'+pad(Math.floor(s/60)%60)+':'+pad(s%60);};
  const button = (text, onClick, disabled, props) => h('button', Object.assign({type:'button',onClick,disabled:!!disabled},props),text);
  const presetOptions=()=>Object.entries(patterns.presetLabels).map(([value,label])=>h('option',{key:value,value},label));
  function Field({label,children}) {return h('label',{className:'mc-field'},h('span',null,label),children);}

  function TimeField({label,value,disabled,onChange,onFocus,fps}) {
    const [draft,setDraft]=useState(()=>patterns.frameTime(value,fps)), [error,setError]=useState('');
    useEffect(()=>{setDraft(patterns.frameTime(value,fps));setError('');},[value,fps]);
    function commit(){
      if(draft===patterns.frameTime(value,fps))return;
      const seconds=patterns.parseFrameTime(draft,fps);
      if(seconds===null){setDraft(patterns.frameTime(value,fps));setError('Use HH:MM:SS:FF with a valid frame number.');return;}
      setError('');setDraft(patterns.frameTime(seconds,fps));
      if(seconds!==value)onChange(seconds);
    }
    return h(Field,{label},h('input',{type:'text','aria-label':label,value:draft,disabled:disabled||!fps,onFocus,placeholder:'00:00:00:00',spellCheck:false,
      onChange:e=>{setDraft(e.target.value);setError('');},onBlur:commit,
      onKeyDown:e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}else if(e.key==='Escape'){setDraft(patterns.frameTime(value,fps));setError('');}}}),
      error&&h('small',{role:'alert'},error));
  }

  function Player({clips,mode,seekRequest,onProgress,onActive,onStop,controls}) {
    const initial=patterns.locate(clips,seekRequest.position);
    const [index,setIndex]=useState(initial.index), [sourceIndex,setSourceIndex]=useState(0);
    const [error,setError]=useState(''), [playing,setPlaying]=useState(false), [volume,setVolume]=useState(1);
    const [sourceTime,setSourceTime]=useState(clips[initial.index].start+initial.offset);
    const video=useRef(null), advancing=useRef(false), pending=useRef(initial.offset);
    const shouldPlay=useRef(true), finished=useRef(false), activeIndex=useRef(index);
    const clip=clips[index], cached=mode==='cache';
    const streams=(clip.streams||[]).filter(s=>!/mpegurl|dash/i.test(s.mime_type||''));
    const url=cached?(clip.cached?new URL('plugin/marker-compilations/assets/cache/'+clip.cached,document.baseURI).href:''):(streams[sourceIndex]||{}).url;
    const start=cached?0:clip.start, end=cached?clip.end-clip.start:clip.end;
    function report() {
      if(!video.current)return;
      const offset=Math.max(0,Math.min(video.current.currentTime-start,end-start));
      setSourceTime(clip.start+offset);
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
      setError(!url?(cached?'This clip has not been prepared. Use Prepare clips or choose Source videos.':'No compatible source stream is available.'): '');
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
    useEffect(()=>{controls.current={toggle};return()=>{controls.current=null;};});
    const previous=clips.findIndex(p=>p.clipIndex===Math.max(0,clip.clipIndex-1));
    const next=clips.findIndex(p=>p.clipIndex>clip.clipIndex);
    return h(React.Fragment,null,
      h('div',{className:'mc-video-surface'},h('video',{key:url,ref:video,src:url||undefined,playsInline:true,preload:'auto',onLoadedMetadata:ready,
        onPlay:()=>{setPlaying(true);setError('');},onPause:()=>setPlaying(false),onClick:toggle,
        onTimeUpdate:()=>{if(video.current.currentTime>=end)go(index+1);report();},
        onEnded:()=>{if(video.current.currentTime>=end-.02)go(index+1);},
        onError:()=>setError('Playback failed. Choose another source stream or prepare clips for playback.')}),
        error&&h('div',{className:'mc-player-message',role:'status'},error)),
      h('div',{className:'mc-transport'},
        button('⏮',()=>{advancing.current=false;go(previous);},clip.clipIndex===0,{'aria-label':'Previous clip'}),
        button(playing?'Pause':'Play',toggle,!url,{className:'mc-primary','aria-label':playing?'Pause playback':'Resume playback'}),
        button('⏭',()=>{advancing.current=false;go(next);},next<0,{'aria-label':'Next clip'}),
        button('Stop',onStop,false),
        h('span',{className:'mc-pass',role:'status'},'Pass '+(index+1)+' / '+clips.length+' · '+clip.speed+'× · Repeat '+(clip.repeatIndex+1)+'/'+clip.repeatCount),
        h('output',{className:'mc-source-time','aria-label':'Source time'},'Source '+patterns.frameTime(sourceTime,clip.frame_rate)),
        h('label',{className:'mc-volume'},'Volume',h('input',{type:'range',min:0,max:1,step:.05,value:volume,onChange:e=>{const value=Number(e.target.value);setVolume(value);if(video.current)video.current.volume=value;}})),
        !cached&&streams.length>1&&h('select',{'aria-label':'Source stream',value:sourceIndex,onChange:e=>{pending.current=Math.max(0,video.current.currentTime-start);shouldPlay.current=!video.current.paused;setSourceIndex(Number(e.target.value));}},streams.map((s,i)=>h('option',{key:i,value:i},s.label||s.mime_type||'Source '+(i+1))))));
  }

  function Timeline({clips,selected,active,current,busy,onSelect,onInspect,onSeek,onMove,onRemove,onPlay,onCache,job,onInsertMedia,dropMediaRef}) {
    const scroller=useRef(null), dragIndex=useRef(null);
    const [width,setWidth]=useState(800), [zoom,setZoom]=useState(1), [dropTarget,setDropTarget]=useState(null);
    const entries=patterns.timeline(clips), total=entries.length?entries[entries.length-1].end:0;
    useEffect(()=>{
      const resize=new ResizeObserver(items=>setWidth(items[0].contentRect.width));
      resize.observe(scroller.current);return()=>resize.disconnect();
    },[]);
    useEffect(()=>{dropMediaRef.current=(key,x,y)=>{const bounds=scroller.current.getBoundingClientRect(),rect=scroller.current.firstElementChild.getBoundingClientRect();if(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom)return;const index=entries.findIndex(entry=>x-rect.left<(entry.start+entry.duration/2)*scale);onInsertMedia(key,index<0?clips.length:index);};return()=>{dropMediaRef.current=null;};});
    const scale=Math.max(.01,(width-40)/Math.max(1,total))*zoom;
    const canvasWidth=Math.max(width,total*scale+40);
    const steps=[.1,.25,.5,1,2,5,10,15,30,60,120,300,600,1800,3600];
    const step=steps.find(s=>s*scale>=85)||Math.ceil(85/scale/3600)*3600;
    const ticks=Array.from({length:Math.min(300,Math.floor(total/step)+1)},(_,i)=>i*step);
    function seek(event){if(busy||!total)return;const rect=event.currentTarget.getBoundingClientRect();onSeek(Math.max(0,Math.min(total,(event.clientX-rect.left)/scale)));}
    function drop(event,to){event.preventDefault();event.stopPropagation();if(dragIndex.current!=null&&!busy)onMove(dragIndex.current,to);dragIndex.current=null;setDropTarget(null);}
    return h('section',{className:'mc-timeline','aria-label':'Compilation timeline'},
      h('div',{className:'mc-panel-heading mc-timeline-toolbar'},
        h('h2',null,'Timeline'),
        h('div',{className:'mc-inline mc-clip-actions'},button('Play clip',onPlay,busy||selected==null),
          button('←',()=>onMove(selected,selected-1),busy||selected==null||selected===0,{'aria-label':'Move clip earlier'}),
          button('→',()=>onMove(selected,selected+1),busy||selected==null||selected===clips.length-1,{'aria-label':'Move clip later'}),
          button('Remove',onRemove,busy||selected==null,{'aria-label':'Remove clip'})),
        h('label',{className:'mc-scrub'},h('input',{'aria-label':'Compilation position',type:'range',min:0,max:total||1,step:.05,value:Math.min(current,total),disabled:busy||!total,onChange:e=>onSeek(Number(e.target.value))})),
        h('output',{'aria-label':'Timeline time'},time(current)+' / '+time(total)),
        h('div',{className:'mc-inline'},h('label',{className:'mc-zoom'},'Zoom',h('input',{type:'range',min:1,max:8,step:.25,value:zoom,onChange:e=>setZoom(Number(e.target.value))})),button('Fit',()=>setZoom(1),false),
          button('Prepare clips'+(job?' · generating…':''),onCache,busy))),
      h('div',{className:'mc-timeline-scroll',ref:scroller},h('div',{className:'mc-timeline-canvas',style:{width:canvasWidth}},
        h('div',{className:'mc-ruler',onClick:seek,'aria-label':'Timeline ruler'},ticks.map(t=>h('span',{key:t,style:{left:t*scale}},time(t)))),
        h('div',{className:'mc-track'},!clips.length?h('div',{className:'mc-timeline-empty'},h('strong',null,'Build your sequence here'),h('p',null,'Drag a marker from Project media, or use Insert, to start your sequence.')):
          entries.map(entry=>{const c=clips[entry.index];return h('button',{type:'button',key:entry.index,className:'mc-timeline-clip'+(selected===entry.index?' is-selected':'')+(active===entry.index?' is-playing':'')+(dropTarget===entry.index?' is-drop-target':''),
            style:{left:entry.start*scale,width:Math.max(1,entry.duration*scale)},disabled:busy,draggable:!busy,
            'aria-label':'Clip '+(entry.index+1)+': '+c.title,'aria-pressed':selected===entry.index,
            title:c.title+' · '+time(entry.duration)+' · '+patterns.phases(c).map(p=>p.repeat+' plays at '+p.speed+'×').join(' → '),
            onClick:()=>onSelect(entry.index),onDoubleClick:()=>onInspect(entry.index),
            onKeyDown:e=>{if(e.key==='Enter'&&!e.altKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();if(!e.repeat)onInspect(entry.index);return;}if(e.altKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();const to=entry.index+(e.key==='ArrowLeft'?-1:1);if(to>=0&&to<clips.length)onMove(entry.index,to);}},
            onDragStart:e=>{dragIndex.current=entry.index;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(entry.index));},
            onDragOver:e=>{if(dragIndex.current!=null){e.preventDefault();setDropTarget(entry.index);}},onDrop:e=>drop(e,entry.index),onDragEnd:()=>{dragIndex.current=null;setDropTarget(null);}},
            h('span',{className:'mc-clip-number'},String(entry.index+1).padStart(2,'0')),h('strong',null,c.title),h('small',null,time(entry.duration)),
            h('span',{className:'mc-phase-strip'},patterns.phases(c).map((p,n)=>h('i',{key:n,className:p.speed<1?'is-slow':'',style:{flex:p.repeat/p.speed},title:p.repeat+' × '+p.speed+' speed'}))));})),
        total>0&&h('div',{className:'mc-playhead',style:{left:Math.min(current,total)*scale},'aria-hidden':true},h('span',null)))));
  }

  function TrimPreview({clip,onChange,onBeforePlay,controls,busy,target,frameCache}) {
    const client=useApolloClient(), video=useRef(null), pending=useRef(clip.start), limit=useRef(null);
    const [streams,setStreams]=useState([]), [stream,setStream]=useState(0), [duration,setDuration]=useState(0);
    const start=clip.start, end=clip.end;
    const [position,setPosition]=useState(clip.start);
    const [fps,setFps]=useState(null), [frameBusy,setFrameBusy]=useState(false), [frameError,setFrameError]=useState('');
    const frameData=useRef(null), frameRequest=useRef(0), warming=useRef(null), framePending=useRef(null);
    const [step,setStep]=useState(1), [playing,setPlaying]=useState(false), [ready,setReady]=useState(false), [seeking,setSeeking]=useState(true), [error,setError]=useState('');
    useEffect(()=>{
      let disposed=false;
      client.query({query:gql`query CompilationTrimSource($id:ID!){findScene(id:$id){files{frame_rate} sceneStreams{url mime_type label}}}`,variables:{id:clip.scene_id},fetchPolicy:'network-only'})
        .then(r=>{if(disposed)return;setFps(patterns.frameRate(r.data.findScene?.files?.[0]?.frame_rate));const compatible=(r.data.findScene?.sceneStreams||[]).filter(s=>!/mpegurl|dash/i.test(s.mime_type||''));setStreams(compatible);if(!compatible.length)setError('No compatible source stream is available for trimming.');})
        .catch(e=>{if(!disposed)setError(e.message);});
      return()=>{disposed=true;};
    },[clip.scene_id]);
    function cachedFrames(position){
      return frameCache.current.find(item=>item.scene===clip.scene_id&&Date.now()-item.loaded<120000&&
        patterns.frameStep(item.data,position,-10)!==null&&patterns.frameStep(item.data,position,10)!==null)?.data;
    }
    async function loadFrames(position){
      const cached=cachedFrames(position);
      if(cached){frameData.current=cached;setFps(patterns.frameRate(cached.fps));return cached;}
      // A click can reuse a warm-up already in flight instead of starting a second probe.
      if(framePending.current){
        const generation=frameRequest.current;
        try{await framePending.current;}catch{return null;}
        if(generation!==frameRequest.current)return null;
        const ready=cachedFrames(position);
        if(ready){frameData.current=ready;setFps(patterns.frameRate(ready.fps));return ready;}
      }
      const id=++frameRequest.current;setFrameBusy(true);setFrameError('');
      const pending=client.mutate({mutation:OP,variables:{args:{action:'frames',scene_id:clip.scene_id,position}}});
      framePending.current=pending;
      try{
        const r=await pending;
        if(id!==frameRequest.current)return null;
        const data=r.data.runPluginOperation;frameData.current=data;setFps(patterns.frameRate(data.fps));
        frameCache.current=[{scene:clip.scene_id,loaded:Date.now(),data},...frameCache.current].slice(0,12);
        return data;
      }catch(e){if(id===frameRequest.current)setFrameError('Frame stepping unavailable: '+e.message);return null;}
      finally{if(framePending.current===pending)framePending.current=null;if(id===frameRequest.current)setFrameBusy(false);}
    }
    function warmFrames(position){
      clearTimeout(warming.current);
      if(patterns.frameStep(frameData.current,position,-10)!==null&&patterns.frameStep(frameData.current,position,10)!==null)return;
      warming.current=setTimeout(()=>{loadFrames(position);},150);
    }
    useEffect(()=>{loadFrames(clip.start);return()=>{frameRequest.current++;clearTimeout(warming.current);};},[clip.scene_id]);
    async function stepFrames(direction,amount=step){
      const v=video.current;if(!v||!ready||busy||frameBusy||seeking||v.seeking)return;
      onBeforePlay();v.pause();limit.current=null;
      const point=v.currentTime, count=direction*amount;
      let next=patterns.frameStep(frameData.current,point,count);
      if(next===null){const data=await loadFrames(point);if(!data)return;next=patterns.frameStep(data,point,count);}
      if(next!==null)seek(next,true);
      else setFrameError('Could not locate the next frame in this source.');
    }
    function seek(value,frame=false){
      const v=video.current;if(!v||!ready)return;
      onBeforePlay();v.pause();limit.current=null;const target=Math.max(0,Math.min(duration,value));
      setSeeking(true);v.currentTime=Math.min(duration,target+(frame ? .00001 : 0));setPosition(target);
    }
    function loaded(){
      const v=video.current;
      if(!Number.isFinite(v.duration)||v.duration<=0){setError('This stream does not provide a seekable duration. Choose another stream.');return;}
      setDuration(v.duration);setReady(true);setError('');
      const target=Math.min(pending.current,v.duration);v.currentTime=target;setPosition(target);setSeeking(v.seeking);
    }
    function update(){const v=video.current;if(!v)return;setPosition(v.currentTime);if(limit.current!=null&&v.currentTime>=limit.current){v.pause();v.currentTime=limit.current;limit.current=null;}}
    useEffect(()=>{let frame;function tick(){if(video.current&&!video.current.paused)update();frame=requestAnimationFrame(tick);}frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[]);
    useEffect(()=>{
      const v=video.current;if(!v?.requestVideoFrameCallback)return;
      let token,disposed=false;
      function frame(now,info){if(disposed)return;if(!v.paused)setPosition(info.mediaTime);token=v.requestVideoFrameCallback(frame);}
      token=v.requestVideoFrameCallback(frame);return()=>{disposed=true;v.cancelVideoFrameCallback(token);};
    },[target,stream]);
    function play(selection){
      const v=video.current;if(!v||!ready)return;
      onBeforePlay();limit.current=selection?end:null;
      if(selection){v.currentTime=start;setPosition(start);}
      v.play().catch(()=>setError('Playback could not start. Try another source stream.'));
    }
    async function mark(which){
      const v=video.current;if(!v||v.seeking||frameBusy)return;
      v.pause();limit.current=null;const current=v.currentTime;
      let data=frameData.current, point=patterns.frameStep(data,current,0);
      if(point===null){data=await loadFrames(current);if(!data)return;point=patterns.frameStep(data,current,0);}
      if(point===null)return;
      setPosition(point);onChange({[which]:point});
    }
    const valid=ready&&start>=0&&end>start&&end<=duration;
    useEffect(()=>{controls.current={
      pause:()=>video.current?.pause(),
      toggle:()=>{const v=video.current;if(!v||!ready||busy)return;if(v.paused)play(false);else v.pause();},
      frame:direction=>stepFrames(direction,1),
      second:direction=>{const v=video.current;if(v&&ready&&!busy&&!frameBusy&&!seeking&&!v.seeking)seek(v.currentTime+direction);}
    };return()=>{controls.current=null;};});
    return h('section',{className:'mc-trimmer','aria-label':'Source trim'},
      h('h3',null,'Trim',h('span',{className:'mc-fps',title:'Source frame rate. HH:MM:SS:FF non-drop-frame timecode.'},fps?Number(fps.toFixed(3))+' fps':'Reading frame rate…')),
      target&&api.ReactDOM.createPortal(h('div',{className:'mc-trim-preview'},h('video',{ref:video,src:streams[stream]?.url,preload:'auto',playsInline:true,controls:true,onLoadedMetadata:loaded,
        onTimeUpdate:update,onPlay:()=>{onBeforePlay();setPlaying(true);},onPause:()=>setPlaying(false),onSeeking:()=>setSeeking(true),onSeeked:()=>{setSeeking(false);update();warmFrames(video.current.currentTime);},
        onError:()=>{setReady(false);setError('Source unavailable. Try another stream.');}})),target),
      error&&h('p',{role:'alert'},error),
      h('div',{className:'mc-trim-controls'},
        button(playing?'Ⅱ':'▶',()=>playing?video.current.pause():play(false),!ready||busy,{'aria-label':playing?'Pause source preview':'Play source preview'}),
        button('Play range',()=>play(true),!valid||busy),
        h('div',{className:'mc-step-controls'},
        button('−',()=>stepFrames(-1),!ready||seeking||busy||frameBusy,{'aria-label':'Step backward',title:'Step backward '+step+' frame(s)'}),
        h('select',{'aria-label':'Fine adjustment step',value:step,onChange:e=>setStep(Number(e.target.value))},[1,5,10].map(s=>h('option',{key:s,value:s},s+' frame'+(s===1?'':'s')))),
        button('+',()=>stepFrames(1),!ready||seeking||busy||frameBusy,{'aria-label':'Step forward',title:'Step forward '+step+' frame(s)'})),
        h('output',{'aria-label':'Trim preview time'},patterns.frameTime(position,fps))),
      h('input',{'aria-label':'Source position',className:'mc-trim-slider',type:'range',min:0,max:duration||1,step:.001,value:Math.min(position,duration),disabled:!ready||busy,onChange:e=>seek(Number(e.target.value))}),
      h('div',{className:'mc-boundary-row'},h(TimeField,{label:'Start',value:start,fps,disabled:busy,onFocus:onBeforePlay,onChange:start=>onChange({start})}),
        button('↦',()=>seek(start),!ready||busy,{'aria-label':'Jump to start',title:'Jump to start'}),button('Set',()=>mark('start'),!ready||seeking||busy||frameBusy,{'aria-label':'Set start here'})),
      h('div',{className:'mc-boundary-row'},h(TimeField,{label:'End',value:end,fps,disabled:busy,onFocus:onBeforePlay,onChange:end=>onChange({end})}),
        button('↦',()=>seek(end),!ready||busy,{'aria-label':'Jump to end',title:'Jump to end'}),button('Set',()=>mark('end'),!ready||seeking||busy||frameBusy,{'aria-label':'Set end here'})),
      frameError&&h('p',{role:'alert'},frameError),
      ready&&!valid&&h('p',{role:'alert'},'Choose start < end within the source.'),
      streams.length>1&&h('select',{'aria-label':'Trim source stream',value:stream,disabled:busy,onChange:e=>{pending.current=position;video.current.pause();limit.current=null;setReady(false);setSeeking(true);setStream(Number(e.target.value));}},streams.map((s,i)=>h('option',{key:i,value:i},s.label||s.mime_type))));
  }

  function Inspector({clip,busy,onChange,onApplyAll,onBeforePlay,trimControls,trimTarget,onClose,frameCache}) {
    if(!clip)return h('aside',{className:'mc-inspector','aria-label':'Clip settings'},h('div',{className:'mc-panel-heading'},h('h2',null,'Inspector')),h('div',{className:'mc-inspector-empty'},'Select a timeline clip to edit.'));
    const phases=patterns.phases(clip);
    const patchPhase=(n,patch)=>onChange({phases:phases.map((p,j)=>j===n?{...p,...patch}:p)});
    return h('aside',{className:'mc-inspector','aria-label':'Clip settings'},
      h('div',{className:'mc-panel-heading'},h('h2',null,clip.title),h(Link,{to:'/scenes/'+clip.scene_id,title:'Open source scene'},'Source ↗'),button('×',onClose,false,{'aria-label':'Close clip inspector',title:'Back to timeline (Escape)'})),
      h('div',{className:'mc-inspector-columns'},
        h(TrimPreview,{clip,onChange,onBeforePlay,controls:trimControls,busy,target:trimTarget,frameCache}),
        h('section',{className:'mc-pattern','aria-label':'Repeat and speed'},h('h3',null,'Repeat & speed'),
          h('select',{'aria-label':'Apply a preset',value:'',disabled:busy,onChange:e=>{if(e.target.value)onChange({phases:patterns.presets[e.target.value].map(p=>({...p}))});}},
            h('option',{value:''},'Preset…'),presetOptions()),
          h('div',{className:'mc-phase-labels'},h('span',null,'Repeats'),h('span',null,'Speed')),
          phases.map((phase,n)=>h('div',{className:'mc-phase',key:n},h('span',{className:'mc-phase-index'},n+1),
            h('input',{'aria-label':'Phase '+(n+1)+' repeats',type:'number',min:1,max:20,step:1,value:phase.repeat,disabled:busy,onChange:e=>patchPhase(n,{repeat:e.target.value===''?'':Number(e.target.value)})}),
            h('select',{'aria-label':'Phase '+(n+1)+' speed',value:phase.speed,disabled:busy,onChange:e=>patchPhase(n,{speed:Number(e.target.value)})},[.25,.5,.75,1,1.25,1.5,2,3].map(rate=>h('option',{key:rate,value:rate},rate+'×'))),
            button('×',()=>onChange({phases:phases.filter((_,j)=>j!==n)}),busy||phases.length===1,{'aria-label':'Remove phase '+(n+1),className:'mc-icon-button'}))),
          button('+ Phase',()=>onChange({phases:phases.concat({repeat:1,speed:1})}),busy||phases.length>=10),
          button('Apply to all clips',onApplyAll,busy,{className:'mc-apply-pattern'}))));
  }

  function MarkerThumbnail({clip,uses}) {
    const client=useApolloClient(), [url,setUrl]=useState(''), [failed,setFailed]=useState(false);
    const thumbnail=useRef(null), [visible,setVisible]=useState(false);
    useEffect(()=>{
      const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'100px'});
      if(thumbnail.current)observer.observe(thumbnail.current);
      return()=>observer.disconnect();
    },[]);
    useEffect(()=>{
      let disposed=false;setUrl('');setFailed(false);
      if(visible&&clip.marker_id)client.query({query:gql`query CompilationMediaThumbnails($id:ID!){findScene(id:$id){scene_markers{id screenshot}}}`,variables:{id:clip.scene_id}})
        .then(r=>{if(!disposed)setUrl(r.data.findScene?.scene_markers?.find(m=>String(m.id)===String(clip.marker_id))?.screenshot||'');}).catch(()=>{});
      return()=>{disposed=true;};
    },[clip.scene_id,clip.marker_id,visible]);
    return h('span',{className:'mc-media-thumb',ref:thumbnail,title:url&&!failed?'Marker thumbnail':'Marker thumbnail unavailable'},
      url&&!failed?h('img',{src:url,alt:'',loading:'lazy',draggable:false,onError:()=>setFailed(true)}):h('span',{'aria-hidden':true},'▧'),
      uses>0&&h('span',{className:'mc-media-uses',title:uses+' on timeline','aria-label':uses+' on timeline'},uses+'×'));
  }

  function MediaCatalog({media,clips,busy,onInsert,onDrop}) {
    const [query,setQuery]=useState(''), [dragging,setDragging]=useState(null);
    const drag=useRef(null);
    function pointerDown(e,c){if(busy||e.pointerType==='touch'||e.button!==0||e.target.closest('button'))return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={key:patterns.mediaKey(c),title:c.title,x:e.clientX,y:e.clientY,moved:false};}
    function pointerMove(e){const d=drag.current;if(!d)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>5)d.moved=true;if(d.moved)setDragging({...d,x:e.clientX,y:e.clientY});}
    function pointerUp(e){const d=drag.current;drag.current=null;setDragging(null);if(d?.moved)onDrop(d.key,e.clientX,e.clientY);}
    const filtered=media.filter(c=>c.title.toLowerCase().includes(query.toLowerCase()));
    return h('section',{className:'mc-catalog','aria-label':'Project media catalog'},
      dragging&&h('div',{className:'mc-media-drag-ghost',style:{left:dragging.x+12,top:dragging.y+12},'aria-hidden':true},dragging.title),
      h('div',{className:'mc-catalog-heading'},h('h2',null,'Project media'),h('span',null,media.length+' markers'),
        h('input',{type:'search','aria-label':'Search project media',placeholder:'Find marker…',value:query,onChange:e=>setQuery(e.target.value)})),
      media.length===0?h('p',null,'Use Add markers to collect project media, then drag it onto the timeline.'):
        filtered.length===0?h('p',null,'No matching markers.'):
        h('div',{className:'mc-catalog-items',tabIndex:0,'aria-label':'Project media list'},filtered.map(c=>{
          const key=patterns.mediaKey(c),uses=clips.filter(clip=>patterns.mediaKey(clip)===key).length;
          return h('article',{key,className:'mc-media-item'+(dragging?.key===key?' is-dragging':''),draggable:false,'aria-label':'Project marker: '+c.title,
            onPointerDown:e=>pointerDown(e,c),onPointerMove:pointerMove,onPointerUp:pointerUp,onPointerCancel:()=>{drag.current=null;setDragging(null);}},
            h(MarkerThumbnail,{clip:c,uses}),
            h('span',{className:'mc-media-details'},h('strong',{title:c.title},c.title),h('small',{title:uses?uses+' on timeline':'Not on timeline'},time(c.end-c.start))),
            button('+',()=>onInsert(key),busy,{'aria-label':'Insert '+c.title,title:'Insert after the selected timeline clip'}));})))
  }

  function Page() {
    const client=useApolloClient(), Modal=api.libraries.Bootstrap.Modal;
    const [view,setView]=useState('viewer'), [libraryQuery,setLibraryQuery]=useState('');
    const [documents,setDocuments]=useState([]), [doc,setDoc]=useState(blank), [dirty,setDirty]=useState(false);
    const [trimSession,setTrimSession]=useState(0);
    const [inspectorOpen,setInspectorOpen]=useState(false), [mediaCollapsed,setMediaCollapsed]=useState(false);
    const spaceCaptured=useRef(false), frameCache=useRef([]);
    const [preview,setPreview]=useState('compilation'), [trimTarget,setTrimTarget]=useState(null);
    const [selected,setSelected]=useState(null), [active,setActive]=useState(null), [current,setCurrent]=useState(0);
    const [modal,setModal]=useState(null), [mode,setMode]=useState('source'), [poster,setPoster]=useState('');
    const [markers,setMarkers]=useState([]), [tags,setTags]=useState([]), [query,setQuery]=useState(''), [tag,setTag]=useState('');
    const [page,setPage]=useState(1), [count,setCount]=useState(0), [defaultDuration,setDefaultDuration]=useState(20), [defaultPattern,setDefaultPattern]=useState('once');
    const [busy,setBusy]=useState(false), [loading,setLoading]=useState(false), [message,setMessage]=useState(''), [player,setPlayer]=useState(null);
    const [job,setJob]=useState(null), [jobStatus,setJobStatus]=useState(''), [fullscreen,setFullscreen]=useState(false);
    const [seekRequest,setSeekRequest]=useState({position:0,serial:0,play:true});
    const dropMediaRef=useRef(null), request=useRef(0), monitor=useRef(null), serial=useRef(0), playerControls=useRef(null), trimControls=useRef(null);
    const clip=selected==null?null:doc.clips[selected], entries=patterns.timeline(doc.clips);
    const total=entries.length?entries[entries.length-1].end:0;
    const media=patterns.catalog(doc), trimActive=view==='editor'&&inspectorOpen&&preview==='trim'&&!!clip;
    const progress=useCallback(position=>setCurrent(position),[]), activate=useCallback(index=>setActive(index),[]);
    async function op(args){const r=await client.mutate({mutation:OP,variables:{args}});return r.data.runPluginOperation;}
    async function load(){setDocuments(await op({action:'list'}));}
    useEffect(()=>{op({action:'list'}).then(items=>{setDocuments(items);if(items.length)choose(items[0]);}).catch(e=>setMessage(e.message));},[]);
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
    function edit(patch){setDoc(d=>({...d,media:patterns.catalog(d),...patch}));setDirty(true);stop();}
    function choose(next,discard=false){if(dirty&&!discard&&!window.confirm('Discard unsaved changes?'))return false;setInspectorOpen(false);setDoc({...next,media:patterns.catalog(next)});setTrimSession(n=>n+1);setPreview('compilation');setSelected(next.clips.length?0:null);setDirty(false);stop();setMessage('');return true;}
    async function perform(work){setBusy(true);setMessage('');try{await work();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
    async function save(){const saved=await op({action:'save',document:doc});setDoc(saved);setDirty(false);await load();return saved;}
    function add(marker){
      const duration=Number(defaultDuration),start=marker.seconds;
      if(!(duration>0&&Number.isFinite(duration))){setMessage('Default duration must be positive.');return;}
      const sourceDuration=(marker.scene.files[0]||{}).duration;
      const end=marker.end_seconds>start?marker.end_seconds:Math.min(start+duration,sourceDuration||Infinity);
      if(!(end>start)){setMessage('This marker has no playable interval.');return;}
      const item={marker_id:marker.id,scene_id:marker.scene.id,title:marker.title||marker.primary_tag.name,start,end,phases:patterns.presets[defaultPattern].map(p=>({...p}))};
      if(media.some(c=>patterns.mediaKey(c)===patterns.mediaKey(item)))return;
      if(media.length>=2000){setMessage('A project supports up to 2000 catalog markers.');return;}
      edit({media:media.concat(item)});setMessage('Added '+item.title+' to project media.');
    }
    function insertMedia(key,index=selected==null?doc.clips.length:selected+1){
      const item=media.find(c=>patterns.mediaKey(c)===key);if(!item||busy)return;
      if(doc.clips.length>=2000){setMessage('A compilation supports up to 2000 clips.');return;}
      edit({media,clips:patterns.insertClip(doc.clips,item,index)});setSelected(index);setTrimSession(n=>n+1);setPreview(inspectorOpen?'trim':'compilation');
    }
    function selectClip(index){if(index===selected)return;trimControls.current?.pause();if(inspectorOpen)stop();setSelected(index);setTrimSession(n=>n+1);setPreview(inspectorOpen?'trim':'compilation');}
    function showTrim(){stop();setInspectorOpen(true);setPreview('trim');}
    function inspectClip(index){selectClip(index);showTrim();}
    function closeInspector(){trimControls.current?.pause();setInspectorOpen(false);setPreview('compilation');requestAnimationFrame(()=>document.querySelectorAll('.mc-timeline-clip')[selected]?.focus({preventScroll:true}));}

    function changeClip(patch){edit({clips:doc.clips.map((c,i)=>i===selected?{...c,...patch}:c)});}
    function removeClip(){
      setTrimSession(n=>n+1);
      if(selected==null||!doc.clips[selected])return;
      const clips=doc.clips.filter((_,i)=>i!==selected);edit({clips});setSelected(clips.length?Math.min(selected,clips.length-1):null);if(!clips.length)closeInspector();
    }
    function editingText(target){return target instanceof Element&&(target.closest('input,textarea,select,[role="textbox"]')||target.isContentEditable);}
    function clipShortcutTarget(target){return view==='editor'&&!busy&&!modal&&!editingText(target)&&(target===document.body||target instanceof Element&&!!target.closest('main.mc'));}
    useEffect(()=>{
      function copyOrCut(e){
        if(!clipShortcutTarget(e.target)||!clip||!e.clipboardData)return;
        e.clipboardData.setData('text/plain',patterns.encodeClip(clip));e.preventDefault();e.stopPropagation();
        if(e.type==='cut')removeClip();
      }
      function paste(e){
        if(!clipShortcutTarget(e.target)||!e.clipboardData)return;
        const copied=patterns.decodeClip(e.clipboardData.getData('text/plain'));if(!copied)return;
        e.preventDefault();e.stopPropagation();
        if(doc.clips.length>=2000){setMessage('A compilation supports up to 2000 clips.');return;}
        const index=selected==null?doc.clips.length:selected+1, clips=doc.clips.slice();clips.splice(index,0,copied);
        edit({clips});setSelected(index);setTrimSession(n=>n+1);
        requestAnimationFrame(()=>document.querySelectorAll('.mc-timeline-clip')[index]?.focus());
      }
      document.addEventListener('copy',copyOrCut,true);document.addEventListener('cut',copyOrCut,true);document.addEventListener('paste',paste,true);
      return()=>{document.removeEventListener('copy',copyOrCut,true);document.removeEventListener('cut',copyOrCut,true);document.removeEventListener('paste',paste,true);};
    });
    function move(from,to){if(from===to)return;edit({clips:patterns.reorder(doc.clips,from,to)});setSelected(to);setTrimSession(n=>n+1);}
    async function play(position=0){
      trimControls.current?.pause();setPreview('compilation');
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
    function switchView(next){
      if(next===view)return;
      if(next==='viewer'&&dirty){setModal('unsaved');return;}
      trimControls.current?.pause();stop();setInspectorOpen(false);setPreview('compilation');setView(next);
    }
    function toggleTimeline(){
      if(busy||modal||!doc.clips.length)return;
      trimControls.current?.pause();
      if(player)playerControls.current?.toggle();else perform(()=>play(current));
    }
    useEffect(()=>{
      function hotkey(e){
        if(e.key==='Escape'&&!modal&&inspectorOpen){e.preventDefault();e.stopImmediatePropagation();closeInspector();return;}
        if((e.key==='Delete'||e.key==='Backspace')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&clipShortcutTarget(e.target)&&clip){e.preventDefault();e.stopPropagation();if(!e.repeat)removeClip();return;}
        if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||modal)return;
        if(inspectorOpen&&clip&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
          if(e.target instanceof Element&&(e.target.closest('input:not([type="range"]),textarea,select,[role="textbox"]')||e.target.isContentEditable))return;
          e.preventDefault();e.stopImmediatePropagation();
          if(e.key==='ArrowLeft'||e.key==='ArrowRight')trimControls.current?.frame(e.key==='ArrowLeft'?-1:1);
          else trimControls.current?.second(e.key==='ArrowUp'?-1:1);
          return;
        }
        if(e.code!=='Space'&&e.key!==' ')return;
        const target=e.target;
        if(target instanceof Element&&(target.closest('textarea,input[type="text"],input[type="search"],input:not([type]),[role="textbox"]')||target.isContentEditable))return;
        e.preventDefault();e.stopImmediatePropagation();spaceCaptured.current=true;
        if(!e.repeat){if(inspectorOpen&&clip)trimControls.current?.toggle();else toggleTimeline();}
      }
      function release(e){if((e.code==='Space'||e.key===' ')&&spaceCaptured.current){e.preventDefault();e.stopImmediatePropagation();spaceCaptured.current=false;}}
      function blur(){spaceCaptured.current=false;}
      window.addEventListener('keydown',hotkey,true);window.addEventListener('keyup',release,true);window.addEventListener('blur',blur);
      return()=>{window.removeEventListener('keydown',hotkey,true);window.removeEventListener('keyup',release,true);window.removeEventListener('blur',blur);};
    });
    async function toggleFullscreen(){
      try{if(document.fullscreenElement)await document.exitFullscreen();else await monitor.current.requestFullscreen();}
      catch{setMessage('Fullscreen is unavailable in this browser. You can still use the large preview.');}
    }
    async function reload(){
      if(dirty&&!window.confirm('Discard unsaved changes and reload?'))return;
      const latest=await op({action:'list'});setDocuments(latest);
      if(doc.id){const next=latest.find(d=>d.id===doc.id)||blank();setInspectorOpen(false);setDoc({...next,media:patterns.catalog(next)});setTrimSession(n=>n+1);setPreview('compilation');setSelected(next.clips.length?0:null);setDirty(false);stop();}
    }
    async function generate(){const saved=await save();const r=await client.mutate({mutation:TASK,variables:{args:{action:'generate',id:saved.id}}});setJob(r.data.runPluginTask);setJobStatus('Queued');}
    function dialog(title,body,footer,size='lg'){
      return h(Modal,{show:true,onHide:()=>setModal(null),size,centered:true,className:'mc-modal',backdrop:true},
        h(Modal.Header,{closeButton:true},h(Modal.Title,null,title)),h(Modal.Body,null,body),h(Modal.Footer,null,footer));
    }
    return h('main',{className:'mc mc-'+view+(inspectorOpen?' mc-inspecting':'')+(mediaCollapsed?' mc-media-collapsed':''),tabIndex:-1},
      h(api.libraries.ReactRouterDOM.Prompt,{when:dirty,message:'Discard unsaved compilation changes?'}),
      h('header',{className:'mc-header'},
        view==='editor'?button('← Back to compilations',()=>switchView('viewer'),busy,{className:'mc-back'}):h('div',{className:'mc-brand'},h('h1',null,'Marker compilations')),
        view==='editor'?h(React.Fragment,null,h('input',{className:'mc-name','aria-label':'Compilation name',value:doc.name,maxLength:200,disabled:busy,onChange:e=>edit({name:e.target.value})}),
          h('span',{className:'mc-save-state',role:'status'},dirty?'Unsaved':doc.id?'Saved':'New'),
          button('Save',()=>perform(async()=>{await save();setMessage('Compilation saved.');}),busy),button('+ Add markers',()=>setModal('markers'),busy,{className:'mc-primary'})):
          h(React.Fragment,null,h('span',{className:'mc-save-state'},documents.length+' saved'),button('New compilation',()=>{if(choose(blank()))setView('editor');},busy,{className:'mc-primary'}))),
      message&&h('div',{className:'mc-notice',role:'status'},message,button('×',()=>setMessage(''),false,{'aria-label':'Dismiss message'})),
      h('div',{className:'mc-workspace'},
        view==='viewer'&&h('aside',{className:'mc-library','aria-label':'Saved compilations'},h('div',{className:'mc-panel-heading'},h('h2',null,'Saved compilations'),button('Refresh',()=>perform(reload),busy)),
          h('input',{type:'search','aria-label':'Search compilations',placeholder:'Search compilations',value:libraryQuery,onChange:e=>setLibraryQuery(e.target.value)}),
          h('div',{className:'mc-library-list'},documents.filter(d=>d.name.toLowerCase().includes(libraryQuery.toLowerCase())).map(d=>button(h(React.Fragment,null,h('strong',null,d.name),h('small',null,d.clips.length+' clips · '+time(d.clips.reduce((n,c)=>n+patterns.duration(c),0)))),()=>choose(d),busy,{key:d.id,className:'mc-library-item'+(d.id===doc.id?' is-selected':''),'aria-pressed':d.id===doc.id}))),
          !documents.length&&h('p',null,'No saved compilations yet.'),
          doc.id&&h('div',{className:'mc-library-actions'},button('Edit compilation',()=>switchView('editor'),busy),button('Delete compilation',()=>{if(window.confirm('Delete this compilation? Source scenes and markers are kept.'))perform(async()=>{await op({action:'delete',id:doc.id,revision:doc.revision});choose(blank());await load();});},busy))),
        view==='editor'&&h('aside',{className:'mc-media-sidebar','aria-label':'Project media'},
          button(mediaCollapsed?'▸':'◂ Project media',()=>setMediaCollapsed(v=>!v),false,{'aria-label':mediaCollapsed?'Expand project media':'Collapse project media','aria-expanded':!mediaCollapsed,'aria-controls':'mc-project-media'}),
          h('div',{id:'mc-project-media',hidden:mediaCollapsed},h(MediaCatalog,{media,clips:doc.clips,busy,onInsert:insertMedia,onDrop:(key,x,y)=>dropMediaRef.current?.(key,x,y)}))),
        h('section',{className:'mc-monitor',ref:monitor,'aria-label':'Preview viewport'},
          h('div',{className:'mc-monitor-heading'},h('div',null,h('span',{className:'mc-eyebrow'},'COMPILATION PREVIEW'),h('strong',null,trimActive?'Trim: '+clip.title:doc.name)),
            h('div',{className:'mc-inline'},view==='editor'&&h('div',{className:'mc-preview-modes','aria-label':'Preview mode'},button('Compilation',closeInspector,busy,{'aria-pressed':!trimActive}),button('Trim selected clip',showTrim,busy||!clip,{'aria-pressed':trimActive})),!trimActive&&h('select',{'aria-label':'Playback mode',value:mode,disabled:busy,onChange:e=>{stop();setMode(e.target.value);}},h('option',{value:'source'},'Source videos'),h('option',{value:'cache'},'Prepared clips')),
              button(fullscreen?'Exit fullscreen':'Fullscreen',toggleFullscreen,false))),
          h('div',{className:'mc-main-trim',ref:setTrimTarget,hidden:!trimActive}),
          !trimActive&&(player?h(Player,{key:player.key,clips:player.clips,mode:player.mode,seekRequest,onProgress:progress,onActive:activate,onStop:stop,controls:playerControls}):
            h(React.Fragment,null,h('div',{className:'mc-video-surface mc-idle'},poster&&h('img',{src:poster,alt:''}),h('div',null,h('span',{className:'mc-idle-glyph','aria-hidden':true},'▷'),
              h('strong',null,doc.clips.length?'Ready when you are':'Your compilation starts here'),h('p',null,doc.clips.length?'Play the full sequence, or double-click a timeline clip to edit it.':'Add markers to build a timeline of your favourite moments.'),
              !!doc.clips.length&&button('Play compilation',()=>perform(()=>play(0)),busy,{className:'mc-primary'}))),
              h('div',{className:'mc-transport'},button('Play from start',()=>perform(()=>play(0)),busy||!doc.clips.length),h('span',{className:'mc-pass'},'Space to play / pause')))),
          view==='viewer'&&h('div',{className:'mc-monitor-footer'},h('output',{'aria-label':'Preview time'},time(current)+' / '+time(total)),h('span',null,mode==='source'?'Playing from original scenes':'Playing prepared clips'))),
        view==='editor'&&inspectorOpen&&clip&&h('div',{className:'mc-edit-sidebar'},
          h(Inspector,{key:trimSession+':'+String(selected)+':'+(clip?.scene_id||''),onBeforePlay:showTrim,onClose:closeInspector,frameCache,trimControls,trimTarget,clip,busy,onChange:changeClip,onApplyAll:()=>edit({clips:doc.clips.map(c=>({...c,phases:patterns.phases(clip).map(p=>({...p}))}))})}))),
      view==='editor'?h(Timeline,{clips:doc.clips,selected,active,current,busy,onSelect:selectClip,onInspect:inspectClip,onSeek:seek,onMove:move,onRemove:removeClip,onPlay:()=>perform(()=>play(entries[selected].start)),onCache:()=>setModal('cache'),job,onInsertMedia:insertMedia,dropMediaRef}):h('label',{className:'mc-viewer-seek'},'Position',h('input',{'aria-label':'Viewer position',type:'range',min:0,max:total||1,step:.05,value:Math.min(current,total),disabled:busy||!total,onChange:e=>seek(Number(e.target.value))}),h('output',null,time(current)+' / '+time(total))),
      view==='viewer'&&h('footer',{className:'mc-editor-footer'},h('span',null,view==='editor'?'Select a clip to trim or change its pattern.':'Choose a saved compilation and press Space to play.'),button('Prepare clips'+(job?' · generating…':''),()=>setModal('cache'),busy)),
      modal==='unsaved'&&dialog('Unsaved changes',h(React.Fragment,null,h('p',null,'Save your edits before returning to compilations?'),message&&h('p',{role:'alert'},message)),h('div',{className:'mc-inline'},button('Keep editing',()=>setModal(null),busy),button('Discard edits',()=>{choose(documents.find(d=>d.id===doc.id)||blank(),true);setModal(null);setView('viewer');},busy),button('Save and return',()=>perform(async()=>{await save();stop();setModal(null);setView('viewer');}),busy,{className:'mc-primary'}))),
      modal==='markers'&&dialog('Add markers to project',h(React.Fragment,null,
        h('div',{className:'mc-browser-filters'},h(Field,{label:'Search markers'},h('input',{type:'search',value:query,autoFocus:true,onChange:e=>{setQuery(e.target.value);setPage(1);}})),
          h(Field,{label:'Topic / tag'},h('select',{value:tag,onChange:e=>{setTag(e.target.value);setPage(1);}},h('option',{value:''},'All tags'),tags.map(t=>h('option',{key:t.id,value:t.id},t.name))))),
        h('details',{className:'mc-add-options'},h('summary',null,'Options for added clips'),
          h('div',{className:'mc-browser-filters'},h(Field,{label:'Duration without an end (seconds)'},h('input',{type:'number',min:.1,step:.1,value:defaultDuration,onChange:e=>setDefaultDuration(e.target.value)})),
            h(Field,{label:'Default pattern for imported markers'},h('select',{value:defaultPattern,onChange:e=>setDefaultPattern(e.target.value)},presetOptions())))),
        h('p',{className:'mc-muted',role:'status'},loading?'Loading markers…':count+' markers'),
        message&&h('p',{role:'status'},message),
        h('div',{className:'mc-marker-grid'},!loading&&!markers.length&&h('p',null,'No markers match these filters.'),markers.map(m=>h('article',{key:m.id,className:'mc-marker'},
          h('img',{src:m.screenshot,alt:'',loading:'lazy'}),h('div',null,h('strong',null,m.title||m.primary_tag.name),h('p',null,m.scene.title||'Scene '+m.scene.id),h('small',null,time(m.seconds)+' → '+(m.end_seconds>m.seconds?time(m.end_seconds):'default duration'))),button(media.some(c=>String(c.marker_id)===String(m.id))?'✓ In project':'+ Add',()=>add(m),busy||media.some(c=>String(c.marker_id)===String(m.id)),{'aria-label':(media.some(c=>String(c.marker_id)===String(m.id))?'In project: ':'Add ')+(m.title||m.primary_tag.name)})))),
        h('div',{className:'mc-pagination'},button('Previous page',()=>setPage(page-1),page===1||loading),h('span',null,'Page '+page),button('Next page',()=>setPage(page+1),page*24>=count||loading))),
        h(React.Fragment,null,h('span',{role:'status'},media.length+' markers in project'),button('Done',()=>setModal(null),false,{className:'mc-primary'})),'xl'),
      modal==='cache'&&dialog('Prepare clips for playback',h(React.Fragment,null,h('p',null,'Optional: create a separate video file for each trimmed interval. This can help when playing the original source videos is unreliable, but uses extra disk space.'),
        h('p',null,'For normal playback, leave the player on Source videos; no preparation is needed. After generating, choose Prepared clips in the player. This does not export a single compilation movie.'),
        h(Field,{label:'Maximum clip width'},h('select',{value:doc.width,disabled:busy,onChange:e=>edit({width:Number(e.target.value)})},[640,1280,1920].map(w=>h('option',{key:w,value:w},w+' px')))),
        h('label',null,h('input',{type:'checkbox',checked:doc.audio,disabled:busy,onChange:e=>edit({audio:e.target.checked})}),' Include audio'),
        h('p',{role:'status'},jobStatus),message&&h('p',{role:'status'},message),
        h('div',{className:'mc-inline'},button('Generate clips',()=>perform(generate),busy||!!job||!doc.clips.length,{className:'mc-primary'}),job&&button('Cancel generation',()=>perform(async()=>{await client.mutate({mutation:gql`mutation($id:ID!){stopJob(job_id:$id)}`,variables:{id:job}});}),busy))),button('Done',()=>setModal(null),false)));
  }
  api.register.route('/marker-compilations',Page);
  api.patch.before('MainNavBar.MenuItems',props=>[{...props,children:h(React.Fragment,null,props.children,
    h(api.libraries.Bootstrap.Nav.Link,{as:'div',eventKey:'/marker-compilations',className:'col-4 col-sm-3 col-md-2 col-lg-auto'},
      h(api.libraries.Bootstrap.Button,{as:api.libraries.ReactRouterDOM.NavLink,to:'/marker-compilations',exact:true,className:'minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center mc-nav-link'},
        h('svg',{className:'svg-inline--fa fa-icon nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0 mc-nav-icon',viewBox:'0 0 24 24',fill:'currentColor','aria-hidden':true},
          h('path',{d:'M3 3h18v18H3V3zm2 2v3h2V5H5zm12 0v3h2V5h-2zM5 10v4h2v-4H5zm12 0v4h2v-4h-2zM5 16v3h2v-3H5zm12 0v3h2v-3h-2zM10 8v8l6-4-6-4z'})),
        h('span',null,'Compilations'))))}]);
  api.patch.before('SettingsToolsSection',props=>[{...props,children:h(React.Fragment,null,props.children,h(api.components.Setting,{heading:h(Link,{to:'/marker-compilations'},'Open Marker Compilations')}))}]);
})();
