import {roadNeighbors} from './roads.js?v=16';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const palette={grass:'#7b9f51',tree:'#70964d',fairway:'#a2bc61',green:'#b9d17a',tee:'#abc568',sand:'#ead9ab',water:'#588f9b',path:'#7b9f51'};
// A small perspective renderer of the SAME map, elevations and actors. No
// external assets, separate driving level, or movement in screen coordinates.
export class CartPerspective {
  constructor(sim,canvas,treeSprite){this.sim=sim;this.canvas=canvas;this.ctx=canvas.getContext('2d');this.treeSprite=treeSprite;this.tiles=null;this.faces=[];}
  rebuild(){
    const s=this.sim;this.tiles=s.tiles;this.faces=[];this.trees=[];
    const z=(x,y)=>s.heightAt(x,y)*.11;
    for(let y=0;y<s.tiles.length;y++)for(let x=0;x<s.tiles.length;x++){
      const type=s.tiles[y][x].type,base=palette[type]||palette.grass;
      const corners=[{x:x-.5,y:y-.5},{x:x+.5,y:y-.5},{x:x+.5,y:y+.5},{x:x-.5,y:y+.5}].map(p=>({...p,z:z(p.x,p.y)}));
      this.faces.push({x,y,points:corners,fill:base,kind:type});
      if(type==='tree')this.trees.push({x,y,z:z(x,y)});
      if(type==='path')for(const b of roadNeighbors(s.tiles,x,y))if(b.y*s.tiles.length+b.x>y*s.tiles.length+x){
        const dx=b.x-x,dy=b.y-y,d=Math.hypot(dx,dy),nx=-dy/d*.18,ny=dx/d*.18;
        const points=[{x:x+nx,y:y+ny},{x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny},{x:x-nx,y:y-ny}].map(p=>({...p,z:z(p.x,p.y)+.014}));
        this.faces.push({x:(x+b.x)/2,y:(y+b.y)/2,points,fill:'#c5b28a',kind:'road'});
      }
    }
    for(const b of s.coursePlan?.bridges||[]){
      const dx=b.to.x-b.from.x,dy=b.to.y-b.from.y,d=Math.hypot(dx,dy),nx=-dy/d*b.widthCells/2,ny=dx/d*b.widthCells/2;
      const points=[{x:b.from.x+nx,y:b.from.y+ny},{x:b.to.x+nx,y:b.to.y+ny},{x:b.to.x-nx,y:b.to.y-ny},{x:b.from.x-nx,y:b.from.y-ny}].map(p=>({...p,z:b.deckHeight*.11+.02}));
      this.faces.push({x:(b.from.x+b.to.x)/2,y:(b.from.y+b.to.y)/2,points,fill:'#ba9770',kind:'road'});
    }
  }
  draw(cart,progress,steer=0){
    if(this.tiles!==this.sim.tiles)this.rebuild();
    const canvas=this.canvas,ctx=this.ctx,w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,1.5);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const sky=ctx.createLinearGradient(0,0,0,h*.65);sky.addColorStop(0,'#89b9cf');sky.addColorStop(.65,'#d8e5d0');sky.addColorStop(1,'#8daa61');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
    // Descend from a course overview into the driver's seat, then reverse on exit.
    const t=progress*progress*(3-2*progress),heading=cart.heading,cs=Math.cos(heading),sn=Math.sin(heading),pitch=mix(.63,.035,t),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const eye={x:cart.x-cs*mix(7,.1,t),y:cart.y-sn*mix(7,.1,t),z:this.sim.heightAt(cart.x,cart.y)*.11+mix(6,.62,t)};
    const focal=Math.max(w*.76,h*.42),horizon=h*.43;
    const view=p=>{const dx=p.x-eye.x,dy=p.y-eye.y,forward=dx*cs+dy*sn,up=(p.z||0)-eye.z;return {x:-dx*sn+dy*cs,y:up*cp+forward*sp,z:forward*cp-up*sp}};
    const project=p=>({x:w/2+p.x*focal/p.z,y:horizon-p.y*focal/p.z,z:p.z});
    const clip=points=>{
      const result=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],ina=a.z>.09,inb=b.z>.09;if(ina)result.push(a);if(ina!==inb){const q=(.09-a.z)/(b.z-a.z);result.push({x:mix(a.x,b.x,q),y:mix(a.y,b.y,q),z:.09});}}return result;
    };
    const poly=(points,fill)=>{const clipped=clip(points.map(view));if(clipped.length<3)return;const ps=clipped.map(project);if(ps.every(p=>p.x<0)||ps.every(p=>p.x>w)||ps.every(p=>p.y<0)||ps.every(p=>p.y>h))return;ctx.fillStyle=fill;ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();ctx.strokeStyle=fill;ctx.lineWidth=.7;ctx.stroke();};
    const line=(a,b,color,width=1)=>{const va=view(a),vb=view(b);if(va.z<=.09||vb.z<=.09)return;const pa=project(va),pb=project(vb);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);ctx.stroke();};
    const commands=[];
    for(const face of this.faces){
      const dx=face.x-eye.x,dy=face.y-eye.y,depth=dx*cs+dy*sn;
      if(depth< -2||depth>30||Math.hypot(dx,dy)>32)continue;
      commands.push({depth,road:face.kind==='road',draw:()=>{
        poly(face.points,face.fill);
        if(face.kind==='fairway'&&(Math.round(face.x+face.y)%2===0))poly(face.points,'#9ab65b');
        if(face.kind==='water'){
          const z=this.sim.heightAt(face.x,face.y)*.11+.01,shift=Math.sin(this.sim._clock*.8+face.x)*.15;
          line({x:face.x-.3+shift,y:face.y,z},{x:face.x+.3+shift,y:face.y,z},'#b1d1cf65',1);
        }
      }});
    }
    commands.sort((a,b)=>Number(a.road)-Number(b.road)||b.depth-a.depth);for(const command of commands)command.draw();
    // Guide is deliberately quiet: short sage marks on the ground, plus one P.
    const guide=[cart,...(cart._path?.slice(cart._pathIndex||0)||[])];
    for(let i=1;i<Math.min(guide.length,35);i++){
      const a=guide[i-1],b=guide[i],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d<.08)continue;
      const nx=-dy/d*.035,ny=dx/d*.035;
      poly([.28,.67].flatMap((t,j)=>{const p={x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)};return (j?[1,-1]:[-1,1]).map(sign=>({x:p.x+nx*sign,y:p.y+ny*sign,z:this.sim.heightAt(p.x,p.y)*.11+.025}));}),'#eff1c88c');
    }
    const sprites=[];
    for(const tree of this.trees){const v=view(tree);if(v.z<.1||v.z>32)continue;const p=project(v),size=focal/v.z*2.8;if(p.x+size/2<0||p.x-size/2>w)continue;sprites.push({depth:v.z,draw:()=>{const sprite=this.treeSprite(tree.x,tree.y);ctx.drawImage(sprite,p.x-size/2,p.y-size*.94,size,size);}});}
    for(const hole of this.sim.holes){
      const p=hole.green,z=this.sim.heightAt(p.x,p.y)*.11,depth=view({...p,z}).z;
      if(depth<.1||depth>32)continue;
      sprites.push({depth,draw:()=>{line({...p,z},{...p,z:z+.68},'#f4eed5',Math.max(1,focal/depth*.017));poly([{...p,z:z+.68},{x:p.x-sn*.26,y:p.y+cs*.26,z:z+.59+Math.sin(this.sim._clock*2)*.018},{...p,z:z+.49}],'#d55b47');}});
    }
    for(const c of this.sim.carts){
      if(c.id===cart.id)continue;const z=this.sim.heightAt(c.x,c.y)*.11,depth=view({...c,z}).z;if(depth<.2||depth>30)continue;
      sprites.push({depth,draw:()=>{
        const ca=Math.cos(c.heading),sa=Math.sin(c.heading),point=(a,b,up)=>({x:c.x+ca*a-sa*b,y:c.y+sa*a+ca*b,z:z+up});
        const box=(low,high,length,width,color)=>{const bottom=[point(-length,-width,low),point(length,-width,low),point(length,width,low),point(-length,width,low)],top=[point(-length,-width,high),point(length,-width,high),point(length,width,high),point(-length,width,high)];poly([bottom[0],bottom[1],top[1],top[0]],color);poly([bottom[1],bottom[2],top[2],top[1]],color);poly([bottom[2],bottom[3],top[3],top[2]],color);poly([bottom[3],bottom[0],top[0],top[3]],color);poly(top,color);};
        box(.08,.3,.34,.24,'#e4d9b2');box(.48,.53,.38,.3,'#f4ead1');box(.28,.36,.1,.18,'#52695a');
        for(const a of [-.27,.27])for(const b of [-.22,.22])line(point(a,b,.2),point(a,b,.49),'#52675a',Math.max(1,focal/depth*.02));
        for(const a of [-.22,.22])for(const b of [-.25,.25]){const p=project(view(point(a,b,.1)));ctx.fillStyle='#334538';ctx.beginPath();ctx.ellipse(p.x,p.y,focal/depth*.075,focal/depth*.1,0,0,Math.PI*2);ctx.fill();}
      }});
    }
    sprites.sort((a,b)=>b.depth-a.depth);for(const item of sprites)item.draw();
    const goal=cart._target,p=view({...goal,z:this.sim.heightAt(goal.x,goal.y)*.11+.45});
    if(p.z>.1){const q=project(p);if(q.x>20&&q.x<w-20&&q.y>35&&q.y<h*.79){ctx.fillStyle='#f9edbce8';ctx.beginPath();ctx.roundRect(q.x-19,q.y-20,38,34,8);ctx.fill();ctx.fillStyle='#315848';ctx.font='bold 19px Georgia';ctx.textAlign='center';ctx.fillText('P',q.x,q.y+4);ctx.beginPath();ctx.moveTo(q.x-6,q.y+17);ctx.lineTo(q.x+6,q.y+17);ctx.lineTo(q.x,q.y+25);ctx.fill();}}
    // Windshield posts and the steering wheel identify an actual seated view.
    if(t>.4){ctx.save();ctx.globalAlpha=(t-.4)/.6;ctx.fillStyle='#304b40';ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(0,h*.88);ctx.quadraticCurveTo(w/2,h*.78,w,h*.88);ctx.lineTo(w,h);ctx.fill();
      ctx.strokeStyle='#e3d7af';ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(w*.035,h*.87);ctx.lineTo(w*.012,0);ctx.moveTo(w*.965,h*.87);ctx.lineTo(w*.988,0);ctx.stroke();
      const radius=Math.min(68,w*.155);ctx.translate(w/2,h-radius*.55);ctx.rotate(steer*.65);ctx.strokeStyle='#182f2a';ctx.lineWidth=12;ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#81917b';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,radius-7,0,Math.PI*2);ctx.stroke();ctx.lineWidth=9;for(let i=0;i<3;i++){const a=i*Math.PI*2/3+Math.PI/2;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*radius,Math.sin(a)*radius);ctx.stroke();}ctx.fillStyle='#c3b887';ctx.beginPath();ctx.arc(0,0,14,0,Math.PI*2);ctx.fill();ctx.restore();}
  }
}

export function installCartView({sim,treeSprite,onEnter,onExit,toast}){
  const $=id=>document.getElementById(id),button=$('driveCart');
  const layer=document.createElement('section');layer.id='cartDrive';layer.hidden=true;layer.setAttribute('aria-label','Manejo del carrito en primera persona');
  layer.innerHTML='<canvas id="cartWindshield" aria-label="Vista desde el asiento del carrito"></canvas><div class="drive-top"><div class="drive-heading"><small>PARAÍSO · EN EL CARRITO</small><strong id="driveDestination">Próxima parada</strong><span id="driveDirection"></span></div><button id="driveExit" aria-label="Volver a la cancha y conducir automáticamente">Volver ↗</button></div><div class="drive-help" id="driveHelp">Seguí las marcas claras · frená junto a P</div><div class="drive-bottom"><div class="drive-steer"><button data-drive="left" aria-label="Girar a la izquierda">←</button><button data-drive="right" aria-label="Girar a la derecha">→</button><button id="drivePause" aria-label="Pausar manejo">Ⅱ</button><button data-drive="reverse" aria-label="Marcha atrás">R</button></div><div class="drive-gauge"><strong id="driveSpeed">0</strong><small>VELOCIDAD</small><button id="drivePark" disabled>Estacionar</button></div><div class="drive-pedals"><button data-drive="brake" aria-label="Frenar">FRENO</button><button data-drive="gas" aria-label="Acelerar">AVANZAR</button></div></div>';
  $('viewport').append(layer);
  const renderer=new CartPerspective(sim,$('cartWindshield'),treeSprite),keys=new Set(),pressed=new Map();
  let active=false,wanted=false,progress=0,last=0,oldSpeed=1,lastCart=null,closing=false,lastHud=0;
  const reset=()=>{keys.clear();pressed.clear();sim.setDriveInput({brake:1});layer.querySelectorAll('[data-drive]').forEach(b=>b.removeAttribute('data-pressed'));};
  function enter(){
    const result=sim.startCartDriving();if(!result.ok){toast(result.message);return;}
    onEnter();oldSpeed=sim.speed;sim.speed=1;active=true;closing=false;progress=0;lastCart=sim.drivingStatus().cart;layer.hidden=false;document.body.dataset.driving='true';renderer.tiles=null;reset();$('driveExit').focus({preventScroll:true});
  }
  function leave(){if(!active||closing)return;wanted=false;closing=true;reset();sim.stopCartDriving();sim.speed=oldSpeed;onExit(lastCart);}
  button.onclick=()=>{if(sim.drivingStatus().available)enter();else{wanted=!wanted;toast(wanted?'Manejo preparado: entrarás al asiento en el próximo traslado.':'Los traslados quedan en automático.');}};
  $('driveExit').onclick=leave;$('drivePark').onclick=()=>{const result=sim.parkPlayerCart();toast(result.message);if(result.ok)leave();};
  $('drivePause').onclick=()=>{sim.paused=!sim.paused;reset();};
  for(const el of layer.querySelectorAll('[data-drive]')){
    el.addEventListener('pointerdown',event=>{event.preventDefault();el.setPointerCapture(event.pointerId);pressed.set(event.pointerId,el.dataset.drive);el.dataset.pressed='true';});
    const release=event=>{pressed.delete(event.pointerId);el.removeAttribute('data-pressed');};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(type,release);
  }
  const bindings={ArrowUp:'gas',w:'gas',W:'gas',ArrowDown:'brake',s:'brake',S:'brake',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',r:'reverse',R:'reverse',' ':'brake'};
  document.addEventListener('keydown',event=>{if(!active||closing)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();leave();}else if(bindings[event.key]){event.preventDefault();event.stopImmediatePropagation();keys.add(bindings[event.key]);}},true);
  document.addEventListener('keyup',event=>{if(bindings[event.key])keys.delete(bindings[event.key]);},true);
  window.addEventListener('blur',reset);document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
  return {
    get active(){return active},
    beforeTick(){
      const status=sim.drivingStatus();button.hidden=sim.playerRound?.status!=='playing';button.dataset.ready=String(status.available||wanted);button.setAttribute('aria-label',wanted?'Cancelar manejo del próximo traslado':'Manejar el carrito');
      if(wanted&&status.available&&!active)enter();
      if(!active||closing)return;
      if(!status.manual){leave();return;}
      const held=new Set([...keys,...pressed.values()]);sim.setDriveInput({throttle:held.has('gas')?1:held.has('reverse')?-1:0,steer:Number(held.has('right'))-Number(held.has('left')),brake:Number(held.has('brake'))});
    },
    frame(ts){
      const dt=Math.min(.1,(ts-(last||ts))/1000);last=ts;if(!active)return;
      const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      progress=clamp(progress+(closing?-1:1)*(reduced?10:dt/.95),0,1);
      layer.style.opacity=String(clamp(progress*4,0,1));
      const status=sim.drivingStatus(),cart=status.cart||lastCart;if(!cart){leave();return;}lastCart=cart;
      if(closing&&progress===0){active=false;layer.hidden=true;document.body.dataset.driving='false';button.focus({preventScroll:true});return;}
      if(ts-lastHud>=32||progress<1){
        renderer.draw(cart,progress,sim._driveInput?.steer||0);lastHud=ts;
        const distance=dist(cart,cart._target),angle=Math.atan2(cart._target.y-cart.y,cart._target.x-cart.x)-cart.heading,turn=Math.atan2(Math.sin(angle),Math.cos(angle));
        $('driveDestination').textContent=status.group?('Hoyo '+status.group.holeId+' · '+(status.group._resumeBall?'junto a las pelotas':'tee de salida')):'Próxima parada';
        $('driveDirection').textContent=(Math.abs(turn)<.3?'↑':turn>0?'↱':'↰')+' '+Math.round(distance*20)+' m hasta estacionar';
        $('driveSpeed').textContent=String(Math.round(Math.abs(cart._speed)*12));
        $('driveHelp').textContent=sim.paused?'En pausa':sim._driveNotice||'Seguí las marcas claras · frená junto a P';
        $('drivePark').disabled=closing||distance>.75||Math.abs(cart._speed)>.08;
        $('drivePause').textContent=sim.paused?'▶':'Ⅱ';
      }
    }
  };
}
