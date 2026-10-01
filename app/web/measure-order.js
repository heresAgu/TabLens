import {insertMeasure,moveMeasure,removeMeasure} from './core.js';

export function setupMeasureOrder({getScore,getSelection,commit,chooseMeasure,render,notify}){
  const open=document.createElement('button');open.id='open-measure-overview';open.textContent='小节总览';
  document.querySelector('.history-actions').prepend(open);
  const dialog=document.createElement('dialog');dialog.id='measure-overview-dialog';
  dialog.innerHTML='<div class="panel-heading"><div><h2>小节总览</h2><p>拖动左侧把手调整顺序；音符、节奏和原图关联会跟随小节。</p></div><button id="close-measure-overview">关闭</button></div><p class="measure-overview-hint">在小节间点＋可新增，点右侧×可删除。所有操作都能撤销；练习范围会重置为全谱。</p><div id="measure-overview-list"></div>';
  document.body.append(dialog);
  const list=dialog.querySelector('#measure-overview-list');
  let drag=null,ghost=null,targetGap=null,scrollFrame=null;
  function cleanup(pointerId){
    const old=drag;drag=null;
    if(scrollFrame!==null)cancelAnimationFrame(scrollFrame);scrollFrame=null;
    targetGap?.classList.remove('drag-target');targetGap=null;
    ghost?.remove();ghost=null;
    if(pointerId!==undefined&&list.hasPointerCapture(pointerId))list.releasePointerCapture(pointerId);
    return old;
  }
  const updateTarget=()=>{
    targetGap?.classList.remove('drag-target');targetGap=null;
    if(!drag?.active)return;
    const bounds=list.getBoundingClientRect();
    if(drag.x<bounds.left||drag.x>bounds.right||drag.y<bounds.top||drag.y>bounds.bottom)return;
    const gaps=[...list.querySelectorAll('.measure-overview-gap')];
    targetGap=gaps.reduce((nearest,gap)=>{
      const rect=gap.getBoundingClientRect(),distance=Math.abs(drag.y-(rect.top+rect.height/2));
      return !nearest||distance<nearest.distance?{gap,distance}:nearest;
    },null)?.gap??null;
    targetGap?.classList.add('drag-target');
  };
  const scroll=()=>{
    if(!drag?.active)return;
    const bounds=list.getBoundingClientRect();
    if(drag.x>=bounds.left&&drag.x<=bounds.right){
      if(drag.y<bounds.top+35)list.scrollTop-=Math.max(5,(bounds.top+35-drag.y)*.35);
      else if(drag.y>bounds.bottom-35)list.scrollTop+=Math.max(5,(drag.y-bounds.bottom+35)*.35);
    }
    updateTarget();scrollFrame=requestAnimationFrame(scroll);
  };
  list.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('.measure-drag-handle');
    if(event.button!==0||!handle)return;
    event.preventDefault();
    const row=handle.closest('.measure-overview-row');
    drag={id:event.pointerId,measureId:row.dataset.measureId,from:Number(row.dataset.index),x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,active:false};
    list.setPointerCapture(event.pointerId);
  });
  list.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    drag.x=event.clientX;drag.y=event.clientY;
    if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6)return;
    if(!drag.active){
      drag.active=true;
      ghost=document.createElement('div');ghost.className='measure-drag-ghost';
      ghost.textContent=`移动第 ${drag.from+1} 小节`;dialog.append(ghost);
      scrollFrame=requestAnimationFrame(scroll);
    }
    ghost.style.left=`${drag.x+12}px`;ghost.style.top=`${drag.y+12}px`;
    updateTarget();event.preventDefault();
  });
  list.addEventListener('pointerup',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const gap=targetGap,old=cleanup(event.pointerId);
    if(!old.active||!gap)return;
    const gapIndex=Number(gap.dataset.gapIndex);
    const targetNumber=gapIndex-(old.from<gapIndex?1:0)+1;
    if(targetNumber===old.from+1)return;
    commit(()=>moveMeasure(getScore(),old.measureId,targetNumber));
    notify('小节顺序已调整；练习范围已重置为全谱，可撤销');
  });
  list.addEventListener('pointercancel',event=>{if(drag?.id===event.pointerId)cleanup(event.pointerId);});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){event.preventDefault();cleanup(drag.id);}});
  dialog.addEventListener('close',()=>{if(drag)cleanup(drag.id);});
  const preview=measure=>{
    const events=measure.events.slice(0,8).map(event=>event.notes.length?event.notes.map(note=>`${note.string}弦${note.fret??'?'}品`).join('＋'):event.kind==='rest'?'休止':'待填写');
    return events.join(' → ')+(measure.events.length>8?' …':'')||'空小节';
  };
  function refresh(){
    if(!dialog.open)return;
    const scrollTop=list.scrollTop,score=getScore();list.replaceChildren();
    const insertGap=index=>{
      const gap=document.createElement('div');gap.className='measure-overview-gap';gap.dataset.gapIndex=String(index);
      const button=document.createElement('button');button.type='button';button.textContent='＋';
      button.setAttribute('aria-label',index<score.measures.length?`在第${index+1}小节前添加小节`:'在末尾添加小节');
      button.title=button.getAttribute('aria-label');
      button.addEventListener('click',()=>{
        const anchor=score.measures[index];
        commit(()=>chooseMeasure(anchor?insertMeasure(getScore(),anchor.id,'before'):insertMeasure(getScore())));
        notify('已添加空白小节，可撤销');
      });gap.append(button);list.append(gap);
    };
    for(const [index,measure] of score.measures.entries()){
      insertGap(index);
      const row=document.createElement('div');row.className='measure-overview-row';row.dataset.measureId=measure.id;row.dataset.index=String(index);
      row.classList.toggle('active',getSelection()?.measureId===measure.id||measure.events.some(e=>e.id===getSelection()?.eventId));
      const handle=document.createElement('button');handle.className='measure-drag-handle';handle.type='button';handle.textContent='⠿';handle.title='拖动调整小节顺序';handle.setAttribute('aria-label',`拖动第${index+1}小节调整顺序`);row.append(handle);
      const jump=document.createElement('button');jump.className='measure-overview-preview';jump.type='button';
      const title=document.createElement('strong');title.textContent=`第 ${index+1} 小节`;
      const detail=document.createElement('span');detail.textContent=`${measure.events.length} 个位置 · ${preview(measure)}`;
      jump.append(title,detail);jump.title='跳转到这个小节';jump.addEventListener('click',()=>{
        dialog.close();chooseMeasure(measure);render();
        const view=document.querySelector('#tab-view'),card=[...view.querySelectorAll('.measure-card')].find(node=>node.dataset.measure===measure.id);
        if(card)view.scrollTop+=card.getBoundingClientRect().top-view.getBoundingClientRect().top-12;
        view.focus({preventScroll:true});
      });row.append(jump);
      const up=document.createElement('button');up.type='button';up.textContent='↑';up.title='上移一小节';up.setAttribute('aria-label',`第${index+1}小节上移`);up.disabled=index===0;
      const down=document.createElement('button');down.type='button';down.textContent='↓';down.title='下移一小节';down.setAttribute('aria-label',`第${index+1}小节下移`);down.disabled=index===score.measures.length-1;
      const moveTo=target=>{commit(()=>moveMeasure(getScore(),measure.id,target));notify('小节顺序已调整；练习范围已重置为全谱，可撤销');};
      up.addEventListener('click',()=>moveTo(index));down.addEventListener('click',()=>moveTo(index+2));row.append(up,down);
      const select=document.createElement('select');select.setAttribute('aria-label',`将第${index+1}小节移动到`);
      for(let number=1;number<=score.measures.length;number++){
        const option=document.createElement('option');option.value=String(number);option.textContent=`移到第 ${number} 小节`;option.selected=number===index+1;select.append(option);
      }
      select.addEventListener('change',()=>moveTo(Number(select.value)));row.append(select);
      const remove=document.createElement('button');remove.type='button';remove.className='measure-overview-remove danger';remove.textContent='×';
      remove.title='删除小节（可撤销）';remove.setAttribute('aria-label',`删除第${index+1}小节`);
      remove.addEventListener('click',()=>{
        commit(()=>{
          const selection=getSelection(),affected=selection?.measureId===measure.id||measure.events.some(e=>e.id===selection?.eventId||(selection?.eventIds??[]).includes(e.id));
          const next=removeMeasure(getScore(),measure.id);
          if(affected)chooseMeasure(next);
        });
        notify('小节已删除，可撤销');
      });row.append(remove);
      list.append(row);
    }
    insertGap(score.measures.length);
    list.scrollTop=scrollTop;
  }
  open.addEventListener('click',()=>{dialog.showModal();refresh();});
  dialog.querySelector('#close-measure-overview').addEventListener('click',()=>dialog.close());
  return refresh;
}
