// Original club handling in golfer sprite units (tileW/56). Pure render data.
// Routes and positions belong to the engine; these helpers never move an actor.
import {cartPose} from './animation.js?v=13';
export const CLUB_RETRIEVE_SECONDS=3;
export const CART_BAG=Object.freeze({along:-18.5,across:0,rimHeight:13,headHeight:19,clubLength:10.125});
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const clamp=v=>Math.max(0,Math.min(1,finite(v)));
const mix=(a,b,t)=>a+(b-a)*t;
const ease=t=>{t=clamp(t);return t*t*t*(10+t*(-15+6*t))};
const interval=(t,a,b)=>ease((t-a)/(b-a));
const lerp=(a,b,t)=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)});
const valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
function worldPoint(c,along,across){
  if(!valid(c))return null;
  const heading=finite(c.heading),cs=Math.cos(heading),sn=Math.sin(heading);
  return {x:c.x+(along*cs-across*sn)/56,y:c.y+(along*sn+across*cs)/56};
}
/** Ground location of the fixed bag; club heads point up, grips sit inside. */
export function cartBagAnchor(c){return worldPoint(c,CART_BAG.along,CART_BAG.across)}
/** A preferred dry route destination. The engine checks terrain and reachability. */
export function clubRetrievalPoint(c,{along=-25,across=0}={}){
  return worldPoint(c,finite(along,-25),finite(across));
}
function club(grip,angle,mode,grasp=0){
  const head={x:grip.x+Math.cos(angle)*CART_BAG.clubLength,y:grip.y+Math.sin(angle)*CART_BAG.clubLength};
  return {grip,head,angle,hand:'left',mode,grasp};
}
/** The left hand carries one club. The right hand remains free for everyday gestures. */
export function carryClubPose(g={},gait={}){
  if(g.carryClub!==true)return null;
  const y=-finite(gait.bob)+finite(gait.breathe),grip={x:-4.2+finite(gait.arm)*.55,y:-11.1+y};
  const angle=Math.acos(-1.4/CART_BAG.clubLength);
  return {type:'carryingClub',leftHand:{...grip},rightHand:null,club:club(grip,angle,'carry')};
}
/**
 * g.poseTime is elapsed simulation time, g.actionDuration defaults to three seconds.
 * The first .18 reaches the shaft, .18-.62 pulls straight up until the grip clears
 * the rim, then the free club rotates and slides into the carry grip. Coordinates
 * are absolute in the actor's local frame after the caller applies facing.
 */
export function clubRetrievalPose(g,c,{facing=1,elevationDelta=0}={}){
  if(g?.phase!=='retrievingClub'||!valid(g)||!valid(c))return null;
  const configured=finite(g.actionDuration,CLUB_RETRIEVE_SECONDS),duration=configured>0?configured:CLUB_RETRIEVE_SECONDS;
  const progress=clamp(finite(g.poseTime)/duration),side=facing<0?-1:1;
  const project=cartPose(finite(c.heading)).point;
  const offset={x:((c.x-g.x)-(c.y-g.y))*28*side,y:((c.x-g.x)+(c.y-g.y))*14-finite(elevationDelta)*56/18};
  const initial=project(CART_BAG.along,CART_BAG.across,CART_BAG.headHeight-CART_BAG.clubLength);
  const stored={x:offset.x+initial.x*side,y:offset.y+initial.y};
  const lift=interval(progress,.18,.62)*5.9;
  const extractedGrip={x:stored.x,y:stored.y-lift};
  const extractedGrab={x:extractedGrip.x,y:extractedGrip.y-CART_BAG.clubLength*.72};
  const carry=carryClubPose({carryClub:true}),free=interval(progress,.62,1),hand=lerp(extractedGrab,carry.leftHand,free);
  const grasp=.72*(1-interval(progress,.64,.84));
  const angle=-Math.PI/2+(carry.club.angle-Math.PI*2+Math.PI/2)*interval(progress,.65,1);
  const grip={x:hand.x-Math.cos(angle)*CART_BAG.clubLength*grasp,y:hand.y-Math.sin(angle)*CART_BAG.clubLength*grasp};
  const held=club(progress<=.62?extractedGrip:grip,angle,'retrieve',progress<=.62?.72:grasp);
  if(progress<=.62)held.clipBelowY=stored.y-(CART_BAG.rimHeight-(CART_BAG.headHeight-CART_BAG.clubLength));
  const rest={x:-4.2,y:-8.6},leftHand=progress<.18?lerp(rest,extractedGrab,interval(progress,0,.18)):hand;
  return {type:'retrievingClub',progress,leftHand,rightHand:null,club:held,suppressLife:true,cleared:progress>=.62};
}
