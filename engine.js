// Small, deliberately approximate golf simulation. No DOM or external dependencies.
import {CONTACT_FRACTION} from './animation.js?v=13';
import {heightAt,gradient,simulateRoll} from './terrain.js?v=13';
import {roadEdgeAllowed,roadNeighbors,shortestRoadPath} from './roads.js?v=13';
import {PARANA_ID,createParanaCourse} from './parana-course.js?v=13';
import {CLUBS,LEGACY_CLUBS,SHOT_STYLES,carryLength,flightPath} from './shot-physics.js?v=13';
import {windAt,weatherHash} from './weather.js?v=13';
import {CLUB_RETRIEVE_SECONDS,clubRetrievalPoint,cartBagAnchor} from './club-animation.js?v=13';
import {CART_GAP,cartAdvanceLimit,cartConflict,chooseCartSlots,findCartYieldRoute,cartEdgeClear} from './cart-traffic.js?v=13';
import {planCartBays,planDepotBays} from './cart-bays.js?v=13';
export {CLUBS,SHOT_STYLES};
export const N = 64;
const LEGACY_N = 32;
const PREVIOUS_N = 48;
export const TERRAIN = Object.freeze({ grass: 'grass', fairway: 'fairway', green: 'green', sand: 'sand', water: 'water', tree: 'tree', path: 'path', tee: 'tee' });
export const COSTS = Object.freeze({ grass: 10, fairway: 45, green: 140, sand: 70, water: 95, tree: 30, path: 25, tee: 90 });
export const club = Object.freeze({ x: 4, y: 26 });
const TYPES = new Set(Object.values(TERRAIN));
const COLORS = ['#ffcf64', '#6cbcf0', '#e892ba', '#b3da6c', '#b69ce7', '#e88a65', '#73d7bd', '#f3e6b7'];
const NAMES = ['Clara', 'Mateo', 'Inés', 'Bruno', 'Sofía', 'Tomás', 'Valeria', 'Nico', 'Lucía', 'Diego', 'Emilia', 'Álex'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < N && y < N;
const isClub = (x, y) => x >= 3 && x <= 5 && y >= 24 && y <= 27;
const copyPoint = p => ({ x: p.x, y: p.y });
export const PACE = Object.freeze({walk:0.65,cart:1.15,prepare:2.5,swing:3.6,putt:2.4,watch:1.5,turnGap:0.8,gather:4,park:2.4,board:2.2});
const PHASES = new Set(['aiming','waiting','shooting','walking','holed','leaving','riding','disembarking','retrievingClub','positioning','preparing','swinging','watching','afterShot','returningCart','boarding','blocked']);
const validPoint = (p,size=N) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -0.5 && p.y >= -0.5 && p.x <= size - 0.5 && p.y <= size - 0.5;
const validHolePoint=(p,size=N)=>validPoint(p,size)&&p.x>=0&&p.y>=0&&p.x<=size-1&&p.y<=size-1;
const validIds = values => Array.isArray(values) && values.length <= 9 && values.every(id => Number.isSafeInteger(id) && id > 0) && new Set(values).size === values.length;
const COURSE_IDS=new Set(['demo','empty',PARANA_ID]);

function restoreReference(raw,holeId,size=N){
  if(!raw||raw.courseId!==PARANA_ID||!Number.isSafeInteger(raw.sourceHoleId)||raw.sourceHoleId<1||raw.sourceHoleId>9||raw.sourceHoleId!==holeId)return null;
  if(!raw.publishedDistancesM||['club','blue','white','red'].some(key=>!Number.isFinite(raw.publishedDistancesM[key])||raw.publishedDistancesM[key]<=0||raw.publishedDistancesM[key]>2000))return null;
  if(!Number.isFinite(raw.geometryLengthM)||raw.geometryLengthM<=0||raw.geometryLengthM>4000||!Array.isArray(raw.axis)||raw.axis.length<2||raw.axis.length>64||raw.axis.some(p=>!validHolePoint(p,size)))return null;
  if(!raw.confidence||!['low','medium'].includes(raw.confidence.tee)||!['low','medium'].includes(raw.confidence.green)||raw.confidence.fairway!=='low'||typeof raw.featureSummary!=='string'||raw.featureSummary.length>500)return null;
  return {courseId:PARANA_ID,sourceHoleId:raw.sourceHoleId,publishedDistancesM:Object.fromEntries(['club','blue','white','red'].map(key=>[key,raw.publishedDistancesM[key]])),geometryLengthM:raw.geometryLengthM,axis:raw.axis.map(copyPoint),confidence:{tee:raw.confidence.tee,green:raw.confidence.green,fairway:raw.confidence.fairway},featureSummary:raw.featureSummary};
}

function restoreGolfer(raw, holes,size=N,version=8) {
  const point=p=>validPoint(p,size);
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id < 1 || !PHASES.has(raw.phase) || !point(raw) || !point(raw.ball)) return null;
  for (const key of ['strokes', 'mood', 'power', 'accuracy', 'recovery', 'phaseTime', '_stuck', '_commentUntil', '_admission']) if (!Number.isFinite(raw[key])) return null;
  if (!Number.isInteger(raw.strokes) || raw.strokes < 0 || raw.strokes > 13 || raw.mood < 0 || raw.mood > 100 || raw.power <= 0 || raw.power > 20 || raw.accuracy < 0 || raw.accuracy > 1 || raw.recovery < 0 || raw.recovery > 1 || raw.phaseTime < -1 || raw.phaseTime > 600 || raw._stuck < 0 || raw._stuck > 600 || raw._admission < 0 || raw._admission > 150) return null;
  const holeIndex = holes.findIndex(h => h.id === raw.holeId);
  if (!['leaving','riding','boarding'].includes(raw.phase) && !(raw.phase==='returningCart'&&Array.isArray(raw._plan)&&!raw._plan.length) && holeIndex < 0) return null;
  if (!validIds(raw._plan) || raw._plan.some(id => !holes.some(h => h.id === id)) || !validIds(raw._completed)) return null;
  if (!Array.isArray(raw.scores) || raw.scores.length > 9 || raw.scores.some(s => !s || !Number.isInteger(s.holeId) || !Number.isInteger(s.strokes) || s.strokes < 1 || s.strokes > 13 || ![3, 4, 5].includes(s.par))) return null;
  if (raw.lastScore !== null && (!Number.isInteger(raw.lastScore) || raw.lastScore < 1 || raw.lastScore > 13)) return null;
  if (raw._target !== null && !point(raw._target)) return null;
  if (raw._path !== null && (!Array.isArray(raw._path) || raw._path.length > size * size || raw._path.some(p => !point(p)))) return null;
  if (!Number.isInteger(raw._pathIndex) || raw._pathIndex < 0 || (raw._path && raw._pathIndex >= Math.max(1, raw._path.length))) return null;
  if(raw._manualShot!=null&&(!point(raw._manualShot.target)||!CLUBS[raw._manualShot.club]||!Number.isFinite(raw._manualShot.power)||raw._manualShot.power<(version<8?10:1)||raw._manualShot.power>100||version>=8&&(!SHOT_STYLES[raw._manualShot.style]||typeof raw._manualShot.legacy!=='boolean'||raw._manualShot.club==='putter'&&raw._manualShot.style!=='straight')))return null;
  if(version>=8&&typeof raw.carryClub!=='boolean')return null;
  if(raw._addressBall!=null&&!point(raw._addressBall))return null;
  let shot = null;
  if (raw.shot) {
    const s = raw.shot;
    if (!s || !point(s.from) || !point(s.to) || !Number.isFinite(s.duration) || s.duration <= 0 || s.duration > 30 || !Number.isFinite(s.elapsed) || s.elapsed < 0 || s.elapsed > s.duration || typeof s.penalty !== 'boolean' || typeof s.sunk !== 'boolean' || typeof s.putting !== 'boolean') return null;
    shot = { from: copyPoint(s.from), to: copyPoint(s.to), duration: s.duration, elapsed: s.elapsed, penalty: s.penalty, sunk: s.sunk, putting: s.putting,
      carry:point(s.carry)?copyPoint(s.carry):copyPoint(s.to),airDuration:Number.isFinite(s.airDuration)?s.airDuration:s.duration,rollDuration:Number.isFinite(s.rollDuration)?s.rollDuration:0 };
    if(s.carry!==undefined&&!point(s.carry))return null;
    if(shot.airDuration<0||shot.rollDuration<0||shot.airDuration+shot.rollDuration>30)return null;
    if(s.rollPath!==undefined){
      if(!Array.isArray(s.rollPath)||s.rollPath.length<2||s.rollPath.length>205||s.rollPath.some((p,i)=>!point(p)||!Number.isFinite(p.t)||p.t<0||p.t>shot.rollDuration||!Number.isFinite(p.lift)||p.lift<0||p.lift>.2||i>0&&p.t<=s.rollPath[i-1].t))return null;
      if(!Number.isFinite(s.fromHeight)||!Number.isFinite(s.carryHeight))return null;
      shot.rollPath=s.rollPath.map(p=>({...p}));shot.fromHeight=s.fromHeight;shot.carryHeight=s.carryHeight;
    }
    if(s.flightPath!==undefined){
      if(version<8||shot.putting||!Array.isArray(s.flightPath)||s.flightPath.length!==33||s.flightPath.some((p,i)=>!point(p)||!Number.isFinite(p.t)||p.t<0||p.t>shot.airDuration+.00001||!Number.isFinite(p.lift)||p.lift<0||p.lift>1.3||i>0&&p.t<=s.flightPath[i-1].t)||distance(s.flightPath[0],s.from)>.00001||distance(s.flightPath.at(-1),s.carry)>.00001||Math.abs(s.flightPath.at(-1).t-shot.airDuration)>.00001)return null;
      if(!SHOT_STYLES[s.style]||!s.wind||![s.wind.x,s.wind.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=6.1))return null;
      shot.flightPath=s.flightPath.map(p=>({...p}));shot.style=s.style;shot.wind={...s.wind};
    }
  } else if (raw.shot !== null) return null;
  let addressBall=raw._addressBall?copyPoint(raw._addressBall):null;
  if(raw._addressBall===undefined&&['aiming','preparing','swinging','watching'].includes(raw.phase)){
    if(shot)addressBall=copyPoint(shot.from);
    else if(raw.phase==='watching'&&raw._contactMade){
      const sign=Math.cos(raw.heading||0)-Math.sin(raw.heading||0)<0?-1:1;
      addressBall={x:raw.x+.16*sign,y:raw.y-.16*sign};
    }else addressBall=copyPoint(raw.ball);
  }
  return { id: raw.id, name: String(raw.name || 'Golfista').slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : COLORS[(raw.id - 1) % COLORS.length],
    x: raw.x, y: raw.y, ball: copyPoint(raw.ball), holeIndex, holeId: raw.holeId, strokes: raw.strokes,
    mood: raw.mood, power: raw.power, accuracy: raw.accuracy, recovery: raw.recovery,
    phase: raw.phase, phaseTime: raw.phaseTime, shot, lastScore: raw.lastScore, comment: String(raw.comment || '').slice(0, 160),
    scores: raw.scores.map(s => ({ holeId: s.holeId, name: String(s.name || '').slice(0, 40), strokes: s.strokes, par: s.par })),
    _plan: [...raw._plan], _completed: [...raw._completed], _path: raw._path ? raw._path.map(copyPoint) : null,
    _pathIndex: raw._pathIndex, _target: raw._target ? copyPoint(raw._target) : null, _stuck: raw._stuck,
    _commentUntil: raw._commentUntil, _admission: raw._admission,
    groupId:Number.isSafeInteger(raw.groupId)?raw.groupId:0,cartId:Number.isSafeInteger(raw.cartId)?raw.cartId:0,
    heading:Number.isFinite(raw.heading)?raw.heading:0,poseTime:Number.isFinite(raw.poseTime)?Math.max(0,raw.poseTime):0,
    actionDuration:Number.isFinite(raw.actionDuration)?Math.max(0,raw.actionDuration):0,
    _walkKind:String(raw._walkKind||'ball'),_contactMade:Boolean(raw._contactMade),_pendingHoleFinish:Boolean(raw._pendingHoleFinish),_isPutting:Boolean(raw._isPutting),_speed:Number.isFinite(raw._speed)?raw._speed:0,_resumePhase:String(raw._resumePhase||'walking'),
    carryClub:version>=8?raw.carryClub:!['riding','boarding'].includes(raw.phase),
    controlled:Boolean(raw.controlled),_manualShot:raw._manualShot?{target:copyPoint(raw._manualShot.target),club:raw._manualShot.club,power:raw._manualShot.power,style:raw._manualShot.style||'straight',legacy:version<8||Boolean(raw._manualShot.legacy)}:null,
    _addressBall:addressBall };
}

export class GolfSim {
  constructor({ empty = false,preset='demo' } = {}) { this.reset(empty,preset); }

  reset(empty = false,preset='demo') {
    if(!COURSE_IDS.has(preset))throw new RangeError('Elegí un campo disponible.');
    empty=empty||preset==='empty';
    this.courseId=empty?'empty':preset;
    this.courseRevision=preset===PARANA_ID&&!empty?3:0;
    this.coursePlanSize=preset===PARANA_ID&&!empty?N:0;
    this.coursePlan=null;
    this.tiles = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ type: 'grass' })));
    this.elevations=Array.from({length:N},()=>Array(N).fill(0));
    this.holes = [];
    this.golfers = [];
    this.groups = [];
    this.carts = [];this.cartBays=[];this.depotBays=[];this._freshCourse=!empty;
    this.playerRound = null;
    this.money = 15000;
    this.fee = 45;
    this.day = 1;
    this.time = 8;
    this.speed = 1;
    this.paused = false;
    this.satisfaction = 80;
    this.totalVisitors = 0;
    this.totalRevenue = 0;
    this.history = [];
    this.events = [];
    this.selectedGolferId = null;
    this.dayVisitors = 0;
    this.dayRevenue = 0;
    this._nextId = 1;
    this._nextHoleId = 1;
    this._arrival = 55;
    this._nextGroupId = 1;
    this._nextCartId = 1;
    this._clock = 0;
    this.weather={seed:Math.floor(Math.random()*4294967296),enabled:true};
    if (!empty) {
      if(preset===PARANA_ID){
        const course=createParanaCourse(N,3);
        this.tiles=course.tiles;this.elevations=course.elevations;this.holes=course.holes;this.coursePlan=course.plan;
        this._nextHoleId=Math.max(1,...this.holes.map(h=>h.id+1));
        this.connectCartPaths();
      }else this._demo();
      // An opening group makes the course lively immediately. These demo guests are complimentary.
      this._spawnGroup({complimentary:true,startHole:0});
      this._spawnGroup({complimentary:true,startHole:1});
      this._event('¡Bienvenido! Su primer grupo ya está en el campo.');
    } else this._event('Su terreno está listo. Dibuje un recorrido y abra su primer hoyo.');
    return this;
  }

  tile(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    x = Math.round(x); y = Math.round(y);
    return inside(x, y) ? this.tiles[y][x] : null;
  }
  windAt(clock=this._clock){return windAt(this.weather,clock)}

  heightAt(x,y){return this.bridgeAt(x,y)?.deckHeight??heightAt(this.elevations,x,y)}
  bridgeAt(x,y){return this.coursePlan?.bridges?.find(b=>{
    if(!b.waterCells.some(p=>p.x===Math.round(x)&&p.y===Math.round(y)))return false;
    const dx=b.to.x-b.from.x,dy=b.to.y-b.from.y,d=dx*dx+dy*dy,t=clamp(((x-b.from.x)*dx+(y-b.from.y)*dy)/d,0,1);
    return Math.hypot(x-b.from.x-dx*t,y-b.from.y-dy*t)<=b.widthCells/2+.00001;
  })||null}
  cartRoadAt(x,y){return this.tile(x,y)?.type==='path'||Boolean(this.bridgeAt(x,y))}
  navigationTiles(){
    if(!this.coursePlan?.bridges?.length)return this.tiles;
    const nav=this.tiles.map(row=>row.slice());for(const b of this.coursePlan.bridges)for(const p of b.waterCells)nav[p.y][p.x]={type:'path'};return nav;
  }
  _navigationEdge(a,b){
    if(this.tile(a.x,a.y)?.type!=='water'&&this.tile(b.x,b.y)?.type!=='water')return true;
    return Boolean(this.coursePlan?.bridges?.some(bridge=>[a,b].every(p=>{
      const dx=bridge.to.x-bridge.from.x,dy=bridge.to.y-bridge.from.y,d=dx*dx+dy*dy,t=((p.x-bridge.from.x)*dx+(p.y-bridge.from.y)*dy)/d;
      return t>=-.00001&&t<=1.00001&&Math.hypot(p.x-bridge.from.x-dx*t,p.y-bridge.from.y-dy*t)<=bridge.widthCells/2+.00001;
    })));
  }
  _depotCandidates(){if(this.depotBays.length)return this.depotBays.filter(p=>this.tile(p.x,p.y)?.type==='path').map(copyPoint);const result=[];for(let y=28;y<=32;y++)for(let x=6;x<=12;x++)if(this.cartRoadAt(x,y))result.push({x,y});return result}
  _physicalBays(){
    const cartBays=this.cartBays.filter(b=>this.holes.some(h=>h.id===b.holeId)&&b.slots.every(p=>this.tile(p.x,p.y)?.type==='path')),depotBays=[];
    for(let i=0;i<this.depotBays.length;i+=2)if(this.depotBays.slice(i,i+2).length===2&&this.depotBays.slice(i,i+2).every(p=>this.tile(p.x,p.y)?.type==='path'))depotBays.push(...this.depotBays.slice(i,i+2));
    return {cartBays,depotBays};
  }
  _pruneCartBays(){const bays=this._physicalBays();this.cartBays=bays.cartBays;this.depotBays=bays.depotBays;}
  slopeAt(x,y){return gradient((a,b)=>this.heightAt(a,b),x,y)}
  sculpt(x,y,delta){
    x=Math.round(x);y=Math.round(y);if(!inside(x,y)||!Number.isFinite(delta))return {ok:false,message:'Elegí un punto del terreno.'};
    if(this.tile(x,y).type==='water'||isClub(x,y))return {ok:false,message:'El agua y la casa club mantienen su nivel.'};
    const next=clamp(this.elevations[y][x]+delta,0,12);if(next===this.elevations[y][x])return {ok:true,unchanged:true,cost:0};
    if(this.money<12)return {ok:false,message:'Modificar el relieve cuesta $12 por casilla.'};
    this.money-=12;this.elevations[y][x]=next;return {ok:true,cost:12};
  }

  _demoRelief(){
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      const h=2+1.1*Math.sin(x*.18)+.7*Math.cos(y*.22)+4.5*Math.exp(-((x-25)**2+(y-13)**2)/85)+3.5*Math.exp(-((x-39)**2+(y-31)**2)/90)-1.5*Math.exp(-((x-15)**2+(y-23)**2)/40);
      this.elevations[y][x]=Math.round(clamp(h,.3,10)*100)/100;
    }
    // Water surfaces and the clubhouse/depot are level.
    const seen=new Set();
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(this.tiles[y][x].type==='water'&&!seen.has(y*N+x)){
      const queue=[{x,y}],level=this.elevations[y][x];seen.add(y*N+x);
      for(let i=0;i<queue.length;i++){const p=queue[i];this.elevations[p.y][p.x]=level;for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=p.x+dx,yy=p.y+dy,k=yy*N+xx;if(inside(xx,yy)&&!seen.has(k)&&this.tiles[yy][xx].type==='water'){seen.add(k);queue.push({x:xx,y:yy})}}}
    }
    for(let y=24;y<=31;y++)for(let x=3;x<=8;x++)this.elevations[y][x]=1.8;
    for(const h of this.holes){const level=this.heightAt(h.tee.x,h.tee.y);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(inside(h.tee.x+dx,h.tee.y+dy)&&this.tile(h.tee.x+dx,h.tee.y+dy).type!=='water')this.elevations[h.tee.y+dy][h.tee.x+dx]=level;}
  }

  paint(x, y, type) {
    x = Math.round(x); y = Math.round(y);
    if (!inside(x, y) || !TYPES.has(type)) return { ok: false, message: 'Seleccione un terreno válido.' };
    if (isClub(x, y)) return { ok: false, message: 'La casa club ocupa este terreno.' };
    if(type!=='path'&&this.carts.some(c=>{
      const next=c._path?.[c._pathIndex];
      if(next){const nx=Math.round(next.x),ny=Math.round(next.y),ax=nx+Math.sign(c.x-nx),ay=ny+Math.sign(c.y-ny);return x===nx&&y===ny||x===ax&&y===ay}
      return x>=Math.floor(c.x)&&x<=Math.ceil(c.x)&&y>=Math.floor(c.y)&&y<=Math.ceil(c.y);
    }))return {ok:false,message:'Esperá que el carrito salga antes de quitar ese camino.'};
    if (this.holes.some(h => (Math.round(h.tee.x) === x && Math.round(h.tee.y) === y) || (Math.round(h.green.x) === x && Math.round(h.green.y) === y))) return { ok: false, message: 'El tee y la bandera de un hoyo abierto están protegidos.' };
    if (this.tiles[y][x].type === type) return { ok: true, message: '', unchanged: true };
    const cost = COSTS[type];
    if (this.money < cost) return { ok: false, message: 'No hay presupuesto suficiente.' };
    this.money -= cost;
    this.tiles[y][x] = { type };
    this._pruneCartBays();
    // Paths are rebuilt on demand if an edit places water in a walking route.
    for (const g of this.golfers) g._path=null;
    for (const c of this.carts){c._path=null;delete c._routeRetryAt;delete c._routeAttemptAt;}
    return { ok: true, message: '', cost };
  }

  addHole(tee, green) {
    if (!tee || !green) return { ok: false, message: 'Seleccione un tee y una bandera.' };
    tee = { x: Math.round(tee.x), y: Math.round(tee.y) };
    green = { x: Math.round(green.x), y: Math.round(green.y) };
    if (!inside(tee.x, tee.y) || !inside(green.x, green.y) || isClub(tee.x, tee.y) || isClub(green.x, green.y)) return { ok: false, message: 'El hoyo debe estar dentro del terreno y fuera de la casa club.' };
    const d = distance(tee, green);
    if (d < 5) return { ok: false, message: 'Separe el tee y la bandera al menos 5 casillas.' };
    if (d > 36) return { ok: false, message: 'Este recorrido es demasiado largo para el campo.' };
    if (this.holes.length >= 9) return { ok: false, message: 'Este pequeño club admite hasta 9 hoyos.' };
    if (this.holes.some(h => [h.tee, h.green].some(p => distance(p, tee) < 2 || distance(p, green) < 2))) return { ok: false, message: 'Deje espacio entre los tees y las banderas de cada hoyo.' };
    if ([this.tile(tee.x, tee.y), this.tile(green.x, green.y)].some(t => t.type === 'water')) return { ok: false, message: 'El tee y la bandera necesitan terreno seco.' };
    const cost = 650;
    if (this.money < cost) return { ok: false, message: 'Abrir un hoyo requiere $650.' };
    this.money -= cost;
    const id = this._nextHoleId++;
    const hole = { id, name: `Hoyo ${id}`, tee, green, par: this._par(d) };
    this.holes.push(hole);
    this.tiles[tee.y][tee.x] = { type: 'tee' };
    this._disc(green.x, green.y, 1.35, 'green', true);
    this.tiles[green.y][green.x] = { type: 'green' };
    this._pruneCartBays();
    this._event(`${hole.name} abierto · par ${hole.par}.`);
    this._arrival = Math.min(this._arrival, 1);
    return { ok: true, message: `${hole.name} abierto.`, hole, cost };
  }

  removeHole(id) {
    const index = this.holes.findIndex(h => h.id === id);
    if (index < 0) return { ok: false, message: 'No se encontró ese hoyo.' };
    const removed = this.holes.splice(index, 1)[0];
    this.cartBays=this.cartBays.filter(b=>b.holeId!==id);
    for (const g of this.golfers) {g._plan=g._plan.filter(hid=>hid!==id);g.holeIndex=this.holes.findIndex(h=>h.id===g.holeId)}
    for (const group of this.groups) {
      group.plan=group.plan.filter(hid=>hid!==id);
      if(group.holeId===id&&group.phase!=='leaving') {
        const next=group.plan.find(hid=>!group.completed.includes(hid));
        group.actorId=null;
        if(next)group.holeId=next;
        else this._recordGroupRound(group);
        group.phase='returningCart';group.phaseTime=0;
        for(const g of this._members(group)){
          if(next){g.holeId=next;g.holeIndex=this.holes.findIndex(h=>h.id===next);}
          g.shot=null;g._manualShot=null;g._addressBall=null;g._pendingHoleFinish=false;
          const c=this.carts.find(c=>c.id===g.cartId);
          if(g.phase==='riding'){if(c.phase==='parked'||c._roadWaiting)this._phase(g,'boarding');}
          else if(g.phase!=='boarding')this._setWalk(g,c,'returningCart','cart');
        }
      }
    }
    this._event(`${removed.name} cerrado.`);
    return { ok: true, message: 'Hoyo cerrado. El terreno se conserva.' };
  }

  setFee(value) { this.fee = clamp(Math.round(Number(value) || 0), 5, 150); return this.fee; }

  startPlayerRound(name='Gastón') {
    if(this.playerRound?.status==='playing')return {ok:false,message:'Ya tenés una ronda en curso.'};
    if(!this.holes.length)return {ok:false,message:'Primero creá un hoyo para jugar.'};
    const free=this.holes.findIndex(h=>!this.groups.some(gr=>gr.holeId===h.id&&gr.phase!=='leaving'));
    const group=this._spawnGroup({complimentary:true,countVisits:false,startHole:Math.max(0,free)});
    if(!group)return {ok:false,message:'El campo está completo. Esperá que termine un grupo y volvé a intentarlo.'};
    const [g,rival]=this._members(group);
    g.name=String(name||'Gastón').trim().slice(0,24)||'Gastón';g.color='#edbc4b';g.controlled=true;g.power=10.5;g.accuracy=.95;g.recovery=.8;
    rival.name='Álex';rival.color='#819ed8';rival.accuracy=.8;
    this.playerRound={status:'playing',golferId:g.id,groupId:group.id,name:g.name,rivalName:rival.name,result:null};
    this.selectedGolferId=g.id;this.paused=false;this.speed=1;
    this._event(`${g.name} y ${rival.name}: comienza el partido.`);
    return {ok:true,message:'Tu golfista va hacia el tee. Elegí tus tiros cuando sea tu turno.'};
  }

  abandonPlayerRound() {
    if(this.playerRound?.status!=='playing')return false;
    const g=this.golfers.find(g=>g.id===this.playerRound.golferId);
    if(g){g.controlled=false;if(g.phase==='aiming')this._phase(g,'preparing',PACE.prepare)}
    this.playerRound.status='abandoned';return true;
  }

  previewPlayerShot(target,club='iron',power=100,style='straight') {
    const g=this.golfers.find(g=>g.id===this.playerRound?.golferId);
    if(this.playerRound?.status!=='playing')return null;
    return this._previewShot(g,target,club,power,style);
  }

  _previewShot(g,target,club,power,style='straight',legacy=false) {
    if(!g||!validPoint(target))return null;
    const plan=carryLength({from:g.ball,target,club,power,style,legacy,terrain:this.tile(g.ball.x,g.ball.y)?.type,height:(x,y)=>this.heightAt(x,y)});
    if(!plan)return null;
    const spec=legacy?LEGACY_CLUBS[club]||CLUBS[club]:CLUBS[club],wind=this.windAt(),flight=plan.putting?null:flightPath({from:g.ball,direction:plan.direction,length:plan.length,style,windAt:()=>legacy?{x:0,y:0}:wind,size:N});
    const calm=plan.putting?null:flightPath({from:g.ball,direction:plan.direction,length:plan.length,style,size:N});
    const carry=flight?.carry||copyPoint(g.ball),direction=flight?.direction||plan.direction;
    const roll=this._roll(carry,direction,plan.putting?plan.length:plan.length*spec.run*SHOT_STYLES[style].run+.03,plan.putting,this.holes.find(h=>h.id===g.holeId)?.green);
    return {...plan,to:carry,finish:roll.to,rollPath:roll.path,flightPath:flight?.path||null,noWindPath:calm?.path||null,wind,spread:plan.length*spec.spread,terrain:this.tile(roll.to.x,roll.to.y)?.type||'grass',limited:plan.aimDistance>plan.reach+.01};
  }
  _roll(start,direction,distance,putting,cup){return simulateRoll({start,direction,distance,putting,cup,size:N,height:(x,y)=>this.heightAt(x,y),terrain:(x,y)=>this.bridgeAt(x,y)?'path':this.tile(x,y)?.type||'grass'})}
  _launchShot(g,carry,direction,rollDistance,putting,hole,{flight=null,style='straight',legacy=false}={}){
    const from=copyPoint(g.ball),wind=this.windAt();
    if(!putting&&!legacy&&!flight)flight=flightPath({from,direction,length:distance(from,carry),style,windAt:t=>this.windAt(this._clock+t),size:N});
    const landing=putting?from:flight?.carry||carry,roll=this._roll(landing,flight?.direction||direction,rollDistance,putting,hole.green);
    const airDuration=putting?0:flight?.duration||1.65+distance(from,landing)*.13;
    g.strokes++;g.shot={from,to:roll.to,carry:copyPoint(landing),airDuration,rollDuration:roll.duration,duration:airDuration+roll.duration,elapsed:0,penalty:roll.penalty,sunk:roll.sunk,putting,
      rollPath:roll.path,fromHeight:this.heightAt(from.x,from.y),carryHeight:this.heightAt(landing.x,landing.y),...(flight?{flightPath:flight.path,style,wind:{x:wind.x,y:wind.y}}:{})};
  }

  playShot(target,club='iron',power=100,style='straight') {
    const g=this.golfers.find(g=>g.id===this.playerRound?.golferId);
    if(this.paused)return {ok:false,message:'Reanudá el juego antes de golpear.'};
    if(!g||g.phase!=='aiming')return {ok:false,message:'Esperá a que sea tu turno.'};
    if(!this.previewPlayerShot(target,club,power,style))return {ok:false,message:'Elegí dirección, palo, estilo y una fuerza entre 1 y 100%.'};
    g._manualShot={target:copyPoint(target),club,power,style,legacy:false};g._isPutting=club==='putter';
    this._setWalk(g,this._stance(g),'positioning');
    return {ok:true,message:'Alineando el tiro…'};
  }
  holeInfo(hole) {
    if (!hole || !hole.tee || !hole.green) return { distance: 0, par: 3, difficulty: 0, beauty: 0 };
    const d = distance(hole.tee, hole.green);
    let fairway = 0, rough = 0, hazards = 0, beauty = 0;
    const samples = Math.max(6, Math.ceil(d * 2));
    const scenery = new Set();
    for (let i = 0; i <= samples; i++) {
      const u = i / samples, x = hole.tee.x + (hole.green.x - hole.tee.x) * u, y = hole.tee.y + (hole.green.y - hole.tee.y) * u;
      const type = this.tile(x, y)?.type;
      if (['fairway', 'green', 'tee'].includes(type)) fairway++;
      else if (['water', 'sand', 'tree'].includes(type)) hazards += type === 'water' ? 2.5 : type === 'tree' ? 1.25 : 1;
      else rough++;
      for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
        const tx = Math.round(x) + ox, ty = Math.round(y) + oy;
        if (!inside(tx, ty)) continue;
        const t = this.tiles[ty][tx].type;
        if ((t === 'tree' || t === 'water' || t === 'sand') && !scenery.has(`${tx},${ty}`)) { scenery.add(`${tx},${ty}`); beauty += t === 'tree' ? 1.2 : t === 'water' ? 0.65 : 0.45; }
      }
    }
    const difficulty = clamp(Math.round(18 + d * 1.1 + hazards / (samples + 1) * 62 + rough / (samples + 1) * 28), 15, 100);
    return { distance: Math.round(d * 20), par: hole.par, difficulty, beauty: clamp(Math.round(38 + fairway / (samples + 1) * 32 + beauty), 0, 100) };
  }

  walkingConnection(fromHoleId,toHoleId){
    const from=this.holes.find(h=>h.id===fromHoleId)?.green,to=this.holes.find(h=>h.id===toHoleId)?.tee;
    if(!from||!to||this.tile(from.x,from.y)?.type==='water'||this.tile(to.x,to.y)?.type==='water')return null;
    const nav=this.navigationTiles();
    const start=Math.round(from.y)*N+Math.round(from.x),end=Math.round(to.y)*N+Math.round(to.x);
    const costs=new Float64Array(N*N);costs.fill(Infinity);costs[start]=0;
    const previous=new Int16Array(N*N);previous.fill(-1);const done=new Uint8Array(N*N);
    // This reference/debug connector is independent of carts and the live
    // itinerary. Measure the shortest dry walk, including true diagonal length.
    for(let i=0;i<N*N;i++){
      let current=-1,best=Infinity;for(let k=0;k<costs.length;k++)if(!done[k]&&costs[k]<best){best=costs[k];current=k}
      if(current<0||current===end)break;done[current]=1;
      const x=current%N,y=Math.floor(current/N);
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const nx=x+dx,ny=y+dy,k=ny*N+nx;
        if(!inside(nx,ny)||done[k]||nav[ny][nx].type==='water'||!this._navigationEdge({x,y},{x:nx,y:ny})||dx&&dy&&(nav[y][nx]?.type==='water'||nav[ny][x]?.type==='water'))continue;
        const next=best+Math.hypot(dx,dy);if(next<costs[k]){costs[k]=next;previous[k]=current}
      }
    }
    if(!Number.isFinite(costs[end]))return null;
    const points=[copyPoint(to),{x:end%N,y:Math.floor(end/N)}];
    for(let k=end;k!==start;){k=previous[k];points.push({x:k%N,y:Math.floor(k/N)})}
    points.push(copyPoint(from));points.reverse();
    const compact=points.filter((p,i)=>!i||distance(p,points[i-1])>.000001),length=compact.slice(1).reduce((sum,p,i)=>sum+distance(p,compact[i]),0);
    return {fromGreenId:fromHoleId,toTeeId:toHoleId,points:compact,lengthCells:length,geometryLengthM:length*20,estimatedSeconds:length/PACE.walk};
  }

  getStats() {
    const rounds = this.history.filter(r => r.type === 'round');
    const recent = rounds.slice(-20);
    return { holes: this.holes.length, active: this.golfers.filter(g => g.phase !== 'leaving').length,
      avgScore: recent.length ? Math.round(recent.reduce((s, r) => s + r.score, 0) / recent.length * 10) / 10 : 0,
      satisfaction: Math.round(this.satisfaction), money: Math.round(this.money), day: this.day, time: this.time,
      revenue: Math.round(this.totalRevenue), maintenance: this._maintenance(), visitors: this.totalVisitors,
      dayRevenue: Math.round(this.dayRevenue), dayVisitors: this.dayVisitors, rounds: rounds.length };
  }

  tick(dt) {
    if (this.paused || !Number.isFinite(dt) || dt <= 0) return;
    // Bounded substeps keep shots and movement stable after a background-tab pause.
    let remaining = Math.min(dt, 10) * clamp(Number(this.speed) || 0, 0, 12);
    while (remaining > 0.00001) {
      const step = Math.min(remaining, 0.12);
      this._step(step);
      remaining -= step;
    }
  }

  save() {
    const bays=this._physicalBays();
    return JSON.stringify({ version: 8, weather:this.weather, cartBays:bays.cartBays, depotBays:bays.depotBays, courseId:this.courseId,courseRevision:this.courseRevision,coursePlanSize:this.coursePlanSize, size:N, elevations:this.elevations, playerRound:this.playerRound, tiles: this.tiles, holes: this.holes, money: this.money, fee: this.fee,
      day: this.day, time: this.time, speed: this.speed, paused: this.paused, satisfaction: this.satisfaction,
      totalVisitors: this.totalVisitors, totalRevenue: this.totalRevenue, history: this.history,
      dayVisitors: this.dayVisitors, dayRevenue: this.dayRevenue, nextHoleId: this._nextHoleId, nextId: this._nextId,
      golfers: this.golfers, clock: this._clock, arrival: this._arrival, selectedGolferId: this.selectedGolferId, events: this.events,
      groups:this.groups,carts:this.carts,nextGroupId:this._nextGroupId,nextCartId:this._nextCartId });
  }

  load(json) {
    try {
      const data = JSON.parse(json);
      if (!data || ![1,2,3,4,5,6,7,8].includes(data.version) || !Array.isArray(data.tiles))return false;
      if(data.version>=6&&!COURSE_IDS.has(data.courseId))return false;
      if(data.version>=8&&(!data.weather||!Number.isSafeInteger(data.weather.seed)||data.weather.seed<0||data.weather.seed>4294967295||typeof data.weather.enabled!=='boolean'))return false;
      const savedSize=data.tiles.length;
      const allowedSize=data.version>=7?savedSize===N:data.version>=4?savedSize===PREVIOUS_N:[LEGACY_N,PREVIOUS_N].includes(savedSize);
      if(!allowedSize||(data.version>=4&&data.size!==savedSize)||data.tiles.some(row=>!Array.isArray(row)||row.length!==savedSize||row.some(t=>!t||!TYPES.has(t.type))))return false;
      const courseId=data.version>=6?data.courseId:(data.holes?.some(h=>h?.name==='La bienvenida')?'demo':'empty');
      const courseRevision=data.version>=7?data.courseRevision:courseId===PARANA_ID?1:0;
      const coursePlanSize=data.version>=7?data.coursePlanSize:courseId===PARANA_ID?PREVIOUS_N:0;
      if(courseId===PARANA_ID?!((courseRevision===1&&coursePlanSize===PREVIOUS_N)||([2,3].includes(courseRevision)&&coursePlanSize===N&&data.version>=(courseRevision===3?8:7))):courseRevision!==0||coursePlanSize!==0)return false;
      const hasRelief=Array.isArray(data.elevations);
      if(data.version>=5&&!hasRelief)return false;
      if(hasRelief&&(data.elevations.length!==savedSize||data.elevations.some(row=>!Array.isArray(row)||row.length!==savedSize||row.some(h=>!Number.isFinite(h)||h<0||h>12))))return false;
      const floatingCentres=data.version>=6&&data.courseId===PARANA_ID;
      if (!Array.isArray(data.holes) || data.holes.length > 9 || data.holes.some(h => !h || !Number.isSafeInteger(h.id) || h.id < 1 || !validHolePoint(h.tee,savedSize) || !validHolePoint(h.green,savedSize) || !floatingCentres&&(!inside(h.tee.x,h.tee.y)||!inside(h.green.x,h.green.y)) ||distance(h.tee, h.green) < 5 || ![3, 4, 5].includes(h.par))) return false;
      if (new Set(data.holes.map(h => h.id)).size !== data.holes.length) return false;
      const references=data.holes.map(h=>data.version<6||h.reference===undefined?undefined:restoreReference(h.reference,h.id,savedSize));
      if(references.some(r=>r===null)||references.some(r=>r!==undefined)&&data.courseId!==PARANA_ID)return false;
      for (const key of ['money', 'fee', 'day', 'time', 'satisfaction', 'totalVisitors', 'totalRevenue']) if (!Number.isFinite(data[key])) return false;
      const hasLiveState = Object.prototype.hasOwnProperty.call(data, 'golfers');
      let golfers = [];
      if (hasLiveState) {
        if (!Array.isArray(data.golfers) || data.golfers.length > 12 || !Number.isFinite(data.clock) || data.clock < 0 || !Number.isFinite(data.arrival) || data.arrival < 0 || data.arrival > 600) return false;
        golfers = data.golfers.map(g => restoreGolfer(g, data.holes,savedSize,data.version));
        if (golfers.some(g => !g) || new Set(golfers.map(g => g.id)).size !== golfers.length) return false;
      }
      if(data.version>=2&&!this._validGroups(data.groups,data.carts,golfers,data.holes,savedSize))return false;
      if(data.version<3&&golfers.some(g=>g.controlled||g.phase==='aiming'||g._manualShot))return false;
      const round=data.version>=3?data.playerRound:null;
      if(!this._validPlayerRound(round,golfers,data.groups))return false;
      const cartBays=data.version>=8?(data.cartBays===undefined?[]:data.cartBays):[];
      if(!Array.isArray(cartBays)||cartBays.length>9||new Set(cartBays.map(b=>b?.holeId)).size!==cartBays.length||cartBays.some(b=>!data.holes.some(h=>h.id===b?.holeId)||!Array.isArray(b.slots)||b.slots.length!==2||b.slots.some(p=>!validHolePoint(p,savedSize)||!Number.isInteger(p.x)||!Number.isInteger(p.y)||data.tiles[p.y][p.x].type!=='path')||distance(...b.slots)<CART_GAP))return false;
      const depotBays=data.version>=8?(data.depotBays===undefined?[]:data.depotBays):[];
      if(!Array.isArray(depotBays)||depotBays.length>6||depotBays.length%2||depotBays.some((p,i)=>!validHolePoint(p,savedSize)||!Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x>=LEGACY_N||p.y>=LEGACY_N||data.tiles[p.y][p.x].type!=='path'||depotBays.slice(0,i).some(q=>distance(p,q)<CART_GAP)||cartBays.some(b=>b.slots.some(q=>distance(p,q)<CART_GAP))))return false;
      const coursePlan=courseId===PARANA_ID?createParanaCourse(coursePlanSize,courseRevision).plan:null;
      this.reset(true);
      this.cartBays=cartBays.map(b=>({holeId:b.holeId,slots:b.slots.map(copyPoint)}));this.depotBays=depotBays.map(copyPoint);this.courseId=courseId;this.courseRevision=courseRevision;this.coursePlanSize=coursePlanSize;this.coursePlan=coursePlan;this.weather=data.version>=8?{...data.weather}:{seed:weatherHash(Math.round((data.clock||0)*1000)+(data.nextId||1)*7919),enabled:true};
      // Keep the old map in place; the extension is new, editable grass.
      for(let y=0;y<savedSize;y++)for(let x=0;x<savedSize;x++)this.tiles[y][x]={type:data.tiles[y][x].type};
      this.holes = data.holes.map((h,i) => ({ id: h.id, name: String(h.name || `Hoyo ${h.id}`).slice(0, 40), tee: copyPoint(h.tee), green: copyPoint(h.green), par: h.par,...(references[i]?{reference:references[i]}:{}) }));
      this.money = data.money;
      this.setFee(data.fee);
      this.day = Math.max(1, Math.floor(data.day));
      this.time = clamp(data.time, 8, 17.999);
      this.speed = clamp(Number(data.speed) || 1, 0.5, 12);
      this.paused = Boolean(data.paused);
      this.satisfaction = clamp(data.satisfaction, 0, 100);
      this.totalVisitors = Math.max(0, Math.floor(data.totalVisitors));
      this.totalRevenue = Math.max(0, data.totalRevenue);
      this.dayVisitors = Number.isFinite(data.dayVisitors) ? Math.max(0, Math.floor(data.dayVisitors)) : 0;
      this.dayRevenue = Number.isFinite(data.dayRevenue) ? Math.max(0, data.dayRevenue) : 0;
      this.history = Array.isArray(data.history) ? data.history.filter(r => r && typeof r === 'object').slice(-150) : [];
      this._nextHoleId = Math.max(1, ...this.holes.map(h => h.id + 1), Number.isSafeInteger(data.nextHoleId) ? data.nextHoleId : 1);
      this._nextId = Math.max(1, ...golfers.map(g => g.id + 1), Number.isSafeInteger(data.nextId) ? data.nextId : 1);
      this.golfers = golfers;
      if(data.version>=2){
        this.groups=JSON.parse(JSON.stringify(data.groups));this.carts=JSON.parse(JSON.stringify(data.carts));
        this._nextGroupId=Math.max(1,...this.groups.map(g=>g.id+1),Number(data.nextGroupId)||1);
        this._nextCartId=Math.max(1,...this.carts.map(c=>c.id+1),Number(data.nextCartId)||1);
      }
      this.playerRound=round?JSON.parse(JSON.stringify(round)):null;
      if(hasRelief){for(let y=0;y<savedSize;y++)for(let x=0;x<savedSize;x++)this.elevations[y][x]=data.elevations[y][x]}
      else if(this.holes.some(h=>h.name==='La bienvenida')){
        this._demoRelief();for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(x>=savedSize||y>=savedSize)this.elevations[y][x]=0;
      }
      if(data.version<5){
        this.connectCartPaths({parkingBays:false,compactDepot:true});
        // Road migration stays inside the old field; leave the new extension editable.
        for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(x>=savedSize||y>=savedSize)this.tiles[y][x]={type:'grass'};
        this.cartBays=this.cartBays.filter(b=>b.slots.every(p=>p.x<savedSize&&p.y<savedSize));this.depotBays=this.depotBays.filter(p=>p.x<savedSize&&p.y<savedSize);
      }
      if(data.version<8){
        // Recover only terminal branches already present in an older field.
        // Neither v8 metadata in an old payload nor newly painted bays are used.
        const nav=this.navigationTiles(),allowed=(x,y)=>x<savedSize&&y<savedSize&&this.tile(x,y)?.type==='path';
        this.cartBays=planCartBays(nav,this.holes,{allowed,preferred:h=>this._parkingDesired(h)}).bays;
        this.depotBays=planDepotBays(nav,{allowed,reserved:this.cartBays.flatMap(b=>b.slots)}).slots;
      }
      this._clock = hasLiveState ? data.clock : 0;
      this._arrival = hasLiveState ? data.arrival : 0.5;
      this.selectedGolferId = golfers.some(g => g.id === data.selectedGolferId) ? data.selectedGolferId : null;
      this.events = Array.isArray(data.events) ? data.events.filter(e => typeof e === 'string').map(e => e.slice(0, 200)).slice(-7) : [];
      if(data.version===1){
        // Old layouts/economy/history survive; old instant rounds become a fresh complimentary group.
        this.golfers=[];this.groups=[];this.carts=[];this.speed=1;this._arrival=55;
        if(this.holes.length)this._spawnGroup({complimentary:true,countVisits:false});
        this._event('Campo recuperado. Comienza una ronda con carritos y turnos.');
      }
      this._event(hasLiveState ? 'Partida recuperada. La ronda continúa donde la dejó.' : 'Partida recuperada. Los próximos golfistas llegarán en seguida.');
      if(savedSize<N)this._event('Tu campo ahora tiene 64×64 casillas. Tus hoyos y la ronda se conservaron.');
      return true;
    } catch { return false; }
  }

  _par(d) { return d < 13 ? 3 : d < 23 ? 4 : 5; }

  _validPlayerRound(round,golfers,groups) {
    const controlled=golfers.filter(g=>g.controlled);
    if(round==null)return !controlled.length&&!golfers.some(g=>g.phase==='aiming');
    if(!['playing','finished','abandoned'].includes(round.status)||!Number.isSafeInteger(round.golferId)||!Number.isSafeInteger(round.groupId)||typeof round.name!=='string'||typeof round.rivalName!=='string')return false;
    if(round.status==='playing') {
      const g=controlled[0],group=groups?.find(gr=>gr.id===round.groupId);
      if(controlled.length!==1||!g||g.id!==round.golferId||g.groupId!==round.groupId||!group?.members.includes(g.id)||round.result!==null)return false;
      if(golfers.some(p=>p.phase==='aiming'&&(p.id!==g.id||group.actorId!==g.id)))return false;
    } else if(controlled.length||golfers.some(g=>g.phase==='aiming'))return false;
    if(round.status==='finished') {
      const r=round.result;
      if(!r||![r.score,r.rivalScore,r.par].every(n=>Number.isSafeInteger(n)&&n>=0)||!Array.isArray(r.scores)||!Array.isArray(r.rivalScores))return false;
      for(const scores of [r.scores,r.rivalScores])if(scores.length>9||scores.some(s=>!s||!Number.isSafeInteger(s.holeId)||!Number.isInteger(s.strokes)||s.strokes<1||s.strokes>13||![3,4,5].includes(s.par)||typeof s.name!=='string'))return false;
    }else if(round.result!==null)return false;
    return true;
  }
  _event(message) { this.events.push(message); if (this.events.length > 8) this.events.shift(); }
  _disc(cx, cy, radius, type, protect = false) {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (!inside(x, y) || Math.hypot(x - cx, y - cy) > radius || isClub(x, y)) continue;
      if (protect && this.holes.some(h => Math.round(h.tee.x) === x && Math.round(h.tee.y) === y)) continue;
      this.tiles[y][x] = { type };
    }
  }
  _ribbon(points, width, type) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], steps = Math.ceil(distance(a, b) * 3);
      for (let j = 0; j <= steps; j++) this._disc(a.x + (b.x - a.x) * j / steps, a.y + (b.y - a.y) * j / steps, width, type);
    }
  }
  _roadAllowed(x,y){return inside(x,y)&&!isClub(x,y)&&!['water','green','tee'].includes(this.tile(x,y)?.type)&&!(this.courseId===PARANA_ID&&['fairway','sand'].includes(this.tile(x,y)?.type))}
  _roadLink(from,target,nearestNetwork=false,shortcut=false,preserveSize=0){
    const nav=this.navigationTiles();
    const allowed=(x,y)=>this._roadAllowed(x,y)&&(!(x<preserveSize&&y<preserveSize)||this.tile(x,y)?.type==='path');
    const sx=Math.round(from.x),sy=Math.round(from.y),tx=Math.round(target.x),ty=Math.round(target.y);
    if(!allowed(sx,sy)||!allowed(tx,ty))return false;
    const start=sy*N+sx,end=ty*N+tx,queue=[start],previous=new Int16Array(N*N);previous.fill(-1);previous[start]=start;
    if(nearestNetwork){
      for(let i=0;i<queue.length;i++)for(const p of roadNeighbors(nav,queue[i]%N,Math.floor(queue[i]/N))){const k=p.y*N+p.x;if(previous[k]<0){previous[k]=k;queue.push(k)}}
    }
    if(previous[end]>=0)return true;
    // Connect to the closest part of the existing network, rather than adding
    // a second loop. A fairway crossing costs much more than a rough shoulder.
    const costs=new Float64Array(N*N);costs.fill(Infinity);
    const heap=[];
    const push=(key,cost)=>{let i=heap.length;heap.push({key,cost});while(i){const p=(i-1)>>1;if(heap[p].cost<=cost)break;heap[i]=heap[p];i=p}heap[i]={key,cost}};
    const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].cost<heap[c].cost)c++;if(heap[c].cost>=last.cost)break;heap[i]=heap[c];i=c}heap[i]=last}return first};
    for(const k of queue){costs[k]=0;push(k,0)}
    while(heap.length){
      const {key:p,cost}=pop();if(cost!==costs[p])continue;if(p===end)break;
      const x=p%N,y=Math.floor(p/N);
      for(const q of roadNeighbors(nav,x,y,{requirePath:false})){
        if(!allowed(q.x,q.y))continue;
        const k=q.y*N+q.x,type=this.tile(q.x,q.y).type;
        const surface=type==='path'?(shortcut?.8:.05):type==='fairway'?28:type==='sand'?10:type==='tree'?1.6:1;
        const next=cost+surface*Math.hypot(q.x-x,q.y-y);
        if(next<costs[k]){costs[k]=next;previous[k]=p;push(k,next)}
      }
    }
    if(previous[end]<0)return false;
    const route=[];for(let p=end;;p=previous[p]){route.push({x:p%N,y:Math.floor(p/N)});if(previous[p]===p)break}
    if(shortcut){
      const old=this._findPath(from,target,true),length=(p,start)=>{let last=start;return p.reduce((sum,q)=>{const d=distance(last,q);last=q;return sum+d},0)};
      // Only add a lateral connection when the tree would otherwise send a
      // group around a long detour between consecutive holes.
      if(old&&length(old,from)<=length(route.reverse(),from)*1.5)return true;
    }
    for(const p of route)if(this.tile(p.x,p.y).type!=='water')this.tiles[p.y][p.x]={type:'path'};
    return true;
  }
  _parkingDesired(h,i=0){
    if(this.courseRevision===3&&[5,6].includes(h.id)){
      const points=this.coursePlan.routeFeatures.find(f=>f.holeIds.includes(5)&&f.holeIds.includes(6))?.points;
      if(points?.length){const index=points.reduce((best,p,j)=>distance(p,h.tee)<distance(points[best],h.tee)?j:best,0);return copyPoint(points[clamp(index+i*2,0,points.length-1)])}
    }
    const dx=h.green.x-h.tee.x,dy=h.green.y-h.tee.y,d=Math.hypot(dx,dy),slot=(i-.5)*2.4;
    const p={x:Math.round(h.tee.x-dx/d*2-dy/d*slot),y:Math.round(h.tee.y-dy/d*2+dx/d*slot)};
    if(this._roadAllowed(p.x,p.y))return p;
    for(let r=1;r<=3;r++)for(const [x,y]of [[p.x+r,p.y],[p.x-r,p.y],[p.x,p.y+r],[p.x,p.y-r]])if(this._roadAllowed(x,y))return {x,y};
    return p;
  }
  connectCartPaths({parkingBays=true,compactDepot=parkingBays&&(this._freshCourse||this.depotBays.length>0),preserveSize=0}={}){
    const root={x:7,y:29};if(!this._roadAllowed(root.x,root.y))return {ok:false,message:'Liberá la salida de la casa club para conectar los caminos.'};
    const allowed=(x,y)=>this._roadAllowed(x,y)&&(!(x<preserveSize&&y<preserveSize)||this.tile(x,y)?.type==='path'),link=(a,b,n=false,s=false)=>this._roadLink(a,b,n,s,preserveSize);
    for(let y=28;y<=(compactDepot?29:32);y++)for(let x=6;x<=12;x++)if(allowed(x,y))this.tiles[y][x]={type:'path'};
    for(const feature of this.coursePlan?.routeFeatures||[])for(const p of feature.points)if(allowed(p.x,p.y))this.tiles[p.y][p.x]={type:'path'};
    const stations=this.holes.map(h=>this._parkingDesired(h));
    // Short branches share one network. The playable holes keep centre stage.
    for(const h of this.holes){const p=this._parkingDesired(h);link(root,p,true);const q=this._parkingDesired(h,1);link(root,q,true)}
    for(let i=1;i<stations.length;i++)link(stations[i-1],stations[i],false,true);
    // Repair disconnected fragments of older ribbons without crossing water.
    const seen=new Set();
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(this.tile(x,y).type==='path'&&!seen.has(y*N+x)){
      const cells=[{x,y}];seen.add(y*N+x);
      for(let i=0;i<cells.length;i++)for(const p of roadNeighbors(this.tiles,cells[i].x,cells[i].y)){const k=p.y*N+p.x;if(!seen.has(k)){seen.add(k);cells.push(p)}}
      if(!this._findPath(root,{x,y},true))link(root,{x,y},true);
    }
    for(const c of this.carts){
      const current={x:Math.round(c.x),y:Math.round(c.y)};
      link(root,current,true);if(c._target)link(root,c._target,true);
      c._path=null;c._pathIndex=0;c._speed=0;delete c._routeRetryAt;delete c._routeAttemptAt;
    }
    for(const g of this.golfers){g._path=null;g._pathIndex=0}
    if(parkingBays){
      const bayAllowed=(x,y)=>allowed(x,y)&&['grass','tree','path'].includes(this.tile(x,y)?.type);
      const bays=planCartBays(this.navigationTiles(),this.holes,{allowed:bayAllowed,preferred:h=>this._parkingDesired(h),existingBays:this.cartBays,reservedSlots:this.depotBays});
      for(const p of bays.patches)this.tiles[p.y][p.x]={type:'path'};this.cartBays=bays.bays;
      const depot=planDepotBays(this.navigationTiles(),{allowed:bayAllowed,existingSlots:this.depotBays,reserved:this.cartBays.flatMap(b=>b.slots)});
      for(const p of depot.patches)this.tiles[p.y][p.x]={type:'path'};this.depotBays=depot.slots;
    }
    this._freshCourse=false;
    const unreachable=stations.filter(p=>!this._findPath(root,p,true)).length;
    this._event(unreachable?'Hay salidas sin camino de carritos; conectá un camino seco.':'Caminos de carritos conectados con la casa club y las salidas.');
    return {ok:true,message:unreachable?'Se conectó lo posible. Quedan salidas bloqueadas por el terreno.':'Caminos continuos conectados. Los carritos usan solo el camino.'};
  }
  refineCartPaths(){
    const root={x:7,y:29};if(!this._roadAllowed(root.x,root.y))return {ok:false,message:'Liberá la salida de la casa club para afinar los caminos.'};
    const before=this.tiles.map(row=>row.map(t=>t.type)),segments=[];
    for(const c of this.carts){
      const next=c._path?.[c._pathIndex];
      const p=next?{x:Math.round(next.x),y:Math.round(next.y)}:{x:Math.round(c.x),y:Math.round(c.y)};
      const a={x:p.x+Math.sign(c.x-p.x),y:p.y+Math.sign(c.y-p.y)};
      // Preserve both ends of the segment underneath a moving cart. Its next
      // waypoint is retained until it reaches the centre; no sideways jump.
      segments.push({cart:c,next:p,from:a,moving:Boolean(next)});
    }
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(before[y][x]==='path'){
      const same=type=>(before[y]?.[x-1]===type&&before[y]?.[x+1]===type)||(before[y-1]?.[x]===type&&before[y+1]?.[x]===type);
      this.tiles[y][x]={type:same('fairway')?'fairway':same('sand')?'sand':'grass'};
    }
    for(const s of segments)for(const p of [s.from,s.next,{x:Math.round(s.cart._target.x),y:Math.round(s.cart._target.y)}])if(this._roadAllowed(p.x,p.y))this.tiles[p.y][p.x]={type:'path'};
    const result=this.connectCartPaths({compactDepot:true});
    for(const s of segments)if(s.moving){const rest=this._findPath(s.next,s.cart._target,true);s.cart._path=rest?[copyPoint(s.next),...rest]:null;s.cart._pathIndex=0}
    this._event('Caminos afinados por los costados. Podés deshacer el rediseño.');
    return {...result,message:result.message.includes('bloqueadas')?`${result.message} Podés deshacer el rediseño.`:'Caminos más discretos junto a los hoyos. Podés deshacer el rediseño.'};
  }
  _parkingSlots(h,exceptIds=[]){
    const designated=this.cartBays.find(b=>b.holeId===h.id);
    if(designated?.slots.every(p=>this.tile(p.x,p.y)?.type==='path'))return chooseCartSlots(designated.slots,this.carts,{origin:this._parkingDesired(h),exceptIds});
    const candidates=[];for(let y=Math.max(0,Math.ceil(h.tee.y-6));y<=Math.min(N-1,Math.floor(h.tee.y+6));y++)for(let x=Math.max(0,Math.ceil(h.tee.x-6));x<=Math.min(N-1,Math.floor(h.tee.x+6));x++)if(this.cartRoadAt(x,y)&&!this.bridgeAt(x,y)&&distance({x,y},h.tee)<=6)candidates.push({x,y});
    return chooseCartSlots(candidates,this.carts,{origin:this._parkingDesired(h),exceptIds});
  }
  _demo() {
    for (const [x, y, r] of [[16, 18, 2.8], [17, 20, 2.1], [15, 4, 2.2], [13, 4, 1.4], [29, 7, 1.8]]) this._disc(x, y, r, 'water');
    // Tree positions are deterministic; gameplay randomness does not alter the starting landscape.
    for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) if ((x * 37 + y * 19) % 31 < 3 && this.tiles[y][x].type === 'grass') this.tiles[y][x] = { type: 'tree' };
    this._ribbon([{ x: 6, y: 23 }, { x: 10, y: 24 }, { x: 14, y: 25 }, { x: 17, y: 25 }], 1.6, 'fairway');
    this._ribbon([{ x: 23, y: 25 }, { x: 24, y: 21 }, { x: 25, y: 16 }, { x: 25, y: 12 }], 1.6, 'fairway');
    this._ribbon([{ x: 24, y: 8 }, { x: 21, y: 8 }, { x: 17, y: 9 }, { x: 12, y: 8 }, { x: 7, y: 8 }], 1.55, 'fairway');
    for (const [x, y, r] of [[15, 27, 1.2], [19, 24, 1], [23, 16, 1.2], [27, 12, 1], [10, 10, 1.2], [20, 6, 1]]) this._disc(x, y, r, 'sand');
    const definitions = [
      { name: 'La bienvenida', tee: { x: 6, y: 23 }, green: { x: 17, y: 25 } },
      { name: 'El mirador', tee: { x: 23, y: 25 }, green: { x: 25, y: 12 } },
      { name: 'Entre palmeras', tee: { x: 24, y: 8 }, green: { x: 7, y: 8 } }
    ];
    this.holes = definitions.map((h, i) => ({ ...h, id: i + 1, par: this._par(distance(h.tee, h.green)) }));
    this._nextHoleId = 4;
    for (const h of this.holes) { this._disc(h.green.x, h.green.y, 1.45, 'green'); this.tiles[h.tee.y][h.tee.x] = { type: 'tee' }; }
    this.addPracticeHoles();
    this._demoRelief();
  }

  addPracticeHoles() {
    const definitions=[
      {name:'La laguna',tee:{x:34,y:10},green:{x:43,y:18},route:[{x:34,y:10},{x:38,y:15},{x:43,y:18}]},
      {name:'El bosque',tee:{x:43,y:26},green:{x:35,y:34},route:[{x:43,y:26},{x:40,y:30},{x:35,y:34}]},
      {name:'La vuelta',tee:{x:28,y:38},green:{x:17,y:40},route:[{x:28,y:38},{x:23,y:40},{x:17,y:40}]}
    ];
    // Refuse to overwrite anything a player has built in the extension.
    if(this.holes.length>6||definitions.some(d=>this.holes.some(h=>distance(h.tee,d.tee)<3||distance(h.green,d.green)<3)))return {ok:false,message:'No hay espacio para los tres hoyos de práctica.'};
    const region=(x,y)=>x>=32||y>=32;
    const used=this.tiles.some((row,y)=>row.some((t,x)=>region(x,y)&&t.type!=='grass'));
    if(used)return {ok:false,message:'Ya editaste la ampliación. Podés crear tus hoyos con Nuevo hoyo sin reemplazar lo construido.'};
    for(let y=4;y<46;y++)for(let x=4;x<46;x++)if(region(x,y)&&(x*37+y*19)%43<3)this.tiles[y][x]={type:'tree'};
    for(const d of definitions){
      this._ribbon(d.route,1.65,'fairway');
      this._disc(d.green.x,d.green.y,1.45,'green');this.tiles[d.tee.y][d.tee.x]={type:'tee'};
      this.holes.push({id:this._nextHoleId++,name:d.name,tee:copyPoint(d.tee),green:copyPoint(d.green),par:this._par(distance(d.tee,d.green))});
    }
    this._disc(40,10,2,'water');this._disc(37,23,1.7,'water');
    for(const [x,y]of [[44,17],[36,33],[18,38]])this._disc(x,y,1,'sand');
    for(const g of this.golfers)g._path=null;for(const c of this.carts)c._path=null;
    this._event('Tres nuevos hoyos de práctica. Las rondas nuevas incluyen el recorrido ampliado.');
    this.connectCartPaths({parkingBays:this._freshCourse||this.cartBays.length>0,compactDepot:true,preserveSize:this._freshCourse?0:32});
    return {ok:true,message:'Tres hoyos agregados. Tu campo anterior y los partidos en curso se conservan.'};
  }

  _validGroups(groups,carts,golfers,holes,size=N){
    const point=p=>validPoint(p,size);
    if(!Array.isArray(groups)||groups.length>6||!Array.isArray(carts)||carts.length>12)return false;
    const gp=new Set(['queued','driving','parking','disembarking','gathering','playing','walking','finishing','returningCart','boarding','leaving']);
    const cp=new Set(['driving','parked','blocked']);
    const ids=new Set(golfers.map(g=>g.id)),allMembers=[];
    for(const c of carts){
      if(!Number.isSafeInteger(c.id)||c.id<1||!point(c)||!point(c._target)||!cp.has(c.phase)||!ids.has(c.golferId)||!Number.isFinite(c.heading)||!Number.isFinite(c._speed)||!Number.isFinite(c._stuck)||!Number.isInteger(c._pathIndex)||c._pathIndex<0)return false;
      if(c._trafficGoal!=null&&!point(c._trafficGoal)||c._trafficWinner!=null&&!Number.isSafeInteger(c._trafficWinner)||c._trafficWaiting!=null&&typeof c._trafficWaiting!=='boolean'||c._bridgeWaypoints!=null&&(!Array.isArray(c._bridgeWaypoints)||c._bridgeWaypoints.length>2||c._bridgeWaypoints.some(p=>!point(p))))return false;
      if(c._path!==null&&(!Array.isArray(c._path)||c._path.length>size*size||c._path.some(p=>!point(p))))return false;
    }
    if(new Set(carts.map(c=>c.id)).size!==carts.length)return false;
    for(const g of groups){
      if(!Number.isSafeInteger(g.id)||g.id<1||!gp.has(g.phase)||!Array.isArray(g.members)||g.members.length<1||g.members.length>4||g.members.some(id=>!ids.has(id))||!validIds(g.plan)||g.plan.some(id=>!holes.some(h=>h.id===id))||!validIds(g.completed))return false;
      if(g.phase!=='leaving'&&!(['returningCart','boarding'].includes(g.phase)&&!g.plan.length)&&!holes.some(h=>h.id===g.holeId))return false;
      if(!Number.isFinite(g.phaseTime)||g.phaseTime<0||g.phaseTime>600||!Number.isFinite(g.startedAt)||!Number.isFinite(g.cooldown)||!Array.isArray(g.played)||g.played.some(id=>!g.members.includes(id))||!Array.isArray(g.order)||g.order.some(id=>!g.members.includes(id)))return false;
      if(g.actorId!==null&&!g.members.includes(g.actorId))return false;
      for(const id of g.members){const player=golfers.find(p=>p.id===id),cart=carts.find(c=>c.id===player.cartId);if(player.groupId!==g.id||!cart||cart.groupId!==g.id||cart.golferId!==id)return false;}
      allMembers.push(...g.members);
    }
    return new Set(groups.map(g=>g.id)).size===groups.length&&allMembers.length===golfers.length&&new Set(allMembers).size===golfers.length&&carts.length===golfers.length;
  }

  _members(group){return group.members.map(id=>this.golfers.find(g=>g.id===id)).filter(Boolean)}
  _phase(g,phase,duration=0){g.phase=phase;g.poseTime=0;g.actionDuration=duration;g.phaseTime=duration}
  _spawnGroup({complimentary=false,startHole=0,countVisits=true}={}){
    if(!this.holes.length||this.groups.length>=6||this.golfers.length>10)return;
    const candidates=this.depotBays.length?this._depotCandidates():this._depotCandidates().filter(p=>(p.x-6)%3===0&&(p.y-28)%3===0),gap=this.depotBays.length?CART_GAP:2.8;
    // Keep a pair for returning players. The three opening groups leave their
    // bays straight away, so starting a personal round at clock0 remains valid.
    if(this.depotBays.length&&!complimentary&&chooseCartSlots(candidates,this.carts,{count:4,gap}).length<4)return;
    const origins=chooseCartSlots(candidates,this.carts,{origin:{x:7,y:29},gap});if(origins.length<2)return;
    const plan=this.holes.slice(startHole).concat(this.holes.slice(0,startHole)).map(h=>h.id);
    const group={id:this._nextGroupId++,members:[],plan,completed:[],holeId:plan[0],phase:'queued',phaseTime:0,actorId:null,played:[],order:[],cooldown:0,startedAt:this._clock};
    this.groups.push(group);
    for(let i=0;i<2;i++){
      const id=this._nextId++,cartId=this._nextCartId++,origin=origins[i];
      const g={id,name:NAMES[(id-1)%NAMES.length],color:COLORS[(id-1)%COLORS.length],x:origin.x,y:origin.y,ball:copyPoint(origin),holeIndex:startHole,holeId:plan[0],strokes:0,
        mood:clamp(82+(Math.random()-.5)*10-Math.max(0,this.fee-55)*.28,35,95),power:5.7+Math.random()*2.4,accuracy:.58+Math.random()*.35,recovery:.5+Math.random()*.45,
        phase:'riding',phaseTime:0,poseTime:0,actionDuration:0,heading:0,groupId:group.id,cartId,shot:null,lastScore:null,comment:'Vamos al tee.',scores:[],_plan:[...plan],_completed:[],_path:null,_pathIndex:0,_target:null,_stuck:0,_speed:0,_walkKind:'ball',_contactMade:false,_pendingHoleFinish:false,_isPutting:false,_resumePhase:'walking',_commentUntil:this._clock+6,_admission:complimentary?0:this.fee,controlled:false,_manualShot:null,_addressBall:null,carryClub:false};
      const cart={id:cartId,groupId:group.id,golferId:id,x:origin.x,y:origin.y,heading:0,phase:'parked',_target:copyPoint(origin),_path:null,_pathIndex:0,_speed:0,_stuck:0};
      this.golfers.push(g);this.carts.push(cart);group.members.push(id);
      if(countVisits){this.totalVisitors++;this.dayVisitors++}
      if(!complimentary){this.money+=this.fee;this.totalRevenue+=this.fee;this.dayRevenue+=this.fee}
    }
    this._event(`${this._members(group).map(g=>g.name).join(' y ')} llegan en sus carritos.`);
    return group;
  }
  _dryPoint(p){
    p={x:clamp(p.x,.4,N-1.4),y:clamp(p.y,.4,N-1.4)};
    if(!['water','tree'].includes(this.tile(p.x,p.y)?.type))return p;
    for(let r=1;r<5;r++)for(const [dx,dy]of [[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,-r]]){
      const q={x:clamp(p.x+dx,.4,N-1.4),y:clamp(p.y+dy,.4,N-1.4)};
      if(!['water','tree'].includes(this.tile(q.x,q.y)?.type))return q;
    }
    return p;
  }
  _retrievalPoint(c){
    for(const along of [-25,-24,-26])for(const across of [0,-4,4]){
      const p=clubRetrievalPoint(c,{along,across});
      if(validPoint(p)&&this.tile(p.x,p.y)?.type!=='water')return p;
    }
    return null;
  }
  _plannedCartTrip(cart,target,bridgeWaypoints=[]){
    const trip={...cart,phase:'driving',_target:copyPoint(target),_path:null,_pathIndex:0,_bridgeWaypoints:bridgeWaypoints.map(copyPoint)};
    delete trip._trafficGoal;delete trip._trafficWaiting;delete trip._trafficWinner;
    trip._path=this._cartPath(trip);return trip._path?trip:null;
  }
  _trafficTripBusy(groupId){
    // Narrow neighbouring lanes are closer than the cart clearance, even when
    // their centre lines do not intersect. One pair reserves a transfer while
    // the other groups keep playing or wait in their off-road bays.
    return this.carts.some(c=>c.groupId!==groupId&&!c._roadWaiting&&(c.phase==='driving'||c.phase==='blocked'&&c._path?.length));
  }
  _commitCartTrips(trips){
    for(const trip of trips){
      const cart=this.carts.find(c=>c.id===trip.id);
      cart._target=copyPoint(trip._target);cart._path=trip._path.map(copyPoint);cart._pathIndex=0;cart._bridgeWaypoints=trip._bridgeWaypoints.map(copyPoint);cart.phase='driving';cart._speed=0;
      for(const key of ['_roadWaiting','_routeRetryAt','_routeAttemptAt','_trafficGoal','_trafficWaiting','_trafficWinner','_trafficCheckAt'])delete cart[key];
    }
    // Two parked partners can approach the same trunk from opposite spur
    // mouths. Reserve it for one; the other waits in its own real bay.
    if(trips.length===2){
      const conflict=cartConflict(trips[0],trips[1]);if(conflict?.headOn){
        const loser=this.carts.find(c=>c.id===trips.find(t=>t.id!==conflict.winnerId).id);
        loser._trafficGoal=copyPoint(loser._target);loser._trafficWinner=conflict.winnerId;loser._trafficWaiting=true;loser._target=copyPoint(loser);loser._path=null;
      }
    }
  }
  _beginGroupHole(group,hole){
    if(this._clock<(group._tripRetryAt||0))return false;
    if(this._trafficTripBusy(group.id)){group._tripRetryAt=this._clock+.6;return false;}
    const own=this.carts.filter(c=>c.groupId===group.id),parking=this._parkingSlots(hole,own.map(c=>c.id));
    if(parking.length<2){
      const designated=this.cartBays.find(b=>b.holeId===hole.id),missing=designated?designated.slots.some(p=>this.tile(p.x,p.y)?.type!=='path'):this._parkingSlots(hole,this.carts.map(c=>c.id)).length<2;
      if(missing)for(let i=0;i<own.length;i++){
        const c=own[i],g=this.golfers.find(g=>g.id===c.golferId);c.phase='blocked';c._roadWaiting=true;c._target=copyPoint(designated?.slots[i]||this._parkingDesired(hole,i));c._path=null;c._pathIndex=0;c._speed=0;
        if(g&&g.comment!=='Conectá un camino seco hasta las plazas del tee.')this._comment(g,'Conectá un camino seco hasta las plazas del tee.');
      }
      return false;
    }
    const bridgeWaypoints=group.completed.at(-1)===6&&hole.id===7&&this.coursePlan?.bridges?.length?[copyPoint(this.coursePlan.bridges[0].to),copyPoint(this.coursePlan.bridges[0].from)]:[];
    const trips=own.map((c,i)=>this._plannedCartTrip(c,parking[i],bridgeWaypoints));
    if(trips.some(t=>!t)||this._trafficTripBusy(group.id)){group._tripRetryAt=this._clock+.6;return false;}
    delete group._tripRetryAt;
    this._commitCartTrips(trips);
    group.phase='driving';group.startedAt=this._clock;group.phaseTime=0;group.actorId=null;group.played=[];group.order=[...group.members];group.cooldown=0;
    const dx=hole.green.x-hole.tee.x,dy=hole.green.y-hole.tee.y,d=Math.hypot(dx,dy),normal={x:-dy/d,y:dx/d};
    const info=this.holeInfo(hole);

    this._members(group).forEach((g,i)=>{
      const cart=this.carts.find(c=>c.id===g.cartId),slot=(i-.5)*1.25;
      const park=parking[i];
      g.holeId=hole.id;g.holeIndex=this.holes.findIndex(h=>h.id===hole.id);g.strokes=0;g.ball={x:hole.tee.x+normal.x*(i-.5)*.16,y:hole.tee.y+normal.y*(i-.5)*.16};
      g.shot=null;g._addressBall=null;g._manualShot=null;g._path=null;g._pendingHoleFinish=false;g._contactMade=false;g.carryClub=false;this._phase(g,'riding');g.mood=clamp(g.mood+(info.beauty-65)*.06,10,100);
    });
  }
  _setWalk(g,target,phase='walking',kind='ball'){
    this._phase(g,phase);g._target=copyPoint(target);g._path=null;g._pathIndex=0;g._speed=0;g._stuck=0;g._walkKind=kind;
  }
  _stance(g){
    const h=this.holes.find(h=>h.id===g.holeId),aim=g._manualShot?.target||h?.green,left=aim&&(aim.x-aim.y)<(g.ball.x-g.ball.y),sign=left?-1:1;
    for(const offset of [.16,.12,.08,.04])for(const side of [sign,-sign]){
      const p={x:g.ball.x-offset*side,y:g.ball.y+offset*side};
      if(validPoint(p)&&this.tile(p.x,p.y)?.type!=='water')return p;
    }
    return this._dryPoint(g.ball);
  }
  _startTurn(group,g){
    if(g.controlled&&g.strokes>=11){group.actorId=g.id;g._pendingHoleFinish=true;this._endTurn(group,g);this._comment(g,'Límite de golpes: cerramos este hoyo.');return;}
    group.actorId=g.id;g._isPutting=this._aiPutting(g,this.holes.find(h=>h.id===g.holeId));
    g._contactMade=false;g._pendingHoleFinish=false;
    g._manualShot=null;
    this._setWalk(g,this._stance(g),'positioning');
    this._comment(g,g.strokes===0?'Mi turno. Vamos con calma.':'Alineando el próximo tiro.');
  }
  _endTurn(group,g){
    if(g._pendingHoleFinish){const h=this.holes.find(h=>h.id===g.holeId);if(h)this._finishHole(g,h)}else this._phase(g,'afterShot');
    group.played.push(g.id);group.actorId=null;group.cooldown=PACE.turnGap;
  }
  _recordGroupRound(group){
    if(group._roundRecorded)return;
    if(this.playerRound?.status==='playing'&&this.playerRound.groupId===group.id){
      const g=this.golfers.find(g=>g.id===this.playerRound.golferId),rival=this._members(group).find(p=>p.id!==g.id);
      this.playerRound.status='finished';
      this.playerRound.result={score:g.scores.reduce((n,s)=>n+s.strokes,0),par:g.scores.reduce((n,s)=>n+s.par,0),rivalScore:rival.scores.reduce((n,s)=>n+s.strokes,0),scores:g.scores.map(s=>({...s})),rivalScores:rival.scores.map(s=>({...s}))};
      g.controlled=false;
    }
    group._roundRecorded=true;group.actorId=null;
    for(const g of this._members(group))this._finishRound(g,{recordOnly:true});
  }
  _departGroup(group){
    this._recordGroupRound(group);
    const destinations=chooseCartSlots(this._depotCandidates(),this.carts,{origin:{x:7,y:29},exceptIds:this.carts.filter(c=>c.groupId===group.id).map(c=>c.id)});if(destinations.length<2){group.phase='boarding';group.phaseTime=1;return false;}
    const own=this.carts.filter(c=>c.groupId===group.id),trips=own.map((c,i)=>this._plannedCartTrip(c,destinations[i]));
    if(trips.some(t=>!t)||this._trafficTripBusy(group.id)){group.phase='boarding';group.phaseTime=1;return false;}
    this._commitCartTrips(trips);group.phase='leaving';group.actorId=null;for(const g of this._members(group))this._phase(g,'riding');
  }
  _resolveParkingCycle(){
    if(!this.depotBays.length||this.groups.length<2||!this.groups.every(g=>g.phase==='queued')||this.carts.some(c=>c.phase!=='parked'))return;
    // With one pair at every hole, each next tee can be occupied by the pair
    // waiting for its own next tee. Move one pair to a free real depot bay;
    // this vacates a parking branch and releases the circular queue.
    for(const group of [...this.groups].sort((a,b)=>a.id-b.id)){
      if(!group.completed.length||group._queueTransfer)continue;
      const own=this.carts.filter(c=>c.groupId===group.id);
      if(own.some(c=>this.depotBays.some(p=>distance(c,p)<.01)))continue;
      const slots=chooseCartSlots(this.depotBays,this.carts,{exceptIds:own.map(c=>c.id),origin:{x:7,y:29}});if(slots.length<2)return;
      const trips=own.map((c,i)=>this._plannedCartTrip(c,slots[i]));if(trips.some(t=>!t))continue;
      this._commitCartTrips(trips);group._queueTransfer=true;delete group._tripRetryAt;
      for(const g of this._members(group))this._comment(g,'Esperamos un momento en las plazas de la casa club.');
      return;
    }
  }
  _step(dt){
    this._clock+=dt;this.time+=dt*.009;if(this.time>=18)this._closeDay();
    if(this.holes.length){this._arrival-=dt;if(this._arrival<=0){this._spawnGroup();this._arrival=(55+Math.random()*15)*(1+Math.max(0,this.fee-55)/55)}}
    for(const c of this.carts)if((c.phase==='driving'||c.phase==='blocked')&&!c._path&&!c._trafficWaiting&&!c._roadWaiting&&this._clock>=(c._routeRetryAt||0)){
      c._path=this._cartPath(c);c._pathIndex=0;c._routeAttemptAt=this._clock;
      if(c._path)delete c._routeRetryAt;else c._routeRetryAt=this._clock+1.2;
    }
    for(const c of this.carts)if((c.phase==='driving'||c.phase==='blocked')&&!c._roadWaiting){
      if(this._move(c,dt,PACE.cart)){c.phase='parked';c._speed=0}
      const rider=this.golfers.find(g=>g.id===c.golferId);if(rider?.phase==='riding'){rider.x=c.x;rider.y=c.y;rider.heading=c.heading}
    }
    for(const g of this.golfers){
      g.poseTime+=dt;
      if(g._commentUntil<this._clock)g.comment='';
      if(g.shot){g.shot.elapsed=Math.min(g.shot.duration,g.shot.elapsed+dt);if(g.shot.elapsed>=g.shot.duration)this._land(g)}
      if(['disembarking','positioning','walking','returningCart','blocked'].includes(g.phase)){
        if(g.phase==='blocked'&&!g._target&&g._walkKind==='bag'){const p=this._retrievalPoint(this.carts.find(c=>c.id===g.cartId));if(!p)continue;this._setWalk(g,p,'disembarking','bag');}
      const moving=g.phase==='blocked'?g._resumePhase:g.phase;
        if(this._move(g,dt,PACE.walk)){
          if(moving==='positioning'){const h=this.holes.find(h=>h.id===g.holeId),aim=g._manualShot?.target||h.green;g._addressBall=copyPoint(g.ball);g.heading=Math.atan2(aim.y-g.ball.y,aim.x-g.ball.x);this._phase(g,g.controlled&&!g._manualShot?'aiming':'preparing',g.controlled&&!g._manualShot?0:PACE.prepare);}
          else if(moving==='disembarking'&&g._walkKind==='bag'){
            const c=this.carts.find(c=>c.id===g.cartId),bag=cartBagAnchor(c);g.heading=Math.atan2(bag.y-g.y,bag.x-g.x);this._phase(g,'retrievingClub',CLUB_RETRIEVE_SECONDS);
          }
          else if(moving==='returningCart'){g.carryClub=false;this._phase(g,'boarding');}
          else this._phase(g,g._walkKind==='finished'?'holed':'waiting');
        }
      }else if(g.phase==='retrievingClub'){
        if(g.poseTime>=g.actionDuration){
          g.carryClub=true;const h=this.holes.find(h=>h.id===g.holeId),members=this._members(this.groups.find(gr=>gr.id===g.groupId)),i=members.findIndex(m=>m.id===g.id);
          this._setWalk(g,this._dryPoint({x:h.tee.x-.8+i*.8,y:h.tee.y+.85}),'disembarking','tee');
        }
      }else if(g.phase==='preparing'){
        if(g.poseTime>=g.actionDuration){this._phase(g,'swinging',g._isPutting?PACE.putt:PACE.swing);g._contactMade=false}
      }else if(g.phase==='swinging'){
        const contactTime=g.actionDuration*CONTACT_FRACTION;
        if(!g._contactMade&&g.poseTime>=contactTime){
          const endTime=g.poseTime;g.poseTime=contactTime;g._contactMade=true;this._hit(g);g.poseTime=endTime;
          if(g.shot)g.shot.elapsed=Math.min(g.shot.duration,endTime-contactTime);
        }
        if(g.poseTime>=g.actionDuration)this._phase(g,'watching',PACE.watch);
      }else if(g.phase==='watching'&&g.poseTime>=g.actionDuration&&!g.shot){
        const group=this.groups.find(gr=>gr.id===g.groupId);if(group)this._endTurn(group,g);
      }
    }
    for(const group of [...this.groups]){
      const members=this._members(group),carts=this.carts.filter(c=>c.groupId===group.id),hole=this.holes.find(h=>h.id===group.holeId);
      if(!members.length)continue;
      if(group.phase==='queued'){
        if(group._queueTransfer){if(!carts.every(c=>c.phase==='parked'))continue;delete group._queueTransfer;}
        const busy=this.groups.some(other=>other.id!==group.id&&other.holeId===group.holeId&&!['queued','leaving'].includes(other.phase));
        const older=this.groups.some(other=>other.id<group.id&&other.holeId===group.holeId&&other.phase==='queued');
        if(!busy&&!older&&hole)this._beginGroupHole(group,hole);
      }else if(group.phase==='driving'&&carts.every(c=>c.phase==='parked')){group.phase='parking';group.phaseTime=PACE.park}
      else if(group.phase==='parking'){
        group.phaseTime=Math.max(0,group.phaseTime-dt);
        if(!group.phaseTime){group.phase='disembarking';members.forEach(g=>{
          const c=carts.find(c=>c.id===g.cartId),point=this._retrievalPoint(c);
          if(point)this._setWalk(g,point,'disembarking','bag');
          else{this._phase(g,'blocked');g._resumePhase='disembarking';g._target=null;g._walkKind='bag';this._comment(g,'Liberá un paso detrás de la bolsa del carrito.');}
        });}
      }else if(group.phase==='disembarking'&&members.every(g=>g.phase==='waiting')){group.phase='gathering';group.phaseTime=PACE.gather;this._comment(members[0],'¿Quién empieza?')}
      else if(group.phase==='gathering'){
        group.phaseTime=Math.max(0,group.phaseTime-dt);if(!group.phaseTime){group.phase='playing';group.cooldown=.5}
      }else if(group.phase==='playing'&&!group.actorId){
        group.cooldown=Math.max(0,group.cooldown-dt);if(group.cooldown)continue;
        if(members.every(g=>g.phase==='holed')){group.phase='finishing';group.phaseTime=4;continue}
        const candidate=group.order.map(id=>members.find(g=>g.id===id)).find(g=>g&&g.phase==='waiting'&&!group.played.includes(g.id));
        if(candidate)this._startTurn(group,candidate);
        else if(members.every(g=>['afterShot','holed'].includes(g.phase))){
          group.phase='walking';for(const g of members){if(g.phase==='afterShot')this._setWalk(g,this._stance(g));else if(distance(g,hole.green)>.5)this._setWalk(g,this._dryPoint({x:hole.green.x+.6,y:hole.green.y+.6}),'walking','finished')}
        }
      }else if(group.phase==='walking'&&members.every(g=>['waiting','holed'].includes(g.phase))){group.phase='playing';group.played=[];group.order=[...members].sort((a,b)=>distance(b.ball,hole.green)-distance(a.ball,hole.green)).map(g=>g.id);group.cooldown=1}
      else if(group.phase==='finishing'){
        group.phaseTime=Math.max(0,group.phaseTime-dt);
        if(!group.phaseTime){
          const duration=this._clock-group.startedAt;this.history.push({type:'hole',groupId:group.id,holeId:group.holeId,day:this.day,duration:Math.round(duration),members:members.map(g=>({name:g.name,strokes:g.strokes}))});this.history=this.history.slice(-150);
          this._event(`${hole.name}: ${Math.floor(duration/60)} min ${Math.round(duration%60)} s · grupo completo.`);group.completed.push(group.holeId);group.phase='returningCart';
          if(!group.plan.some(id=>!group.completed.includes(id)&&this.holes.some(h=>h.id===id)))this._recordGroupRound(group);
          for(const g of members){const c=this.carts.find(c=>c.id===g.cartId);this._setWalk(g,c,'returningCart','cart')}
        }
      }else if(group.phase==='returningCart'){
        for(const g of members)if(g.phase==='riding'&&carts.find(c=>c.id===g.cartId)?.phase==='parked')this._phase(g,'boarding');
        if(members.every(g=>g.phase==='boarding')){group.phase='boarding';group.phaseTime=PACE.board;}
      }
      else if(group.phase==='boarding'){
        group.phaseTime=Math.max(0,group.phaseTime-dt);if(!group.phaseTime){const next=group.plan.find(id=>!group.completed.includes(id)&&this.holes.some(h=>h.id===id));if(next){group.holeId=next;group.phase='queued';for(const g of members)this._phase(g,'riding')}else this._departGroup(group)}
      }else if(group.phase==='leaving'&&carts.every(c=>c.phase==='parked')){
        this.golfers=this.golfers.filter(g=>g.groupId!==group.id);this.carts=this.carts.filter(c=>c.groupId!==group.id);this.groups=this.groups.filter(g=>g.id!==group.id);if(!this.golfers.some(g=>g.id===this.selectedGolferId))this.selectedGolferId=null;
      }
    }
    this._resolveParkingCycle();
  }
  _move(entity,dt,maxSpeed){
    const target=entity._target;if(!target)return true;
    const cartOnly=Number.isSafeInteger(entity.golferId);
    if(cartOnly&&!entity._path&&!entity._trafficWaiting&&this._clock<(entity._routeRetryAt||0)&&entity._routeAttemptAt!==this._clock)return false;
    const nav=this.navigationTiles();
    if(cartOnly&&entity._trafficWaiting){
      if(this._clock<(entity._trafficCheckAt||0))return false;entity._trafficCheckAt=this._clock+.6;
      const winner=this.carts.find(c=>c.id===entity._trafficWinner),resume=this._findPath(entity,entity._trafficGoal,true);
      if(winner&&resume&&cartConflict({...entity,_path:resume,_pathIndex:0},winner)?.headOn)return false;
      entity._target=entity._trafficGoal;delete entity._trafficGoal;delete entity._trafficWaiting;delete entity._trafficWinner;delete entity._trafficCheckAt;entity._path=null;return false;
    }
    if(cartOnly&&entity._path){
      const points=[entity,...entity._path.slice(entity._pathIndex)];
      if(points.some((p,i)=>{
        if(!this.cartRoadAt(p.x,p.y))return true;
        if(!i)return false;
        const a={x:Math.round(points[i-1].x),y:Math.round(points[i-1].y)},b={x:Math.round(p.x),y:Math.round(p.y)};
        return (a.x!==b.x||a.y!==b.y)&&(!roadEdgeAllowed(nav,a,b)||!this._navigationEdge(points[i-1],p));
      })||!entity._trafficGoal&&points.some((p,i)=>i>0&&!cartEdgeClear(points[i-1],p,this.carts,{exceptIds:[entity.id]})))entity._path=null;
    }
    if(!entity._path){
      if(!cartOnly||entity._routeAttemptAt!==this._clock){entity._path=cartOnly?this._cartPath(entity):this._findPath(entity,target);entity._pathIndex=0;}
      if(cartOnly){entity._routeAttemptAt=this._clock;if(entity._path)delete entity._routeRetryAt;else entity._routeRetryAt=this._clock+1.2;}
    }
    if(!entity._path){
      if(entity.phase!=='blocked'){entity._resumePhase=entity.phase;entity.phase='blocked';if(entity.name)this._comment(entity,'Necesito un camino libre.');else{const group=this.groups.find(gr=>gr.id===entity.groupId);if(group)for(const g of this._members(group))this._comment(g,'Conectá el camino de carritos hasta la salida.')}}
      entity._stuck+=dt;if(entity._stuck>4){entity._stuck=0;entity._path=null}return false;
    }
    if(cartOnly)delete entity._routeAttemptAt;
    if(entity.phase==='blocked')entity.phase=entity._resumePhase||'driving';
    const waypoint=entity._path[entity._pathIndex]||target,d=distance(entity,waypoint),last=entity._pathIndex===entity._path.length-1;
    const desired=maxSpeed*(last?clamp(d/.6,.28,1):1);entity._speed=Math.min(desired,(entity._speed||0)+dt*.6);
    let step=entity._speed*dt;
    if(cartOnly){
      const limit=cartAdvanceLimit(entity,waypoint,step,this.carts);step=limit.advance;
      if(limit.reason){
        entity._speed=0;entity._trafficWait=(entity._trafficWait||0)+dt;
        if(limit.yieldTo&&!entity._trafficGoal){
          const winner=this.carts.find(c=>c.id===limit.yieldTo),path=findCartYieldRoute(nav,entity,winner,this.carts);
          if(path){entity._trafficGoal=copyPoint(target);entity._trafficWinner=winner.id;entity._target=copyPoint(path.at(-1));entity._path=path;entity._pathIndex=0;return false;}
        }
      }else entity._trafficWait=0;
    }
    if(d<=step+(cartOnly?0:.002)){
      entity.x=waypoint.x;entity.y=waypoint.y;
      if(cartOnly&&entity._bridgeWaypoints?.length&&distance(waypoint,entity._bridgeWaypoints[0])<.001)entity._bridgeWaypoints.shift();
      if(!last)entity._pathIndex++;else{entity._path=null;entity._speed=0;if(cartOnly&&entity._trafficGoal){entity._trafficWaiting=true;return false}return true}
    }
    else{const aim=Math.atan2(waypoint.y-entity.y,waypoint.x-entity.x),turn=Math.atan2(Math.sin(aim-entity.heading),Math.cos(aim-entity.heading));entity.heading+=clamp(turn,-dt*4,dt*4);entity.x+=(waypoint.x-entity.x)/d*step;entity.y+=(waypoint.y-entity.y)/d*step}
    return false;
  }
  _cartPath(c){
    let from=c,result=[];
    for(const target of [...(c._trafficGoal?[]:c._bridgeWaypoints||[]),c._target]){
      const part=this._findPath(from,target,true,(a,b)=>cartEdgeClear(a,b,this.carts,{exceptIds:[c.id]}));if(!part)return null;result.push(...part);from=target;
    }return result;
  }

  _aiPutting(g,hole){
    if(!hole)return false;
    const d=distance(g.ball,hole.green),type=this.tile(g.ball.x,g.ball.y)?.type;
    const lie=type==='sand'?.25:type==='tree'?.45:type==='grass'?.8:1;
    return d<=CLUBS.putter.range*lie&&(type==='green'||d<.6);
  }

  _axisTarget(hole,from,reach){
    const axis=hole?.reference?.axis;if(!Array.isArray(axis)||axis.length<2||reach<=0)return null;
    let nearest=null,progress=0,total=0;const segments=[];
    for(let i=1;i<axis.length;i++){
      const a=axis[i-1],b=axis[i],length=distance(a,b);if(length<.001)continue;
      const u=clamp(((from.x-a.x)*(b.x-a.x)+(from.y-a.y)*(b.y-a.y))/(length*length),0,1),point={x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u},off=distance(from,point);
      segments.push({a,b,length,start:total});
      if(!nearest||off<nearest.off-.0001||Math.abs(off-nearest.off)<.0001&&total+length*u>progress){nearest={point,off};progress=total+length*u}
      total+=length;
    }
    if(!nearest)return null;
    if(nearest.off>=reach){const u=reach/nearest.off;return {x:from.x+(nearest.point.x-from.x)*u,y:from.y+(nearest.point.y-from.y)*u}}
    const goal=Math.min(total,progress+reach-nearest.off),segment=segments.find(s=>s.start+s.length>=goal)||segments.at(-1),u=clamp((goal-segment.start)/segment.length,0,1);
    return {x:segment.a.x+(segment.b.x-segment.a.x)*u,y:segment.a.y+(segment.b.y-segment.a.y)*u};
  }
  _aiAim(g,hole,from,length){
    const d=distance(from,hole.green),angle=Math.atan2(hole.green.y-from.y,hole.green.x-from.x),candidates=[];
    for(const offset of [0,-.22,.22,-.42,.42])candidates.push({x:clamp(from.x+Math.cos(angle+offset)*length,.5,N-1.5),y:clamp(from.y+Math.sin(angle+offset)*length,.5,N-1.5)});
    const along=this._axisTarget(hole,from,length);if(along)candidates.push(along);
    // Read the expected finish, including wind and run. A close approach may
    // need to land short; dispersion is still applied to the chosen shot.
    if(length>=d-.5)for(const fraction of [.85,.7])candidates.push({x:clamp(from.x+Math.cos(angle)*length*fraction,.5,N-1.5),y:clamp(from.y+Math.sin(angle)*length*fraction,.5,N-1.5)});
    let best=candidates[0],bestScore=Infinity;
    for(const p of candidates){
      const reach=distance(from,p),direction={x:(p.x-from.x)/Math.max(.001,reach),y:(p.y-from.y)/Math.max(.001,reach)},rise=this.heightAt(p.x,p.y)-this.heightAt(from.x,from.y);
      const carry={x:clamp(p.x-direction.x*rise*.12,.1,N-1.1),y:clamp(p.y-direction.y*rise*.12,.1,N-1.1)},flight=flightPath({from,direction,length:distance(from,carry),windAt:t=>this.windAt(this._clock+t),size:N});
      const roll=this._roll(flight.carry,flight.direction,reach*.07+.03,false,hole.green),type=this.tile(roll.to.x,roll.to.y)?.type;
      const risk=roll.penalty?12:type==='tree'?3.4:type==='sand'?2.3:type==='grass'?.7:0,score=distance(roll.to,hole.green)+risk*g.recovery;
      if(score<bestScore){best=p;bestScore=score;}
    }
    return best;
  }

  _hit(g) {
    const hole = this.holes.find(h => h.id === g.holeId);
    if (!hole) { this._finishRound(g); return; }
    const from = copyPoint(g.ball), d = distance(from, hole.green), type = this.tile(from.x, from.y)?.type || 'grass';
    if (g.strokes >= 11) { g._pendingHoleFinish=true; return; }
    if(g._manualShot){this._hitPlayer(g,hole);return;}
    const putting = this._aiPutting(g,hole);
    let to, sunk = false;
    if (putting) {
      const chance = clamp(0.4 + g.accuracy * 0.55 - d * 0.35, 0.25, 0.97);
      sunk = d < 0.08 || Math.random() < chance;
      if (sunk) to = copyPoint(hole.green);
      else {
        // A short missed putt stays near the hole; long putts and lower skill
        // produce a wider error instead of the former fixed 5–18 m miss.
        const angle = Math.random() * Math.PI * 2, radius = .025 + Math.random() * (.025+d*(.12+(1-g.accuracy)*.4));
        to = { x: hole.green.x + Math.cos(angle) * radius, y: hole.green.y + Math.sin(angle) * radius };
      }
    } else {
      const multiplier = type === 'sand' ? 0.36 + g.recovery * 0.24 : type === 'tree' ? 0.45 : type === 'grass' ? 0.76 : 1;
      const length = Math.min(d, g.power * multiplier * (0.94 + Math.random() * 0.12));
      const best=this._aiAim(g,hole,from,length);
      const spread = (1 - g.accuracy) * (length * 0.45 + 0.35) * (type === 'tree' ? 1.8 : 1);
      to = { x: clamp(best.x + (Math.random() + Math.random() - 1) * spread, 0.1, N - 1.1), y: clamp(best.y + (Math.random() + Math.random() - 1) * spread, 0.1, N - 1.1) };
      if (distance(to, hole.green) < 0.13 && Math.random() < 0.16) sunk = true;
    }
    const targetLength=distance(from,to),direction={x:(to.x-from.x)/Math.max(.001,targetLength),y:(to.y-from.y)/Math.max(.001,targetLength)};
    let length=putting?Math.min(targetLength,CLUBS.putter.range):targetLength;
    if(putting){
      // Choose pace on the visible slope; the chance above still determines
      // the aim error, and the actual ball must pass the physical cup.
      const lie=type==='sand'?.25:type==='tree'?.45:type==='grass'?.8:1,reach=CLUBS.putter.range*lie;
      let best=Infinity;
      for(let i=0;i<=12;i++){
        const candidate=Math.min(reach,Math.max(.005,targetLength*(.7+i*.05))),roll=this._roll(from,direction,candidate,true,hole.green),score=distance(roll.to,to)+(roll.penalty?12:0);
        if(score<best){best=score;length=candidate;}
      }
    }
    if(!putting){const rise=this.heightAt(to.x,to.y)-this.heightAt(from.x,from.y);to={x:clamp(to.x-direction.x*rise*.12,.1,N-1.1),y:clamp(to.y-direction.y*rise*.12,.1,N-1.1)}}
    this._launchShot(g,to,direction,putting?length:length*.07+.03,putting,hole);
    if (type === 'sand') this._comment(g, 'A salir del bunker…');
    else if (type === 'tree') this._comment(g, '¡Ese árbol no estaba en el plan!');
  }

  _hitPlayer(g,hole) {
    const plan=g._manualShot,preview=this._previewShot(g,plan.target,plan.club,plan.power,plan.style,plan.legacy);
    if(!preview)return;
    const spec=plan.legacy?LEGACY_CLUBS[plan.club]||CLUBS[plan.club]:CLUBS[plan.club],from=copyPoint(g.ball),baseAngle=Math.atan2(plan.target.y-from.y,plan.target.x-from.x),lie=this.slopeAt(from.x,from.y);
    const angle=baseAngle+(Math.random()+Math.random()-1)*spec.spread*.65+(lie.x*Math.sin(baseAngle)-lie.y*Math.cos(baseAngle))*.015;
    const error=1+(Math.random()+Math.random()-1)*spec.spread*(this.tile(from.x,from.y)?.type==='sand'?1.8:1);
    const length=preview.length*error,direction={x:Math.cos(angle),y:Math.sin(angle)};
    const carry=preview.putting?copyPoint(from):{x:clamp(from.x+direction.x*length,.1,N-1.1),y:clamp(from.y+direction.y*length,.1,N-1.1)};
    const flight=preview.putting||plan.legacy?null:flightPath({from,direction,length,style:plan.style,windAt:t=>this.windAt(this._clock+t),size:N});
    this._launchShot(g,carry,direction,preview.putting?length:length*spec.run*SHOT_STYLES[plan.style].run+.03,preview.putting,hole,{flight,style:plan.style,legacy:plan.legacy});
    this._comment(g,`${CLUBS[plan.club].name} · ${Math.round(length*20)} m${plan.style!=='straight'?' · '+SHOT_STYLES[plan.style].name:''}${preview.deltaHeight>.5?' · subida':preview.deltaHeight<-.5?' · bajada':''}`);
  }
  _land(g) {
    const shot = g.shot;
    const hole = this.holes.find(h => h.id === g.holeId);
    if (!shot || !hole) { this._finishRound(g); return; }
    if (shot.penalty) {
      g.strokes++;
      g.ball = copyPoint(shot.from);
      g.mood = clamp(g.mood - 7, 10, 100);
      this._comment(g, 'Al agua… +1 de penalidad.');
    } else {
      g.ball = copyPoint(shot.to);
      const type = this.tile(g.ball.x, g.ball.y)?.type;
      if (type === 'sand') { g.mood = clamp(g.mood - 2, 10, 100); this._comment(g, 'Visita al bunker.'); }
      else if (type === 'green' && !shot.putting) { g.mood = clamp(g.mood + 2, 10, 100); this._comment(g, '¡Buen approach!'); }
    }
    g.shot = null;
    if (shot.sunk && !shot.penalty) g._pendingHoleFinish=true;
  }

  _findPath(from, target, cartOnly=false, edgeAllowed) {
    if(this.tile(target.x,target.y)?.type==='water'&&!this.bridgeAt(target.x,target.y))return null;
    if(cartOnly&&(!this.cartRoadAt(from.x,from.y)||!this.cartRoadAt(target.x,target.y)))return null;
    const sx = clamp(Math.round(from.x), 0, N - 1), sy = clamp(Math.round(from.y), 0, N - 1);
    const tx = clamp(Math.round(target.x), 0, N - 1), ty = clamp(Math.round(target.y), 0, N - 1);
    const start = sy * N + sx, end = ty * N + tx;
    if (start === end) return [copyPoint(target)];
    if(cartOnly){
      const result=shortestRoadPath(this.navigationTiles(),{x:sx,y:sy},{x:tx,y:ty},{edgeAllowed:(a,b)=>this._navigationEdge(a,b)&&(!edgeAllowed||edgeAllowed(a,b))});if(!result)return null;
      if(distance(from,{x:sx,y:sy})>.001)result.unshift({x:sx,y:sy});
      result[result.length-1]=copyPoint(target);return result;
    }
    const nav=this.navigationTiles();
    const queue = [start], previous = new Int16Array(N * N); previous.fill(-1); previous[start] = start;
    for (let i = 0; i < queue.length && previous[end] === -1; i++) {
      const current = queue[i], x = current % N, y = Math.floor(current / N);
      const neighbors=[[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([dx,dy])=>({x:x+dx,y:y+dy}));
      for (const {x:nx,y:ny} of neighbors) {
        const ox=nx-x,oy=ny-y;
        const next = ny * N + nx;
        if (!inside(nx, ny) || previous[next] !== -1 || next!==end&&nav[ny][nx].type==='water') continue;
        if(!this._navigationEdge({x,y},{x:nx,y:ny}))continue;
        if (ox && oy && (nav[y][nx].type === 'water' || nav[ny][x].type === 'water')) continue;
        previous[next] = current; queue.push(next);
      }
    }
    if (previous[end] === -1) return null;
    const result = [];
    for (let current = end; current !== start; current = previous[current]) result.push({ x: current % N, y: Math.floor(current / N) });
    result.reverse();
    result[result.length - 1] = copyPoint(target);
    return result;
  }

  _finishHole(g, hole) {
    g.lastScore = g.strokes;
    g.scores.push({ holeId: hole.id, name: hole.name, strokes: g.strokes, par: hole.par });
    g._completed.push(hole.id);
    const delta = g.strokes - hole.par;
    g.mood = clamp(g.mood + (delta < 0 ? 6 : delta === 0 ? 3 : -Math.min(8, delta * 2)), 10, 100);
    const text = delta <= -2 ? '¡Eagle!' : delta === -1 ? '¡Birdie!' : delta === 0 ? '¡Par!' : delta === 1 ? 'Bogey. El siguiente será mejor.' : `${g.strokes} golpes. ¡Qué recorrido!`;
    this._comment(g, text);
    g.ball = copyPoint(hole.green);
    this._phase(g,'holed',2.3);
    g.shot = null;
  }

  _finishRound(g,{recordOnly=false}={}) {
    if (g.phase === 'leaving') return;
    const score = g.scores.reduce((s, h) => s + h.strokes, 0), par = g.scores.reduce((s, h) => s + h.par, 0);
    if (g.scores.length) {
      this.satisfaction = clamp(this.satisfaction * 0.92 + g.mood * 0.08, 0, 100);
      this.history.push({ type: 'round', id: g.id, name: g.name, day: this.day, score, par, mood: Math.round(g.mood), holes: g.scores.length, scores: g.scores.map(s => ({ ...s })) });
      this.history = this.history.slice(-150);
      if (g.id % 3 === 0) this._event(`${g.name}: ${score} golpes (${score - par >= 0 ? '+' : ''}${score - par}). ${g.mood >= 75 ? '¡Volveré!' : 'Buen desafío.'}`);
    }
    if(recordOnly)return;
    g.phase = 'leaving';
    g.shot = null;
    g._target = copyPoint(club);
    g._path = null;
    g._stuck = 0;
    this._comment(g, g.mood >= 75 ? '¡Nos vemos en la próxima ronda!' : 'Hora de un café.');
  }

  _comment(g, text) { g.comment = text; g._commentUntil = this._clock + 6; }
  _maintenance() {
    const rates = { grass: 0, fairway: 0.6, green: 1.4, sand: 0.3, water: 0.15, tree: 0.08, path: 0.12, tee: 1 };
    let cost = this.holes.length * 30;
    for (const row of this.tiles) for (const tile of row) cost += rates[tile.type] || 0;
    return Math.round(cost);
  }
  _closeDay() {
    const maintenance = this._maintenance();
    this.money -= maintenance;
    this.history.push({ type: 'day', day: this.day, revenue: Math.round(this.dayRevenue), visitors: this.dayVisitors, maintenance, profit: Math.round(this.dayRevenue - maintenance) });
    this.history = this.history.slice(-150);
    this._event(`Día ${this.day}: $${Math.round(this.dayRevenue)} de ingresos · $${maintenance} de mantenimiento.`);
    this.day++;
    this.time = 8;
    this.dayVisitors = 0;
    this.dayRevenue = 0;
  }
}
