import {roadNeighbors} from './roads.js?v=13';

// A top-down review of reference geometry and the actual game's navigation.
// This is an interface view: it never moves a tee, changes terrain or runs time.
export function courseNavigation(sim){
  const holes=sim.holes.map(h=>{
    const parking=sim._parkingSlots(h,(sim.carts||[]).map(c=>c.id));
    return {id:h.id,teeDry:sim.tile(h.tee.x,h.tee.y)?.type!=='water',greenDry:sim.tile(h.green.x,h.green.y)?.type!=='water',
      cartAccess:parking.length===2&&parking.every(p=>Boolean(sim._findPath({x:7,y:29},p,true)))};
  });
  const links=[];
  for(let i=1;i<sim.holes.length;i++){
    const from=sim.holes[i-1],to=sim.holes[i],connection=sim.walkingConnection(from.id,to.id);
    links.push({from:from.id,to:to.id,path:connection?.points||null,seconds:connection?.estimatedSeconds,nearConfirmed:from.id===2||from.id===6});
  }
  return {holes,links};
}

export function drawCoursePlan(ctx,{sim,width,height,showReference=true,showNavigation=true}){
  const plan=sim.coursePlan;if(!plan)return null;
  const n=sim.tiles.length,pad=35,carts=sim.carts||[],golfers=sim.golfers||[];
  const driving=carts.filter(c=>c.phase==='driving').length,parked=carts.filter(c=>c.phase==='parked').length,blocked=carts.filter(c=>c.phase==='blocked').length;
  // One scale and one translation fit the supplied contours and every road.
  // Cropping unused grid margins here leaves the world and its physics intact.
  const points=[];
  for(const patch of [...plan.forest,...plan.water])points.push(...patch.polygon);
  for(const h of plan.holes)points.push(...h.axis,...h.fairwayPolygon,...h.tee.polygon,...h.green.polygon);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(sim.tiles[y][x].type==='path')points.push({x:x-.5,y:y-.5},{x:x+.5,y:y+.5});
  for(const h of sim.holes)points.push(h.tee,h.green);
  let minX=Math.min(...points.map(p=>p.x))-.8,minY=Math.min(...points.map(p=>p.y))-.8;
  const spanX=Math.max(...points.map(p=>p.x))+.8-minX,spanY=Math.max(...points.map(p=>p.y))+.8-minY;
  ctx.font='10px Arial';
  const legend=[];
  for(const value of ['T = salida · G = green · Punteado = caminata',`■ Carritos: ${driving} en marcha · ${parked} estacionados · ${blocked} bloqueados`,`● ${golfers.length} golfistas · Rojo = navegación bloqueada`]){
    let row='';for(const word of value.split(' ')){
      const next=row?row+' '+word:word;
      if(row&&ctx.measureText(next).width>width-24){legend.push(row);row=word}else row=next;
    }if(row)legend.push(row);
  }
  const footer=Math.max(pad,legend.length*12+16),spaceH=Math.max(1,height-pad-footer);
  const unit=Math.min(Math.max(1,width-pad*2)/spanX,spaceH/spanY);
  const left=(width-spanX*unit)/2,top=pad+(spaceH-spanY*unit)/2;
  const screen=p=>({x:left+(p.x-minX)*unit,y:top+(p.y-minY)*unit});
  const polygon=(points,fill,stroke)=>{
    ctx.beginPath();points.forEach((p,i)=>{const q=screen(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}
  };
  const line=(points,color,width=1,dash=[])=>{
    if(points.length<2)return;ctx.setLineDash(dash);ctx.beginPath();points.forEach((p,i)=>{const q=screen(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();ctx.setLineDash([]);
  };
  const text=(value,p,color)=>{
    const q=screen(p);ctx.font='bold 11px Arial';ctx.textAlign='center';ctx.strokeStyle='#f9f6e8';ctx.lineWidth=3;ctx.strokeText(value,q.x,q.y);ctx.fillStyle=color;ctx.fillText(value,q.x,q.y);
  };
  ctx.clearRect(0,0,width,height);ctx.fillStyle='#f2efe1';ctx.fillRect(0,0,width,height);
  ctx.save();ctx.beginPath();ctx.rect(left,top,spanX*unit,spanY*unit);ctx.clip();
  ctx.fillStyle='#759d4c';ctx.fillRect(left,top,spanX*unit,spanY*unit);
  const colors={grass:'#80a453',fairway:'#a9ca60',green:'#c2de79',tee:'#c6d58a',sand:'#eadbae',water:'#4d8caa',tree:'#3d713b'};
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const type=sim.tiles[y][x].type;if(type==='path')continue;
    const q=screen({x:x-.5,y:y-.5});ctx.fillStyle=colors[type]||colors.grass;ctx.fillRect(q.x,q.y,unit+.2,unit+.2);
  }
  // Road strokes are the same edges the carts actually follow.
  ctx.lineCap='round';
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(sim.tiles[y][x].type==='path'){
    for(const p of roadNeighbors(sim.tiles,x,y))if(p.y*n+p.x>y*n+x)line([{x,y},p],'#aaa889',unit*.2);
  }
  if(showReference){
    for(const patch of plan.forest)polygon(patch.polygon,null,'#365b3a70');
    for(const water of plan.water)polygon(water.polygon,'#428baa70','#306e8f');
    for(const h of plan.holes){
      polygon(h.fairwayPolygon,null,h.color+'90');polygon(h.tee.polygon,'#eee3aa',h.color);polygon(h.green.polygon,'#cbe485','#63864a');
      line(h.axis,h.color,1.25);
      const a=screen(h.axis.at(-2)),b=screen(h.axis.at(-1)),angle=Math.atan2(b.y-a.y,b.x-a.x);
      ctx.fillStyle=h.color;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-Math.cos(angle-.4)*7,b.y-Math.sin(angle-.4)*7);ctx.lineTo(b.x-Math.cos(angle+.4)*7,b.y-Math.sin(angle+.4)*7);ctx.closePath();ctx.fill();
    }
  }
  const nav=courseNavigation(sim);
  if(showNavigation)for(const link of nav.links){
    const a=sim.holes.find(h=>h.id===link.from).green,b=sim.holes.find(h=>h.id===link.to).tee;
    line(link.path||[a,b],link.path?'#586e88':'#ba5147',1.4,[4,3]);
  }
  ctx.restore();
  for(const h of sim.holes){
    text('T'+h.id,{x:h.tee.x-.75,y:h.tee.y+.65},'#805b24');
    text('G'+h.id,{x:h.green.x+.75,y:h.green.y-.45},'#274c36');
    for(const p of [h.tee,h.green]){const q=screen(p);ctx.fillStyle='#fff8d1';ctx.beginPath();ctx.arc(q.x,q.y,2.4,0,Math.PI*2);ctx.fill()}
  }
  if(showNavigation){
    for(const c of carts){
      const q=screen(c);ctx.fillStyle=c.phase==='blocked'?'#ba5147':c.phase==='driving'?'#d29d3c':'#496d92';ctx.strokeStyle='#fff8df';ctx.lineWidth=1;
      ctx.fillRect(q.x-3,q.y-3,6,6);ctx.strokeRect(q.x-3,q.y-3,6,6);
    }
    for(const g of golfers){
      const q=screen(g);ctx.fillStyle=g.phase==='blocked'?'#ba5147':g.controlled?'#fff8df':'#795b91';ctx.strokeStyle='#fff8df';ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(q.x,q.y,2.5,0,Math.PI*2);ctx.fill();ctx.stroke();
    }
  }
  ctx.font='10px Arial';ctx.textAlign='left';ctx.fillStyle='#4c6750';
  legend.forEach((value,i)=>ctx.fillText(value,12,height-12-(legend.length-1-i)*12));
  return nav;
}
