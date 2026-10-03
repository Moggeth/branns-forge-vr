// Camera-local coordinates: +X right, +Y up, -Z forward. These coefficients
// match stepCombat's 60 Hz drag-then-gravity velocity and trapezoidal position.
export const SIEGEBIRD_BALLISTICS = Object.freeze({speed:42, gravity:3, drag:.045, dt:1/60});
const {speed,drag,dt}=SIEGEBIRD_BALLISTICS;
const damping=Math.exp(-drag*dt),maxSteps=600;
const finiteVector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const fallback=reason=>({valid:false,reason,direction:[0,0,-1],yaw:0,elevation:0,flightTime:0,holdovers:[]});

// Position at each physics tick is muzzle + direction*A + gravity*B.
// Fractional samples lie on the same swept segment used for collision.
const distanceCoefficients=[{a:0,b:0}];
let forwardSpeed=speed,gravitySpeed=0;
for(let i=0;i<maxSteps;i++){
  const nextForward=forwardSpeed*damping,nextGravity=gravitySpeed*damping+dt;
  const previous=distanceCoefficients.at(-1);
  distanceCoefficients.push({a:previous.a+(forwardSpeed+nextForward)*.5*dt,b:previous.b+(gravitySpeed+nextGravity)*.5*dt});
  forwardSpeed=nextForward;gravitySpeed=nextGravity;
}
function coefficients(time){
  const tick=Math.max(0,Math.min(maxSteps,time/dt)),index=Math.min(maxSteps-1,Math.floor(tick)),fraction=tick-index;
  const first=distanceCoefficients[index],second=distanceCoefficients[index+1];
  return {a:first.a+(second.a-first.a)*fraction,b:first.b+(second.b-first.b)*fraction};
}
function positionAt(muzzle,direction,gravity,time){
  const {a,b}=coefficients(time);return muzzle.map((n,i)=>n+direction[i]*a+gravity[i]*b);
}

// The first crossing is the useful outbound trajectory, even when gravity has a
// forward/backward component because the player is looking uphill or downhill.
export function sampleSiegebirdTrajectory({muzzle=[0,0,0],direction=[0,0,-1],gravity=[0,-3,0],range=30}={}){
  if(!finiteVector(muzzle)||!finiteVector(direction)||!finiteVector(gravity)||!Number.isFinite(range)||range<=0)return null;
  let previous=[...muzzle];
  for(let i=1;i<=maxSteps;i++){
    const position=positionAt(muzzle,direction,gravity,i*dt);
    if(previous[2]>=-range&&position[2]<=-range&&previous[2]!==position[2]){
      const fraction=(-range-previous[2])/(position[2]-previous[2]);
      return {position:previous.map((n,a)=>n+(position[a]-n)*fraction),flightTime:(i-1+fraction)*dt};
    }
    previous=position;
  }
  return null;
}

export function solveSiegebirdBallistics({muzzle=[0,0,0],zeroDistance=30,ranges=[50,70],gravity=[0,-3,0]}={}){
  if(!finiteVector(muzzle)||!finiteVector(gravity)||!Number.isFinite(zeroDistance)||zeroDistance<=0||zeroDistance>250||muzzle.some(n=>Math.abs(n)>20)||Math.hypot(...gravity)>20)return fallback('invalid_parameters');
  const delta=[-muzzle[0],-muzzle[1],-zeroDistance-muzzle[2]];
  if(Math.hypot(...delta)<1e-6||delta[2]>=0)return fallback('target_not_ahead');
  const residual=time=>{const {a,b}=coefficients(time);return a-Math.hypot(...delta.map((n,i)=>n-gravity[i]*b));};
  let lower=0,upper=dt;
  while(upper<=maxSteps*dt&&residual(upper)<0){lower=upper;upper+=dt;}
  if(upper>maxSteps*dt)return fallback('unreachable_zero');
  // Earliest root selects the direct firing solution rather than a lobbed arc.
  for(let i=0;i<40;i++){const middle=(lower+upper)*.5;if(residual(middle)<0)lower=middle;else upper=middle;}
  const flightTime=(lower+upper)*.5,{a,b}=coefficients(flightTime),direction=delta.map((n,i)=>(n-gravity[i]*b)/a);
  const magnitude=Math.hypot(...direction);for(let i=0;i<3;i++)direction[i]/=magnitude;
  const holdovers=(Array.isArray(ranges)?ranges:[]).filter(range=>Number.isFinite(range)&&range>0&&range<=250).map(range=>{
    const sample=sampleSiegebirdTrajectory({muzzle,direction,gravity,range});
    return sample?{range,...sample,verticalAngle:-Math.atan2(sample.position[1],range),horizontalAngle:-Math.atan2(sample.position[0],range)}:{range,reachable:false};
  });
  return {valid:true,direction,yaw:Math.atan2(direction[0],-direction[2]),elevation:Math.atan2(direction[1],Math.hypot(direction[0],direction[2])),flightTime,holdovers};
}
