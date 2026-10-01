import {dynamicCategory as dynamicLevel, timingWarning} from './core.js';
import {drawRhythms} from './notation.js';
import {previousOnString} from './techniques.js';
const SVG = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};
export const durationLabel = value => ({'1': '全音符', '1/2': '二分', '1/4': '四分', '1/8': '八分', '1/16': '十六分', '1/32': '三十二分', '3/8': '附点四分', '3/16': '附点八分'}[value] ?? (value ? value : '待设节奏'));

export function renderTab(container, score, selected, range = new Set(), {editable=false} = {}) {
  const sameScore=container.dataset.renderedScore===score.id;
  const scrollTop=sameScore?container.scrollTop:0;
  const scrollPositions=new Map(sameScore?[...container.querySelectorAll('.measure-card')].map(card=>[card.dataset.measure,card.querySelector('.tab-scroll')?.scrollLeft??0]):[]);
  container.dataset.renderedScore=score.id;
  container.replaceChildren();
  const boundary=(measure,placement)=>{
    const row=document.createElement('div');row.className='measure-insertion';
    const button=document.createElement('button');button.textContent='＋';button.title='在这里添加小节';button.setAttribute('aria-label','在这里添加小节');
    button.dataset.directAction='insert-measure';button.dataset.measureId=measure.id;button.dataset.placement=placement;row.append(button);container.append(row);
  };
  if(editable&&score.measures[0])boundary(score.measures[0],'before');
  for (const measure of score.measures) {
    const card = document.createElement('section');
    card.className = 'measure-card';
    card.dataset.measure=measure.id;
    card.classList.toggle('active-measure',measure.id===selected?.measureId || measure.events.some(e=>e.id===selected?.eventId));
    card.classList.toggle('selected-measure',selected?.kind==='measure'&&measure.id===selected.measureId);
    const head = document.createElement('div');
    head.className = 'measure-head';
    const name = document.createElement('span');
    name.textContent = `第 ${measure.number} 小节`;
    if(measure.originalNumber!==undefined){name.title=`对应原谱第 ${measure.originalNumber} 小节`;name.dataset.originalNumber=measure.originalNumber;}
    const state = document.createElement('span');
    state.className = 'measure-state';
    state.textContent = timingWarning(score, measure) || '节奏已设置';
    head.append(name, state);
    if(editable) {
      const select=document.createElement('button');select.className='small';select.textContent='小节操作';
      select.dataset.selectMeasure=measure.id;head.append(select);
      const add=document.createElement('button');add.className='small';add.textContent='＋ 位置';
      add.dataset.addMeasurePosition=measure.id;head.append(add);
      const remove=document.createElement('button');remove.className='measure-remove danger';remove.textContent='×';remove.title='删除这个小节';remove.setAttribute('aria-label','删除这个小节');
      remove.dataset.directAction='delete-measure';remove.dataset.measureId=measure.id;head.append(remove);
    }
    card.append(head);
    const wrap = document.createElement('div');
    wrap.className = 'tab-scroll';
    const step = 49, left = 62, right = 26, top = 43, gap = 24;
    const width = Math.max(430, left + (measure.events.length+1) * step + right);
    const svg = el('svg', {viewBox: `0 0 ${width} 214`, width, height: 214, class: 'tab-staff', 'aria-label': `第${measure.number}小节六线谱`});
    for (let string = 1; string <= 6; string++) {
      const y = top + (string - 1) * gap;
      svg.append(el('line', {x1: left - 20, x2: width - right + 2, y1: y, y2: y, class: 'string-line'}));
      svg.append(el('text', {x: 19, y: y + 4, class: 'string-label'}, `${string}`));
    }
    svg.append(el('line', {x1: left - 20, x2: left - 20, y1: top, y2: top + 5 * gap, class: 'bar-line'}));
    svg.append(el('line', {x1: width - right + 2, x2: width - right + 2, y1: top, y2: top + 5 * gap, class: 'bar-line'}));
    if(editable && !measure.events.length) {
      const start=el('g',{class:'append-position', 'data-direct-action':'append-position','data-measure-id':measure.id,tabindex:0,role:'button','aria-label':'添加第一个演奏位置'});
      start.append(el('rect',{x:left+4,y:1,width:158,height:27,rx:7,class:'append-position-hit'}));
      start.append(el('text',{x:left+14,y:19,class:'append-position-label'},'＋ 添加第1个演奏位置'));svg.append(start);
      for(let string=1;string<=6;string++) {
        const cell=el('g',{'data-empty-measure':measure.id,'data-string':string,tabindex:0,role:'button',class:'tab-cell',
          'aria-label':`空小节，第${string}弦，添加第一个演奏位置`});
        cell.append(el('rect',{x:left,y:top+(string-1)*gap-11,width:width-left-right,height:22,rx:4,class:'cell-target'}));svg.append(cell);
      }
      svg.append(el('text',{x:left+12,y:192,class:'duration-label'},'空小节 · 点击弦线开始写谱'));
    }
    for (const [index, event] of measure.events.entries()) {
      const x = left + step * index + step / 2;
      if (selected?.eventId === event.id) svg.append(el('rect', {x: x - 22, y: top - 17, width: 44, height: 5 * gap + 34, rx: 8, class: selected.kind==='position'?'event-selection position-selection':'event-selection'}));
      if(editable&&selected?.eventId===event.id){
        const handle=el('g',{'data-column-position':event.id,class:'column-handle',tabindex:0,role:'button','aria-label':'选中整个演奏位置'});
        handle.append(el('title',{},'选中整个演奏位置'));
        handle.append(el('rect',{x:x-20,y:26,width:40,height:6,rx:3}));svg.append(handle);
      }
      else if (range.has(event.id)) svg.append(el('rect', {x: x - 22, y: top - 17, width: 44, height: 5 * gap + 34, rx: 8, class: selected?.kind==='multi'?'range-selection multi-range':'range-selection'}));
      const position=el('g',{class:`position-selector${selected?.eventId===event.id&&selected?.kind==='position'?' active':''}`,...(editable?{'data-position':event.id,tabindex:0,role:'button','aria-label':`选择第${index+1}个演奏位置`}:{})});
      position.append(el('rect',{x:x-15,y:2,width:30,height:23,rx:5,class:'position-hit'}));
      position.append(el('text', {x, y: 18, 'text-anchor': 'middle', class: 'position-label'}, index + 1));svg.append(position);
      if(editable&&index===measure.events.length-1){
        const add=el('g',{class:'append-position', 'data-direct-action':'append-position','data-measure-id':measure.id,tabindex:0,role:'button','aria-label':`在第${index+1}个演奏位置后添加位置`});
        add.append(el('rect',{x:x+18,y:1,width:26,height:25,rx:6,class:'append-position-hit'}));
        add.append(el('text',{x:x+31,y:19,'text-anchor':'middle',class:'append-position-label'},'＋'));
        svg.append(add);
      }
      for (let string = 1; string <= 6; string++) {
        const y = top + (string - 1) * gap;
        const note = event.notes.find(n => n.string === string);
        const multiSelected=!!note&&selected?.kind==='multi'&&selected.noteIds.includes(note.id);
        const isCellSelected=selected?.kind==='multi'?multiSelected:selected?.kind!=='position'&&selected?.kind!=='rhythm'&&selected?.eventId===event.id&&selected.string===string;
        const cell = el('g', {class: `tab-cell${note ? ` has-note dynamic-${dynamicLevel(event, note)}` : ''}${note&&(note.id===selected?.noteId||multiSelected) ? ' selected-note' : ''}${isCellSelected?' selected-cell':''}`,
          'data-event': event.id, 'data-note': note?.id ?? '', 'data-string': string, 'data-x': x,
          tabindex: 0, role: 'button', 'aria-label': `${index + 1}位置，第${string}弦${note ? `，${note.fret ?? '未知'}品，${{soft: '轻', normal: '中', strong: '重'}[dynamicLevel(event, note)]}力度` : '，添加音符'}`});
        cell.append(el('rect', {x: x - 21, y: y - 11, width: 42, height: 22, rx: 5, class: 'cell-target'}));
        if (note) {
          const textWidth = note.fret !== null && note.fret >= 10 ? 27 : 19;
          cell.append(el('rect', {x: x - textWidth / 2, y: y - 10, width: textWidth, height: 20, rx: 4, class: 'fret-background'}));
          cell.append(el('text', {x, y: y + 6, 'text-anchor': 'middle', class: 'fret-number'}, note.fret ?? '?'));
          if (note.graceBefore) {
            const graceY = top + (note.graceBefore.string - 1) * gap;
            cell.append(el('rect', {x: x - 36, y: graceY - 9, width: 17, height: 18,
              class: 'grace-background'}));
            cell.append(el('text', {x: x - 27, y: graceY + 4, 'text-anchor': 'middle',
              class: 'grace-number', 'data-grace': note.graceBefore.id}, note.graceBefore.fret));
            cell.append(el('title', {}, '倚音：' + note.graceBefore.string + '弦' +
              note.graceBefore.fret + '品，进入主音'));
          }
          if (note.bend) {
            const amount = note.bend.semitones === 2 ? 'full' :
              note.bend.semitones === 1 ? '½' : '¼';
            cell.append(el('text', {x: x + 13, y: y - 12,
              class: 'bend-marker'}, '↗' + amount + (note.bend.release ? '↘' : '')));
          }
          if (note.technique) {
            const previous = previousOnString(score, event.id, string);
            const marker = note.technique.type === 'slide' ? (note.fret > previous?.note.fret ? '/' : '\\') : note.technique.type === 'hammer' ? 'h' : 'p';
            cell.append(el('text', {x: x - 18, y: y - 12, class: 'technique-marker'}, marker));
            cell.append(el('title', {}, `${previous?.note.fret ?? '?'}${marker}${note.fret ?? '?'}`));
          }
        }
        svg.append(cell);
      }
    }
    drawRhythms(svg,measure,score.timeSignature,index=>left+step*index+step/2,el,editable);
    if(selected?.kind==='rhythm')svg.querySelector(`[data-rhythm="${CSS.escape(selected.eventId)}"]`)?.classList.add('selected-rhythm');
    svg.append(el('line', {x1: 0, x2: 0, y1: 25, y2: 177, class: 'playhead', visibility: 'hidden'}));
    wrap.append(svg);
    card.append(wrap);
    if(editable&&selected?.kind==='position'&&measure.events.some(e=>e.id===selected.eventId)){
      const actions=document.createElement('div');actions.className='position-actions';
      const label=document.createElement('span');label.textContent=`位置 ${measure.events.findIndex(e=>e.id===selected.eventId)+1}`;actions.append(label);
      for(const [action,text] of [['position-before','＋ 前'],['delete-position','× 删除位置'],['position-after','＋ 后']]){
        const button=document.createElement('button');button.textContent=text;button.dataset.directAction=action;button.dataset.eventId=selected.eventId;actions.append(button);
      }head.after(actions);
    }
    container.append(card);
    wrap.scrollLeft=scrollPositions.get(measure.id)??0;
    if(editable)boundary(measure,'after');
  }
  // Rebuilding children temporarily collapses the scrollable content to zero.
  // Restore vertical position only after all measures are back in the DOM.
  container.scrollTop=scrollTop;
}

export function updatePlayhead(container, eventId, progress = 0, follow = false, graceNoteId = null) {
  let first = null;
  for (const cell of container.querySelectorAll('[data-event]')) {
    const active = cell.dataset.event === eventId;
    cell.classList.toggle('playing-note', active && !graceNoteId);
    if (active && !first) first = cell;
  }
  for (const marker of container.querySelectorAll('[data-grace]'))
    marker.classList.toggle('playing-grace', marker.dataset.grace === graceNoteId);
  for (const line of container.querySelectorAll('.playhead')) line.setAttribute('visibility', 'hidden');
  if (!first) return;
  const svg = first.closest('svg'), line = svg.querySelector('.playhead');
  const x = Number(first.dataset.x) - 20 + Math.min(1, Math.max(0, progress)) * 40;
  line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('visibility', 'visible');
  if (follow) {
    const wrap = svg.closest('.tab-scroll'), center = Number(first.dataset.x);
    if (center < wrap.scrollLeft + 55 || center > wrap.scrollLeft + wrap.clientWidth - 55) wrap.scrollLeft = Math.max(0, center - wrap.clientWidth / 2);
    const card = svg.closest('.measure-card'), rect = card.getBoundingClientRect();
    const viewport=container.getBoundingClientRect();
    if (rect.top < viewport.top || rect.bottom > viewport.bottom) {
      container.scrollTop += rect.top-viewport.top-(container.clientHeight-rect.height)/2;
    }
  }
}

export function renderSource(svg, score, selected, wholePage = false) {
  svg.replaceChildren();
  delete svg.dataset.pageId;
  const measure = score.measures.find(m => m.id===selected?.measureId || m.events.some(e => e.id === selected?.eventId));
  const event = measure?.events.find(e => e.id === selected?.eventId);
  const pageId = measure?.source?.pageId ?? event?.notes.find(n => n.source)?.source.pageId ?? measure?.events.flatMap(e=>e.notes).find(n=>n.source)?.source.pageId;
  if(measure?.authored && !pageId)return false;
  const page = score.sources.find(p => p.id === pageId) ?? score.sources[0];
  if (!page || !(page.dataUrl || page.url)) return false;
  const crop = measure?.source?.pageId === page.id ? measure.source.box : page.cropBox;
  let [x1, y1, x2, y2] = !wholePage && crop ? crop : [0, 0, page.width, page.height];
  svg.dataset.pageId = page.id;
  if (!wholePage && !measure?.source && page.cropBox && selected) {
    const boxes = measure?.events.flatMap(e => e.notes).filter(n => n.source?.pageId === page.id && n.source.box).map(n => n.source.box) ?? [];
    if (boxes.length) {
      x1 = Math.min(...boxes.map(b => b[0]));
      x2 = Math.max(...boxes.map(b => b[2]));
    }
  }
  const padding = wholePage ? 0 : 22;
  const left = Math.max(0, x1 - padding), top = Math.max(0, y1 - padding);
  svg.setAttribute('viewBox', `${left} ${top} ${x2 - left + padding} ${y2 - top + padding}`);
  svg.append(el('image', {href: page.dataUrl || page.url, x: 0, y: 0, width: page.width, height: page.height}));
  for (const note of event?.notes ?? []) {
    if (note.source?.pageId !== page.id || !note.source.box) continue;
    const [a, b, c, d] = note.source.box;
    svg.append(el('rect', {x: a - 2, y: b - 2, width: c - a + 4, height: d - b + 4,
      class: note.id === selected.noteId ? 'source-focus' : 'source-chord', rx: 3}));
  }
  return true;
}
