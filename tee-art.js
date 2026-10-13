// Original tee furniture. Map positions and all artwork scale with the world.
// Furniture is decorative: it never changes the terrain or a golfer's route.
const layouts = [
  {bench:[-.8,1.35],washer:[-.65,-1.1],sign:[-1.45,-.95],accent:[.15,1.3]},
  {bench:[-1.35,-1.0],washer:[.15,1.1],sign:[-.8,1.6],accent:[-.35,-1.6]},
  {bench:[-.2,-1.45],washer:[-1.1,.95],sign:[-1.35,-.55],accent:[.55,-1.25]},
  {bench:[-1.25,1.25],washer:[.25,-1.2],sign:[-.7,-1.7],accent:[-.35,1.7]},
  {bench:[-.4,1.65],washer:[-1.4,-.75],sign:[.05,-1.55],accent:[-1.3,1.0]},
  {bench:[-1.1,-1.5],washer:[-.55,1.3],sign:[-1.55,.8]}
];

/**
 * Return stable, varied furniture around a tee, aligned to the hole direction.
 * canPlace is consulted across each object's footprint, so edited roads,
 * water or neighbouring greens can move furniture to another dry side.
 * No legal location means omit the object rather than draw over an obstacle.
 */
export function teeDetails(hole, {number=hole.id, canPlace=()=>true}={}) {
  const dx=hole.green.x-hole.tee.x,dy=hole.green.y-hole.tee.y,length=Math.hypot(dx,dy)||1;
  const forward={x:dx/length,y:dy/length},side={x:-forward.y,y:forward.x};
  const seed=Math.max(0,Math.trunc(hole.id)-1),layout=layouts[seed%layouts.length],details=[];
  const safe=(x,y,r)=>[[0,0],[r,0],[-r,0],[0,r],[0,-r]].every(([a,b])=>canPlace(x+a,y+b));
  for(const kind of ['bench','washer','sign','accent']) {
    const preferred=layout[kind];if(!preferred)continue;
    const radius=kind==='bench'?.34:kind==='sign'?.24:.2;
    const choices=[preferred,[preferred[0],-preferred[1]],[-1.2,1.55],[-1.2,-1.55],[0,1.7],[0,-1.7],[-1.8,1.1],[-1.8,-1.1],[.4,1.5],[.4,-1.5],[.7,1.25],[.7,-1.25],[-2.2,.8],[-2.2,-.8]];
    // New cart bays can occupy a preferred side. Search the other dry shoulder
    // within the same physical radius before omitting useful tee furniture.
    for(const along of [-2.4,-2,-1.6,-1.2,-.8,-.4,0,.4,.8])for(const across of [.9,-.9,1.25,-1.25,1.6,-1.6,2,-2])choices.push([along,across]);
    let location=null;
    for(const outward of [0,.35,.7]) {
      for(const [along,across]of choices) {
        const lateral=across+Math.sign(across)*outward;
        const x=hole.tee.x+forward.x*along+side.x*lateral,y=hole.tee.y+forward.y*along+side.y*lateral;
        const distance=Math.hypot(x-hole.tee.x,y-hole.tee.y);
        if(distance<1.08||distance>2.8||!safe(x,y,radius))continue;
        if(details.some(d=>Math.hypot(d.x-x,d.y-y)<d.radius+radius+.24))continue;
        location={x,y,radius};break;
      }
      if(location)break;
    }
    if(!location)continue;
    const variant=(seed+(kind==='bench'?1:kind==='washer'?2:0))%3;
    details.push({...location,kind:kind==='accent'?(seed%2?'stones':'planter'):kind,variant,number,
      mirror:(side.x-side.y)*(preferred[1]>0?1:-1)<0?-1:1,depth:location.x+location.y});
  }
  return details;
}

const polygon=(ctx,points,color)=>{
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=color;ctx.fill();
};
const rect=(ctx,x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h)};
const stroke=(ctx,points,color,width=1)=>{
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
};
const ellipse=(ctx,x,y,rx,ry,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill()};

function bench(ctx,variant) {
  const wood=variant===2?'#a57e4f':'#b9935b';
  for(const x of [-9,8]) {
    if(variant===2){rect(ctx,x-1,-6,4,8,'#929280');rect(ctx,x-1,-6,4,1.3,'#b4b6a0')}
    else {rect(ctx,x,-3,2,6,'#4b5742');if(variant===0)rect(ctx,x,-11,1.5,10,'#566247')}
  }
  polygon(ctx,[[-14,-6],[9,-7],[16,-3],[-7,-2]],wood);
  stroke(ctx,[[-12,-5],[10,-6]],'#dfbf87',.7);
  if(variant===0){rect(ctx,-12,-12,23,2.3,'#aa8050');rect(ctx,-12,-8,23,2,'#c4a16a')}
  else if(variant===1) {
    // Backless park bench, with two narrow seat planks and curved metal legs.
    stroke(ctx,[[-12,-4],[12,-5]],'#e0bd83',.8);
    for(const x of [-9,9])stroke(ctx,[[x,-3],[x-2,2],[x+2,3]],'#53644e',1.1);
  }else{
    rect(ctx,-11,-10,22,3,'#916f4a');rect(ctx,-10,-10,20,.7,'#c4a16a');
    stroke(ctx,[[-10,-7],[-10,-4]],'#747b64',1.1);stroke(ctx,[[9,-7],[9,-4]],'#747b64',1.1);
  }
}

function washer(ctx,variant) {
  const paint=['#c76546','#657b58','#b29c69'][variant];
  ellipse(ctx,0,0,5,2,'#465849');
  if(variant===1){rect(ctx,-3,-14,6,14,'#7b775c');rect(ctx,-3,-7,6,1,'#aba687')}
  else rect(ctx,-1.5,-15,3,16,'#536d53');
  ctx.beginPath();ctx.roundRect(-5,-19,10,7,variant===2?1:2);ctx.fillStyle=paint;ctx.fill();
  rect(ctx,-3,-19,6,1,'#e0c89a');
  stroke(ctx,[[1,-21],[1,-18],[4,-18]],'#efead1',1);
  if(variant===2){rect(ctx,5,-11,3.5,5,'#e3e0bb');rect(ctx,-7,-11,3,4,'#cbd0ae')}
  else rect(ctx,3,-12,4,5,'#dfdeba');
}

function sign(ctx,variant,number) {
  const board=['#507a48','#66764d','#496d61'][variant];
  if(variant===1){rect(ctx,-1.5,-26,3,28,'#7c6747');rect(ctx,-12,-24,25,13,'#dec998');rect(ctx,-10,-22,21,9,board)}
  else {
    rect(ctx,-8,-25,2,26,'#86643e');rect(ctx,8,-25,2,26,'#86643e');
    rect(ctx,-9,-24,19,15,'#e7d5a5');rect(ctx,-7,-22,15,11,board);
  }
  if(variant===0) {
    polygon(ctx,[[-14,-24],[0,-31],[15,-23],[10,-21],[-9,-21]],'#915d41');
    polygon(ctx,[[-14,-24],[0,-31],[1,-28],[-9,-21]],'#b58256');
  }else if(variant===1) {
    // Lower, single-slope roof and one post for a compact trail-style sign.
    polygon(ctx,[[-16,-27],[7,-31],[16,-27],[-7,-23]],'#79886b');
    polygon(ctx,[[-7,-23],[16,-27],[16,-25],[-7,-21]],'#506b52');
    stroke(ctx,[[-12,-27],[9,-30]],'#b5bd8d',.7);
  }else{
    // A shallow hipped tiled roof, rather than another triangular gable.
    polygon(ctx,[[-14,-25],[-6,-29],[7,-29],[15,-24],[9,-22],[-8,-22]],'#b28056');
    polygon(ctx,[[7,-29],[15,-24],[9,-22],[4,-26]],'#825d40');
    stroke(ctx,[[-7,-27],[7,-26]],'#d4a76a',.6);stroke(ctx,[[-10,-25],[9,-24]],'#805a3a',.6);
  }
  // Small diagram on the board and a correctly oriented hole number.
  stroke(ctx,[[-4,-13],[-2,-16],[3,-17]],'#adc975',1.1);
  ctx.font='7px Arial';ctx.textAlign='center';ctx.fillStyle='#f7ecc2';ctx.fillText(String(number),variant===1?6:0,-18);
}

function planter(ctx,variant) {
  polygon(ctx,[[-7,-2],[4,-4],[8,-1],[3,3],[-6,2]],variant===1?'#94734d':'#a87550');
  ellipse(ctx,0,-3,7,3,'#465d39');
  for(const [x,y,r]of [[-4,-5,2.8],[0,-6,3],[4,-4,2.4]])ellipse(ctx,x,y,r,r*.7,'#6d8b42');
  for(const [x,y]of [[-4,-6],[1,-7],[4,-5]])ellipse(ctx,x,y,1.1,.8,variant===2?'#e7dca3':'#d5a2b7');
}

function stones(ctx,variant) {
  for(const [x,y,r]of [[-4,0,4],[3,1,3],[-1,-2,2]]){
    polygon(ctx,[[x-r,y],[x-r*.5,y-r*.6],[x+r*.6,y-r*.7],[x+r,y],[x+r*.3,y+r*.45]],variant===1?'#8b9178':'#96947b');
    stroke(ctx,[[x-r*.5,y-r*.6],[x+r*.6,y-r*.7]],'#bfc3a0',.7);
  }
}

/** Draw one descriptor at its depth-sorted position, using the app's projector. */
export function drawTeeDetail(ctx,detail,{project,unit}) {
  const p=project(detail.x,detail.y);
  ctx.save();ctx.translate(p.x,p.y);ctx.scale(unit,unit);
  ellipse(ctx,3,2,detail.kind==='bench'?15:detail.kind==='sign'?8:7,3,'#24482b32');
  // Bench/washer face the tee edge. The sign and its number stay upright.
  ctx.scale(detail.kind==='sign'?1:detail.mirror,1);
  if(detail.kind==='bench')bench(ctx,detail.variant);
  else if(detail.kind==='washer')washer(ctx,detail.variant);
  else if(detail.kind==='sign')sign(ctx,detail.variant,detail.number);
  else if(detail.kind==='planter')planter(ctx,detail.variant);
  else stones(ctx,detail.variant);
  ctx.restore();
}
