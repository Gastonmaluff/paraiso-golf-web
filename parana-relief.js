// Revision 3 is a relative design from Gastón's description, not surveyed heights.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};
const key=p=>p.x+','+p.y;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function inside(p,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes}return yes}
function segment(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/d,0,1):0;const q={x:a.x+dx*t,y:a.y+dy*t};return {point:q,t,distance:distance(p,q),length:Math.sqrt(d),tangent:{x:dx/Math.sqrt(d),y:dy/Math.sqrt(d)}}}
const polygonDistance=(p,poly)=>inside(p,poly)?0:Math.min(...poly.map((a,i)=>segment(p,a,poly[(i+1)%poly.length]).distance));
export function paranaAxisFrame(hole,p){
  const lengths=hole.axis.slice(1).map((b,i)=>distance(hole.axis[i],b)),total=lengths.reduce((a,b)=>a+b,0);let walked=0,best=null;
  for(let i=1;i<hole.axis.length;i++){
    const f=segment(p,hole.axis[i-1],hole.axis[i]);
    if(!best||f.distance<best.distance){const left={x:f.tangent.y,y:-f.tangent.x};best={...f,left,side:(p.x-f.point.x)*left.x+(p.y-f.point.y)*left.y,progress:(walked+f.t*lengths[i-1])/total}}
    walked+=lengths[i-1];
  }return best;
}
const endpointCells=(h,kind)=>{const p=h[kind].center,result=[];for(let y=Math.floor(p.y);y<=Math.ceil(p.y);y++)for(let x=Math.floor(p.x);x<=Math.ceil(p.x);x++)result.push({x,y});return result};

export function createParanaRevision3Infrastructure(tiles,plan){
  const n=tiles.length,holes=plan.holes,byId=id=>holes.find(h=>h.id===id);
  const clear=p=>tiles[p.y]?.[p.x]&&['grass','path'].includes(tiles[p.y][p.x].type)&&!holes.some(h=>[h.fairwayPolygon,h.tee.polygon,h.green.polygon].some(poly=>polygonDistance(p,poly)<.25));
  const closestSafe=(p,ids)=>ids.map(id=>paranaAxisFrame(byId(id),p)).sort((a,b)=>a.distance-b.distance)[0];
  const snap=(p,ids=[])=>{
    const candidates=[];for(let y=Math.round(p.y)-2;y<=Math.round(p.y)+2;y++)for(let x=Math.round(p.x)-2;x<=Math.round(p.x)+2;x++){const q={x,y};if(clear(q)&&(!ids.length||closestSafe(q,ids).side>=1))candidates.push(q)}
    return candidates.sort((a,b)=>distance(a,p)-distance(b,p)||a.y-b.y||a.x-b.x)[0];
  };
  const path=(from,to,ids=[])=>{
    if(!from||!to)return null;const minX=Math.max(0,Math.min(from.x,to.x)-4),maxX=Math.min(n-1,Math.max(from.x,to.x)+4),minY=Math.max(0,Math.min(from.y,to.y)-4),maxY=Math.min(n-1,Math.max(from.y,to.y)+4);
    const queue=[{p:from,cost:0}],costs=new Map([[key(from),0]]),previous=new Map(),allow=p=>p.x>=minX&&p.x<=maxX&&p.y>=minY&&p.y<=maxY&&clear(p)&&(!ids.length||closestSafe(p,ids).side>=1);
    while(queue.length){
      queue.sort((a,b)=>a.cost-b.cost);const current=queue.shift(),k=key(current.p);if(current.cost!==costs.get(k))continue;if(k===key(to))break;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){
        const p={x:current.p.x+dx,y:current.p.y+dy};if(!allow(p)||dx&&dy&&(!allow({x:p.x,y:current.p.y})||!allow({x:current.p.x,y:p.y})))continue;
        const next=key(p),deviation=segment(p,from,to).distance,cost=current.cost+Math.hypot(dx,dy)*(1+deviation*.2);
        if(cost<(costs.get(next)??Infinity)){costs.set(next,cost);previous.set(next,current.p);queue.push({p,cost})}
      }
    }
    if(!costs.has(key(to)))return null;const result=[to];for(let p=to;key(p)!==key(from);){p=previous.get(key(p));if(!p)return null;result.push(p)}return result.reverse();
  };
  const features=[],addFeature=(id,holeIds,anchors,ids=[],side='dry_land')=>{
    let points=[];for(let i=1;i<anchors.length;i++){
      const part=path(anchors[i-1],anchors[i],ids);if(!part){plan.conflicts.push({kind:'revision3_road_blocked',routeId:id,from:anchors[i-1]||null,to:anchors[i]||null});return null}
      points.push(...(i===1?part:part.slice(1)));
    }
    const unique=[...new Map(points.map(p=>[key(p),p])).values()];for(const p of unique)tiles[p.y][p.x]={type:'path'};
    const feature={id,holeIds,points,rasterCells:unique,side,estimated:true,widthCells:.18,provenance:'user_described_side_approximate_alignment'};features.push(feature);return feature;
  };
  const anchors=[];
  for(const id of [5,6]){const h=byId(id);for(let i=0;i<h.axis.length;i++){
    const a=h.axis[Math.max(0,i-1)],b=h.axis[Math.min(h.axis.length-1,i+1)],length=distance(a,b),left={x:(b.y-a.y)/length,y:-(b.x-a.x)/length};
    anchors.push(snap({x:h.axis[i].x+left.x*2.3,y:h.axis[i].y+left.y*2.3},[5,6]));
  }}
  const sideRoad=addFeature('h5_h6_dry_side_road',[5,6],anchors,[5,6],'source_image_right');
  // The bridge is an explicit overlay; underlying water cells remain water.
  const east=plan.water.find(w=>w.id==='east_lagoon'),ys=east.polygon.map(p=>p.y),bridgeOptions=[];
  for(let y=Math.ceil(Math.min(...ys));y<=Math.floor(Math.max(...ys));y++)for(let x=1;x<n-1;x++)if(tiles[y][x].type==='water'&&inside({x,y},east.polygon)&&tiles[y][x-1].type!=='water'){
    let end=x;while(end<n&&tiles[y][end].type==='water')end++;
    const from={x:x-1,y},to={x:end,y};if(end-x>5||!clear(from)||!clear(to))continue;
    const waterCells=Array.from({length:end-x},(_,i)=>({x:x+i,y}));
    bridgeOptions.push({from,to,waterCells,cost:distance(byId(6).green.center,to)+distance(byId(7).tee.center,from)+end-x+1});
  }
  const choice=bridgeOptions.sort((a,b)=>a.cost-b.cost||a.from.y-b.from.y)[0];plan.bridges=[];
  if(choice){
    const bridge={id:'green6_tee7_bridge',waterId:east.id,holeIds:[6,7],from:choice.from,to:choice.to,points:[choice.from,...choice.waterCells,choice.to],waterCells:choice.waterCells,widthCells:.5,deckHeight:5.6,estimated:true,
      provenance:{source:'user_confirmation_2026-10-12',placement:'approximate_existing_east_lagoon',height:'relative_design_not_surveyed'}};
    plan.bridges.push(bridge);
    if(sideRoad)addFeature('h6_bridge_east_approach',[6,7],[sideRoad.points.at(-1),bridge.to]);
    const nearWest=[{x:bridge.from.x,y:bridge.from.y-1},bridge.from,{x:bridge.from.x,y:bridge.from.y+1}].filter(clear);
    if(nearWest.length>1)addFeature('bridge_tee7_west_approach',[6,7],nearWest);
    const transfer=plan.transfers.find(t=>t.fromGreenId===6&&t.toTeeId===7);
    if(transfer){transfer.mode='walk_bridge';transfer.bridgeId=bridge.id;transfer.route=[{...byId(6).green.center},...bridge.points.slice().reverse(),{...byId(7).tee.center}];transfer.humanConfirmedBridge=true}
  }else plan.conflicts.push({kind:'revision3_no_dry_bridge_banks',waterId:'east_lagoon'});
  plan.routeFeatures=features;
  plan.provenance.humanRoutingCorrections=plan.provenance.humanRoutingCorrections.filter(t=>t.fromGreenId!==6);
  plan.provenance.humanRoutingCorrections.push({fromGreenId:6,toTeeId:7,mode:'walk_bridge',near:true,source:'user_confirmation_2026-10-12'});
  plan.uncertainties=plan.uncertainties.filter(s=>!s.includes('Gastón confirmó G2→T3 y G6→T7'));
  plan.uncertainties.push('Gastón confirmó G2→T3 como una conexión corta a pie; se conservan los centros aproximados del paquete.');
  plan.uncertainties.push('Gastón confirmó un puente pequeño entre G6 y T7. El cruce se aproxima sobre la laguna existente; su ubicación exacta, longitud y cota no están medidas. El camino de H5/H6 sigue el lado seco derecho del plano sin ocupar calles.');
}

export function applyParanaRevision3Relief(tiles,elevations,plan){
  const datum=8,byId=id=>plan.holes.find(h=>h.id===id),models=[{id:2,tee:1.5,green:6,cross:0,radius:2.5},{id:3,tee:7.4,green:6.6,cross:1.1,radius:4},{id:5,tee:8,green:7,cross:1.1,radius:4}];
  for(let y=0;y<tiles.length;y++)for(let x=0;x<tiles[y].length;x++){
    const p={x,y};if(tiles[y][x].type==='water'){elevations[y][x]=0;continue}
    const shore=Math.min(...plan.water.map(w=>polygonDistance(p,w.polygon))),bank=datum*smooth(shore/2.4);let height=bank;
    for(const m of models){const f=paranaAxisFrame(byId(m.id),p),weight=1-smooth((f.distance-1.3)/(m.radius-1.3)),target=m.tee+(m.green-m.tee)*f.progress+m.cross*clamp(f.side,-3,3);height=height*(1-weight)+Math.min(bank,target)*weight}
    for(const id of [1,4])if(paranaAxisFrame(byId(id),p).distance<1.3||[byId(id).tee.polygon,byId(id).green.polygon].some(poly=>inside(p,poly)))height=datum;
    elevations[y][x]=Math.round(clamp(height,0,12)*1000)/1000;
  }
  // Gentle greens/tees keep the lake-bank step outside the putting surface.
  for(const m of models)for(const kind of ['tee','green']){
    const h=byId(m.id),c=h[kind].center,level=kind==='tee'?m.tee:m.green;
    for(let y=Math.max(0,Math.floor(c.y)-1);y<=Math.min(tiles.length-1,Math.ceil(c.y)+1);y++)for(let x=Math.max(0,Math.floor(c.x)-1);x<=Math.min(tiles.length-1,Math.ceil(c.x)+1);x++){
      if(tiles[y][x].type==='water'||distance({x,y},c)>1.4||[1,4].some(id=>paranaAxisFrame(byId(id),{x,y}).distance<1.3))continue;
      const f=paranaAxisFrame(h,{x,y});elevations[y][x]=clamp(level+(m.id===2?0:.25)*f.side,0,12);
    }
    for(const p of endpointCells(h,kind))if(tiles[p.y][p.x].type!=='water'){const f=paranaAxisFrame(h,p);elevations[p.y][p.x]=clamp(level+(m.id===2?0:.25)*f.side,0,12)}
  }
  // T6 continues the G5 plateau, avoiding a spurious hollow at the model edge.
  const t6=byId(6).tee.center;
  for(let y=Math.floor(t6.y)-1;y<=Math.ceil(t6.y)+1;y++)for(let x=Math.floor(t6.x)-1;x<=Math.ceil(t6.x)+1;x++)if(tiles[y]?.[x]?.type!=='water'&&distance({x,y},t6)<1.4)elevations[y][x]=7;
  for(const p of endpointCells(byId(6),'tee'))if(tiles[p.y][p.x].type!=='water')elevations[p.y][p.x]=7;
  const t7=byId(7).tee.center;
  for(let y=Math.round(t7.y)-1;y<=Math.round(t7.y)+1;y++)for(let x=Math.round(t7.x)-1;x<=Math.round(t7.x)+1;x++)if(tiles[y]?.[x]?.type!=='water'&&distance({x,y},t7)<1.5)elevations[y][x]=5.6;
  for(const bridge of plan.bridges)for(const p of [bridge.from,bridge.to])elevations[p.y][p.x]=bridge.deckHeight;
  plan.relief={datumM:datum,measured:false,source:'user_relative_description_2026-10-12',units:'game_metres_relative',holes:[{id:1,shape:'preserved_flat',height:8},{id:2,tee:1.5,green:6,shape:'low_tee_uphill_fairway'},{id:3,shape:'fall_toward_west_lagoon',safeSide:'left_of_play'},{id:4,shape:'mostly_flat',height:8},{id:5,shape:'fall_toward_west_lagoon',safeSide:'source_image_right'},{id:6,tee:7,shape:'tee_continues_green5_plateau',estimated:true},{id:7,tee:5.6,shape:'short_descent_from_green6'}]};
  plan.provenance.height='user_described_relative_relief_not_surveyed';
  plan.uncertainties.push('Las alturas son una propuesta relativa de juego: datum 8 m para conservar H1 plano, T2 1,5 m y G2 6 m. No representan cotas reales; H3 y H5 caen hacia la laguna y H4 conserva una superficie prácticamente plana.');
}
