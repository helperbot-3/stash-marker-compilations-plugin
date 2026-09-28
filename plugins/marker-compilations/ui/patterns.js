(function (root) {
  'use strict';
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
  function catalog(document){const items=new Map();for(const c of [...(document.media||[]),...(document.clips||[])])if(!items.has(mediaKey(c)))items.set(mediaKey(c),copyClip(c));return [...items.values()];}
  function insertClip(clips,clip,index){const result=clips.slice();result.splice(Math.max(0,Math.min(index,result.length)),0,copyClip(clip));return result;}
  function phases(clip) { return clip.phases || presets.once; }
  function duration(clip) {
    return Math.max(0,clip.end-clip.start)*phases(clip).reduce((total,p)=>total+(Number(p.repeat)||0)/(Number(p.speed)||1),0);
  }
  function timeline(clips) {
    let start=0;
    return clips.map((clip,index)=>{
      const length=duration(clip), entry={index,start,end:start+length,duration:length};
      start+=length;return entry;
    });
  }
  function expand(clips) {
    let position=0;
    return clips.flatMap((clip,clipIndex)=>phases(clip).flatMap((phase,phaseIndex)=>
      Array.from({length:phase.repeat},(_,repeatIndex)=>{
        const timelineStart=position;
        position+=(clip.end-clip.start)/phase.speed;
        return {...clip,speed:phase.speed,clipIndex,phaseIndex,repeatIndex,repeatCount:phase.repeat,timelineStart,timelineEnd:position};
      })));
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
  const clipboardType='stash-marker-compilation-clip';
  function copyClip(clip) {
    return {scene_id:String(clip.scene_id),marker_id:String(clip.marker_id||''),title:String(clip.title||''),start:clip.start,end:clip.end,phases:phases(clip).map(p=>({...p}))};
  }
  function encodeClip(clip){return JSON.stringify({type:clipboardType,version:1,clip:copyClip(clip)});}
  function decodeClip(text){
    try {
      if(text.length>20000)return null;
      const data=JSON.parse(text), c=data.clip;
      if(data.type!==clipboardType||data.version!==1||!c||!/^\d+$/.test(c.scene_id)||typeof c.title!=='string'||c.title.length>300)return null;
      if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start)return null;
      if(!Array.isArray(c.phases)||!c.phases.length||c.phases.length>10||c.phases.some(p=>!p||!Number.isInteger(p.repeat)||p.repeat<1||p.repeat>20||![.25,.5,.75,1,1.25,1.5,2,3].includes(p.speed)))return null;
      return copyClip(c);
    }catch{return null;}
  }
  const api={presets,presetLabels,mediaKey,catalog,insertClip,phases,duration,timeline,expand,locate,reorder,formatTime,parseTime,encodeClip,decodeClip};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MarkerCompilationPatterns=api;
})(typeof window==='undefined'?globalThis:window);
