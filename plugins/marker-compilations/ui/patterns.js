(function (root) {
  'use strict';
  const presets = {
    once: [{repeat:1,speed:1}],
    '3-2-3': [{repeat:3,speed:1},{repeat:2,speed:0.5},{repeat:3,speed:1}],
    '2-2-2': [{repeat:2,speed:1},{repeat:2,speed:0.5},{repeat:2,speed:1}]
  };
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
  const api={presets,phases,duration,timeline,expand,locate,reorder};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MarkerCompilationPatterns=api;
})(typeof window==='undefined'?globalThis:window);
