import {insertMeasure,moveMeasure,removeMeasure} from './core.js';

const svgNS='http://www.w3.org/2000/svg';
const svgElement=(name,attributes={})=>{
  const node=document.createElementNS(svgNS,name);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
  return node;
};

function miniTab(measure){
  const svg=svgElement('svg',{class:'measure-thumb-svg',viewBox:'0 0 248 94','aria-hidden':'true'});
  for(let string=1;string<=6;string++){
    const y=12+(string-1)*14;
    svg.append(svgElement('line',{x1:12,y1:y,x2:238,y2:y,class:'measure-thumb-line'}));
  }
  const events=measure.events.slice(0,12);
  for(const [index,event] of events.entries()){
    const x=24+index*(204/Math.max(1,events.length-1));
    if(event.kind==='rest'){
      const rest=svgElement('text',{x,y:53,class:'measure-thumb-note'});
      rest.textContent='·';svg.append(rest);
    }
    for(const note of event.notes){
      if(!Number.isInteger(note.string)||note.string<1||note.string>6)continue;
      const y=12+(note.string-1)*14;
      const backdrop=svgElement('rect',{x:x-8,y:y-9,width:17,height:13,class:'measure-thumb-number-bg'});
      const label=svgElement('text',{x,y:y+4,class:'measure-thumb-note'});
      label.textContent=String(note.fret??'?');
      svg.append(backdrop,label);
    }
  }
  return svg;
}

export function setupMeasureOrder({getScore,getSelection,commit,chooseMeasure,render,notify}){
  const open=document.createElement('button');
  open.id='open-measure-overview';open.className='icon-button';
  open.type='button';open.title='展开小节总览';open.dataset.tip='展开小节总览';
  open.setAttribute('aria-label','展开小节总览');
  open.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="7" height="7"/><rect x="11" y="2" width="7" height="7"/><rect x="2" y="11" width="7" height="7"/><rect x="11" y="11" width="7" height="7"/></svg>';
  document.querySelector('.history-actions').prepend(open);

  const dialog=document.createElement('dialog');dialog.id='measure-overview-dialog';
  dialog.innerHTML='<div class="panel-heading"><div><h2>小节总览</h2><p>拖动整张卡片调整顺序；原图、音符和节奏随小节移动。</p></div><button id="close-measure-overview" class="dialog-close" type="button" aria-label="关闭小节总览" title="关闭">×</button></div><div id="measure-overview-list" aria-label="小节总览"></div>';
  document.body.append(dialog);
  const overview=dialog.querySelector('#measure-overview-list');
  const sidebar=document.querySelector('#files-sidebar');
  const sideList=document.querySelector('#sidebar-measure-list');
  const sourceImages=new WeakMap();
  const imageObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      const page=sourceImages.get(entry.target);
      if(page)entry.target.setAttribute('href',page.dataUrl||page.url);
      imageObserver.unobserve(entry.target);
    }
  },{rootMargin:'240px'});
  let drag=null,ghost=null,targetNode=null,targetIndex=null,scrollFrame=null;

  function clearTarget(){
    targetNode?.classList.remove('drag-before','drag-after','drag-target');
    targetNode=null;targetIndex=null;
  }
  function cleanup(){
    const old=drag;drag=null;
    if(scrollFrame!==null)cancelAnimationFrame(scrollFrame);
    scrollFrame=null;clearTarget();
    ghost?.remove();ghost=null;
    if(old?.host.hasPointerCapture(old.id))old.host.releasePointerCapture(old.id);
    return old;
  }
  function updateTarget(){
    clearTarget();
    if(!drag?.active)return;
    const host=drag.host,bounds=host.getBoundingClientRect();
    if(drag.x<bounds.left||drag.x>bounds.right||drag.y<bounds.top||drag.y>bounds.bottom)return;
    const under=document.elementFromPoint(drag.x,drag.y);
    const gap=under?.closest('.measure-overview-gap');
    if(gap&&host.contains(gap)){
      targetNode=gap;targetIndex=Number(gap.dataset.gapIndex);
      gap.classList.add('drag-target');return;
    }
    const cards=[...host.querySelectorAll('.measure-overview-row')];
    let card=under?.closest('.measure-overview-row');
    if(!card||!host.contains(card)){
      card=cards.reduce((nearest,item)=>{
        const rect=item.getBoundingClientRect();
        const dx=Math.max(rect.left-drag.x,0,drag.x-rect.right);
        const dy=Math.max(rect.top-drag.y,0,drag.y-rect.bottom);
        const distance=dx*dx+dy*dy;
        return !nearest||distance<nearest.distance?{item,distance}:nearest;
      },null)?.item;
    }
    if(!card)return;
    const rect=card.getBoundingClientRect();
    const before=host===sideList?drag.y<rect.top+rect.height/2:drag.x<rect.left+rect.width/2;
    targetNode=card;
    targetIndex=Number(card.dataset.index)+(before?0:1);
    card.classList.add(before?'drag-before':'drag-after');
  }
  function scroll(){
    if(!drag?.active)return;
    const host=drag.host,bounds=host.getBoundingClientRect();
    if(drag.x>=bounds.left&&drag.x<=bounds.right){
      if(drag.y<bounds.top+38)host.scrollTop-=Math.max(5,(bounds.top+38-drag.y)*.35);
      else if(drag.y>bounds.bottom-38)host.scrollTop+=Math.max(5,(drag.y-bounds.bottom+38)*.35);
    }
    updateTarget();scrollFrame=requestAnimationFrame(scroll);
  }
  function jump(measure,host){
    if(host===overview)dialog.close();
    chooseMeasure(measure);render();
    const view=document.querySelector('#tab-view');
    const card=[...view.querySelectorAll('.measure-card')].find(node=>node.dataset.measure===measure.id);
    if(card)view.scrollTop+=card.getBoundingClientRect().top-view.getBoundingClientRect().top-12;
    if(host===overview)view.focus({preventScroll:true});
  }
  function connectDrag(host){
    host.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target.closest('button,select,input,a'))return;
      const card=event.target.closest('.measure-overview-row');
      if(!card||!host.contains(card))return;
      event.preventDefault();
      drag={id:event.pointerId,host,measureId:card.dataset.measureId,from:Number(card.dataset.index),
        x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,active:false};
      host.setPointerCapture(event.pointerId);
    });
    host.addEventListener('pointermove',event=>{
      if(!drag||drag.host!==host||event.pointerId!==drag.id)return;
      drag.x=event.clientX;drag.y=event.clientY;
      if(!drag.active&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<7)return;
      if(!drag.active){
        drag.active=true;
        ghost=document.createElement('div');ghost.className='measure-drag-ghost';
        ghost.textContent=`移动第 ${drag.from+1} 小节`;
        (host===overview?dialog:document.body).append(ghost);
        scrollFrame=requestAnimationFrame(scroll);
      }
      ghost.style.left=`${drag.x+12}px`;ghost.style.top=`${drag.y+12}px`;
      updateTarget();event.preventDefault();
    });
    host.addEventListener('pointerup',event=>{
      if(!drag||drag.host!==host||event.pointerId!==drag.id)return;
      const gapIndex=targetIndex,old=cleanup();
      if(!old.active){
        const measure=getScore().measures.find(item=>item.id===old.measureId);
        if(measure)jump(measure,host);
        return;
      }
      if(gapIndex===null)return;
      const targetNumber=gapIndex-(old.from<gapIndex?1:0)+1;
      if(targetNumber===old.from+1)return;
      commit(()=>moveMeasure(getScore(),old.measureId,targetNumber));
      notify('小节顺序已调整，可撤销');
    });
    host.addEventListener('pointercancel',event=>{
      if(drag?.host===host&&drag.id===event.pointerId)cleanup();
    });
  }
  connectDrag(overview);connectDrag(sideList);

  function insertAt(index){
    const anchor=getScore().measures[index];
    commit(()=>chooseMeasure(anchor?insertMeasure(getScore(),anchor.id,'before'):insertMeasure(getScore())));
    notify('已添加空白小节，可撤销');
  }
  function createGap(index,last=false){
    const gap=document.createElement('div');gap.className='measure-overview-gap';
    gap.dataset.gapIndex=String(index);
    const button=document.createElement('button');button.type='button';
    button.textContent='＋';
    button.setAttribute('aria-label',last?'在末尾添加小节':`在第${index+1}小节前添加小节`);
    button.dataset.tip=button.getAttribute('aria-label');
    button.addEventListener('click',()=>insertAt(index));
    gap.append(button);return gap;
  }
  function createThumbnail(measure,score){
    const source=measure.source,page=score.sources.find(item=>item.id===source?.pageId);
    const box=source?.box;
    const valid=page&&(page.dataUrl||page.url)&&Array.isArray(box)&&box.length===4&&
      box.every(Number.isFinite)&&box[2]>box[0]&&box[3]>box[1]&&
      page.width>0&&page.height>0&&!measure.manualReference&&
      !(box[0]===0&&box[1]===0&&box[2]===page.width&&box[3]===page.height);
    if(!valid)return {node:miniTab(measure),label:measure.manualReference?'整页参考 · 编辑谱':'编辑谱'};
    const [x1,y1,x2,y2]=box,padding=8;
    const left=Math.max(0,x1-padding),top=Math.max(0,y1-padding);
    const width=Math.min(page.width,x2+padding)-left,height=Math.min(page.height,y2+padding)-top;
    const svg=svgElement('svg',{class:'measure-thumb-svg',viewBox:`${left} ${top} ${width} ${height}`,
      'aria-hidden':'true'});
    const image=svgElement('image',{x:0,y:0,width:page.width,height:page.height});
    sourceImages.set(image,page);svg.append(image);
    return {node:svg,image,label:measure.copiedFrom?'原谱参考':'原谱'};
  }
  function card(measure,index,score){
    const item=document.createElement('div');item.className='measure-overview-item';
    const row=document.createElement('article');row.className='measure-overview-row';
    row.dataset.measureId=measure.id;row.dataset.index=String(index);row.tabIndex=0;
    row.setAttribute('aria-label',`第${index+1}小节，拖动调整顺序，回车定位`);
    row.classList.toggle('active',getSelection()?.measureId===measure.id||
      measure.events.some(event=>event.id===getSelection()?.eventId));
    row.addEventListener('keydown',event=>{
      if(event.target!==row||!['Enter',' '].includes(event.key))return;
      event.preventDefault();jump(measure,row.closest('#measure-overview-list')?overview:sideList);
    });
    const preview=document.createElement('div');preview.className='measure-overview-preview';
    const thumbnail=createThumbnail(measure,score);
    const frame=document.createElement('div');frame.className='measure-thumb-frame';
    frame.append(thumbnail.node);preview.append(frame);
    const caption=document.createElement('div');caption.className='measure-overview-caption';
    const title=document.createElement('strong');title.textContent=`第 ${index+1} 小节`;
    const info=document.createElement('span');info.textContent=`${thumbnail.label} · ${measure.events.length} 个位置`;
    caption.append(title,info);preview.append(caption);row.append(preview);
    const actions=document.createElement('div');actions.className='measure-overview-actions';
    const moveTo=number=>{commit(()=>moveMeasure(getScore(),measure.id,number));notify('小节顺序已调整，可撤销');};
    for(const [symbol,label,number,disabled] of [
      ['↑','上移一小节',index,index===0],
      ['↓','下移一小节',index+2,index===score.measures.length-1]
    ]){
      const button=document.createElement('button');button.type='button';button.textContent=symbol;
      button.title=label;button.setAttribute('aria-label',`第${index+1}小节${label}`);
      button.disabled=disabled;button.addEventListener('click',()=>moveTo(number));actions.append(button);
    }
    const remove=document.createElement('button');remove.type='button';
    remove.className='measure-overview-remove danger';remove.textContent='×';
    remove.title='删除小节（可撤销）';remove.setAttribute('aria-label',`删除第${index+1}小节`);
    remove.addEventListener('click',()=>{
      commit(()=>{
        const selection=getSelection();
        const affected=selection?.measureId===measure.id||
          measure.events.some(event=>event.id===selection?.eventId||(selection?.eventIds??[]).includes(event.id));
        const next=removeMeasure(getScore(),measure.id);
        if(affected)chooseMeasure(next);
      });
      notify('小节已删除，可撤销');
    });
    actions.append(remove);row.append(actions);
    item.append(createGap(index),row);
    return {item,image:thumbnail.image};
  }
  function build(host,score){
    const previousScroll=host.scrollTop;
    host.replaceChildren();
    for(const [index,measure] of score.measures.entries()){
      const {item,image}=card(measure,index,score);
      host.append(item);
      if(image)imageObserver.observe(image);
    }
    host.append(createGap(score.measures.length,true));
    host.scrollTop=previousScroll;
  }
  function refresh(){
    if(!getScore())return;
    const showSide=!sidebar.hidden&&sidebar.dataset.pane==='measures';
    imageObserver.disconnect();
    if(!dialog.open&&!showSide)return;
    if(dialog.open)build(overview,getScore());
    if(showSide)build(sideList,getScore());
  }
  function showOverview(){dialog.showModal();refresh();}
  open.addEventListener('click',showOverview);
  document.querySelector('#sidebar-overview-open').addEventListener('click',showOverview);
  dialog.querySelector('#close-measure-overview').addEventListener('click',()=>dialog.close());
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&drag){event.preventDefault();cleanup();}
  });
  dialog.addEventListener('close',()=>{
    if(drag?.host===overview)cleanup();
    overview.replaceChildren();
    refresh();
  });
  return refresh;
}
