import {buildCartNetwork,cartGroundAllowed,cartSegmentAllowed,shoulderParking,trimParkingSpurs} from './cart-navigation.js?v=16';
import {cartAdvanceLimit,cartEdgeClear,CART_GAP} from './cart-traffic.js?v=13';
const copy=p=>({x:p.x,y:p.y});
const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

// Installed on the DOM-free simulation; the view only supplies pedal inputs.
export const cartJourney={
  invalidateCartNetwork(){this._cartNetwork=null;},
  refreshCartNetwork(){const signature=this.tiles.map(row=>row.map(t=>t.type).join(',')).join(';');if(signature!==this._cartSignature){this._cartSignature=signature;this.invalidateCartNetwork();}},
  cartNetwork(){
    if(!this._cartNetwork||this._cartNetworkSource!==this.tiles){this._cartNetwork=buildCartNetwork(this.tiles,this.coursePlan?.bridges);this._cartNetworkSource=this.tiles;}
    return this._cartNetwork;
  },
  cartGroundAt(x,y){return cartGroundAllowed(this,x,y)},
  tidyCartPaths(){
    const removed=trimParkingSpurs(this);
    for(const c of this.carts){c._path=null;delete c._routeRetryAt;}
    return {ok:true,count:removed.length,message:removed.length?`${removed.length} tramos de estacionamiento vuelven a ser pasto. El circuito principal se conserva.`:'El circuito ya está despejado; se conservan los tramos ocupados.'};
  },
  _planCartPair(carts,slots,bridgeWaypoints=[]){
    return carts.map((cart,i)=>{
      const trip={...cart,phase:'driving',_target:copy(slots[i]),_path:[],_pathIndex:0,_bridgeWaypoints:bridgeWaypoints.map(copy)};
      delete trip._trafficGoal;delete trip._trafficWaiting;delete trip._trafficWinner;
      let from=cart;
      for(const target of [...bridgeWaypoints,slots[i]]){
        const part=this._findPath(from,target,true,(a,b)=>cartEdgeClear(a,b,this.carts,{exceptIds:carts.map(c=>c.id),reserved:slots.filter((_,j)=>j!==i)}));
        if(!part)return null;trip._path.push(...part);from=target;
      }
      return trip;
    });
  },
  _stageCartAdvance(group,hole,members){
    if(this._clock<(group._stopRetryAt||0))return false;
    group._stopRetryAt=this._clock+2;
    const active=members.filter(g=>!g._completed.includes(hole.id));
    if(!active.length)return false;
    // The rear ball sets the stop, so a short shot never strands its partner.
    const rear=[...active].sort((a,b)=>d(b.ball,hole.green)-d(a.ball,hole.green))[0];
    const next=this.holes.find(h=>h.id===group.plan.find(id=>id!==hole.id&&!group.completed.includes(id)));
    const nearGreen=active.every(g=>d(g.ball,hole.green)<5);
    const anchor=nearGreen&&next&&d(hole.green,next.tee)<10?{x:(hole.green.x+next.tee.x)/2,y:(hole.green.y+next.tee.y)/2}:nearGreen?hole.green:rear.ball;
    const carts=members.map(g=>this.carts.find(c=>c.id===g.cartId));
    const slots=shoulderParking(this,anchor,carts.map(c=>c.id));
    if(slots.length<2)return false;
    const oldDistance=carts.reduce((sum,c)=>sum+d(c,anchor),0),newDistance=slots.reduce((sum,c)=>sum+d(c,anchor),0);
    if(oldDistance-newDistance<5||carts.every((c,i)=>d(c,slots[i])<3))return false;
    const trips=this._planCartPair(carts,slots);
    if(trips.some(t=>!t)||members.some(g=>!this._findPath(g,this.carts.find(c=>c.id===g.cartId))))return false;
    group._stopTargets=slots.map(copy);group._resumeBall=true;group.phase='returningCart';group.actorId=null;
    for(const g of members){this._setWalk(g,this.carts.find(c=>c.id===g.cartId),'returningCart','cart');this._comment(g,nearGreen?'Dejamos los carritos cerca del green.':'Avanzamos en carrito hasta las pelotas.');}
    return true;
  },
  _resumeCartAdvance(group,carts,members){
    if(this._trafficTripBusy(group.id)||this._clock<(group._tripRetryAt||0))return false;
    group._tripRetryAt=this._clock+3;
    const trips=this._planCartPair(carts,group._stopTargets);
    if(trips.some(t=>!t))return false;
    this._commitCartTrips(trips);group.phase='driving';group.phaseTime=0;
    for(const g of members)this._phase(g,'riding');
    delete group._stopTargets;return true;
  },
  drivingStatus(){
    const g=this.golfers.find(g=>g.id===this.playerRound?.golferId&&g.controlled),cart=g&&this.carts.find(c=>c.id===g.cartId),group=g&&this.groups.find(gr=>gr.id===g.groupId);
    const available=Boolean(g&&g.phase==='riding'&&group?.phase==='driving'&&cart&&cart.phase!=='parked'&&!cart._trafficWaiting&&!cart._roadWaiting);
    return {g,cart,group,available,manual:available&&this._manualCartId===cart.id};
  },
  startCartDriving(){
    const status=this.drivingStatus();
    if(!status.available)return {ok:false,message:status.g?'Podés manejar cuando estés sentado, durante un traslado.':'Iniciá un partido para manejar tu carrito.'};
    this._manualCartId=status.cart.id;this._driveInput={throttle:0,steer:0,brake:1};this._driveNotice='';status.cart._speed=0;
    return {ok:true,message:'Seguí la guía y frená dentro de la parada marcada.'};
  },
  stopCartDriving(){
    const c=this.carts.find(c=>c.id===this._manualCartId);
    if(c){c._speed=0;c._path=null;delete c._routeRetryAt;}
    this._manualCartId=null;this._driveInput=null;
  },
  setDriveInput(input={}){
    this._driveInput={throttle:clamp(Number(input.throttle)||0,-1,1),steer:clamp(Number(input.steer)||0,-1,1),brake:clamp(Number(input.brake)||0,0,1)};
  },
  parkPlayerCart(){
    const {cart,manual}=this.drivingStatus();
    if(!manual||d(cart,cart._target)>.75||Math.abs(cart._speed)>.08)return {ok:false,message:'Frená dentro de la señal de estacionamiento.'};
    if(this.carts.some(c=>c.id!==cart.id&&d(c,cart)<CART_GAP))return {ok:false,message:'Dejá espacio al otro carrito.'};
    // Keep its real stopping position. Parking never snaps to the marker.
    cart._target=copy(cart);cart.phase='parked';cart._path=null;cart._speed=0;this._manualCartId=null;this._driveInput=null;
    return {ok:true,message:'Estacionado. Tu golfista baja y prepara el próximo tiro.'};
  },
  _driveCartStep(c,dt){
    const input=this._driveInput||{},max=this.cartRoadAt(c.x,c.y)?1.15:.52;
    const target=(input.throttle||0)*(input.throttle<0?.3:max),accel=input.brake?2.8:input.throttle? .85:1.2;
    c._speed+=(clamp(target,-.3,max)-c._speed)*Math.min(1,dt*accel*3);
    if(input.brake)c._speed*=Math.max(0,1-dt*8);
    if(Math.abs(c._speed)<.004)c._speed=0;
    const heading=c.heading+(input.steer||0)*Math.sign(c._speed)*Math.min(1.25,Math.abs(c._speed)*2.4)*dt;
    const p={x:c.x+Math.cos(heading)*c._speed*dt,y:c.y+Math.sin(heading)*c._speed*dt};
    this._driveNotice='';
    if(!cartSegmentAllowed(this,c,p)){c._speed=0;this._driveNotice='Volvé al camino o al pasto de su costado.';return;}
    const step=d(c,p),limit=cartAdvanceLimit(c,p,step,this.carts,{lookAhead:0});
    if(limit.advance<step-1e-7){c._speed=0;this._driveNotice='Esperá: hay otro carrito adelante.';return;}
    c.heading=heading;c.x=p.x;c.y=p.y;c.phase='driving';
    if(c._bridgeWaypoints?.length&&d(c,c._bridgeWaypoints[0])<.6)c._bridgeWaypoints.shift();
    // Refresh the unobtrusive route guide without changing the chosen parking.
    if(this._clock>=(c._guideAt||0)){c._path=this._cartPath(c);c._pathIndex=0;c._guideAt=this._clock+.65;}
  }
};
