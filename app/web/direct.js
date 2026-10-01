import {locate,setNote,removeNote,addPosition,removePosition,insertMeasure,removeMeasure} from './core.js';
import {drawRhythms} from './notation.js';

export function setupDirectEditing({getScore,getSelection,commit,choose,chooseMeasure,render,notify}){
  const view=document.querySelector('#tab-view');let editor=null,menu=null,finishEditing=null,clickedCell=null;
  const dismiss=()=>{editor?.closest('.tab-cell')?.classList.remove('editing-cell');editor?.remove();editor=null;finishEditing=null;menu?.remove();menu=null;};
  function showNear(node,target){
    const rect=target.getBoundingClientRect();document.body.append(node);
    node.style.left=Math.max(8,Math.min(innerWidth-node.offsetWidth-8,rect.left))+'px';
    node.style.top=Math.max(8,Math.min(innerHeight-node.offsetHeight-8,rect.bottom+5))+'px';
  }
  function inputFret(first){
    const selected=getSelection(),score=getScore(),found=selected&&locate(score,selected.eventId,selected.noteId);
    if(!found||['position','rhythm','measure','multi'].includes(selected.kind))return;
    const target=view.querySelector(`[data-event="${CSS.escape(selected.eventId)}"][data-string="${selected.string}"]`);if(!target)return;
    dismiss();const documentId=score.id,eventId=selected.eventId,noteId=selected.noteId,string=selected.string;
    const panel=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');panel.classList.add('inline-fret-slot');
    const hit=target.querySelector('.cell-target');for(const key of ['x','y','width','height'])panel.setAttribute(key,hit.getAttribute(key));
    const input=document.createElement('input');input.id='inline-fret';input.inputMode='numeric';input.maxLength=2;input.setAttribute('aria-label','直接输入品位');input.value=first??String(found.note?.fret??'');
    input.title='0–36品 · Enter确认 · Esc取消';panel.append(input);editor=panel;target.classList.add('editing-cell');target.append(panel);input.focus({preventScroll:true});
    if(first===undefined)input.select();else input.setSelectionRange(input.value.length,input.value.length);
    let done=false;
    const finish=(cancel=false)=>{
      if(done)return true;
      if(cancel){done=true;dismiss();return true;}
      if(getScore().id!==documentId||!locate(getScore(),eventId)){done=true;dismiss();return true;}
      if(!/^\d{1,2}$/.test(input.value)||Number(input.value)>36){input.title='请输入0–36之间的品位';input.setAttribute('aria-invalid','true');return false;}
      done=true;const fret=Number(input.value);dismiss();
      commit(()=>{const id=setNote(getScore(),eventId,noteId,string,fret);Object.assign(getSelection(),{eventId,noteId:id,string,kind:'note'});});return true;
    };
    finishEditing=finish;
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();if(finish())view.focus({preventScroll:true});}
      if(event.key==='Escape'){event.preventDefault();done=true;dismiss();view.focus({preventScroll:true});}
    });
    input.addEventListener('blur',()=>{if(!done&&!finish()){done=true;dismiss();notify('无效品位未应用，请输入0–36');}});
  }
  function rhythmMenu(eventId,target){
    dismiss();const documentId=getScore().id,panel=document.createElement('div');panel.className='rhythm-menu';panel.setAttribute('role','group');panel.setAttribute('aria-label','选择音符时值');
    const values=[['1/4','四分'],['1/8','八分'],['1/16','十六分'],['1/32','三十二分'],['1/2','二分'],['1','全音符'],['3/8','附点四分'],['3/16','附点八分'],[null,'待设置']];
    const ns='http://www.w3.org/2000/svg',el=(tag,attrs={},text)=>{const node=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;};
    for(const [value,label] of values){
      const button=document.createElement('button');button.dataset.duration=value??'';button.title=label;
      const icon=el('svg',{width:30,height:34,viewBox:'0 173 40 40','aria-hidden':'true'});drawRhythms(icon,{events:[{id:'icon',duration:value,notes:[{}]}]},[4,4],()=>18,el,false);
      button.append(icon,document.createTextNode(label));
      button.addEventListener('click',()=>{dismiss();if(getScore().id!==documentId||!locate(getScore(),eventId))return;commit(()=>{locate(getScore(),eventId).event.duration=value;});});panel.append(button);
    }
    const found=locate(getScore(),eventId);
    if(found&&!found.event.notes.length){
      const button=document.createElement('button');button.dataset.rhythmRest='true';button.textContent=found.event.kind==='rest'?'移除休止':'设为休止';
      button.addEventListener('click',()=>{dismiss();if(getScore().id!==documentId)return;const current=locate(getScore(),eventId);if(!current||current.event.notes.length)return;commit(()=>{current.event.kind=current.event.kind==='rest'?'unknown':'rest';});});panel.append(button);
    }
    menu=panel;showNear(panel,target);panel.querySelector('button').focus();
  }
  function deleteSelected(){
    const selected=getSelection();if(!selected?.eventId)return;
    if(selected.kind==='position')deletePosition(selected.eventId);
    else if((selected.kind==='note'||!selected.kind)&&selected.noteId)commit(()=>{removeNote(getScore(),selected.eventId,selected.noteId);selected.noteId=null;selected.kind='note';});
  }
  function deletePosition(eventId){
    commit(()=>{const measure=locate(getScore(),eventId).measure,next=removePosition(getScore(),eventId);
      if(!measure.events.length)chooseMeasure(measure);
      else Object.assign(getSelection(),{eventId:next.id,noteId:null,string:1,kind:'position'});
    });
  }
  view.addEventListener('click',event=>{
    if(event.target.closest('#inline-fret'))return;
    const cell=event.target.closest('.tab-cell[data-event]');
    if(cell){
      const key=cell.dataset.event+':'+cell.dataset.string,selected=getSelection();
      const again=clickedCell===key&&selected?.kind==='note'&&selected.eventId===cell.dataset.event&&selected.string===Number(cell.dataset.string);
      if(!again||event.shiftKey)choose(cell.dataset.event,cell.dataset.note,Number(cell.dataset.string),event.shiftKey,'note');
      clickedCell=key;view.focus({preventScroll:true});
      if(again&&!event.shiftKey)inputFret();return;
    }
    clickedCell=null;
    const action=event.target.closest('[data-direct-action]'),position=event.target.closest('[data-position],[data-column-position]'),rhythm=event.target.closest('[data-rhythm]');
    if(position){choose(position.dataset.position??position.dataset.columnPosition,null,1,event.shiftKey,'position');view.focus({preventScroll:true});return;}
    if(rhythm){const id=rhythm.dataset.rhythm;choose(id,null,1,false,'rhythm');const target=view.querySelector(`[data-rhythm="${CSS.escape(id)}"]`);rhythmMenu(id,target);return;}
    if(!action)return;
    const score=getScore(),id=action.dataset.eventId;
    if(action.dataset.directAction==='delete-position'){deletePosition(id);return;}
    if(action.dataset.directAction==='append-position'){
      const measureId=action.dataset.measureId;
      commit(()=>{const eventId=addPosition(getScore(),measureId,null);Object.assign(getSelection(),{eventId,noteId:null,string:1,kind:'note'});});
      document.querySelector('[data-editor-tab=note]').click();
      view.querySelectorAll('.measure-card').forEach(card=>{if(card.dataset.measure===measureId)card.querySelector('.tab-scroll').scrollLeft=card.querySelector('.tab-scroll').scrollWidth;});
      view.focus({preventScroll:true});return;
    }
    commit(()=>{
      if(action.dataset.directAction==='insert-measure')chooseMeasure(insertMeasure(score,action.dataset.measureId,action.dataset.placement));
      else if(action.dataset.directAction==='delete-measure')chooseMeasure(removeMeasure(score,action.dataset.measureId));
      else{const found=locate(score,id),next=addPosition(score,found.measure.id,id,action.dataset.directAction==='position-before'?'before':'after');
        Object.assign(getSelection(),{eventId:next,noteId:null,string:1,kind:'position'});}
    });view.focus({preventScroll:true});
  });
  view.addEventListener('keydown',event=>{
    if(['Enter',' '].includes(event.key)&&event.target.matches('[data-position],[data-column-position],[data-rhythm],[data-direct-action="append-position"]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:event.shiftKey}));}
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&menu){event.preventDefault();dismiss();view.focus({preventScroll:true});return;}
    if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,select,[contenteditable=true],dialog[open]')||document.querySelector('dialog[open]'))return;
    if(event.target.closest('button')&&!view.contains(event.target))return;
    if(event.key==='Backspace'&&getSelection()?.kind!=='multi'){event.preventDefault();deleteSelected();}
    else if(/^\d$/.test(event.key)&&!['position','rhythm','measure','multi'].includes(getSelection()?.kind)){event.preventDefault();inputFret(event.key);}
  });
  document.addEventListener('pointerdown',event=>{
    if(editor&&!editor.contains(event.target)){
      // Confirm before rerendering, then restore the intended click destination.
      // Otherwise the SVG under the pointer disappears during input blur.
      const cell=event.target.closest('.tab-cell[data-event]');
      const destination=event.target.closest('[data-direct-action],[data-position],[data-column-position],[data-rhythm],[data-empty-measure],[data-add-measure-position],[data-select-measure]');
      const measure=event.target.closest('.measure-card');
      const data=destination?{...destination.dataset}:null;
      const selection=cell?{eventId:cell.dataset.event,noteId:cell.dataset.note,string:Number(cell.dataset.string)}:null;
      const finish=finishEditing;
      if(finish&&!finish()){finish(true);notify('无效品位未应用，请输入0–36');}
      if(selection){choose(selection.eventId,selection.noteId,selection.string,event.shiftKey);clickedCell=selection.eventId+':'+selection.string;view.focus({preventScroll:true});event.preventDefault();}
      else if(data){
        const selector=Object.entries(data).map(([key,value])=>`[data-${key.replace(/[A-Z]/g,char=>'-'+char.toLowerCase())}="${CSS.escape(value)}"]`).join('');
        view.querySelector(selector)?.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:event.shiftKey}));event.preventDefault();
      }
      else if(measure){chooseMeasure(getScore().measures.find(m=>m.id===measure.dataset.measure));render();document.querySelector('[data-editor-tab=measure]').click();view.focus({preventScroll:true});}
    }
    if(!event.target.closest('.tab-cell[data-event]'))clickedCell=null;
    if(menu&&!menu.contains(event.target)&&!event.target.closest('[data-rhythm]')){menu.remove();menu=null;}
  });
  view.tabIndex=-1;
  return {confirm:()=>finishEditing?finishEditing():true};
}
