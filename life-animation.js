// Small everyday gestures, entirely driven by the simulation clock. They do
// not change routes, speed, heading, turns or the golfer's saved state.
export const LIFE_LABELS=Object.freeze({
  talk:'Conversando',watch:'Mirando el reloj',phone:'Revisando el celular',
  point:'Señalando el bosque',smoke:'Fumando',terere:'Tomando tereré',
  look:'Mirando el recorrido'
});
const FOOT_PHASES=new Set(['walking','returningCart','waiting','afterShot']);
const FOOT_ACTIONS=['talk','watch','point','phone','talk','smoke','watch','point'];
const PARKED_ACTIONS=['terere','talk','watch','terere','phone','terere'];
const HEAD={x:.25,y:-19.4,tilt:0};
const clamp=v=>Math.max(0,Math.min(1,v));
const ease=v=>{v=clamp(v);return v*v*v*(10+v*(-15+6*v))};
const hash=value=>{let n=value>>>0;n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return (n^(n>>>16))>>>0};
const mix=(a,b,t)=>a+(b-a)*t;
function conversation(g,partner){
  if(!partner||partner.id===g.id)return false;
  return true;
}
function partnerDirection(g,partner){
  return Number.isFinite(partner?.x)?Math.sign(partner.x)||1:1;
}

/**
 * Targets use original golfer sprite units (tileW/56), not screen pixels.
 * The renderer blends each target with the current gait by strength. A null
 * hand keeps that arm's natural walk. Props fade by prop.opacity.
 * The caller filters nearby partners and passes their relative projected
 * position in these same local units, after applying the golfer's facing.
 */
export function lifePose(g,clock,{busy=false,inCart=false,parked=false,partner,seed=0}={}){
  if(!g||!Number.isSafeInteger(g.id)||g.id<1||!Number.isFinite(clock)||clock<0||busy||g.shot||['preparing','swinging'].includes(partner?.phase))return null;
  if(!FOOT_PHASES.has(g.phase)&&!(g.phase==='riding'&&inCart)&&!(g.phase==='boarding'&&inCart&&parked))return null;
  const identity=hash(Math.imul(g.id,2654435761)^(seed>>>0)),period=58+identity%29,shift=(hash(identity+17)%10000)/10000*period;
  const time=clock+shift,cycle=Math.floor(time/period),local=time-cycle*period,choice=hash(identity+Math.imul(cycle+1,2246822519));
  const duration=5.5+(choice%4000)/1000,start=7+(hash(choice+37)%10000)/10000*(period-duration-20),elapsed=local-start;
  if(elapsed<=0||elapsed>=duration)return null;
  const strength=ease(elapsed/.95)*ease((duration-elapsed)/1.2),progress=elapsed/duration,canTalk=conversation(g,partner);
  let type;
  if(inCart&&!parked)type=canTalk?'talk':'look';
  else{const actions=inCart?PARKED_ACTIONS:FOOT_ACTIONS;type=actions[choice%actions.length];if(type==='talk'&&!canTalk)type='watch'}
  const pose={type,label:LIFE_LABELS[type],strength,head:{...HEAD},gaze:type==='talk'?partnerDirection(g,partner):1,rightHand:null,leftHand:null,prop:null,attention:type==='point'?'forest':type==='talk'?'partner':'self',partnerId:type==='talk'&&Number.isSafeInteger(partner.id)?partner.id:null,inCart:Boolean(inCart),parked:Boolean(inCart&&parked),progress};
  const breathe=Math.sin(elapsed*1.6+g.id)*.12;
  if(inCart&&!parked){
    // A driver keeps both hands in the driving pose; only their glance changes.
    const direction=canTalk?partnerDirection(g,partner):1;
    pose.head.x+=direction*.65;pose.head.tilt=direction*.06;
    return pose;
  }
  if(type==='talk'){
    const direction=partnerDirection(g,partner),gesture=.5+.5*Math.sin(elapsed*1.3);
    pose.head.x+=direction*.65;pose.head.tilt=direction*.05;
    pose.rightHand={x:5.2+gesture*1.6,y:-11.7-gesture*.8};
  }else if(type==='watch'){
    pose.head.y+=.25;pose.head.tilt=.13;
    pose.leftHand={x:1.6,y:-12.7};pose.rightHand={x:2.4,y:-13.3+breathe};
    pose.prop={type:'watch',hand:'left'};
  }else if(type==='phone'){
    const tap=ease((progress-.25)/.15)*ease((.65-progress)/.15);
    pose.head.y+=.2;pose.head.tilt=.1;
    pose.rightHand={x:2.7,y:-17.2+breathe};pose.leftHand={x:mix(-1.5,.8,tap),y:mix(-12.8,-16,tap)};
    pose.prop={type:'phone',hand:'right'};
  }else if(type==='point'){
    pose.head.x+=.75;pose.head.tilt=-.05;
    pose.rightHand={x:8.8,y:-15.1+breathe};
  }else if(type==='smoke'){
    const puff=ease((progress-.16)/.16)*ease((.64-progress)/.16);
    pose.head.tilt=-.04;
    pose.rightHand={x:mix(4.8,2.8,puff),y:mix(-12.3,-18,puff)};
    pose.prop={type:'cigarette',hand:'right',puff};
  }else if(type==='terere'){
    const sip=ease((progress-.22)/.18)*ease((.72-progress)/.18);
    pose.head.tilt=.05*sip;
    pose.rightHand={x:mix(3.2,2.5,sip),y:mix(-13.5,-18,sip)};
    pose.leftHand={x:-3.4,y:-10.6};
    pose.prop={type:'terere',hand:'right',secondary:'thermos',sip};
  }
  if(pose.prop)pose.prop.opacity=strength;
  return pose;
}
