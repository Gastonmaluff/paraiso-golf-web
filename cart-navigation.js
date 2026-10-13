import {roadNeighbors,roadEdgeAllowed,shortestRoadPath} from './roads.js?v=16';
import {chooseCartSlots,cartEdgeClear,CART_GAP} from './cart-traffic.js?v=13';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const copy=p=>({x:p.x,y:p.y});
const inClub=(x,y)=>x>=3&&x<=5&&y>=24&&y<=27;
export const SHOULDER_WIDTH=3.25;
// Navigation-only shoulders. This never paints a path across a fairway.
export function buildCartNetwork(tiles,bridges=[]){
  const size=tiles.length,roads=[],nav=tiles.map(row=>row.map(t=>({...t}))),clearance=new Float32Array(size*size).fill(Infinity);
  for(const b of bridges)for(const p of b.waterCells)nav[p.y][p.x]={type:'path'};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(nav[y][x].type==='path')roads.push({x,y});
  const edges=[];
  for(const a of roads){
    if(tiles[a.y][a.x].type==='water')continue;
    for(const b of roadNeighbors(nav,a.x,a.y))if(b.y*size+b.x>a.y*size+a.x)edges.push([a,b]);
    for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
      const x=a.x+dx,y=a.y+dy;if(!tiles[y]?.[x])continue;
      clearance[y*size+x]=Math.min(clearance[y*size+x],Math.hypot(dx,dy));
    }
  }
  const shoulders=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(['grass','fairway'].includes(tiles[y][x].type)&&!inClub(x,y)&&clearance[y*size+x]<=SHOULDER_WIDTH){nav[y][x]={type:'path'};shoulders.push({x,y});}
  const slots=shoulders.filter(p=>clearance[p.y*size+p.x]>=CART_GAP+.12&&edges.every(([a,b])=>segmentDistance(p,a,b)>=CART_GAP+.08));
  return {nav,roads,slots,clearance};
}
export function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)}
export function cartGroundAllowed(sim,x,y){
  const ix=Math.round(x),iy=Math.round(y),type=sim.tile(x,y)?.type;
  if(!type||inClub(ix,iy))return false;
  if(type==='water')return Boolean(sim.bridgeAt(x,y));
  return type==='path'||['grass','fairway'].includes(type)&&sim.cartNetwork().nav[iy]?.[ix]?.type==='path';
}
export function cartSegmentAllowed(sim,a,b,{body=true}={}){
  const n=Math.max(1,Math.ceil(distance(a,b)/.12));
  for(let i=0;i<=n;i++){
    const t=i/n,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    if(!cartGroundAllowed(sim,p.x,p.y))return false;
    // Keep the body away from hazards; bridge clearance is its narrow deck.
    if(body&&!sim.bridgeAt(p.x,p.y))for(const [dx,dy]of [[.12,0],[-.12,0],[0,.12],[0,-.12]])if(['water','green','tee'].includes(sim.tile(p.x+dx,p.y+dy)?.type))return false;
  }
  return sim._navigationEdge(a,b);
}
export function shoulderPath(sim,from,target,edgeAllowed){
  if(!cartGroundAllowed(sim,from.x,from.y)||!cartGroundAllowed(sim,target.x,target.y))return null;
  const end={x:Math.round(target.x),y:Math.round(target.y)};
  const clear=(p,q)=>cartSegmentAllowed(sim,p,q,{body:false})&&(!edgeAllowed||edgeAllowed(p,q));
  if(!clear(end,target))return null;
  // A stopped cart can be between nodes. Rejoin at either end of its segment,
  // not necessarily the nearest node, which another cart may now occupy.
  const anchors=[...new Set([Math.floor(from.x),Math.ceil(from.x)])].flatMap(x=>[...new Set([Math.floor(from.y),Math.ceil(from.y)])].map(y=>({x,y}))).sort((a,b)=>distance(a,from)-distance(b,from));
  for(const start of anchors){
    if(!clear(from,start))continue;
    const result=shortestRoadPath(sim.cartNetwork().nav,start,end,{
      edgeAllowed:clear,
      weight:(p,q)=>sim.cartRoadAt(p.x,p.y)&&sim.cartRoadAt(q.x,q.y)?1:2.2
    });
    if(!result)continue;
    if(distance(from,start)>.001)result.unshift(start);
    if(!result.length||distance(result.at(-1),target)>.001)result.push(copy(target));
    return result;
  }
  return null;
}
export function shoulderParking(sim,anchor,exceptIds=[]){
  // Rank by actual walk afterwards in the engine. Slots do not occupy the lane.
  const candidates=sim.cartNetwork().slots.filter(p=>distance(p,anchor)<13).sort((a,b)=>distance(a,anchor)-distance(b,anchor)).slice(0,48);
  const own=exceptIds.map(id=>sim.carts.find(c=>c.id===id)).filter(Boolean);
  for(let attempt=0;attempt<24;attempt++){
    const pair=chooseCartSlots(candidates,sim.carts,{origin:anchor,exceptIds});if(pair.length<2)return [];
    let bad=-1;
    for(let i=0;i<2;i++){
      const start=own[i]||sim.cartNetwork().roads.reduce((a,b)=>distance(a,pair[i])<distance(b,pair[i])?a:b);
      const path=shoulderPath(sim,start,pair[i],(a,b)=>cartEdgeClear(a,b,sim.carts,{exceptIds,reserved:[pair[1-i]]}));
      const length=path=>{let from=start;return path.reduce((sum,p)=>{const v=distance(from,p);from=p;return sum+v;},0)};
      const baseline=path&&shoulderPath(sim,start,pair[i]);
      if(!path||baseline&&length(path)>length(baseline)*1.5+8){bad=1-i;break;}
    }
    if(bad<0)return pair;
    const index=candidates.findIndex(p=>distance(p,pair[bad])<.001);candidates.splice(index,1);
  }
  return [];
}

/** Remove only terminal parking spurs, leaving the shared circuit untouched. */
export function trimParkingSpurs(sim){
  const protectedPoints=[...sim.depotBays,...sim.carts.flatMap(c=>[c,c._target,...(c._path?.slice(c._pathIndex,c._pathIndex+2)||[])]),...(sim.coursePlan?.routeFeatures||[]).flatMap(f=>f.points)];
  const proposals=new Map(),nav=sim.navigationTiles();
  for(const bay of sim.cartBays)for(const slot of bay.slots){
    let p=slot,previous=null;const tail=[];
    for(let i=0;i<5;i++){
      if(protectedPoints.some(q=>q&&distance(p,q)<1.5))break;
      const neighbors=roadNeighbors(nav,p.x,p.y).filter(q=>!previous||distance(q,previous)>.01);
      if(neighbors.length!==1)break;
      tail.push(copy(p));previous=p;p=neighbors[0];
    }
    // A short grass spur must still have a connection to the unchanged trunk.
    for(const q of tail.slice(0,2))proposals.set(q.x+','+q.y,q);
  }
  const removed=[];
  for(const p of proposals.values())if(sim.tile(p.x,p.y)?.type==='path'){sim.tiles[p.y][p.x]={type:'grass'};removed.push(p);}
  sim._pruneCartBays();sim.invalidateCartNetwork();
  return removed;
}
