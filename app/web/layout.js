// Device preferences only: layout choices never become part of a saved score.
const KEY = 'tablens.layout.v1';
const defaults = {
  mode:'review', sideWidth:370, sourceHeight:210, practiceWidth:370, practiceView:'source',
  dockSide:'left', dockSlots:{full:'score',top:'source',bottom:'editor'},
  dockRightWidth:null, dockTopHeight:null
};
const modes = ['review','practice','compose'];
const panelNames={score:'可编辑六线谱',source:'原图对照',editor:'工作区'};
const panelKeys=Object.keys(panelNames);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function setupLayout() {
  const workspace=document.querySelector('.workspace');
  const sidebar=document.querySelector('.side-column');
  const horizontal=document.querySelector('#workspace-resizer');
  const vertical=document.querySelector('#side-resizer');
  const modeControl=document.querySelector('#layout-mode');
  const modeButtons=[...modeControl.querySelectorAll('[data-mode]')];
  const practiceViewControl=document.querySelector('#practice-view');
  const practiceButtons=[...practiceViewControl.querySelectorAll('[data-practice-view]')];
  const panels={score:document.querySelector('.score-panel'),source:document.querySelector('.source-panel'),editor:document.querySelector('.editor-panel')};
  let saved={};
  try { saved=JSON.parse(localStorage.getItem(KEY))??{}; } catch {}
  const state={...defaults,...saved};
  if (!modes.includes(state.mode)) state.mode='review';
  if (!['source','tab'].includes(state.practiceView)) state.practiceView='source';
  if (!Number.isFinite(state.sideWidth)) state.sideWidth=defaults.sideWidth;
  if (!Number.isFinite(state.practiceWidth)) state.practiceWidth=defaults.practiceWidth;
  if (!Number.isFinite(state.sourceHeight)) state.sourceHeight=defaults.sourceHeight;
  if (!['left','right'].includes(state.dockSide)) state.dockSide='left';
  if (!state.dockSlots || !['full','top','bottom'].every(slot=>panelKeys.includes(state.dockSlots[slot]))
    || new Set(Object.values(state.dockSlots)).size!==3) state.dockSlots={...defaults.dockSlots};
  if (!Number.isFinite(state.dockRightWidth)) state.dockRightWidth=null;
  if (!Number.isFinite(state.dockTopHeight)) state.dockTopHeight=null;

  const preset=document.createElement('button');
  preset.id='dock-layout-preset';preset.type='button';preset.className='small';
  panels.score.querySelector('.history-actions').prepend(preset);
  const overlay=document.createElement('div');overlay.id='dock-overlay';overlay.hidden=true;
  overlay.setAttribute('role','group');overlay.setAttribute('aria-label','选择面板停靠位置');
  for(const side of ['left','right'])for(const slot of ['full','top','bottom']){
    const zone=document.createElement('button');zone.type='button';zone.className='dock-zone';
    zone.dataset.dockSide=side;zone.dataset.dockSlot=slot;
    zone.textContent=`${side==='left'?'左':'右'}侧${{full:'整高',top:'上方',bottom:'下方'}[slot]}`;
    overlay.append(zone);
  }
  workspace.append(overlay);
  let moving=null;
  const closeOverlay=()=>{overlay.hidden=true;moving=null;document.body.classList.remove('dock-dragging');};
  const openOverlay=(key,focus=false)=>{
    if(workspace.dataset.dockActive!=='true')return;
    moving=key;overlay.hidden=false;document.body.classList.add('dock-dragging');
    for(const zone of overlay.children){
      const side=zone.dataset.dockSlot==='full'?state.dockSide:state.dockSide==='left'?'right':'left';
      zone.classList.toggle('current',zone.dataset.dockSide===side&&state.dockSlots[zone.dataset.dockSlot]===key);
    }
    if(focus)overlay.querySelector('.dock-zone.current')?.focus();
  };
  for(const [key,panel] of Object.entries(panels)){
    const handle=document.createElement('button');handle.type='button';handle.className='panel-dock-handle';
    handle.textContent='⠿';handle.setAttribute('aria-label',`拖动${panelNames[key]}调整位置`);
    handle.dataset.tip=`拖到目标区域调整${panelNames[key]}位置；点击可选择停靠位置`;
    panel.querySelector('.panel-heading').prepend(handle);
    let suppressClick=false;
    handle.addEventListener('click',()=>{
      if(suppressClick)return;
      moving===key&&!overlay.hidden?closeOverlay():openOverlay(key,true);
    });
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0||workspace.dataset.dockActive!=='true')return;
      const pointerId=event.pointerId,startX=event.clientX,startY=event.clientY;
      let dragged=false;
      handle.setPointerCapture(pointerId);
      const move=next=>{
        if(next.pointerId!==pointerId)return;
        if(!dragged&&Math.hypot(next.clientX-startX,next.clientY-startY)>7){dragged=true;openOverlay(key);}
        if(!dragged)return;
        const hovered=document.elementFromPoint(next.clientX,next.clientY)?.closest('.dock-zone');
        for(const zone of overlay.children)zone.classList.toggle('hovered',zone===hovered);
      };
      const cleanup=()=>{
        handle.removeEventListener('pointermove',move);
        handle.removeEventListener('pointerup',finish);
        handle.removeEventListener('pointercancel',cancel);
        if(handle.hasPointerCapture(pointerId))handle.releasePointerCapture(pointerId);
      };
      const finish=next=>{
        if(next.pointerId!==pointerId)return;
        const zone=dragged?document.elementFromPoint(next.clientX,next.clientY)?.closest('.dock-zone'):null;
        cleanup();
        if(!dragged)return;
        suppressClick=true;setTimeout(()=>{suppressClick=false;},0);
        if(zone)dock(zone.dataset.dockSide,zone.dataset.dockSlot,key);
        else closeOverlay();
      };
      const cancel=next=>{if(next.pointerId!==pointerId)return;cleanup();closeOverlay();};
      handle.addEventListener('pointermove',move);
      handle.addEventListener('pointerup',finish);
      handle.addEventListener('pointercancel',cancel);
    });
  }
  const persist=()=>{ try{localStorage.setItem(KEY,JSON.stringify(state));}catch{} };
  const apply=()=>{
    const desktop=window.matchMedia('(min-width:901px)').matches;
    const maximum=Math.max(300,workspace.clientWidth-450);
    state.sideWidth=clamp(state.sideWidth,300,maximum);
    state.practiceWidth=clamp(state.practiceWidth,300,maximum);
    state.sourceHeight=clamp(state.sourceHeight,140,sidebar.clientHeight>400?sidebar.clientHeight-230:800);
    const maximumDock=Math.max(340,workspace.clientWidth-350);
    if(desktop&&state.dockRightWidth!==null)state.dockRightWidth=clamp(state.dockRightWidth,340,maximumDock);
    if(desktop&&state.dockTopHeight!==null)state.dockTopHeight=clamp(state.dockTopHeight,140,Math.max(140,workspace.clientHeight-170));
    document.body.dataset.layout=state.mode;
    document.body.dataset.practiceView=state.practiceView;
    const canDock=desktop&&state.mode==='review'&&!sidebar.classList.contains('without-source');
    workspace.dataset.dockActive=String(canDock);
    if(!canDock&&!overlay.hidden)closeOverlay();
    workspace.dataset.dockSide=state.dockSide;
    for(const [key,panel] of Object.entries(panels))panel.dataset.dockSlot=Object.keys(state.dockSlots).find(slot=>state.dockSlots[slot]===key);
    workspace.style.setProperty('--side-width',`${state.sideWidth}px`);
    workspace.style.setProperty('--practice-width',`${state.practiceWidth}px`);
    workspace.style.setProperty('--dock-right-width',`${state.dockSide==='left'?state.sideWidth:state.dockRightWidth??Math.round(workspace.clientWidth*.46)}px`);
    workspace.style.setProperty('--dock-top-height',`${state.dockSide==='left'?state.sourceHeight:state.dockTopHeight??Math.round(workspace.clientHeight*.5)}px`);
    sidebar.style.setProperty('--source-height',`${state.sourceHeight}px`);
    const defaultDock=state.dockSide==='left'&&Object.keys(defaults.dockSlots).every(slot=>state.dockSlots[slot]===defaults.dockSlots[slot]);
    preset.textContent=defaultDock?'工作区右侧':'恢复默认位置';
    preset.dataset.tip=defaultDock?'原谱和 TAB 上下排列在左侧，工作区占右侧整高':'恢复 TAB 左侧、原谱和工作区右侧的默认位置';
    preset.hidden=!canDock;
    for(const panel of Object.values(panels))panel.querySelector('.panel-dock-handle').hidden=preset.hidden;
    modeControl.dataset.active=state.mode;
    modeControl.style.setProperty('--mode-index',modes.indexOf(state.mode));
    for(const button of modeButtons)button.setAttribute('aria-checked',String(button.dataset.mode===state.mode));
    for(const button of practiceButtons)button.setAttribute('aria-pressed',String(button.dataset.practiceView===state.practiceView));
  };
  const changed=()=>{apply();persist();document.dispatchEvent(new CustomEvent('tablens:layout-change'));};
  const dock=(side,slot,key)=>{
    if(!panelKeys.includes(key)||!['left','right'].includes(side)||!['full','top','bottom'].includes(slot))return;
    const ordered=[state.dockSlots.top,state.dockSlots.bottom,state.dockSlots.full].filter(item=>item!==key);
    let full,top,bottom;
    if(slot==='full'){
      full=key;[top,bottom]=ordered;
    }else{
      full=state.dockSlots.full!==key?state.dockSlots.full:ordered.at(-1);
      const other=ordered.find(item=>item!==full);
      top=slot==='top'?key:other;bottom=slot==='bottom'?key:other;
    }
    const wasLeft=state.dockSide==='left';
    const fullSide=slot==='full'?side:side==='left'?'right':'left';
    state.dockSide=fullSide;state.dockSlots={full,top,bottom};
    if(wasLeft&&fullSide==='right'&&state.dockRightWidth===null)state.dockRightWidth=Math.round(workspace.clientWidth*.46);
    if(wasLeft&&fullSide==='right'&&state.dockTopHeight===null)state.dockTopHeight=Math.round(workspace.clientHeight*.5);
    closeOverlay();changed();
  };
  preset.addEventListener('click',()=>{
    const defaultDock=state.dockSide==='left'&&Object.keys(defaults.dockSlots).every(slot=>state.dockSlots[slot]===defaults.dockSlots[slot]);
    state.dockSide=defaultDock?'right':'left';
    state.dockSlots=defaultDock?{full:'editor',top:'source',bottom:'score'}:{...defaults.dockSlots};
    if(defaultDock&&state.dockRightWidth===null)state.dockRightWidth=Math.round(workspace.clientWidth*.46);
    if(defaultDock&&state.dockTopHeight===null)state.dockTopHeight=Math.round(workspace.clientHeight*.5);
    changed();
  });
  overlay.addEventListener('click',event=>{
    const zone=event.target.closest('.dock-zone');if(zone&&moving)dock(zone.dataset.dockSide,zone.dataset.dockSlot,moving);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!overlay.hidden)closeOverlay();});
  document.addEventListener('pointerdown',event=>{
    if(!overlay.hidden&&!overlay.contains(event.target)&&!event.target.closest('.panel-dock-handle'))closeOverlay();
  });
  const setMode=value=>{
    if(!modes.includes(value))return;
    closeOverlay();state.mode=value;apply();persist();
    document.dispatchEvent(new CustomEvent('tablens:layout-change'));
  };
  let suppressClick=false;
  modeControl.addEventListener('click',event=>{
    if(suppressClick)return;
    const button=event.target.closest('[data-mode]');
    if(button&&modeControl.contains(button))setMode(button.dataset.mode);
  });
  modeControl.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const origin=event.target.closest('[data-mode]');
    if(!origin)return;
    const pointerId=event.pointerId;
    let choice=origin.dataset.mode,dragged=false;
    modeControl.setPointerCapture(pointerId);
    const move=next=>{
      if(next.pointerId!==pointerId)return;
      const rect=modeControl.getBoundingClientRect();
      const index=clamp(Math.floor((next.clientX-rect.left)/rect.width*3),0,2);
      choice=modes[index];
      dragged||=choice!==origin.dataset.mode;
      modeControl.style.setProperty('--mode-index',index);
    };
    const finish=next=>{
      if(next.pointerId!==pointerId)return;
      modeControl.removeEventListener('pointermove',move);
      modeControl.removeEventListener('pointerup',finish);
      modeControl.removeEventListener('pointercancel',cancel);
      if(dragged){suppressClick=true;setTimeout(()=>{suppressClick=false;},0);}
      setMode(choice);
    };
    const cancel=next=>{
      if(next.pointerId!==pointerId)return;
      modeControl.removeEventListener('pointermove',move);
      modeControl.removeEventListener('pointerup',finish);
      modeControl.removeEventListener('pointercancel',cancel);
      apply();
    };
    modeControl.addEventListener('pointermove',move);
    modeControl.addEventListener('pointerup',finish);
    modeControl.addEventListener('pointercancel',cancel);
  });
  modeControl.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const current=modes.indexOf(state.mode);
    const index=event.key==='Home'?0:event.key==='End'?2:clamp(current+(event.key==='ArrowRight'?1:-1),0,2);
    setMode(modes[index]);modeButtons[index].focus();
  });
  practiceViewControl.addEventListener('click',event=>{
    const button=event.target.closest('[data-practice-view]');
    if(!button||!practiceViewControl.contains(button))return;
    state.practiceView=button.dataset.practiceView;apply();persist();
  });
  document.querySelector('#layout-reset').addEventListener('click',()=>{
    state.sideWidth=defaults.sideWidth;state.practiceWidth=defaults.practiceWidth;
    state.sourceHeight=defaults.sourceHeight;state.dockSide=defaults.dockSide;
    state.dockSlots={...defaults.dockSlots};state.dockRightWidth=null;state.dockTopHeight=null;
    closeOverlay();changed();
  });
  function bind(separator,axis) {
    separator.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();
      separator.setPointerCapture(event.pointerId);
      const start=axis==='x'?event.clientX:event.clientY;
      const practice=axis==='x'&&state.mode==='practice';
      const dockRight=axis==='x'&&state.mode==='review'&&state.dockSide==='right';
      const dockTop=axis==='y'&&state.mode==='review'&&state.dockSide==='right';
      const size=axis==='x'?(practice?state.practiceWidth:dockRight?state.dockRightWidth:state.sideWidth)
        :dockTop?state.dockTopHeight:state.sourceHeight;
      separator.classList.add('dragging');
      const move=next=>{
        if(next.pointerId!==event.pointerId)return;
        if(axis==='x'){
          if(practice)state.practiceWidth=size-(next.clientX-start);
          else if(dockRight)state.dockRightWidth=size-(next.clientX-start);
          else state.sideWidth=size-(next.clientX-start);
        } else if(dockTop)state.dockTopHeight=size+(next.clientY-start);
        else state.sourceHeight=size+(next.clientY-start);
        apply();
      };
      const finish=next=>{
        if(next.pointerId!==event.pointerId)return;
        separator.removeEventListener('pointermove',move);
        separator.removeEventListener('pointerup',finish);
        separator.removeEventListener('pointercancel',finish);
        separator.classList.remove('dragging');persist();
      };
      separator.addEventListener('pointermove',move);
      separator.addEventListener('pointerup',finish);
      separator.addEventListener('pointercancel',finish);
    });
    separator.addEventListener('keydown',event=>{
      const direction=axis==='x'?(event.key==='ArrowLeft'?1:event.key==='ArrowRight'?-1:0)
        :(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0);
      if(!direction)return;
      event.preventDefault();
      if(axis==='x'){
        if(state.mode==='practice')state.practiceWidth+=direction*24;
        else if(state.mode==='review'&&state.dockSide==='right')state.dockRightWidth+=direction*24;
        else state.sideWidth+=direction*24;
      } else if(state.mode==='review'&&state.dockSide==='right')state.dockTopHeight+=direction*24;
      else state.sourceHeight+=direction*24;
      apply();persist();
    });
  }
  bind(horizontal,'x');bind(vertical,'y');
  new MutationObserver(()=>apply()).observe(sidebar,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',apply);
  apply();requestAnimationFrame(apply);
  return {setMode};
}
