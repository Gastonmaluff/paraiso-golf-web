export const CONTACT_FRACTION = .52;
export const BALL_RADIUS = 1/60;
// Yaw in the map plane, projected with the same 2:1 geometry as the course.
// Heights stay vertical: rotating the whole 2D sprite would tilt its roof posts.
export function cartPose(heading) {
  const c=Math.cos(heading),s=Math.sin(heading);
  const forward={x:(c-s)/2,y:(c+s)/4},side={x:(-s-c)/2,y:(c-s)/4};
  return {forward,side,point:(along,across,height=0)=>({
    x:along*forward.x+across*side.x,
    y:along*forward.y+across*side.y-height
  })};
}
const clamp = t => Math.max(0, Math.min(1, t));
const ease = t => {t=clamp(t);return t*t*(3-2*t)};
const blend=(a,b,t)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+(b[k]-a[k])*ease(t)]));

// Side-on projection: takeaway, wrist hinge, downswing with lag, ground-level
// contact and finish over the lead shoulder. Unwrapped angles keep the shaft
// on the correct arc instead of taking a shortcut through the top.
// PGA First Swing: https://pdf.pgalinks.com/p-g-a/FirstSwing/Golf_Skills.pdf
export function swingPose(g,contact={x:9,y:-BALL_RADIUS*56}) {
  const address={hx:4.5,hy:-10,angle:Math.atan2(contact.y+10,contact.x-4.5),lean:.3,tilt:2,turn:0,heel:0,knee:.8,lx:1,ly:-12,rx:5.8,ry:-12};
  const impact={...address,lean:.8,turn:1.1,heel:.5};
  const top={hx:-5,hy:-22,angle:Math.PI*2-.35,lean:-.2,tilt:2,turn:-1.8,heel:.2,knee:.8,lx:-1,ly:-17,rx:-6.5,ry:-15};
  const finish={hx:5,hy:-23,angle:-2.8,lean:1.2,tilt:.3,turn:2,heel:2.2,knee:0,lx:7,ly:-17,rx:2.5,ry:-18};
  const puttBack={...address,hx:1.7,angle:address.angle+.12,turn:-.15};
  const puttFollow={...address,hx:7.5,angle:address.angle-.1,turn:.15};
  const end=g._isPutting?puttFollow:finish;
  let pose;
  if(g.phase==='aiming')pose=address;
  else if(g.phase==='preparing'){
    const fade=1-clamp(g.poseTime/Math.max(.1,g.actionDuration));
    pose={...address,angle:address.angle+Math.sin(g.poseTime*3)*.025*fade};
  }else if(g.phase==='swinging'){
    const t=clamp(g.poseTime/g.actionDuration);
    const keys=g._isPutting?
      [[0,address],[.32,puttBack],[CONTACT_FRACTION,impact],[.55,impact],[.85,puttFollow],[1,puttFollow]]:
      [[0,address],
       [.16,{...address,hx:1,hy:-10.5,angle:Math.PI,turn:-.5,lx:-.5,ly:-12,rx:3,ry:-12}],
       [.31,{...top,hx:-3,hy:-17,angle:Math.PI*1.32,turn:-1.2}],
       [.40+(g.id||0)%2*.008,top],
       [.46,{...impact,hx:-1,hy:-15,angle:Math.PI*1.15,turn:-.3,lx:-1,ly:-12,rx:3,ry:-12}],
       [.495,{...impact,hx:3,hy:-11,angle:1.9,lx:0,ly:-12,rx:4.5,ry:-12}],
       [CONTACT_FRACTION,impact],[.55,impact],
       [.63,{...impact,hx:7,hy:-12,angle:-.12,turn:1.5,heel:1.1,lx:4,ly:-13,rx:6,ry:-13}],
       [.75,{...finish,hx:8,hy:-19,angle:-1.6,lx:5,ly:-17,rx:7,ry:-16}],
       [.88,finish],[1,finish]];
    const index=keys.findIndex(([time])=>time>=t);
    if(index<=0)pose=keys[0][1];
    else{const [aTime,a]=keys[index-1],[bTime,b]=keys[index];pose=blend(a,b,(t-aTime)/(bTime-aTime))}
  }else if(g.phase==='watching')pose=blend(end,{...address,hy:-11,heel:0},(g.poseTime/Math.max(.1,g.actionDuration)-.45)/.55);
  else return null;
  const length=Math.hypot(contact.x-address.hx,contact.y-address.hy);
  return {...pose,cx:pose.hx+Math.cos(pose.angle)*length,cy:pose.hy+Math.sin(pose.angle)*length};
}

// Shared by renderer and tests, in golfer sprite units.
export function contactPoint(g,elevationDelta=0) {
  const ball=g._addressBall||g.shot?.from||g.ball;
  const dx=(ball.x-g.x)-(ball.y-g.y),dy=(ball.x-g.x)+(ball.y-g.y);
  const facing=dx<0?-1:1;
  return {x:dx*28*facing,y:dy*14-BALL_RADIUS*56-elevationDelta*56/18,facing};
}

export const rollProgress = t => 1-(1-clamp(t))**2;

// Individual cadence and opposite arm/leg motion, driven by simulation time.
export function walkingPose(g,maxSpeed) {
  const moving=['walking','positioning','disembarking','returningCart'].includes(g.phase);
  const stride=moving?clamp((g._speed||0)/maxSpeed):0;
  const cycle=g.poseTime*(6.4+(g.id%4)*.32)+(g.id%7)*.7;
  return {step:Math.sin(cycle)*1.9*stride,arm:Math.sin(cycle+.35)*1.4*stride,
    bob:Math.abs(Math.sin(cycle))*.5*stride,hip:Math.sin(cycle)*.2*stride,
    lift:Math.max(0,Math.cos(cycle))*.75*stride,
    breathe:moving?0:Math.sin(g.poseTime*1.4+g.id)*.16};
}
