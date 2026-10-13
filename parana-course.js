import {PARANA_BLUEPRINT as source} from './parana-data.js?v=13';
import {unifyFairways} from './course-raster.js?v=13';
import {createParanaRevision3Infrastructure,applyParanaRevision3Relief} from './parana-relief.js?v=13';

export const PARANA_ID = source.course_id;
export const PARANA_TITLE = source.title;
const METRES_PER_CELL = 20;

// Revision1 is the exact Prueba10 projection. Revision2 fits the real contours;
// revision3 uses that same geometry with the user's relative relief and routes.
export function paranaProjection(size=64,revision=2) {
  if(!Number.isInteger(size)||size<16)throw new RangeError('Course size must be an integer >=16');
  if(![1,2,3].includes(revision))throw new RangeError('Unknown Paraná geometry revision');
  const sourceBounds=revision===1?{minX:0,maxX:1232,minY:0,maxY:1600,width:1232,height:1600,centerX:616,centerY:800}:BLUEPRINT_BOUNDS;
  const scale=(size-8)/sourceBounds.height,center=(size-1)/2,t7=source.holes.find(h=>h.id===7).tee.center_px;
  const sx=sourceBounds.centerX,sy=sourceBounds.centerY;
  const base={x:center+(t7[0]-sx)*scale,y:center+(t7[1]-sy)*scale};
  const gridOffset={x:Math.round(base.x)-base.x,y:Math.round(base.y)-base.y};
  const cx=center+gridOffset.x,cy=center+gridOffset.y;
  return {scale,gridOffset,sourceBounds:{...sourceBounds},revision,toWorld:([x,y])=>({x:cx+(x-sx)*scale,y:cy+(y-sy)*scale}),toImage:({x,y})=>[(x-cx)/scale+sx,(y-cy)/scale+sy]};
}
export function pointInPolygon(point,polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
const lengthOf=points=>points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
const distanceToSegment=(p,a,b)=>{
  const dx=b.x-a.x,dy=b.y-a.y,denominator=dx*dx+dy*dy;
  const t=denominator?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/denominator)):0;
  return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);
};
const nearPolygon=(p,polygon,margin=0)=>pointInPolygon(p,polygon)||polygon.some((a,i)=>distanceToSegment(p,a,polygon[(i+1)%polygon.length])<=margin);
function rectangle(center,size,angle){
  const cos=Math.cos(angle),sin=Math.sin(angle);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:center.x+x*size.x*.5*cos-y*size.y*.5*sin,y:center.y+x*size.x*.5*sin+y*size.y*.5*cos}));
}
function ellipse(center,radii,angle){
  const cos=Math.cos(angle),sin=Math.sin(angle);
  return Array.from({length:32},(_,i)=>{const a=i*Math.PI*2/32,x=Math.cos(a)*radii.x,y=Math.sin(a)*radii.y;return {x:center.x+x*cos-y*sin,y:center.y+x*sin+y*cos}});
}
function seededRandom(seed){let state=seed>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}}
function blueprintBounds(){
  const points=[],toPoint=([x,y])=>({x,y});
  for(const h of source.holes){
    const axis=h.fairway.axis_px.map(toPoint),tee=toPoint(h.tee.center_px),green=toPoint(h.green.center_px);
    const heading=Math.atan2(axis[1].y-axis[0].y,axis[1].x-axis[0].x);
    points.push(...axis,...h.fairway.polygon_px.map(toPoint),...rectangle(tee,{x:h.tee.rectangle_size_px[0],y:h.tee.rectangle_size_px[1]},heading),
      ...ellipse(green,{x:h.green.radii_px[0],y:h.green.radii_px[1]},h.green.rotation_clockwise_deg*Math.PI/180));
  }
  points.push(...source.environment.water_bodies.flatMap(w=>w.polygon_px.map(toPoint)),...source.environment.woodland_zones.flatMap(w=>w.polygon_px.map(toPoint)),...source.transfers.flatMap(t=>t.route_px.map(toPoint)));
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  return {minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY,centerX:(minX+maxX)/2,centerY:(minY+maxY)/2};
}
const BLUEPRINT_BOUNDS=blueprintBounds();
function transformedPlan(size,revision){
  const projection=paranaProjection(size,revision),map=points=>points.map(projection.toWorld);
  const holes=source.holes.map(h=>{
    const axis=map(h.fairway.axis_px),tee=projection.toWorld(h.tee.center_px),green=projection.toWorld(h.green.center_px);
    const heading=Math.atan2(axis[1].y-axis[0].y,axis[1].x-axis[0].x);
    const radii={x:h.green.radii_px[0]*projection.scale,y:h.green.radii_px[1]*projection.scale},rotation=h.green.rotation_clockwise_deg*Math.PI/180;
    return {id:h.id,par:h.par,color:h.color,axis,tee:{center:tee,polygon:rectangle(tee,{x:h.tee.rectangle_size_px[0]*projection.scale,y:h.tee.rectangle_size_px[1]*projection.scale},heading)},
      green:{center:green,polygon:ellipse(green,radii,rotation),radii,rotation},fairwayPolygon:map(h.fairway.polygon_px),roughMargin:h.fairway.rough_margin_px*projection.scale,
      geometryLengthM:lengthOf(axis)*METRES_PER_CELL,publishedDistancesM:{club:h.published_distances_m.club_unspecified_tee,blue:h.published_distances_m.flyaway_blue,white:h.published_distances_m.flyaway_white,red:h.published_distances_m.flyaway_red},
      confidence:{tee:h.tee.confidence,green:h.green.confidence,fairway:h.fairway.confidence},featureSummary:h.club_feature_summary};
  });
  return {courseId:PARANA_ID,title:PARANA_TITLE,revision,size,bunkers:[],seed:source.fixed_seed,projection:{size,revision,sourceBounds:projection.sourceBounds,gridOffset:{...projection.gridOffset},scaleCellsPerPixel:projection.scale,imageWidth:1232,imageHeight:1600,metresPerCell:METRES_PER_CELL,gameMetresPerPixel:projection.scale*METRES_PER_CELL,sourcePreviewMetresPerPixel:source.coordinate_system.suggested_preview_m_per_px},
    holes,water:source.environment.water_bodies.map(w=>({id:w.id,polygon:map(w.polygon_px),confidence:w.confidence})),forest:source.environment.woodland_zones.map(w=>({id:w.id,polygon:map(w.polygon_px),density:w.density})),
    transfers:source.transfers.map(t=>{const sourceRoute=map(t.route_px),walk=[2,6].includes(t.from_green_id);return {fromGreenId:t.from_green_id,toTeeId:t.to_tee_id,route:walk?[sourceRoute[0],sourceRoute.at(-1)]:sourceRoute,sourceRoute,mode:walk?'walk':'estimated_transfer',humanConfirmedNear:walk,estimated:true,optional:!!t.optional_return_to_start}}),
    provenance:{status:source.status,sources:source.sources.map(s=>({...s})),rasterAlignment:'uniform_translation_to_align_T7',humanRoutingCorrections:[2,6].map(id=>({fromGreenId:id,toTeeId:id+1,mode:'walk',near:true,source:'user_confirmation_2026-10-12'})),height:'neutral_placeholder',bunkers:revision>=2?'estimated_user_authorized':'unlocated_not_added',buildings:'unlocated_not_added',northVerified:false,georeferenced:false},uncertainties:[...source.known_uncertainties.filter(note=>!note.includes('G2→T3')&&!note.includes('G6→T7')),'Gastón confirmó G2→T3 y G6→T7 como conexiones cortas a pie. Los centros aproximados del paquete se conservan; las rutas terrestres se verifican dentro del motor.'],conflicts:[]};
}
function pointAlong(axis,fraction){
  const target=lengthOf(axis)*fraction;let walked=0;
  for(let i=1;i<axis.length;i++){
    const a=axis[i-1],b=axis[i],length=Math.hypot(b.x-a.x,b.y-a.y);
    if(walked+length>=target||i===axis.length-1){
      const u=length?Math.max(0,Math.min(1,(target-walked)/length)):0;
      return {point:{x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u},tangent:{x:(b.x-a.x)/length,y:(b.y-a.y)/length},segment:i-1,u};
    }
    walked+=length;
  }
}
function addEstimatedBunkers(tiles,plan){
  const requests=[{holeId:1,at:.72,side:-1},{holeId:1,at:.89,side:1},{holeId:3,at:.82,side:-1},{holeId:5,at:.84,side:1},
    {holeId:6,at:.85,side:-1},{holeId:7,at:.79,side:1},{holeId:8,at:.83,side:-1},{holeId:9,at:.86,side:1}];
  const size=tiles.length,closeTransfers=plan.transfers.filter(t=>t.humanConfirmedNear);
  for(const [index,request]of requests.entries()){
    const hole=plan.holes.find(h=>h.id===request.holeId),hSource=source.holes.find(h=>h.id===request.holeId);
    const frame=pointAlong(hole.axis,request.at),n={x:-frame.tangent.y,y:frame.tangent.x};
    const widths=hSource.fairway.half_widths_px,width=(widths[frame.segment]+(widths[frame.segment+1]-widths[frame.segment])*frame.u)*plan.projection.scaleCellsPerPixel;
    const radii={x:.54+(index%3)*.05,y:.34+(index%2)*.025},rotation=Math.atan2(frame.tangent.y,frame.tangent.x)+(index%2?.14:-.08);
    let chosen=null;
    for(const side of [request.side,-request.side]){
      for(const lateral of [.75,1.15,1.55])for(const along of [0,.65,-.65,1.3,-1.3]){
        if(chosen)break;
        const centre={x:Math.round(frame.point.x+n.x*(width+lateral)*side+frame.tangent.x*along),y:Math.round(frame.point.y+n.y*(width+lateral)*side+frame.tangent.y*along)};
        const polygon=ellipse(centre,radii,rotation);
        if(polygon.some(p=>p.x<1||p.y<1||p.x>size-2||p.y>size-2))continue;
        if(plan.holes.some(h=>[h.tee.polygon,h.green.polygon,h.fairwayPolygon].some(p=>polygon.some(q=>nearPolygon(q,p,.16))||p.some(q=>pointInPolygon(q,polygon)))))continue;
        if(plan.water.some(w=>polygon.some(p=>nearPolygon(p,w.polygon,.2))||w.polygon.some(p=>pointInPolygon(p,polygon))))continue;
        if(closeTransfers.some(t=>[t.route,t.sourceRoute].some(route=>route.slice(1).some((p,i)=>distanceToSegment(centre,route[i],p)<radii.x+.65))))continue;
        const cells=[];
        for(let y=Math.floor(centre.y-1);y<=Math.ceil(centre.y+1);y++)for(let x=Math.floor(centre.x-1);x<=Math.ceil(centre.x+1);x++){
          if(!pointInPolygon({x,y},polygon))continue;
          cells.push({x,y});
        }
        if(!cells.length||cells.some(p=>!['grass','tree'].includes(tiles[p.y]?.[p.x]?.type)))continue;
        chosen={id:'estimated-bunker-'+(index+1),holeId:hole.id,center:centre,radii,rotation,polygon,approx:true,estimated:true,
          provenance:'user_authorized_unlocated_estimate',rasterCells:cells};
      }
      if(chosen)break;
    }
    if(!chosen){plan.conflicts.push({kind:'estimated_bunker_no_safe_position',holeId:hole.id});continue}
    for(const p of chosen.rasterCells)tiles[p.y][p.x]={type:'sand'};
    plan.bunkers.push(chosen);
  }
  plan.uncertainties.push('Los bunkers se añadieron como estimaciones jugables autorizadas por Gastón; sus ubicaciones y formas reales quedan pendientes de nuevas referencias.');
}
/** Build a fresh fixed field. The caller backs up the current save before selection. */
export function createParanaCourse(size=64,revision=2){
  const plan=transformedPlan(size,revision),tiles=Array.from({length:size},()=>Array.from({length:size},()=>({type:'grass'}))),elevations=Array.from({length:size},()=>Array(size).fill(0));
  const owners=Array.from({length:size},()=>Array(size).fill(0)),random=seededRandom(plan.seed),centres=new Map();
  for(const h of plan.holes)for(const kind of ['tee','green']){
    const p=h[kind].center,key=Math.round(p.x)+','+Math.round(p.y);
    if(centres.has(key))plan.conflicts.push({kind:'shared_centre_cell',holeId:h.id,otherHoleId:centres.get(key).holeId,cell:{x:Math.round(p.x),y:Math.round(p.y)}});
    centres.set(key,{point:p,kind,holeId:h.id});
  }
  // Water always takes priority, including its shoreline cells. A tiny uniform
  // translation aligns T7 with a dry node without moving any point separately.
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const p={x,y},water=plan.water.find(w=>pointInPolygon(p,w.polygon));
    if(water){tiles[y][x]={type:'water'};continue}
    for(const h of plan.holes)if(pointInPolygon(p,h.fairwayPolygon)){tiles[y][x]={type:'fairway'};owners[y][x]=h.id;break}
  }
  // Retain a rough strip between outbound7/inbound8 when coarse cells touch.
  // Exact fairway polygons remain unchanged in the render/debug plan.
  const separatingCells=new Set();
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if([7,8].includes(owners[y][x])){
    for(const [dx,dy]of [[1,0],[0,1]]){
      const nx=x+dx,ny=y+dy,other=owners[ny]?.[nx];
      if(![7,8].includes(other)||other===owners[y][x]||centres.has(x+','+y)||centres.has(nx+','+ny))continue;
      const first=plan.holes[owners[y][x]-1],second=plan.holes[other-1];
      const a=Math.min(...first.axis.slice(1).map((p,i)=>distanceToSegment({x,y},first.axis[i],p))),b=Math.min(...second.axis.slice(1).map((p,i)=>distanceToSegment({x:nx,y:ny},second.axis[i],p)));
      separatingCells.add(a>b?x+','+y:nx+','+ny);
    }
  }
  for(const key of separatingCells){const [x,y]=key.split(',').map(Number);tiles[y][x]={type:'grass'};owners[y][x]=0}
  for(const h of plan.holes)for(const kind of ['green','tee']){
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(tiles[y][x].type!=='water'&&pointInPolygon({x,y},h[kind].polygon))tiles[y][x]={type:kind};
    const p=h[kind].center,x=Math.round(p.x),y=Math.round(p.y);
    if(tiles[y][x].type==='water')plan.conflicts.push({kind:'source_centre_in_water',holeId:h.id,centreKind:kind,point:{...p}});
    else tiles[y][x]={type:kind};
  }
  if(revision>=2){plan.fairwayRaster=unifyFairways(tiles,plan);if(revision===3)createParanaRevision3Infrastructure(tiles,plan);addEstimatedBunkers(tiles,plan)}
  const treeMargin=plan.projection.scaleCellsPerPixel*6;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const chance=random(),p={x,y};if(tiles[y][x].type!=='grass')continue;
    const forest=plan.forest.find(w=>pointInPolygon(p,w.polygon));if(!forest||chance>=forest.density)continue;
    const nearPlay=plan.holes.some(h=>nearPolygon(p,h.fairwayPolygon,treeMargin)||nearPolygon(p,h.green.polygon,plan.projection.scaleCellsPerPixel*10)||nearPolygon(p,h.tee.polygon,plan.projection.scaleCellsPerPixel*8));
    if(nearPlay||plan.water.some(w=>nearPolygon(p,w.polygon,treeMargin)))continue;
    tiles[y][x]={type:'tree'};
  }
  if(revision===3)applyParanaRevision3Relief(tiles,elevations,plan);
  const holes=plan.holes.map(h=>({id:h.id,name:'Hoyo '+h.id,tee:{...h.tee.center},green:{...h.green.center},par:h.par,reference:{courseId:PARANA_ID,sourceHoleId:h.id,publishedDistancesM:{...h.publishedDistancesM},geometryLengthM:h.geometryLengthM,axis:h.axis.map(p=>({...p})),confidence:{...h.confidence},featureSummary:h.featureSummary}}));
  return {tiles,elevations,holes,plan};
}
