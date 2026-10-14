import {dynamicCategory as dynamicLevel, timingWarning} from './core.js';
import {suggestedStrumDynamic, strumAccents} from './playback.js';
import {autoStrumBars, getAutoStrumContrast} from './preferences.js';
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

// A chord name marks a change. Keep every event's label in the score data, but
// print it only once until the name changes within this measure.
export function displayedChords(events) {
  let previous = null;
  return events.map(event => {
    if (!event.chordName) return null;
    const show = event.chordName !== previous;
    previous = event.chordName;
    return show ? event.chordName : null;
  });
}

export function eventXPositions(events, labels = displayedChords(events), spacing = 49) {
  const positions = [];
  let lastLabelRight = 0;
  for (const [index, label] of labels.entries()) {
    const halfLabel = label ? Math.max(14, [...label].length * 3.6) : 0;
    let x = index ? positions[index - 1] + spacing : 86;
    if (label) {
      x = Math.max(x, halfLabel + 14, lastLabelRight + halfLabel + 12);
      lastLabelRight = x + halfLabel;
    }
    positions.push(x);
  }
  return positions;
}

export function renderTab(container, score, selected, range = new Set(), {editable=false} = {}) {
  const compact=editable&&document.body.dataset.layout==='review'&&document.body.dataset.scoreDensity==='compact';
  const automaticAccents = strumAccents(score);
  const strumContrast = getAutoStrumContrast();
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
    if(measure.originalNumber!==undefined){const source=score.sources.find(page=>page.id===measure.source?.pageId);
      name.title=`${source?.name ? source.name+' · ' : ''}识别时第 ${measure.originalNumber} 段`;name.dataset.originalNumber=measure.originalNumber;}
    const state = document.createElement('span');
    state.className = 'measure-state';
    state.textContent = measure.recognition?.status==='missing'&&!measure.events.length
      ? '原图段落待补录' : timingWarning(score, measure) || '节奏已设置';
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
    const hasStrum=measure.events.some(event=>!!event.strum);
    const hasChord=measure.events.some(event=>!!event.chordName);
    const left = 62, right = 26, top = compact ? (hasStrum ? 98 : hasChord ? 84 : 72) : 98;
    const gap = compact ? 20 : 24;
    const chordLabels = displayedChords(measure.events);
    const eventXs = eventXPositions(measure.events, chordLabels, compact ? 44 : 49);
    const lastLabel = chordLabels.at(-1);
    const rightPad = Math.max(80, lastLabel ? [...lastLabel].length * 3.6 + 26 : 0);
    const width = Math.max(430, (eventXs.at(-1) ?? left) + rightPad, left + 210);
    const svgHeight=compact?top+5*gap+57:275;
    const rhythmOffset=compact?top+5*gap-163:55;
    const svg = el('svg', {viewBox: `0 0 ${width} ${svgHeight}`, width, height: svgHeight, class: 'tab-staff', 'aria-label': `第${measure.number}小节六线谱`});
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
      svg.append(el('text',{x:left+12,y:svgHeight-28,class:'duration-label'},'空小节 · 点击弦线开始写谱'));
    }
    for (const [index, event] of measure.events.entries()) {
      const defaultDynamics = suggestedStrumDynamic(score, event);
      const x = eventXs[index];
      if (selected?.eventId === event.id) svg.append(el('rect', {x: x - 22, y: top - 17, width: 44, height: 5 * gap + 34, rx: 8, class: selected.kind==='position'?'event-selection position-selection':'event-selection'}));
      if(editable&&selected?.eventId===event.id){
        const handle=el('g',{'data-column-position':event.id,class:'column-handle',tabindex:0,role:'button','aria-label':'选中整个演奏位置'});
        handle.append(el('title',{},'选中整个演奏位置'));
        handle.append(el('rect',{x:x-20,y:top-19,width:40,height:7,rx:3}));svg.append(handle);
      }
      else if (range.has(event.id)) svg.append(el('rect', {x: x - 22, y: top - 17, width: 44, height: 5 * gap + 34, rx: 8, class: selected?.kind==='multi'?'range-selection multi-range':'range-selection'}));
      const position=el('g',{class:`position-selector${selected?.eventId===event.id&&selected?.kind==='position'?' active':''}`,...(editable?{'data-position':event.id,tabindex:0,role:'button','aria-label':`选择第${index+1}个演奏位置`}:{})});
      position.append(el('rect',{x:x-15,y:2,width:30,height:23,rx:5,class:'position-hit'}));
      position.append(el('text', {x, y: 18, 'text-anchor': 'middle', class: 'position-label'}, index + 1));svg.append(position);
      if (chordLabels[index]) {
        const chord = el('g', {class: 'chord-trigger', 'data-chord-diagram': event.id,
          tabindex: editable ? 0 : -1, role: 'button',
          'aria-label': `${chordLabels[index]}，查看和弦指型`});
        const halfWidth = Math.max(18, [...chordLabels[index]].length * 3.6 + 5);
        chord.append(el('rect', {x: x - halfWidth, y: 28, width: halfWidth * 2,
          height: 22, rx: 5, class: 'chord-hit'}));
        chord.append(el('text', {x, y: 39, 'text-anchor': 'middle', class: 'chord-name'}, chordLabels[index]));
        svg.append(chord);
      }
      if (event.strum) {
        const automatic = event.strum.volume === undefined;
        const accent = automaticAccents.get(event.id) ?? 1;
        const accentBars = autoStrumBars(accent, strumContrast);
        const strum = el('g', {class: event.chordPending ? 'strum-trigger pending' : 'strum-trigger', ...(editable ? {
          'data-position': event.id, tabindex: 0, role: 'button',
          'aria-label': `${event.strum.direction === 'down' ? '下扫' : '上扫'}，${event.chordPending?'按弦待确认':automatic?(accentBars ? `自动拍点力度${['','较轻','中等','较强'][accentBars]}` : '自动拍点起伏已关闭'):`手动扫弦力度${event.strum.volume}`}`
        } : {})});
        strum.append(el('rect', {x: x - 15, y: 51, width: 30, height: 28, rx: 6,
          class: 'strum-hit'}));
        strum.append(el('text', {x, y: 73, 'text-anchor': 'middle', class: 'strum-marker'},
          event.strum.direction === 'down' ? '↓' : '↑'));
        if (event.strum.volume !== undefined) {
          strum.append(el('text', {x: x + 24, y: 92, 'text-anchor': 'middle', class: 'strum-volume-marker'},
            String(event.strum.volume)));
          strum.append(el('title', {}, `本次扫弦力度 ${event.strum.volume}`));
        } else if (!event.chordPending && accentBars) {
          for (let bar = 0; bar < accentBars; bar++) {
            const height = 3 + bar * 2;
            strum.append(el('rect', {x: x + 16 + bar * 6, y: 94 - height, width: 4, height,
              rx: 1, class: 'strum-auto-bar'}));
          }
          strum.append(el('title', {}, `自动拍点起伏：${['','较轻','中等','较强'][accentBars]}；短条只表示这一层的相对强弱`));
        }
        svg.append(strum);
      }
      if(editable&&index===measure.events.length-1){
        const add=el('g',{class:'append-position', 'data-direct-action':'append-position','data-measure-id':measure.id,tabindex:0,role:'button','aria-label':`在第${index+1}个演奏位置后添加位置`});
        add.append(el('rect',{x:x+25,y:1,width:26,height:25,rx:6,class:'append-position-hit'}));
        add.append(el('text',{x:x+38,y:19,'text-anchor':'middle',class:'append-position-label'},'＋'));
        svg.append(add);
      }
      for (let string = 1; string <= 6; string++) {
        const y = top + (string - 1) * gap;
        const note = event.notes.find(n => n.string === string);
        const multiSelected=!!note&&selected?.kind==='multi'&&selected.noteIds.includes(note.id);
        const isCellSelected=selected?.kind==='multi'?multiSelected:selected?.kind!=='position'&&selected?.kind!=='rhythm'&&selected?.eventId===event.id&&selected.string===string;
        const cell = el('g', {class: `tab-cell${note ? ` has-note dynamic-${dynamicLevel(event, note, defaultDynamics)}` : ''}${note&&(note.id===selected?.noteId||multiSelected) ? ' selected-note' : ''}${isCellSelected?' selected-cell':''}`,
          'data-event': event.id, 'data-note': note?.id ?? '', 'data-string': string, 'data-x': x,
          'data-span': (eventXs[index+1] ?? x+(compact?44:49))-x,
          tabindex: 0, role: 'button', 'aria-label': `${index + 1}位置，第${string}弦${note ? `，${note.fret ?? '未知'}品，${{soft: '轻', normal: '中', strong: '重'}[dynamicLevel(event, note, defaultDynamics)]}力度` : '，添加音符'}`});
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
    const rhythms=el('g',{transform:`translate(0 ${rhythmOffset})`});
    drawRhythms(rhythms,measure,score.timeSignature,index=>eventXs[index],el,editable);
    svg.append(rhythms);
    if(selected?.kind==='rhythm')svg.querySelector(`[data-rhythm="${CSS.escape(selected.eventId)}"]`)?.classList.add('selected-rhythm');
    svg.append(el('line', {x1: 0, x2: 0, y1: compact?Math.min(69,top-3):69, y2: svgHeight-6, class: 'playhead', visibility: 'hidden'}));
    wrap.append(svg);
    card.append(wrap);
    if(editable&&selected?.kind==='position'&&measure.events.some(e=>e.id===selected.eventId)){
      const actions=document.createElement('div');actions.className='position-actions';
      const label=document.createElement('span');label.textContent=`位置 ${measure.events.findIndex(e=>e.id===selected.eventId)+1}`;actions.append(label);
      const current=measure.events.find(e=>e.id===selected.eventId);
      if(current.notes.length>=2){
        for(const [direction,text] of [['down','↓ 下扫'],['up','↑ 上扫'],['','同时弹']]){
          const button=document.createElement('button');button.textContent=text;
          button.dataset.strumAction=direction;button.dataset.eventId=current.id;
          button.classList.toggle('active', (current.strum?.direction??'')===direction);
          actions.append(button);
        }
      }
      for(const [action,text] of [['position-before','＋ 前'],['delete-position','× 删除位置'],['position-after','＋ 后']]){
        const button=document.createElement('button');button.textContent=text;button.dataset.directAction=action;button.dataset.eventId=selected.eventId;actions.append(button);
      }head.append(actions);
    }
    container.append(card);
    wrap.scrollLeft=scrollPositions.get(measure.id)??0;
    if(editable)boundary(measure,'after');
  }
  // Rebuilding children temporarily collapses the scrollable content to zero.
  // Restore vertical position only after all measures are back in the DOM.
  container.scrollTop=scrollTop;
}

export function updatePlayhead(container, eventId, progress = 0, follow = false, graceNoteId = null, soundingStrings = null) {
  let first = null;
  for (const cell of container.querySelectorAll('[data-event]')) {
    const active = cell.dataset.event === eventId;
    cell.classList.toggle('playing-note', active && !graceNoteId &&
      (soundingStrings === null || (cell.dataset.note && soundingStrings.includes(Number(cell.dataset.string)))));
    if (active && !first) first = cell;
  }
  for (const marker of container.querySelectorAll('[data-grace]'))
    marker.classList.toggle('playing-grace', marker.dataset.grace === graceNoteId);
  for (const line of container.querySelectorAll('.playhead')) line.setAttribute('visibility', 'hidden');
  if (!first) return;
  const svg = first.closest('svg'), line = svg.querySelector('.playhead');
  const x = Number(first.dataset.x) - 20 + Math.min(1, Math.max(0, progress)) * Number(first.dataset.span);
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

function appendSourceHighlights(svg, page, event, selected) {
  for (const note of event?.notes ?? []) {
    if (note.source?.pageId !== page.id || !note.source.box) continue;
    const [a, b, c, d] = note.source.box;
    svg.append(el('rect', {x: a - 2, y: b - 2, width: c - a + 4, height: d - b + 4,
      class: note.id === selected?.noteId ? 'source-focus' : 'source-chord', rx: 3}));
  }
}

export function renderSource(svg, score, selected, wholePage = false) {
  svg.replaceChildren();
  delete svg.dataset.pageId;
  delete svg.dataset.rowKey;
  const measure = score.measures.find(m => m.id===selected?.measureId || m.events.some(e => e.id === selected?.eventId));
  const event = measure?.events.find(e => e.id === selected?.eventId);
  const pageId = measure?.source?.pageId ?? event?.notes.find(n => n.source)?.source.pageId ?? measure?.events.flatMap(e=>e.notes).find(n=>n.source)?.source.pageId;
  if(measure?.authored && !pageId)return false;
  const page = pageId ? score.sources.find(p => p.id === pageId) : measure ? null : score.sources[0];
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
  appendSourceHighlights(svg,page,event,selected);
  return true;
}

export function renderSourceRow(svg, score, row, selected=null) {
  const page=score.sources.find(source=>source.id===row?.pageId);
  if(!page || !(page.dataUrl || page.url)){
    svg.replaceChildren();delete svg.dataset.pageId;delete svg.dataset.rowKey;
    return false;
  }
  const sameRow=svg.dataset.rowKey===row.key&&svg.dataset.pageId===page.id;
  if(sameRow)svg.querySelectorAll('.source-focus,.source-chord').forEach(element=>element.remove());
  else svg.replaceChildren();
  const [x1,y1,x2,y2]=row.box;
  const padding=14;
  const left=Math.max(0,x1-padding),top=Math.max(0,y1-padding);
  svg.setAttribute('viewBox',`${left} ${top} ${Math.min(page.width,x2+padding)-left} ${Math.min(page.height,y2+padding)-top}`);
  svg.dataset.pageId=page.id;
  svg.dataset.rowKey=row.key;
  if(!sameRow)svg.append(el('image',{href:page.dataUrl||page.url,x:0,y:0,width:page.width,height:page.height}));
  if(selected){
    const event=score.measures.flatMap(measure=>measure.events).find(item=>item.id===selected.eventId);
    appendSourceHighlights(svg,page,event,selected);
  }
  return true;
}
