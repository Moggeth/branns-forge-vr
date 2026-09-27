'use strict';
// Completed build durations only; never imply elapsed time is verified completion.
function jobProgress(job,jobs,now=Date.now()) {
  const seconds=jobs.filter(j=>j.status==='ready').map(j=>Number(j.elapsedSeconds)||((j.readyAt-j.startedAt)/1000)).filter(n=>Number.isFinite(n)&&n>=5&&n<=3600).slice(-20).sort((a,b)=>a-b);
  const median=seconds.length ? (seconds[Math.floor((seconds.length-1)/2)]+seconds[Math.floor(seconds.length/2)])/2 : null;
  const elapsed=job.status==='ready' ? Number(job.elapsedSeconds)||0 : job.startedAt ? Math.max(0,(now-job.startedAt)/1000) : 0;
  const ready=job.status==='ready',running=['building','validating'].includes(job.status);
  const low=median===null?null:Math.round(median*(seconds.length<3?.6:.8));
  const high=median===null?null:Math.round(median*(seconds.length<3?1.5:1.3));
  return {id:job.id,status:job.status,stage:job.stage,startedAt:job.startedAt||null,elapsedSeconds:elapsed,
    sampleCount:seconds.length,estimatedTotalSeconds:median,remainingLowSeconds:running&&low!==null?Math.max(0,low-elapsed):null,
    remainingHighSeconds:running&&high!==null?Math.max(0,high-elapsed):null,overEstimate:running&&high!==null&&elapsed>high,
    estimatedProgress:ready?1:job.status==='validating'?.95:running&&median?Math.min(.9,elapsed/median*.9):null};
}
module.exports={jobProgress};
