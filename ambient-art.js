import {weatherHash} from './weather.js?v=13';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const random=(seed,k)=>weatherHash((seed>>>0)^Math.imul(k+1,2654435761))/4294967296;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};
const homesCache=new WeakMap();
const windValue=w=>({x:Number.isFinite(w?.x)?w.x:0,y:Number.isFinite(w?.y)?w.y:0,speed:clamp(Number.isFinite(w?.speed)?w.speed:0,0,12),gust:Number.isFinite(w?.gust)?w.gust:0});
const projectedWind=w=>{w=windValue(w);return {x:(w.x-w.y)/2,y:(w.x+w.y)/4,speed:w.speed,gust:w.gust}};

// Offsets are original sprite units; callers apply unit=tileW/56. Apply plant
// sway to foliage/plumes only, keeping the trunk or stem attached to the ground.
export function plantSway(clock,wind,seed=0,height=24){
  if(!Number.isFinite(clock))clock=0;
  const w=projectedWind(wind),strength=clamp(w.speed/6,0,1),phase=random(seed,13)*Math.PI*2,wave=Math.sin(clock*1.55+phase)*.25+Math.sin(clock*.71+phase*.7)*.12;
  if(!w.x&&!w.y&&!w.speed)return {x:0,y:0,angle:0};
  const size=clamp(height,0,80)*.025;
  return {x:size*(w.x/6+wave*strength),y:size*(w.y/6+wave*strength*.35),angle:.018*strength*Math.sin(clock*1.8+phase)};
}
export function flagFlutter(clock,wind,seed=0){
  if(!Number.isFinite(clock))clock=0;
  const w=projectedWind(wind),phase=random(seed,27)*Math.PI*2,strength=clamp(w.speed/6,0,1),wave=Math.sin(clock*3.1+phase)+.35*Math.sin(clock*5.7+phase*.8);
  if(!w.x&&!w.y&&!w.speed)return {x:0,y:0,fold:0};
  return {x:w.x*.23+wave*.42*strength,y:w.y*.2+Math.sin(clock*2.6+phase)*.3*strength,fold:wave*.22*strength};
}

/** Overlay only. Supply a pre-clipped context+bounds OR polygonScreen to clip here. */
export function drawWindRipples(ctx,{bounds,polygonScreen,unit=1,clock=0,wind,seed=0}={}){
  if(!Number.isFinite(unit)||unit<=0||!Number.isFinite(clock))return;
  if(!bounds&&polygonScreen?.length){const xs=polygonScreen.map(p=>p.x),ys=polygonScreen.map(p=>p.y);bounds={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}}
  if(!bounds||![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)||bounds.width<=0||bounds.height<=0)return;
  const w=projectedWind(wind),length=Math.hypot(w.x,w.y),nx=length?-w.y/length:1,ny=length?w.x/length:0,count=clamp(Math.ceil(bounds.width/(20*unit)),3,20);
  ctx.save();
  if(polygonScreen?.length>=3){ctx.beginPath();ctx.moveTo(polygonScreen[0].x,polygonScreen[0].y);for(const p of polygonScreen.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.clip()}
  ctx.strokeStyle='#d4e7dc';ctx.lineWidth=.5*unit;ctx.globalAlpha*=.07+.09*clamp(w.speed/6,0,1);
  for(let i=0;i<count;i++){
    const phase=random(seed,i+31)*Math.PI*2,x=bounds.x+random(seed,i+101)*bounds.width+Math.sin(clock*.65+phase)*unit,y=bounds.y+random(seed,i+171)*bounds.height+Math.sin(clock*.49+phase)*unit*.6,span=(3+random(seed,i+251)*5)*unit,bend=Math.sin(clock*1.5+phase)*.7*unit;
    ctx.beginPath();ctx.moveTo(x-nx*span,y-ny*span);ctx.quadraticCurveTo(x-ny*bend,y+nx*bend,x+nx*span,y+ny*span);ctx.stroke();
  }
  ctx.restore();
}

function birdHomes(sim,seed){
  const tiles=sim.tiles;if(!Array.isArray(tiles)||!tiles.length)return [];
  const cached=homesCache.get(tiles);if(cached?.seed===seed)return cached.homes;
  const candidates=[],size=tiles.length;
  for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
    if(!['grass','fairway'].includes(tiles[y]?.[x]?.type)||x>=3&&x<=5&&y>=24&&y<=27)continue;
    if(sim.holes?.some(h=>Math.hypot(h.tee.x-x,h.tee.y-y)<2||Math.hypot(h.green.x-x,h.green.y-y)<2))continue;
    const near=[tiles[y-1]?.[x],tiles[y+1]?.[x],tiles[y]?.[x-1],tiles[y]?.[x+1]].some(t=>['water','tree'].includes(t?.type)),score=random(seed,y*size+x)-(near?.6:0);
    candidates.push({x,y,score});
  }
  candidates.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);
  const homes=[];for(const p of candidates){if(homes.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>7))homes.push({x:p.x,y:p.y});if(homes.length===5)break}
  homesCache.set(tiles,{seed,homes});return homes;
}

/** Deterministic wildlife poses, also exposed for depth sorting or inspection. */
export function ambientBirds(sim,clock,wind){
  if(!sim||!Number.isFinite(clock)||clock<0)return [];
  const seed=(sim.weather?.seed??271009)>>>0,homes=birdHomes(sim,seed),w=windValue(wind),size=sim.tiles.length;
  return homes.map((home,id)=>{
    if(!['grass','fairway'].includes(sim.tiles[home.y]?.[home.x]?.type))return null;
    const phase=random(seed,id+300)*Math.PI*2,period=110+random(seed,id+330)*60,time=(clock+random(seed,id+350)*period)%period,start=period*.52,duration=19+random(seed,id+370)*4,u=(time-start)/duration,flying=u>0&&u<1;
    const envelope=flying?Math.sin(u*Math.PI)**2:0,angle=flying?phase+u*Math.PI*2:phase,radius=2.1+random(seed,id+410)*1.2;
    const baseX=home.x+.17*Math.sin(clock*.14+phase),baseY=home.y+.14*Math.cos(clock*.12+phase);
    const x=clamp(baseX+envelope*(Math.cos(angle)*radius+w.x*.065),.5,size-1.5),y=clamp(baseY+envelope*(Math.sin(angle)*radius+w.y*.065),.5,size-1.5);
    const fly=flying?smooth((time-start)/.8)*smooth((start+duration-time)/1.2):0;
    const de=flying?Math.sin(u*Math.PI*2)*Math.PI/duration:0,da=flying?Math.PI*2/duration:0;
    const vx=.17*.14*Math.cos(clock*.14+phase)+de*(Math.cos(angle)*radius+w.x*.065)-envelope*Math.sin(angle)*radius*da,vy=-.14*.12*Math.sin(clock*.12+phase)+de*(Math.sin(angle)*radius+w.y*.065)+envelope*Math.cos(angle)*radius*da;
    return {id,x,y,height:envelope*(6+random(seed,id+430)*3),fly,flap:Math.sin(clock*11+phase)*fly,step:Math.sin(clock*4.1+phase)*(1-fly),facing:vx-vy<0?-1:1};
  }).filter(Boolean);
}
function drawTero(ctx,bird){
  const flying=bird.fly,headY=-3.5+flying*1.2;
  ctx.strokeStyle='#a37364';ctx.lineWidth=.32;ctx.lineCap='round';
  for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(side*.6,-.8);ctx.lineTo(side*.65+bird.step*.18,1.1*(1-flying));ctx.lineTo(side*.65+bird.step*.18+.45,1.1*(1-flying));ctx.stroke()}
  ctx.fillStyle='#899487';ctx.beginPath();ctx.ellipse(0,-1.5,2.05,.95,.1,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#edf0df';ctx.beginPath();ctx.ellipse(.75,-1.55,1.05,.83,-.25,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#303f39';ctx.lineWidth=.8;
  if(flying>.02){for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(side*.55,-1.7);ctx.lineTo(side*2.5,-2.5+bird.flap*1.8);ctx.lineTo(side*(2.1+flying*2.8),-2.1+bird.flap*2.3);ctx.stroke()}}
  else{ctx.beginPath();ctx.moveTo(-1.5,-1.8);ctx.lineTo(.4,-1.6);ctx.stroke()}
  ctx.fillStyle='#253a32';ctx.beginPath();ctx.ellipse(1.12,headY,.66,.72,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#f0f0df';ctx.lineWidth=.25;ctx.beginPath();ctx.moveTo(.82,headY-.18);ctx.lineTo(1.52,headY-.15);ctx.stroke();
  ctx.strokeStyle='#253a32';ctx.lineWidth=.22;ctx.beginPath();ctx.moveTo(.84,headY-.55);ctx.lineTo(.68,headY-1.1);ctx.moveTo(1.65,headY+.06);ctx.lineTo(2.25,headY+.18);ctx.stroke();
  ctx.fillStyle='#ca7d65';ctx.beginPath();ctx.arc(1.47,headY-.03,.1,0,Math.PI*2);ctx.fill();
}
/** project(x,y,z) receives EXTRA metres above the terrain; never add terrain height here. */
export function drawAmbient(ctx,{sim,project,unit=1,clock=0,wind,birds:poses}={}){
  if(typeof project!=='function'||!Number.isFinite(unit)||unit<=0)return;
  const birds=(Array.isArray(poses)?poses:ambientBirds(sim,clock,wind)).filter(b=>b&&[b.x,b.y,b.height].every(Number.isFinite)).map(b=>({...b,p:project(b.x,b.y,b.height)})).sort((a,b)=>a.p.y-b.p.y);
  for(const bird of birds){
    if(!Number.isFinite(bird.p?.x)||!Number.isFinite(bird.p?.y))continue;
    const ground=project(bird.x,bird.y,0);
    ctx.save();ctx.fillStyle='#344c3c';ctx.globalAlpha*=.15*(1-bird.fly*.5);ctx.beginPath();ctx.ellipse(ground.x,ground.y,2.2*unit,.7*unit,0,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.save();ctx.translate(bird.p.x,bird.p.y);ctx.scale(unit*bird.facing,unit);drawTero(ctx,bird);ctx.restore();
  }
}
