// Device preferences only: layout choices never become part of a saved score.
const KEY = 'tablens.layout.v1';
const defaults = {mode:'review', sideWidth:370, sourceHeight:210};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function setupLayout() {
  const workspace=document.querySelector('.workspace');
  const sidebar=document.querySelector('.side-column');
  const horizontal=document.querySelector('#workspace-resizer');
  const vertical=document.querySelector('#side-resizer');
  const modeControl=document.querySelector('#layout-mode');
  let saved={};
  try { saved=JSON.parse(localStorage.getItem(KEY))??{}; } catch {}
  const state={...defaults,...saved};
  if (!['review','practice','compose'].includes(state.mode)) state.mode='review';
  if (!Number.isFinite(state.sideWidth)) state.sideWidth=defaults.sideWidth;
  if (!Number.isFinite(state.sourceHeight)) state.sourceHeight=defaults.sourceHeight;
  const persist=()=>{ try{localStorage.setItem(KEY,JSON.stringify(state));}catch{} };
  const apply=()=>{
    state.sideWidth=clamp(state.sideWidth,300,Math.max(300,workspace.clientWidth-450));
    state.sourceHeight=clamp(state.sourceHeight,140,sidebar.clientHeight>400?sidebar.clientHeight-230:800);
    document.body.dataset.layout=state.mode;
    workspace.style.setProperty('--side-width',`${state.sideWidth}px`);
    sidebar.style.setProperty('--source-height',`${state.sourceHeight}px`);
    modeControl.value=state.mode;
  };
  const setMode=value=>{state.mode=value;apply();persist();};
  modeControl.addEventListener('change',event=>setMode(event.target.value));
  document.querySelector('#layout-reset').addEventListener('click',()=>{
    state.sideWidth=defaults.sideWidth;state.sourceHeight=defaults.sourceHeight;apply();persist();
  });
  function bind(separator,axis) {
    separator.addEventListener('pointerdown',event=>{
      if(event.button!==0) return;
      event.preventDefault();
      separator.setPointerCapture(event.pointerId);
      const start=axis==='x'?event.clientX:event.clientY;
      const size=axis==='x'?state.sideWidth:state.sourceHeight;
      separator.classList.add('dragging');
      const move=next=>{
        if(next.pointerId!==event.pointerId) return;
        if(axis==='x')state.sideWidth=size-(next.clientX-start);
        else state.sourceHeight=size+(next.clientY-start);
        apply();
      };
      const finish=next=>{
        if(next.pointerId!==event.pointerId) return;
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
      if(!direction) return;
      event.preventDefault();
      if(axis==='x')state.sideWidth+=direction*24;
      else state.sourceHeight+=direction*24;
      apply();persist();
    });
  }
  bind(horizontal,'x');bind(vertical,'y');
  window.addEventListener('resize',apply);
  apply();requestAnimationFrame(apply);
}
