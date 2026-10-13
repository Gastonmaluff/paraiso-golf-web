import {roadNeighbors} from './roads.js?v=13';

// World cells, independent of zoom. The cart is about38/56 cells long;
// this larger centre clearance also keeps the projected canopies apart.
export const CART_GAP=1.65;
const EPS=1e-7;
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const copy=p=>({x:p.x,y:p.y});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const rank=c=>Number.isSafeInteger(c.id)?c.id:Number.MAX_SAFE_INTEGER;
const active=c=>['driving','blocked'].includes(c.phase);
function originTravel(c){
  const path=c._path,index=c._pathIndex||0;
  if(!path?.length)return 0;
  if(index===0)return -distance(c,path[0]);
  let length=distance(path[Math.min(index-1,path.length-1)],c);
  for(let i=1;i<Math.min(index,path.length);i++)length+=distance(path[i-1],path[i]);
  return length;
}

function route(c,horizon=Infinity,next){
  const result=[copy(c)],pending=c._path?.slice(c._pathIndex||0)||[];
  if(next&&(!pending.length||distance(next,pending[0])>EPS))pending.unshift(next);
  if(!next&&!active(c))return result;
  let remaining=horizon;
  for(const p of pending){
    if(!point(p))continue;const last=result.at(-1),d=distance(last,p);if(d<EPS)continue;
    if(d>=remaining){result.push({x:last.x+(p.x-last.x)*remaining/d,y:last.y+(p.y-last.y)*remaining/d});break}
    result.push(copy(p));remaining-=d;
  }
  return result;
}
function segmentCross(a,b,c,d){
  const u=subtract(b,a),v=subtract(d,c),offset=subtract(c,a),den=cross(u,v),uu=u.x*u.x+u.y*u.y;
  if(Math.abs(den)>EPS){const t=cross(offset,v)/den,s=cross(offset,u)/den;if(t>=-EPS&&t<=1+EPS&&s>=-EPS&&s<=1+EPS)return {point:{x:a.x+u.x*t,y:a.y+u.y*t},headOn:false};return null}
  if(Math.abs(cross(offset,u))>EPS||uu<EPS||(u.x*v.x+u.y*v.y)>=0)return null;
  const t0=(offset.x*u.x+offset.y*u.y)/uu,t1=t0+(v.x*u.x+v.y*u.y)/uu,low=Math.max(0,Math.min(t0,t1)),high=Math.min(1,Math.max(t0,t1));
  if(high<low-EPS)return null;const t=(low+high)/2;return {point:{x:a.x+u.x*t,y:a.y+u.y*t},headOn:true};
}
function conflictOnRoutes(a,b,ra,rb,gap){
  let best=null,da=0;
  for(let i=1;i<ra.length;i++){
    let db=0;
    for(let j=1;j<rb.length;j++){
      const hit=segmentCross(ra[i-1],ra[i],rb[j-1],rb[j]);
      if(hit){const distanceA=da+distance(ra[i-1],hit.point),distanceB=db+distance(rb[j-1],hit.point),score=distanceA+distanceB;
        if(!best||score<best.score-EPS||Math.abs(score-best.score)<EPS&&(hit.point.x<best.point.x-EPS||Math.abs(hit.point.x-best.point.x)<EPS&&hit.point.y<best.point.y))best={...hit,distanceA,distanceB,score};
      }db+=distance(rb[j-1],rb[j]);
    }da+=distance(ra[i-1],ra[i]);
  }
  if(!best)return null;
  const enteredA=distance(a,best.point)<gap-.05,enteredB=distance(b,best.point)<gap-.05;
  // A stable id alone can hold the cart already nearest a merge while it
  // physically blocks the nominal winner. Let that nearer cart clear first.
  const arrivalA=best.distanceA+originTravel(a),arrivalB=best.distanceB+originTravel(b);
  const winner=enteredA!==enteredB?(enteredA?a:b):Math.abs(arrivalA-arrivalB)>.025?(arrivalA<arrivalB?a:b):(rank(a)<rank(b)?a:b);
  return {point:best.point,headOn:best.headOn,distanceA:best.distanceA,distanceB:best.distanceB,winnerId:winner.id};
}

function capsuleEntry(p,u,length,a,b,radius){
  const v=subtract(b,a),vv=v.x*v.x+v.y*v.y;
  if(segmentDistance(p,a,b)<radius-EPS)return 0;
  let entry=Infinity;
  for(const q of [a,b]){const r=subtract(p,q),dot=r.x*u.x+r.y*u.y,disc=dot*dot-r.x*r.x-r.y*r.y+radius*radius;if(dot<0&&disc>=0)entry=Math.min(entry,Math.max(0,-dot-Math.sqrt(disc)));}
  if(vv>EPS){
    const size=Math.sqrt(vv),normal={x:-v.y/size,y:v.x/size},offset=subtract(p,a);
    let low=0,high=length;
    const intersect=(start,slope,min,max)=>{if(Math.abs(slope)<EPS){if(start<min||start>max)high=-1;return;}const first=(min-start)/slope,last=(max-start)/slope;low=Math.max(low,Math.min(first,last));high=Math.min(high,Math.max(first,last));};
    intersect(offset.x*normal.x+offset.y*normal.y,u.x*normal.x+u.y*normal.y,-radius,radius);
    intersect((offset.x*v.x+offset.y*v.y)/vv,(u.x*v.x+u.y*v.y)/vv,0,1);
    if(low<=high&&high>=0)entry=Math.min(entry,Math.max(0,low));
  }
  return entry<=length?entry:Infinity;
}

/** Remaining-route conflict, also usable to reserve a narrow bridge before entry. */
export function cartConflict(a,b,{horizon=Infinity,gap=CART_GAP}={}){
  if(!point(a)||!point(b)||a.id===b.id||!active(a)||!active(b))return null;
  return conflictOnRoutes(a,b,route(a,horizon),route(b,horizon),gap);
}

/** Clip one continuous segment BEFORE the engine's waypoint/destination snap. */
export function cartAdvanceLimit(cart,next,requested,carts,{gap=CART_GAP,lookAhead=gap*5}={}){
  const result={advance:0,reason:null,blockerId:null,yieldTo:null,conflictPoint:null};
  if(!point(cart)||!point(next)||!Number.isFinite(requested)||requested<=0)return result;
  const d=distance(cart,next);if(d<EPS)return result;
  const u={x:(next.x-cart.x)/d,y:(next.y-cart.y)/d};result.advance=Math.min(d,requested);
  const ownRoute=lookAhead>0?route(cart,lookAhead,next):null;
  let oncoming=null;
  const restrict=(advance,other,reason,conflict=null)=>{if(advance<result.advance-EPS){result.advance=Math.max(0,advance);result.reason=reason;result.blockerId=other.id;result.yieldTo=conflict?.headOn?other.id:null;result.conflictPoint=conflict?.point||null}};
  for(const other of [...(carts||[])].filter(c=>point(c)&&c.id!==cart.id).sort((a,b)=>rank(a)-rank(b))){
    const r=subtract(cart,other),r2=r.x*r.x+r.y*r.y,dot=r.x*u.x+r.y*u.y;
    if(r2<gap*gap-EPS){
      // A legacy save may already overlap. Permit only separation, and let one
      // deterministic driver leave a coincident origin; never push/teleport.
      if(dot<-EPS||r2<EPS&&active(other)&&rank(cart)>rank(other))restrict(0,other,'overlap');
    }else if(dot<0){const discriminant=dot*dot-r2+gap*gap;if(discriminant>=0)restrict(-dot-Math.sqrt(discriminant)-EPS,other,'occupied')}
    if(ownRoute&&active(other)){
      const otherRoute=route(other,lookAhead),conflict=conflictOnRoutes(cart,other,ownRoute,otherRoute,gap);
      if(conflict&&conflict.winnerId!==cart.id){
        // At an acute merge, stopping merely gap cells before the shared node
        // still blocks the winner's diagonal approach. Reserve its swept road
        // corridor, including both sides of each bend, before entering it.
        let clearance=Infinity;
        for(let i=1;i<otherRoute.length;i++)clearance=Math.min(clearance,capsuleEntry(cart,u,Math.min(d,requested),otherRoute[i-1],otherRoute[i],gap+.025));
        restrict(clearance-EPS,other,conflict.headOn?'oncoming':'yield',conflict);
        // The occupied-circle brake may already be stricter. Preserve the
        // oncoming reservation so the engine can still seek a real pull-off.
        if(conflict.headOn&&!oncoming)oncoming={id:other.id,point:conflict.point};
      }
    }
  }
  if(oncoming&&result.advance<Math.min(d,requested)-EPS){result.yieldTo=oncoming.id;result.conflictPoint=oncoming.point;}
  return result;
}

/** A bay/origin must be free now AND not promised to another moving cart. */
export function cartSlotAvailable(p,carts,{gap=CART_GAP,exceptIds=[],includeTargets=true,reserved=[]}={}){
  if(!point(p))return false;
  for(const c of carts||[]){if(exceptIds.includes(c.id))continue;if(point(c)&&distance(p,c)<gap-EPS)return false;if(includeTargets&&active(c)&&point(c._target)&&distance(p,c._target)<gap-EPS)return false}
  return reserved.every(q=>!point(q)||distance(p,q)>=gap-EPS);
}
/** Find a separated pair, not just two different cells. No partial allocation. */
export function chooseCartSlots(candidates,carts,{count=2,gap=CART_GAP,origin,exceptIds=[],reserved=[]}={}){
  if(!Number.isInteger(count)||count<1||count>4)return [];
  const unique=new Map();for(const p of candidates||[])if(point(p)&&cartSlotAvailable(p,carts,{gap,exceptIds,reserved}))unique.set(p.x+','+p.y,copy(p));
  const list=[...unique.values()].sort((a,b)=>(origin?distance(a,origin)-distance(b,origin):0)||a.x-b.x||a.y-b.y);
  let best=null,bestScore=Infinity;
  const visit=(start,selected,score)=>{
    if(selected.length===count){if(score<bestScore-EPS){best=selected.map(copy);bestScore=score}return}
    for(let i=start;i<=list.length-(count-selected.length);i++){
      const p=list[i],cost=origin?distance(p,origin):i;
      if(score+cost>=bestScore||selected.some(q=>distance(p,q)<gap-EPS))continue;
      visit(i+1,[...selected,p],score+cost);
    }
  };
  visit(0,[],0);return best||[];
}

function segmentDistance(p,a,b){const u=subtract(b,a),d=u.x*u.x+u.y*u.y,t=d?Math.max(0,Math.min(1,((p.x-a.x)*u.x+(p.y-a.y)*u.y)/d)):0;return distance(p,{x:a.x+u.x*t,y:a.y+u.y*t})}
/** Dynamic graph clearance; include the whole edge, not only its end nodes. */
export function cartEdgeClear(from,to,carts,{gap=CART_GAP,exceptIds=[],includeTargets=true,includeMoving=false,reserved=[]}={}){
  if(!point(from)||!point(to))return false;
  for(const c of carts||[]){
    if(exceptIds.includes(c.id))continue;
    if(point(c)&&(includeMoving||!active(c))&&segmentDistance(c,from,to)<gap-EPS)return false;
    if(includeTargets&&point(c._target)&&segmentDistance(c._target,from,to)<gap-EPS)return false;
  }
  return reserved.every(p=>!point(p)||segmentDistance(p,from,to)>=gap-EPS);
}
/** Propose a real road pull-off. Null means no legal retreat: ask for a free road. */
export function findCartYieldRoute(tiles,cart,winner,carts,{gap=CART_GAP,maxDistance=8,neighbors=(x,y)=>roadNeighbors(tiles,x,y),isRoad=p=>tiles[p.y]?.[p.x]?.type==='path'}={}){
  if(!point(cart)||!point(winner)||!Array.isArray(tiles))return null;
  const winnerRoute=route(winner),anchors=[];
  // Retreating past the winner's destination on the SAME single lane is not
  // a passing bay: the parked winner would still trap the yielding cart.
  if(winnerRoute.length>1){const a=winnerRoute.at(-2),b=winnerRoute.at(-1),d=distance(a,b);winnerRoute.push({x:b.x+(b.x-a.x)*maxDistance/d,y:b.y+(b.y-a.y)*maxDistance/d})}
  if(Number.isInteger(cart.x)&&Number.isInteger(cart.y))anchors.push(copy(cart));
  else{
    const next=cart._path?.[cart._pathIndex||0];
    if(point(next)){anchors.push({x:next.x+Math.sign(cart.x-next.x),y:next.y+Math.sign(cart.y-next.y)},copy(next))}
  }
  const queue=[],seen=new Map();
  for(const p of anchors){if(!isRoad(p))continue;const d=distance(cart,p);if(d>EPS&&cartAdvanceLimit(cart,p,d,carts,{gap,lookAhead:0}).advance<d-EPS)continue;queue.push({p,cost:d,path:d>EPS?[p]:[]});seen.set(p.x+','+p.y,d)}
  while(queue.length){
    queue.sort((a,b)=>a.cost-b.cost||a.p.x-b.p.x||a.p.y-b.p.y);const item=queue.shift();if(item.cost>maxDistance)continue;
    const outside=winnerRoute.length>1?winnerRoute.slice(1).every((p,i)=>segmentDistance(item.p,winnerRoute[i],p)>=gap+.05):distance(item.p,winner)>=gap+.05;
    if(item.path.length&&outside&&cartSlotAvailable(item.p,carts,{gap:gap+.05,exceptIds:[cart.id]}))return item.path.map(copy);
    for(const p of neighbors(item.p.x,item.p.y)){
      const d=distance(item.p,p),cost=item.cost+d,key=p.x+','+p.y;if(cost>maxDistance||cost>=(seen.get(key)??Infinity)-EPS)continue;
      if(cartAdvanceLimit({...cart,...item.p},p,d,carts,{gap,lookAhead:0}).advance<d-EPS)continue;
      seen.set(key,cost);queue.push({p,cost,path:[...item.path,p]});
    }
  }
  return null;
}
