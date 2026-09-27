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
  function expand(clips) {
    return clips.flatMap((clip,clipIndex)=>phases(clip).flatMap((phase,phaseIndex)=>
      Array.from({length:phase.repeat},(_,repeatIndex)=>({...clip,speed:phase.speed,clipIndex,phaseIndex,repeatIndex,repeatCount:phase.repeat}))));
  }
  const api={presets,phases,duration,expand};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MarkerCompilationPatterns=api;
})(typeof window==='undefined'?globalThis:window);
