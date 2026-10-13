const CARDINAL=[[1,0],[-1,0],[0,1],[0,-1]];
const key=p=>p.x+','+p.y;
const point=key=>{const [x,y]=key.split(',').map(Number);return {x,y}};
const centre=feature=>feature?.center||feature;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

function inside(p,polygon){
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
}
function segmentDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
const axisDistance=(p,h)=>Math.min(...h.axis.slice(1).map((b,i)=>segmentDistance(p,h.axis[i],b)));
const polygonDistance=(p,polygon)=>inside(p,polygon)?0:Math.min(...polygon.map((a,i)=>segmentDistance(p,a,polygon[(i+1)%polygon.length])));

function components(mask){
  const todo=new Set(mask),ids=new Map();let id=0;
  while(todo.size){
    const first=todo.values().next().value,stack=[first];todo.delete(first);id++;
    while(stack.length){
      const k=stack.pop(),p=point(k);ids.set(k,id);
      for(const [dx,dy]of CARDINAL){const next=key({x:p.x+dx,y:p.y+dy});if(todo.delete(next))stack.push(next)}
    }
  }
  return ids;
}

// Sampling only splits the axis into dry runs; it never paints across a lake.
function dryRuns(tiles,axis){
  const runs=[];let run=[],last='';
  for(let i=1;i<axis.length;i++){
    const a=axis[i-1],b=axis[i],steps=Math.max(1,Math.ceil(distance(a,b)/.15));
    for(let j=0;j<=steps;j++){
      const t=j/steps,p={x:Math.round(a.x+(b.x-a.x)*t),y:Math.round(a.y+(b.y-a.y)*t)},k=key(p);
      if(k===last)continue;last=k;
      const tile=tiles[p.y]?.[p.x];
      if(!tile||tile.type==='water'){if(run.length)runs.push(run);run=[]}else run.push(p);
    }
  }
  if(run.length)runs.push(run);return runs;
}

/** Repair short raster gaps, using the same cells the renderer and physics use.
 * Call on a newly generated field before adding trees. Existing terrain types,
 * water crossings and the rough separator between fairways 7/8 are preserved.
 * At a shore pinch a nonessential outer edge of the sibling fairway may become
 * rough, if its entire remaining component and protected endpoints stay intact.
 * A blocked repair is reported, rather than widening or routing around hazards.
 */
export function unifyFairways(tiles,plan){
  const holes=plan.holes,reach=Math.SQRT1_2+1e-9,owned=new Map();
  const report={added:0,addedCells:[],trimmed:0,trimmedCells:[],unresolved:[],margin:'estimated_raster_separator'};
  const nearestHole=p=>{
    // The generator assigns a contained cell to its polygon, even if another
    // nearby axis is closer. Preserve that ownership at the narrow 7/8 strip.
    const contained=holes.find(h=>inside(p,h.fairwayPolygon));if(contained)return contained;
    return holes.filter(h=>polygonDistance(p,h.fairwayPolygon)<=reach)
      .sort((a,b)=>axisDistance(p,a)-axisDistance(p,b)||a.id-b.id)[0];
  };
  const endpointOwner=(p,type)=>holes.filter(h=>{
    const feature=h[type],c=centre(feature);if(!c)return false;
    return key({x:Math.round(c.x),y:Math.round(c.y)})===key(p)||feature.polygon&&inside(p,feature.polygon);
  }).sort((a,b)=>distance(p,centre(a[type]))-distance(p,centre(b[type]))||a.id-b.id)[0];
  for(const h of holes)owned.set(h.id,new Set());
  for(let y=0;y<tiles.length;y++)for(let x=0;x<tiles[y].length;x++){
    const p={x,y},type=tiles[y][x].type;
    const h=type==='fairway'?nearestHole(p):type==='tee'||type==='green'?endpointOwner(p,type):null;
    if(h)owned.get(h.id).add(key(p));
  }
  for(const h of holes){
    const mask=owned.get(h.id),other=owned.get(h.id===7?8:h.id===8?7:null);
    const preservesSibling=trim=>{
      if(!other||!trim.size)return true;
      const before=components(other),after=components(new Set([...other].filter(k=>!trim.has(k)))),groups=new Map();
      for(const id of before.values())if(!groups.has(id))groups.set(id,new Set());
      for(const [k,id]of before)if(!trim.has(k))groups.get(id).add(after.get(k));
      return [...groups.values()].every(ids=>ids.size===1&&!ids.has(undefined));
    };
    const canAdd=(p,trim)=>{
      if(tiles[p.y]?.[p.x]?.type!=='grass'||polygonDistance(p,h.fairwayPolygon)>reach)return null;
      // A centre or footprint belonging to somebody else's tee/green is not a bridge.
      for(const foreign of holes)if(foreign.id!==h.id)for(const kind of ['tee','green']){
        const f=foreign[kind],c=centre(f);if(!c)continue;
        if(key({x:Math.round(c.x),y:Math.round(c.y)})===key(p)||f.polygon&&inside(p,f.polygon))return null;
      }
      const nextTrim=new Set(trim);
      if(other){
        const sibling=holes.find(q=>q.id===(h.id===7?8:7));
        if(inside(p,sibling.fairwayPolygon)||other.has(key(p)))return null;
        for(const [dx,dy]of CARDINAL){
          const q={x:p.x+dx,y:p.y+dy},k=key(q);if(!other.has(k)||nextTrim.has(k))continue;
          if(tiles[q.y]?.[q.x]?.type!=='fairway')return null;
          for(const kind of ['tee','green']){
            const c=centre(sibling[kind]);if(c&&key({x:Math.round(c.x),y:Math.round(c.y)})===k)return null;
          }
          nextTrim.add(k);
        }
        if(nextTrim.size>3||!preservesSibling(nextTrim))return null;
      }
      return nextTrim;
    };
    const closest=p=>{
      let best=null,score=Infinity;
      for(const k of mask){const q=point(k),d=distance(p,q);if(d<=1.45&&(d<score||d===score&&k<key(best))){best=q;score=d}}
      return best;
    };
    const bridge=(a,b)=>{
      // Up to three new cells join a local pinch, never a long speculative ribbon.
      const direct=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);if(direct>6)return null;
      const maxSteps=Math.min(8,direct+2),queue=[{p:a,path:[a],add:0,trim:new Set(),cost:0}],seen=new Map();
      while(queue.length){
        queue.sort((a,b)=>a.cost-b.cost);const state=queue.shift(),steps=state.path.length-1;
        if(key(state.p)===key(b))return {points:state.path,trim:state.trim};
        if(steps>=maxSteps)continue;
        for(const [dx,dy]of CARDINAL){
          const p={x:state.p.x+dx,y:state.p.y+dy},k=key(p),existing=mask.has(k);
          const trim=existing?state.trim:canAdd(p,state.trim);
          if(!trim||segmentDistance(p,a,b)>1.5||state.path.some(q=>key(q)===k))continue;
          const add=state.add+(existing?0:1);if(add>3)continue;
          const cost=state.cost+(existing?1:100+axisDistance(p,h)*4+polygonDistance(p,h.fairwayPolygon)*4+(trim.size-state.trim.size)*25),stamp=k+','+(steps+1)+','+add+','+[...trim].sort().join('|');
          if((seen.get(stamp)??Infinity)<=cost)continue;seen.set(stamp,cost);
          queue.push({p,path:[...state.path,p],add,trim,cost});
        }
      }
      return null;
    };
    const apply=path=>{
      for(const k of path.trim){
        const p=point(k);tiles[p.y][p.x]={...tiles[p.y][p.x],type:'grass'};other.delete(k);
        report.trimmed++;report.trimmedCells.push({...p,holeId:h.id===7?8:7,reason:'keep_7_8_rough_separator',approx:true});
      }
      for(const p of path.points)if(!mask.has(key(p))){
        tiles[p.y][p.x]={...tiles[p.y][p.x],type:'fairway'};mask.add(key(p));
        report.added++;report.addedCells.push({...p,holeId:h.id});
      }
    };
    // A rounded coast sample can hit water although the source band has a dry
    // diagonal corner beside it. Both original cells must be inside the source
    // polygon and the bridge must touch that band within half a cell diagonal.
    // Never force an off-polygon tee across a natural rough gap.
    let ids=components(mask);
    for(const k of [...mask]){
      const a=point(k);if(polygonDistance(a,h.fairwayPolygon)>1e-8)continue;
      for(const [dx,dy]of [[1,1],[1,-1]]){
        const b={x:a.x+dx,y:a.y+dy};
        if(!mask.has(key(b))||ids.get(k)===ids.get(key(b))||polygonDistance(b,h.fairwayPolygon)>1e-8)continue;
        const path=bridge(a,b);if(path){apply(path);ids=components(mask)}
      }
    }
    const failures=new Set();
    for(const run of dryRuns(tiles,h.axis)){
      let previous=null;ids=components(mask);
      for(const sample of run){
        const next=closest(sample);if(!next)continue;
        if(previous&&ids.get(key(previous))!==ids.get(key(next))){
          const path=bridge(previous,next);
          if(path){
            apply(path);
            ids=components(mask);
          }else{
            const failure=key(previous)+'>'+key(next);
            if(!failures.has(failure)){failures.add(failure);report.unresolved.push({holeId:h.id,from:{...previous},to:{...next},reason:'no_local_dry_bridge'})}
          }
        }
        previous=next;
      }
    }
  }
  return report;
}
