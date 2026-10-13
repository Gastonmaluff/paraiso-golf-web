// Approximate carry in 20 m map cells. Aim controls direction, power controls length.
export const CLUBS=Object.freeze({
  driver:{name:'Driver',range:12,spread:.065,run:.18},
  wood3:{name:'Madera 3',range:10.5,spread:.057,run:.15},
  wood5:{name:'Madera 5',range:9.5,spread:.052,run:.13},
  iron4:{name:'Hierro 4',range:8.5,spread:.049,run:.11},
  iron6:{name:'Hierro 6',range:7.5,spread:.046,run:.10},
  iron:{name:'Hierro 7',range:6.5,spread:.042,run:.09},
  iron9:{name:'Hierro 9',range:5.3,spread:.035,run:.065},
  wedge:{name:'Pitching wedge',range:4,spread:.027,run:.04},
  sandWedge:{name:'Sand wedge',range:3,spread:.024,run:.027},
  lobWedge:{name:'Lob wedge',range:2,spread:.025,run:.016},
  putter:{name:'Putter',range:1.2,spread:.012,run:0}
});
export const LEGACY_CLUBS=Object.freeze({driver:{range:10.5,spread:.065,run:.18},iron:{range:6.5,spread:.045,run:.10},wedge:{range:3.5,spread:.025,run:.035},putter:{range:1.2,spread:.012,run:0}});
export const SHOT_STYLES=Object.freeze({
  straight:{name:'Recto',carry:1,curve:0,apex:.8,hang:1,run:1,wind:1},
  draw:{name:'Draw · derecha a izquierda',carry:1,curve:-.075,apex:.76,hang:1,run:1.12,wind:1},
  fade:{name:'Fade · izquierda a derecha',carry:.97,curve:.075,apex:.86,hang:1.04,run:.8,wind:1.12},
  high:{name:'Alto · frena al picar',carry:.82,curve:0,apex:1.25,hang:1.35,run:.18,wind:1.65},
  low:{name:'Bajo · punch',carry:.91,curve:0,apex:.30,hang:.75,run:1.65,wind:.40}
});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function shotLie(type,putting){return type==='sand'?(putting?.25:.6):type==='tree'?.45:type==='grass'?.8:1}
export function carryLength({from,target,club,power,style='straight',terrain,height,legacy=false}){

  const spec=legacy?LEGACY_CLUBS[club]||CLUBS[club]:CLUBS[club],shape=SHOT_STYLES[style],d=Math.hypot(target.x-from.x,target.y-from.y);
  if(!spec||!shape||!Number.isFinite(power)||power<1||power>100||d<.03||club==='putter'&&style!=='straight')return null;
  const putting=club==='putter',lie=shotLie(terrain,putting),range=spec.range*lie*(putting?1:shape.carry),reach=range*power/100;
  const base=(legacy?Math.min(d,spec.range*lie):range)*power/100,direction={x:(target.x-from.x)/d,y:(target.y-from.y)/d};
  let length=base,rise=0;
  for(let i=0;i<2&&!putting;i++){rise=height(from.x+direction.x*length,from.y+direction.y*length)-height(from.x,from.y);length=Math.max(.005,base-rise*.12)}
  return {length,reach,putting,deltaHeight:rise,direction,aimDistance:d,lie,style,range};
}
export function flightPath({from,direction,length,style='straight',windAt=()=>({x:0,y:0}),size=64}){
  const shape=SHOT_STYLES[style],duration=(1.65+length*.13)*shape.hang,normal={x:-direction.y,y:direction.x},path=[];
  let wx=0,wy=0,vx=0,vy=0;const steps=32,dt=duration/steps;
  for(let i=0;i<=steps;i++){
    const t=i/steps;
    if(i){const wind=windAt((i-.5)*dt);const ax=wind.x*.025*shape.wind,ay=wind.y*.025*shape.wind;wx+=vx*dt+ax*dt*dt/2;wy+=vy*dt+ay*dt*dt/2;vx+=ax*dt;vy+=ay*dt}
    const bend=shape.curve*length*t*t;
    path.push({x:clamp(from.x+direction.x*length*t+normal.x*bend+wx,.1,size-1.1),y:clamp(from.y+direction.y*length*t+normal.y*bend+wy,.1,size-1.1),t:i*dt,lift:Math.sin(t*Math.PI)*shape.apex});
  }
  path.at(-1).lift=0;
  path[0]={x:from.x,y:from.y,t:0,lift:0};
  const a=path.at(-2),b=path.at(-1),d=Math.hypot(b.x-a.x,b.y-a.y);
  return {path,carry:{x:b.x,y:b.y},duration,direction:d>.00001?{x:(b.x-a.x)/d,y:(b.y-a.y)/d}:{...direction}};
}
export function sampleFlight(path,time){
  if(time<=0)return path[0];const i=path.findIndex(p=>p.t>=time);if(i<0)return path.at(-1);if(!i)return path[0];
  const a=path[i-1],b=path[i],t=(time-a.t)/(b.t-a.t);return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,lift:a.lift+(b.lift-a.lift)*t};
}
