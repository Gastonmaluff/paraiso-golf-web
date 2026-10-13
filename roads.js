// The renderer and the cart simulation share these exact road segments.
export const ROAD_DIRECTIONS=Object.freeze([[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].map(Object.freeze));
const tile=(tiles,x,y)=>Number.isInteger(x)&&Number.isInteger(y)?tiles[y]?.[x]:null;
const blocked=(tiles,x,y)=>!tile(tiles,x,y)||x>=3&&x<=5&&y>=24&&y<=27||['water','green','tee'].includes(tile(tiles,x,y)?.type);

export function roadEdgeAllowed(tiles,from,to,{requirePath=true}={}){
  const dx=to.x-from.x,dy=to.y-from.y;
  if(!Number.isInteger(dx)||!Number.isInteger(dy)||Math.max(Math.abs(dx),Math.abs(dy))!==1||blocked(tiles,from.x,from.y)||blocked(tiles,to.x,to.y))return false;
  if(requirePath&&(tile(tiles,from.x,from.y)?.type!=='path'||tile(tiles,to.x,to.y)?.type!=='path'))return false;
  if(dx&&dy){
    if(blocked(tiles,to.x,from.y)||blocked(tiles,from.x,to.y))return false;
  }
  return true;
}

export function roadNeighbors(tiles,x,y,options){
  return ROAD_DIRECTIONS.map(([dx,dy])=>({x:x+dx,y:y+dy})).filter(p=>roadEdgeAllowed(tiles,{x,y},p,options));
}

export function shortestRoadPath(tiles,from,to,{edgeAllowed}={}){
  const size=tiles.length,start=from.y*size+from.x,end=to.y*size+to.x;
  if(tile(tiles,from.x,from.y)?.type!=='path'||tile(tiles,to.x,to.y)?.type!=='path')return null;
  if(start===end)return [];
  const costs=new Float64Array(size*size);costs.fill(Infinity);costs[start]=0;
  const previous=new Int16Array(size*size);previous.fill(-1);
  const heap=[];
  const push=(key,cost)=>{let i=heap.length;heap.push({key,cost});while(i){const p=(i-1)>>1;if(heap[p].cost<=cost)break;heap[i]=heap[p];i=p}heap[i]={key,cost}};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].cost<heap[c].cost)c++;if(heap[c].cost>=last.cost)break;heap[i]=heap[c];i=c}heap[i]=last}return first};
  push(start,0);
  while(heap.length){
    const {key,cost}=pop();if(cost!==costs[key])continue;if(key===end)break;
    const x=key%size,y=Math.floor(key/size);
    for(const p of roadNeighbors(tiles,x,y)){
      if(edgeAllowed&&!edgeAllowed({x,y},p))continue;
      const next=p.y*size+p.x,total=cost+Math.hypot(p.x-x,p.y-y);
      if(total<costs[next]){costs[next]=total;previous[next]=key;push(next,total)}
    }
  }
  if(previous[end]<0)return null;
  const result=[];for(let key=end;key!==start;key=previous[key])result.push({x:key%size,y:Math.floor(key/size)});
  return result.reverse();
}
