// Original tree shapes in sprite units. Camera scale, height projection and wind
// are applied by the renderer; this cache contains no animated or world state.
const SIZE=64;
const geometries=new Array(SIZE*SIZE);
const hash=(x,y,k=0)=>{
  const n=Math.sin(x*127.1+y*311.7+k*43.8)*43758.5453;
  return n-Math.floor(n);
};
const leafColors=['#2e5a35','#396d39','#558642','#789a4a'];
const flowerColors=['#694763','#94638e','#b67b9f','#d3a1bb'];

function build(x,y){
  const r=hash(x,y,7),h=28+r*13,ground=new Float64Array(6);
  for(let j=0;j<3;j++){
    ground[j*2]=(hash(x,y,j)-.5)*.7;
    ground[j*2+1]=(hash(y,x,j)-.5)*.7;
  }
  let palm=null,pine=null,crowns=null,crownColors=null,speckles=null;
  if(r<.43){
    palm=new Float64Array(14);
    for(let j=0;j<7;j++){
      const angle=j*Math.PI*2/7;
      palm[j*2]=Math.cos(angle)*(12+r*7);
      palm[j*2+1]=Math.sin(angle)*8;
    }
  }else if(r<.68){
    pine=new Float64Array(30);
    for(let level=0;level<5;level++){
      const w=4+level*2.7;
      for(let k=0;k<3;k++){
        const i=(level*3+k)*2;
        pine[i]=-w*.7+hash(x,y,k+level)*w;
        pine[i+1]=hash(y,x,k+level)*4;
      }
    }
  }else{
    crowns=new Float64Array(22*9*2);
    crownColors=new Array(22);
    const cy=-h*.75,colors=r>.87?flowerColors:leafColors;
    for(let k=0;k<22;k++){
      const a=k*2.399,rr=Math.sqrt(k/22);
      const cx=Math.cos(a)*12*rr,yy=cy+Math.sin(a)*9*rr;
      const radius=3.5+hash(x,y,k)*2;
      crownColors[k]=colors[k%4];
      for(let j=0;j<9;j++){
        const angle=j*Math.PI*2/9,radiusHere=radius*(.8+hash(x+k,y,j)*.25);
        const i=(k*9+j)*2;
        crowns[i]=cx+Math.cos(angle)*radiusHere;
        crowns[i+1]=yy+Math.sin(angle)*radiusHere*.9;
      }
    }
    speckles=new Float64Array(68);
    for(let k=0;k<34;k++){
      const a=hash(x,y,k)*Math.PI*2,rr=hash(y,x,k)*10;
      speckles[k*2]=Math.cos(a)*rr;
      speckles[k*2+1]=cy+Math.sin(a)*rr*.75;
    }
  }
  return Object.freeze({r,h,ground,palm,pine,crowns,crownColors:crownColors&&Object.freeze(crownColors),speckles});
}

/**
 * Read-only cached geometry for one tree. Pausing, panning, editing and zooming
 * cannot change these shapes; x/y deterministically select the original art.
 * The 64x64 field fits without eviction. Finite off-grid positions are uncached,
 * so they cannot grow storage or push frequently drawn field trees out.
 * Typed arrays are shared: the renderer must read them without modifying them.
 */
export function treeGeometry(x,y){
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new TypeError('Tree coordinates must be finite.');
  if(Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<SIZE&&y>=0&&y<SIZE){
    const i=y*SIZE+x;
    return geometries[i]||(geometries[i]=build(x,y));
  }
  return build(x,y);
}
