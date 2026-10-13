// Original Canvas vector artwork, in the established golfer units (tileW/56).
import {carryClubPose,CART_BAG} from './club-animation.js?v=13';
const TAU=Math.PI*2;
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const clamp=value=>Math.max(0,Math.min(1,finite(value)));
const mix=(a,b,t)=>a+(b-a)*t;
const point=(value,fallback)=>({x:finite(value?.x,fallback.x),y:finite(value?.y,fallback.y)});
const hex=value=>{
  if(typeof value!=='string'||!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value))return null;
  const v=value.slice(1).toLowerCase();return '#'+(v.length===3?[...v].map(c=>c+c).join(''):v);
};
const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
const tint=(color,amount)=>{
  const target=amount>0?255:26,f=Math.abs(amount);
  return '#'+rgb(color).map(v=>Math.round(mix(v,target,f)).toString(16).padStart(2,'0')).join('');
};
const luminance=color=>{const [r,g,b]=rgb(color);return (.2126*r+.7152*g+.0722*b)/255};
const idOf=g=>Math.abs(Math.trunc(finite(g?.id)));

/** Preferences belong to the UI's human golfer; NPC appearance remains stable. */
export function defaultAppearance(g={},override=null){
  const id=idOf(g),defaults={shirt:hex(g.color)||'#b35e48',pants:['#e5dfce','#839086','#d3d0bd','#ab977a'][id%4],
    hat:id%5===3?'visor':'cap',hatColor:['#f7eed7','#d9e2c7','#ead7b3'][id%3],emblem:['flag','leaf','diamond','none'][id%4]};
  const prefs=g.controlled&&override&&typeof override==='object'?override:{};
  return {shirt:hex(prefs.shirt)||defaults.shirt,pants:hex(prefs.pants)||defaults.pants,
    hat:['cap','visor','none'].includes(prefs.hat)?prefs.hat:defaults.hat,hatColor:hex(prefs.hatColor)||defaults.hatColor,
    emblem:['flag','leaf','diamond','none'].includes(prefs.emblem)?prefs.emblem:defaults.emblem};
}
const polygon=(ctx,points,color)=>{
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=color;ctx.fill();
};
const line=(ctx,points,color,width=1)=>{
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
};
const ellipse=(ctx,x,y,rx,ry,color)=>{
  ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.fillStyle=color;ctx.fill();
};
function curved(ctx,commands,color){
  ctx.beginPath();
  for(const [kind,...v]of commands){
    if(kind==='M')ctx.moveTo(...v);else if(kind==='Q')ctx.quadraticCurveTo(...v);else if(kind==='L')ctx.lineTo(...v);else ctx.closePath();
  }
  ctx.fillStyle=color;ctx.fill();
}
function rounded(ctx,x,y,w,h,r,color){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=color;ctx.fill()}
function emblem(ctx,appearance,x,y){
  if(appearance.emblem==='none')return;
  const contrast=luminance(appearance.shirt)>.68?'#35553f':'#f4e7b9';
  ctx.save();ctx.translate(x,y);
  if(appearance.emblem==='flag'){
    line(ctx,[[-1.1,-1.4],[-1.1,1.35]],contrast,.3);
    polygon(ctx,[[-.9,-1.35],[1.35,-.6],[-.9,.1]],'#d57a50');
    line(ctx,[[-.8,-1.15],[.75,-.6]],'#f5cf81',.2);
  }else if(appearance.emblem==='leaf'){
    curved(ctx,[['M',-1.15,.85],['Q',-1.3,-1.1,1.2,-1.4],['Q',1.5,.85,-1.15,.85],['Z']],contrast);
    line(ctx,[[-1.15,1.3],[.75,-1]],tint(appearance.shirt,-.25),.24);
    line(ctx,[[-.45,.3],[-.8,-.35]],tint(appearance.shirt,-.25),.16);
  }else{
    polygon(ctx,[[0,-1.45],[1.35,0],[0,1.45],[-1.35,0]],contrast);
    polygon(ctx,[[0,-.68],[.65,0],[0,.68],[-.65,0]],tint(appearance.shirt,-.16));
  }
  ctx.restore();
}
function head(ctx,center,tilt,appearance,id,facing=1,scale=1){
  const skin='#e8c49a',hair=['#59452f','#393e34','#8a7655','#665d48'][id%4];
  ctx.save();ctx.translate(center.x,center.y);ctx.rotate(tilt);ctx.scale(facing*scale,scale);
  ellipse(ctx,-.05,.05,2.03,2.62,skin);
  curved(ctx,[['M',1.3,-1.6],['Q',2.0,-1.0,2.15,-.5],['L',2.85,.08],['Q',2.35,.5,1.85,.4],['L',1.5,1.7],['Q',.4,2.8,-.75,2.5],['Q',1.1,1.55,1.3,-1.6],['Z']],'#efcfaa');
  ellipse(ctx,-1.93,.3,.48,.7,'#dcad82');
  line(ctx,[[-1.93,0],[-1.7,.2],[-1.88,.6]],'#bc946e',.16);
  curved(ctx,[['M',-1.8,-.5],['Q',-2.3,-2.0,-.75,-2.55],['Q',.6,-2.8,1.4,-2.0],['Q',-.4,-1.8,-1.3,-.5],['Z']],hair);
  ellipse(ctx,1.55,-.75,.17,.18,'#414735');
  line(ctx,[[1.8,.85],[2.17,.72]],'#a17c60',.16);
  if(appearance.hat==='cap'){
    curved(ctx,[['M',-2.65,-1.75],['Q',-2.55,-3.6,.05,-3.6],['Q',2.65,-3.5,2.7,-1.85],['L',1.2,-1.4],['Z']],appearance.hatColor);
    curved(ctx,[['M',-2.65,-1.75],['L',2.6,-2.0],['Q',4.1,-1.95,4.55,-1.2],['Q',2.65,-1.1,.6,-1.35],['Z']],tint(appearance.hatColor,-.18));
    line(ctx,[[-.6,-3.1],[.1,-2.0]],tint(appearance.hatColor,-.22),.18);
    ellipse(ctx,.05,-3.4,.28,.15,tint(appearance.hatColor,-.2));
  }else if(appearance.hat==='visor'){
    curved(ctx,[['M',-2.4,-1.95],['Q',.3,-2.1,2.45,-1.9],['L',2.45,-1.2],['Q',0,-1.05,-2.4,-1.4],['Z']],appearance.hatColor);
    curved(ctx,[['M',1.2,-1.6],['Q',3.4,-1.95,4.45,-1.1],['Q',3,-.85,1.2,-1.1],['Z']],tint(appearance.hatColor,-.16));
  }
  ctx.restore();
}
function shirt(ctx,body,appearance){
  const {lean,upper,y,turn}=body,sw=4-Math.min(1.2,Math.abs(turn)*.5),c=appearance.shirt;
  curved(ctx,[['M',upper-sw,-15.3+y],['Q',upper-sw-.1,-16.0+y,upper-1.4,-16.4+y],['L',upper+1.4,-16.4+y],
    ['Q',upper+sw+.1,-16.0+y,upper+sw,-15.3+y],['L',lean+3.25,-8.0+y],['Q',lean+3.4,-7.1+y,lean+2.65,-6.9+y],
    ['L',lean-2.65,-6.9+y],['Q',lean-3.4,-7.1+y,lean-3.25,-8.0+y],['Z']],c);
  curved(ctx,[['M',upper-sw,-15.3+y],['L',upper-sw+1.1,-15.7+y],['L',lean-2.2,-7.1+y],['L',lean-2.8,-7.0+y],['Z']],tint(c,-.17));
  line(ctx,[[upper+1.9,-15.5+y],[lean+2.8,-8.0+y]],tint(c,.10),.2);
  rounded(ctx,upper-.76,-17.65+y,1.5,1.5,.45,'#dfb78e');
  polygon(ctx,[[upper-.8,-16.6+y],[upper-1.8,-16.0+y],[upper-.4,-14.7+y],[upper+.12,-16.0+y]],tint(c,.25));
  polygon(ctx,[[upper+.8,-16.6+y],[upper+1.8,-16.0+y],[upper+.4,-14.7+y],[upper-.12,-16.0+y]],tint(c,.17));
  line(ctx,[[upper,-15.8+y],[mix(upper,lean,.3),-12.8+y]],tint(c,-.15),.35);
  for(const [i,fy]of [-15.2,-14.35,-13.5].entries())ellipse(ctx,mix(upper,lean,i*.13),fy+y,.16,.17,'#eee4c7');
  line(ctx,[[lean-2.8,-7.2+y],[lean+2.8,-7.2+y]],tint(c,-.22),.24);
  line(ctx,[[lean-.9,-9.2+y],[lean+.7,-8.6+y]],tint(c,-.11),.16);
  emblem(ctx,appearance,mix(upper,lean,.3)+1.25,-12.6+y);
}
function shoe(ctx,x,lift,color){
  curved(ctx,[['M',x-.9,-1.3-lift],['Q',x-.9,-1.9-lift,x+.15,-1.65-lift],['L',x+1.5,-1.1-lift],
    ['Q',x+2.05,-.5-lift,x+1.7,-.08-lift],['L',x-.95,-.08-lift],['Q',x-1.1,-.65-lift,x-.9,-1.3-lift],['Z']],color);
  line(ctx,[[x-.85,-lift],[x+1.65,-lift]],'#25382f',.2);
  line(ctx,[[x+.25,-1.2-lift],[x+.8,-.9-lift]],'#c9d2b6',.18);
}
function legs(ctx,gait,pose,body,appearance){
  const step=finite(gait.step),knee=finite(pose?.knee);
  for(const side of [-1,1]){
    const x=side*2,bend=side===-1?-step:step,lift=side===-1?finite(pose?.heel,finite(gait.lift)):0;
    const hip={x:(x+body.lean)*.9,y:-8+body.y},joint={x:x+bend*.4+knee,y:-4-lift*.3},foot={x:x+bend,y:-1-lift};
    ctx.beginPath();ctx.moveTo(hip.x,hip.y);ctx.quadraticCurveTo(joint.x,joint.y-.7,joint.x,joint.y);ctx.lineTo(foot.x,foot.y);
    ctx.strokeStyle=appearance.pants;ctx.lineWidth=2.15;ctx.stroke();
    line(ctx,[[hip.x-.45,hip.y],[joint.x-.45,joint.y],[foot.x-.45,foot.y]],tint(appearance.pants,-.16),.3);
    shoe(ctx,foot.x,lift,'#394d3c');
  }
}
function arm(ctx,shoulder,elbow,hand,appearance,glove=false){
  line(ctx,[[shoulder.x,shoulder.y],[elbow.x,elbow.y]],'#ddb88e',1.8);
  line(ctx,[[elbow.x,elbow.y],[hand.x,hand.y]],'#e8c49a',1.55);
  const sleeve={x:mix(shoulder.x,elbow.x,.4),y:mix(shoulder.y,elbow.y,.4)};
  line(ctx,[[shoulder.x,shoulder.y],[sleeve.x,sleeve.y]],appearance.shirt,2.25);
  line(ctx,[[sleeve.x-.3,sleeve.y],[sleeve.x+.3,sleeve.y]],tint(appearance.shirt,.22),.22);
  ellipse(ctx,hand.x,hand.y,.7,.62,glove?'#e9e6ce':'#e8c49a');
}
function prop(ctx,life,hands,scale=1){
  const p=life?.prop,opacity=clamp(life?.strength);if(!p||opacity<=0)return;
  const hand=hands[p.hand==='left'?'left':'right'];
  ctx.save();ctx.globalAlpha=finite(ctx.globalAlpha,1)*opacity;ctx.translate(hand.x,hand.y);ctx.scale(scale,scale);
  if(p.type==='phone'){
    ctx.save();ctx.rotate(-.13);rounded(ctx,-.75,-1.7,1.7,3.1,.35,'#34483c');rounded(ctx,-.55,-1.45,1.3,2.35,.2,'#91aaa0');
    line(ctx,[[-.25,1.05],[.35,1.05]],'#e6e7c9',.2);ctx.restore();
  }else if(p.type==='watch'){
    rounded(ctx,-1.05,-.35,2.1,.65,.25,'#66664f');ellipse(ctx,0,0,.65,.6,'#e5e2bd');
    line(ctx,[[0,-.4],[0,0],[.3,.2]],'#596347',.16);
  }else if(p.type==='cigarette'){
    line(ctx,[[.25,-.2],[2.0,-.15]],'#e6e4cb',.3);line(ctx,[[1.65,-.16],[2.0,-.15]],'#d28651',.32);
    const puff=clamp(p.puff);if(puff>0){
      ctx.globalAlpha*=puff*.45;ctx.strokeStyle='#dae1cf';ctx.lineWidth=.3;ctx.beginPath();ctx.moveTo(2,-.3);
      ctx.quadraticCurveTo(3,-1.5,2.3,-2.5);ctx.quadraticCurveTo(1.6,-3.5,2.6,-4.5);ctx.stroke();
    }
  }else if(p.type==='terere'){
    curved(ctx,[['M',-.5,.9],['L',1.6,.9],['Q',1.7,3.3,.6,3.4],['Q',-.7,3.2,-.5,.9],['Z']],'#8a6445');
    ellipse(ctx,.55,.95,1.08,.4,'#b8aa76');ellipse(ctx,.55,.9,.8,.22,'#65824a');
    line(ctx,[[.7,.9],[.4,-.4],[-.1,-.65]],'#c6d0b9',.3);
  }
  ctx.restore();
  if(p.type==='terere'&&p.secondary==='thermos'){
    const other=hands.left;
    ctx.save();ctx.globalAlpha=finite(ctx.globalAlpha,1)*opacity;ctx.translate(other.x-.7*scale,other.y+1.0*scale);ctx.scale(scale,scale);
    rounded(ctx,-.9,-.6,1.8,5.4,.6,'#587c75');rounded(ctx,-.65,-1.1,1.3,.7,.2,'#d6d8bb');
    line(ctx,[[-.45,.2],[-.45,3.6]],'#91b1a0',.25);line(ctx,[[.85,.2],[1.45,.5],[1.45,2.3],[.9,2.5]],'#466960',.35);ctx.restore();
  }
}
function gestureArm(shoulder,baseElbow,baseHand,target,strength,side){
  if(!target)return {elbow:baseElbow,hand:baseHand};
  const destination=point(target,baseHand),elbow={x:shoulder.x*.45+destination.x*.55+side*.7,y:Math.max(shoulder.y,destination.y)+.8};
  return {elbow:{x:mix(baseElbow.x,elbow.x,strength),y:mix(baseElbow.y,elbow.y,strength)},hand:{x:mix(baseHand.x,destination.x,strength),y:mix(baseHand.y,destination.y,strength)}};
}

function freeHandLife(life,held){
  if(!life||!held)return life;
  if(held.suppressLife||held.type==='retrievingClub')return null;
  const occupied=held.club?.hand==='right'?'right':'left',free=occupied==='left'?'right':'left',p=life.prop;
  const swapped=p?.hand===occupied,activity={...life,[occupied+'Hand']:null};
  if(swapped)activity[free+'Hand']=life[occupied+'Hand']||life[free+'Hand'];
  if(p)activity.prop={...p,hand:free,secondary:null};
  return activity;
}
function drawHeldClub(ctx,held){
  const c=held?.club;if(!c||![c.grip?.x,c.grip?.y,c.head?.x,c.head?.y,c.angle].every(Number.isFinite))return;
  const clip=Number.isFinite(c.clipBelowY)?c.clipBelowY:Infinity;
  const visibleStart=c.grip.y>clip?{x:c.grip.x,y:clip}:c.grip;
  line(ctx,[[visibleStart.x,visibleStart.y],[c.head.x,c.head.y]],'#b7c2ba',.5);
  const gripEnd={x:c.grip.x+Math.cos(c.angle)*1.7,y:c.grip.y+Math.sin(c.angle)*1.7};
  if(gripEnd.y<=clip)line(ctx,[[visibleStart.x,visibleStart.y],[gripEnd.x,gripEnd.y]],'#4d5e4e',.75);
  const nx=-Math.sin(c.angle)*.85,ny=Math.cos(c.angle)*.85;
  line(ctx,[[c.head.x-nx,c.head.y-ny],[c.head.x+nx,c.head.y+ny]],'#63766b',1.05);
}

/** Fixed bag in the established cart frame; the actor owns the extracted club. */
export function drawCartBag(ctx,{point:project,extracting=false,carried=false,color='#5c6947'}={}){
  if(typeof project!=='function')return;
  const c=hex(color)||'#5c6947',a=CART_BAG.along,corners=[[a-1.5,-3],[a+1.5,-3],[a+1.5,3],[a-1.5,3]];
  const top=corners.map(([along,across])=>project(along,across,CART_BAG.rimHeight));
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  for(let i=0;i<4;i++){
    const first=corners[i],next=corners[(i+1)%4],ground=project(...first,3),adjacent=project(...next,3);
    if(project(...first,0).y+project(...next,0).y>=project(a,0,0).y*2){
      polygon(ctx,[[ground.x,ground.y],[adjacent.x,adjacent.y],[top[(i+1)%4].x,top[(i+1)%4].y],[top[i].x,top[i].y]],tint(c,-.14-i*.025));
    }
  }
  polygon(ctx,top.map(p=>[p.x,p.y]),tint(c,.13));
  const rim=project(a,0,CART_BAG.rimHeight+.05);ellipse(ctx,rim.x,rim.y,1.4,.55,tint(c,-.32));
  const slots=extracting||carried?[-1.55,1.55]:[-1.55,0,1.55];
  for(const across of slots){
    const height=CART_BAG.headHeight+(across===0?0:across>0?.65:-.35);
    const shaft=project(a,across,CART_BAG.rimHeight),headPoint=project(a,across,height);
    line(ctx,[[shaft.x,shaft.y],[headPoint.x,headPoint.y]],'#b7c2ba',.42);
    line(ctx,[[headPoint.x-.85,headPoint.y],[headPoint.x+.85,headPoint.y]],'#63766b',1.05);
  }
  const strapTop=project(a-1.65,0,11.5),strapBottom=project(a-1.65,0,5);
  line(ctx,[[strapTop.x,strapTop.y],[strapBottom.x,strapBottom.y]],'#9aa878',.45);
  ctx.restore();
}

/** The caller sets map origin, facing and the original tileW/56 scale. */
export function drawGolfer(ctx,{g={},gait={},pose=null,life=null,appearance=null,selected=false,celebrate=false,clubPose=null,carryClub=g.carryClub===true}={}){
  const held=!pose?(clubPose||(carryClub?carryClubPose({carryClub:true},gait):null)):null;
  const activity=freeHandLife(life,held),look=defaultAppearance(g,appearance),id=idOf(g),amount=pose||celebrate?0:clamp(activity?.strength);
  const y=pose||held?.type==='retrievingClub'?0:-finite(gait.bob)+finite(gait.breathe),lean=finite(pose?.lean,finite(gait.hip)),turn=finite(pose?.turn);
  const body={lean,upper:lean+finite(pose?.tilt)+turn,y,turn};
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  ellipse(ctx,0,1,6,2,'#34552c40');
  if(selected){ctx.beginPath();ctx.ellipse(0,0,9,4,0,0,TAU);ctx.strokeStyle='#f1e6a4';ctx.lineWidth=.65;ctx.stroke()}
  legs(ctx,gait,pose,body,look);
  shirt(ctx,body,look);
  line(ctx,[[lean-2.8,-7.6+y],[lean+2.8,-7.6+y]],'#57664d',.55);
  line(ctx,[[lean-2.35,-7.2+y],[lean-1.7,-8.5+y]],tint(look.pants,-.19),.18);
  line(ctx,[[lean+2.35,-7.2+y],[lean+1.7,-8.5+y]],tint(look.pants,-.19),.18);
  const headBase={x:lean+finite(pose?.tilt)+turn*.6+.25,y:-19.4+y},targetHead=point(activity?.head,headBase);
  const h={x:mix(headBase.x,targetHead.x,amount),y:mix(headBase.y,targetHead.y,amount)};
  head(ctx,h,amount*finite(activity?.head?.tilt),look,id,amount>.5&&finite(activity?.gaze,1)<0?-1:1);
  const hands={};
  for(const side of [-1,1]){
    const key=side===-1?'left':'right',shoulder={x:body.upper+side*3,y:-14.3+y};
    let elbow,hand;
    if(pose){elbow={x:finite(side===-1?pose.lx:pose.rx,shoulder.x),y:finite(side===-1?pose.ly:pose.ry,-11.3)};hand={x:finite(pose.hx),y:finite(pose.hy,-10)}}
    else{
      elbow={x:side*4.5-finite(gait.arm)*side*.4,y:-11.3+y};hand={x:side*4.2-finite(gait.arm)*side,y:-8.6+y};
      if(held?.[key+'Hand'])({elbow,hand}=gestureArm(shoulder,elbow,hand,held[key+'Hand'],1,side));
      else if(celebrate){hand=side===1?{x:6+Math.sin(finite(g.poseTime)*4),y:-23.8}:{x:-6,y:-10};elbow=side===1?{x:7,y:-18}:{x:-6,y:-10.8}}
      else ({elbow,hand}=gestureArm(shoulder,elbow,hand,activity?.[key+'Hand'],amount,side));
    }
    arm(ctx,shoulder,elbow,hand,look,!!pose&&side===-1);hands[key]=hand;
  }
  if(pose&&[pose.hx,pose.hy,pose.cx,pose.cy,pose.angle].every(Number.isFinite)){
    line(ctx,[[pose.hx,pose.hy],[pose.cx,pose.cy]],'#dadfd0',.65);
    const nx=-Math.sin(pose.angle)*1.1,ny=Math.cos(pose.angle)*1.1;
    // Symmetric face around the exact shaft endpoint: never offset the impact.
    line(ctx,[[pose.cx-nx,pose.cy-ny],[pose.cx+nx,pose.cy+ny]],'#63766b',1.2);
  }else if(!pose){drawHeldClub(ctx,held);if(!celebrate)prop(ctx,activity,hands)}
  ctx.restore();
}

/** A seated passenger reuses face, polo and embroidery without changing the cart. */
export function drawCartRider(ctx,{g={},appearance=null,life=null,point:project,facing=1}={}){
  if(typeof project!=='function')return;
  const look=defaultAppearance(g,appearance),id=idOf(g),side=facing<0?-1:1,headStrength=clamp(life?.strength),amount=life?.parked?headStrength:0;
  const torso=project(-4,0,12),face=project(-4,0,16),lap=project(-3.5,0,8.6);
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  rounded(ctx,lap.x-2.1,lap.y-.8,4.2,2, .7,look.pants);
  ctx.save();ctx.translate(torso.x,torso.y);ctx.scale(side*.6,.52);ctx.translate(0,11.7);
  shirt(ctx,{lean:0,upper:0,y:0,turn:0},look);ctx.restore();
  const headTarget={x:face.x+finite(life?.head?.x,.25)*side*.25,y:face.y+.5+(finite(life?.head?.y,-19.4)+19.4)*.25};
  const h={x:mix(face.x,headTarget.x,headStrength),y:mix(face.y+.5,headTarget.y,headStrength)};
  head(ctx,h,headStrength*finite(life?.head?.tilt),look,id,side*(headStrength>.5&&finite(life?.gaze,1)<0?-1:1),.5);
  const hands={};
  for(const sign of [-1,1]){
    const key=sign===-1?'left':'right',shoulder={x:torso.x+sign*1.75,y:torso.y-1.1},steering=project(5,sign*2,11);
    const target=life?.[key+'Hand'],destination=target?{x:torso.x+finite(target.x)*side*.5,y:torso.y+(finite(target.y,-8.6)+11.2)*.5}:steering;
    const hand={x:mix(steering.x,destination.x,amount),y:mix(steering.y,destination.y,amount)},elbow={x:mix(shoulder.x,hand.x,.5),y:Math.max(shoulder.y,hand.y)+.5};
    line(ctx,[[shoulder.x,shoulder.y],[elbow.x,elbow.y]],look.shirt,1.1);line(ctx,[[elbow.x,elbow.y],[hand.x,hand.y]],'#e8c49a',.8);
    ellipse(ctx,hand.x,hand.y,.4,.35,'#e8c49a');hands[key]=hand;
  }
  if(amount>0)prop(ctx,{...life,strength:amount},hands,.55);
  ctx.restore();
}
