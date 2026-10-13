import { GolfSim, N, COSTS, PACE, CLUBS, SHOT_STYLES } from './engine.js?v=16';
import {installCartView} from './cart-view.js?v=16';
import { swingPose, rollProgress, walkingPose, contactPoint, BALL_RADIUS, cartPose } from './animation.js?v=13';
import {HEIGHT_SCALE,sampleRoll,unprojectHeight} from './terrain.js?v=13';
import {roadNeighbors} from './roads.js?v=13';
import {teeDetails,drawTeeDetail} from './tee-art.js?v=13';
import {PARANA_ID} from './parana-course.js?v=13';
import {drawCoursePlan} from './course-plan.js?v=13';
import {lifePose} from './life-animation.js?v=13';
import {defaultAppearance,drawGolfer,drawCartRider,drawCartBag} from './golfer-art.js?v=13';
import {installGameUI} from './game-ui.js?v=14';
import {MapRasterCache} from './map-cache.js?v=15';
import {treeGeometry} from './tree-geometry.js?v=15';
import {clubRetrievalPose,cartBagAnchor} from './club-animation.js?v=13';
import {sampleFlight} from './shot-physics.js?v=13';
import {ambientBirds,drawAmbient,drawWindRipples,plantSway,flagFlutter} from './ambient-art.js?v=13';

const $ = id => document.getElementById(id);
const sim = new GolfSim({preset:PARANA_ID});
sim.tidyCartPaths();
const shotStyle=()=>$('shotStyle').value;
$('shotClub').innerHTML=Object.entries(CLUBS).map(([id,c])=>`<option value="${id}">${c.name} · ${Math.round(c.range*20)} m</option>`).join('');
const STORAGE = 'paraiso-golf-v1';
let storageOK = true;
try { const saved = localStorage.getItem(STORAGE); if (saved) { const version=JSON.parse(saved).version;if(version<5)localStorage.setItem(STORAGE+'-before-relief',saved);if(version<6)localStorage.setItem(STORAGE+'-before-course',saved);if(version<7)localStorage.setItem(STORAGE+'-before-field11',saved);if(version<8)localStorage.setItem(STORAGE+'-before-shot13',saved);if(version<9)localStorage.setItem(STORAGE+'-before-carts16',saved);if(!sim.load(saved))storageOK=false; } } catch { storageOK = false; }
const canvas = $('course');let ctx = canvas.getContext('2d');
const camera = {zoom:1.35, dx:0, dy:0};
const MAX_ZOOM=40;
let gameUI=null,cartView=null;
const appearanceOf=g=>gameUI?.appearance(g)||defaultAppearance(g);
let width = 800, height = 600, tileW = 30, tileH = 15, ox = 400, oy = 80;
let tool = 'inspect', brush = 1, hover = null, selectedHole = sim.holes[0]?.id ?? null, pendingTee = null;
let drag = null, undoStack = [], painted = new Set(), lastUI = 0, lastDraw = 0, autoSave = 0, toastTimer, now = 0, cameraDirty = true;
let aimTarget=null,aimKey='',lastPlayerHole=null;
const player=()=>sim.golfers.find(g=>g.id===sim.playerRound?.golferId);
const readyToAim=()=>sim.playerRound?.status==='playing'&&player()?.phase==='aiming';
const colors = { grass:['#659c40'],fairway:['#8fbe44'],green:['#b1d15b'],sand:['#efe3b4'],water:['#377b9c'],path:['#b59e75'],tee:['#9cc84f'],tree:['#659c40'] };
// All physical objects use the same projected map scale, even on a small screen.
// The golfer is ~0.41 tile widths tall; the clubhouse is ~5 times that height.
const WORLD_ART = Object.freeze({golferUnit:1/56,treeUnit:1/32,clubhouseUnit:1/32,flagUnit:1/56,ballRadius:BALL_RADIUS});
const artScale = () => ({golfer:tileW*WORLD_ART.golferUnit,tree:tileW*WORLD_ART.treeUnit,clubhouse:tileW*WORLD_ART.clubhouseUnit,flag:tileW*WORLD_ART.flagUnit,ball:tileW*WORLD_ART.ballRadius});
const names = {grass:'Césped',fairway:'Fairway',green:'Green',sand:'Arena',water:'Agua',tree:'Árbol',path:'Camino',tee:'Salida',raise:'Elevar terreno',lower:'Bajar terreno'};
const money = n => '$' + Math.round(n||0).toLocaleString('es-PY');
const hash = (x,y,k=0) => { const n = Math.sin(x*127.1+y*311.7+k*43.8)*43758.5453; return n-Math.floor(n); };
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso = (x,y) => ({x:ox+(x-y)*tileW/2,y:oy+(x+y)*tileH/2-sim.heightAt(x,y)*tileW*HEIGHT_SCALE});
const mapPoint = (x,y) => unprojectHeight((x-ox)/(tileW/2),(y-oy)/(tileH/2),(a,b)=>sim.heightAt(a,b));
const uniso = (x,y) => {const p=mapPoint(x,y);return {x:Math.round(p.x),y:Math.round(p.y)}};
function toast(message) { $('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200); }
function geometry() { const fit=Math.min((width-24)/N,(height-24)/(N*.5));tileW=fit*camera.zoom;tileH=tileW/2;ox=width/2+camera.dx;oy=(height-(N-1)*tileH)/2+camera.dy;cameraDirty=true; }
function resize() { const r=$('viewport').getBoundingClientRect();width=r.width;height=r.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);geometry(); }
new ResizeObserver(resize).observe($('viewport'));
function poly(points,fill,stroke=null,line=1){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.lineWidth=line;ctx.strokeStyle=stroke;ctx.stroke()}}
function diamond(x,y,fill,stroke=null){poly([iso(x-.5,y-.5),iso(x+.5,y-.5),iso(x+.5,y+.5),iso(x-.5,y+.5)],fill,stroke);}
function rect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x,y,w,h);}
function textAt(txt,x,y,size=10,color='#33512e',align='center'){ctx.font=`${size}px Arial`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(txt,x,y)}
function rounded(x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill()}
let terrainCache = null;
const mapRaster=new MapRasterCache();
let contourPaths=null,contourScale=0,contourRevision=null,sceneCache=null,frameWind=null;
function contours(type){
  const edges=[], starts=new Map();
  const matches=(x,y)=>sim.tile(x,y)?.type===type;
  const edge=(a,b)=>{const i=edges.length;edges.push({a,b,used:false});const k=a.x+','+a.y;if(!starts.has(k))starts.set(k,[]);starts.get(k).push(i)};
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(matches(x,y)){
    const tl={x:x-.5,y:y-.5},tr={x:x+.5,y:y-.5},br={x:x+.5,y:y+.5},bl={x:x-.5,y:y+.5};
    if(!matches(x,y-1))edge(tl,tr);if(!matches(x+1,y))edge(tr,br);if(!matches(x,y+1))edge(br,bl);if(!matches(x-1,y))edge(bl,tl);
  }
  const loops=[];
  for(const e of edges)if(!e.used){const points=[];let current=e;for(let n=0;n<edges.length+1;n++){if(current.used)break;current.used=true;points.push(current.a);const candidates=starts.get(current.b.x+','+current.b.y)||[];const next=candidates.find(i=>!edges[i].used);if(next==null)break;current=edges[next]}if(points.length>2)loops.push(points)}
  return loops;
}
function ensureTerrain(){
  if(terrainCache)return;
  terrainCache={waterTiles:[]};
  for(const type of ['water','sand','fairway','green','tee'])terrainCache[type]=contours(type);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(sim.tile(x,y)?.type==='water')terrainCache.waterTiles.push({x,y});
}
function terrainPaths(){
  ensureTerrain();
  if(contourRevision===terrainCache&&contourScale===tileW)return contourPaths;
  contourPaths={};
  for(const type of ['water','sand','fairway','green','tee']){
    const path=new Path2D();
    for(const points of terrainCache[type]){
      const p=points.map(q=>{const v=iso(q.x,q.y);return {x:v.x-ox,y:v.y-oy}});
      const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
      let m=mid(p.at(-1),p[0]);path.moveTo(m.x,m.y);
      for(let i=0;i<p.length;i++){m=mid(p[i],p[(i+1)%p.length]);path.quadraticCurveTo(p[i].x,p[i].y,m.x,m.y)}
      path.closePath();
    }
    contourPaths[type]=path;
  }
  contourRevision=terrainCache;contourScale=tileW;return contourPaths;
}
function terrainRange(bounds){
  // Ground heights lie in 0..12 m. Include the whole elevated footprint plus
  // texture/road shoulders before converting the screen rectangle to map cells.
  const left=bounds.x-tileW,right=bounds.x+bounds.width+tileW;
  const top=bounds.y-tileH,bottom=bounds.y+bounds.height+tileH+12*tileW*HEIGHT_SCALE;
  const corners=[[left,top],[right,top],[left,bottom],[right,bottom]];
  const xs=corners.map(([x,y])=>x/tileW+2*y/tileW),ys=corners.map(([x,y])=>2*y/tileW-x/tileW);
  return {x0:Math.max(0,Math.floor(Math.min(...xs))-1),x1:Math.min(N-1,Math.ceil(Math.max(...xs))+1),y0:Math.max(0,Math.floor(Math.min(...ys))-1),y1:Math.min(N-1,Math.ceil(Math.max(...ys))+1)};
}
function renderTerrain(bounds){
  ensureTerrain();const paths=terrainPaths(),range=terrainRange(bounds);
  const {x0,x1,y0,y1}=range;
  const points=[iso(-.5,-.5),iso(N-.5,-.5),iso(N-.5,N-.5),iso(-.5,N-.5)];
  ctx.save();ctx.shadowColor='#203f3336';ctx.shadowBlur=22;ctx.shadowOffsetY=16;poly(points,'#659c40');ctx.restore();
  const down=points.map(p=>({x:p.x,y:p.y+12*camera.zoom}));poly([points[1],points[2],down[2],down[1]],'#4e673b');poly([points[2],points[3],down[3],down[2]],'#6b8148');
  ctx.save();poly(points,null);ctx.clip();
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)diamond(x,y,'#659c40');
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const patch=hash(Math.floor(x/2),Math.floor(y/2),4);
    for(let k=0;k<22;k++){const q=iso(x+hash(x,y,k)-.5,y+hash(y,x,k+8)-.5);rect(q.x,q.y,tileW*.024,tileW*.013,k%3?'#96ba5960':patch>.5?'#3f743c70':'#b4cc6b60')}
    if(sim.tile(x,y)?.type==='tree'){
      const p=iso(x,y);ctx.fillStyle='#66794e70';ctx.beginPath();ctx.ellipse(p.x,p.y,tileW*.32,tileH*.28,0,0,Math.PI*2);ctx.fill();
    }
  }ctx.restore();
  for(const type of ['water','sand','fairway','green','tee']){
    const path=paths[type];ctx.fillStyle=colors[type][0];ctx.fill(path,'evenodd');ctx.strokeStyle=type==='water'?'#c6d3ad':type==='fairway'||type==='green'?'#547d32':'#8b885345';ctx.lineWidth=tileW*(type==='water'?.045:.025);ctx.stroke(path);
    ctx.save();ctx.clip(path,'evenodd');
    if(type==='fairway'){
      ctx.strokeStyle='#c5dd7145';ctx.lineWidth=tileW*.38;for(let i=-N;i<N*2;i+=.85){const a=iso(i,-N),b=iso(i,N*2);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(sim.tile(x,y)?.type==='fairway'){for(let k=0;k<6;k++){const q=iso(x+hash(x,y,k)-.5,y+hash(y,x,k+8)-.5);rect(q.x,q.y,tileW*.018,tileW*.009,'#d1e89550')}}
    }else if(type==='green'||type==='tee'){
      ctx.strokeStyle='#d8e99840';ctx.lineWidth=tileW*.1;for(let i=-N;i<N*2;i+=.4){const a=iso(-N,i),b=iso(N*2,i);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
    }else if(type==='water'){
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(sim.tile(x,y)?.type==='water'){const p=iso(x,y);for(let k=0;k<7;k++)rect(p.x+(hash(x,y,k)-.5)*tileW,p.y+(hash(y,x,k+11)-.5)*tileH,1,1,'#93c2c355');}
    }else if(type==='sand'){
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(sim.tile(x,y)?.type==='sand'){const p=iso(x,y);for(let k=0;k<12;k++)rect(p.x+(hash(x,y,k)-.5)*tileW*.85,p.y+(hash(y,x,k+6)-.5)*tileH*.8,tileW*.022,tileW*.012,'#bca87560')}
      ctx.strokeStyle='#b7a57690';ctx.lineWidth=tileW*.085;ctx.stroke(path);
    }
    ctx.restore();
  }
  // Links match the cart graph, including continuous diagonals.
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  for(const [color,w]of [['#82906b',.22],['#aaa889',.18]]){
    ctx.strokeStyle=color;ctx.lineWidth=tileW*w;ctx.beginPath();
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(sim.tile(x,y).type==='path'){
      const p=iso(x,y);ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.01,p.y);
      for(const neighbor of roadNeighbors(sim.tiles,x,y))if(neighbor.y*N+neighbor.x>y*N+x){const q=iso(neighbor.x,neighbor.y);ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y)}
    }ctx.stroke();
  }ctx.restore();
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(sim.tile(x,y).type!=='water'){
    const slope=sim.slopeAt(x,y),light=Math.max(-.18,Math.min(.18,(slope.x+slope.y)*.20));
    diamond(x,y,light<0?'rgba(30,57,30,'+-light+')':'rgba(255,246,179,'+light+')');
    const level=Math.floor(sim.heightAt(x,y)/1.5);
    if(sim.tile(x,y).type==='grass'&&(level!==Math.floor(sim.heightAt(x+1,y)/1.5)||level!==Math.floor(sim.heightAt(x,y+1)/1.5))){const a=iso(x-.3,y),b=iso(x+.3,y);ctx.strokeStyle='#355c2b18';ctx.lineWidth=tileW*.018;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
  }
}
function terrain(){
  ensureTerrain();terrainPaths();
  const main=ctx,originX=ox,originY=oy;
  mapRaster.draw({ctx,width,height,dpr:Math.min(devicePixelRatio||1,2),originX,originY,scaleKey:tileW+':'+camera.zoom,revision:terrainCache,render:(tileCtx,bounds)=>{
    ctx=tileCtx;ox=0;oy=0;
    try{renderTerrain(bounds)}finally{ctx=main;ox=originX;oy=originY}
  }});
  // Water remains live above the retained ground, clipped to its world path.
  ctx.save();ctx.translate(ox,oy);ctx.clip(contourPaths.water,'evenodd');ctx.translate(-ox,-oy);ctx.strokeStyle='#b2dbd766';ctx.lineWidth=tileW*.02;
  for(const {x,y}of terrainCache.waterTiles){
    const p=iso(x,y);if(p.x+tileW*.3<0||p.x-tileW*.3>width||p.y+tileW*.1<0||p.y-tileW*.1>height)continue;
    const phase=Math.sin(now*.6+x*.5+y)*tileW*.06;ctx.beginPath();ctx.moveTo(p.x-tileW*.2+phase,p.y);ctx.lineTo(p.x+tileW*.18+phase,p.y);ctx.stroke();
  }
  drawWindRipples(ctx,{bounds:{x:0,y:0,width,height},unit:artScale().golfer,clock:now,wind:frameWind,seed:sim.weather.seed});ctx.restore();
}
function staticScene(){
  const key=sim.holes.map(h=>[h.id,h.tee.x,h.tee.y,h.green.x,h.green.y].join(',')).join(';');
  if(sceneCache?.revision===terrainCache&&sceneCache.key===key)return sceneCache;
  const trees=[],details=[];
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(sim.tile(x,y)?.type==='tree')trees.push({x,y,px:(x-y)/2,py:(x+y)/4-sim.heightAt(x,y)*HEIGHT_SCALE});
  sim.holes.forEach((h,i)=>details.push(...teeDetails(h,{number:i+1,canPlace:(x,y)=>['grass','fairway'].includes(sim.tile(x,y)?.type)})));
  sceneCache={revision:terrainCache,key,trees,details};return sceneCache;
}
const crownPaths=new WeakMap();
function treePaths(shape){
  let paths=crownPaths.get(shape);if(paths)return paths;
  paths=[];
  for(let k=0;k<22;k++){
    const path=new Path2D(),start=k*18;
    path.moveTo(shape.crowns[start],shape.crowns[start+1]);
    for(let j=1;j<9;j++)path.lineTo(shape.crowns[start+j*2],shape.crowns[start+j*2+1]);
    path.closePath();paths.push(path);
  }
  crownPaths.set(shape,paths);return paths;
}
function drawTree(x,y,anchor=null){
  const p=anchor||iso(x,y),s=artScale().tree,shape=treeGeometry(x,y),{r,h}=shape;
  const sway=plantSway(now,frameWind,sim.weather.seed+x*137+y*271,h);
  ctx.fillStyle='#23472c64';ctx.beginPath();ctx.ellipse(p.x+s*8,p.y+4*s,16*s,4.5*s,.35,0,Math.PI*2);ctx.fill();
  for(let j=0;j<3;j++){const q=iso(x+shape.ground[j*2],y+shape.ground[j*2+1]);ctx.fillStyle=j===1?'#95ad4f':'#446d3b';ctx.beginPath();ctx.ellipse(q.x,q.y-2*s,3*s,2*s,0,0,Math.PI*2);ctx.fill()}
  if(r<.43){
    ctx.lineWidth=4*s;ctx.strokeStyle='#937842';ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.quadraticCurveTo(p.x-4*s,p.y-h*.6*s,p.x+(2+sway.x)*s,p.y+(-h+sway.y)*s);ctx.stroke();
    for(let i=1;i<7;i++){ctx.strokeStyle='#c0a464';ctx.lineWidth=.8*s;ctx.beginPath();ctx.moveTo(p.x-2*s,p.y-i*h*s/7);ctx.lineTo(p.x+1*s,p.y-i*h*s/7+1*s);ctx.stroke()}
    const top={x:p.x+(2+sway.x)*s,y:p.y+(-h+sway.y)*s};
    for(let j=0;j<7;j++){
      const dx=shape.palm[j*2]*s,dy=shape.palm[j*2+1]*s;
      ctx.strokeStyle=j<3?'#9abe40':'#4c8832';ctx.lineWidth=3.8*s;ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.quadraticCurveTo(top.x+dx*.55,top.y+dy-6*s,top.x+dx,top.y+dy+5*s);ctx.stroke();
      ctx.strokeStyle='#b9cf5a';ctx.lineWidth=.65*s;ctx.beginPath();ctx.moveTo(top.x,top.y);ctx.quadraticCurveTo(top.x+dx*.55,top.y+dy-6*s,top.x+dx,top.y+dy+5*s);ctx.stroke();
    }
    rect(top.x,top.y,2*s,3*s,'#756138');
  }else if(r<.68){
    rect(p.x-1*s,p.y-15*s,3*s,15*s,'#7b6944');
    ctx.save();ctx.translate(sway.x*s,sway.y*s);
    for(let level=0;level<5;level++){
      const cy=p.y-h*s+level*5.3*s,w=(4+level*2.7)*s;
      poly([{x:p.x,y:cy-9*s},{x:p.x+w,y:cy+5*s},{x:p.x,y:cy+2*s},{x:p.x-w,y:cy+5*s}],'#2d6537');
      poly([{x:p.x-1*s,y:cy-7*s},{x:p.x,y:cy+2*s},{x:p.x-w,y:cy+5*s}],'#4c8b42');
      for(let k=0;k<3;k++){const at=(level*3+k)*2;rect(p.x+shape.pine[at]*s,cy+shape.pine[at+1]*s,2*s,1*s,'#68974a')}
    }ctx.restore();
  }else{
    rect(p.x-2*s,p.y-16*s,4*s,16*s,'#7f6b43');
    ctx.save();ctx.translate(p.x+sway.x*s,p.y+sway.y*s);ctx.scale(s,s);
    const paths=treePaths(shape);
    for(let k=0;k<22;k++){ctx.fillStyle=shape.crownColors[k];ctx.fill(paths[k])}
    for(let k=0;k<34;k++)rect(shape.speckles[k*2],shape.speckles[k*2+1],1.5,1,r>.87?(k%3?'#efc9dc':'#82576f'):(k%3?'#a8bc68':'#2f643366'));
    ctx.restore();
  }
}
function clubhouse(){
  const p=iso(4,26),s=artScale().clubhouse;
  ctx.fillStyle='#33573733';ctx.beginPath();ctx.ellipse(p.x+12*s,p.y+7*s,47*s,15*s,0,0,Math.PI*2);ctx.fill();
  const A={x:p.x-40*s,y:p.y-7*s},B={x:p.x+8*s,y:p.y+17*s},C={x:p.x+39*s,y:p.y+1*s},D={x:p.x-9*s,y:p.y-23*s};
  poly([A,B,{x:B.x,y:B.y-25*s},{x:A.x,y:A.y-25*s}],'#f0e9cd');poly([B,C,{x:C.x,y:C.y-25*s},{x:B.x,y:B.y-25*s}],'#cbcdb7');
  const up=q=>({x:q.x,y:q.y-25*s});poly([up(A),up(B),up(C),up(D)],'#a36047');
  poly([up(A),{x:p.x-13*s,y:p.y-51*s},{x:p.x+34*s,y:p.y-27*s},up(B)],'#b67850');poly([{x:p.x+34*s,y:p.y-27*s},up(B),up(C),{x:p.x+20*s,y:p.y-35*s}],'#89583e');
  for(let i=0;i<3;i++){const wx=p.x-30*s+i*13*s,wy=p.y-15*s+i*6.5*s;poly([{x:wx,y:wy},{x:wx+8*s,y:wy+4*s},{x:wx+8*s,y:wy-5*s},{x:wx,y:wy-9*s}],'#5f7b69');rect(wx+3*s,wy-7*s,1*s,8*s,'#ddd6b9')}
  poly([{x:p.x+15*s,y:p.y+7*s},{x:p.x+25*s,y:p.y+2*s},{x:p.x+25*s,y:p.y-14*s},{x:p.x+15*s,y:p.y-9*s}],'#4f6a55');
  poly([{x:p.x-39*s,y:p.y-10*s},{x:p.x+9*s,y:p.y+14*s},{x:p.x+13*s,y:p.y+9*s},{x:p.x-35*s,y:p.y-15*s}],'#647f53');
  rect(p.x-31*s,p.y-33*s,5*s,15*s,'#e6dfc5');
  // Original roof courses, terrace rail and planters, at the clubhouse scale.
  ctx.strokeStyle='#754a3540';ctx.lineWidth=.65*s;
  for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(p.x+(-34+i*4)*s,p.y+(-34-i*2)*s);ctx.lineTo(p.x+(10+i*4)*s,p.y+(-12-i*3)*s);ctx.stroke()}
  ctx.strokeStyle='#ede7c9';ctx.lineWidth=1*s;ctx.beginPath();ctx.moveTo(p.x-36*s,p.y-11*s);ctx.lineTo(p.x+7*s,p.y+11*s);ctx.stroke();
  for(let i=0;i<7;i++)rect(p.x+(-35+i*6)*s,p.y+(-11+i*3)*s,.8*s,6*s,'#dedcc1');
  for(const i of [-1,1]){const px=p.x+i*33*s,py=p.y+i*8*s;ctx.fillStyle='#325d3c';ctx.beginPath();ctx.ellipse(px,py,5*s,2.5*s,.2,0,Math.PI*2);ctx.fill();rect(px-2*s,py-2*s,1.5*s,1.5*s,'#c694ad');rect(px+1*s,py-1*s,1.5*s,1.5*s,'#efd89a')}
  ctx.save();const label=iso(4,29);rounded(label.x-35,label.y+10,70,17,3,'#f9f4dfde');textAt('CLUB HOUSE',label.x,label.y+21,7,'#5e704e');ctx.restore();
}
function flag(hole){
  const p=iso(hole.green.x,hole.green.y),s=artScale().flag;
  ctx.fillStyle='#456331';ctx.beginPath();ctx.ellipse(p.x,p.y,2*s,1*s,0,0,Math.PI*2);ctx.fill();rect(p.x,p.y-29*s,1.4*s,29*s,'#f7f2d8');
  const wind=frameWind,flutter=flagFlutter(now,wind,sim.weather.seed+hole.id),side=wind.x-wind.y<0?-1:1;
  poly([{x:p.x+side*s,y:p.y-29*s},{x:p.x+(side*7+flutter.fold)*s,y:p.y+(-28+flutter.y)*s},{x:p.x+(side*13+flutter.x)*s,y:p.y+(-25+flutter.y)*s},{x:p.x+(side*6+flutter.fold)*s,y:p.y+(-22+flutter.y)*s},{x:p.x+side*s,y:p.y-21*s}],'#dd7252');
  const tp=iso(hole.tee.x,hole.tee.y);rect(tp.x-4*s,tp.y-2*s,2*s,3*s,'#e1e7be');rect(tp.x+4*s,tp.y+1*s,2*s,3*s,'#e1e7be');
  const is=hole.id===selectedHole;rounded(p.x-9,p.y-29*s-22,18,18,5,is?'#244e36':'#f8f4de');textAt(String(sim.holes.indexOf(hole)+1),p.x,p.y-29*s-9,10,is?'#e1efb6':'#436337');
}
const mix=(a,b,t)=>a+(b-a)*t;
function golferLife(g,{inCart=false,parked=false,facing=1}={}){
  const mates=sim.golfers.filter(other=>other.id!==g.id&&other.groupId===g.groupId);
  const busy=mates.some(other=>['positioning','preparing','swinging','watching'].includes(other.phase));
  const mate=mates.find(other=>Math.hypot(other.x-g.x,other.y-g.y)<3.5);
  const partner=mate?{id:mate.id,phase:mate.phase,x:((mate.x-g.x)-(mate.y-g.y))*28*facing,y:((mate.x-g.x)+(mate.y-g.y))*14}:null;
  return lifePose(g,sim._clock,{busy,inCart,parked,partner,seed:sim.weather.seed});
}
function cart(c){
  const p=iso(c.x,c.y),s=artScale().golfer,rider=sim.golfers.find(g=>g.id===c.golferId),occupied=rider&&['riding','boarding'].includes(rider.phase);
  const pose=cartPose(c.heading),point=pose.point;
  ctx.save();ctx.translate(p.x,p.y);ctx.scale(s,s);
  const line=(a,b,color,width)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()};
  const box=(back,front,halfWidth,bottom,top,color,sideColor)=>{
    const corners=[[back,-halfWidth],[front,-halfWidth],[front,halfWidth],[back,halfWidth]];
    const normals=[-pose.side.y,pose.forward.y,pose.side.y,-pose.forward.y];
    poly(corners.map(([a,b])=>point(a,b,top)),color);
    for(let i=0;i<4;i++)if(normals[i]>1e-9){
      const a=corners[i],b=corners[(i+1)%4];
      poly([point(...a,bottom),point(...b,bottom),point(...b,top),point(...a,top)],sideColor);
    }
  };
  const nearSide=pose.side.y>=0?1:-1;
  const wheels=[-1,1].flatMap(side=>[-11,11].map(along=>({side,along,depth:point(along,side*9).y}))).sort((a,b)=>a.depth-b.depth);
  const wheel=w=>{
    const ring=(radius,across)=>Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return point(w.along+Math.cos(a)*radius,across,3.6+Math.sin(a)*radius*.8)});
    // Tyre thickness keeps the front/rear view legible when its side is edge-on.
    poly(ring(4.2,w.side*7.8),'#29382e');poly(ring(4.2,w.side*10),'#3c443a');
    poly([point(w.along,w.side*7.8,.25),point(w.along,w.side*10,.25),point(w.along,w.side*10,6.95),point(w.along,w.side*7.8,6.95)],'#3c443a');
    poly(ring(1.8,w.side*10.1),'#8a9275');
    const spin=c.phase==='driving'&&c._speed>0?sim._clock*5:0;
    line(point(w.along-Math.cos(spin)*1.5,w.side*10.2,3.6-Math.sin(spin)*1.2),point(w.along+Math.cos(spin)*1.5,w.side*10.2,3.6+Math.sin(spin)*1.2),'#d0d1b5',.5);
  };
  poly([point(-19,-11,-.8),point(19,-11,-.8),point(19,11,-.8),point(-19,11,-.8)],'#1835224b');
  wheels.filter(w=>w.side!==nearSide).forEach(wheel);
  box(-17,17,8.7,4,7,'#e8e9ce','#67854f');
  box(8,17,8.7,7,10,'#cad4a6','#91a47d');
  box(-11,-2,7,7,9,'#867a59','#665e45');
  box(-12,-9,7,9,14,'#867a59','#665e45');
  const posts=[[-12,-7],[-12,7],[12,-7],[12,7]].sort((a,b)=>point(...a).y-point(...b).y);
  posts.slice(0,2).forEach(([a,b])=>line(point(a,b,7),point(a,b,18),'#8c9d76',.9));
  if(occupied){
    const facing=Math.sign(pose.forward.x)||1;
    drawCartRider(ctx,{g:rider,appearance:appearanceOf(rider),life:golferLife(rider,{inCart:true,parked:c.phase!=='driving',facing}),point,facing});
  }
  const steering=Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return point(5+Math.cos(a)*2.3,Math.sin(a)*2.3,11+Math.cos(a)*1.5)});
  poly(steering,null,'#445541',.9);
  posts.slice(2).forEach(([a,b])=>line(point(a,b,7),point(a,b,18),'#aab68b',.9));
  drawCartBag(ctx,{point,extracting:rider?.phase==='retrievingClub',carried:rider?.carryClub});
  wheels.filter(w=>w.side===nearSide).forEach(wheel);
  box(-17,16,10,17.5,19,'#f1eed3','#c7c9a7');
  ctx.restore();
}
function person(g){
  if(['riding','boarding'].includes(g.phase))return;
  const p=iso(g.x,g.y),s=artScale().golfer,gait=walkingPose(g,PACE.walk);
  const h=sim.holes.find(h=>h.id===g.holeId),playing=['aiming','preparing','swinging','watching'].includes(g.phase);
  const origin=g._addressBall||g.shot?.from||g.ball;
  const c=sim.carts.find(c=>c.id===g.cartId),bag=g.phase==='retrievingClub'&&c?cartBagAnchor(c):null;
  const contact=contactPoint(g,sim.heightAt(origin.x,origin.y)-sim.heightAt(g.x,g.y)),facing=bag?((bag.x-bag.y)<(g.x-g.y)?-1:1):playing?contact.facing:(Math.cos(g.heading)-Math.sin(g.heading)<0?-1:1);
  const pose=swingPose(g,contact),selected=g.id===sim.selectedGolferId||g.controlled;
  ctx.save();ctx.translate(p.x,p.y);ctx.scale(facing*s,s);
  drawGolfer(ctx,{g,gait,pose,life:pose?null:golferLife(g,{facing}),clubPose:bag?clubRetrievalPose(g,c,{facing,elevationDelta:sim.heightAt(c.x,c.y)-sim.heightAt(g.x,g.y)}):null,appearance:appearanceOf(g),selected,celebrate:g.phase==='holed'&&g.poseTime<3&&g.lastScore<=h?.par});
  ctx.restore();
  if(selected){const labelY=playing?p.y+10:p.y-23*s-20;rounded(p.x-32,labelY,64,14,4,g.controlled?'#f8e9a6ed':'#f9f5dfed');textAt(g.name,p.x,labelY+10,8,'#486440')}
}
function visibleBall(x,y,radius,marker=false){
  ctx.save();ctx.shadowColor='#23412c';ctx.shadowBlur=radius*.8;ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();ctx.restore();
}
function ball(g){
  if(['riding','boarding','disembarking','holed','returningCart'].includes(g.phase))return;
  const radius=artScale().ball;
  if(g.shot){
    const sh=g.shot,air=sh.airDuration||0,flight=air>0&&sh.elapsed<air;
    if(sh.rollPath){
      let p,lift=0;
      if(flight){const t=sh.elapsed/air,q=sh.flightPath?sampleFlight(sh.flightPath,sh.elapsed):{x:mix(sh.from.x,sh.carry.x,t),y:mix(sh.from.y,sh.carry.y,t),lift:Math.sin(t*Math.PI)*.8};p=iso(q.x,q.y);lift=q.lift*tileW+(mix(sh.fromHeight,sh.carryHeight,t)-sim.heightAt(q.x,q.y))*tileW*HEIGHT_SCALE;}
      else{const q=sampleRoll(sh.rollPath,sh.elapsed-air);p=iso(q.x,q.y);lift=q.lift*tileW;}
      ctx.fillStyle='#27482c40';ctx.beginPath();ctx.ellipse(p.x,p.y,radius*1.4,radius*.65,0,0,Math.PI*2);ctx.fill();visibleBall(p.x,p.y-lift-radius,radius);return;
    }
    const t=flight?Math.min(1,sh.elapsed/air):rollProgress((sh.elapsed-air)/Math.max(.001,sh.rollDuration));
    const from=flight?sh.from:sh.carry,to=flight?sh.carry:sh.to,p=iso(mix(from.x,to.x,t),mix(from.y,to.y,t)),lift=flight?Math.sin(t*Math.PI)*tileW*.8:0;
    ctx.fillStyle='#41623644';ctx.beginPath();ctx.ellipse(p.x,p.y,radius*1.6,radius*.7,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#f5f5d98c';ctx.lineWidth=radius*1.6;ctx.beginPath();for(let j=0;j<7;j++){const u=Math.max(0,t-j*.022),q=iso(mix(from.x,to.x,u),mix(from.y,to.y,u));q.y-=flight?Math.sin(u*Math.PI)*tileW*.8:0;j?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)}ctx.stroke();
    visibleBall(p.x,p.y-lift-radius,radius,g.controlled||g.id===sim.selectedGolferId);
  }else if(g.ball){const p=iso(g.ball.x,g.ball.y);visibleBall(p.x,p.y-radius,radius,g.controlled||g.id===sim.selectedGolferId)}
}
function drawSelection(){
  const hole=sim.holes.find(h=>h.id===selectedHole);
  if(tool==='inspect'&&hole){ctx.save();ctx.strokeStyle='#eff4c052';ctx.setLineDash([4,6]);ctx.lineWidth=1;const a=iso(hole.tee.x,hole.tee.y),b=iso(hole.green.x,hole.green.y);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore()}
  if(pendingTee){diamond(pendingTee.x,pendingTee.y,'#fbeb9144','#f9efb6');const p=iso(pendingTee.x,pendingTee.y);textAt('SALIDA',p.x,p.y-18,8,'#fff4c4')}
  if(hover&&tool!=='inspect'&&tool!=='aim'){
    const r=tool==='hole'||tool==='tree'?0:Math.floor(brush/2);for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(sim.tile(hover.x+dx,hover.y+dy))diamond(hover.x+dx,hover.y+dy,'#faf4c445','#f5f2c8');
  }
}
let previewCache=null;
function shotPreview(){
  const g=player();if(!g||!readyToAim()||!aimTarget)return null;
  const club=$('shotClub').value,power=Number($('shotPower').value),style=shotStyle();
  const key=[g.id,g.holeId,g.strokes,g.ball.x,g.ball.y,aimTarget.x,aimTarget.y,club,power,style,Math.floor(sim._clock*4)].join(':');
  if(previewCache?.key===key&&previewCache.revision===terrainCache)return previewCache.value;
  const value=sim.previewPlayerShot(aimTarget,club,power,style);
  previewCache={key,revision:terrainCache,value};return value;
}
function drawAim(){
  const g=player();if(!g||!readyToAim()||!aimTarget)return;
  const preview=shotPreview();if(!preview)return;
  const a=iso(g.ball.x,g.ball.y),b=iso(preview.to.x,preview.to.y),target=iso(aimTarget.x,aimTarget.y),finish=iso(preview.finish.x,preview.finish.y);
  ctx.save();ctx.lineWidth=1.5;ctx.strokeStyle='#fff8b8';ctx.setLineDash([5,4]);ctx.beginPath();
  if(preview.flightPath){
    const heightStart=sim.heightAt(g.ball.x,g.ball.y),heightEnd=sim.heightAt(preview.to.x,preview.to.y),duration=preview.flightPath.at(-1).t;
    for(const [i,q]of preview.flightPath.entries()){const p=iso(q.x,q.y);p.y-=q.lift*tileW+(mix(heightStart,heightEnd,q.t/duration)-sim.heightAt(q.x,q.y))*tileW*HEIGHT_SCALE;i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)}
  }else{ctx.moveTo(a.x,a.y);ctx.lineTo(finish.x,finish.y)}ctx.stroke();
  ctx.strokeStyle='#e9b866';ctx.setLineDash([2,4]);ctx.beginPath();for(const [i,q]of preview.rollPath.entries()){const p=iso(q.x,q.y);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)}ctx.stroke();
  ctx.setLineDash([]);ctx.strokeStyle=preview.terrain==='water'?'#ffad86':'#efca75';ctx.fillStyle='#efca7524';ctx.beginPath();ctx.ellipse(finish.x,finish.y,Math.max(4,preview.spread*tileW),Math.max(3,preview.spread*tileH),0,0,Math.PI*2);ctx.fill();ctx.stroke();
  rounded(finish.x-27,finish.y+11,54,15,3,'#473f2bd9');textAt('final ≈',finish.x,finish.y+22,9,'#f2d294');
  ctx.beginPath();ctx.moveTo(target.x-5,target.y);ctx.lineTo(target.x+5,target.y);ctx.moveTo(target.x,target.y-5);ctx.lineTo(target.x,target.y+5);ctx.stroke();
  if(!preview.putting){rounded(b.x-35,b.y-20,70,16,4,'#243c30e8');textAt(`pique ${Math.round(preview.length*20)} m`,b.x,b.y-8,9,'#fff5b6')}
  // Downhill arrow near the destination makes the break readable.
  const slope=sim.slopeAt(preview.finish.x,preview.finish.y),m=Math.hypot(slope.x,slope.y);
  if(m>.06){const q=iso(preview.finish.x-slope.x/m*.6,preview.finish.y-slope.y/m*.6);ctx.strokeStyle='#d5e7ad';ctx.beginPath();ctx.moveTo(finish.x,finish.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.fillStyle='#d5e7ad';ctx.beginPath();ctx.arc(q.x,q.y,2,0,Math.PI*2);ctx.fill()}
  ctx.restore();
}
function bridgeGeometry(b){
  const dx=b.to.x-b.from.x,dy=b.to.y-b.from.y,length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length,w=b.widthCells/2;
  const point=(along,side,extra=0)=>{
    const x=b.from.x+dx*along+nx*side,y=b.from.y+dy*along+ny*side,p=iso(x,y);
    return {x:p.x,y:p.y-(b.deckHeight+extra-sim.heightAt(x,y))*tileW*HEIGHT_SCALE,depth:x+y};
  };
  return {point,w,segments:Math.max(1,Math.ceil(length*8))};
}
function bridgeSurface(b){
  const {point,w,segments}=bridgeGeometry(b);
  // The deck is a ground surface. It cannot paint over occupants' wheels/feet.
  for(let i=0;i<segments;i++)poly([point(i/segments,-w),point((i+1)/segments,-w),point((i+1)/segments,w),point(i/segments,w)],'#a89368');
  poly([point(0,-w),point(1,-w),point(1,w),point(0,w)],null,'#635b45',tileW*.018);
  ctx.lineWidth=tileW*.008;ctx.strokeStyle='#685d4560';
  for(let i=0;i<=segments;i++){const t=i/segments,a=point(t,-w),c=point(t,w);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(c.x,c.y);ctx.stroke()}
}
function bridgeRails(b,sprites){
  const {point,w,segments}=bridgeGeometry(b);
  for(const side of [-1,1]){
    for(let i=0;i<segments;i++){
      const a=point(i/segments,side*w,.8),c=point((i+1)/segments,side*w,.8);
      sprites.push({depth:Math.max(a.depth,c.depth)+.025,draw:()=>{ctx.strokeStyle='#d1bb85';ctx.lineWidth=tileW*.012;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(c.x,c.y);ctx.stroke()}});
    }
    for(const t of [0,.33,.67,1]){
      const p=point(t,side*w),q=point(t,side*w,.8);
      sprites.push({depth:p.depth+.025,draw:()=>{ctx.strokeStyle='#d1bb85';ctx.lineWidth=tileW*.012;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke()}});
    }
  }
}
function draw(){
  frameWind=sim.windAt();
  ctx.clearRect(0,0,width,height);
  const bg=ctx.createLinearGradient(0,0,width,height);bg.addColorStop(0,'#394d38');bg.addColorStop(1,'#536d43');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
  terrain();drawSelection();
  for(const b of sim.coursePlan?.bridges||[])bridgeSurface(b);
  const sprites=[];
  const ambientWind=frameWind,birds=ambientBirds(sim,now,ambientWind),onGround=b=>b.height<.04&&b.fly<.02;
  const ambientProject=(x,y,z=0)=>{const p=iso(x,y);return {x:p.x,y:p.y-z*tileW*HEIGHT_SCALE}};
  const scene=staticScene();
  for(const tree of scene.trees){
    const {x,y}=tree,p={x:ox+tree.px*tileW,y:oy+tree.py*tileW};
    if(p.x+tileW*.9>=0&&p.x-tileW*.9<=width&&p.y+tileW*.15>=0&&p.y-tileW*2<=height)sprites.push({depth:x+y,draw:()=>drawTree(x,y,p)});
  }
  sprites.push({depth:31,draw:clubhouse});
  for(const b of sim.coursePlan?.bridges||[])bridgeRails(b,sprites);
  sim.holes.forEach(h=>sprites.push({depth:h.green.x+h.green.y+.15,draw:()=>flag(h)}));
  for(const detail of scene.details)sprites.push({depth:detail.depth,draw:()=>drawTeeDetail(ctx,detail,{project:iso,unit:artScale().golfer})});
  sim.carts.forEach(c=>sprites.push({depth:c.x+c.y+.2,draw:()=>cart(c)}));
  sim.golfers.forEach(g=>sprites.push({depth:g.x+g.y+.25,draw:()=>person(g)}));
  for(const bird of birds.filter(onGround))sprites.push({depth:bird.x+bird.y+.28,draw:()=>drawAmbient(ctx,{sim,project:ambientProject,unit:artScale().golfer,clock:now,wind:ambientWind,birds:[bird]})});
  sprites.sort((a,b)=>a.depth-b.depth).forEach(s=>s.draw());sim.golfers.forEach(ball);drawAim();
  drawAmbient(ctx,{sim,project:ambientProject,unit:artScale().golfer,clock:now,wind:ambientWind,birds:birds.filter(b=>!onGround(b))});
  const speaking=sim.golfers.filter(g=>!['riding','boarding'].includes(g.phase)&&g.comment&&(g.id===sim.selectedGolferId||g.id%3===0)).slice(0,3);
  for(const g of speaking){const p=iso(g.x,g.y),txt=golferLife(g)?.label||g.comment,bubbleY=p.y-28*artScale().golfer-30;ctx.font='9px Arial';const w=Math.min(215,ctx.measureText(txt).width+12);rounded(p.x-w/2,bubbleY,w,15,3,'#1d342dbb');textAt(txt,p.x,bubbleY+11,9,'#f1f1ca');textAt(g.name,p.x,bubbleY+24,8,'#eef6d5')}

}
function skill(label,value,scale=1){const pct=Math.max(0,Math.min(100,value*scale));return `<div class="skill"><label>${label}</label><div><span style="width:${pct}%"></span></div><b>${Math.round(pct)}</b></div>`}
const phaseLabel={aiming:'Tu turno · elegí un tiro',riding:'En el carrito',disembarking:'Bajando y buscando el palo',retrievingClub:'Sacando el palo de la bolsa',waiting:'Esperando su turno',positioning:'Tomando posición',preparing:'Alineando el tiro',swinging:'Swing completo',watching:'Siguiendo la pelota',afterShot:'Esperando a su compañero',walking:'Caminando hacia la pelota',holed:'Hoyo terminado',returningCart:'Regresando al carrito',boarding:'Guardando el palo y subiendo',blocked:'Buscando un camino libre'};
function inspector(){
  const g=sim.golfers.find(g=>g.id===sim.selectedGolferId),h=sim.holes.find(h=>h.id===selectedHole);
  if(g){
    $('inspectorTag').textContent='CONOCÉ A TUS GOLFISTAS';
    const current=sim.holes[g.holeIndex];
    $('inspectorBody').innerHTML=`<div class="golfer-heading"><span class="golfer-avatar" style="color:${esc(appearanceOf(g).shirt)}">♟</span><div><h3>${esc(g.name)}</h3><small>${current?'Hoyo '+(g.holeIndex+1):'Entre hoyos'} · ${phaseLabel[g.phase]||'En el campo'}</small></div></div><div class="detail-grid"><div><strong>${g.strokes}</strong><span>golpes</span></div><div><strong>${Math.round(g.mood)}</strong><span>ánimo</span></div><div><strong>${current?.par||'—'}</strong><span>par del hoyo</span></div></div>${skill('Longitud',g.power,100/10)}${skill('Precisión',g.accuracy,g.accuracy>1?1:100)}${skill('Recuperación',g.recovery,g.recovery>1?1:100)}<p class="note">“${esc(g.comment||'Un buen día para jugar al golf.')}”</p>`;
  }else if(h){
    $('inspectorTag').textContent='INFORME DEL HOYO';const inf=sim.holeInfo(h);
    const ref=h.reference,published=ref?.publishedDistancesM;
    const reference=ref?`<p class="note course-reference"><b>Referencia del Paraná</b><br>Publicado por el club: ${published.club} m.<br>Azul ${published.blue} · blanco ${published.white} · rojo ${published.red} m.<br>Calle aproximada en el juego: ${Math.round(ref.geometryLengthM)} m.<br>Escala y contornos provisionales.${ref.confidence.tee==='low'||ref.confidence.green==='low'?' Salida o green de baja precisión.':''}</p>`:'';
    $('inspectorBody').innerHTML=`<h3>${esc(h.name)}</h3><p class="description">${esc((ref?'En el campo real: ':'')+(ref?.featureSummary||h.description||'Una ruta que tus golfistas están descubriendo.'))}</p><div class="detail-grid"><div><strong>${Math.round(inf.distance)}</strong><span>${ref?'m directos · juego':'metros'}</span></div><div><strong>${inf.par}</strong><span>par</span></div><div><strong>${Math.round(inf.beauty)}%</strong><span>paisaje</span></div></div><div class="skill"><label>Dificultad</label><div><span style="width:${Math.min(100,Math.max(0,inf.difficulty))}%"></span></div><b>${Math.round(inf.difficulty)}</b></div>${reference}<p class="note">Pintá un fairway más amplio y compará los resultados. El terreno cambia los tiros.</p>`;
  }else{
    $('inspectorTag').textContent='UN CAMPO POR IMAGINAR';$('inspectorBody').innerHTML='<h3>La primera bandera.</h3><p class="description">Usá “Nuevo hoyo”: marcá la salida y la bandera. Después pintá el fairway y observá cómo llegan los jugadores.</p><p class="note">Un recorrido amable también puede tener un desafío. La arena no tiene que parecer una playa entera.</p>';
  }
}
function updateUI(){
  const stats=sim.getStats();
  const observed=sim.groups.find(gr=>gr.holeId===selectedHole&&!['queued','leaving'].includes(gr.phase));
  const elapsed=observed?Math.max(0,Math.floor(sim._clock-observed.startedAt)):0;
  $('paceTime').textContent=observed?`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`:'—';
  const actor=sim.golfers.find(g=>g.id===observed?.actorId);
  const roadBlocked=observed&&sim.carts.some(c=>c.groupId===observed.id&&c.phase==='blocked');
  const groupLabel={driving:'Llegando en carritos',parking:'Estacionando junto al tee',disembarking:'Bajando y reuniéndose',gathering:'Reunidos antes de salir',playing:'Jugando por turnos',walking:'Avanzando hacia las pelotas',finishing:'Cerrando el hoyo',returningCart:'Volviendo a los carritos',boarding:'Preparando el siguiente hoyo'};
  $('paceAction').textContent=roadBlocked?'Conectá el camino de carritos hasta el tee':actor?`${actor.name} · ${phaseLabel[actor.phase]}`:observed?groupLabel[observed.phase]||'En el campo':'Esperando al próximo grupo';
  $('money').textContent=money(sim.money);$('mood').innerHTML=`${Math.round(sim.satisfaction)} <span>/ 100</span>`;$('moodBar').style.width=Math.max(0,Math.min(100,sim.satisfaction))+'%';
  $('day').textContent='Día '+sim.day;const hours=Math.floor(sim.time),minutes=Math.floor((sim.time-hours)*60);$('time').textContent=`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')} · Cielo despejado`;
  const wind=sim.windAt(),angle=Math.atan2((wind.x+wind.y)*.5,wind.x-wind.y)*180/Math.PI;
  $('windArrow').style.transform=`rotate(${angle}deg)`;$('windArrow').setAttribute('aria-label',`El viento sopla hacia ${Math.round(angle)} grados en esta vista`);$('windSpeed').textContent=`${Math.round(wind.speed*3.6)} km/h${Math.abs(wind.gust)>.65?' · ráfaga':''}`;
  $('visitors').textContent=sim.totalVisitors;$('activePlayers').textContent=stats.active;$('revenue').textContent=money(sim.totalRevenue);$('maintenance').textContent=money(stats.maintenance);
  if(document.activeElement!==$('fee'))$('fee').value=sim.fee;
  $('moodAdvice').textContent=sim.satisfaction>=85?'Un recorrido que invita a volver.':sim.satisfaction>=65?'Los golfistas disfrutan del recorrido.':'Revisá obstáculos, fairways y el precio de entrada.';
  $('courseSummary').textContent=`${N}×${N} · ${sim.holes.length} hoyos · Par ${sim.holes.reduce((n,h)=>n+h.par,0)}`;
  const parana=sim.courseId===PARANA_ID;
  $('courseName').textContent=parana?'Paraná Country Club':'Paraíso Golf';
  $('courseCaption').textContent=parana?'PRIMEROS NUEVE · TRAZADO DE REFERENCIA':'CLUB DE CAMPO';
  $('planView').hidden=!parana;
  $('upgradeParana').hidden=!parana||sim.courseRevision===3;
  try{ $('restoreParana').hidden=!localStorage.getItem(STORAGE+'-before-parana-relief')&&!localStorage.getItem(STORAGE+'-before-parana-upgrade') }catch{ $('restoreParana').hidden=true }
  $('compassLabel').textContent=parana?'VISTA':'N';
  try{$('recoverField').hidden=!localStorage.getItem(STORAGE+'-before-parana')}catch{$('recoverField').hidden=true}
  $('addPractice').hidden=parana||sim.holes.length>6||sim.tiles.some((row,y)=>row.some((t,x)=>(x>=32||y>=32)&&t.type!=='grass'));
  $('holeTabs').innerHTML=sim.holes.map((h,i)=>`<button class="hole-tab ${h.id===selectedHole?'active':''}" data-id="${esc(h.id)}"><span>${i+1}</span><div><b>${esc(h.name)}</b><small>PAR ${h.par} · ${Math.round(sim.holeInfo(h).distance)} M${h.reference?' JUEGO':''}</small></div></button>`).join('');
  $('activity').innerHTML=sim.events.slice(-4).reverse().map(ev=>`<p>${esc(typeof ev==='string'?ev:ev.message||ev.text||'Una nueva historia en el club.')}</p>`).join('')||'<p>Un nuevo día. El campo está esperando.</p>';
  const won=sim.satisfaction>=85&&sim.holes.length>=3;$('challengeText').textContent=won?'Desafío conseguido. Ahora mantené felices a tus socios.':'Llegá a 85 de satisfacción con al menos 3 hoyos.';$('challengeBar').style.width=(won?100:Math.min(99,Math.min(sim.holes.length/3,1)*sim.satisfaction/85*100))+'%';
  $('pause').textContent=sim.paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',sim.paused?'Reanudar simulación':'Pausar simulación');$('pause').classList.toggle('active',sim.paused);document.querySelectorAll('.speed').forEach(b=>b.classList.toggle('active',Number(b.dataset.speed)===sim.speed));inspector();updatePlayerUI();gameUI?.syncControls();gameUI?.preview();
}
function checkpoint(){undoStack.push({cartBays:structuredClone(sim.cartBays),depotBays:structuredClone(sim.depotBays),tiles:sim.tiles.map(row=>row.map(t=>({...t}))),elevations:sim.elevations.map(row=>[...row]),holes:sim.holes.map(h=>({...h,tee:{...h.tee},green:{...h.green}})),cost:0});if(undoStack.length>15)undoStack.shift()}
function setTool(next){tool=next;document.body.dataset.tool=tool;pendingTee=null;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));canvas.style.cursor=tool==='inspect'||tool==='aim'?'grab':'crosshair';$('mapHint').textContent=tool==='aim'?'Tocá el campo para apuntar. Arrastrá para mover la cámara.':tool==='hole'?'Marcá la salida. Después, la posición de la bandera.':tool==='inspect'?'Tocá un golfista para conocer su historia.':`${names[tool]||tool}: tocá o arrastrá para pintar. Deshacé con ↶.`;}
function edit(t){
  if(!t||!sim.tile(t.x,t.y))return;
  if(tool==='hole'){
    if(!pendingTee){pendingTee={...t};$('mapHint').textContent='Ahora marcá la bandera, a varias casillas de distancia.';toast('Salida elegida. Buscá un buen lugar para el green.');return}
    checkpoint();const result=sim.addHole(pendingTee,t);if(result.ok){undoStack.at(-1).cost+=result.cost||650;terrainCache=null;selectedHole=sim.holes.at(-1)?.id;pendingTee=null;setTool('fairway');toast('Hoyo creado. Pintá el fairway entre la salida y la bandera.');save(false)}else{undoStack.pop();toast(result.message)}updateUI();return;
  }
  const r=tool==='tree'?0:Math.floor(brush/2);let spent=0,warning=null;
  for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    const x=t.x+dx,y=t.y+dy,key=x+','+y;if(painted.has(key))continue;painted.add(key);const result=tool==='raise'||tool==='lower'?sim.sculpt(x,y,(tool==='raise'?1:-1)*.6):sim.paint(x,y,tool);if(result.ok){spent++;if(!result.unchanged)terrainCache=null;if(undoStack.length)undoStack.at(-1).cost+=result.cost||0}else if(result.message)warning=result.message;
  }
  if(!spent&&warning)toast(warning);
}
function editStroke(t){
  // Pointer events can skip cells, particularly while drawing on a phone.
  // Fill those gaps so a diagonal drag creates a single connected road.
  const previous=drag?.lastPaintTile;
  if(tool==='path'&&previous){
    const dx=t.x-previous.x,dy=t.y-previous.y,steps=Math.max(Math.abs(dx),Math.abs(dy));
    for(let i=1;i<=steps;i++)edit({x:Math.round(previous.x+dx*i/steps),y:Math.round(previous.y+dy*i/steps)});
  }else edit(t);
  if(drag)drag.lastPaintTile={...t};
}
function inspectAt(t,p){
  let closest=null,dist=22;
  sim.golfers.forEach(g=>{const q=iso(g.x,g.y),d=Math.hypot(p.x-q.x,p.y-q.y+11*artScale().golfer);if(d<dist){dist=d;closest=g}});
  if(closest){sim.selectedGolferId=closest.id;gameUI?.setPanel('golfer');updateUI();return}
  sim.selectedGolferId=null;let near=null,best=6;
  sim.holes.forEach(h=>{const d=Math.min(Math.hypot(t.x-h.green.x,t.y-h.green.y),Math.hypot(t.x-h.tee.x,t.y-h.tee.y));if(d<best){best=d;near=h}});if(near){selectedHole=near.id;gameUI?.setPanel('course')}updateUI();
}
function pointer(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}}
canvas.addEventListener('pointerdown',e=>{if(e.button!==0||drag)return;canvas.setPointerCapture(e.pointerId);const p=pointer(e);drag={pointerId:e.pointerId,x:p.x,y:p.y,startX:p.x,startY:p.y,moved:false,tool};painted.clear();if(tool!=='inspect'&&tool!=='aim'&&tool!=='hole'){checkpoint();editStroke(uniso(p.x,p.y))}hover=uniso(p.x,p.y)});
canvas.addEventListener('pointermove',e=>{
  if(drag&&e.pointerId!==drag.pointerId)return;
  const p=pointer(e);
  if(drag&&(drag.tool==='inspect'||drag.tool==='aim')){
    const wasMoving=drag.moved;
    if(Math.hypot(p.x-drag.startX,p.y-drag.startY)>5)drag.moved=true;
    if(drag.moved){camera.dx+=p.x-(wasMoving?drag.x:drag.startX);camera.dy+=p.y-(wasMoving?drag.y:drag.startY);geometry()}
    drag.x=p.x;drag.y=p.y;hover=null;return;
  }
  hover=uniso(p.x,p.y);
  if(drag){
    if(Math.hypot(p.x-drag.startX,p.y-drag.startY)>5)drag.moved=true;
    if(drag.tool!=='hole')editStroke(hover);
    drag.x=p.x;drag.y=p.y;
  }
});
function pointerEnd(e){
  if(!drag||e.pointerId!==drag.pointerId)return;
  const p=pointer(e),panning=drag.tool==='inspect'||drag.tool==='aim';
  // A browser may coalesce a very fast swipe into its release coordinates.
  // Its final distance still distinguishes a pan from a deliberate tap.
  if(panning&&(drag.moved||Math.hypot(p.x-drag.startX,p.y-drag.startY)>5)){
    camera.dx+=p.x-(drag.moved?drag.x:drag.startX);camera.dy+=p.y-(drag.moved?drag.y:drag.startY);geometry();drag.moved=true;
  }
  if(!drag.moved){
    const t=uniso(p.x,p.y);
    if(drag.tool==='aim'){
      const target=mapPoint(p.x,p.y);
      if(readyToAim()&&sim.previewPlayerShot(target,$('shotClub').value,Number($('shotPower').value),shotStyle())){aimTarget=target;updatePlayerUI()}
    }else if(drag.tool==='inspect')inspectAt(t,p);
    else if(drag.tool==='hole')edit(t);
  }
  if(!panning&&drag.tool!=='hole'){if(undoStack.at(-1)?.cost===0)undoStack.pop();save(false)}
  drag=null;painted.clear();updateUI();
}
canvas.addEventListener('pointerup',pointerEnd);canvas.addEventListener('pointercancel',()=>{drag=null;painted.clear()});canvas.addEventListener('pointerleave',()=>{if(!drag)hover=null});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.1:1/1.1,pointer(e))},{passive:false});
function zoom(factor,anchor=null){
  const area=gameUI?.screenArea()||{x:width/2,y:height/2},g=sim.golfers.find(g=>g.id===sim.selectedGolferId);
  const p=g?iso(g.x,g.y):null;
  anchor||=p&&p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height?p:{x:area.x,y:area.y};
  const target=mapPoint(anchor.x,anchor.y);camera.zoom=Math.max(.65,Math.min(MAX_ZOOM,camera.zoom*factor));geometry();
  const after=iso(target.x,target.y);camera.dx+=anchor.x-after.x;camera.dy+=anchor.y-after.y;geometry();
}
function centerOn(point,footOffset=0){
  const area=gameUI?.screenArea()||{x:width/2,y:height*.52},p=iso(point.x,point.y);
  camera.dx+=area.x-p.x;camera.dy+=area.y+footOffset-p.y;geometry();
}
function focusDetail(){
  const g=sim.golfers.find(g=>g.id===sim.selectedGolferId)||player()||sim.golfers.find(g=>!['riding','boarding'].includes(g.phase))||sim.golfers[0];
  if(!g){toast('Empezá un partido para ver a tu golfista de cerca.');return}
  sim.selectedGolferId=g.id;setTool('inspect');
  const fit=tileW/camera.zoom,area=gameUI?.screenArea()||{height:height*.5};
  camera.zoom=Math.min(MAX_ZOOM,Math.min(190,area.height*56/32)/fit);geometry();centerOn(g,12*artScale().golfer);updateUI();
}
document.querySelectorAll('.tool').forEach(b=>{b.addEventListener('click',()=>setTool(b.dataset.tool));const price=b.querySelector('small');if(price&&COSTS[b.dataset.tool]!=null)price.textContent=money(COSTS[b.dataset.tool])});
document.querySelectorAll('.brush').forEach(b=>b.addEventListener('click',()=>{brush=Number(b.dataset.size);document.querySelectorAll('.brush').forEach(el=>el.classList.toggle('active',el===b))}));
$('zoomIn').onclick=()=>zoom(1.2);$('zoomOut').onclick=()=>zoom(1/1.2);$('fit').onclick=()=>{camera.zoom=1;camera.dx=0;camera.dy=0;geometry()};
$('pause').onclick=()=>{sim.paused=!sim.paused;updateUI()};document.querySelectorAll('.speed').forEach(b=>b.onclick=()=>{sim.speed=Number(b.dataset.speed);document.querySelectorAll('.speed').forEach(el=>el.classList.toggle('active',el===b));sim.paused=false;updateUI()});
$('fee').addEventListener('change',e=>{sim.setFee(Number(e.target.value));toast('Entrada actualizada a '+money(sim.fee));save(false)});
$('undo').onclick=()=>{const snapshot=undoStack.pop();if(!snapshot){toast('Todavía no hay una edición para deshacer.');return}const keep=new Set(snapshot.holes.map(h=>h.id));for(const h of [...sim.holes])if(!keep.has(h.id))sim.removeHole(h.id);sim.tiles=snapshot.tiles;sim.invalidateCartNetwork();sim.elevations=snapshot.elevations;sim.holes=snapshot.holes;sim.cartBays=snapshot.cartBays;sim.depotBays=snapshot.depotBays;terrainCache=null;sim.money+=snapshot.cost;for(const g of sim.golfers){g._path=null;g.holeIndex=sim.holes.findIndex(h=>h.id===g.holeId)}for(const c of sim.carts)c._path=null;selectedHole=sim.holes[0]?.id??null;pendingTee=null;updateUI();save(false);toast('Última edición deshecha.')};
$('holeTabs').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(!b)return;const h=sim.holes.find(h=>String(h.id)===b.dataset.id);if(h){selectedHole=h.id;sim.selectedGolferId=null;camera.zoom=(width<590?3:2)*N/48;geometry();centerOn({x:(h.tee.x+h.green.x)/2,y:(h.tee.y+h.green.y)/2});updateUI()}});
$('addPractice').onclick=()=>{checkpoint();const result=sim.addPracticeHoles();if(result.ok){terrainCache=null;save(false)}else undoStack.pop();toast(result.message);updateUI()};
function save(show=true){try{const snapshot=sim.save();localStorage.setItem(STORAGE,snapshot);if(sim.courseId===PARANA_ID){localStorage.setItem(STORAGE+'-parana',snapshot);localStorage.setItem(STORAGE+'-parana-r'+sim.courseRevision,snapshot);}storageOK=true;$('saveStatus').textContent='Guardado en este navegador';if(show)toast('Partida guardada en este navegador.')}catch{storageOK=false;$('saveStatus').textContent='Guardado local no disponible';if(show)toast('El navegador no permitió guardar la partida.')}}
$('save').onclick=()=>save();$('help').onclick=()=>$('helpDialog').showModal();$('projectGuide').onclick=()=>$('guideDialog').showModal();$('newMap').onclick=()=>$('newDialog').showModal();
$('connectRoads').onclick=()=>{checkpoint();const r=sim.connectCartPaths();if(r.ok){terrainCache=null;save(false)}else undoStack.pop();toast(r.message);updateUI()};
$('tidyRoads').onclick=()=>{checkpoint();const r=sim.tidyCartPaths();terrainCache=null;toast(r.message);save(false);updateUI();};
$('refineRoads').onclick=()=>{checkpoint();const r=sim.refineCartPaths();if(r.ok){terrainCache=null;save(false)}else undoStack.pop();toast(r.message);updateUI()};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
function fieldChanged(empty=false){terrainCache=null;selectedHole=sim.holes[0]?.id??null;sim.selectedGolferId=null;undoStack=[];aimTarget=null;aimKey='';lastPlayerHole=null;camera.zoom=1;camera.dx=0;camera.dy=0;geometry();setTool(empty?'hole':'inspect');$('newDialog').close();save(false);updateUI()}
function newMap(empty){if(sim.courseId===PARANA_ID)save(false);sim.reset(empty);if(!empty)sim.tidyCartPaths();fieldChanged(empty);toast(empty?'Tu terreno está listo. Empezá por una salida y una bandera.':'Seis hoyos y un nuevo comienzo.')}
$('demoMap').onclick=()=>newMap(false);$('emptyMap').onclick=()=>newMap(true);
$('paranaMap').onclick=()=>{
  if(sim.courseId===PARANA_ID){$('newDialog').close();toast('Ya estás en el Paraná. Tus cambios y el partido siguen guardados.');return}
  try{localStorage.setItem(STORAGE+'-before-parana',sim.save());const saved=localStorage.getItem(STORAGE+'-parana');if(!saved||!sim.load(saved)){sim.reset(false,PARANA_ID);sim.tidyCartPaths();}}catch{toast('No se pudo guardar tu campo anterior. Liberá espacio del navegador antes de cambiar.');return}
  fieldChanged();toast('Paraná listo: nueve hoyos. Podés volver a tu campo anterior desde Nuevo campo.');
};
$('recoverField').onclick=()=>{
  try{const saved=localStorage.getItem(STORAGE+'-before-parana');if(!saved){toast('No hay un campo anterior guardado.');return}save(false);if(!sim.load(saved)){toast('La copia anterior no pudo cargarse. Tu campo actual sigue disponible.');return}}
  catch{toast('El navegador no permitió recuperar la partida.');return}
  fieldChanged();toast('Volviste a tu campo anterior con su partida guardada.');
};
$('upgradeParana').onclick=()=>{
  try{
    localStorage.setItem(STORAGE+'-before-parana-relief',sim.save());
    const saved=localStorage.getItem(STORAGE+'-parana-r3');
    if(!saved||!sim.load(saved)){sim.reset(false,PARANA_ID);sim.tidyCartPaths();};
  }catch{toast('No se pudo guardar la copia anterior. El recorrido actual sigue disponible.');return}
  fieldChanged();toast('Paraná con pendientes, camino lateral y puente. Tu recorrido y partido anteriores quedan guardados.');
};
$('restoreParana').onclick=()=>{
  try{const saved=localStorage.getItem(STORAGE+'-before-parana-relief')||localStorage.getItem(STORAGE+'-before-parana-upgrade');if(!saved)return;save(false);if(!sim.load(saved)){toast('No se pudo cargar la copia anterior.');return}}
  catch{toast('El navegador no permitió recuperar el recorrido.');return}
  fieldChanged();toast('Recorrido anterior recuperado con su partida.');
};
function renderPlan(){
  if(!$('coursePlanDialog').open||!sim.coursePlan)return;
  const canvas=$('coursePlan'),r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),context=canvas.getContext('2d');
  canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);context.setTransform(dpr,0,0,dpr,0,0);
  const nav=drawCoursePlan(context,{sim,width:r.width,height:r.height,showReference:$('planReference').checked,showNavigation:$('planNavigation').checked});
  const dry=nav.holes.reduce((n,h)=>n+Number(h.teeDry)+Number(h.greenDry),0),access=nav.holes.filter(h=>h.cartAccess).length,walks=nav.links.filter(l=>l.path).length;
  $('planStatus').textContent=`${dry}/18 salidas y greens secos · ${access}/${nav.holes.length} salidas con acceso para carritos · ${walks}/${nav.links.length} enlaces a pie transitables`;
  $('planConnections').textContent=nav.links.filter(l=>l.nearConfirmed).map(l=>`Green ${l.from} → tee ${l.to}: caminata corta${l.path?' · ≈'+Math.round(l.seconds)+' s en el juego':' · camino bloqueado'}`).join(' | ');
}
$('planView').onclick=()=>{$('coursePlanDialog').showModal();renderPlan()};
$('planReference').onchange=renderPlan;$('planNavigation').onchange=renderPlan;
new ResizeObserver(renderPlan).observe($('coursePlan'));
window.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||document.querySelector('dialog[open]'))return;
  if(e.key==='Escape'){setTool('inspect');return;}
  if(document.activeElement.tagName==='BUTTON')return;
  if(e.code==='Space'){e.preventDefault();sim.paused=!sim.paused;updateUI()}
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();$('undo').click()}
});
window.addEventListener('pagehide',()=>save(false));

function focusPlayer(){
  const g=player();if(!g)return;
  camera.zoom=(width<590?4.6:3.1)*N/48;geometry();
  const h=sim.holes.find(h=>h.id===g.holeId),point=readyToAim()&&h?{x:mix(g.ball.x,h.green.x,.3),y:mix(g.ball.y,h.green.y,.3)}:g;
  centerOn(point);
}
function updatePlayerUI(){
  const round=sim.playerRound,g=player(),active=round?.status==='playing',ready=readyToAim();
  $('menu').dataset.ready=String(Boolean(active&&ready));
  $('roundStart').hidden=active;$('shotControls').hidden=!active;$('followPlayer').hidden=!active;$('leaveRound').hidden=!active;
  $('startRound').disabled=!sim.holes.length;
  $('hitShot').disabled=!ready||sim.paused;$('shotClub').disabled=!ready;$('shotStyle').disabled=!ready||$('shotClub').value==='putter';if($('shotClub').value==='putter')$('shotStyle').value='straight';$('shotPower').disabled=!ready;$('aimFlag').disabled=!ready;
  if(active&&g){
    const h=sim.holes.find(h=>h.id===g.holeId),key=`${g.holeId}:${g.strokes}`;
    if(ready&&aimKey!==key){
      aimKey=key;aimTarget=h?{...h.green}:null;
      const d=h?Math.hypot(g.ball.x-h.green.x,g.ball.y-h.green.y):0;
      $('shotClub').value=(sim.tile(g.ball.x,g.ball.y)?.type==='green'||d<.6)&&d<=CLUBS.putter.range?'putter':Object.entries(CLUBS).filter(([key])=>key!=='putter').sort((a,b)=>a[1].range-b[1].range).find(([,c])=>c.range>=d)?.[0]||'driver';$('shotStyle').value='straight';
      $('shotPower').value=100;setTool('aim');selectedHole=g.holeId;sim.selectedGolferId=g.id;focusPlayer();
    }
    if(lastPlayerHole!==g.holeId){lastPlayerHole=g.holeId;selectedHole=g.holeId;focusPlayer()}
    $('roundStatus').textContent=`${g.name} · Hoyo ${g.holeIndex+1} · Par ${h?.par||'—'} · ${g.strokes} golpes · ${phaseLabel[g.phase]||'En camino'}`;
    if(ready){
      const p=shotPreview();
      const wind=sim.windAt(),windAngle=Math.atan2((wind.x+wind.y)*.5,wind.x-wind.y),windArrow=['→','↘','↓','↙','←','↖','↑','↗'][(Math.round(windAngle/(Math.PI/4))+8)%8];
      $('shotInfo').textContent=p?`${sim.paused?'Juego pausado · ':''}${names[sim.tile(g.ball.x,g.ball.y)?.type]||'Césped'} · Apuntás a ${Math.round(p.aimDistance*20)} m · ${p.putting?'Putt':'Pique'} ≈ ${Math.round(p.length*20)} m · ${p.deltaHeight>=0?'+':''}${p.deltaHeight.toFixed(1)} m · Viento ${windArrow} ${Math.round(wind.speed*3.6)} km/h${p.terrain==='water'?' · ⚠ Final estimado en agua':''}. Bajá fuerza para acortar; apuntar cerca no frena la pelota. Viento, pendiente y precisión pueden cambiar el final.`:'Tocá el campo para elegir una dirección.';
      $('hitShot').disabled=sim.paused||!p;
    }else $('shotInfo').textContent=g.phase==='blocked'?'Tu camino está bloqueado. Pintá un camino seco para continuar.':g.comment?.includes('penalidad')?g.comment:'Tu grupo avanza por turnos. Vas a elegir el próximo tiro cuando llegue tu turno.';
  }else{
    if(tool==='aim')setTool('inspect');
    if(round?.status==='finished'){
      const r=round.result,delta=r.score-r.par;
      $('roundStatus').textContent=r.scores.length?`${round.name}: ${r.score} golpes (${delta>0?'+':''}${delta}) · Álex: ${r.rivalScore}. ${r.score<r.rivalScore?'¡Ganaste el partido!':r.score===r.rivalScore?'¡Empate!':'Álex ganó. ¡Vamos por la revancha!'} ${r.scores.length} hoyos jugados.`:'Partido cerrado: no quedaron hoyos disponibles.';
      $('startRound').textContent='⛳ Jugar la revancha';
    }else $('roundStatus').textContent=round?.status==='abandoned'?'Tu golfista terminará solo. Podés comenzar otro partido.':'Jugá el recorrido contra Álex. Gana quien use menos golpes.';
  }
  $('powerValue').value=`${$('shotPower').value}%`;
  const rival=sim.golfers.find(p=>p.groupId===round?.groupId&&p.id!==round?.golferId);
  const scores=active?g?.scores:round?.result?.scores,rivalScores=active?rival?.scores:round?.result?.rivalScores;
  if(scores&&round){
    const rows=sim.holes.map((h,i)=>{const a=scores.find(s=>s.holeId===h.id),b=rivalScores?.find(s=>s.holeId===h.id);return `<tr><td>${i+1}</td><td>${h.par}</td><td>${a?.strokes??(active&&g?.holeId===h.id?g.strokes+'*':'—')}</td><td>${b?.strokes??(active&&rival?.holeId===h.id?rival.strokes+'*':'—')}</td></tr>`}).join('');
    const total=scores.reduce((n,s)=>n+s.strokes,0),other=(rivalScores||[]).reduce((n,s)=>n+s.strokes,0);
    const open=round.status==='finished'||$('roundScores').querySelector('details')?.open;
    $('roundScores').innerHTML=`<details ${open?'open':''}><summary>Tarjeta · ${esc(round.name)} ${total} / Álex ${other} <small>hoyos terminados</small></summary><table><caption>Menos golpes gana · * hoyo en curso</caption><thead><tr><th>Hoyo</th><th>Par</th><th>${esc(round.name)}</th><th>Álex</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }else $('roundScores').innerHTML='';
}
$('startRound').onclick=()=>{const result=sim.startPlayerRound($('playerName').value);toast(result.message);if(result.ok){aimKey='';lastPlayerHole=null;setTool('inspect');gameUI?.setPanel('play');focusPlayer();save(false)}updateUI()};
$('followPlayer').onclick=()=>{gameUI?.setPanel('play');focusPlayer();if(readyToAim())setTool('aim')};
$('shotClub').onchange=$('shotStyle').onchange=$('shotPower').oninput=()=>updatePlayerUI();
$('aimFlag').onclick=()=>{const h=sim.holes.find(h=>h.id===player()?.holeId);if(h){aimTarget={...h.green};setTool('aim');focusPlayer();updatePlayerUI()}};
$('hitShot').onclick=()=>{const result=sim.playShot(aimTarget,$('shotClub').value,Number($('shotPower').value),shotStyle());toast(result.message);if(result.ok)save(false);updateUI()};
$('leaveRound').onclick=()=>{sim.abandonPlayerRound();setTool('inspect');save(false);updateUI()};
let previous=performance.now();
function frame(ts){
  const dt=Math.min(.1,(ts-previous)/1000);previous=ts;cartView?.beforeTick();sim.tick(dt);now=sim._clock;
  cartView?.frame(ts);
  const panning=drag&&(drag.tool==='inspect'||drag.tool==='aim');
  if(ts-lastUI>500&&!panning){updateUI();lastUI=ts}
  if(ts-autoSave>8000&&!drag){save(false);autoSave=ts}
  // Camera input paints on the next animation frame. Idle scenery retains
  // the lighter cadence; all actor/landscape animation keeps simulation time.
  if(!cartView?.active&&(cameraDirty||panning||sim.golfers.some(g=>g.phase==='swinging')||ts-lastDraw>=32)){
    draw();lastDraw=ts;cameraDirty=false;
  }
  requestAnimationFrame(frame);
}
gameUI=installGameUI({sim,defaultAppearance,drawGolfer,focusDetail,onPanelChange:panel=>{if(panel==='play'&&player())focusPlayer()},toast});
const driveTreeSprites=new Map();
function driveTreeSprite(x,y){
  const key=x+','+y;if(driveTreeSprites.has(key))return driveTreeSprites.get(key);
  const sprite=document.createElement('canvas');sprite.width=128;sprite.height=128;
  const previousContext=ctx,anchor=iso(x,y),scale=64/tileW;
  try{ctx=sprite.getContext('2d');ctx.setTransform(scale,0,0,scale,64-anchor.x*scale,117-anchor.y*scale);drawTree(x,y);}finally{ctx=previousContext;}
  if(driveTreeSprites.size>=384)driveTreeSprites.delete(driveTreeSprites.keys().next().value);
  driveTreeSprites.set(key,sprite);return sprite;
}
cartView=installCartView({sim,treeSprite:driveTreeSprite,toast,onEnter:()=>{gameUI.setPanel('none');gameUI.setControls('none');drag=null;setTool('inspect');},onExit:cart=>{if(cart){camera.zoom=4;geometry();centerOn(cart);}cameraDirty=true;}});
resize();
if(width<590&&sim.playerRound?.status!=='playing'){
  const h=sim.holes.find(h=>h.id===selectedHole);
  if(h){camera.zoom=3*N/48;geometry();centerOn({x:(h.tee.x+h.green.x)/2,y:(h.tee.y+h.green.y)/2})}
}
setTool('inspect');updateUI();requestAnimationFrame(frame);
if(!storageOK)$('saveStatus').textContent='Guardado local no disponible';
