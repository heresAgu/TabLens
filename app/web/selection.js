import {fraction,checkDynamics,dynamicVolume,dynamicLevel,removeNote,eventRange} from './core.js';

export function noteSelection(score,noteIds,extraEvents=[]){
  const wanted=new Set(noteIds),eventSet=new Set(extraEvents),ids=[];
  for(const measure of score.measures)for(const event of measure.events)for(const note of event.notes){
    if(wanted.has(note.id)){ids.push(note.id);eventSet.add(event.id);}
  }
  const eventIds=score.measures.flatMap(m=>m.events).filter(e=>eventSet.has(e.id)).map(e=>e.id);
  return {kind:'multi',noteIds:ids,eventIds,eventId:eventIds[0]??null,noteId:null,string:1};
}
export function editNotes(score,selection,{duration,dynamics,volumeDelta,remove=false}={}){
  if(duration!==undefined)fraction(duration);
  checkDynamics(dynamics);
  if(volumeDelta!==undefined&&!Number.isFinite(volumeDelta))throw new Error('音量增减值无效');
  const notes=new Set(selection.noteIds),events=new Set(selection.eventIds);
  for(const measure of score.measures)for(const event of measure.events){
    if(duration!==undefined&&events.has(event.id))event.duration=duration;
    for(const note of [...event.notes])if(notes.has(note.id)){
      if(dynamics!==undefined)note.dynamics=dynamics;
      if(volumeDelta!==undefined)note.dynamics=Math.max(0,Math.min(100,dynamicVolume(dynamicLevel(event,note))+volumeDelta));
      if(remove)removeNote(score,event.id,note.id);
    }
  }
}

export function setupMultiSelection({getScore,getSelection,setSelection,chooseMeasure,commit,render,notify}){
  const view=document.querySelector('#tab-view');let drag=null,box=null,suppressClick=false,frame;
  const point=event=>{const rect=view.getBoundingClientRect();return {x:event.clientX-rect.left+view.scrollLeft,y:event.clientY-rect.top+view.scrollTop};};
  const select=(ids,extra=[],anchor=null)=>{
    const selection=noteSelection(getScore(),ids,extra);selection.rangeAnchor=anchor??selection.eventId;
    if(selection.eventIds.length)setSelection(selection);else chooseMeasure(getScore().measures.find(m=>m.id===view.querySelector('.active-measure')?.dataset.measure)??getScore().measures[0]);
    render();view.focus({preventScroll:true});
  };
  const clear=()=>{chooseMeasure(getScore().measures.find(m=>m.events.some(e=>e.id===getSelection()?.eventId))??getScore().measures[0]);render();};
  const apply=options=>{
    const selection=getSelection();if(selection?.kind!=='multi')return;
    commit(()=>{editNotes(getScore(),selection,options);if(options.remove)chooseMeasure(getScore().measures.find(m=>m.events.some(e=>e.id===selection.eventId))??getScore().measures[0]);});
  };
  document.querySelector('#selection-apply-duration').addEventListener('click',()=>apply({duration:document.querySelector('#selection-duration').value}));
  for(const button of document.querySelectorAll('[data-selection-dynamics]'))button.addEventListener('click',()=>apply({dynamics:button.dataset.selectionDynamics}));
  document.querySelector('#selection-delete').addEventListener('click',()=>apply({remove:true}));
  document.querySelector('#selection-clear').addEventListener('click',clear);
  document.querySelector('#selection-apply-volume').addEventListener('click',()=>{const input=document.querySelector('#selection-volume');if(!input.value||!input.checkValidity()){notify('请输入0–100的音量');return;}apply({dynamics:Number(input.value)});});
  for(const button of document.querySelectorAll('[data-selection-volume-delta]'))button.addEventListener('click',()=>apply({volumeDelta:Number(button.dataset.selectionVolumeDelta)}));
  view.addEventListener('click',event=>{
    if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;return;}
    if(event.target.closest('input'))return;
    const cell=event.target.closest('.has-note[data-note]'),position=event.target.closest('[data-position],[data-column-position]');
    if(event.ctrlKey&&cell){
      event.preventDefault();event.stopImmediatePropagation();
      const selected=getSelection(),ids=new Set(selected?.kind==='multi'?selected.noteIds:selected?.noteId?[selected.noteId]:[]);
      if(ids.has(cell.dataset.note))ids.delete(cell.dataset.note);else ids.add(cell.dataset.note);
      select([...ids]);return;
    }
    if(event.shiftKey&&(cell||position)){
      event.preventDefault();event.stopImmediatePropagation();
      const last=cell?.dataset.event??position.dataset.position??position.dataset.columnPosition;
      const anchor=getSelection()?.rangeAnchor??getSelection()?.eventId??last,events=eventRange(getScore(),anchor,last);
      select(events.flatMap(e=>e.notes).map(n=>n.id),events.map(e=>e.id),anchor);
    }
  },true);
  view.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('input,button,[data-direct-action],[data-position],[data-column-position],[data-rhythm],.has-note')||!event.target.closest('.measure-card'))return;
    const selected=getSelection();
    drag={id:event.pointerId,start:point(event),x:event.clientX,y:event.clientY,active:false,ctrl:event.ctrlKey,existing:selected?.kind==='multi'?[...selected.noteIds]:selected?.noteId?[selected.noteId]:[],hits:[]};
  });
  const paint=()=>{
    if(!drag?.active)return;
    const end=point({clientX:drag.x,clientY:drag.y}),left=Math.min(drag.start.x,end.x),top=Math.min(drag.start.y,end.y),right=Math.max(drag.start.x,end.x),bottom=Math.max(drag.start.y,end.y);
    Object.assign(box.style,{left:left+'px',top:top+'px',width:right-left+'px',height:bottom-top+'px'});
    const viewport=view.getBoundingClientRect();drag.hits=[];
    for(const cell of view.querySelectorAll('.has-note')){
      const rect=cell.querySelector('.fret-number').getBoundingClientRect();
      const x=rect.left-viewport.left+view.scrollLeft,y=rect.top-viewport.top+view.scrollTop;
      const hit=x<=right&&x+rect.width>=left&&y<=bottom&&y+rect.height>=top;
      cell.classList.toggle('box-preview',hit);if(hit)drag.hits.push(cell.dataset.note);
    }
  };
  const scroll=()=>{
    if(!drag?.active)return;
    const rect=view.getBoundingClientRect();
    if(drag.y<rect.top+30)view.scrollTop-=12;else if(drag.y>rect.bottom-30)view.scrollTop+=12;
    paint();frame=requestAnimationFrame(scroll);
  };
  view.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    drag.x=event.clientX;drag.y=event.clientY;const end=point(event);
    if(!drag.active&&Math.hypot(end.x-drag.start.x,end.y-drag.start.y)<6)return;
    if(!drag.active){drag.active=true;view.setPointerCapture(event.pointerId);box=document.createElement('div');box.className='selection-box';view.append(box);frame=requestAnimationFrame(scroll);}
    event.preventDefault();paint();
  });
  const finish=(event,cancel=false)=>{
    if(!drag||event.pointerId!==drag.id)return;
    const current=drag;drag=null;cancelAnimationFrame(frame);box?.remove();box=null;
    for(const cell of view.querySelectorAll('.box-preview'))cell.classList.remove('box-preview');
    if(view.hasPointerCapture(event.pointerId))view.releasePointerCapture(event.pointerId);
    if(current.active){suppressClick=true;setTimeout(()=>suppressClick=false,0);if(!cancel)select(current.ctrl?[...current.existing,...current.hits]:current.hits);}
  };
  view.addEventListener('pointerup',event=>finish(event));view.addEventListener('pointercancel',event=>finish(event,true));
  document.addEventListener('keydown',event=>{
    if(getSelection()?.kind!=='multi'||event.target.closest('input,textarea,select,[contenteditable=true],dialog[open]')||document.querySelector('dialog[open]'))return;
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.key==='Backspace'){event.preventDefault();apply({remove:true});}
    if(event.key==='Escape'){event.preventDefault();clear();view.focus({preventScroll:true});}
  });
}
