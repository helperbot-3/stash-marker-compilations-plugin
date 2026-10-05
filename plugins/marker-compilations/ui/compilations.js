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
  const RENDER_TASK = gql`mutation RenderCompilation($args:Map!){runPluginTask(plugin_id:"marker-compilations",task_name:"Render compilation video",args_map:$args)}`;
  const TASK = gql`mutation CompilationGenerate($args:Map!){runPluginTask(plugin_id:"marker-compilations",task_name:"Generate compilation clips",args_map:$args)}`;
  const MARKERS = gql`query CompilationMarkers($filter:FindFilterType,$markers:SceneMarkerFilterType){findSceneMarkers(filter:$filter,scene_marker_filter:$markers){count scene_markers{id title seconds end_seconds screenshot primary_tag{id name} tags{id name} scene{id title files{duration}}}}}`;
  const TAGS = gql`query CompilationTags{findTags(filter:{per_page:-1,sort:"name",direction:ASC}){tags{id name}}}`;
  const JOB = gql`query CompilationJob($id:ID!){findJob(input:{id:$id}){id status progress error}}`;
  const blank = () => ({name:'Untitled compilation',clips:[],media:[],width:1280,audio:true});
  const time = seconds => {const s=Math.floor(Math.max(0,seconds||0)),pad=n=>String(n).padStart(2,'0');return pad(Math.floor(s/3600))+':'+pad(Math.floor(s/60)%60)+':'+pad(s%60);};
  const button = (text, onClick, disabled, props) => h('button', Object.assign({type:'button',onClick,disabled:!!disabled},props),text);
  const presetOptions=(custom=[])=>[
    h('optgroup',{key:'built-in',label:'Built-in'},Object.entries(patterns.presetLabels).map(([value,label])=>h('option',{key:value,value},label))),
    custom.length>0&&h('optgroup',{key:'saved',label:'Saved patterns'},custom.map(p=>h('option',{key:p.id,value:'custom:'+p.id},p.name)))];
  const presetPhases=(key,custom)=>key.startsWith('custom:')?custom.find(p=>p.id===key.slice(7))?.phases:patterns.presets[key];
  function Field({label,children}) {return h('label',{className:'mc-field'},h('span',null,label),children);}

  function TimeField({label,displayLabel,value,disabled,onChange,onFocus,fps}) {
    const [draft,setDraft]=useState(()=>patterns.frameTime(value,fps)), [error,setError]=useState('');
    useEffect(()=>{setDraft(patterns.frameTime(value,fps));setError('');},[value,fps]);
    function commit(){
      if(draft===patterns.frameTime(value,fps))return;
      const seconds=patterns.parseFrameTime(draft,fps);
      if(seconds===null){setDraft(patterns.frameTime(value,fps));setError('Use HH:MM:SS:FF with a valid frame number.');return;}
      setError('');setDraft(patterns.frameTime(seconds,fps));
      if(seconds!==value&&onChange(seconds)===false)setDraft(patterns.frameTime(value,fps));
    }
    return h(Field,{label:displayLabel||label},h('input',{type:'text','aria-label':label,value:draft,disabled:disabled||!fps,onFocus,placeholder:'00:00:00:00',spellCheck:false,
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
    const start=cached?(clip.cacheOffset||0):clip.start, end=cached?start+clip.end-clip.start:clip.end;
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
            h('span',{className:'mc-phase-strip'},patterns.phases(c).map((p,n)=>h('i',{key:n,className:p.speed<1?'is-slow':'',style:{flex:patterns.phaseDurations(c)[n]},title:p.repeat+' × '+p.speed+' speed'}))));})),
        total>0&&h('div',{className:'mc-playhead',style:{left:Math.min(current,total)*scale},'aria-hidden':true},h('span',null)))));
  }

  function TrimPreview({clip,onChange,onBeforePlay,controls,busy,target,frameCache,captureWhilePlaying=false,onBoundaryMarked,onCapture,initialPosition,directMarkers=false}) {
    const client=useApolloClient(), video=useRef(null), pending=useRef(initialPosition??clip.start), limit=useRef(null);
    const [streams,setStreams]=useState([]), [stream,setStream]=useState(0), [duration,setDuration]=useState(0);
    const latestClip=useRef({clip,onChange});latestClip.current={clip,onChange};
    const start=clip.start, end=clip.end;
    const [zoneSelection,setZoneSelection]=useState(0);
    const zones=patterns.identifiedZones(clip),zoneIndex=Math.min(zoneSelection,Math.max(0,zones.length-1)),zone=zones[zoneIndex];
    function changeBoundary(which,value){const adjusted=patterns.adjustedRange(latestClip.current.clip,{[which]:value},0,duration||Infinity);if(!adjusted)return false;const result=latestClip.current.onChange({start:adjusted.start,end:adjusted.end});if(result!==false)onBoundaryMarked?.(which);return result;}
    function updateZone(patch){
      const updated=patterns.adjustedRange(zone,patch,start,end,zones.filter((_,i)=>i!==zoneIndex));
      if(!updated){setError('Choose a time inside the clip and outside other zones.');return false;}setError('');
      const next=zones.map((z,i)=>i===zoneIndex?updated:z).sort((a,b)=>a.start-b.start);
      const accepted=onChange({hot_zone:null,hot_zones:next});
      if(accepted!==false)setZoneSelection(next.indexOf(updated));return accepted;
    }
    function addZone(){const added=patterns.newHotZone(clip,position);if(!added)return;added.id=patterns.uniqueId();const next=zones.concat(added).sort((a,b)=>a.start-b.start);if(onChange({hot_zone:null,hot_zones:next})!==false)setZoneSelection(next.indexOf(added));}

    const [position,setPosition]=useState(clip.start);
    const navigation=useRef(null), inputQueue=useRef(Promise.resolve()), navigationGeneration=useRef(0),queuedNavigation=useRef(0),captureTasks=useRef(Promise.resolve());
    if(!navigation.current)navigation.current=patterns.seekQueue(()=>video.current?.currentTime||0,value=>{setSeeking(true);video.current.currentTime=value+.00001;},setPosition);
    useEffect(()=>()=>{navigationGeneration.current++;navigation.current.reset();},[]);
    const [fps,setFps]=useState(null), [frameBusy,setFrameBusy]=useState(false), [frameError,setFrameError]=useState('');
    const frameData=useRef(null), frameRequest=useRef(0), warming=useRef(null), framePending=useRef(null);
    const [step,setStep]=useState(5), [playing,setPlaying]=useState(false), [ready,setReady]=useState(false), [seeking,setSeeking]=useState(true), [error,setError]=useState('');
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
      const v=video.current;if(!v||!ready||busy)return;
      onBeforePlay();if(!captureWhilePlaying)v.pause();limit.current=null;
      const point=navigation.current.position(), count=direction*amount, generation=navigationGeneration.current;
      let next=patterns.frameStep(frameData.current,point,count);
      if(next===null){const data=await loadFrames(point);if(!data)return;next=patterns.frameStep(data,point,count);}
      if(generation!==navigationGeneration.current)return;
      if(next!==null)seek(next,true);
      else setFrameError('Could not locate the next frame in this source.');
    }
    function seek(value,frame=false){
      const v=video.current;if(!v||!ready)return;
      onBeforePlay();if(!captureWhilePlaying)v.pause();limit.current=null;const target=Math.max(0,Math.min(duration,value));
      navigation.current.request(target);
    }
    function enqueueStep(action,cancelOnNavigation=true){
      const generation=navigationGeneration.current;
      inputQueue.current=inputQueue.current.then(()=>!cancelOnNavigation||generation===navigationGeneration.current?action():null).catch(e=>setFrameError(e.message));return inputQueue.current;
    }
    function stepSecond(direction){if(video.current&&ready&&!busy){navigationGeneration.current++;seek(navigation.current.position()+direction);}}
    function loaded(){
      navigation.current.reset();
      const v=video.current;
      if(!Number.isFinite(v.duration)||v.duration<=0){setError('This stream does not provide a seekable duration. Choose another stream.');return;}
      setDuration(v.duration);setReady(true);setError('');
      const target=Math.min(pending.current,v.duration);v.currentTime=target;setPosition(target);setSeeking(v.seeking);
    }
    function update(){const v=video.current;if(!v)return;setPosition(navigation.current.position());if(limit.current!=null&&v.currentTime>=limit.current){v.pause();v.currentTime=limit.current;limit.current=null;}}
    useEffect(()=>{let frame;function tick(){if(video.current&&!video.current.paused)update();frame=requestAnimationFrame(tick);}frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[]);
    useEffect(()=>{
      const v=video.current;if(!v?.requestVideoFrameCallback)return;
      let token,disposed=false;
      function frame(now,info){if(disposed)return;if(!v.paused)setPosition(info.mediaTime);token=v.requestVideoFrameCallback(frame);}
      token=v.requestVideoFrameCallback(frame);return()=>{disposed=true;v.cancelVideoFrameCallback(token);};
    },[target,stream]);
    function play(selection,zone=null){
      const v=video.current;if(!v||!ready)return;
      if(selection){navigationGeneration.current++;navigation.current.reset();}
      onBeforePlay();limit.current=selection?(zone?.end??end):null;
      if(selection){v.currentTime=zone?.start??start;setPosition(zone?.start??start);}
      v.play().catch(()=>setError('Playback could not start. Try another source stream.'));
    }
    async function mark(which,captured=null){
      const v=video.current;if(!v||(captured===null&&v.seeking)||(frameBusy&&!captureWhilePlaying))return false;
      if(!captureWhilePlaying)v.pause();limit.current=null;const current=captured??v.currentTime;
      if(onCapture&&!which.startsWith('hot_')){
        // Record the keypress immediately; capture must not wait for frame probes or saving.
        const point=patterns.frameStep(frameData.current,current,0)??current;
        const task=Promise.resolve(onCapture(which,point)).catch(e=>setError('Marker capture failed: '+e.message));
        captureTasks.current=Promise.all([captureTasks.current,task]);
        return true;
      }
      let data=frameData.current, point=patterns.frameStep(data,current,0);
      if(point===null){data=await loadFrames(current);if(!data)return false;point=patterns.frameStep(data,current,0);}
      if(point===null)return false;
      if(onCapture&&!which.startsWith('hot_'))return await onCapture(which,point);
      setPosition(point);return which.startsWith('hot_')?updateZone({[which.slice(4)]:point})!==false:changeBoundary(which,point)!==false;
    }
    const valid=ready&&start>=0&&end>start&&end<=duration;
    useEffect(()=>{controls.current={
      position:()=>ready?navigation.current.position():null,
      mark:which=>{const afterNavigation=queuedNavigation.current>0,captured=navigation.current.position();return enqueueStep(()=>mark(which,afterNavigation?navigation.current.position():captured),false);},flush:async()=>{await inputQueue.current;await captureTasks.current;},seek:position=>seek(position),
      preview:p=>{const ranges=patterns.stepRanges(clip,p.target);if(ranges.length)seek(ranges[0].start);},
      pause:()=>video.current?.pause(),
      toggle:()=>{const v=video.current;if(!v||!ready||busy)return;if(v.paused)play(false);else v.pause();},
      frame:direction=>{queuedNavigation.current++;return enqueueStep(()=>stepFrames(direction)).finally(()=>queuedNavigation.current--);},
      second:direction=>stepSecond(direction)
    };return()=>{controls.current=null;};});
    return h('section',{className:'mc-trimmer','aria-label':'Source trim'},
      h('div',{className:'mc-clip-trim'},
      h('h3',null,'Trim',h('span',{className:'mc-fps',title:'Source frame rate. HH:MM:SS:FF non-drop-frame timecode.'},fps?Number(fps.toFixed(3))+' fps':'Reading frame rate…')),
      target&&api.ReactDOM.createPortal(h('div',{className:'mc-trim-preview'},h('video',{ref:video,src:streams[stream]?.url,preload:'auto',playsInline:true,controls:true,onLoadedMetadata:loaded,
        onTimeUpdate:update,onPlay:()=>{onBeforePlay();setPlaying(true);},onPause:()=>setPlaying(false),onSeeking:()=>setSeeking(true),onSeeked:()=>{if(navigation.current.settled()){setSeeking(false);update();warmFrames(video.current.currentTime);}},
        onError:()=>{setReady(false);setError('Source unavailable. Try another stream.');}})),target),
      error&&h('p',{role:'alert'},error),
      h('div',{className:'mc-trim-controls'},
        button(playing?'Ⅱ':'▶',()=>playing?video.current.pause():play(false),!ready||busy,{'aria-label':playing?'Pause source preview':'Play source preview'}),
        !onCapture&&button('Play range',()=>play(true),!valid||busy),
        h('div',{className:'mc-step-controls'},
        button('−',()=>enqueueStep(()=>stepFrames(-1)),!ready||busy,{'aria-label':'Step backward',title:'Step backward '+step+' frame(s)'}),
        h('select',{'aria-label':'Fine adjustment step',value:step,onChange:e=>setStep(Number(e.target.value))},[1,5,10].map(s=>h('option',{key:s,value:s},s+' frame'+(s===1?'':'s')))),
        button('+',()=>enqueueStep(()=>stepFrames(1)),!ready||busy,{'aria-label':'Step forward',title:'Step forward '+step+' frame(s)'})),
        h('output',{'aria-label':'Trim preview time'},patterns.frameTime(position,fps))),
      h('input',{'aria-label':'Source position',className:'mc-trim-slider',type:'range',style:captureWhilePlaying&&duration?{background:'linear-gradient(to right, #36404c '+(start/duration*100)+'%, #efbd74 '+(start/duration*100)+'%, #efbd74 '+(end/duration*100)+'%, #36404c '+(end/duration*100)+'%)'}:undefined,min:0,max:duration||1,step:.001,value:Math.min(position,duration),disabled:!ready||busy,onChange:e=>seek(Number(e.target.value))}),
      onCapture&&h('div',{className:'mc-capture-buttons'},button(directMarkers?'Start marker (I)':'Start highlight (I)',()=>controls.current?.mark('start'),!ready||busy),button(directMarkers?'Save marker (O)':'Finish highlight (O)',()=>controls.current?.mark('end'),!ready||busy)),
      !onCapture&&h('div',{className:'mc-boundary-row'},h(TimeField,{label:'Start',value:start,fps,disabled:busy,onFocus:onBeforePlay,onChange:start=>changeBoundary('start',start)}),
        button('↦',()=>seek(start),!ready||busy,{'aria-label':'Jump to start',title:'Jump to start'}),button(captureWhilePlaying?'Set start (I)':'Set',()=>mark('start'),!ready||seeking||busy||frameBusy,{'aria-label':'Set start here'})),
      !onCapture&&h('div',{className:'mc-boundary-row'},h(TimeField,{label:'End',value:end,fps,disabled:busy,onFocus:onBeforePlay,onChange:end=>changeBoundary('end',end)}),
        button('↦',()=>seek(end),!ready||busy,{'aria-label':'Jump to end',title:'Jump to end'}),button(captureWhilePlaying?'Set end (O)':'Set',()=>mark('end'),!ready||seeking||busy||frameBusy,{'aria-label':'Set end here'}))),
      !onCapture&&h(captureWhilePlaying?'details':'div',{className:'mc-hot-zone'},
        captureWhilePlaying&&h('summary',null,'Hot zones (optional)'),
        h('div',{className:'mc-hot-heading'},h('h3',null,'Hot zones'),
          button('+ Zone',addZone,busy||!patterns.newHotZone(clip,position),{'aria-label':'Add hot zone'}),
          zone&&button('Play zone',()=>play(true,zone),!valid||busy,{'aria-label':'Play hot zone'})),
        zones.length>0&&h('div',{className:'mc-zone-tabs'},zones.map((z,i)=>button(String(i+1),()=>setZoneSelection(i),busy,{key:i,'aria-label':'Select hot zone '+(i+1),'aria-pressed':i===zoneIndex,title:patterns.frameTime(z.start,fps)+' – '+patterns.frameTime(z.end,fps)})),
          h('input',{'aria-label':'Zone name',placeholder:'Zone name',value:zone.name||'',maxLength:80,disabled:busy,onChange:e=>updateZone({name:e.target.value})}),
          button('Remove',()=>onChange({hot_zone:null,hot_zones:zones.filter((_,i)=>i!==zoneIndex)}),busy||patterns.sequence(clip).some(p=>p.target==='zone:'+zone?.id),{'aria-label':'Remove selected hot zone',title:'Reassign or remove steps using this zone before deleting it'})),
        zone&&h(React.Fragment,null,
          ['start','end'].map(boundary=>h('div',{className:'mc-boundary-row',key:boundary},
            h(TimeField,{label:'Hot '+boundary,displayLabel:boundary==='start'?'Start':'End',value:zone[boundary],fps,disabled:busy,onFocus:onBeforePlay,onChange:value=>updateZone({[boundary]:value})}),
            button('↦',()=>seek(zone[boundary]),!ready||busy,{'aria-label':'Jump to hot zone '+boundary}),
            button('Set',()=>mark('hot_'+boundary),!ready||seeking||busy||frameBusy,{'aria-label':'Set hot zone '+boundary+' here'}))),
          null)),
      frameError&&h('p',{role:'alert'},frameError),
      ready&&!valid&&h('p',{role:'alert'},'Choose start < end within the source.'),
      streams.length>1&&h('details',{className:'mc-stream-options'},h('summary',null,'Playback source'),h('select',{'aria-label':'Trim source stream',value:stream,disabled:busy,onChange:e=>{pending.current=position;navigationGeneration.current++;navigation.current.reset();video.current.pause();limit.current=null;setReady(false);setSeeking(true);setStream(Number(e.target.value));}},streams.map((s,i)=>h('option',{key:i,value:i},s.label||s.mime_type)))));
  }

  function SequenceEditor({clip,onChange,disabled,onPreview,onPlay}) {
    const steps=patterns.sequence(clip),zones=patterns.identifiedZones(clip);
    const [selected,setSelected]=useState(0),drag=useRef(null);
    const index=Math.min(selected,steps.length-1),step=steps[index];
    const options=[['full','Full clip'],['hot','All hot zones'],...zones.map((z,i)=>['zone:'+z.id,z.name||'Hot zone '+(i+1)])];
    const label=target=>options.find(o=>o[0]===target)?.[1]||'Choose range';
    const shortLabel=target=>target==='full'?'Full':target==='hot'?'All':zones.some(z=>'zone:'+z.id===target)?String(zones.findIndex(z=>'zone:'+z.id===target)+1):'?';
    const color=target=>target==='full'?'#94a7b8':target==='hot'?'#efbd74':['#edaf73','#75bdb6','#b59ddd','#aabd75'][Math.max(0,zones.findIndex(z=>'zone:'+z.id===target))%4];
    function update(patch){onChange(steps.map((p,i)=>i===index?{...p,...patch}:p));}
    function move(from,to){if(disabled||to<0||to>=steps.length)return;onChange(patterns.reorder(steps,from,to));setSelected(to);}
    function remove(){if(steps.length===1)return;onChange(steps.filter((_,i)=>i!==index));setSelected(Math.max(0,index-1));}
    function duplicate(){if(steps.length>=200)return;const next=steps.slice();next.splice(index+1,0,{...step});onChange(next);setSelected(index+1);}
    return h('section',{className:'mc-sequence','aria-label':'Playback sequence'},
      h('div',{className:'mc-sequence-track'},steps.map((p,i)=>h('button',{type:'button',key:i,disabled,draggable:!disabled,'aria-label':'Step '+(i+1)+': '+label(p.target),'aria-pressed':i===index,title:label(p.target),style:{'--step-color':color(p.target)},
        onFocus:()=>setSelected(i),onClick:()=>{setSelected(i);onPreview?.(p);},onDragStart:e=>{drag.current=i;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i));},onDragOver:e=>e.preventDefault(),onDrop:e=>{e.preventDefault();if(drag.current!==null)move(drag.current,i);drag.current=null;},onDragEnd:()=>{drag.current=null;},
        onKeyDown:e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();remove();}else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='d'){e.preventDefault();e.stopPropagation();duplicate();}}},
        h('strong',null,shortLabel(p.target)),h('span',{className:'mc-step-badges'},p.repeat!==1&&h('small',null,'↻'+p.repeat),p.speed!==1&&h('small',null,p.speed+'×'))))),
      step&&h('div',{className:'mc-step-fields'},
        h(Field,{label:'Range'},h('select',{'aria-label':'Step range',value:step.target,disabled,onChange:e=>update({target:e.target.value})},!options.some(o=>o[0]===step.target)&&h('option',{value:step.target},'Choose range…'),options.map(([value,name])=>h('option',{key:value,value},name)))),
        h(Field,{label:'Repeats'},h('input',{'aria-label':'Step repeats',type:'number',min:1,max:20,value:step.repeat,disabled,onChange:e=>update({repeat:Math.max(1,Math.min(20,Number(e.target.value)||1))})})),
        h(Field,{label:'Speed'},h('select',{'aria-label':'Step speed',value:step.speed,disabled,onChange:e=>update({speed:Number(e.target.value)})},[.25,.5,.75,1,1.25,1.5,2,3].map(rate=>h('option',{key:rate,value:rate},rate+'×'))))),
      h('div',{className:'mc-sequence-actions'},button('+ Step',()=>{onChange(steps.concat({target:'full',repeat:1,speed:1}));setSelected(steps.length);},disabled||steps.length>=200),button('Duplicate',duplicate,disabled||steps.length>=200),button('←',()=>move(index,index-1),disabled||index===0,{'aria-label':'Move step earlier'}),button('→',()=>move(index,index+1),disabled||index===steps.length-1,{'aria-label':'Move step later'}),button('Remove',remove,disabled||steps.length===1,{'aria-label':'Remove step'}),onPlay&&button('Play sequence',onPlay,disabled||patterns.missingRanges(clip))),
      patterns.missingRanges(clip)&&h('small',{role:'alert'},'Choose a range for each missing zone before playback.'));
  }

  function PatternManager({initial,items,onSave,onDelete,zoneCount=0}) {
    const fresh=()=>({name:'',phases:patterns.sequence({phases:initial})});
    const [draft,setDraft]=useState(fresh), [working,setWorking]=useState(false), [error,setError]=useState('');
    const patch=update=>{setDraft(d=>({...d,...update}));setError('');};
    async function save(value=draft){setWorking(true);setError('');try{setDraft(await onSave(value));}catch(e){setError(e.message);}finally{setWorking(false);}}
    function saveAsNew(){
      const names=new Set(items.map(p=>p.name.trim().toLowerCase()));
      let name=draft.name.trim(), n=1;
      while(names.has(name.toLowerCase())){const suffix=' copy'+(n===1?'':' '+n);name=draft.name.trim().slice(0,100-suffix.length)+suffix;n++;}
      return save({name,phases:draft.phases.map(p=>({...p}))});
    }
    async function remove(){setWorking(true);setError('');try{await onDelete(draft);setDraft(fresh());}catch(e){setError(e.message);}finally{setWorking(false);}}
    return h('section',{'aria-label':'Custom repetition patterns',className:'mc-pattern-manager'},
      h(Field,{label:'Saved pattern'},h('select',{value:draft.id||'',disabled:working,onChange:e=>{const item=items.find(p=>p.id===e.target.value);setDraft(item?{...item,phases:patterns.sequence(item)}:fresh());setError('');}},
        h('option',{value:''},'New pattern'),items.map(p=>h('option',{key:p.id,value:p.id},p.name)))),
      h(Field,{label:'Pattern name'},h('input',{type:'text',value:draft.name,maxLength:100,disabled:working,onChange:e=>patch({name:e.target.value})})),
      h(SequenceEditor,{clip:{phases:draft.phases.map(p=>({...p,target:p.target.startsWith('slot:')?'zone:'+p.target:p.target})),hot_zones:Array.from({length:Math.max(zoneCount,...draft.phases.map(p=>p.target?.startsWith('slot:')?Number(p.target.slice(5)):0))},(_,i)=>({id:'slot:'+(i+1),start:i,end:i+1}))},disabled:working,onChange:phases=>patch({phases:phases.map(p=>({...p,target:p.target.replace(/^zone:slot:/,'slot:')}))})}),
      h('div',{className:'mc-inline'},
        button(draft.id?'Update pattern':'Save pattern',()=>save(),working||!draft.name.trim(),{className:'mc-primary'}),
        draft.id&&button('Save as new',saveAsNew,working||!draft.name.trim()),
        draft.id&&button('Delete pattern',remove,working)),
      h('p',{className:'mc-pattern-note'},'Patterns are shared across compilations. Applying one copies its sequence; later changes do not alter existing clips or their hot zones.'),
      error&&h('p',{role:'alert'},error));
  }

  function Inspector({clip,busy,onChange,onApplyAll,onBeforePlay,trimControls,trimTarget,onClose,frameCache,customPatterns,onManagePatterns,onPlaySequence,onSaveMarker}) {
    if(!clip)return h('aside',{className:'mc-inspector','aria-label':'Clip settings'},h('div',{className:'mc-panel-heading'},h('h2',null,'Inspector')),h('div',{className:'mc-inspector-empty'},'Select a timeline clip to edit.'));
    const phases=patterns.phases(clip);
    return h('aside',{className:'mc-inspector','aria-label':'Clip settings'},
      h('div',{className:'mc-panel-heading'},h('h2',null,clip.title),h(Link,{to:'/scenes/'+clip.scene_id,title:'Open source scene'},'Source ↗'),button('×',onClose,false,{'aria-label':'Close clip inspector',title:'Back to timeline (Escape)'})),
      h('div',{className:'mc-marker-save-actions'},clip.marker_id&&button('Update original marker',()=>onSaveMarker('update'),busy,{className:'mc-primary'}),button('Save as new marker',()=>onSaveMarker('new'),busy),h(Link,{to:'/marker-creation?scene='+clip.scene_id},'Marker creation mode ↗')),
      h('div',{className:'mc-inspector-columns'},
        h(TrimPreview,{clip,onChange,onBeforePlay,controls:trimControls,busy,target:trimTarget,frameCache}),
        h('section',{className:'mc-pattern','aria-label':'Repeat and speed'},h('div',{className:'mc-sequence-heading'},h('h3',null,'Sequence'),
          h('select',{'aria-label':'Apply a preset',value:'',disabled:busy,onChange:e=>{if(e.target.value)onChange({phases:patterns.applySequence(presetPhases(e.target.value,customPatterns),clip),hot_zones:patterns.identifiedZones(clip)});}},
            h('option',{value:''},'Preset…'),presetOptions(customPatterns))),
          h(SequenceEditor,{clip,disabled:busy,onChange:phases=>onChange({phases,hot_zones:patterns.identifiedZones(clip)}),onPreview:p=>trimControls.current?.preview(p),onPlay:onPlaySequence}),
          h('div',{className:'mc-pattern-actions'},button('Apply to all clips',onApplyAll,busy,{className:'mc-apply-pattern'}),
          button('Save / manage patterns',onManagePatterns,busy,{className:'mc-manage-patterns'})))));
  }

  function markerPreferences(){try{return JSON.parse(localStorage.getItem('mc-marker-preferences')||'{}');}catch{return {};}}
  function rememberMarkerTag(id){try{const prefs=markerPreferences();localStorage.setItem('mc-marker-preferences',JSON.stringify({...prefs,last:id,recent:[id,...(prefs.recent||[]).filter(t=>t!==id)].slice(0,6)}));}catch{}}
  async function markerOp(client,args){const result=await client.mutate({mutation:OP,variables:{args}});return result.data.runPluginOperation;}
  function MarkerFields({tags,value,onChange,disabled}){
    const [search,setSearch]=useState(''),[pins,setPins]=useState(()=>markerPreferences().pins||[]);
    const primary=tags.find(t=>t.id===value.primary), recent=markerPreferences().recent||[];
    const choices=tags.filter(t=>t.id===value.primary||t.name.toLowerCase().includes(search.toLowerCase())).slice(0,150);
    if(primary&&!choices.some(t=>t.id===primary.id))choices.unshift(primary);
    function pin(){const next=pins.includes(value.primary)?pins.filter(id=>id!==value.primary):pins.concat(value.primary);setPins(next);try{localStorage.setItem('mc-marker-preferences',JSON.stringify({...markerPreferences(),pins:next}));}catch{}}
    return h('div',{className:'mc-marker-fields'},
      h(Field,{label:'Title (optional)'},h('input',{'aria-label':'Marker title',value:value.title,placeholder:primary?.name||'Uses the primary tag name',disabled,maxLength:300,onChange:e=>onChange({...value,title:e.target.value})})),
      h('div',{className:'mc-marker-tag-shortcuts'},[...new Set([...pins,...recent])].map(id=>{const tag=tags.find(t=>t.id===id);return tag&&button((pins.includes(id)?'★ ':'')+tag.name,()=>onChange({...value,primary:id}),disabled,{key:id,'aria-pressed':id===value.primary});})),
      h(Field,{label:'Find a tag'},h('input',{type:'search','aria-label':'Find marker tag',value:search,disabled,onChange:e=>setSearch(e.target.value),placeholder:'Search tags…'})),
      h('div',{className:'mc-inline'},h(Field,{label:'Primary tag'},h('select',{'aria-label':'Marker primary tag',value:value.primary,disabled,onChange:e=>onChange({...value,primary:e.target.value})},h('option',{value:''},'Choose a tag'),choices.map(t=>h('option',{key:t.id,value:t.id},t.name)))),button(pins.includes(value.primary)?'★':'☆',pin,disabled||!value.primary,{'aria-label':pins.includes(value.primary)?'Unpin marker tag':'Pin marker tag',title:'Keep this tag in the shortcut row'})),
      h('details',null,h('summary',null,'Additional tags'+(value.tag_ids.length?' · '+value.tag_ids.length:'')),h('select',{multiple:true,'aria-label':'Additional marker tags',value:value.tag_ids,disabled,onChange:e=>onChange({...value,tag_ids:Array.from(e.target.selectedOptions,o=>o.value)})},tags.filter(t=>t.id!==value.primary).map(t=>h('option',{key:t.id,value:t.id},t.name)))));
  }
  function MarkerSaveForm({clip,mode,onSaved}){
    const client=useApolloClient(),[tags,setTags]=useState([]),[expected,setExpected]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
    const [value,setValue]=useState({title:clip.title||'',primary:markerPreferences().last||'',tag_ids:[]});
    useEffect(()=>{let disposed=false;async function load(){try{
      const tagResult=await client.query({query:TAGS,fetchPolicy:'network-only'});if(disposed)return;setTags(tagResult.data.findTags.tags);
      if(clip.marker_id){try{const context=await markerOp(client,{action:'marker_context',scene_id:clip.scene_id,marker_id:clip.marker_id});if(disposed)return;setExpected(context.marker);setValue({title:clip.title||context.marker.title,primary:context.marker.primary_tag.id,tag_ids:context.marker.tags.map(t=>t.id)});}catch(e){if(!disposed)setError(mode==='update'?e.message:'Original marker unavailable. Choose tags for the new marker.');}}
    }catch(e){if(!disposed)setError(e.message);}finally{if(!disposed)setBusy(false);}}load();return()=>{disposed=true;};},[]);
    async function save(){setBusy(true);setError('');try{const result=await markerOp(client,{action:'save_marker',mode,clip,title:value.title.trim()||tags.find(t=>t.id===value.primary)?.name||'',primary_tag_id:value.primary,tag_ids:value.tag_ids,expected});rememberMarkerTag(value.primary);onSaved(result.marker);}catch(e){setError(e.message);}finally{setBusy(false);}}
    return h('section',{'aria-label':'Save reusable marker'},
      h('p',null,time(clip.start)+' → '+time(clip.end)+' · '+patterns.hotZones(clip).length+' hot zones'),
      h(MarkerFields,{tags,value,onChange:setValue,disabled:busy}),
      h('p',{className:'mc-muted'},mode==='update'?'Updates the original Stash marker and its reusable hot zones. Existing timeline clips keep their saved ranges.':'Creates a new Stash marker with this range, tags and hot zones. The original marker is kept.'),
      h('p',{className:'mc-muted'},'Repeat patterns stay with the compilation.'),error&&h('p',{role:'alert'},error),
      button(mode==='update'?'Update original marker':'Save as new marker',save,busy||!value.primary||(mode==='update'&&!expected),{className:'mc-primary'}));
  }

  function pollActiveExports(fetch,update,onError){
    let disposed=false,timer;
    async function poll(){
      let active=true;
      try{const items=await fetch();if(disposed)return;update(items);active=items.some(item=>['queued','rendering','importing'].includes(item.status));}
      catch(error){if(disposed)return;onError(error);}
      if(active&&!disposed)timer=setTimeout(poll,4000);
    }
    timer=setTimeout(poll,4000);
    return()=>{disposed=true;clearTimeout(timer);};
  }

  function restoreMarkerPlaybackFocus(workspace){
    const root=workspace.current,active=document.activeElement;
    if(root&&active instanceof Element&&root.contains(active)&&active.matches('video,input[type="range"],[role="slider"]'))root.focus({preventScroll:true});
  }

  function markerKeyboard({controls,save,busy,enabled,focus,captured}){
    const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
    function key(e){
      if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey)return;
      const target=e.target,k=e.key.toLowerCase();
      const editing=target instanceof Element&&(target.isContentEditable||target.closest('textarea,select,[role="textbox"],input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])'));
      if(k==='escape'&&editing){consume(e);focus();return;}
      if(editing||busy||!enabled)return;
      let action;
      if(k==='i'||k==='o')action=()=>controls.current?.mark(k==='i'?'start':'end');
      else if(k===' ')action=()=>controls.current?.toggle();
      else if(k==='arrowleft'||k==='arrowright')action=()=>controls.current?.second(k==='arrowleft'?-1:1);
      else if(k==='arrowup'||k==='arrowdown')action=()=>controls.current?.frame(k==='arrowup'?1:-1);
      else if(k==='enter')action=save;
      if(!action)return;consume(e);captured.add(k);if(k===' ')focus();
      if(!e.repeat||k.startsWith('arrow'))action();
    }
    function release(e){const k=e.key.toLowerCase();if(captured.delete(k))consume(e);}
    return {key,release,blur:()=>captured.clear()};
  }

  function SearchPicker({label,options,value,onChange,multiple=false,placeholder,disabled=false,onCreate,existingOptions=options}) {
    const [search,setSearch]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(0),[creating,setCreating]=useState(false),[createError,setCreateError]=useState('');
    const creatingRef=useRef(false);
    const id=useRef('mc-picker-'+patterns.uniqueId()).current,input=useRef(null);
    const selected=multiple?value:value?[value]:[];
    const matches=options.filter(option=>!selected.includes(option.id)&&option.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    const newName=search.trim();
    if(onCreate&&newName&&!existingOptions.some(o=>o.name.toLocaleLowerCase()===newName.toLocaleLowerCase()))matches.push({id:'create',name:'Create tag “'+newName+'”',create:true});
    const index=Math.min(active,Math.max(0,matches.length-1));
    async function choose(option){
      if(disabled||creatingRef.current)return;
      if(option.create){creatingRef.current=true;setCreating(true);setCreateError('');try{await onCreate(newName);setSearch('');setActive(0);setOpen(false);}catch(e){setCreateError(e.message);}finally{creatingRef.current=false;setCreating(false);}return;}
      onChange(multiple?[...selected,option.id]:option.id);setSearch('');setActive(0);setOpen(false);input.current?.focus();}
    function key(e){
      if(creatingRef.current){e.preventDefault();return;}
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(open?Math.max(0,Math.min(matches.length-1,index+(e.key==='ArrowDown'?1:-1))):0);}
      else if(e.key==='Enter'&&open){e.preventDefault();if(matches[index])choose(matches[index]);}
      else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);setSearch('');}
    }
    useEffect(()=>{if(open)document.getElementById(id+'-'+index)?.scrollIntoView({block:'nearest'});},[open,index]);
    return h('div',{className:'mc-field mc-search-picker',onBlur:e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);setSearch('');}}},
      h('label',{htmlFor:id},label),
      selected.length>0&&h('div',{className:'mc-picker-selected'},selected.map(value=>h('span',{key:value},options.find(o=>o.id===value)?.name||value,button('×',()=>{onChange(multiple?selected.filter(v=>v!==value):'');setSearch('');setActive(0);},disabled||creating,{'aria-label':'Remove '+(options.find(o=>o.id===value)?.name||value)+' from '+label})))),
      h('input',{id,ref:input,role:'combobox','aria-label':label,'aria-autocomplete':'list','aria-expanded':open,'aria-controls':id+'-results','aria-activedescendant':open&&matches.length?id+'-'+index:undefined,autoComplete:'off',disabled,readOnly:creating,'aria-busy':creating,value:search,placeholder:placeholder||'Search…',onFocus:()=>{setOpen(true);setActive(0);},onChange:e=>{setSearch(e.target.value);setCreateError('');setActive(0);setOpen(true);},onKeyDown:key}),
      open&&h('div',{id:id+'-results',role:'listbox','aria-label':label+' results',className:'mc-picker-results'},matches.length?matches.map((option,i)=>h('div',{id:id+'-'+i,key:option.id,role:'option','aria-selected':i===index,onMouseDown:e=>e.preventDefault(),onClick:()=>choose(option)},option.create&&creating?'Creating tag…':option.name)):h('div',{className:'mc-picker-empty',role:'status'},'No matching results')),createError&&h('small',{role:'alert'},createError));
  }

  const screeningTargetKey=t=>t.id||t.marker_tag_id;
  const newScreeningTarget=()=>({id:patterns.uniqueId(),marker_tag_id:'',title:'',tag_ids:[],screened_name:'',absent_name:''});
  function ScreeningPage(){
    const client=useApolloClient(),location=api.libraries.ReactRouterDOM.useLocation(),history=api.libraries.ReactRouterDOM.useHistory();
    const reviewId=new URLSearchParams(location.search).get('review');
    const [items,setItems]=useState([]),[review,setReview]=useState(null),[tags,setTags]=useState([]),[studios,setStudios]=useState([]),[projects,setProjects]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[queue,setQueue]=useState(false);
    const [name,setName]=useState(''),[targets,setTargets]=useState(()=>[newScreeningTarget()]),[query,setQuery]=useState(''),[filterTags,setFilterTags]=useState([]),[studio,setStudio]=useState(''),[unreviewed,setUnreviewed]=useState(true),[destination,setDestination]=useState('');
    const op=args=>markerOp(client,args),positionQueue=useRef(Promise.resolve());
    useEffect(()=>{let live=true;setError('');setReview(null);setQueue(false);setBusy(true);
      Promise.all([op({action:'screening_list'}),client.query({query:TAGS}),client.query({query:gql`query ScreeningStudios{findStudios(filter:{per_page:-1,sort:"name",direction:ASC}){studios{id name}}}`}),op({action:'list'}),reviewId?op({action:'screening_get',id:reviewId}):Promise.resolve(null)]).then(([all,t,s,p,r])=>{if(live){setItems(all);setTags(t.data.findTags.tags);setStudios(s.data.findStudios.studios);setProjects(p);setReview(r);}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};
    },[reviewId]);
    function editTarget(index,patch){setTargets(all=>all.map((t,i)=>i===index?{...t,...patch}:t));}
    async function createTarget(index,name,additional=false){
      setBusy(true);try{
      // Recheck Stash before creating so tags added in another tab can be reused.
      const result=await client.query({query:TAGS,fetchPolicy:'network-only'}),all=[...result.data.findTags.tags];
      let tag=all.find(t=>t.name.toLocaleLowerCase()===name.toLocaleLowerCase());
      if(!tag){const result=await client.mutate({mutation:gql`mutation ScreeningCreateTag($input:TagCreateInput!){tagCreate(input:$input){id name}}`,variables:{input:{name}}});tag=result.data.tagCreate;all.push(tag);}
      all.sort((a,b)=>a.name.localeCompare(b.name));
      client.writeQuery({query:TAGS,data:{...result.data,findTags:{...result.data.findTags,tags:all}}});
      setTags(all);
      if(additional)setTargets(items=>items.map((t,i)=>i===index?{...t,tag_ids:[...new Set([...t.tag_ids,tag.id])].filter(id=>id!==t.marker_tag_id)}:t));
      else editTarget(index,{marker_tag_id:tag.id});
      }finally{setBusy(false);}
    }
    async function create(){setBusy(true);setError('');try{const r=await op({action:'screening_create',name,targets:targets.map(t=>({...t,screened_name:t.screened_name.trim(),absent_name:t.absent_name.trim()})),filters:{q:query,tags:filterTags,studios:studio?[studio]:[]},unreviewed_only:unreviewed,project_id:destination==='new'?'':destination,new_compilation:destination==='new'});history.push('/marker-screening?review='+r.id);}catch(e){setError(e.message);}finally{setBusy(false);}}
    async function progress(position){const id=review.id,scene_id=review.current_id;positionQueue.current=positionQueue.current.catch(()=>{}).then(()=>op({action:'screening_progress',id,scene_id,position}));return positionQueue.current;}
    async function action(kind,value){
      await positionQueue.current.catch(()=>{});
      if(kind==='queue'){setQueue(true);return '';}
      if(kind==='target'){await op({action:'screening_progress',id:review.id,target:value});setReview(r=>({...r,active_target:value}));return '';}
      if(kind==='refresh'){const r=await op({action:'screening_get',id:review.id});setReview(r);return '';}
      if(['done','absent','pending'].includes(kind)){
        const result=await op({action:'screening_result',id:review.id,scene_id:review.current_id,target:review.active_target,result:kind});let r=result.project;
        // Stay on this scene until each configured target has been checked.
        if(kind!=='pending'){
          const row=r.scenes.find(s=>s.id===r.current_id),next=r.targets.find(t=>['pending','conflict'].includes(row.statuses[screeningTargetKey(t)].state));
          if(next){await op({action:'screening_progress',id:r.id,target:screeningTargetKey(next)});r={...r,active_target:screeningTargetKey(next)};}
          else r=await op({action:'screening_navigate',id:r.id,move:'next'});
        }
        setReview(r);return result.warnings.join(' ')||(kind==='pending'?'Target reopened.':r.scenes.every(s=>Object.values(s.statuses).every(v=>['done','absent'].includes(v.state)))?'All scenes in this queue are screened.':'Screening result saved in the scene’s Stash tags.');
      }
      const r=await op({action:'screening_navigate',id:review.id,move:kind,scene_id:value});setReview(r);setQueue(false);return !r.scenes.some(s=>!s.missing&&!s.skipped&&Object.values(s.statuses).some(v=>['pending','conflict'].includes(v.state)))?'No unskipped scenes remain. Open Queue to revisit skipped scenes.':kind==='skip'?'Scene skipped; no screening tags changed.':'';
    }
    async function perform(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
    if(review&&!queue)return h(MarkerWorkspace,{key:review.id+':'+review.current_id,review,onReviewAction:action,onReviewPosition:progress});
    const usedScopes=new Set(items.map(item=>(item.status_scope||item.name).toLocaleLowerCase()));
    let scope=name.trim()||'Project name',suffix=2;while(usedScopes.has(scope.toLocaleLowerCase()))scope=(name.trim()||'Project name')+' ('+(suffix++)+')';
    const labels={done:'Done',absent:'None found',pending:'Pending',conflict:'Needs review',missing:'Missing'};
    return h('main',{className:'mc mc-screening'},h('header',{className:'mc-header'},h(Link,{to:'/marker-compilations'},'← Compilations'),h('h1',null,review?review.name:'Scene screening'),review&&button('Resume review',()=>setQueue(false),busy)),
      error&&h('p',{role:'alert',className:'mc-notice'},error),
      review?h(React.Fragment,null,h('div',{className:'mc-inline'},button('Refresh Stash status',()=>perform(()=>action('refresh')),busy),button('Revisit skipped scenes',()=>perform(()=>action('revisit')),busy),h('span',null,'Screening results come from ordinary Stash scene tags.')),
        h('div',{className:'mc-review-queue'},review.scenes.map(s=>h('article',{key:s.id},h('div',null,h('strong',null,s.title),h('small',null,s.skipped?'Skipped for now':s.missing?'Scene deleted':'')),h('div',{className:'mc-review-statuses'},review.targets.map(t=>h('span',{key:screeningTargetKey(t),className:'mc-review-state mc-state-'+s.statuses[screeningTargetKey(t)].state},(t.title||t.name)+' · '+labels[s.statuses[screeningTargetKey(t)].state]))),button('Review',()=>perform(()=>action('select',s.id)),busy||s.missing))))):
      h('div',{className:'mc-screening-layout'},h('section',{className:'mc-review-setup'},h('h2',null,'New review project'),h('p',{className:'mc-muted'},'Choose what to look for, then work through a scene queue. New markers inherit the active target’s title and tags.'),
        h(Field,{label:'Project name'},h('input',{'aria-label':'Review project name',value:name,onChange:e=>setName(e.target.value),placeholder:'Interviews'})),h('h3',null,'1. Choose the markers to create'),
        h('p',{className:'mc-review-help'},'Define each kind of marker you want to create: its default title, primary tag and optional extra tags. Capture with I / O to apply these defaults, then edit individual markers as needed. Multiple targets can share a primary tag. These choices do not filter the scene queue.'),
        targets.map((t,i)=>{
          const tag=tags.find(tag=>tag.id===t.marker_tag_id),screenedDefault=tag?'Screened: '+scope+' / '+(t.title.trim()||tag.name):'',absentDefault=tag?'Absent: '+scope+' / '+(t.title.trim()||tag.name):'',screened=t.screened_name.trim()||screenedDefault,absent=t.absent_name.trim()||absentDefault;
          return h('div',{key:t.id,className:'mc-review-target-setup'},h('div',{className:'mc-inline'},h(SearchPicker,{label:'Primary marker tag '+(i+1),options:tags,value:t.marker_tag_id,disabled:busy,existingOptions:tags,onCreate:name=>createTarget(i,name),placeholder:'Search or create a marker tag…',onChange:id=>{const tag=tags.find(t=>t.id===id);editTarget(i,{marker_tag_id:id,tag_ids:t.tag_ids.filter(v=>v!==id)});}}),targets.length>1&&button('×',()=>setTargets(all=>all.filter((_,index)=>index!==i)),busy,{'aria-label':'Remove target '+(i+1)})),
            h(Field,{label:'Default marker title'},h('input',{'aria-label':'Default marker title '+(i+1),maxLength:100,value:t.title,placeholder:tag?.name||'For example: Asking the performer’s age',onChange:e=>editTarget(i,{title:e.target.value})})),
            h(SearchPicker,{label:'Additional marker tags '+(i+1),options:tags.filter(tag=>tag.id!==t.marker_tag_id),value:t.tag_ids,multiple:true,disabled:busy,existingOptions:tags,onCreate:name=>createTarget(i,name,true),placeholder:'Search or create additional tags…',onChange:tag_ids=>editTarget(i,{tag_ids})}),
            tag?h(React.Fragment,null,h('div',{className:'mc-review-tag-defaults'},h('span',null,'Status tags on the scene'),h('div',null,h('small',null,'Reviewed'),h('code',null,screened)),h('div',null,h('small',null,'None found · also adds'),h('code',null,absent))),
              h('details',null,h('summary',null,'Edit status tag names'),h('p',{className:'mc-review-help'},'These defaults keep progress separate for this project. Done adds the reviewed tag; None found adds both. To share progress intentionally, enter another project’s status tag names.'),h(Field,{label:'Reviewed tag'},h('input',{'aria-label':'Screened tag '+(i+1),list:'mc-review-tag-names',value:t.screened_name,placeholder:screenedDefault,onChange:e=>editTarget(i,{screened_name:e.target.value})})),h(Field,{label:'None-found tag'},h('input',{'aria-label':'Absent tag '+(i+1),list:'mc-review-tag-names',value:t.absent_name,placeholder:absentDefault,onChange:e=>editTarget(i,{absent_name:e.target.value})})))):
              h('p',{className:'mc-review-help'},'Choose a target to see its default “Screened: …” and “Absent: …” scene tags.'));
        }),
        h('datalist',{id:'mc-review-tag-names'},tags.map(t=>h('option',{key:t.id,value:t.name}))),button('+ Add target',()=>setTargets(all=>[...all,newScreeningTarget()]),busy||targets.length>=12),
        h('h3',null,'2. Filter the scenes in your queue'),h('p',{className:'mc-review-help'},'Only scenes matching all filters below enter the queue. Scene tags must already be on the scene; selecting them here does not add tags. Leave these fields empty to review your whole library.'),
        h(Field,{label:'Search scene text'},h('input',{'aria-label':'Screening scene search',value:query,onChange:e=>setQuery(e.target.value),placeholder:'All scenes, or a search term'})),
        h('div',{className:'mc-review-filters'},h(SearchPicker,{label:'Scene tags',options:tags,value:filterTags,multiple:true,onChange:setFilterTags,disabled:busy,placeholder:'Search and add scene tags…'}),h(SearchPicker,{label:'Studio',options:studios,value:studio,onChange:setStudio,disabled:busy,placeholder:'All studios · search to filter…'})),
        h('p',{className:'mc-review-help'},'A scene must have every selected scene tag and match the selected studio.'),
        h('label',null,h('input',{type:'checkbox',checked:unreviewed,onChange:e=>setUnreviewed(e.target.checked)}),' Only scenes with targets still to review'),
        h(Field,{label:'Add new markers to this compilation’s timeline'},h('select',{'aria-label':'Screening compilation destination',value:destination,onChange:e=>setDestination(e.target.value)},h('option',{value:''},'No compilation'),h('option',{value:'new'},'Create a compilation with this project’s name'),projects.map(p=>h('option',{key:p.id,value:p.id},p.name)))),
        h('p',{className:'mc-muted'},'Creates missing status tags, or reuses tags with the chosen names. The queue is a snapshot of matching scenes; no scene tags change until you finish a review.'),
        button(busy?'Creating…':'Create review queue',create,busy||!name.trim()||targets.some(t=>!t.marker_tag_id),{className:'mc-primary'})),
        h('section',{className:'mc-review-projects'},h('h2',null,'Continue a review'),!items.length&&h('p',{className:'mc-muted'},'Your review projects will appear here.'),items.map(item=>h('article',{key:item.id},h('h3',null,item.name),h('p',null,item.targets.map(t=>t.title||t.name).join(' · ')),h('small',null,item.scene_ids.length+' scenes · '+item.skipped.length+' skipped'),h(Link,{to:'/marker-screening?review='+item.id},'Resume review →'))))));
  }

  function MarkerWorkspace({review=null,onReviewAction,onReviewPosition}={}){
    const client=useApolloClient(),[query,setQuery]=useState(''),[scenes,setScenes]=useState([]),[sceneId,setSceneId]=useState(()=>review?.current_id||new URLSearchParams(window.location.search).get('scene')||''),[scene,setScene]=useState(null);
    const fixedScene=useRef(!!review||!!new URLSearchParams(window.location.search).get('scene'));
    const [clip,setClip]=useState(null),clipRef=useRef(null),[tags,setTags]=useState([]),[value,setValue]=useState({title:'',primary:'',tag_ids:[]}),valueRef=useRef(value);valueRef.current=value;
    const [projects,setProjects]=useState([]),[project,setProject]=useState(review?.project_id||'');
    const [allMarkers,setAllMarkers]=useState(false),[externalMarker,setExternalMarker]=useState(null),[createdMarkers,setCreatedMarkers]=useState(review?.created_marker_ids||[]),[reusedMarkers,setReusedMarkers]=useState(review?.reused_marker_ids||[]);
    function rememberCreated(id){setCreatedMarkers(ids=>ids.includes(id)?ids:[...ids,id]);}
    const [drafts,setDrafts]=useState([]),draftsRef=useRef([]),[selected,setSelected]=useState([]),[active,setActive]=useState(null),activeRef=useRef(null);
    const [dirty,setDirty]=useState(false),dirtyRef=useRef(false),[batchTag,setBatchTag]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[target,setTarget]=useState(null),[captureStart,setCaptureStart]=useState(null),startRef=useRef(null);
    const workspace=useRef(null),controls=useRef(null),cache=useRef([]),capturedKeys=useRef(new Set()),loading=useRef(false),captureSaveQueue=useRef(Promise.resolve());
    function setCurrent(next){clipRef.current=next;setClip(next);}
    function markDirty(next){dirtyRef.current=next;setDirty(next);}
    function updateDrafts(change){const next=change(draftsRef.current);draftsRef.current=next;setDrafts(next);try{localStorage.setItem('mc-highlight-recovery-'+sceneId,JSON.stringify(next.filter(d=>d._unsaved)));}catch{setMessage('Browser recovery storage is unavailable. Keep this page open until your highlights are saved.');}}
    async function persist(draft){
      const pending={...draft,_unsaved:true,_saving:true};updateDrafts(items=>items.some(d=>d.id===draft.id)?items.map(d=>d.id===draft.id?pending:d):[...items,pending]);
      try{const saved=await markerOp(client,{action:'save_marker_draft',draft});updateDrafts(items=>items.map(d=>d.id===draft.id?saved:d));return saved;}
      catch(e){updateDrafts(items=>items.map(d=>d.id===draft.id?{...pending,_saving:false}:d));setMessage('Highlight is not saved to Stash yet: '+e.message+' Retry from the highlight list.');throw e;}
    }
    async function fetchScene(id){const r=await client.query({query:gql`query MarkerCreationScene($id:ID!){findScene(id:$id){id title files{duration frame_rate} scene_markers{id title seconds end_seconds primary_tag{id name} tags{id name}}}}`,variables:{id},fetchPolicy:'network-only'});return r.data.findScene;}
    useEffect(()=>{const resize=()=>{if(workspace.current)workspace.current.style.setProperty('--mc-available-height',Math.max(400,window.innerHeight-(workspace.current.getBoundingClientRect().top+window.scrollY)-8)+'px');};resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
    useEffect(()=>{client.query({query:TAGS}).then(r=>setTags(r.data.findTags.tags)).catch(e=>setMessage(e.message));markerOp(client,{action:'list'}).then(setProjects).catch(e=>setMessage(e.message));},[]);
    useEffect(()=>{if(fixedScene.current)return;let disposed=false;const timer=setTimeout(()=>{client.query({query:gql`query MarkerCreationScenes($q:String){findScenes(filter:{q:$q,per_page:40,sort:"title",direction:ASC}){scenes{id title files{duration}}}}`,variables:{q:query}}).then(r=>{if(!disposed)setScenes(r.data.findScenes.scenes);}).catch(e=>{if(!disposed)setMessage(e.message);});},200);return()=>{disposed=true;clearTimeout(timer);};},[query]);
    useEffect(()=>{let disposed=false;setScene(null);setCurrent(null);setActive(null);activeRef.current=null;setSelected([]);markDirty(false);startRef.current=null;setCaptureStart(null);draftsRef.current=[];setDrafts([]);if(!sceneId)return;
      setBusy(true);loading.current=true;
      Promise.all([fetchScene(sceneId),markerOp(client,{action:'list_marker_drafts',scene_id:sceneId})]).then(([s,items])=>{
        if(disposed)return;if(!s?.files?.[0]?.duration)throw Error('This scene has no playable file.');
        let recovery=[];try{recovery=JSON.parse(localStorage.getItem('mc-highlight-recovery-'+sceneId)||'[]');}catch{}
        const recovered=Array.isArray(recovery)?recovery.filter(d=>d?.clip?.scene_id===sceneId&&(!items.some(item=>item.id===d.id)||items.some(item=>item.id===d.id&&item.revision===d.revision))).map(d=>({...d,_saving:false})):[];
        draftsRef.current=[...items.filter(d=>!recovered.some(r=>r.id===d.id)),...recovered];setDrafts(draftsRef.current);if(recovered.length)setMessage('Recovered unsaved highlights. Use Retry to save them to Stash.');
        setScene(s);setCurrent({scene_id:s.id,start:0,end:Math.min(5,s.files[0].duration),hot_zones:[]});
      }).catch(e=>{if(!disposed)setMessage(e.message);}).finally(()=>{if(!disposed){loading.current=false;setBusy(false);}});return()=>{disposed=true;};
    },[sceneId]);
    useEffect(()=>{if(!scene||loading.current)return;const recovery=drafts.filter(d=>d._unsaved&&d.id!==active);if(active&&dirty){const draft=drafts.find(d=>d.id===active);if(draft)recovery.push({...draft,clip,...value,_unsaved:true,_saving:false});}else if(active){const draft=drafts.find(d=>d.id===active);if(draft?._unsaved)recovery.push(draft);}try{localStorage.setItem('mc-highlight-recovery-'+sceneId,JSON.stringify(recovery));}catch{}},[scene,drafts,active,dirty,clip,value]);
    useEffect(()=>{const guard=e=>{if(dirtyRef.current||startRef.current!==null||draftsRef.current.some(d=>d._unsaved)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[]);
    function change(patch){const next={...clipRef.current,...patch};if(!patterns.validHotZone(next)){setMessage('Keep hot zones inside the highlight range.');return false;}setCurrent(next);if(activeRef.current)markDirty(true);}
    function metadata(next){valueRef.current=next;setValue(next);markDirty(true);}
    async function keepDraft(){
      await controls.current?.flush();const id=activeRef.current;if(!id||!dirtyRef.current)return draftsRef.current.find(d=>d.id===id);
      const old=draftsRef.current.find(d=>d.id===id);const saved=await persist({...old,clip:clipRef.current,...valueRef.current});markDirty(false);return saved;
    }
    function editingBlocked(){if(review&&dirtyRef.current){setMessage('Save changes or discard edits before switching markers or starting a new one.');return true;}if(startRef.current!==null){setMessage('Press O to save the current marker before switching.');return true;}return false;}
    async function captureMode(){if(busy||editingBlocked())return;setBusy(true);try{await keepDraft();activeRef.current=null;setActive(null);markDirty(false);setMessage(review?'Ready for the next marker: I sets its start; O saves it directly to Stash.':'Capture: I starts a highlight. O finishes and saves a draft.');}catch{}finally{setBusy(false);}}
    async function refine(draft){if(busy||draft._saving||editingBlocked())return;setBusy(true);try{await keepDraft();const fresh=draftsRef.current.find(d=>d.id===draft.id);controls.current?.pause();activeRef.current=fresh.id;setActive(fresh.id);setCurrent(fresh.clip);const fields={title:fresh.title,primary:fresh.primary,tag_ids:fresh.tag_ids};valueRef.current=fields;setValue(fields);markDirty(!!fresh._unsaved);startRef.current=null;setCaptureStart(null);controls.current?.seek(fresh.clip.start);setMessage(review?(fresh.expected?'Editing an existing marker. Save changes updates it in Stash.':'This marker has not been saved in Stash. Check its tags, then choose Save marker.'):'Refine this draft. Keep draft saves your edits; Save to Stash creates a regular marker.');}catch{}finally{setBusy(false);}}
    async function capture(which,point){
      if(which==='start'){startRef.current=point;setCaptureStart(point);setCurrent({scene_id:sceneId,start:point,end:Math.min(scene.files[0].duration,point+5),hot_zones:[]});setMessage(review?'Marker started. Press O to save it; then I starts the next marker.':'Highlight started. Press O at the end.');return true;}
      const start=startRef.current;if(start===null){setMessage(review?'Press I to start a marker first.':'Press I to start a highlight first.');return false;}if(point<=start){setMessage('The end must be after the start. Keep watching, then press O.');return false;}
      const draft={id:patterns.uniqueId(),revision:0,clip:{scene_id:sceneId,start,end:point,hot_zones:[]},title:reviewTarget?.title||reviewTarget?.name||'',primary:reviewTarget?.marker_tag_id||'',tag_ids:reviewTarget?.tag_ids||[],review_id:review?.id||'',review_target_id:reviewTarget?screeningTargetKey(reviewTarget):''};
      startRef.current=null;setCaptureStart(null);setCurrent(draft.clip);
      updateDrafts(items=>[...items,{...draft,_unsaved:true,_saving:true}]);
      const saving=captureSaveQueue.current.catch(()=>{}).then(async()=>{try{const saved=await persist(draft);if(review)await saveCapturedMarker(saved);else setMessage('Highlight saved as a draft. Keep watching; tag it whenever you’re ready.');return true;}catch(e){if(review)setMessage('Marker not saved in Stash: '+e.message+' Use Retry in the marker list.');return false;}});
      captureSaveQueue.current=saving;return saving;
    }
    async function saveCapturedMarker(draft){
      if(draft._unsaved||!draft.revision)draft=await persist(draft);
      updateDrafts(items=>items.map(d=>d.id===draft.id?{...d,_saving:true}:d));
      try{
        const result=await markerOp(client,{action:'publish_marker_draft',id:draft.id,revision:draft.revision,mode:draft.expected?'update':'new',title:draft.title||reviewTarget?.title||reviewTarget?.name||'',project_id:project||undefined,add_to_timeline:!!review&&!draft.expected});
        updateDrafts(items=>items.filter(d=>d.id!==draft.id));
        if(review&&!draft.expected)rememberCreated(result.marker.id);
        setScene(s=>({...s,scene_markers:[...s.scene_markers.filter(m=>m.id!==result.marker.id),result.marker].sort((a,b)=>a.seconds-b.seconds)}));
        setMessage(result.warning||'Marker saved in Stash. Press I to start the next marker, or select a marker to edit it.');
      }catch(e){updateDrafts(items=>items.map(d=>d.id===draft.id?{...d,_saving:false}:d));throw e;}
    }
    async function retryMarker(draft){if(busy||draft._saving)return;setBusy(true);try{await saveCapturedMarker(draft);}catch(e){setMessage('Marker not saved: '+e.message);}finally{setBusy(false);}}
    async function editMarker(marker,copy=false){if(busy||editingBlocked())return;const existing=!copy&&draftsRef.current.find(d=>d.clip.marker_id===marker.id);if(existing)return refine(existing);setBusy(true);
      try{await keepDraft();const context=await markerOp(client,{action:'marker_context',scene_id:sceneId,marker_id:marker.id});const draft=await persist({id:patterns.uniqueId(),revision:0,clip:{scene_id:sceneId,marker_id:copy?undefined:marker.id,start:marker.seconds,end:marker.end_seconds>marker.seconds?marker.end_seconds:Math.min(marker.seconds+5,scene.files[0].duration),hot_zones:context.hot_zones},title:marker.title,primary:marker.primary_tag.id,tag_ids:marker.tags.map(t=>t.id),expected:copy?undefined:context.marker,...(copy?{review_id:review?.id,review_target_id:review?.targets.find(t=>patterns.markerMatchesTarget(marker,t))?screeningTargetKey(review.targets.find(t=>patterns.markerMatchesTarget(marker,t))):''}:{})});setExternalMarker(null);controls.current?.pause();activeRef.current=draft.id;setActive(draft.id);setCurrent(draft.clip);valueRef.current={title:draft.title,primary:draft.primary,tag_ids:draft.tag_ids};setValue(valueRef.current);markDirty(false);startRef.current=null;setCaptureStart(null);controls.current?.seek(draft.clip.start);setMessage(review?(copy?'Editing a separate copy. Save marker creates a new Stash marker.':'Editing a shared Stash marker. Saving changes affects it everywhere it is used.'):'Refining a copy. Update original or save it as a new marker when ready.');}catch(e){setMessage(e.message);}finally{setBusy(false);}
    }
    async function reuseMarker(marker){
      if(busy||editingBlocked())return;setBusy(true);
      try{const result=await markerOp(client,{action:'screening_reuse_marker',id:review.id,scene_id:sceneId,marker_id:marker.id});setReusedMarkers(ids=>[...new Set([...ids,result.marker_id])]);setExternalMarker(null);setMessage(result.added_to_compilation?'Existing marker added to compilation media and timeline. Review status is still unchanged.':'Existing marker reused for this project. Review status is still unchanged.');}catch(e){setMessage(e.message);}finally{setBusy(false);}
    }
    async function saveEdits(){if(review&&activeRef.current)return publish([activeRef.current],draftsRef.current.find(d=>d.id===activeRef.current)?.expected?'update':'new');if(busy)return;setBusy(true);try{await keepDraft();setMessage('Draft saved. You can keep refining or return to Capture.');}catch{}finally{setBusy(false);}}
    async function batchTagging(){if(busy||!batchTag||!selected.length)return;setBusy(true);try{await keepDraft();for(const id of selected){const d=draftsRef.current.find(d=>d.id===id);if(d)await persist({...d,primary:batchTag});}if(activeRef.current&&selected.includes(activeRef.current)){const next={...valueRef.current,primary:batchTag};valueRef.current=next;setValue(next);}setMessage('Tag applied to selected drafts.');}catch(e){setMessage('Some drafts could not be tagged: '+e.message);}finally{setBusy(false);}}
    async function publish(ids,mode='new'){
      if(busy)return;setBusy(true);let count=0;const warnings=[];
      try{await keepDraft();const items=ids.map(id=>draftsRef.current.find(d=>d.id===id)).filter(Boolean);if(items.some(d=>!d.primary))throw Error('Choose a tag for every selected draft before saving to Stash.');
        for(let draft of items){if(draft._unsaved)draft=await persist(draft);const result=await markerOp(client,{action:'publish_marker_draft',id:draft.id,revision:draft.revision,mode,project_id:project||undefined,add_to_timeline:mode==='new',title:draft.title.trim()||tags.find(t=>t.id===draft.primary)?.name||''});rememberMarkerTag(draft.primary);if(review&&mode==='new')rememberCreated(result.marker.id);count++;updateDrafts(items=>items.filter(d=>d.id!==draft.id));setSelected(ids=>ids.filter(id=>id!==draft.id));if(activeRef.current===draft.id){activeRef.current=null;setActive(null);markDirty(false);}if(result.warning)warnings.push(result.warning);}
        setScene(await fetchScene(sceneId));setMessage(count+' marker'+(count===1?'':'s')+' saved to Stash.'+(warnings.length?' '+warnings.join(' '):''));
      }catch(e){if(review&&activeRef.current)markDirty(true);setMessage((count?count+' saved; remaining markers kept. ':'')+e.message);}finally{setBusy(false);}
    }
    async function removeDraft(draft){if(busy||draft._saving)return;setBusy(true);try{if(draft.revision)await markerOp(client,{action:'delete_marker_draft',id:draft.id,revision:draft.revision});updateDrafts(items=>items.filter(d=>d.id!==draft.id));setSelected(ids=>ids.filter(id=>id!==draft.id));if(activeRef.current===draft.id){activeRef.current=null;setActive(null);markDirty(false);}setMessage(review?(draft.expected?'Edits discarded. The saved marker is unchanged.':'Unsaved marker removed.'):'Draft removed.');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
    useEffect(()=>{
      const {key,release,blur}=markerKeyboard({controls,save:()=>activeRef.current?saveEdits():controls.current?.mark('end'),busy,enabled:!!clip,focus:()=>workspace.current?.focus(),captured:capturedKeys.current});
      window.addEventListener('keydown',key,true);window.addEventListener('keyup',release,true);window.addEventListener('blur',blur);
      return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('keyup',release,true);window.removeEventListener('blur',blur);};
    });
    useEffect(()=>{if(!review||!clip)return;let live=true,inFlight=false,last=-1;const timer=setInterval(async()=>{const point=controls.current?.position();if(inFlight||!Number.isFinite(point)||Math.abs(point-last)<1)return;inFlight=true;try{await onReviewPosition(point);last=point;}catch(e){if(live)setMessage('Playback position could not be saved: '+e.message);}finally{inFlight=false;}},5000);return()=>{live=false;clearInterval(timer);};},[review?.id,sceneId,!!clip]);
    async function reviewAction(kind,value){if(busy||editingBlocked())return;if(draftsRef.current.some(d=>d._saving)){setMessage('Wait for the marker to finish saving.');return;}if(kind==='done'&&draftsRef.current.some(d=>d.review_id===review.id&&!d.clip.marker_id)){setMessage('Save or remove the unsaved markers before finishing this target review.');return;}if(startRef.current!==null){setMessage('Finish this highlight with O before changing the review.');return;}setBusy(true);try{await keepDraft();const point=controls.current?.position();if(Number.isFinite(point))await onReviewPosition(point);const note=await onReviewAction(kind,value);const items=await markerOp(client,{action:'list_marker_drafts',scene_id:sceneId});updateDrafts(()=>items);if(activeRef.current&&!items.some(d=>d.id===activeRef.current)){activeRef.current=null;setActive(null);markDirty(false);}setScene(await fetchScene(sceneId));if(note)setMessage(note);}catch(e){setMessage(e.message);const items=await markerOp(client,{action:'list_marker_drafts',scene_id:sceneId}).catch(()=>null);if(items)updateDrafts(old=>[...items,...old.filter(d=>d._unsaved&&!items.some(item=>item.id===d.id))]);}finally{setBusy(false);}}
    const reviewScene=review?.scenes.find(s=>s.id===sceneId),reviewTarget=review?.targets.find(t=>screeningTargetKey(t)===review.active_target),reviewStatus=reviewScene?.statuses[review.active_target];
    const reviewLabels={done:'Done',absent:'None found',pending:'Pending',conflict:'Needs review',missing:'Missing'};
    const current=drafts.find(d=>d.id===active),savingCount=drafts.filter(d=>d._saving).length;
    const matchesProject=m=>review?.targets.some(t=>patterns.markerMatchesTarget(m,t));
    const visibleMarkers=(scene?.scene_markers||[]).filter(m=>allMarkers||createdMarkers.includes(m.id)||reusedMarkers.includes(m.id)||matchesProject(m));
    return h('main',{className:'mc mc-marker-workspace '+(!active?'mc-capturing':'mc-refining'),ref:workspace,tabIndex:-1,onPointerUpCapture:()=>requestAnimationFrame(()=>restoreMarkerPlaybackFocus(workspace)),onSeekedCapture:()=>restoreMarkerPlaybackFocus(workspace),onChange:e=>{if(e.target instanceof Element&&e.target.matches('select'))workspace.current?.focus();}},
      h('header',{className:'mc-header'},h(Link,{to:review?'/marker-screening':'/marker-compilations',onClick:e=>{if(dirty||captureStart!==null||savingCount){e.preventDefault();setMessage(review?'Save changes or finish the current marker before leaving.':'Keep your draft or finish the current highlight before leaving.');}}},review?'← Review projects':'← Compilations'),h('h1',null,review?'Scene markers':'Scene highlights'),scene&&h(Link,{to:'/scenes/'+scene.id,onClick:e=>{if(dirty||captureStart!==null||savingCount){e.preventDefault();setMessage(review?'Save changes or finish the current marker before leaving.':'Keep your draft or finish the current highlight before leaving.');}}},(scene.title||'Scene '+scene.id)+' ↗')),
      review&&h('section',{className:'mc-screening-toolbar','aria-label':'Screening review'},h('div',{className:'mc-review-title'},h('strong',null,review.name),h('span',null,(review.scene_ids.indexOf(sceneId)+1)+' / '+review.scene_ids.length+' scenes · '+review.scenes.filter(s=>Object.values(s.statuses).every(v=>['done','absent'].includes(v.state))).length+' complete'),button('Queue',()=>reviewAction('queue'),busy),button('Skip for now',()=>reviewAction('skip'),busy),button('Next pending',()=>reviewAction('next'),busy)),
        h('div',{className:'mc-review-targets'},review.targets.map(t=>button((t.title||t.name)+' · '+reviewLabels[reviewScene?.statuses[screeningTargetKey(t)]?.state||'pending'],()=>reviewAction('target',screeningTargetKey(t)),busy||captureStart!==null,{key:screeningTargetKey(t),'aria-pressed':screeningTargetKey(t)===review.active_target,className:'mc-state-'+reviewScene?.statuses[screeningTargetKey(t)]?.state}))),
        h('div',{className:'mc-inline'},h('span',null,'New markers: '+(reviewTarget?.title||reviewTarget?.name)),button('Mark target reviewed',()=>reviewAction('done'),busy||!!review.missing_tags.length,{title:'Record that you checked this scene for this target, then advance to the next pending target or scene.'}),button('None found',()=>reviewAction('absent'),busy||!!review.missing_tags.length),reviewStatus?.state!=='pending'&&button('Reopen target',()=>reviewAction('pending'),busy||!!review.missing_tags.length)),
        h('small',{className:'mc-muted'},'Mark target reviewed records this scene’s review for the selected target and advances to the next pending target or scene. If it is absent, choose None found.'),
        review.missing_tags.length>0&&h('p',{role:'alert'},'A configured Stash tag was deleted. Create a review project with valid tags.'),
        reviewStatus?.state==='conflict'&&h('p',{role:'alert'},'The absence tag conflicts with markers, drafts, or the screened tag. Review this target and choose Done or Reopen.')),
      !fixedScene.current&&h('details',{className:'mc-marker-scene-choice',open:!sceneId||undefined},h('summary',null,scene?'Change scene':'Choose a scene to begin'),h('div',{className:'mc-marker-scene-picker'},h(Field,{label:'Find a scene'},h('input',{type:'search','aria-label':'Find a scene',value:query,onChange:e=>setQuery(e.target.value)})),h(Field,{label:'Scene'},h('select',{'aria-label':'Marker creation scene',value:sceneId,disabled:busy||dirty||captureStart!==null||savingCount>0,onChange:e=>{setSceneId(e.target.value);e.target.closest('details').open=false;}},h('option',{value:''},'Choose a scene'),scene&&!scenes.some(s=>s.id===scene.id)&&h('option',{value:scene.id},scene.title||'Scene '+scene.id),scenes.map(s=>h('option',{key:s.id,value:s.id},s.title||'Scene '+s.id)))))),
      message&&h('p',{role:'status',className:'mc-notice'},message),
      !clip&&h('p',{className:'mc-muted'},busy?'Loading highlights…':'Choose a scene, then capture highlights with I and O. Tagging can wait.'),
      clip&&h('div',{className:'mc-marker-work-grid'},h('div',{className:'mc-marker-left'},
        h('div',{className:'mc-marker-guide'},h('div',{className:'mc-inline'},button(review?'New marker':'Capture',captureMode,busy,{'aria-pressed':!active}),h('strong',null,active?(review?'Editing marker · save changes when finished':'Refine highlight'):captureStart!==null?'● Started at '+time(captureStart):review?'I · start marker   O · save marker   Repeat to add more':'I · start   O · finish & keep')),
          h('span',null,'Space · play/pause   ← / → · −/+1 sec   ↑ / ↓ · frame step   Esc · leave field')),
        h('section',{className:'mc-marker-screen','aria-label':'Marker preview',ref:setTarget})),
        h('aside',{className:'mc-marker-inspector','aria-label':review?'Marker inspector':'Highlight inspector'},
          h('div',{className:'mc-panel-heading'},h('h2',null,active?(review?'Marker inspector':'Highlight inspector'):'Capture controls')),
          review&&active&&h('div',{className:'mc-marker-edit-actions'},h(React.Fragment,null,button(current?.expected?'Save changes':'Save marker',saveEdits,busy||!value.primary||(current?.expected&&!dirty),{className:'mc-primary'}),current?.expected&&button('Discard edits',()=>removeDraft(current),busy))),
          h(TrimPreview,{key:sceneId,initialPosition:review?.positions?.[sceneId],clip,onChange:change,onCapture:active?null:capture,onBeforePlay:()=>{},controls,busy,target,frameCache:cache,captureWhilePlaying:true,directMarkers:!!review}),
          active&&h('section',{className:'mc-draft-refine'},h(MarkerFields,{tags,value,onChange:metadata,disabled:busy}),
            h('div',{className:'mc-inline'},review?null:h(React.Fragment,null,button('Keep draft',saveEdits,busy||!dirty),button(current?.expected?'Save as new':'Save to Stash',()=>publish([active]),busy||!value.primary,{className:'mc-primary'}),current?.expected&&button('Update original',()=>publish([active],'update'),busy||!value.primary)))),
          !active&&h('p',{className:'mc-muted'},review?'Press I at the start and O at the end. Each marker is saved immediately with the selected target’s title and tags. Keep watching and repeat for more markers.':'I starts a highlight; O saves it. Select a highlight to edit its range, title and tags.')),
        review?h('aside',{className:'mc-marker-metadata','aria-label':'Scene markers'},
          h('div',{className:'mc-panel-heading'},h('h2',null,'Markers · '+visibleMarkers.length),h('small',null,savingCount?'Saving…':'Saved in Stash')),
          h('label',{className:'mc-inline'},h('input',{type:'checkbox',checked:allMarkers,onChange:e=>setAllMarkers(e.target.checked)}),'All scene markers'),
          h('p',{className:'mc-muted'},allMarkers?'Showing every marker in this scene. Select a marker to see reuse, edit and copy options.':'Showing markers created here or matching this project’s target titles and tags. Select an existing match to reuse, edit or copy it.'),
          h('div',{className:'mc-highlight-list'},[...visibleMarkers].sort((a,b)=>a.seconds-b.seconds).map(m=>h('article',{key:m.id,className:'mc-highlight-row mc-saved-marker'+(current?.clip.marker_id===m.id?' mc-selected':'')},button(h(React.Fragment,null,h('strong',null,m.title),h('small',null,patterns.frameTime(m.seconds,scene?.files?.[0]?.frame_rate)+' → '+patterns.frameTime(m.end_seconds,scene?.files?.[0]?.frame_rate)),h('small',null,(createdMarkers.includes(m.id)?'Created here':reusedMarkers.includes(m.id)?'Reused here':matchesProject(m)?'Existing match':'Other scene marker')+(current?.clip.marker_id===m.id&&dirty?' · Unsaved changes':''))),()=>{if(editingBlocked())return;if(createdMarkers.includes(m.id))editMarker(m);else setExternalMarker(externalMarker===m.id?null:m.id);},busy,{'aria-label':(createdMarkers.includes(m.id)?'Edit marker ':'Select existing marker ')+m.title}),
            externalMarker===m.id&&h('div',{className:'mc-existing-actions'},h('small',null,'This is a shared Stash marker. Editing changes the original; creating a copy leaves it unchanged.'),matchesProject(m)&&button(reusedMarkers.includes(m.id)?'Reuse again':'Reuse existing',()=>reuseMarker(m),busy),button('Edit existing',()=>editMarker(m),busy),button('Create separate marker',()=>editMarker(m,true),busy)))),
            drafts.filter(d=>!d.clip.marker_id||!scene?.scene_markers.some(m=>m.id===d.clip.marker_id)).map((d,i)=>h('article',{key:d.id,className:'mc-highlight-row mc-pending-marker'},button(h(React.Fragment,null,h('strong',null,d.title||'Unsaved marker'),h('small',null,d._saving?'Saving to Stash…':'Not saved in Stash')),()=>refine(d),busy||d._saving,{'aria-label':'Edit unsaved marker '+(i+1)}),d.primary&&button('Retry',()=>retryMarker(d),busy||d._saving),button('×',()=>removeDraft(d),busy||d._saving,{'aria-label':'Remove unsaved marker '+(i+1)}))),
            !drafts.length&&!visibleMarkers.length&&h('p',{className:'mc-draft-empty'},'No project markers yet. Press I, then O, or enable All scene markers.'))) :
        h('aside',{className:'mc-marker-metadata','aria-label':'Highlights'},
          h('div',{className:'mc-panel-heading'},h('h2',null,'Highlights · '+drafts.length),h('small',null,savingCount?'Saving…':drafts.some(d=>d._unsaved)?'Unsaved drafts':'Drafts saved')),
          !active&&h('p',{className:'mc-muted'},'Watch and capture now. Select a highlight to refine it later. Tags are only required when publishing markers.'),
          drafts.length>0&&h('div',{className:'mc-draft-batch'},h('div',{className:'mc-inline'},button(selected.length===drafts.length?'Deselect all':'Select all',()=>setSelected(selected.length===drafts.length?[]:drafts.map(d=>d.id)),busy||savingCount>0),h('small',null,selected.length+' selected')),
            selected.length>0&&h(React.Fragment,null,h('select',{'aria-label':'Tag selected highlights',value:batchTag,disabled:busy,onChange:e=>setBatchTag(e.target.value)},h('option',{value:''},'Choose a tag…'),tags.map(t=>h('option',{key:t.id,value:t.id},t.name))),h('div',{className:'mc-inline'},button('Apply tag',batchTagging,busy||savingCount>0||!batchTag),button('Save selected to Stash',()=>publish(selected),busy||savingCount>0||drafts.some(d=>selected.includes(d.id)&&!d.primary))))),
          h('div',{className:'mc-highlight-list'},drafts.length?drafts.map((d,i)=>h('article',{key:d.id,className:'mc-highlight-row'+(active===d.id?' mc-selected':'')},h('input',{type:'checkbox','aria-label':'Select highlight '+(i+1),checked:selected.includes(d.id),disabled:busy||d._saving,onChange:e=>setSelected(ids=>e.target.checked?[...ids,d.id]:ids.filter(id=>id!==d.id))}),
            button(h(React.Fragment,null,h('strong',null,d.title||'Highlight '+(i+1)),h('small',null,patterns.frameTime(d.clip.start,scene?.files?.[0]?.frame_rate)+' → '+patterns.frameTime(d.clip.end,scene?.files?.[0]?.frame_rate)),h('small',null,d._saving?'Saving…':d._unsaved?'Not saved · retry':tags.find(t=>t.id===d.primary)?.name||'Untagged')),()=>refine(d),busy||d._saving,{'aria-label':'Refine highlight '+(i+1)}),
            h('div',null,d._unsaved&&!d._saving&&button('Retry',()=>persist(d).catch(()=>{}),busy),button('×',()=>removeDraft(d),busy||d._saving,{'aria-label':'Remove highlight '+(i+1)})))):h('p',{className:'mc-draft-empty'},'Your highlights will appear here.\nPress I, keep watching, then O.')),
          drafts.length>0&&h('details',null,h('summary',null,'Also add published markers to a compilation'),h('select',{'aria-label':'Add published markers to project',value:project,disabled:busy||!!review,onChange:e=>setProject(e.target.value)},h('option',{value:''},'Do not add to a project'),projects.map(p=>h('option',{key:p.id,value:p.id},p.name)))),
          h('details',{className:'mc-marker-existing'},h('summary',null,'Existing Stash markers · '+(scene?.scene_markers?.length||0)),(scene?.scene_markers||[]).map(m=>button(m.title+' · '+time(m.seconds),()=>editMarker(m),busy,{key:m.id}))))));
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

  function MediaCatalog({media,clips,busy,onInsert,onDrop,onRemove,onRestore}) {
    const [query,setQuery]=useState(''), [dragging,setDragging]=useState(null);
    const [usage,setUsage]=useState('all'), [sort,setSort]=useState('added'), [removed,setRemoved]=useState(null);
    const drag=useRef(null);
    function pointerDown(e,c){if(busy||e.pointerType==='touch'||e.button!==0||e.target.closest('button'))return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={key:patterns.mediaKey(c),title:c.title,x:e.clientX,y:e.clientY,moved:false};}
    function pointerMove(e){const d=drag.current;if(!d)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>5)d.moved=true;if(d.moved)setDragging({...d,x:e.clientX,y:e.clientY});}
    function pointerUp(e){const d=drag.current;drag.current=null;setDragging(null);if(d?.moved)onDrop(d.key,e.clientX,e.clientY);}
    const counts=new Map();for(const c of clips){const key=patterns.mediaKey(c);counts.set(key,(counts.get(key)||0)+1);}
    const filtered=media.filter(c=>c.title.toLowerCase().includes(query.toLowerCase())&&(usage==='all'||(usage==='used')===!!counts.get(patterns.mediaKey(c))));
    if(sort==='name')filtered.sort((a,b)=>a.title.localeCompare(b.title));
    if(sort==='duration')filtered.sort((a,b)=>(a.end-a.start)-(b.end-b.start));
    function remove(c){const key=patterns.mediaKey(c);setRemoved({item:c,index:media.findIndex(m=>patterns.mediaKey(m)===key)});onRemove(key);}

    return h('section',{className:'mc-catalog','aria-label':'Project media catalog'},
      dragging&&h('div',{className:'mc-media-drag-ghost',style:{left:dragging.x+12,top:dragging.y+12},'aria-hidden':true},dragging.title),
      h('div',{className:'mc-catalog-heading'},h('h2',null,'Project media'),h('span',null,media.length+' markers'),
        h('input',{type:'search','aria-label':'Search project media',placeholder:'Find marker…',value:query,onChange:e=>setQuery(e.target.value)})),
      h('div',{className:'mc-media-filters'},
        h('select',{'aria-label':'Filter project media',value:usage,onChange:e=>setUsage(e.target.value)},h('option',{value:'all'},'All'),h('option',{value:'used'},'Used'),h('option',{value:'unused'},'Unused')),
        h('select',{'aria-label':'Sort project media',value:sort,onChange:e=>setSort(e.target.value)},h('option',{value:'added'},'Added order'),h('option',{value:'name'},'Name'),h('option',{value:'duration'},'Duration'))),
      removed&&h('div',{className:'mc-media-undo',role:'status'},h('span',{title:removed.item.title},'Removed from media'),button('Undo',()=>{if(onRestore(removed.item,removed.index)!==false)setRemoved(null);},busy)),
      media.length===0?h('p',null,'Use Add markers to collect project media, then drag it onto the timeline.'):
        filtered.length===0?h('p',null,'No matching markers.'):
        h('div',{className:'mc-catalog-items',tabIndex:0,'aria-label':'Project media list'},filtered.map(c=>{
          const key=patterns.mediaKey(c),uses=counts.get(key)||0;
          return h('article',{key,className:'mc-media-item'+(dragging?.key===key?' is-dragging':''),draggable:false,'aria-label':'Project marker: '+c.title,
            onPointerDown:e=>pointerDown(e,c),onPointerMove:pointerMove,onPointerUp:pointerUp,onPointerCancel:()=>{drag.current=null;setDragging(null);}},
            h(MarkerThumbnail,{clip:c,uses}),
            h('span',{className:'mc-media-details'},h('strong',{title:c.title},c.title),h('small',{title:uses?uses+' on timeline':'Not on timeline'},time(c.end-c.start))),
            h('span',{className:'mc-media-actions'},button('+',()=>onInsert(key),busy,{'aria-label':'Insert '+c.title,title:'Insert after the selected timeline clip'}),button('×',()=>remove(c),busy,{'aria-label':'Remove '+c.title+' from project media',title:'Remove from project media; timeline clips stay'}))); })))
  }

  function Page() {
    const client=useApolloClient(), Modal=api.libraries.Bootstrap.Modal;
    const [customPatterns,setCustomPatterns]=useState([]);
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
    const [exports,setExports]=useState([]), [renderConfig,setRenderConfig]=useState(null), [renderQuality,setRenderQuality]=useState('1080p'), [renderAudio,setRenderAudio]=useState(true), [renderLibrary,setRenderLibrary]=useState(true), [renderDirectory,setRenderDirectory]=useState(''), [copyMetadata,setCopyMetadata]=useState(false), [renderedVideo,setRenderedVideo]=useState(null);
    const renderedRef=useRef(null);
    const [job,setJob]=useState(null), [jobStatus,setJobStatus]=useState(''), [fullscreen,setFullscreen]=useState(false);
    const [seekRequest,setSeekRequest]=useState({position:0,serial:0,play:true});
    const dropMediaRef=useRef(null), request=useRef(0), monitor=useRef(null), serial=useRef(0), playerControls=useRef(null), trimControls=useRef(null);
    const clip=selected==null?null:doc.clips[selected], entries=patterns.timeline(doc.clips);
    const selectedClipRef=useRef(clip);selectedClipRef.current=clip;
    const total=entries.length?entries[entries.length-1].end:0;
    const media=patterns.catalog(doc), trimActive=view==='editor'&&inspectorOpen&&preview==='trim'&&!!clip;
    const progress=useCallback(position=>setCurrent(position),[]), activate=useCallback(index=>setActive(index),[]);
    async function op(args){const r=await client.mutate({mutation:OP,variables:{args}});return r.data.runPluginOperation;}
    async function refreshExports(id=doc.id){if(id)setExports(await op({action:'list_exports',id}));else setExports([]);}
    useEffect(()=>{let disposed=false;setExports([]);if(doc.id)op({action:'list_exports',id:doc.id}).then(items=>{if(!disposed)setExports(items);}).catch(e=>{if(!disposed)setMessage(e.message);});return()=>{disposed=true;};},[doc.id]);
    const exportActive=exports.some(item=>item.compilation_id===doc.id&&['queued','rendering','importing'].includes(item.status));
    useEffect(()=>{
      if(!doc.id||!exportActive)return;
      return pollActiveExports(()=>op({action:'list_exports',id:doc.id}),setExports,error=>setMessage(error.message));
    },[doc.id,exportActive]);
    async function openRender(){const config=await op({action:'export_config'});setRenderConfig(config);setRenderDirectory(d=>config.libraries.includes(d)?d:config.libraries[0]||'');await refreshExports();setModal('render');}
    async function startRender(){
      if(doc.clips.some(c=>patterns.missingRanges(c)))throw Error('Choose ranges for missing zones before rendering.');
      const saved=dirty||!doc.id?await save():doc;
      const result=await op({action:'prepare_export',id:saved.id,quality:renderQuality,audio:renderAudio,library:renderLibrary,directory:renderDirectory,copy_metadata:copyMetadata});
      const queued=await client.mutate({mutation:RENDER_TASK,variables:{args:{action:'render_export',export_id:result.id}}});
      await op({action:'export_job',export_id:result.id,job_id:queued.data.runPluginTask});
      await refreshExports(saved.id);setMessage('Rendering queued. You can close this dialog and keep editing.');
    }
    function exportURL(item){return new URL('plugin/marker-compilations/assets/exports/'+item.id+'.mp4',document.baseURI).href;}
    function watchExport(item){stop();setMessage('');setInspectorOpen(false);setPreview('compilation');setRenderedVideo(item);setModal(null);}
    async function load(){setDocuments(await op({action:'list'}));}
    useEffect(()=>{op({action:'list_patterns'}).then(setCustomPatterns).catch(e=>setMessage(e.message));},[]);
    async function managePatterns(){setCustomPatterns(await op({action:'list_patterns'}));setModal('patterns');}
    async function savePattern(pattern){const saved=await op({action:'save_pattern',pattern});setCustomPatterns(await op({action:'list_patterns'}));return saved;}
    async function deletePattern(pattern){await op({action:'delete_pattern',id:pattern.id,revision:pattern.revision});setCustomPatterns(await op({action:'list_patterns'}));if(defaultPattern==='custom:'+pattern.id)setDefaultPattern('once');}

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
    function stop(){setRenderedVideo(null);setPlayer(null);setActive(null);setCurrent(0);}
    function edit(patch){setDoc(d=>({...d,media:patterns.catalog(d),...patch}));setDirty(true);stop();}
    function choose(next,discard=false){if(dirty&&!discard&&!window.confirm('Discard unsaved changes?'))return false;setInspectorOpen(false);setDoc({...next,media:patterns.catalog(next)});setTrimSession(n=>n+1);setPreview('compilation');setSelected(next.clips.length?0:null);setDirty(false);stop();setMessage('');return true;}
    async function perform(work){setBusy(true);setMessage('');try{await work();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
    async function save(){const saved=await op({action:'save',document:doc});setDoc(saved);setDirty(false);await load();return saved;}
    async function add(marker){
      const duration=Number(defaultDuration),start=marker.seconds;
      if(!(duration>0&&Number.isFinite(duration))){setMessage('Default duration must be positive.');return;}
      const sourceDuration=(marker.scene.files[0]||{}).duration;
      const end=marker.end_seconds>start?marker.end_seconds:Math.min(start+duration,sourceDuration||Infinity);
      if(!(end>start)){setMessage('This marker has no playable interval.');return;}
      const item={marker_id:marker.id,scene_id:marker.scene.id,title:marker.title||marker.primary_tag.name,start,end,phases:(presetPhases(defaultPattern,customPatterns)||patterns.presets.once).map(p=>({...p}))};
      if(media.some(c=>patterns.mediaKey(c)===patterns.mediaKey(item)))return;
      if(media.length>=2000){setMessage('A project supports up to 2000 catalog markers.');return;}
      const context=await op({action:'marker_context',scene_id:item.scene_id,marker_id:item.marker_id});item.hot_zones=context.hot_zones;item.start=context.marker.seconds;item.end=context.marker.end_seconds>item.start?context.marker.end_seconds:Math.min(item.start+duration,sourceDuration||Infinity);item.title=context.marker.title||context.marker.primary_tag.name;
      edit({media:media.concat(item)});setMessage('Added '+item.title+' to project media.');
    }
    function insertMedia(key,index=selected==null?doc.clips.length:selected+1){
      const item=media.find(c=>patterns.mediaKey(c)===key);if(!item||busy)return;
      if(doc.clips.length>=2000){setMessage('A compilation supports up to 2000 clips.');return;}
      edit({media,clips:patterns.insertClip(doc.clips,item,index)});setSelected(index);setTrimSession(n=>n+1);setPreview(inspectorOpen?'trim':'compilation');
    }
    function removeMedia(key){edit({media:media.filter(c=>patterns.mediaKey(c)!==key)});}
    function restoreMedia(item,index){
      if(media.some(c=>patterns.mediaKey(c)===patterns.mediaKey(item)))return;
      if(media.length>=2000){setMessage('A project supports up to 2000 catalog markers.');return false;}
      const next=media.slice();next.splice(Math.min(index,next.length),0,item);edit({media:next});
    }
    function selectClip(index){if(index===selected)return;trimControls.current?.pause();if(inspectorOpen)stop();setSelected(index);setTrimSession(n=>n+1);setPreview(inspectorOpen?'trim':'compilation');}
    function showTrim(){stop();setInspectorOpen(true);setPreview('trim');}
    function inspectClip(index){selectClip(index);showTrim();}
    function closeInspector(){trimControls.current?.pause();setInspectorOpen(false);setPreview('compilation');requestAnimationFrame(()=>document.querySelectorAll('.mc-timeline-clip')[selected]?.focus({preventScroll:true}));}

    function changeClip(patch){
      const updated={...clip,...patch};
      if(!patterns.validHotZone(updated)){setMessage('Hot zones must not overlap and must stay inside the clip range, with start before end.');return false;}
      selectedClipRef.current=updated;edit({clips:doc.clips.map((c,i)=>i===selected?updated:c)});return true;
    }
    async function updateOriginalMarker(){
      await trimControls.current?.flush();
      const currentClip=selectedClipRef.current;
      if(!currentClip?.marker_id)throw Error('This clip has no original marker. Use Save as new marker.');
      const {marker}=await op({action:'marker_context',scene_id:currentClip.scene_id,marker_id:currentClip.marker_id});
      const result=await op({action:'save_marker',mode:'update',clip:currentClip,title:currentClip.title||marker.title,
        primary_tag_id:marker.primary_tag.id,tag_ids:marker.tags.map(t=>t.id),expected:marker});
      setMessage('Updated original marker: '+result.marker.title+'. Range and hot zones saved to Stash.');
    }
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
    async function play(position=0,onlyIndex=null){
      setRenderedVideo(null);
      if((onlyIndex===null?doc.clips:[doc.clips[onlyIndex]]).some(c=>patterns.missingRanges(c)))throw Error('Choose ranges for missing zones before playback.');
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
      const offset=onlyIndex===null?0:patterns.timeline(resolved.clips)[onlyIndex].start;
      const passes=patterns.expand(onlyIndex===null?resolved.clips:[resolved.clips[onlyIndex]]).map(p=>onlyIndex===null?p:{...p,clipIndex:onlyIndex,timelineStart:p.timelineStart+offset,timelineEnd:p.timelineEnd+offset});
      if(onlyIndex!==null)position=offset;
      setSeekRequest({position,serial:++serial.current,play:true});
      setCurrent(position);setPlayer({clips:passes,mode,key:serial.current});
    }
    function seek(position){
      if(busy)return;
      if(renderedVideo){const video=renderedRef.current;if(video){video.currentTime=Math.min(position,video.duration||0);setCurrent(video.currentTime);}return;}
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
      if(renderedVideo){const video=renderedRef.current;if(video)video.paused?video.play().catch(()=>setMessage('Press play on the video to begin.')):video.pause();}else if(player)playerControls.current?.toggle();else perform(()=>play(current));
    }
    useEffect(()=>{
      function hotkey(e){
        if(e.key==='Escape'&&!modal&&inspectorOpen){e.preventDefault();e.stopImmediatePropagation();closeInspector();return;}
        if((e.key==='Delete'||e.key==='Backspace')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!e.shiftKey&&clipShortcutTarget(e.target)&&clip){e.preventDefault();e.stopPropagation();if(!e.repeat)removeClip();return;}
        if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||modal)return;
        if(inspectorOpen&&clip&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
          if(e.target instanceof Element&&(e.target.closest('input:not([type="range"]),textarea,select,[role="textbox"]')||e.target.isContentEditable))return;
          e.preventDefault();e.stopImmediatePropagation();
          if(e.key==='ArrowLeft'||e.key==='ArrowRight')trimControls.current?.second(e.key==='ArrowLeft'?-1:1);
          else trimControls.current?.frame(e.key==='ArrowUp'?1:-1);
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
          h(React.Fragment,null,h('span',{className:'mc-save-state'},documents.length+' saved'),button('New compilation',()=>{if(choose(blank()))setView('editor');},busy,{className:'mc-primary'})),button('Render video',()=>perform(openRender),busy||!doc.clips.length),h(Link,{to:'/marker-creation'},'Create markers'),h(Link,{to:'/marker-screening'},'Screen scenes')),
      message&&h('div',{className:'mc-notice',role:'status'},message,button('×',()=>setMessage(''),false,{'aria-label':'Dismiss message'})),
      h('div',{className:'mc-workspace'},
        view==='viewer'&&h('aside',{className:'mc-library','aria-label':'Saved compilations'},h('div',{className:'mc-panel-heading'},h('h2',null,'Saved compilations'),button('Refresh',()=>perform(reload),busy)),
          h('input',{type:'search','aria-label':'Search compilations',placeholder:'Search compilations',value:libraryQuery,onChange:e=>setLibraryQuery(e.target.value)}),
          h('div',{className:'mc-library-list'},documents.filter(d=>d.name.toLowerCase().includes(libraryQuery.toLowerCase())).map(d=>button(h(React.Fragment,null,h('strong',null,d.name),h('small',null,d.clips.length+' clips · '+time(d.clips.reduce((n,c)=>n+patterns.duration(c),0)))),()=>choose(d),busy,{key:d.id,className:'mc-library-item'+(d.id===doc.id?' is-selected':''),'aria-pressed':d.id===doc.id}))),
          !documents.length&&h('p',null,'No saved compilations yet.'),
          doc.id&&h('div',{className:'mc-library-actions'},button('Edit compilation',()=>switchView('editor'),busy),button('Delete compilation',()=>{if(window.confirm('Delete this compilation? Source scenes and markers are kept.'))perform(async()=>{await op({action:'delete',id:doc.id,revision:doc.revision});choose(blank());await load();});},busy))),
        view==='editor'&&h('aside',{className:'mc-media-sidebar','aria-label':'Project media'},
          button(mediaCollapsed?'▸':'◂ Project media',()=>setMediaCollapsed(v=>!v),false,{'aria-label':mediaCollapsed?'Expand project media':'Collapse project media','aria-expanded':!mediaCollapsed,'aria-controls':'mc-project-media'}),
          h('div',{id:'mc-project-media',hidden:mediaCollapsed},h(MediaCatalog,{key:doc.id||'new',media,clips:doc.clips,busy,onRemove:removeMedia,onRestore:restoreMedia,onInsert:insertMedia,onDrop:(key,x,y)=>dropMediaRef.current?.(key,x,y)}))),
        h('section',{className:'mc-monitor',ref:monitor,'aria-label':'Preview viewport'},
          h('div',{className:'mc-monitor-heading'},h('div',null,h('span',{className:'mc-eyebrow'},'COMPILATION PREVIEW'),h('strong',null,trimActive?'Trim: '+clip.title:doc.name)),
            h('div',{className:'mc-inline'},view==='editor'&&h('div',{className:'mc-preview-modes','aria-label':'Preview mode'},button('Compilation',closeInspector,busy,{'aria-pressed':!trimActive}),button('Trim selected clip',showTrim,busy||!clip,{'aria-pressed':trimActive})),!trimActive&&!renderedVideo&&h('select',{'aria-label':'Playback mode',value:mode,disabled:busy,onChange:e=>{stop();setMode(e.target.value);}},h('option',{value:'source'},'Source videos'),h('option',{value:'cache'},'Prepared clips')),
              button(fullscreen?'Exit fullscreen':'Fullscreen',toggleFullscreen,false))),
          h('div',{className:'mc-main-trim',ref:setTrimTarget,hidden:!trimActive}),
          !trimActive&&(renderedVideo?h('div',{className:'mc-rendered-player'},h('video',{ref:renderedRef,src:exportURL(renderedVideo),controls:true,playsInline:true,preload:'metadata',onError:()=>setMessage('This rendered video could not be loaded. Check that the output file is still available.'),onTimeUpdate:e=>setCurrent(e.target.currentTime)}),h('div',{className:'mc-transport'},h('span',null,'Rendered · revision '+renderedVideo.revision),button('Back to source preview',stop,false),renderedVideo.scene_id&&h(Link,{to:'/scenes/'+renderedVideo.scene_id},'Open scene'))):player?h(Player,{key:player.key,clips:player.clips,mode:player.mode,seekRequest,onProgress:progress,onActive:activate,onStop:stop,controls:playerControls}):
            h(React.Fragment,null,h('div',{className:'mc-video-surface mc-idle'},poster&&h('img',{src:poster,alt:''}),h('div',null,h('span',{className:'mc-idle-glyph','aria-hidden':true},'▷'),
              h('strong',null,doc.clips.length?'Ready when you are':'Your compilation starts here'),h('p',null,doc.clips.length?'Play the full sequence, or double-click a timeline clip to edit it.':'Add markers to build a timeline of your favourite moments.'),
              !!doc.clips.length&&button('Play compilation',()=>perform(()=>play(0)),busy,{className:'mc-primary'}))),
              h('div',{className:'mc-transport'},button('Play from start',()=>perform(()=>play(0)),busy||!doc.clips.length),h('span',{className:'mc-pass'},'Space to play / pause')))),
          view==='viewer'&&h('div',{className:'mc-monitor-footer'},h('output',{'aria-label':'Preview time'},time(current)+' / '+time(renderedVideo?.duration||total)),h('span',null,renderedVideo?'Playing rendered video':mode==='source'?'Playing from original scenes':'Playing prepared clips'))),
        view==='editor'&&inspectorOpen&&clip&&h('div',{className:'mc-edit-sidebar'},
          h(Inspector,{key:trimSession+':'+String(selected)+':'+(clip?.scene_id||''),onBeforePlay:showTrim,onClose:closeInspector,frameCache,customPatterns,onManagePatterns:()=>perform(managePatterns),onPlaySequence:()=>perform(()=>play(0,selected)),onSaveMarker:mode=>mode==='update'?perform(updateOriginalMarker):setModal('marker-new'),trimControls,trimTarget,clip,busy,onChange:changeClip,onApplyAll:()=>edit({clips:doc.clips.map(c=>({...c,phases:patterns.applySequence(patterns.portableSequence(clip),c),hot_zones:patterns.identifiedZones(c)}))})}))),
      view==='editor'?h(Timeline,{clips:doc.clips,selected,active,current,busy,onSelect:selectClip,onInspect:inspectClip,onSeek:seek,onMove:move,onRemove:removeClip,onPlay:()=>perform(()=>play(entries[selected].start)),onCache:()=>setModal('cache'),job,onInsertMedia:insertMedia,dropMediaRef}):!renderedVideo&&h('label',{className:'mc-viewer-seek'},'Position',h('input',{'aria-label':'Viewer position',type:'range',min:0,max:total||1,step:.05,value:Math.min(current,total),disabled:busy||!total,onChange:e=>seek(Number(e.target.value))}),h('output',null,time(current)+' / '+time(total))),
      view==='viewer'&&h('footer',{className:'mc-editor-footer'},h('span',null,view==='editor'?'Select a clip to trim or change its pattern.':'Choose a saved compilation and press Space to play.'),button('Prepare clips'+(job?' · generating…':''),()=>setModal('cache'),busy)),
      modal==='unsaved'&&dialog('Unsaved changes',h(React.Fragment,null,h('p',null,'Save your edits before returning to compilations?'),message&&h('p',{role:'alert'},message)),h('div',{className:'mc-inline'},button('Keep editing',()=>setModal(null),busy),button('Discard edits',()=>{choose(documents.find(d=>d.id===doc.id)||blank(),true);setModal(null);setView('viewer');},busy),button('Save and return',()=>perform(async()=>{await save();stop();setModal(null);setView('viewer');}),busy,{className:'mc-primary'}))),
      modal==='markers'&&dialog('Add markers to project',h(React.Fragment,null,
        h('div',{className:'mc-browser-filters'},h(Field,{label:'Search markers'},h('input',{type:'search',value:query,autoFocus:true,onChange:e=>{setQuery(e.target.value);setPage(1);}})),
          h(Field,{label:'Topic / tag'},h('select',{value:tag,onChange:e=>{setTag(e.target.value);setPage(1);}},h('option',{value:''},'All tags'),tags.map(t=>h('option',{key:t.id,value:t.id},t.name))))),
        h('details',{className:'mc-add-options'},h('summary',null,'Options for added clips'),
          h('div',{className:'mc-browser-filters'},h(Field,{label:'Duration without an end (seconds)'},h('input',{type:'number',min:.1,step:.1,value:defaultDuration,onChange:e=>setDefaultDuration(e.target.value)})),
            h(Field,{label:'Default pattern for imported markers'},h('select',{value:defaultPattern,onChange:e=>setDefaultPattern(e.target.value)},presetOptions(customPatterns))))),
        h('p',{className:'mc-muted',role:'status'},loading?'Loading markers…':count+' markers'),
        message&&h('p',{role:'status'},message),
        h('div',{className:'mc-marker-grid'},!loading&&!markers.length&&h('p',null,'No markers match these filters.'),markers.map(m=>h('article',{key:m.id,className:'mc-marker'},
          h('img',{src:m.screenshot,alt:'',loading:'lazy'}),h('div',null,h('strong',null,m.title||m.primary_tag.name),h('p',null,m.scene.title||'Scene '+m.scene.id),h('small',null,time(m.seconds)+' → '+(m.end_seconds>m.seconds?time(m.end_seconds):'default duration'))),button(media.some(c=>String(c.marker_id)===String(m.id))?'✓ In project':'+ Add',()=>perform(()=>add(m)),busy||media.some(c=>String(c.marker_id)===String(m.id)),{'aria-label':(media.some(c=>String(c.marker_id)===String(m.id))?'In project: ':'Add ')+(m.title||m.primary_tag.name)})))),
        h('div',{className:'mc-pagination'},button('Previous page',()=>setPage(page-1),page===1||loading),h('span',null,'Page '+page),button('Next page',()=>setPage(page+1),page*24>=count||loading))),
        h(React.Fragment,null,h('span',{role:'status'},media.length+' markers in project'),button('Done',()=>setModal(null),false,{className:'mc-primary'})),'xl'),
      modal==='marker-new'&&clip&&dialog('Save as new marker',h(MarkerSaveForm,{clip,mode:'new',onSaved:marker=>{setModal(null);setMessage('Saved marker: '+marker.title+'. Existing compilation clips are unchanged.');}}),button('Close',()=>setModal(null),false)),
      modal==='patterns'&&dialog('Repetition patterns',h(PatternManager,{initial:clip?patterns.portableSequence(clip):patterns.presets.once,zoneCount:clip?patterns.hotZones(clip).length:0,items:customPatterns,onSave:savePattern,onDelete:deletePattern}),button('Done',()=>setModal(null),false)),
      modal==='render'&&dialog('Render compilation video',h(React.Fragment,null,
        h('div',{className:'mc-render-options'},
          h(Field,{label:'Quality'},h('select',{value:renderQuality,onChange:e=>setRenderQuality(e.target.value)},h('option',{value:'720p'},'720p · smaller file'),h('option',{value:'1080p'},'1080p · higher detail'))),
          h('label',null,h('input',{type:'checkbox',checked:renderAudio,onChange:e=>setRenderAudio(e.target.checked)}),' Include audio'),
          h('label',null,h('input',{type:'checkbox',checked:renderLibrary,onChange:e=>setRenderLibrary(e.target.checked)}),' Add to Stash library'),
          renderLibrary&&h(Field,{label:'Library folder'},h('select',{value:renderDirectory,onChange:e=>setRenderDirectory(e.target.value)},h('option',{value:''},'Choose a video library folder'),(renderConfig?.libraries||[]).map(path=>h('option',{key:path,value:path},path)))),
          renderLibrary&&h('label',null,h('input',{type:'checkbox',checked:copyMetadata,onChange:e=>setCopyMetadata(e.target.checked)}),' Copy source performers and tags')),
        h('p',{className:'mc-muted'},renderLibrary?'Saved in a Marker Compilations subfolder and imported as a regular scene.':'Saved outside the scene library in '+(renderConfig?.private_directory||'the persistent plugin data folder')+'.'),
        h('p',{className:'mc-muted'},'MP4 · 30 fps · hard cuts · pitch-preserving speed changes. Each render creates a new version of the saved sequence.'),
        button('Start rendering',()=>perform(startRender),busy||!doc.clips.length||(renderLibrary&&!renderDirectory),{className:'mc-primary'}),
        message&&h('p',{role:'status'},message),
        h('h3',null,'Rendered versions'),
        !exports.length&&h('p',null,'No rendered videos yet.'),
        exports.map(item=>h('article',{className:'mc-render-version',key:item.id},
          h('div',null,h('strong',null,item.name+' · revision '+item.revision),h('small',null,item.quality+' · '+new Date(item.created*1000).toLocaleString()+(item.revision!==doc.revision||dirty?' · Changes since this render':''))),
          h('p',{role:'status'},item.status==='rendering'?'Rendering · '+Math.round(item.progress*100)+'%':item.status==='importing'?'Importing into Stash…':item.status==='import_error'?'Video ready · library import needs attention':item.status),
          ['queued','rendering'].includes(item.status)&&h('progress',{max:1,value:item.progress}),
          item.error&&h('p',{role:'alert'},item.error),
          h('div',{className:'mc-inline'},item.playable&&button('Watch rendered video',()=>watchExport(item),false),item.playable&&h('a',{href:exportURL(item),download:item.name+'.mp4'},'Download'),item.scene_id&&h(Link,{to:'/scenes/'+item.scene_id},'Open scene'),
            ['queued','rendering'].includes(item.status)&&item.job_id&&button('Cancel render',()=>perform(async()=>{await client.mutate({mutation:gql`mutation($id:ID!){stopJob(job_id:$id)}`,variables:{id:item.job_id}});await refreshExports();}),busy),
            item.status==='import_error'&&item.library&&button('Retry library import',()=>perform(async()=>{await op({action:'retry_import',export_id:item.id});await refreshExports();}),busy))))) ,button('Done',()=>setModal(null),false),'lg'),
      modal==='cache'&&dialog('Prepare clips for playback',h(React.Fragment,null,h('p',null,'Optional: create a separate video file for each trimmed interval. This can help when playing the original source videos is unreliable, but uses extra disk space.'),
        h('p',null,'For normal playback, leave the player on Source videos; no preparation is needed. After generating, choose Prepared clips in the player. This does not export a single compilation movie.'),
        h(Field,{label:'Maximum clip width'},h('select',{value:doc.width,disabled:busy,onChange:e=>edit({width:Number(e.target.value)})},[640,1280,1920].map(w=>h('option',{key:w,value:w},w+' px')))),
        h('label',null,h('input',{type:'checkbox',checked:doc.audio,disabled:busy,onChange:e=>edit({audio:e.target.checked})}),' Include audio'),
        h('p',{role:'status'},jobStatus),message&&h('p',{role:'status'},message),
        h('div',{className:'mc-inline'},button('Generate clips',()=>perform(generate),busy||!!job||!doc.clips.length,{className:'mc-primary'}),job&&button('Cancel generation',()=>perform(async()=>{await client.mutate({mutation:gql`mutation($id:ID!){stopJob(job_id:$id)}`,variables:{id:job}});}),busy))),button('Done',()=>setModal(null),false)));
  }
  api.patch.before('ScenePage.Tabs',props=>[{...props,children:h(React.Fragment,null,props.children,h(api.libraries.Bootstrap.Nav.Item,null,h(api.libraries.Bootstrap.Nav.Link,{as:Link,to:'/marker-creation?scene='+props.scene.id,eventKey:'marker-creation'},'Create markers')))}]);
  api.register.route('/marker-screening',ScreeningPage);
  api.register.route('/marker-creation',MarkerWorkspace);
  api.register.route('/marker-compilations',Page);
  api.patch.before('MainNavBar.MenuItems',props=>[{...props,children:h(React.Fragment,null,props.children,
    h(api.libraries.Bootstrap.Nav.Link,{as:'div',eventKey:'/marker-compilations',className:'col-4 col-sm-3 col-md-2 col-lg-auto'},
      h(api.libraries.Bootstrap.Button,{as:api.libraries.ReactRouterDOM.NavLink,to:'/marker-compilations',exact:true,className:'minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center mc-nav-link'},
        h('svg',{className:'svg-inline--fa fa-icon nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0 mc-nav-icon',viewBox:'0 0 24 24',fill:'currentColor','aria-hidden':true},
          h('path',{d:'M3 3h18v18H3V3zm2 2v3h2V5H5zm12 0v3h2V5h-2zM5 10v4h2v-4H5zm12 0v4h2v-4h-2zM5 16v3h2v-3H5zm12 0v3h2v-3h-2zM10 8v8l6-4-6-4z'})),
        h('span',null,'Compilations'))))}]);
  api.patch.before('SettingsToolsSection',props=>[{...props,children:h(React.Fragment,null,props.children,h(api.components.Setting,{heading:h(Link,{to:'/marker-compilations'},'Open Marker Compilations')}))}]);
})();
