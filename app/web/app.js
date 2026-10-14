import {clone, validate, importScore, locate, setNote, removeNote, addPosition, removePosition, portable, eventRange, setEventDynamics, mergePosition, splitPosition, timingWarning, acceptRecognition, appendRecognition, newScore, insertMeasure, removeMeasure} from './core.js';
import {setupWorkspace,selectEditorTab,syncEditorEffects} from './workspace.js';
import {setupLayout} from './layout.js';
import {setupSettings} from './settings.js';
import {getNewScoreDefaults,getPracticeDefaults,getSourceFollowMode,getSourcePreviewSettings} from './preferences.js';
import {setupDirectEditing} from './direct.js';
import {setupMultiSelection,editNotes} from './selection.js';
import {setupMeasureOrder} from './measure-board.js';
import {storeDraft,getDraft,listDrafts,removeDraft,updateDraftRecord,rememberSaved,forgetSaved,isSaved,draftKey} from './drafts.js';
import {recognitionDialog} from './recognition.js';
import {renderTab, renderSource, renderSourceRow, updatePlayhead} from './tab.js';
import {createSourceViewport} from './source-viewport.js';
import {collectReview,reviewSnapshot} from './review.js';
import {Player, timeline, pitches, pluck, suggestedStrumSpread, suggestedStrumDynamic, effectiveDynamicLevel} from './playback.js';
import {createGuitarInstrument} from './guitar.js';
import {dynamicCategory} from './core.js';
import {setupVolume} from './volume.js';
import {previousOnString, setNoteTechnique, pruneTechniques} from './techniques.js';
import {setGraceBefore, setBend, pruneOrnaments} from './ornaments.js';
import {CHORD_PRESETS, applyChordPreset, copyChordToNext} from './chords.js';
import {showChordDiagram, closeChordDiagram} from './chord-diagram.js';

const $ = selector => document.querySelector(selector);
setupWorkspace();
const layout=setupLayout();
const SOURCE_VIEW_KEY='tablens.sourceView.v1';
let savedSourceView={};
try{savedSourceView=JSON.parse(localStorage.getItem(SOURCE_VIEW_KEY))??{};}catch{}
const sourceView={
  zoom:Number.isFinite(savedSourceView.zoom)?Math.max(0.5,Math.min(4,savedSourceView.zoom)):1,
  rowZoom:Number.isFinite(savedSourceView.rowZoom)?Math.max(0.5,Math.min(4,savedSourceView.rowZoom)):1
};
const saveSourceView=()=>{try{localStorage.setItem(SOURCE_VIEW_KEY,JSON.stringify({zoom:sourceView.zoom,rowZoom:sourceView.rowZoom}));}catch{}};
const sourceViewport=createSourceViewport($('#source-view'),{
  onZoom:value=>{sourceView.zoom=value;$('#source-zoom-level').textContent=`${Math.round(value*100)}%`;saveSourceView();}
});
const rowViewport=createSourceViewport($('#source-next-view'),{
  onZoom:value=>{sourceView.rowZoom=value;$('#source-row-zoom-level').textContent=`${Math.round(value*100)}%`;saveSourceView();}
});
sourceViewport.setZoom(sourceView.zoom);
rowViewport.setZoom(sourceView.rowZoom);
for (const name of Object.keys(CHORD_PRESETS)) {
  const option = document.createElement('option'); option.value = name; option.textContent = name;
  $('#chord-preset').append(option);
}
const CACHE = 'tablens.workspace.v1';
const ACTIVE_DRAFT = 'tablens.activeDraft.v1';
const OPEN_TABS = 'tablens.openTabs.v1';
const sessions = new Map();
let sessionOrder = [], activeSessionId = null;
let draftGeneration = 0;
const pendingDraftWrites = new Map();
const SAMPLE_CACHE = 'tablens.sample.';
const SAMPLE_DRAFT_CACHE = 'tablens.sampleDraft.';
let score, selected, wholePage = false, undo = [], redo = [], noticeTimer;
let playingEvent = null, playbackView = null;
let rowKey=null,nextRowKey=null,rowDirty=true;
let reviewNavigation=[],reviewCursorKey=null;
let practiceScoreId = null;
let practiceMeasures = '', saving = false;
const clockLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const player = new Player(view => {
  playbackView = view;
  $('#play-status').classList.remove('is-quiet');
  $('#play').textContent = view.state === 'playing' ? 'Ⅱ 暂停' : view.state === 'paused' ? '▶ 继续' : '▶ 播放';
  $('#play-time').textContent = `${clockLabel(view.time)} / ${clockLabel(view.total)}`;
  updatePlayhead($('#tab-view'), view.event?.id, view.progress, view.state === 'playing' && playingEvent !== view.event?.id, view.graceNoteId, view.soundingStrings);
  if (view.event) {
    $('#play-status').textContent = `${view.state === 'paused' ? '已暂停' : '正在播放'} · 第 ${view.event.measure} 小节 · 第 ${view.event.index} 个位置${view.cycle ? ` · 第${view.cycle}遍` : ''}`;
    if (playingEvent !== view.event.id) displaySource({eventId: view.event.id, noteId: null});
  } else if (view.countIn) {
    $('#play-status').textContent = `${view.state === 'paused' ? '已暂停 · ' : ''}准备，倒数 ${view.countIn} 拍…`;
  } else if (view.tail) {
    $('#play-status').textContent = view.state === 'paused' ? '已暂停 · 尾音' : '演奏结束，尾音自然衰减中…';
  } else if (score) {
    readiness();
    displaySource(selected);
  }
  playingEvent = view.event?.id ?? null;
});
const guitar = createGuitarInstrument(message => { $('#sound-status').textContent = message; });
player.instrument = guitar;
const renderVolume=setupVolume({player,getScore:()=>score,getSelection:()=>selected,commit});
$('#instrument').addEventListener('change', event => {
  player.stop();
  player.instrument = event.target.value === 'guitar' ? guitar : pluck;
  $('#sound-status').textContent = event.target.value === 'guitar' ? '首次播放会加载所需音符' : '基础合成拨弦';
});

function readiness() {
  const from = Number($('#range-from').value || 0), to = Number($('#range-to').value || score.measures.length - 1);
  const events = score.measures.slice(from, to + 1).flatMap(m => m.events);
  const missing = events.filter(e => e.duration === null).length;
  const unknown = events.filter(e => e.notes.some(n => n.fret === null) || (!e.notes.length && e.kind !== 'rest')).length;
  $('#play-status').classList.toggle('is-quiet',!!events.length&&!missing&&!unknown);
  $('#play-status').textContent = !events.length ? '空小节：点击左侧弦线添加演奏位置，再填写品位。' : missing || unknown ? `${missing} 处节奏待设 · ${unknown} 处音符待确认。点击播放可定位首个问题。` : '已可播放 · 同一列可同时弹，也可设置扫弦。';
}

function resetPracticeRange() {
  practiceScoreId = score.id;
  practiceMeasures=score.measures.map(m=>m.id).join('|');
  for (const id of ['#range-from', '#range-to']) {
    $(id).replaceChildren(...score.measures.map((measure, index) => {
      const option = document.createElement('option'); option.value = index;
      option.textContent = `第 ${measure.number} 小节`; return option;
    }));
  }
  $('#range-from').value = '0'; $('#range-to').value = String(score.measures.length - 1);
}

function applyPracticeDefaults(value=getPracticeDefaults(),resetLoop=true) {
  $('#speed').value=value.speed;
  $('#count-in').checked=value.countIn;
  $('#metronome').checked=value.metronome;
  if(resetLoop)$('#loop').checked=false;
  if(player.state!=='stopped')player.stop();
  if(score)readiness();
}

function updateNewScoreSummary() {
  const defaults=getNewScoreDefaults();
  $('#new-score-summary').textContent=`初始设置：${defaults.timeSignature.join('/')} 拍、${defaults.tempo} BPM、标准调弦、变调夹 ${defaults.capo} 品、${defaults.sustain==='natural'?'自然延音':'按时值止音'}。可在右上角「设置 → 新建乐谱」修改默认值。`;
}

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}

function stash() {
  score.modifiedAt??=new Date().toISOString();
  const generation=++draftGeneration,identifier=score.id;
  const snapshot=JSON.stringify(score),large=snapshot.length>2_000_000;
  try {
    if(large)localStorage.removeItem(CACHE);
    else localStorage.setItem(CACHE,snapshot);
    if(score.originSample){
      if(large){localStorage.removeItem(SAMPLE_CACHE+score.originSample);
        localStorage.setItem(SAMPLE_DRAFT_CACHE+score.originSample,identifier);}
      else{localStorage.setItem(SAMPLE_CACHE+score.originSample,snapshot);
        localStorage.removeItem(SAMPLE_DRAFT_CACHE+score.originSample);}
    }
    localStorage.setItem(ACTIVE_DRAFT,identifier);
  }catch{try{localStorage.removeItem(CACHE);}catch{}}
  const dirty=!isSaved(score);
  $('#save-status').textContent=dirty?'● 正在本机暂存…':'✓ 已保存到乐谱库';
  captureActiveSession();
  const active=sessions.get(activeSessionId);if(active)active.dirty=dirty;
  renderTabs();
  const write=storeDraft(score);
  const writes=pendingDraftWrites.get(identifier)??new Set();
  writes.add(write);pendingDraftWrites.set(identifier,writes);
  write.then(()=>{
    if(generation===draftGeneration&&!isSaved(score))$('#save-status').textContent='● 有未保存修改 · 已在本机暂存';
  },()=>{
    if(generation===draftGeneration){
      try{if(localStorage.getItem(ACTIVE_DRAFT)===identifier)localStorage.removeItem(ACTIVE_DRAFT);}catch{}
      $('#save-status').textContent='暂存失败，请立即保存到乐谱库';
    }
  }).finally(()=>{writes.delete(write);if(!writes.size)pendingDraftWrites.delete(identifier);});
  return write;
}

function clearDraftCaches(identifier) {
  try {
    if(localStorage.getItem(ACTIVE_DRAFT)===identifier)localStorage.removeItem(ACTIVE_DRAFT);
    try{if(JSON.parse(localStorage.getItem(CACHE))?.id===identifier)localStorage.removeItem(CACHE);}catch{}
    for(const key of Object.keys(localStorage)) {
      if(key.startsWith(SAMPLE_DRAFT_CACHE)&&localStorage.getItem(key)===identifier)localStorage.removeItem(key);
      if(key.startsWith(SAMPLE_CACHE)) {
        try{if(JSON.parse(localStorage.getItem(key))?.id===identifier)localStorage.removeItem(key);}catch{}
      }
    }
  }catch{}
}

function persistSessions() {
  try{localStorage.setItem(OPEN_TABS,JSON.stringify({ids:sessionOrder,active:activeSessionId}));}catch{}
}

function captureActiveSession() {
  if(!activeSessionId||!score)return;
  const session=sessions.get(activeSessionId);
  if(!session)return;
  if(score.id!==activeSessionId){
    if(sessions.has(score.id))throw new Error('这份乐谱已在另一标签打开');
    sessions.delete(activeSessionId);sessions.set(score.id,session);
    sessionOrder=sessionOrder.map(id=>id===activeSessionId?score.id:id);
    activeSessionId=score.id;persistSessions();
  }
  session.score=score;session.selected=selected;session.wholePage=wholePage;
  session.undo=undo;session.redo=redo;session.reviewCursorKey=reviewCursorKey;
  session.rowKey=rowKey;session.nextRowKey=nextRowKey;
  session.scrollTop=$('#tab-view').scrollTop;
  session.editorTab=document.querySelector('[data-editor-tab][aria-selected="true"]')?.dataset.editorTab??'note';
  session.practice={from:$('#range-from').value,to:$('#range-to').value,
    loop:$('#loop').checked,countIn:$('#count-in').checked,metronome:$('#metronome').checked,speed:$('#speed').value};
}

function renderTabs() {
  if(activeSessionId)captureActiveSession();
  const tabs=$('#open-tabs'),openList=$('#files-open-list');
  tabs.replaceChildren();openList.replaceChildren();
  for(const id of sessionOrder){
    const session=sessions.get(id);if(!session)continue;
    const dirty=session.dirty,title=session.score.title||'未命名乐谱';
    const tab=document.createElement('div');tab.className=`document-tab${id===activeSessionId?' active':''}${dirty?' dirty':''}`;
    tab.dataset.tabId=id;
    const main=document.createElement('button');main.type='button';main.className='document-tab-main';
    main.textContent=title;main.title=`${title} · ${dirty?'有未保存修改':'已保存到乐谱库'}`;
    main.setAttribute('role','tab');main.setAttribute('aria-selected',String(id===activeSessionId));
    main.addEventListener('click',()=>activateSession(id));
    const dot=document.createElement('span');dot.className='document-dirty';dot.title='有未保存修改';
    const close=document.createElement('button');close.type='button';close.className='document-tab-close';
    close.textContent='×';close.title=`关闭《${title}》`;close.setAttribute('aria-label',`关闭《${title}》`);
    close.addEventListener('click',()=>closeSession(id));
    tab.append(main,dot,close);tabs.append(tab);
    const entry=document.createElement('button');entry.type='button';entry.className=`file-entry${id===activeSessionId?' active':''}`;
    entry.textContent=`${dirty?'● ':'✓ '}${title}`;entry.title=dirty?'有未保存修改':'已保存到乐谱库';
    entry.addEventListener('click',()=>activateSession(id));openList.append(entry);
  }
  filterFileSidebar();
}

function activateSession(id) {
  if(id===activeSessionId)return true;
  const session=sessions.get(id);if(!session)return false;
  if(score&&!directEditing.confirm()){notify('请先完成或取消正在编辑的品位');return false;}
  captureActiveSession();player.stop();
  activeSessionId=id;score=session.score;selected=session.selected;wholePage=session.wholePage;
  undo=session.undo;redo=session.redo;reviewCursorKey=session.reviewCursorKey;
  rowKey=session.rowKey;nextRowKey=session.nextRowKey;rowDirty=true;
  playbackView=null;playingEvent=null;
  resetPracticeRange();
  const practice=session.practice;
  if(practice){
    $('#range-from').value=practice.from;$('#range-to').value=practice.to;
    $('#loop').checked=practice.loop;$('#count-in').checked=practice.countIn;
    $('#metronome').checked=practice.metronome;$('#speed').value=practice.speed;
  }else applyPracticeDefaults();
  $('#sample-picker').value=score.originSample??'';
  selectEditorTab(session.editorTab??'note');
  $('#save-status').textContent=session.dirty?'● 有未保存修改 · 已在本机暂存':'✓ 已保存到乐谱库';
  persistSessions();render();
  $('#tab-view').scrollTop=session.scrollTop??0;
  return true;
}

function filterFileSidebar() {
  const query=$('#files-query').value.trim().toLocaleLowerCase();
  for(const entry of $('#files-sidebar').querySelectorAll('.file-entry'))
    entry.hidden=!entry.textContent.toLocaleLowerCase().includes(query);
}
function setFileSidebarOpen(open,pane='files') {
  const sidebar=$('#files-sidebar');
  sidebar.hidden=!open;
  sidebar.dataset.pane=pane;
  $('#sidebar-title').textContent=pane==='measures'?'小节':'文件';
  $('#sidebar-files-content').hidden=pane!=='files';
  $('#sidebar-measures-content').hidden=pane!=='measures';
  if(!open||pane!=='measures')$('#sidebar-measure-list').replaceChildren();
  $('#sidebar-files-tab').setAttribute('aria-selected',String(pane==='files'));
  $('#sidebar-measures-tab').setAttribute('aria-selected',String(pane==='measures'));
  $('main').classList.toggle('files-open',open);
  $('#files-toggle').setAttribute('aria-expanded',String(open&&pane==='files'));
  $('#measures-toggle').setAttribute('aria-expanded',String(open&&pane==='measures'));
  $('#files-toggle').setAttribute('aria-label',open&&pane==='files'?'收起文件栏':'显示文件栏');
  $('#measures-toggle').setAttribute('aria-label',open&&pane==='measures'?'收起小节栏':'显示小节栏');
  if(open&&pane==='files')refreshFileSidebar();
  refreshMeasureOverview();
}

function closeTabChoice(session) {
  const dialog=$('#close-tab-dialog');
  $('#close-tab-title').textContent=`关闭《${session.score.title||'未命名乐谱'}》`;
  $('#close-tab-message').textContent='这份乐谱有未保存的修改。请选择如何处理：';
  $('#close-tab-error').textContent='';
  dialog.showModal();
  return new Promise(resolve=>{
    const finish=choice=>{dialog.removeEventListener('click',onClick);dialog.removeEventListener('cancel',onCancel);
      dialog.close();resolve(choice);};
    const onClick=event=>{const choice=event.target.closest('[data-close-choice]')?.dataset.closeChoice;
      if(choice)finish(choice);};
    const onCancel=event=>{event.preventDefault();finish('cancel');};
    dialog.addEventListener('click',onClick);dialog.addEventListener('cancel',onCancel);
  });
}

async function closeSession(id) {
  if(id===activeSessionId && !directEditing.confirm()){notify('请先完成或取消正在编辑的品位');return;}
  if(id===activeSessionId)captureActiveSession();
  const session=sessions.get(id);if(!session)return;
  try{
    if(!isSaved(session.score)){
      const choice=await closeTabChoice(session);
      if(choice==='cancel')return;
      if(choice==='save')await save(session.score);
      else if(choice==='draft'){
        await Promise.all([...(pendingDraftWrites.get(id)??[])]);
        await storeDraft(session.score);
      }else if(choice==='discard'){
        await Promise.allSettled([...(pendingDraftWrites.get(id)??[])]);
        await removeDraft(id);clearDraftCaches(id);
      }
    }
    removeSessionFromWorkspace(id);
    if(!$('#files-sidebar').hidden)refreshFileSidebar();
  }catch(error){notify(`关闭失败：${error.message}`);}
}

function removeSessionFromWorkspace(id) {
  const index=sessionOrder.indexOf(id);if(index<0)return;
  const wasActive=id===activeSessionId;
  sessions.delete(id);sessionOrder.splice(index,1);
  if(wasActive){
    player.stop();activeSessionId=null;score=null;
    const next=sessionOrder[Math.min(index,sessionOrder.length-1)];
    if(next)activateSession(next);
    else replace(newScore('未命名乐谱',getNewScoreDefaults()));
  }else renderTabs();
  persistSessions();
}

function choose(eventId, noteId, string = 1, extend = false,kind='note') {
  const anchor = extend ? (selected?.rangeAnchor ?? selected?.eventId ?? eventId) : eventId;
  selected = {eventId, noteId: noteId || null, string, rangeAnchor: anchor,kind};
  if(kind==='position'||kind==='rhythm')selectEditorTab('rhythm');
  $('#edit-error').textContent = '';
  render();
}

function currentMeasure() {
  return (selected?.eventId && locate(score,selected.eventId)?.measure) ?? score.measures.find(m=>m.id===selected?.measureId) ?? score.measures[0];
}
function chooseMeasure(measure) {
  selected=measure?{kind:'measure',measureId:measure.id,eventId:null,noteId:null,string:1}:null;
}

function revealKeyboardSelection() {
  const view=$('#tab-view');
  const card=view.querySelector(selected?.kind==='measure'?'.measure-card.selected-measure':'.measure-card.active-measure');
  if(!card)return;
  const target=selected.kind==='measure'?card:
    card.querySelector(selected.kind==='note'?'.tab-cell.selected-cell':'.position-selector.active')??card;
  const viewport=view.getBoundingClientRect(),rect=target.getBoundingClientRect();
  if(selected.kind==='measure'){
    if(rect.top<viewport.top+8||rect.top>viewport.bottom-30)view.scrollTop+=rect.top-viewport.top-12;
  }else if(rect.top<viewport.top+8)view.scrollTop+=rect.top-viewport.top-12;
  else if(rect.bottom>viewport.bottom-8)view.scrollTop+=rect.bottom-viewport.bottom+12;
  const strip=target.closest('.tab-scroll');
  if(strip){
    const stripRect=strip.getBoundingClientRect(),cellRect=target.getBoundingClientRect();
    if(cellRect.left<stripRect.left+12)strip.scrollLeft+=cellRect.left-stripRect.left-20;
    else if(cellRect.right>stripRect.right-12)strip.scrollLeft+=cellRect.right-stripRect.right+20;
  }
}

function moveScoreSelection(direction) {
  if(!selected||selected.kind==='multi')return false;
  if(selected.kind==='measure'){
    const index=score.measures.findIndex(measure=>measure.id===selected.measureId);
    if(index<0)return false;
    const next=score.measures[index+direction];
    if(next){chooseMeasure(next);selectEditorTab('measure');render();}
  }else if(selected.eventId){
    const positions=score.measures.flatMap(measure=>measure.events);
    const index=positions.findIndex(position=>position.id===selected.eventId);
    if(index<0)return false;
    const next=positions[index+direction];
    if(next){
      if(selected.kind==='note'){
        const note=next.notes.find(item=>item.string===selected.string);
        choose(next.id,note?.id??null,selected.string,false,'note');
      }else choose(next.id,null,1,false,'position');
    }
  }else return false;
  $('#tab-view').focus({preventScroll:true});
  revealKeyboardSelection();
  return true;
}

function displaySource(selection=selected) {
  const measure=score.measures.find(m=>m.id===selection?.measureId||m.events.some(e=>e.id===selection?.eventId));
  const practice=document.body.dataset.layout==='practice';
  const row=practice&&getSourceFollowMode()==='row'?
    sourceRows().find(item=>item.measureIds.includes(measure?.id)):null;
  const hasImage=sourceViewport.show(()=>row?
    renderSourceRow($('#source-view'),score,row,selection):
    renderSource($('#source-view'),score,selection,practice?false:wholePage),{
    measureKey:row?`row:${row.key}`:measure?`measure:${score.id}:${measure.id}`:null
  });
  $('#source-follow-label').textContent=row?`第 ${row.start}${row.end===row.start?'':`–${row.end}`} 小节 · 当前谱行`:'当前小节';
  $('#source-view').dataset.measureId=hasImage?measure?.id??'':'';
  document.body.dataset.practiceSource=hasImage?'available':'missing';
  $('.side-column').classList.toggle('without-source',!score.sources.length);$('.source-panel').hidden=!score.sources.length;
  $('#source-enlarge').disabled=!hasImage;$('#source-toggle').disabled=!hasImage;
  $('#source-view').hidden=!hasImage;$('#source-empty').hidden=hasImage;
  const preview=getSourcePreviewSettings();
  document.body.dataset.sourcePreviewLayout=preview.layout;
  if(practice&&hasImage&&preview.visible)displaySourceRow(measure,row?'row':'measure');
  else $('#source-next').hidden=true;
  document.body.dataset.sourcePreviewVisible=String(!$('#source-next').hidden);
  $('#source-description').textContent=measure?.copiedFrom?'复制小节 · 原图仅作来源参考。':measure?.manualReference?'手动关联原图 · 仅供对照。':measure?.agentImported&&measure?.source?.box?'当前小节原图 · 未逐音定位。':selection?.noteId&&!locate(score,selection.eventId,selection.noteId)?.note?.source?'手动新增的音 · 没有原图定位。':'选中音符，核对原来的位置。';
  const page=score.sources.find(source=>source.id===measure?.source?.pageId);
  const box=measure?.source?.box;
  const measureCrop=page&&box&&!(box[0]===0&&box[1]===0&&box[2]===page.width&&box[3]===page.height);
  $('#source-toggle').textContent=wholePage?(measureCrop?'小节':'谱行'):'整页';
}

function sourceRows() {
  const rows=[];
  let previous=null,previousIndex=-2;
  score.measures.forEach((measure,index)=>{
    const source=measureSource(measure);
    if(!source?.box){previous=null;return;}
    const [x1,y1,x2,y2]=source.box;
    const row=rows.at(-1);
    const overlap=previous?Math.min(previous.box[3],y2)-Math.max(previous.box[1],y1):0;
    const sameRow=row&&previousIndex===index-1&&row.pageId===source.pageId&&
      overlap>Math.min(previous.box[3]-previous.box[1],y2-y1)*0.35&&x1>=previous.box[0]-2;
    if(sameRow){
      row.box=[Math.min(row.box[0],x1),Math.min(row.box[1],y1),Math.max(row.box[2],x2),Math.max(row.box[3],y2)];
      row.measureIds.push(measure.id);row.end=index+1;
    }else rows.push({pageId:source.pageId,box:[x1,y1,x2,y2],measureIds:[measure.id],start:index+1,end:index+1,key:`${score.id}:${measure.id}`});
    previous=source;previousIndex=index;
  });
  return rows;
}

function displaySourceRow(current,followMode=getSourceFollowMode()) {
  const rows=sourceRows();
  const currentIndex=score.measures.indexOf(current);
  const next=score.measures[currentIndex+1]??current;
  const currentRow=rows.find(item=>item.measureIds.includes(current?.id));
  const upcoming=followMode==='row'?rows[rows.indexOf(currentRow)+1]:
    rows.find(item=>item.measureIds.includes(next?.id))??currentRow??rows[0];
  if(!upcoming){
    nextRowKey=null;rowKey=null;rowDirty=true;$('#source-next').hidden=true;
    document.body.dataset.sourcePreviewVisible='false';
    return;
  }
  if(upcoming?.key!==nextRowKey){
    nextRowKey=upcoming?.key??null;
    rowKey=nextRowKey;
    rowDirty=true;
  }
  if(!rowDirty)return;
  const row=rows.find(item=>item.key===rowKey)??upcoming;
  rowKey=row?.key??null;
  const visible=rowViewport.show(()=>renderSourceRow($('#source-next-view'),score,row),{measureKey:rowKey});
  $('#source-next').hidden=!visible;
  document.body.dataset.sourcePreviewVisible=String(visible);
  if(visible){
    const index=rows.indexOf(row);
    $('#source-next-label').textContent=`原图谱行 · 第${row.start}${row.end===row.start?'':`–${row.end}`}小节`;
    $('#source-row-prev').disabled=index===0;
    $('#source-row-next').disabled=index===rows.length-1;
  }
  rowDirty=false;
}

function moveSourceRow(direction) {
  const rows=sourceRows();
  const index=rows.findIndex(row=>row.key===rowKey);
  const next=rows[index+direction];
  if(!next)return;
  rowKey=next.key;rowDirty=true;
  displaySourceRow(currentMeasure());
}

function measureSource(measure) {
  if (measure?.source?.box) return measure.source;
  const notes=measure?.events.flatMap(e=>e.notes).filter(n=>n.source?.box) ?? [];
  const pageId=notes[0]?.source.pageId;
  const page=score.sources.find(p=>p.id===pageId);
  const boxes=notes.filter(n=>n.source.pageId===pageId).map(n=>n.source.box);
  if (!page || !boxes.length) return null;
  return {pageId,box:[Math.max(0,Math.min(...boxes.map(b=>b[0]))),page.cropBox?.[1] ?? Math.max(0,Math.min(...boxes.map(b=>b[1]))-50),
    Math.min(page.width,Math.max(...boxes.map(b=>b[2]))),page.cropBox?.[3] ?? Math.min(page.height,Math.max(...boxes.map(b=>b[3]))+60)]};
}

function jumpToReview(item) {
  const measure=score.measures.find(entry=>entry.id===item.measureId);
  if(!measure)return;
  reviewCursorKey=item.key;
  if(item.eventId){
    const event=measure.events.find(entry=>entry.id===item.eventId);
    const note=event?.notes.find(entry=>entry.id===item.noteId);
    choose(item.eventId,item.noteId,note?.string??event?.notes[0]?.string??1,false,
      item.type==='duration'?'rhythm':item.noteId?'note':'position');
    if(item.noteId)selectEditorTab('note');
  }else{
    chooseMeasure(measure);selectEditorTab('measure');render();
  }
  const card=[...$('#tab-view').querySelectorAll('.measure-card')].find(entry=>entry.dataset.measure===measure.id);
  card?.scrollIntoView({block:'center',behavior:'instant'});
  const target=item.noteId?[...card?.querySelectorAll('.tab-cell[data-note]')??[]].find(cell=>cell.dataset.note===item.noteId):
    item.eventId?[...card?.querySelectorAll('.position-selector[data-position]')??[]].find(position=>position.dataset.position===item.eventId):null;
  target?.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});
}

function renderReview() {
  const review=collectReview(score),panel=$('.review-panel'),list=$('#review-issues');
  const priorScroll=panel.scrollTop,showAll=$('#review-show-all').checked;
  $('#review-summary').textContent=`${review.issueCount} 项提示 · ${review.pendingCount} 节未核对`;
  $('#review-progress').textContent=`已核对 ${review.reviewedCount} 节`;
  list.replaceChildren();reviewNavigation=[];
  for(const message of review.globals){
    const note=document.createElement('p');note.textContent=`全谱提示：${message}`;list.append(note);
  }
  for(const group of review.groups){
    if(!showAll&&group.state==='reviewed'&&!group.items.length)continue;
    const section=document.createElement('section');section.className='review-measure';
    const heading=document.createElement('div');heading.className='review-measure-head';
    const title=document.createElement('strong');title.textContent=`第 ${group.number} 小节`;
    const status=document.createElement('span');status.className='review-state';
    status.textContent=group.state==='reviewed'?'已核对':group.state==='changed'?'修改后待复核':group.state?'未核对':'待处理';
    heading.append(title,status);
    if(group.state){
      const confirm=document.createElement('button');confirm.type='button';confirm.className='review-confirm small';
      confirm.textContent=group.state==='reviewed'?'撤销核对':'标记已核对';
      confirm.disabled=group.state!=='reviewed'&&!group.canConfirm;
      if(confirm.disabled)confirm.title='请先解决未知音符、未知节奏或拍数不符';
      confirm.addEventListener('click',()=>commit(()=>{
        const measure=score.measures.find(entry=>entry.id===group.measureId);
        if(group.state==='reviewed')delete measure.reviewedSnapshot;
        else measure.reviewedSnapshot=reviewSnapshot(measure);
      }));
      heading.append(confirm);
    }
    section.append(heading);
    const addItem=item=>{
      const entry={...item,measureId:group.measureId,
        key:`${group.measureId}:${item.type}:${item.eventId??''}:${item.noteId??''}:${item.message}`};
      const button=document.createElement('button');button.type='button';button.className='review-issue';
      button.textContent=entry.message;
      button.addEventListener('click',()=>jumpToReview(entry));
      section.append(button);reviewNavigation.push(entry);
    };
    for(const item of group.items)addItem(item);
    if(group.state&&group.state!=='reviewed')addItem({type:'confirm',eventId:null,noteId:null,
      message:'对照原图核对弦、品、顺序、同时弹组合和节奏'});
    list.append(section);
  }
  if(!list.childNodes.length){const empty=document.createElement('p');empty.className='review-empty';
    empty.textContent='暂无待处理的校对事项。';list.append(empty);}
  $('#review-next').disabled=!reviewNavigation.length;
  panel.scrollTop=priorScroll;
}

function render() {
  closeChordDiagram();
  if (!score) return;
  renderTabs();
  rowDirty=true;
  if (practiceScoreId !== score.id || practiceMeasures!==score.measures.map(m=>m.id).join('|')) resetPracticeRange();
  $('#score-title').value = score.title;
  $('#score-title').title = score.title;
  const events = score.measures.flatMap(m => m.events);
  const count = events.reduce((n, e) => n + e.notes.length, 0);
  const standard = JSON.stringify(score.tuningMidi) === '[64,59,55,50,45,40]';
  $('#score-info').textContent = `${score.measures.length} 个小节 · ${standard ? '标准调弦' : '自定义调弦'}${score.capo !== null ? ` · 变调夹 ${score.capo} 品` : ' · 变调夹待确认'}`;
  $('#score-count').textContent = `${count} 个音符 · ${events.length} 个演奏位置`;
  $('#undo').disabled = !undo.length;
  $('#redo').disabled = !redo.length;
  const range = selected?.kind==='multi'?selected.eventIds.map(id=>locate(score,id)?.event).filter(Boolean):selected ? eventRange(score, selected.rangeAnchor ?? selected.eventId, selected.eventId) : [];
  renderTab($('#tab-view'), score, selected, new Set(range.map(event => event.id)),{editable:true});
  refreshMeasureOverview();
  const multiple=selected?.kind==='multi';$('#selection-tools').hidden=!multiple;
  if(multiple){$('#selection-count').textContent=`已选 ${selected.noteIds.length} 个音符 · ${selected.eventIds.length} 个位置`;$('#selection-scope').textContent=`时值影响整列；音符力度和删除只影响所选音，扫弦力度影响所选位置里的扫弦`;
    $('#selection-delete').disabled=!selected.noteIds.length;for(const button of document.querySelectorAll('[data-selection-dynamics]'))button.disabled=!selected.noteIds.length;}
  $('#range-status').textContent = `已选 ${range.length} 个位置 · Shift+点击可连续选段`;
  if (playbackView?.event) updatePlayhead($('#tab-view'), playbackView.event.id, playbackView.progress, false, playbackView.graceNoteId, playbackView.soundingStrings);
  $('#tempo').value = score.tempo ?? 80;
  $('#capo').value = score.capo ?? 0;
  $('#time-signature').value = score.timeSignature?.join('/') ?? '';
  renderReview();
  $('#sustain').value = score.sustain ?? 'natural';
  $('#preview').disabled = !selected?.eventId||multiple;
  $('#play-selected').disabled=!selected?.eventId;
  if (player.state === 'stopped') readiness();
  displaySource();
  const measure=currentMeasure();
  for(const id of ['measure-before','measure-after','measure-copy','measure-delete'])$('#'+id).disabled=!measure;
  const found = selected ? locate(score, selected.eventId, selected.noteId) : null;
  renderVolume();
  const controls = ['#edit-string', '#edit-fret', '#apply-note', '#edit-duration', '#event-sustain', '#event-dynamics', '#note-dynamics', '#unify-dynamics', '#add-note', '#delete-note', '#note-technique', '#slide-ratio', '#grace-string', '#grace-fret', '#grace-articulation', '#grace-lead', '#apply-grace', '#remove-grace', '#bend-semitones', '#bend-reach', '#bend-release', '#add-position', '#add-position-before', '#delete-position', '#set-rest', '#merge-position', '#split-position', '#retry-measure', '#incomplete-measure', '#chord-preset', '#apply-chord', '#copy-chord', '#chord-label', '#strum-direction', '#strum-speed', '#strum-volume', '#strum-volume-auto'];
  for (const key of controls) $(key).disabled = !found;
  $('#chord-list').replaceChildren();
  $('#chord-label').value = '';
  $('#strum-direction').value = '';
  $('#strum-speed').value = '0.08';
  $('#strum-volume').value = '70';
  $('#strum-volume-value').textContent = '自动';
  $('#strum-speed option[value="auto"]').textContent = '自动（按节奏）';
  $('#note-technique').value = '';
  $('#slide-controls').hidden = true;
  $('#technique-origin').textContent = '选中音符后设置技巧。';
  $('#grace-info').textContent = '先选中主音。';
  $('#bend-info').textContent = '先选中非空弦音符。';
  for (const button of document.querySelectorAll('[data-slide-ratio]')) button.disabled = true;
  if(multiple){for(const key of controls)$(key).disabled=true;$('#editor-title').textContent='批量选择';$('#editor-position').textContent='使用谱面上方的工具修改时值、力度或删除';$('#editor-badge').textContent=`${selected.noteIds.length} 个音`;syncEditorEffects(null,null);return;}
  if (!found) {
    $('#editor-title').textContent = measure ? '编辑小节' : '选一个音符';
    $('#editor-badge').textContent='小节';$('#edit-duration').value='';
    $('#editor-position').textContent = measure ? `第 ${measure.number} 小节 · ${measure.events.length?`${measure.events.length} 个演奏位置`:'点击弦线添加第一个位置'}` : '点击左侧数字或空白弦线开始编辑。';
    $('#add-position').disabled=!measure;$('#add-position-before').disabled=!measure;
    $('#retry-measure').disabled=!measureSource(measure);
    $('#incomplete-measure').disabled=!measure;$('#incomplete-measure').checked=!!measure?.allowIncomplete;
    $('#edit-fret').value = '';
    syncEditorEffects(null,null);
    return;
  }
  const {event, note} = found;
  $('#merge-position').disabled = !event.notes.length || !measure.events[measure.events.indexOf(event) + 1]?.notes.length;
  $('#split-position').disabled = !note || event.notes.length < 2;
  $('#incomplete-measure').checked = !!measure.allowIncomplete;
  const original = measureSource(measure);
  $('#retry-measure').disabled = !original || !score.sources.some(p => p.id === original.pageId && (p.dataUrl || p.url));
  $('#set-rest').disabled = !!event.notes.length;
  $('#set-rest').textContent = event.kind === 'rest' ? '移除休止符（保留位置与时值）' : '将空位置设为休止';
  $('#editor-title').textContent = selected.kind==='rhythm'?'编辑节奏':selected.kind==='position'?'编辑演奏位置':note ? '修改音符' : '添加音符';
  $('#editor-position').textContent = `第 ${measure.number} 小节 · 第 ${measure.events.indexOf(event) + 1} 个位置${note?` · ${note.string}弦 ${note.fret ?? '?'}品`:''}`;
  $('#editor-badge').textContent = event.strum ? (event.strum.direction === 'down' ? '下扫' : '上扫') : event.notes.length > 1 ? '同时弹' : '音符';
  $('#edit-string').value = note?.string ?? selected.string;
  $('#edit-fret').value = note ? (note.fret ?? '') : 0;
  $('#apply-note').textContent = note ? '应用修改' : '添加到这个位置';
  $('#edit-duration').value = event.duration ?? '';
  $('#event-sustain').value = event.sustain ?? 'inherit';
  $('#event-sustain').disabled = !event.notes.length;
  const automaticDynamics = !!event.strum?.autoDynamics;
  $('#event-dynamics option[value="auto"]').disabled = !automaticDynamics;
  $('#event-dynamics option[value="auto"]').textContent = `自动（当前：${suggestedStrumDynamic(score,event)==='soft'?'轻':'中'}）`;
  $('#event-dynamics').value = typeof event.dynamics==='number'?'custom':event.dynamics ?? (automaticDynamics?'auto':'normal');
  $('#event-dynamics').disabled = !event.notes.length;
  $('#unify-dynamics').disabled = !event.notes.length;
  $('#note-dynamics').value = typeof note?.dynamics==='number'?'custom':note?.dynamics ?? 'inherit';
  $('#note-dynamics').disabled = !note;
  $('#delete-note').disabled = !note;
  const previous = note && previousOnString(score, event.id, note.string);
  $('#note-technique').disabled = !note || !previous || !!note.graceBefore;
  $('#note-technique').value = note?.technique?.type ?? '';
  $('#technique-origin').textContent = previous ? `从 ${previous.note.string} 弦 ${previous.note.fret ?? '?'} 品到当前 ${note.fret ?? '?'} 品；只影响这一根弦。` : '这根弦前面没有可连接的音。';
  $('#note-technique option[value="hammer"]').disabled = !previous || note.fret === null || previous.note.fret === null || note.fret <= previous.note.fret;
  $('#note-technique option[value="pull"]').disabled = !previous || note.fret === null || previous.note.fret === null || note.fret >= previous.note.fret;
  $('#note-technique option[value="slide"]').disabled = !previous || note.fret === null || previous.note.fret === null || note.fret === previous.note.fret;
  $('#slide-controls').hidden = note?.technique?.type !== 'slide';
  $('#slide-ratio').value = String(Math.round(100 * (note?.technique?.ratio ?? 0.2)));
  $('#slide-ratio-value').textContent = `${$('#slide-ratio').value}%`;
  $('#slide-ratio').disabled = note?.technique?.type !== 'slide';
  for (const button of document.querySelectorAll('[data-slide-ratio]')) button.disabled = note?.technique?.type !== 'slide';
  $('#grace-string').value = String(note?.graceBefore?.string ?? note?.string ?? 1);
  $('#grace-fret').value = String(note?.graceBefore?.fret ?? Math.max(0, (note?.fret ?? 2) - 2));
  $('#grace-articulation').value = note?.graceBefore?.articulation ?? 'pick';
  $('#grace-lead').value = String(note?.graceBefore?.leadBeats ?? 0.125);
  $('#apply-grace').textContent = note?.graceBefore ? '修改倚音' : '添加倚音';
  $('#apply-grace').disabled = !note || note.fret === null || !!note.technique;
  $('#remove-grace').disabled = !note?.graceBefore;
  $('#grace-info').textContent = note?.technique ? '这颗音已连接上一音；先移除该连接才能加倚音。' :
    note?.graceBefore ? '小音提前响起，主音仍落在原拍点。' : '可为选中的主音添加一个小音。';
  $('#bend-semitones').value = String(note?.bend?.semitones ?? '');
  $('#bend-reach').value = String(note?.bend?.reachRatio ?? 0.35);
  $('#bend-release').checked = !!note?.bend?.release;
  $('#bend-semitones').disabled = !note || note.fret === null || note.fret === 0;
  $('#bend-reach').disabled = !note?.bend;
  $('#bend-release').disabled = !note?.bend;
  $('#bend-info').textContent = note?.fret === 0 ? '普通推弦需要按住非空弦品位。' :
    note?.bend ? '只改变这颗音的音高，不改变谱上的品位。' : '选好幅度即可给当前音符加推弦。';
  $('#add-note').disabled = event.notes.length >= 6;
  $('#copy-chord').disabled = event.notes.length < 2 || event.notes.some(item => item.fret === null);
  $('#chord-label').disabled = event.notes.length < 2 && !event.chordPending;
  $('#chord-label').value = event.chordName ?? '';
  $('#strum-direction').disabled = event.notes.length < 2 && !event.chordPending;
  $('#strum-direction').value = event.strum?.direction ?? '';
  $('#strum-speed').disabled = !event.strum;
  if (event.strum?.speedMode === 'auto') {
    const name = suggestedStrumSpread(score, event.id) === 0.16 ? '标准' : '快扫';
    $('#strum-speed option[value="auto"]').textContent = `自动（当前：${name}）`;
  }
  $('#strum-speed').value = event.strum?.speedMode === 'auto' ? 'auto' : String(event.strum?.spreadBeats ?? 0.08);
  $('#strum-volume').disabled = !event.strum;
  $('#strum-volume-auto').disabled = !event.strum || event.strum.volume === undefined;
  $('#strum-volume').value = String(event.strum?.volume ?? 70);
  $('#strum-volume-value').textContent = event.strum?.volume === undefined ? '自动' : String(event.strum.volume);
  for (const item of event.notes) {
    const button = document.createElement('button');
    const strength = {soft: '轻', normal: '中', strong: '重'}[dynamicCategory(event, item, suggestedStrumDynamic(score,event))];
    button.textContent = `${item.string}弦 · ${item.fret === 0 ? '空弦' : `${item.fret ?? '?'}品`} · ${strength}`;
    button.className = item.id === note?.id ? 'active' : '';
    button.addEventListener('click', () => choose(event.id, item.id, item.string));
    $('#chord-list').append(button);
  }
  syncEditorEffects(note,event);
}

function commit(action) {
  player.stop();
  const previous = clone(score), previousSelection = clone(selected);
  try {
    action();
    for (const measure of score.measures) for (const event of measure.events) {
      if(event.notes.length >= 2 || !event.chordName)delete event.chordPending;
      if (event.notes.length < 2 && !event.chordPending) { delete event.strum; delete event.chordName; }
    }
    const removedTechniques = pruneTechniques(score) + pruneOrnaments(score);
    validate(score);
    undo.push({score: previous, selected: previousSelection});
    if (undo.length > 40) undo.shift();
    redo = [];
    score.modifiedAt = new Date().toISOString();
    stash();
    $('#edit-error').textContent = '';
    render();
    if (removedTechniques) notify(`${removedTechniques} 处技巧或装饰音因音符变化已移除，可撤销`);
  } catch (error) {
    score = previous;
    selected = previousSelection;
    $('#edit-error').textContent = error.message;
  }
}

function history(direction) {
  const from = direction === 'undo' ? undo : redo;
  const to = direction === 'undo' ? redo : undo;
  if (!from.length) return;
  player.stop();
  to.push({score: clone(score), selected: clone(selected)});
  const state = from.pop();
  score = state.score;
  // A disk revision is independent of editing history. Preserve it for this document.
  const savedRecord=to.at(-1)?.score.libraryRecord;
  if(savedRecord && to.at(-1).score.id===score.id)score.libraryRecord=clone(savedRecord);
  selected = state.selected;
  stash();
  render();
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.readAsDataURL(blob);
  });
}

async function hydrate(document) {
  for (const source of document.sources) {
    if (!source.dataUrl && (source.url?.startsWith('/api/images/') || source.url?.startsWith('/api/recognition/images/'))) {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error('原图无法读取');
      source.dataUrl = await toDataUrl(await response.blob());
    }
  }
  return document;
}

function replace(document, persist=true) {
  if(sessions.has(document.id)){activateSession(document.id);return;}
  if(score&&!directEditing.confirm()){notify('请先完成或取消正在编辑的品位');return;}
  captureActiveSession();
  player.stop();
  score = document;
  reviewCursorKey=null;rowKey=null;nextRowKey=null;rowDirty=true;
  resetPracticeRange();
  applyPracticeDefaults();
  undo = [];
  redo = [];
  const first = score.measures.flatMap(m => m.events).find(e => e.notes.length) ?? score.measures[0]?.events[0];
  selected = first ? {eventId: first.id, noteId: first.notes[0]?.id ?? null, string: first.notes[0]?.string ?? 1} : score.measures[0] ? {measureId:score.measures[0].id,eventId:null,noteId:null,string:1}:null;
  wholePage = false;
  activeSessionId=score.id;sessionOrder.push(score.id);
  sessions.set(score.id,{score,dirty:!isSaved(score),selected,wholePage,undo,redo,reviewCursorKey,rowKey,nextRowKey,
    scrollTop:0,editorTab:'note',practice:null});
  persistSessions();
  $('#sample-picker').value = document.originSample ?? '';
  if(persist)stash();
  else {++draftGeneration;$('#save-status').textContent=sessions.get(score.id).dirty?'● 有未保存修改 · 已在本机暂存':'✓ 已保存到乐谱库';}
  render();
}

async function loadSample(key) {
  const draftId=localStorage.getItem(SAMPLE_DRAFT_CACHE+key);
  if(draftId){
    try{const draft=await getDraft(draftId);if(draft){replace(await hydrate(importScore(draft)));return;}}
    catch{}
    localStorage.removeItem(SAMPLE_DRAFT_CACHE+key);
  }
  const cached = localStorage.getItem(SAMPLE_CACHE + key);
  if (cached) {
    try { replace(await hydrate(importScore(JSON.parse(cached)))); return; }
    catch { localStorage.removeItem(SAMPLE_CACHE + key); }
  }
  const response = await fetch(`/api/samples/${encodeURIComponent(key)}`);
  if (!response.ok) throw new Error('谱例暂时无法打开');
  const document = await hydrate(importScore(await response.json()));
  document.originSample = key;
  replace(document);
}

async function exportFile() {
  if (!score) return;
  try {
    await hydrate(score);
    const data = JSON.stringify(portable(score), null, 2);
    const blob = new Blob([data], {type: 'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url;
    link.download = `${score.title.replace(/[\\/:*?"<>|]/g, '_') || '未命名乐谱'}.tablens.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    stash();
    notify('文件已导出，包含原图和你的修改');
  } catch (error) { notify(error.message); }
}

async function preserveDraftBeforeReopen(document) {
  if (!document?.id) return null;
  const current=score?.id===document.id ? clone(score) : null;
  await Promise.allSettled([...(pendingDraftWrites.get(document.id)??[])]);
  const previous=current??await getDraft(document.id);
  if (!previous || isSaved(previous) || draftKey(previous)===draftKey(document)) return null;
  const recovery=clone(previous);
  recovery.id=`score-${crypto.randomUUID()}`;
  recovery.title=`${previous.title} · 未保存修改（恢复）`;
  recovery.modifiedAt=new Date().toISOString();
  delete recovery.libraryRecord;
  delete recovery.originSample;
  await storeDraft(recovery);
  return recovery;
}

async function libraryRequest(path,value) {
  const response=await fetch('/api/library'+path,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  const data=await response.json();if(!response.ok)throw new Error(data.error ?? '乐谱库操作失败');return data;
}
async function save(document=score) {
  if(!document)return;
  if(saving)throw new Error('另一份乐谱正在保存，请稍后重试');
  saving=true;$('#save-file').disabled=true;
  try {
    const snapshot=clone(document);await hydrate(snapshot);
    const data=await libraryRequest('/save',{score:portable(snapshot),recordId:snapshot.libraryRecord?.id,revision:snapshot.libraryRecord?.revision});
    snapshot.libraryRecord=data.record;rememberSaved(snapshot);
    document.libraryRecord=data.record;
    const session=sessions.get(snapshot.id);
    if(session){session.score.libraryRecord=data.record;session.dirty=!isSaved(session.score);}
    if(score.id===snapshot.id) {
      score.libraryRecord=data.record;stash();
    }
    for(const entry of [...undo,...redo])if(entry.score.id===snapshot.id)entry.score.libraryRecord=clone(data.record);
    updateDraftRecord(snapshot.id,data.record).catch(()=>{});
    renderTabs();
    if(!$('#files-sidebar').hidden)refreshFileSidebar();
    notify(`已保存到乐谱库：${data.record.filename}`);
    return data;
  } catch(error) {notify(`保存失败：${error.message}`);throw error;}
  finally {saving=false;$('#save-file').disabled=false;}
}

$('#new-score').addEventListener('click',()=>{updateNewScoreSummary();$('#new-score-dialog').showModal();$('#new-score-title').select();});
$('#new-score-cancel').addEventListener('click',()=>$('#new-score-dialog').close());
$('#new-score-form').addEventListener('submit',event=>{
  event.preventDefault();const next=newScore($('#new-score-title').value.trim()||'未命名编曲',getNewScoreDefaults());
  replace(next);selectEditorTab('note');$('#new-score-dialog').close();
});
$('#save-as').addEventListener('click',()=>{$('#save-as-title').value=(score.title+' · 新编曲').slice(0,120);$('#save-as-error').textContent='';$('#save-as-dialog').showModal();});
$('#save-as-cancel').addEventListener('click',()=>$('#save-as-dialog').close());
$('#save-as-form').addEventListener('submit',async event=>{
  event.preventDefault();if(saving)return;
  const originalId=score.id,next=clone(score);next.id='score-'+crypto.randomUUID();
  next.title=$('#save-as-title').value.trim()||'未命名编曲';delete next.libraryRecord;delete next.originSample;
  next.modifiedAt=new Date().toISOString();$('#save-as-confirm').disabled=true;
  try {
    const result=await save(next);
    if(score.id===originalId) {
      next.libraryRecord=result.record;rememberSaved(next);replace(next);
    }
    $('#save-as-dialog').close();
  }catch(error){$('#save-as-error').textContent=error.message;}
  finally{$('#save-as-confirm').disabled=false;}
});
$('#export-file').addEventListener('click',exportFile);
function applyLibraryFilters() {
  const list=$('#library-list'),rows=[...list.querySelectorAll('.library-row')];
  const query=$('#library-query').value.trim().toLocaleLowerCase();
  const period=$('#library-period').value,sort=$('#library-sort').value;
  const cutoff=period==='all'?-Infinity:Date.now()-Number(period)*24*60*60*1000;
  const timestamp=row=>Date.parse(row.dataset.modifiedAt??'');
  const compare=(a,b)=>{
    if(sort==='title')return a.dataset.title.localeCompare(b.dataset.title,'zh-CN')||((timestamp(b)||0)-(timestamp(a)||0));
    const first=timestamp(a),second=timestamp(b);
    if(!Number.isFinite(first))return Number.isFinite(second)?1:0;
    if(!Number.isFinite(second))return -1;
    return (sort==='oldest'?first-second:second-first)||a.dataset.title.localeCompare(b.dataset.title,'zh-CN');
  };
  const saved=rows.filter(row=>row.dataset.kind==='saved').sort(compare);
  const drafts=rows.filter(row=>row.dataset.kind==='draft').sort(compare);
  let visible=0;
  for(const row of rows){
    const matchesTitle=row.dataset.title.toLocaleLowerCase().includes(query);
    const date=timestamp(row);
    row.hidden=!matchesTitle||(period!=='all'&&(!Number.isFinite(date)||date<cutoff));
    if(!row.hidden)visible++;
  }
  const caption=list.querySelector('.library-caption');
  if(caption)caption.hidden=!drafts.some(row=>!row.hidden);
  list.replaceChildren(...saved,...(caption?[caption]:[]),...drafts);
  if(!visible&&rows.length){const empty=document.createElement('p');empty.className='library-no-results';empty.textContent='没有符合条件的乐谱';list.append(empty);}
  $('#library-filter-result').textContent=rows.length?`显示 ${visible} / ${rows.length} 项`:'暂无可筛选的乐谱';
  list.scrollTop=0;
}
for(const id of ['#library-query','#library-period','#library-sort'])
  $(id).addEventListener(id==='#library-query'?'input':'change',applyLibraryFilters);
$('#library-close').addEventListener('click',()=>$('#library-dialog').close());
async function openLibraryRecord(record) {
  const existing=[...sessions.entries()].find(([,session])=>session.score.libraryRecord?.id===record.id);
  if(existing){activateSession(existing[0]);return false;}
  const opened=await libraryRequest('/'+record.id),document=await hydrate(importScore(opened.score));
  document.libraryRecord=opened.record;
  if(sessions.has(document.id)){activateSession(document.id);return false;}
  const recovery=await preserveDraftBeforeReopen(document);
  rememberSaved(document);replace(document);
  notify(recovery?'已打开保存版本；旧修改保留在本机暂存':'已从乐谱库打开');
  return true;
}

async function refreshFileSidebar() {
  const library=$('#files-library-list'),draftList=$('#files-draft-list');
  try{
    const [data,drafts]=await Promise.all([libraryRequest(''),listDrafts()]);
    library.replaceChildren();draftList.replaceChildren();
    for(const record of data.records){
      const entry=document.createElement('button');entry.type='button';entry.className='file-entry';
      entry.textContent=record.title;entry.title=`已保存 · ${new Date(record.modifiedAt).toLocaleString()}`;
      entry.addEventListener('click',async()=>{try{await openLibraryRecord(record);}
        catch(error){notify(`打开失败：${error.message}`);}});library.append(entry);
    }
    if(!data.records.length){const empty=document.createElement('p');empty.className='file-empty';empty.textContent='暂无已保存乐谱';library.append(empty);}
    const visibleDrafts=drafts.filter(draft=>!isSaved(draft));
    for(const draft of visibleDrafts){
      const entry=document.createElement('button');entry.type='button';entry.className='file-entry';
      entry.textContent=`● ${draft.title||'未命名乐谱'}`;entry.title='本机未保存的修改';
      entry.addEventListener('click',()=>{try{replace(importScore(draft));}
        catch(error){notify(`打开暂存失败：${error.message}`);}});draftList.append(entry);
    }
    if(!visibleDrafts.length){const empty=document.createElement('p');empty.className='file-empty';empty.textContent='暂无未保存的暂存';draftList.append(empty);}
    filterFileSidebar();
  }catch(error){notify(`文件栏读取失败：${error.message}`);}
}
$('#files-toggle').addEventListener('click',()=>setFileSidebarOpen($('#files-sidebar').hidden||$('#files-sidebar').dataset.pane!=='files','files'));
$('#files-close').addEventListener('click',()=>setFileSidebarOpen(false));
$('#measures-toggle').addEventListener('click',()=>setFileSidebarOpen($('#files-sidebar').hidden||$('#files-sidebar').dataset.pane!=='measures','measures'));
$('#sidebar-files-tab').addEventListener('click',()=>setFileSidebarOpen(true,'files'));
$('#sidebar-measures-tab').addEventListener('click',()=>setFileSidebarOpen(true,'measures'));
$('#files-query').addEventListener('input',filterFileSidebar);
$('#files-manage').addEventListener('click',()=>$('#open-library').click());
$('#open-library').addEventListener('click',async()=>{
  $('#library-dialog').showModal();$('#library-status').textContent='正在读取…';$('#library-filter-result').textContent='';$('#library-list').replaceChildren();
  try {
    const data=await libraryRequest('');$('#library-directory').textContent=data.directory;
    for(const record of data.records) {
      const row=document.createElement('div');row.className='library-row';row.dataset.kind='saved';row.dataset.title=record.title;row.dataset.modifiedAt=record.modifiedAt??'';
      const button=document.createElement('button');button.className='library-item';
      button.textContent=`${record.title} · ${record.measures} 小节 · ${record.notes} 个音符 · ${new Date(record.modifiedAt).toLocaleString()}`;
      button.dataset.libraryId=record.id;
      button.addEventListener('click',async()=>{
        try {
          await openLibraryRecord(record);
          $('#library-dialog').close();
        }catch(error){$('#library-status').textContent=error.message;}
      });
      const remove=document.createElement('button');remove.className='library-delete danger small';
      remove.textContent='删除';remove.dataset.deleteLibraryId=record.id;
      remove.title='移到乐谱库回收站';
      remove.addEventListener('click',async()=>{
        const message='删除《'+record.title+'》？\n文件会移到乐谱库的“回收站”，对应本机暂存也会清除。若正在编辑这份谱，将切换到空白乐谱。';
        if(!window.confirm(message))return;
        remove.disabled=true;$('#library-status').textContent='正在移至回收站…';
        try {
          const deleted=await libraryRequest('/delete',{recordId:record.id,revision:record.revision});
          let draftError=false;
          try {
            await Promise.allSettled([...(pendingDraftWrites.get(deleted.scoreId)??[])]);
            await removeDraft(deleted.scoreId);
          }catch{draftError=true;}
          forgetSaved(deleted.scoreId);
          clearDraftCaches(deleted.scoreId);
          removeSessionFromWorkspace(deleted.scoreId);
          row.remove();
          $('#library-list').querySelector(`[data-draft-id="${CSS.escape(deleted.scoreId)}"]`)?.closest('.library-row')?.remove();
          applyLibraryFilters();
          $('#library-status').textContent=`已移至回收站：${deleted.trash}${draftError?'；本机暂存清理失败':''}`;
        }catch(error){$('#library-status').textContent=error.message;}
        finally{remove.disabled=false;}
      });
      row.append(button,remove);$('#library-list').append(row);
    }
    const drafts=(await listDrafts()).filter(document=>!isSaved(document));
    $('#library-status').textContent=data.records.length||drafts.length?`${data.records.length} 份已保存 · ${drafts.length} 份自动暂存`:'乐谱库还没有文件。写谱后点击“保存”。';
    if(drafts.length){
      const caption=document.createElement('p');caption.className='library-caption';caption.textContent='本机自动暂存（尚未保存到乐谱库的修改，可恢复或删除）';$('#library-list').append(caption);
      for(const draft of drafts.sort((a,b)=>(b.modifiedAt??'').localeCompare(a.modifiedAt??''))){
        const row=document.createElement('div');row.className='library-row';row.dataset.kind='draft';row.dataset.title=draft.title;row.dataset.modifiedAt=draft.modifiedAt??'';
        const button=document.createElement('button');button.className='library-item';button.dataset.draftId=draft.id;
        button.textContent=`暂存 · ${draft.title} · ${draft.modifiedAt?new Date(draft.modifiedAt).toLocaleString():'时间未知'}`;
        button.addEventListener('click',()=>{replace(importScore(draft));$('#library-dialog').close();notify('已恢复暂存的修改');});
        const remove=document.createElement('button');remove.className='library-delete danger small';
        remove.textContent='删除暂存';remove.dataset.deleteDraftId=draft.id;
        remove.title='清除浏览器中的这份自动暂存，不删除乐谱库文件';
        remove.addEventListener('click',async()=>{
          const message=`删除《${draft.title}》的本机自动暂存？\n未保存的修改将无法找回；乐谱库中已保存的文件不受影响。`+
            (score.id===draft.id?'\n当前正在编辑这份谱，删除后将切换到空白乐谱。':'');
          if(!window.confirm(message))return;
          remove.disabled=true;$('#library-status').textContent='正在删除本机暂存…';
          try {
            await Promise.allSettled([...(pendingDraftWrites.get(draft.id)??[])]);
            await removeDraft(draft.id);
            clearDraftCaches(draft.id);
            removeSessionFromWorkspace(draft.id);
            row.remove();
            if(!$('#library-list [data-draft-id]'))caption.remove();
            applyLibraryFilters();
            $('#library-status').textContent='已删除本机暂存；乐谱库文件未受影响。';
          }catch(error){$('#library-status').textContent=`删除暂存失败：${error.message}`;}
          finally{remove.disabled=false;}
        });
        row.append(button,remove);$('#library-list').append(row);
      }
    }
    applyLibraryFilters();
  }catch(error){$('#library-status').textContent=error.message;}
});

for(const [id,operation] of [['measure-before','before'],['measure-after','after'],['measure-copy','copy'],['measure-delete','delete']]) {
  $('#'+id).addEventListener('click',()=>{
    const current=currentMeasure();if(!current)return;
    commit(()=>{const next=operation==='delete'?removeMeasure(score,current.id):insertMeasure(score,current.id,operation==='before'?'before':'after',operation==='copy');chooseMeasure(next);});
  });
}

function setSelectedStrum(direction, eventId=selected?.eventId) {
  const found=eventId&&locate(score,eventId);
  if(!found||found.event.notes.length<2)return;
  commit(()=>{
    const position=locate(score,eventId).event;
    if(direction)position.strum={...position.strum,direction,spreadBeats:position.strum?.spreadBeats??0.08,
      speedMode:position.strum?.speedMode??'auto',autoDynamics:position.strum?.autoDynamics??true};
    else delete position.strum;
  });
  $('#tab-view').focus({preventScroll:true});
}
$('#tab-view').addEventListener('click', event => {
  const strumAction=event.target.closest('[data-strum-action]');
  if(strumAction){setSelectedStrum(strumAction.dataset.strumAction,strumAction.dataset.eventId);return;}
  const chordTrigger=event.target.closest('[data-chord-diagram]');
  if(chordTrigger){const found=locate(score,chordTrigger.dataset.chordDiagram);
    if(found)showChordDiagram(chordTrigger,found.event,score);return;}
  if(event.target.closest('[data-direct-action],[data-position],[data-column-position],[data-rhythm],.tab-cell[data-event],#inline-fret'))return;
  const empty=event.target.closest('[data-empty-measure]'),add=event.target.closest('[data-add-measure-position]'),measure=event.target.closest('[data-select-measure]');
  if(measure) {chooseMeasure(score.measures.find(m=>m.id===measure.dataset.selectMeasure));selectEditorTab('measure');render();return;}
  if(empty||add) {
    const measureId=empty?.dataset.emptyMeasure ?? add.dataset.addMeasurePosition;
    commit(()=>{const eventId=addPosition(score,measureId,null);selected={eventId,noteId:null,string:Number(empty?.dataset.string ?? 1),kind:'note'};});
    selectEditorTab('note');return;
  }
  if(event.target.closest('button,input,[role=button]'))return;
  const card=event.target.closest('.measure-card');
  if(card){chooseMeasure(score.measures.find(m=>m.id===card.dataset.measure));selectEditorTab('measure');render();$('#tab-view').focus({preventScroll:true});}
});
$('#tab-view').addEventListener('keydown', event => {
  if ((event.key==='ArrowLeft'||event.key==='ArrowRight') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
      !event.target.closest('input,textarea,select,[contenteditable="true"]') && !document.querySelector('dialog[open],.rhythm-menu')) {
    if(moveScoreSelection(event.key==='ArrowRight'?1:-1))event.preventDefault();
    return;
  }
  if ((event.key==='ArrowUp'||event.key==='ArrowDown') && !event.ctrlKey && !event.metaKey && !event.altKey &&
      selected?.kind==='position' && !event.target.closest('input,textarea,select') &&
      locate(score,selected.eventId)?.event.notes.length>=2) {
    event.preventDefault();setSelectedStrum(event.key==='ArrowUp'?'up':'down');return;
  }
  if (['Enter', ' '].includes(event.key) && event.target.matches('[data-chord-diagram]')) {
    event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));return;
  }
  if (['Enter', ' '].includes(event.key) && event.target.matches('[data-event],[data-empty-measure]')) {
    event.preventDefault();
    event.target.dispatchEvent(new MouseEvent('click', {bubbles: true, shiftKey: event.shiftKey}));
  }
});
$('#note-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!selected) return;
  const string = Number($('#edit-string').value), fretText = $('#edit-fret').value;
  if (fretText === '') { $('#edit-error').textContent = '请填写品位，空弦填0'; return; }
  const fret = Number(fretText);
  commit(() => {
    const noteId = setNote(score, selected.eventId, selected.noteId, string, fret);
    selected = {...selected, noteId, string,kind:'note'};
  });
});
$('#delete-note').addEventListener('click', () => {
  if (!selected?.noteId) return;
  commit(() => {
    removeNote(score, selected.eventId, selected.noteId);
    selected.noteId = null;
  });
});
$('#apply-chord').addEventListener('click', () => {
  if (!selected?.eventId) return;
  commit(() => {
    selected.noteId = applyChordPreset(score, selected.eventId, $('#chord-preset').value);
    selected.kind = 'note';
  });
});
$('#copy-chord').addEventListener('click', () => {
  if (!selected?.eventId) return;
  commit(() => {
    selected.eventId = copyChordToNext(score, selected.eventId);
    selected.noteId = locate(score, selected.eventId).event.notes[0].id;
    selected.kind = 'note';
  });
});
$('#chord-label').addEventListener('change', event => {
  if (!selected?.eventId) return;
  const name = event.target.value.trim();
  commit(() => {
    const position = locate(score, selected.eventId).event;
    if (name) position.chordName = name;
    else {delete position.chordName;delete position.chordPending;}
  });
});
$('#strum-direction').addEventListener('change', event => {
  if (!selected?.eventId) return;
  const direction = event.target.value;
  commit(() => {
    const position = locate(score, selected.eventId).event;
    if (direction) position.strum = {...position.strum, direction, spreadBeats: position.strum?.spreadBeats ?? 0.08,
      speedMode: position.strum?.speedMode ?? 'auto', autoDynamics: position.strum?.autoDynamics ?? true};
    else delete position.strum;
  });
});
$('#strum-speed').addEventListener('change', event => {
  if (!selected?.eventId) return;
  const value = event.target.value;
  commit(() => {
    const strum = locate(score, selected.eventId).event.strum;
    if (value === 'auto') strum.speedMode = 'auto';
    else { strum.spreadBeats = Number(value); delete strum.speedMode; }
  });
});
$('#strum-volume').addEventListener('input', event => {
  $('#strum-volume-value').textContent = event.target.value;
});
$('#strum-volume').addEventListener('change', event => {
  if (!selected?.eventId) return;
  const volume = Number(event.target.value);
  commit(() => {
    const strum = locate(score, selected.eventId).event.strum;
    if (!strum) throw new Error('请先为这个位置设置扫弦');
    strum.volume = volume;
  });
});
$('#strum-volume-auto').addEventListener('click', () => {
  if (!selected?.eventId) return;
  commit(() => { delete locate(score, selected.eventId).event.strum.volume; });
});
$('#add-note').addEventListener('click', () => {
  const found = selected && locate(score, selected.eventId, selected.noteId);
  if (!found) return;
  const string = [1, 2, 3, 4, 5, 6].find(s => !found.event.notes.some(n => n.string === s));
  if (string) choose(found.event.id, null, string);
});
$('#add-position').addEventListener('click', () => {
  const found = selected?.eventId && locate(score, selected.eventId, selected.noteId),measure=currentMeasure();
  if (!measure) return;
  commit(() => {
    const eventId = addPosition(score, measure.id, found?.event.id ?? null);
    selected = {eventId, noteId: null, string: 1};
  });
});
$('#add-position-before').addEventListener('click', () => {
  const found = selected?.eventId && locate(score, selected.eventId),measure=currentMeasure();
  if (!measure) return;
  commit(() => {
    const eventId = addPosition(score, measure.id, found?.event.id ?? null, 'before');
    selected = {eventId, noteId: null, string: 1};
  });
});
$('#edit-duration').addEventListener('change', event => {
  const value = event.target.value || null;
  if (!selected) return;
  commit(() => { locate(score, selected.eventId).event.duration = value; });
});
$('#sustain').addEventListener('change', event => {
  const value = event.target.value;
  commit(() => { score.sustain = value; });
});
$('#event-sustain').addEventListener('change', event => {
  if (!selected) return;
  const value = event.target.value;
  commit(() => {
    const position = locate(score, selected.eventId).event;
    if (value === 'inherit') delete position.sustain;
    else position.sustain = value;
  });
});
$('#event-dynamics').addEventListener('change', event => {
  if (!selected) return;
  const value = event.target.value;
  commit(() => {
    if (value === 'auto') {
      const position = locate(score, selected.eventId).event;
      if (!position.strum?.autoDynamics) throw new Error('此位置未启用自动扫弦力度');
      delete position.dynamics;
      for (const note of position.notes) delete note.dynamics;
    } else setEventDynamics(score, [selected.eventId], value);
  });
});
$('#unify-dynamics').addEventListener('click', () => {
  if (!selected) return;
  commit(() => {
    const position = locate(score,selected.eventId).event;
    setEventDynamics(score, [selected.eventId], position.dynamics??suggestedStrumDynamic(score,position));
  });
});
$('#note-dynamics').addEventListener('change', event => {
  if (!selected?.noteId) return;
  const value = event.target.value;
  commit(() => {
    const note = locate(score, selected.eventId, selected.noteId).note;
    if (value === 'inherit') delete note.dynamics;
    else note.dynamics = value;
  });
});
$('#note-technique').addEventListener('change', event => {
  if (!selected?.noteId) return;
  const type = event.target.value;
  commit(() => setNoteTechnique(score, selected.eventId, selected.noteId, type, Number($('#slide-ratio').value) / 100));
});
$('#slide-ratio').addEventListener('input', event => {
  $('#slide-ratio-value').textContent = `${event.target.value}%`;
});
$('#slide-ratio').addEventListener('change', event => {
  if (!selected?.noteId) return;
  commit(() => setNoteTechnique(score, selected.eventId, selected.noteId, 'slide', Number(event.target.value) / 100));
});
for (const button of document.querySelectorAll('[data-slide-ratio]')) button.addEventListener('click', () => {
  if (!selected?.noteId) return;
  commit(() => setNoteTechnique(score, selected.eventId, selected.noteId, 'slide', Number(button.dataset.slideRatio) / 100));
});
$('#apply-grace').addEventListener('click', () => {
  if (!selected?.noteId) return;
  const fretText = $('#grace-fret').value.trim();
  if (!fretText) { $('#edit-error').textContent = '请填写倚音品位'; return; }
  const settings = {string: Number($('#grace-string').value), fret: Number(fretText),
    leadBeats: Number($('#grace-lead').value), articulation: $('#grace-articulation').value};
  commit(() => setGraceBefore(score, selected.eventId, selected.noteId, settings));
});
$('#remove-grace').addEventListener('click', () => {
  if (selected?.noteId) commit(() => setGraceBefore(score, selected.eventId, selected.noteId, null));
});
function applyBend() {
  if (!selected?.noteId) return;
  const value = $('#bend-semitones').value;
  commit(() => setBend(score, selected.eventId, selected.noteId, value ? {
    semitones: Number(value), reachRatio: Number($('#bend-reach').value),
    release: $('#bend-release').checked} : null));
}
for (const selector of ['#bend-semitones', '#bend-reach', '#bend-release'])
  $(selector).addEventListener('change', applyBend);
$('#apply-dynamics').addEventListener('click', () => {
  const scope = $('#dynamics-scope').value, value = $('#batch-dynamics').value;
  if(scope==='selection'&&selected?.kind==='multi'){
    if(!selected.noteIds.length){notify('先选择音符');return;}
    commit(()=>editNotes(score,selected,{dynamics:value}));
    notify(`已修改 ${selected.noteIds.length} 个音符的力度，可撤销`);return;
  }
  let events;
  if (scope === 'all') events = score.measures.flatMap(m => m.events);
  else if (scope === 'practice') events = score.measures.slice(Number($('#range-from').value), Number($('#range-to').value) + 1).flatMap(m => m.events);
  else if (scope === 'measure') events = selected && locate(score, selected.eventId)?.measure.events;
  else events = selected && eventRange(score, selected.rangeAnchor ?? selected.eventId, selected.eventId);
  const targets = (events ?? []).filter(event => event.notes.length);
  if (!targets.length) { notify('先选择包含音符的位置或范围'); return; }
  commit(() => setEventDynamics(score, targets.map(event => event.id), value));
  notify(`已统一 ${targets.length} 个位置的力度，可撤销`);
});
$('#delete-position').addEventListener('click', () => {
  if (!selected) return;
  commit(() => {
    const measure=locate(score,selected.eventId).measure;
    const next = removePosition(score, selected.eventId);
    if(!measure.events.length)chooseMeasure(measure);
    else selected = next ? {eventId: next.id, noteId: next.notes[0]?.id ?? null,
      string: next.notes[0]?.string ?? 1} : null;
  });
});
$('#set-rest').addEventListener('click', () => {
  if (!selected) return;
  commit(() => {
    const event = locate(score, selected.eventId).event;
    if (event.notes.length) throw new Error('先移除音符，才能将这个位置设为休止');
    event.kind = event.kind === 'rest' ? 'unknown' : 'rest';
  });
});
$('#merge-position').addEventListener('click', () => {
  if (!selected) return;
  commit(() => { mergePosition(score, selected.eventId); });
});
$('#split-position').addEventListener('click', () => {
  if (!selected?.noteId) return;
  commit(() => { selected.eventId = splitPosition(score, selected.eventId, selected.noteId); selected.rangeAnchor = selected.eventId; });
});
$('#incomplete-measure').addEventListener('change', event => {
  const value = event.target.checked;
  const measure=currentMeasure();if(measure)commit(()=>{measure.allowIncomplete=value;});
});
$('#time-signature').addEventListener('change', event => {
  const text = event.target.value.trim();
  if (!text) { commit(() => { score.timeSignature = null; }); return; }
  const match = /^(\d{1,2})\/(1|2|4|8|16|32)$/.exec(text);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 32) { notify('拍号请填写如4/4、3/4、6/8'); render(); return; }
  commit(() => { score.timeSignature = [Number(match[1]), Number(match[2])]; });
});

const openRecognition = recognitionDialog(async (candidate, target, append = false) => {
  await hydrate(candidate);
  if (target && score.id !== target.scoreId) throw new Error('当前已切换到另一份乐谱，不能局部替换；可作为新谱打开');
  // Validate against the latest score before committing, so conflicts reach the dialog.
  const next = append ? appendRecognition(score, candidate) : acceptRecognition(score, candidate, target?.measureId, target?.expected);
  if(!target&&!append){replace(next);notify('识别候选已在新标签打开，请对照原图检查');return;}
  commit(() => {
    score = next;
    const measure = target ? score.measures.find(m => m.id === target.measureId)
      : append ? score.measures.find(m => m.id === (candidate.measures.find(item=>item.events.length)??candidate.measures[0])?.id) ?? score.measures[0]
        : score.measures.find(m=>m.events.length) ?? score.measures[0];
    const event = measure?.events[0];
    selected = event ? {eventId:event.id, noteId:event.notes[0]?.id ?? null, string:event.notes[0]?.string ?? 1} : null;
    wholePage = false; $('#sample-picker').value = score.originSample ?? '';
  });
  notify(target ? '已替换这个小节，其他修改保留，可撤销' : '已追加识别小节，可继续处理PDF下一页');
}, async page => {
  const next=clone(score);
  const sourceId=page.id??'page-'+crypto.randomUUID();
  if(!next.sources.some(source=>source.id===sourceId))next.sources.push({
    id:sourceId,name:page.name,dataUrl:page.dataUrl,width:page.width,height:page.height,
    ...(page.pdfPageNumber?{originPdf:{name:page.pdfName,page:page.pdfPageNumber}}:{})});
  if(next.sources.reduce((size,source)=>size+(source.dataUrl?.length??0),0)>40_000_000)
    throw new Error('原图累计超过40MB，请先另存当前乐谱，再处理剩余页面');
  const blank=next.measures.length===1&&!next.measures[0].events.length&&!next.sources.slice(0,-1).length;
  const measure=blank?next.measures[0]:insertMeasure(next,next.measures.at(-1)?.id);
  measure.source={pageId:sourceId,box:[0,0,page.width,page.height]};
  measure.manualReference=true;
  const id=measure.id;
  validate(next);
  commit(()=>{score=next;selected={measureId:id,eventId:null,noteId:null,string:1};});
  layout.setMode('review');
  notify('已建立空小节并关联原图；可在TAB上手动输入，可撤销');
});
$('#import-image').addEventListener('click', () => { player.stop(); openRecognition(); });
$('#retry-measure').addEventListener('click', async () => {
  const measure=currentMeasure();
  const original = measureSource(measure);
  if (!original) return;
  try {
    await hydrate(score);
    const page = score.sources.find(p => p.id === original.pageId);
    if (!page?.dataUrl) throw new Error('此小节没有可用原图');
    player.stop();
    openRecognition({page: clone(page), box: clone(original.box),
      target: {scoreId:score.id, measureId:measure.id, expected:JSON.stringify(measure)}});
  } catch(error) { notify(error.message); }
});
$('#tempo').addEventListener('change', event => {
  const value = Number(event.target.value);
  if (!Number.isFinite(value) || value < 20 || value > 300) { notify('速度请填写20–300 BPM'); render(); return; }
  commit(() => { score.tempo = value; });
});
$('#capo').addEventListener('change', event => {
  const value = Number(event.target.value);
  if (!Number.isInteger(value) || value < 0 || value > 24) { notify('变调夹请填写0–24品'); render(); return; }
  commit(() => { score.capo = value; });
});
$('#apply-duration').addEventListener('click', () => {
  const scope = $('#batch-scope').value, value = $('#batch-duration').value;
  const measure = selected && locate(score, selected.eventId)?.measure;
  if (scope === 'measure' && !measure) { notify('先选择一个小节中的位置'); return; }
  const targets = (scope === 'measure' ? measure.events : score.measures.flatMap(m => m.events)).filter(e => scope !== 'missing' || e.duration === null);
  if (!targets.length) { notify('这个范围没有需要设置的位置'); return; }
  commit(() => { for (const event of targets) event.duration = value; });
  notify(`已设置 ${targets.length} 个位置的时值，可撤销`);
});
$('#play').addEventListener('click', async () => {
  try {
    if (player.state === 'playing') { player.pause(); return; }
    if(player.state==='paused'){await player.play(player.data,player.options);return;}
    const bpm = Number($('#tempo').value) * Number($('#speed').value);
    await player.play(timeline(score, bpm, {from: Number($('#range-from').value), to: Number($('#range-to').value)}),
      {loop: $('#loop').checked, countIn: $('#count-in').checked, metronome: $('#metronome').checked, sustain: score.sustain ?? 'natural'});
  } catch (error) {
    if (error.eventId) choose(error.eventId, null);
    notify(error.message);
  }
});
$('#play-selected').addEventListener('click',async()=>{
  try{
    if(!selected?.eventId)return;
    const bpm=Number($('#tempo').value)*Number($('#speed').value);
    const data=timeline(score,bpm,{from:Number($('#range-from').value),to:Number($('#range-to').value),startEventId:selected.eventId});
    player.stop();await player.play(data,{loop:$('#loop').checked,countIn:$('#count-in').checked,metronome:$('#metronome').checked,sustain:score.sustain??'natural'});
  }catch(error){if(error.eventId)choose(error.eventId,null);notify(error.message);}
});
$('#stop').addEventListener('click', () => player.stop());
for (const id of ['#range-from', '#range-to', '#loop', '#count-in', '#metronome', '#speed']) {
  $(id).addEventListener('change', () => {
    player.stop();
    const from = Number($('#range-from').value), to = Number($('#range-to').value);
    if (from > to) {
      if (id === '#range-from') $('#range-to').value = String(from);
      else $('#range-from').value = String(to);
    }
    readiness();
  });
}
$('#preview').addEventListener('click', async () => {
  try {
    const event = selected && locate(score, selected.eventId)?.event;
    if (!event) return;
    const midi = pitches(score, event);
    if (!midi.length) { notify('这是休止位置，不发声'); return; }
    await player.preview(midi, event.notes.map(note => note.string), event.sustain ?? score.sustain ?? 'natural', event.notes.map(note => effectiveDynamicLevel(score, event, note)), {score, event, bpm: Number($('#tempo').value) * Number($('#speed').value)});
  } catch (error) { notify(error.message); }
});
$('#score-title').addEventListener('change', event => {
  const value = event.target.value.trim() || '未命名乐谱';
  commit(() => { score.title = value; });
});
$('#undo').addEventListener('click', () => history('undo'));
$('#redo').addEventListener('click', () => history('redo'));
$('#review-next').addEventListener('click',()=>{
  if(!reviewNavigation.length)return;
  const index=reviewNavigation.findIndex(item=>item.key===reviewCursorKey);
  jumpToReview(reviewNavigation[(index+1)%reviewNavigation.length]);
});
$('#review-show-all').addEventListener('change',renderReview);
$('#source-toggle').addEventListener('click', () => { wholePage = !wholePage; render(); });
$('#source-zoom-out').addEventListener('click',()=>sourceViewport.setZoom(sourceViewport.getZoom()/1.25));
$('#source-zoom-in').addEventListener('click',()=>sourceViewport.setZoom(sourceViewport.getZoom()*1.25));
$('#source-zoom-fit').addEventListener('click',()=>sourceViewport.reset());
$('#source-row-zoom-out').addEventListener('click',()=>rowViewport.setZoom(rowViewport.getZoom()/1.25));
$('#source-row-zoom-in').addEventListener('click',()=>rowViewport.setZoom(rowViewport.getZoom()*1.25));
$('#source-row-zoom-fit').addEventListener('click',()=>rowViewport.reset());
$('#source-row-prev').addEventListener('click',()=>moveSourceRow(-1));
$('#source-row-next').addEventListener('click',()=>moveSourceRow(1));
document.addEventListener('tablens:layout-change',()=>{
  if(!score)return;
  rowDirty=true;
  render();
});
document.addEventListener('tablens:score-density-change',()=>{if(score)render();});
$('#sample-picker').addEventListener('change', async event => {
  try {await loadSample(event.target.value);if($('#library-dialog').open)$('#library-dialog').close();}
  catch(error){notify(error.message);}
});
$('#save-file').addEventListener('click',()=>save().catch(()=>{}));
$('#open-file').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const known = String(raw.source_file ?? '').split(/[\\/]/).pop();
    if (!raw.preview_source && ['duvet.png', 'lullaby.jpg'].includes(known)) {
      const response = await fetch(`/api/samples/${known.startsWith('duvet') ? 'duvet' : 'lullaby'}`);
      if (response.ok) raw.preview_source = (await response.json()).preview_source;
    }
    const document = importScore(raw);
    if (!raw.preview_title && !raw.metadata?.title && raw.schema !== 'tablens.score') document.title = file.name.replace(/(?:\.tablens)?\.json$/, '');
    await hydrate(document);
    if(sessions.has(document.id)){
      activateSession(document.id);notify('这份乐谱已经打开，已切换到对应标签');return;
    }
    const recovery=await preserveDraftBeforeReopen(document);
    replace(document);
    if (raw.format === 'tablens.agent.v1' || raw.format === 'tablens.agent.v2') {
      const review=collectReview(document);
      const needsReview=!!(review.globals.length||review.issueCount||review.pendingCount);
      if (needsReview) window.document.querySelector('.review-panel').open = true;
      notify((needsReview ? 'Agent 乐谱已打开；请查看校对提示并核对原图' : 'Agent 乐谱已打开；请逐音核对原图')+(recovery?'；旧的未保存修改已留在乐谱库暂存中':''));
    } else notify(recovery?'乐谱已打开；旧的未保存修改已留在乐谱库暂存中':'乐谱已打开');
  } catch (error) { notify(`无法打开：${error.message}`); }
  event.target.value = '';
});
$('#attach-image').addEventListener('click', () => $('#image-input').click());
$('#image-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const documentId=score.id,measureId=currentMeasure()?.id;
  try {
    const dataUrl = await toDataUrl(file), image = new Image();
    image.src = dataUrl;
    await image.decode();
    if(score.id!==documentId)throw new Error('已切换乐谱，请在新乐谱中重新关联原图');
    commit(() => {
      const target=score.measures.find(m=>m.id===measureId);
      if(!target)throw new Error('目标小节已删除，请重新关联原图');
      if(target.agentImported){
        let page=score.sources.find(source=>source.dataUrl===dataUrl);
        if(!page){
          page={id:'page-'+crypto.randomUUID(),name:file.name,dataUrl,
            width:image.naturalWidth,height:image.naturalHeight};
          score.sources.push(page);
        }
        target.source={pageId:page.id,box:[0,0,page.width,page.height]};
        target.manualReference=true;
        return;
      }
      const referenceId=target.source?.pageId??target.events.flatMap(e=>e.notes).find(n=>n.source)?.source.pageId;
      const index = score.sources.findIndex(p => p.id === referenceId);
      const previous = target.authored ? score.sources[index] : score.sources[index < 0 ? 0 : index];
      const sameSize = previous?.width === image.naturalWidth && previous?.height === image.naturalHeight;
      const page = {id:previous?.id ?? 'page-'+crypto.randomUUID(), name:file.name, dataUrl,
        width:image.naturalWidth, height:image.naturalHeight, cropBox:sameSize ? previous?.cropBox : null};
      if (previous) score.sources[index < 0 ? 0 : index] = page;
      else score.sources.push(page);
      if (previous && !sameSize) {
        for (const measure of score.measures) {
          if (measure.source?.pageId === page.id) delete measure.source;
          for (const event of measure.events) for (const note of event.notes) if (note.source?.pageId === page.id) note.source = null;
        }
        score.issues = [...(score.issues ?? []), '更换的原图尺寸不同，旧音符定位已移除；音符数据保留，需要重新识别位置'];
      }
      if(target.authored){target.source={pageId:page.id,box:[0,0,page.width,page.height]};target.manualReference=true;}
    });
    notify('原图已关联');
  } catch (error) { notify(error.message); }
  event.target.value = '';
});
$('#source-view').addEventListener('click', event => {
  const svg = $('#source-view'), matrix = svg.getScreenCTM();
  if (!matrix) return;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  for (const measure of score.measures) for (const position of measure.events) for (const note of position.notes) {
    const box = note.source?.box;
    if (note.source?.pageId === svg.dataset.pageId && box && point.x >= box[0] && point.x <= box[2] && point.y >= box[1] && point.y <= box[3]) {
      choose(position.id, note.id, note.string);
      return;
    }
  }
});
document.addEventListener('keydown', event => {
  if (!event.ctrlKey && !event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 's') { event.preventDefault(); if(directEditing.confirm())save().catch(()=>{}); }
  if (key === 'z' && !event.target.matches('input,textarea')) {
    event.preventDefault(); history(event.shiftKey ? 'redo' : 'undo');
  }
});

async function availableSamples() {
  let samples=[];
  try {
    const response=await fetch('/api/samples');
    if(response.ok){
      const data=await response.json();
      if(Array.isArray(data))samples=data;
    }
  }catch{}
  const picker=$('#sample-picker');
  picker.replaceChildren();
  for(const sample of samples){
    const option=document.createElement('option');
    option.value=sample.id;option.textContent=sample.title;
    picker.append(option);
  }
  $('#sample-section').hidden=!samples.length;
  return samples;
}
async function selectAvailableInstrument() {
  try {
    const response=await fetch('/audio/guitar/manifest.json');
    if(response.ok && Array.isArray((await response.json()).samples))return;
  }catch{}
  $('#instrument').value='synth';
  player.instrument=pluck;
  $('#sound-status').textContent='未安装本地吉他音源，已切换基础合成拨弦';
}
async function start() {
  try {
    const samples=await availableSamples();
    await selectAvailableInstrument();
    let previousTabs;
    try{previousTabs=JSON.parse(localStorage.getItem(OPEN_TABS));}catch{}
    if(Array.isArray(previousTabs?.ids)){
      for(const id of [...new Set(previousTabs.ids)]){
        try{const draft=await getDraft(id);if(draft)replace(await hydrate(importScore(draft)),false);}catch{}
      }
      if(sessionOrder.length){
        if(sessions.has(previousTabs.active))activateSession(previousTabs.active);
        persistSessions();return;
      }
    }
    const cached=localStorage.getItem(CACHE);
    if(cached){
      try{replace(await hydrate(importScore(JSON.parse(cached))));return;}
      catch{localStorage.removeItem(CACHE);}
    }
    const active=localStorage.getItem(ACTIVE_DRAFT);
    if(active){
      try{const draft=await getDraft(active);if(draft){replace(await hydrate(importScore(draft)));return;}}
      catch{}
      localStorage.removeItem(ACTIVE_DRAFT);
    }
    const sample=samples.find(item=>item.id==='duvet')??samples[0];
    if(sample){
      try{await loadSample(sample.id);return;}
      catch{notify('本机谱例不可读取，已打开空白乐谱');}
    }
    replace(newScore('未命名乐谱',getNewScoreDefaults()));
  }catch(error){
    $('#save-status').textContent='打开失败';
    notify(error.message);
  }
}
const directEditing=setupDirectEditing({getScore:()=>score,getSelection:()=>selected,commit,choose,chooseMeasure,render,notify});
setupMultiSelection({getScore:()=>score,getSelection:()=>selected,setSelection:value=>{selected=value;},chooseMeasure,commit,render,notify});
const refreshMeasureOverview=setupMeasureOrder({getScore:()=>score,getSelection:()=>selected,commit,chooseMeasure,render,notify,setSidebarPane:setFileSidebarOpen});
setupSettings({onContrastChange:render,onPracticeChange:value=>applyPracticeDefaults(value,false),
  onSourceFollowChange:()=>{
    nextRowKey=null;rowKey=null;rowDirty=true;
    displaySource(playbackView?.event?{eventId:playbackView.event.id}:selected);
  },
  onSourcePreviewChange:()=>{rowDirty=true;displaySource(playbackView?.event?{eventId:playbackView.event.id}:selected);},
  onNewScoreDefaultsChange:updateNewScoreSummary});
start();
