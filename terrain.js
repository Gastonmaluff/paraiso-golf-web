// Metres of elevation; horizontal map cells remain the game's approximate 20 m.
export const HEIGHT_SCALE=1/18;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function heightAt(grid,x,y){
  const n=grid.length;x=clamp(x,0,n-1);y=clamp(y,0,n-1);
  const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
  const a=grid[iy][ix],b=grid[iy][Math.min(n-1,ix+1)],c=grid[Math.min(n-1,iy+1)][ix],d=grid[Math.min(n-1,iy+1)][Math.min(n-1,ix+1)];
  return (a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty;
}
export function gradient(height,x,y){return {x:(height(x+.25,y)-height(x-.25,y))/.5,y:(height(x,y+.25)-height(x,y-.25))/.5}}
export function unprojectHeight(a,b,height){
  // Pick the frontmost intersection of the screen ray and the height field.
  const f=s=>s-height((a+s)/2,(s-a)/2)*4*HEIGHT_SCALE-b;
  let high=b+12*4*HEIGHT_SCALE,previous=high;
  for(let i=1;i<=64;i++){
    const low=high-i*(12*4*HEIGHT_SCALE)/64;
    if(f(low)<=0&&f(previous)>=0){let left=low,right=previous;for(let j=0;j<20;j++){const mid=(left+right)/2;if(f(mid)>0)right=mid;else left=mid}const s=(left+right)/2;return {x:(a+s)/2,y:(s-a)/2}}
    previous=low;
  }
  return {x:(a+b)/2,y:(b-a)/2};
}
const friction={green:.55,tee:.7,fairway:.8,path:.5,grass:1.5,tree:1.8,sand:3.2,water:4};
function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy;const t=d?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/d,0,1):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t)}

// Deterministic preview and actual rolls use the same slope/friction integrator.
export function simulateRoll({start,direction,distance,height,terrain,cup,putting,size}){
  let p={...start},v={x:direction.x*Math.sqrt(2*(putting?.55:.8)*Math.max(.001,distance)),y:direction.y*Math.sqrt(2*(putting?.55:.8)*Math.max(.001,distance))};
  const path=[{...p,t:0,lift:0}],dt=.04,bounce=putting?0:.32,timeScale=1.3;
  let sunk=false,penalty=terrain(p.x,p.y)==='water',elapsed=0;
  for(let i=1;i<=200&&!penalty;i++){
    const slope=gradient(height,p.x,p.y),speed=Math.hypot(v.x,v.y),mu=(friction[terrain(p.x,p.y)]||1.5)*(elapsed<bounce?.25:1);
    const ax=-slope.x*.28,ay=-slope.y*.28;
    if(speed<.025&&Math.hypot(ax,ay)<mu)break;
    const drag=Math.max(0,speed-mu*dt)/Math.max(.00001,speed);
    const nextV={x:v.x*drag+ax*dt,y:v.y*drag+ay*dt};
    const q={x:clamp(p.x+(v.x+nextV.x)*dt/2,.1,size-1.1),y:clamp(p.y+(v.y+nextV.y)*dt/2,.1,size-1.1)};
    elapsed=i*dt;
    // Forgiving visual cup, distinct from the enlarged ball sprite. A fast
    // pass or an approach landing metres away should not count as holed.
    if(cup&&elapsed>=bounce&&Math.hypot(nextV.x,nextV.y)<.35&&segmentDistance(cup,p,q)<.035){p={...cup};sunk=true;path.push({...p,t:elapsed/timeScale,lift:0});break}
    penalty=terrain(q.x,q.y)==='water';
    const edge=Math.abs(q.x-p.x)+Math.abs(q.y-p.y)<.00001;
    p=q;v=nextV;
    if(!putting&&elapsed-dt<bounce&&elapsed>=bounce){v.x*=.78;v.y*=.78}
    path.push({...p,t:elapsed/timeScale,lift:elapsed<bounce?Math.sin(elapsed/bounce*Math.PI)*.12:0});
    if(edge)break;
  }
  const duration=Math.max(.65,elapsed/timeScale);if(path.at(-1).t<duration)path.push({...p,t:duration,lift:0});
  return {to:p,path,duration,sunk,penalty};
}

export function sampleRoll(path,time){
  if(time<=0)return path[0];const index=path.findIndex(p=>p.t>=time);
  if(index<0)return path.at(-1);if(index===0)return path[0];
  const a=path[index-1],b=path[index],t=(time-a.t)/(b.t-a.t);
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,lift:a.lift+(b.lift-a.lift)*t};
}
