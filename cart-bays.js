import {roadEdgeAllowed,roadNeighbors,ROAD_DIRECTIONS} from './roads.js?v=13';
import {CART_GAP,cartEdgeClear} from './cart-traffic.js?v=13';

const EPS=1e-7,copy=p=>({x:p.x,y:p.y}),key=p=>p.x+','+p.y;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const inClub=(x,y)=>x>=3&&x<=5&&y>=24&&y<=27;
const edgeKey=(a,b)=>key(a)<key(b)?key(a)+'|'+key(b):key(b)+'|'+key(a);
function pointEdgeDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t)}
function roadEdges(tiles){
  const edges=[];for(let y=0;y<tiles.length;y++)for(let x=0;x<tiles[y].length;x++)if(tiles[y][x].type==='path')for(const p of roadNeighbors(tiles,x,y))if(y*tiles.length+x<p.y*tiles.length+p.x)edges.push([{x,y},p]);return edges;
}
function ownTail(tiles,slot,gap){
  const excluded=new Set(),neighbors=roadNeighbors(tiles,slot.x,slot.y);if(neighbors.length!==1)return null;
  const dx=neighbors[0].x-slot.x,dy=neighbors[0].y-slot.y,length=Math.hypot(dx,dy),forward={x:dx/length,y:dy/length};
  const near=new Set([key(slot)]),boundary=new Map(),queue=[slot];
  for(let i=0;i<queue.length;i++)for(const p of roadNeighbors(tiles,queue[i].x,queue[i].y)){
    if(!near.has(key(p))&&(p.x-queue[i].x)*forward.x+(p.y-queue[i].y)*forward.y<=.5)return null;
    excluded.add(edgeKey(queue[i],p));
    if(distance(p,slot)<gap+EPS){if(!near.has(key(p))){near.add(key(p));queue.push(p);}}else boundary.set(key(p),p);
  }
  // An8-direction spur can fan into three adjacent apron cells. Those links
  // are all its own access if the apron remains locally connected without
  // the bay's clearance circle. A short branch on a through-road fails here.
  if(boundary.size>1){
    const start=boundary.values().next().value,seen=new Set([key(start)]),open=[start];
    for(let i=0;i<open.length;i++)for(const p of roadNeighbors(tiles,open[i].x,open[i].y))if(!near.has(key(p))&&!seen.has(key(p))&&distance(p,slot)<=gap+3){seen.add(key(p));open.push(p);}
    if([...boundary.keys()].some(k=>!seen.has(k)))return null;
  }
  return excluded;
}
function clearTerminal(tiles,p,edges,gap){
  const own=tiles[p.y]?.[p.x]?.type==='path'?ownTail(tiles,p,gap):new Set();if(!own)return false;
  return edges.every(([a,b])=>own.has(edgeKey(a,b))||pointEdgeDistance(p,a,b)>=gap+.015);
}
function apply(tiles,points){const result=tiles.slice(),rows=new Set();for(const p of points){if(!rows.has(p.y)){rows.add(p.y);result[p.y]=tiles[p.y].slice();}result[p.y][p.x]={type:'path'};}return result}
function nearestRoad(points,p){let best=Infinity;for(const q of points)best=Math.min(best,distance(p,q));return best}

function branch(tiles,terminal,buildable,reserved,gap){
  if(tiles[terminal.y][terminal.x].type==='path')return [];
  const queue=[],seen=new Map();
  // Two straight final steps keep the bay a real terminal, not an elbow that
  // the eight-direction road graph reconnects diagonally to its own approach.
  for(const [dx,dy]of ROAD_DIRECTIONS){
    const a={x:terminal.x+dx,y:terminal.y+dy},b={x:terminal.x+dx*2,y:terminal.y+dy*2};
    if(!buildable(a.x,a.y)||!buildable(b.x,b.y)||!roadEdgeAllowed(tiles,terminal,a,{requirePath:false})||!roadEdgeAllowed(tiles,a,b,{requirePath:false})||!cartEdgeClear(terminal,a,[],{reserved,gap:gap+.02})||!cartEdgeClear(a,b,[],{reserved,gap:gap+.02}))continue;
    const path=[terminal,a,b],cost=2*Math.hypot(dx,dy);queue.push({p:b,path,cost});seen.set(key(b),cost);
  }
  while(queue.length){
    queue.sort((a,b)=>a.cost-b.cost||a.p.x-b.p.x||a.p.y-b.p.y);const item=queue.shift();
    if(item.cost>6.5||item.path.length>7)continue;
    if(tiles[item.p.y][item.p.x].type==='path'){
      const patches=item.path.filter(p=>tiles[p.y][p.x].type!=='path'),nav=apply(tiles,patches);
      if(roadNeighbors(nav,terminal.x,terminal.y).length!==1)continue;
      let clear=true;for(const p of patches)for(const q of roadNeighbors(nav,p.x,p.y))if(!cartEdgeClear(p,q,[],{reserved,gap:gap+.02}))clear=false;
      if(clear)return patches.map(copy);continue;
    }
    for(const [dx,dy]of ROAD_DIRECTIONS){
      const q={x:item.p.x+dx,y:item.p.y+dy},cost=item.cost+Math.hypot(dx,dy),k=key(q);
      if(!buildable(q.x,q.y)||cost>6.5||cost>=(seen.get(k)??Infinity)-EPS||item.path.some(p=>key(p)===k)||!roadEdgeAllowed(tiles,item.p,q,{requirePath:false})||!cartEdgeClear(item.p,q,[],{reserved,gap:gap+.02}))continue;
      seen.set(k,cost);queue.push({p:q,cost,path:[...item.path,q]});
    }
  }
  return null;
}

/** Small dry spurs; preserve every supplied tile and return only new road cells. */
export function planCartBays(tiles,holes,{allowed=()=>true,preferred=h=>h.tee,gap=CART_GAP,existingBays=[],radius=7,reservedSlots=[],candidateLimit=30}={}){
  if(!Array.isArray(tiles)||!tiles.length)return {patches:[],bays:[]};
  const size=tiles.length,patches=new Map(),bays=[],reserved=reservedSlots.map(copy);let nav=tiles.map(row=>row.slice());
  const worldInfo=new WeakMap(),info=world=>{
    if(worldInfo.has(world))return worldInfo.get(world);
    const roads=[];for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(world[y][x].type==='path')roads.push({x,y});
    const value={edges:roadEdges(world),roads};worldInfo.set(world,value);return value;
  };
  const buildable=(x,y)=>Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<size&&y<size&&!inClub(x,y)&&['grass','tree','path'].includes(tiles[y]?.[x]?.type)&&allowed(x,y);
  const candidates=(h,world)=>{
    const {edges,roads}=info(world),centre=preferred(h)||h.tee,list=[];
    for(let y=Math.max(0,Math.ceil(h.tee.y-radius));y<=Math.min(size-1,Math.floor(h.tee.y+radius));y++)for(let x=Math.max(0,Math.ceil(h.tee.x-radius));x<=Math.min(size-1,Math.floor(h.tee.x+radius));x++){
      const p={x,y};if(!buildable(x,y)||distance(p,h.tee)>radius||reserved.some(q=>distance(p,q)<gap+.02)||!clearTerminal(world,p,edges,gap))continue;
      const reach=world[y][x].type==='path'?0:nearestRoad(roads,p);if(reach>5)continue;
      list.push({p,rank:reach*20+distance(p,centre)+distance(p,h.tee)*.2});
    }
    return list.sort((a,b)=>a.rank-b.rank||a.p.x-b.p.x||a.p.y-b.p.y).slice(0,candidateLimit);
  };
  for(const h of holes||[]){
    const existing=existingBays.find(b=>b.holeId===h.id),{edges}=info(nav);
    if(existing?.slots?.length===2&&existing.slots.every(p=>buildable(p.x,p.y)&&nav[p.y][p.x].type==='path'&&distance(p,h.tee)<=radius&&clearTerminal(nav,p,edges,gap)&&reserved.every(q=>distance(p,q)>=gap+.02))&&distance(...existing.slots)>=gap+.02){bays.push({holeId:h.id,slots:existing.slots.map(copy)});reserved.push(...existing.slots.map(copy));continue;}
    const centre=preferred(h)||h.tee;let best=null;
    const consider=(first,a,second,b)=>{
      const combined=[...new Map([...a,...b].map(p=>[key(p),p])).values()],score=combined.length*100+distance(first.p,centre)+distance(second.p,centre);
      if(best&&score>=best.score)return;
      const otherBays=reserved.filter(p=>key(p)!==key(first.p)&&key(p)!==key(second.p)),final=apply(nav,combined),finalEdges=[...edges],edgeKeys=new Set(edges.map(([a,b])=>edgeKey(a,b)));
      for(const p of combined)for(const q of roadNeighbors(final,p.x,p.y)){
        if(!cartEdgeClear(p,q,[],{reserved:otherBays,gap:gap+.02}))return;
        const k=edgeKey(p,q);if(!edgeKeys.has(k)){edgeKeys.add(k);finalEdges.push([p,q]);}
      }
      if(!clearTerminal(final,first.p,finalEdges,gap)||!clearTerminal(final,second.p,finalEdges,gap))return;
      best={slots:[copy(first.p),copy(second.p)],patches:combined,nav:final,score};
    };
    // Compute each small branch once, then compare compatible pairs. Searching
    // the whole local graph afresh for every pair caused seconds of UI stall.
    const pool=candidates(h,nav).map(candidate=>({...candidate,branch:branch(nav,candidate.p,buildable,reserved,gap)})).filter(c=>c.branch);
    for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++)if(distance(pool[i].p,pool[j].p)>=gap+.02)consider(pool[i],pool[i].branch,pool[j],pool[j].branch);
    // In a tight corner the second spur may need a different approach around
    // the first bay. Only perform that extra graph search if no cached pair fits.
    if(!best)for(const first of pool){
      const intermediate=apply(nav,first.branch);reserved.push(first.p);
      for(const second of candidates(h,intermediate)){
        const b=branch(intermediate,second.p,buildable,reserved,gap);if(b)consider(first,first.branch,second,b);
      }
      reserved.pop();if(best)break;
    }
    if(!best)continue;
    nav=best.nav;for(const p of best.patches)patches.set(key(p),copy(p));bays.push({holeId:h.id,slots:best.slots});reserved.push(...best.slots);
  }
  return {patches:[...patches.values()],bays};
}

/** Six arrivals/return bays around the clubhouse, inside the original32 grid. */
export function planDepotBays(tiles,{allowed=()=>true,gap=CART_GAP,existingSlots=[],reserved=[],root={x:7,y:29}}={}){
  const holes=[1001,1002,1003].map(id=>({id,tee:copy(root)}));
  const existingBays=existingSlots.length===6?holes.map((h,i)=>({holeId:h.id,slots:existingSlots.slice(i*2,i*2+2)})):[];
  const plan=planCartBays(tiles,holes,{allowed:(x,y)=>x<32&&y<32&&allowed(x,y),gap,existingBays,radius:8,candidateLimit:40,reservedSlots:reserved,preferred:()=>({x:10,y:28})});
  // A partial set is useful for a smaller safe queue; never invent extra slots
  // or expose synthetic course ids in the persisted golf-hole metadata.
  return {patches:plan.patches,slots:plan.bays.flatMap(b=>b.slots.map(copy))};
}
