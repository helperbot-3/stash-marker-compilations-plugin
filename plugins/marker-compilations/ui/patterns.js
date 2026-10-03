(function (root) {
  'use strict';
  let idCounter=0;
  function uniqueId(){
    // randomUUID requires a secure context; LAN Stash installations often use HTTP.
    if(typeof root.crypto?.randomUUID==='function')return root.crypto.randomUUID();
    if(typeof root.crypto?.getRandomValues==='function'){
      const bytes=root.crypto.getRandomValues(new Uint8Array(16));
      bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
      const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
    }
    return 'id-'+Date.now().toString(36)+'-'+(++idCounter).toString(36)+'-'+Math.random().toString(36).slice(2);
  }

  const presets = {
    once: [{repeat:1,speed:1}],
    '3-2-3': [{repeat:3,speed:1},{repeat:2,speed:0.5},{repeat:3,speed:1}],
    '2-2-2': [{repeat:2,speed:1},{repeat:2,speed:0.5},{repeat:2,speed:1}],
    'repeat-3': [{repeat:3,speed:1}],
    'repeat-5': [{repeat:5,speed:1}],
    'half-speed': [{repeat:1,speed:.5}],
    'quarter-speed': [{repeat:1,speed:.25}],
    'normal-slow': [{repeat:1,speed:1},{repeat:1,speed:.5}],
    'slow-normal': [{repeat:1,speed:.5},{repeat:1,speed:1}],
    'progressive': [{repeat:1,speed:1},{repeat:1,speed:.75},{repeat:1,speed:.5},{repeat:1,speed:.25}],
    'slow-return': [{repeat:1,speed:1},{repeat:1,speed:.5},{repeat:1,speed:.25},{repeat:1,speed:.5},{repeat:1,speed:1}]
  };
  const presetLabels={once:'Once · normal', '3-2-3':'3 normal → 2 half-speed → 3 normal', '2-2-2':'2 normal → 2 half-speed → 2 normal',
    'repeat-3':'Repeat 3× · normal', 'repeat-5':'Repeat 5× · normal', 'half-speed':'Once · half-speed', 'quarter-speed':'Once · quarter-speed',
    'normal-slow':'Normal → half-speed', 'slow-normal':'Half-speed → normal', 'progressive':'Slow down · 1× → ¾× → ½× → ¼×', 'slow-return':'Slow down & return · 1× → ¼× → 1×'};
  function mediaKey(c){return String(c.scene_id)+':'+(c.marker_id?'marker:'+c.marker_id:'range:'+c.start+':'+c.end);}
  function catalog(document){const items=new Map();for(const c of (document.media??document.clips??[]))if(!items.has(mediaKey(c)))items.set(mediaKey(c),copyClip(c));return [...items.values()];}
  function insertClip(clips,clip,index){const result=clips.slice();result.splice(Math.max(0,Math.min(index,result.length)),0,copyClip(clip));return result;}
  function phases(clip) { return clip.phases || presets.once; }
  function hotZones(clip){return (Array.isArray(clip.hot_zones)?clip.hot_zones:clip.hot_zone?[clip.hot_zone]:[]).slice().sort((a,b)=>(a?.start||0)-(b?.start||0));}
  function identifiedZones(clip){return hotZones(clip).map((z,i)=>({...z,id:z.id||'legacy-'+i}));}
  function sequence(clip){
    const result=[];
    phases(clip).forEach((p,i)=>{
      if(p.target){result.push({...p});return;}
      for(let j=0;j<p.repeat;j++){
        const target=repetitionRange(phases(clip),i,j),last=result[result.length-1];
        if(last&&last.target===target&&last.speed===p.speed&&last.repeat<20)last.repeat++;
        else result.push({target,repeat:1,speed:p.speed});
      }
    });return result;
  }
  function stepRanges(clip,target){
    const zones=identifiedZones(clip);
    if(target==='full')return [{start:clip.start,end:clip.end}];
    if(target==='hot')return zones.length?zones:[{start:clip.start,end:clip.end}];
    return zones.filter(z=>'zone:'+z.id===target);
  }
  function missingRanges(clip){return sequence(clip).some(p=>!stepRanges(clip,p.target).length);}
  function portableSequence(clip){const zones=identifiedZones(clip);return sequence(clip).map(p=>({...p,target:p.target.startsWith('zone:')?'slot:'+(zones.findIndex(z=>'zone:'+z.id===p.target)+1):p.target}));}
  function applySequence(phases,clip){const zones=identifiedZones(clip);return sequence({phases}).map(p=>({...p,target:p.target.startsWith('slot:')&&zones[Number(p.target.slice(5))-1]?'zone:'+zones[Number(p.target.slice(5))-1].id:p.target}));}
  function adjustedRange(range,patch,min,max,others=[]){
    const next={...range,...patch};
    if(patch.start!==undefined&&next.start>=range.end){
      if(others.some(z=>next.start>=z.start&&next.start<z.end))return null;
      const bound=Math.min(max,...others.filter(z=>z.start>next.start).map(z=>z.start));
      next.end=Math.min(bound,next.start+(range.end-range.start));
    }
    return next.start>=min&&next.end<=max&&next.end>next.start&&!others.some(z=>next.start<z.end&&next.end>z.start)?next:null;
  }
  function validHotZone(clip) {
    if(clip.hot_zones!==undefined&&!Array.isArray(clip.hot_zones))return false;
    const zones=hotZones(clip);
    return zones.length<=20&&zones.every((z,i)=>z&&Number.isFinite(z.start)&&Number.isFinite(z.end)&&z.start>=clip.start&&z.end<=clip.end&&z.end>z.start&&(!i||z.start>=zones[i-1].end));
  }
  function newHotZone(clip,position){
    const zones=hotZones(clip), gaps=[];let start=clip.start;
    for(const z of zones){if(z.start>start)gaps.push({start,end:z.start});start=z.end;}
    if(start<clip.end)gaps.push({start,end:clip.end});
    const gap=gaps.find(g=>position>=g.start&&position<g.end)||gaps.sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0];
    if(!gap||zones.length>=20)return null;
    const from=position>=gap.start&&position<gap.end?position:gap.start;
    return {start:from,end:Math.min(gap.end,from+Math.min(1,(gap.end-gap.start)/2))};
  }
  function repetitionRange(sequence,phaseIndex,repeatIndex) {
    if(sequence[phaseIndex].target)return sequence[phaseIndex].target;
    const explicit=sequence[phaseIndex].ranges?.[repeatIndex];
    if(explicit==='full'||explicit==='hot')return explicit;
    const index=sequence.slice(0,phaseIndex).reduce((n,p)=>n+Number(p.repeat),0)+repeatIndex;
    const total=sequence.reduce((n,p)=>n+Number(p.repeat),0);
    return index>0&&index<total-1?'hot':'full';
  }
  function validRanges(phase){return phase.ranges===undefined||(Array.isArray(phase.ranges)&&phase.ranges.length===phase.repeat&&phase.ranges.every(r=>['auto','full','hot'].includes(r)));}
  function phaseDurations(clip) {
    return phases(clip).map((p,i)=>Array.from({length:p.repeat},(_,j)=>stepRanges(clip,repetitionRange(phases(clip),i,j)).reduce((n,z)=>n+z.end-z.start,0)).reduce((n,d)=>n+d,0)/(Number(p.speed)||1));
  }
  function duration(clip) {return phaseDurations(clip).reduce((n,d)=>n+d,0);}
  function timeline(clips) {
    let start=0;
    return clips.map((clip,index)=>{
      const length=duration(clip), entry={index,start,end:start+length,duration:length};
      start+=length;return entry;
    });
  }
  function expand(clips) {
    let position=0;
    return clips.flatMap((clip,clipIndex)=>{
      return phases(clip).flatMap((phase,phaseIndex)=>Array.from({length:phase.repeat},(_,repeatIndex)=>{
        const target=repetitionRange(phases(clip),phaseIndex,repeatIndex),hot=target!=='full';
        return stepRanges(clip,target).map(({start,end},zoneIndex)=>{
          const timelineStart=position;position+=(end-start)/phase.speed;
          return {...clip,start,end,cacheOffset:start-clip.start,isHotZone:hot,zoneIndex:hot?zoneIndex:null,speed:phase.speed,clipIndex,phaseIndex,repeatIndex,repeatCount:phase.repeat,timelineStart,timelineEnd:position};
        });
      }).flat());
    });
  }
  function locate(passes,position) {
    if(!passes.length)return {index:0,offset:0};
    const last=passes[passes.length-1];
    const time=Math.max(0,Math.min(Number(position)||0,last.timelineEnd));
    const index=passes.findIndex(p=>time<p.timelineEnd);
    const i=index<0?passes.length-1:index, pass=passes[i];
    return {index:i,offset:Math.max(0,Math.min((time-pass.timelineStart)*pass.speed,pass.end-pass.start))};
  }
  function reorder(clips,from,to) {
    if(from<0||from>=clips.length||to<0||to>=clips.length)return clips;
    const result=clips.slice(), [clip]=result.splice(from,1);result.splice(to,0,clip);return result;
  }
  function formatTime(seconds) {
    const value=Math.max(0,Number(seconds)||0);
    const minutes=Math.floor(value/60);
    const remainder=Number((value-minutes*60).toFixed(6));
    if(remainder===60)return (minutes+1)+':00';
    return minutes+':'+String(remainder).padStart(remainder<10?String(remainder).length+1:2,'0');
  }
  function parseTime(text) {
    const match=String(text).trim().match(/^(?:(\d+):)?(\d+):([0-5]?\d(?:\.\d{1,6})?)$/);
    if(!match)return null;
    if(match[1]!==undefined&&Number(match[2])>=60)return null;
    const value=Number(match[1]||0)*3600+Number(match[2])*60+Number(match[3]);
    return Number.isFinite(value)&&value<=Number.MAX_SAFE_INTEGER?value:null;
  }
  function frameRate(value){
    const rate=Number(value);if(!Number.isFinite(rate)||rate<=0||rate>1000)return null;
    for(const n of [24000,30000,60000,120000])if(Math.abs(rate-n/1001)<.0001)return n/1001;
    return rate;
  }
  function frameTime(seconds,fps){
    const rate=frameRate(fps);if(!rate)return '--:--:--:--';
    const nominal=Math.round(rate)||1, frames=Math.floor(Math.max(0,Number(seconds)||0)*rate+rate*.000002);
    const whole=Math.floor(frames/nominal), pad=n=>String(n).padStart(2,'0');
    return pad(Math.floor(whole/3600))+':'+pad(Math.floor(whole/60)%60)+':'+pad(whole%60)+':'+String(frames%nominal).padStart(Math.max(2,String(nominal-1).length),'0');
  }
  function parseFrameTime(text,fps){
    const match=String(text).trim().match(/^(\d+):([0-5]\d):([0-5]\d):(\d{2,3})$/), rate=frameRate(fps);
    if(!match)return parseTime(text);
    if(!rate||Number(match[4])>=Math.round(rate))return null;
    return ((Number(match[1])*3600+Number(match[2])*60+Number(match[3]))*Math.round(rate)+Number(match[4]))/rate;
  }
  function frameIndex(times,position){
    let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>1;if(times[mid]<=position+.000002)lo=mid+1;else hi=mid;}return lo-1;
  }
  function frameStep(window,position,count){
    if(!window?.times?.length)return null;
    if(position>window.times[window.times.length-1]+.00002&&!window.at_end)return null;
    const index=frameIndex(window.times,position), next=index+count;
    if(index<0||next<0&&!window.at_start||next>=window.times.length&&!window.at_end)return null;
    return window.times[Math.max(0,Math.min(window.times.length-1,next))];
  }
  // Keep one decoder seek in flight. Rapid inputs accumulate against the intended
  // position and intermediate destinations are skipped once decoding completes.
  function seekQueue(read,write,changed){
    let target=null,active=false,issued=null;
    function pump(){
      if(active||target===null)return;
      if(Math.abs(read()-target)<.00002){target=null;return;}
      active=true;issued=target;write(target);
    }
    return {
      position:()=>target??read(),
      request:value=>{target=value;changed(value);pump();},
      settled:()=>{active=false;if(target===issued)target=null;issued=null;pump();return target===null;},
      reset:()=>{target=null;active=false;issued=null;}
    };
  }
  const clipboardType='stash-marker-compilation-clip';
  function copyClip(clip) {
    return {scene_id:String(clip.scene_id),marker_id:String(clip.marker_id||''),title:String(clip.title||''),start:clip.start,end:clip.end,phases:phases(clip).map(p=>({...p,...(p.ranges?{ranges:p.ranges.slice()}:{})})),...(clip.hot_zones!==undefined?{hot_zones:clip.hot_zones.map(z=>({...z}))}:clip.hot_zone?{hot_zone:{...clip.hot_zone}}:{})};
  }
  function encodeClip(clip){return JSON.stringify({type:clipboardType,version:1,clip:copyClip(clip)});}
  function decodeClip(text){
    try {
      if(text.length>20000)return null;
      const data=JSON.parse(text), c=data.clip;
      if(data.type!==clipboardType||data.version!==1||!c||!/^\d+$/.test(c.scene_id)||typeof c.title!=='string'||c.title.length>300)return null;
      if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start)return null;
      if(!Array.isArray(c.phases)||!c.phases.length||c.phases.length>200||c.phases.some(p=>!p||!Number.isInteger(p.repeat)||p.repeat<1||p.repeat>20||![.25,.5,.75,1,1.25,1.5,2,3].includes(p.speed)))return null;
      if(!validHotZone(c)||c.phases.some(p=>!validRanges(p)||(p.target&&!/^(full|hot|zone:[A-Za-z0-9_-]{1,80}|slot:[0-9]{1,2})$/.test(p.target))))return null;
      return copyClip(c);
    }catch{return null;}
  }
  function markerMatchesTarget(marker,target){
    const tags=new Set([marker.primary_tag?.id,...(marker.tags||[]).map(t=>t.id)].map(String));
    return (!target.title||marker.title===target.title)&&[target.marker_tag_id,...(target.tag_ids||[])].every(id=>tags.has(String(id)));
  }
  const api={markerMatchesTarget,uniqueId,seekQueue,presets,presetLabels,mediaKey,catalog,insertClip,frameRate,frameTime,parseFrameTime,frameIndex,frameStep,phases,sequence,identifiedZones,stepRanges,missingRanges,portableSequence,applySequence,adjustedRange,hotZones,newHotZone,repetitionRange,validRanges,validHotZone,phaseDurations,duration,timeline,expand,locate,reorder,formatTime,parseTime,encodeClip,decodeClip};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MarkerCompilationPatterns=api;
})(typeof window==='undefined'?globalThis:window);
