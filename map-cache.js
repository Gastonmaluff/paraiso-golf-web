// Terrain pixels are tied to world coordinates, not the camera's position.
// Rendering only new chunks makes dragging reuse the existing grass and paths.
export class MapRasterCache {
  constructor({chunkSize=512,bleed=32,maxPixels=16*1024*1024,maxTiles=48,createCanvas=()=>document.createElement('canvas')}={}) {
    if(!Number.isInteger(chunkSize)||chunkSize<1||!Number.isFinite(bleed)||bleed<0||!Number.isFinite(maxPixels)||maxPixels<1||!Number.isInteger(maxTiles)||maxTiles<1)throw new RangeError('Invalid terrain cache limits');
    this.chunkSize=chunkSize;this.bleed=bleed;this.maxPixels=maxPixels;this.maxTiles=maxTiles;this.createCanvas=createCanvas;
    this.entries=new Map();this.pixels=0;this.signature=null;
    this.totals={rasterized:0,hits:0,direct:0};
  }

  get stats(){return {...this.totals,tiles:this.entries.size,pixels:this.pixels};}

  clear(){
    for(const entry of this.entries.values())this.release(entry);
    this.entries.clear();this.pixels=0;this.signature=null;
  }

  release(entry){entry.canvas.width=0;entry.canvas.height=0;}

  makeRoom(pixels,visible){
    if(pixels>this.maxPixels)return false;
    while(this.pixels+pixels>this.maxPixels||this.entries.size>=this.maxTiles){
      const candidate=[...this.entries].find(([key])=>!visible.has(key));
      if(!candidate)return false;
      const [key,entry]=candidate;this.entries.delete(key);this.pixels-=entry.pixels;this.release(entry);
    }
    return true;
  }

  draw({ctx,width,height,dpr=1,originX=0,originY=0,scaleKey,revision,render}) {
    if(![width,height,dpr,originX,originY].every(Number.isFinite)||dpr<=0)throw new RangeError('Invalid terrain viewport');
    const signature=this.signature;
    if(!signature||signature.scaleKey!==scaleKey||signature.revision!==revision||signature.dpr!==dpr){
      this.clear();this.signature={scaleKey,revision,dpr};
    }
    const result={rasterized:0,hits:0,direct:0,tiles:this.entries.size,pixels:this.pixels};
    if(width<=0||height<=0)return result;
    const size=this.chunkSize,bleed=this.bleed,side=Math.ceil((size+bleed*2)*dpr),pixels=side*side;
    const left=Math.floor(-originX/size),top=Math.floor(-originY/size);
    const right=Math.ceil((width-originX)/size)-1,bottom=Math.ceil((height-originY)/size)-1;
    const visible=new Set();
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)visible.add(x+','+y);
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
      const key=x+','+y,worldX=x*size,worldY=y*size;
      const bounds={x:worldX-bleed,y:worldY-bleed,width:size+bleed*2,height:size+bleed*2};
      let entry=this.entries.get(key);
      if(entry){
        this.entries.delete(key);this.entries.set(key,entry);result.hits++;
      }else if(this.makeRoom(pixels,visible)){
        const surface=this.createCanvas();surface.width=side;surface.height=side;
        const tileCtx=surface.getContext('2d');
        try{
          tileCtx.setTransform(dpr,0,0,dpr,-bounds.x*dpr,-bounds.y*dpr);
          render(tileCtx,bounds);
        }catch(error){this.release({canvas:surface});throw error;}
        entry={canvas:surface,pixels};this.entries.set(key,entry);this.pixels+=pixels;result.rasterized++;
      }
      if(entry){
        // Bleed supplies filter/shadow samples; central regions composite once.
        ctx.drawImage(entry.canvas,bleed*dpr,bleed*dpr,size*dpr,size*dpr,worldX+originX,worldY+originY,size,size);
      }else{
        // Keep retained chunks when a viewport is larger than the memory budget.
        // Direct drawing requires no extra surface and cannot evict visible hits.
        ctx.save();
        try{
          ctx.beginPath();ctx.rect(worldX+originX,worldY+originY,size,size);ctx.clip();ctx.translate(originX,originY);
          render(ctx,bounds);result.direct++;
        }finally{ctx.restore();}
      }
    }
    for(const name of ['rasterized','hits','direct'])this.totals[name]+=result[name];
    result.tiles=this.entries.size;result.pixels=this.pixels;
    return result;
  }
}
