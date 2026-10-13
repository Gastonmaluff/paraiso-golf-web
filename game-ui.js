const PANELS={play:'Tu partido',build:'Construir el campo',course:'El recorrido',club:'Tu club',golfer:'Golfistas y ropa',activity:'Vida del club'};
const OUTFIT_KEY='paraiso-golf-wardrobe-v1',PANEL_KEY='paraiso-golf-panel-v1';

// Interface preferences are separate from the simulation and its saved rounds.
export function installGameUI({sim,defaultAppearance,drawGolfer,focusDetail,onPanelChange,toast}){
  const $=id=>document.getElementById(id);
  const fields={shirt:'outfitShirt',pants:'outfitPants',hat:'outfitHat',emblem:'outfitEmblem'};
  const defaults=defaultAppearance({id:1,color:'#edbc4b',controlled:true});
  let stored={};try{stored=JSON.parse(localStorage.getItem(OUTFIT_KEY)||'{}')}catch{}
  const validated=defaultAppearance({id:1,color:'#edbc4b',controlled:true},stored);
  const outfit={shirt:validated.shirt,pants:validated.pants,hat:validated.hat,hatColor:validated.hatColor,emblem:validated.emblem};
  for(const [key,id]of Object.entries(fields)){
    const input=$(id);if(![...input.options].some(o=>o.value===outfit[key]))outfit[key]=[...input.options].some(o=>o.value===defaults[key])?defaults[key]:input.options[0].value;input.value=outfit[key];
  }
  const appearance=g=>defaultAppearance(g,g.controlled||g.id===sim.playerRound?.golferId?outfit:undefined);
  function preview(){
    if(document.body.dataset.openPanel!=='golfer')return;
    const canvas=$('outfitPreview'),ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const bg=ctx.createLinearGradient(0,0,0,canvas.height);bg.addColorStop(0,'#dce8c9');bg.addColorStop(1,'#91ad74');ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height);
    const current=sim.golfers.find(g=>g.id===sim.playerRound?.golferId),g={...(current||{id:1,color:'#edbc4b'}),controlled:true,phase:'waiting',poseTime:0};
    ctx.save();ctx.translate(canvas.width/2,canvas.height-30);ctx.scale(10,10);
    drawGolfer(ctx,{g,gait:{step:0,arm:0,bob:0,hip:0,lift:0,breathe:0},pose:null,life:null,appearance:defaultAppearance(g,outfit),selected:false,celebrate:false});ctx.restore();
  }
  const trays={
    menu:{button:$('menu'),panel:$('quickMenu')},
    camera:{button:$('cameraToggle'),panel:$('cameraControls')},
    speed:{button:$('speedToggle'),panel:$('speedControls')}
  };
  let openControls='none';
  const dismissedPointers=new Set();
  const focus=element=>element?.focus({preventScroll:true});
  function syncControls(){
    const pace=sim.speed===.5?'½×':Number(sim.speed)+'×';
    trays.speed.button.textContent=sim.paused?'Ⅱ':pace;
    trays.speed.button.setAttribute('aria-label','Velocidad y pausa · '+(sim.paused?'pausado':pace));
    trays.speed.button.title=sim.paused?'Juego pausado · tocar para elegir':'Velocidad '+pace+' · tocar para elegir';
    trays.menu.button.setAttribute('aria-label',(openControls==='menu'?'Cerrar menú del juego':'Menú del juego')+(trays.menu.button.dataset.ready==='true'?' · tu turno':''));
    trays.camera.button.setAttribute('aria-label',openControls==='camera'?'Cerrar controles de cámara':'Controles de cámara');
    $('pause').setAttribute('aria-pressed',String(sim.paused));
    document.querySelectorAll('.speed').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.speed)===sim.speed)));
  }
  function setControls(next,{restoreFocus=false,keyboard=false}={}){
    if(next!=='none'&&!trays[next])return;
    const previous=openControls;
    if(next!=='none'&&document.body.dataset.openPanel!=='none')setPanel('none');
    openControls=next;document.body.dataset.openControls=next;
    for(const [name,tray]of Object.entries(trays)){
      tray.panel.hidden=name!==next;
      tray.button.setAttribute('aria-expanded',String(name===next));
    }
    syncControls();
    if(restoreFocus&&trays[previous])focus(trays[previous].button);
    if(keyboard&&trays[next])requestAnimationFrame(()=>{
      const button=[...trays[next].panel.querySelectorAll('button,input,select,a[href]')].find(e=>!e.disabled&&!e.closest('[hidden]'));
      focus(button);
    });
  }
  function setPanel(next,{keyboard=false}={}){
    if(next!=='none'&&!PANELS[next])return;
    setControls('none');
    document.body.dataset.openPanel=next;
    $('gameDrawer').hidden=next==='none';
    $('gameDrawer').setAttribute('aria-hidden',String(next==='none'));
    $('panelTitle').textContent=PANELS[next]||'';
    document.querySelectorAll('[data-panel]').forEach(button=>{const open=button.dataset.panel===next;button.setAttribute('aria-pressed',String(open));button.setAttribute('aria-expanded',String(open));});
    try{localStorage.setItem(PANEL_KEY,next)}catch{}
    requestAnimationFrame(()=>{preview();onPanelChange?.(next);if(keyboard&&next!=='none')focus($('drawerClose'));});
  }
  for(const [name,tray]of Object.entries(trays))tray.button.onclick=event=>setControls(openControls===name?'none':name,{keyboard:event.detail===0});
  document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',event=>setPanel(document.body.dataset.openPanel===button.dataset.panel?'none':button.dataset.panel,{keyboard:event.detail===0})));
  $('drawerClose').onclick=()=>{setPanel('none');focus(trays.menu.button);};
  // Dismissing a tray on the course consumes that gesture. It must not also
  // choose a shot, paint terrain or begin a pan underneath the closed menu.
  document.addEventListener('pointerdown',event=>{
    if(openControls==='none')return;
    if(trays[openControls].panel.contains(event.target)||Object.values(trays).some(t=>t.button.contains(event.target)))return;
    setControls('none');
    if(event.target===$('course')){
      dismissedPointers.add(event.pointerId);event.preventDefault();event.stopImmediatePropagation();focus($('course'));
    }
  },true);
  for(const type of ['pointermove','pointerup','pointercancel'])document.addEventListener(type,event=>{
    if(!dismissedPointers.has(event.pointerId))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(type!=='pointermove')dismissedPointers.delete(event.pointerId);
  },true);
  document.addEventListener('wheel',event=>{
    if(openControls==='none'||event.target!==$('course'))return;
    setControls('none');event.preventDefault();event.stopImmediatePropagation();
  },{capture:true,passive:false});
  for(const id of ['save','pause','fit','fullscreen'])$(id).addEventListener('click',()=>setControls('none',{restoreFocus:true}),true);
  document.querySelectorAll('.speed').forEach(button=>button.addEventListener('click',()=>setControls('none',{restoreFocus:true}),true));
  for(const [id,dialogId,tray]of [['help','helpDialog','menu'],['planView','coursePlanDialog','camera']]){
    let returnFocus=false;
    $(id).addEventListener('click',()=>{returnFocus=true;setControls('none');},true);
    $(dialogId).addEventListener('close',()=>{if(returnFocus){returnFocus=false;focus(trays[tray].button);}});
  }
  for(const [key,id]of Object.entries(fields))$(id).onchange=()=>{
    outfit[key]=$(id).value;preview();try{localStorage.setItem(OUTFIT_KEY,JSON.stringify(outfit))}catch{toast('La ropa cambió; este navegador no permitió guardar la preferencia.');}
  };
  $('golferDetail').onclick=event=>{setPanel('golfer',{keyboard:event.detail===0});requestAnimationFrame(focusDetail)};
  $('fullscreen').onclick=async()=>{
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(document.fullscreenEnabled&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
      else toast('El campo ocupa toda la vista. Este navegador mantiene sus propias barras.');
    }catch{toast('El campo ocupa toda la vista. Este navegador mantiene sus propias barras.');}
  };
  document.addEventListener('fullscreenchange',()=>{
    $('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Salir de pantalla completa':'Pantalla completa');
    $('fullscreen').setAttribute('aria-pressed',String(Boolean(document.fullscreenElement)));adaptHeight();
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||document.querySelector('dialog[open]'))return;
    if(openControls!=='none'){setControls('none',{restoreFocus:true});event.preventDefault();event.stopImmediatePropagation();}
    else if(document.body.dataset.openPanel!=='none'){setPanel('none');focus(trays.menu.button);event.preventDefault();event.stopImmediatePropagation();}
  },true);
  function adaptHeight(){document.documentElement.style.setProperty('--game-height',`${window.visualViewport?.height||innerHeight}px`)}
  window.addEventListener('resize',adaptHeight);window.visualViewport?.addEventListener('resize',adaptHeight);adaptHeight();
  // Reserve only the visible overlays. Camera framing can still use the map
  // behind an open drawer, while the next shot stays in its clear portion.
  function screenArea(){
    const view=$('viewport').getBoundingClientRect();let left=16,right=view.width-16,top=16,bottom=view.height-16;
    // Collapsed triggers cover only a small corner; no header or dock strip
    // remains reserved. Open panes reserve only the area they actually occupy.
    const overlays=[...Object.values(trays).map(t=>t.panel),$('gameDrawer')].filter(e=>!e.hidden);
    for(const element of overlays){
      const r=element.getBoundingClientRect();if(!r.width||!r.height)continue;
      const x=r.left-view.left,y=r.top-view.top;
      if(r.width>view.width*.72){
        if(y<view.height*.25)top=Math.max(top,r.bottom-view.top+10);else bottom=Math.min(bottom,y-10);
      }else if(x>view.width*.38)right=Math.min(right,x-10);
      else if(y<view.height*.25)top=Math.max(top,r.bottom-view.top+10);
      else bottom=Math.min(bottom,y-10);
    }
    if(bottom-top<90){top=16;bottom=view.height-16;}
    if(right-left<110){left=16;right=view.width-68;}
    return {left,right,top,bottom,x:(left+right)/2,y:(top+bottom)/2,width:right-left,height:bottom-top};
  }
  // Start with the course clear even if an older version remembered a panel.
  // Outfit and game saves keep their existing keys and values.
  setPanel('none');setControls('none');
  return {appearance,outfit,setPanel,setControls,syncControls,preview,screenArea,get panel(){return document.body.dataset.openPanel||'none'},get controls(){return openControls}};
}
