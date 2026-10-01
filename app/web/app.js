import {clone, validate, importScore, locate, setNote, removeNote, addPosition, removePosition, portable, eventRange, setEventDynamics, dynamicLevel, mergePosition, splitPosition, timingWarning, acceptRecognition, newScore, insertMeasure, removeMeasure} from './core.js';
import {setupWorkspace,selectEditorTab} from './workspace.js';
import {setupDirectEditing} from './direct.js';
import {setupMultiSelection,editNotes} from './selection.js';
import {setupMeasureOrder} from './measure-order.js';
import {storeDraft,listDrafts,removeDraft,updateDraftRecord,rememberSaved,forgetSaved,isSaved} from './drafts.js';
import {recognitionDialog} from './recognition.js';
import {renderTab, renderSource, updatePlayhead} from './tab.js';
import {Player, timeline, pitches, pluck} from './playback.js';
import {createGuitarInstrument} from './guitar.js';
import {dynamicCategory} from './core.js';
import {setupVolume} from './volume.js';
import {previousOnString, setNoteTechnique, pruneTechniques} from './techniques.js';
import {setGraceBefore, setBend, pruneOrnaments} from './ornaments.js';

const $ = selector => document.querySelector(selector);
setupWorkspace();
const CACHE = 'tablens.workspace.v1';
const SAMPLE_CACHE = 'tablens.sample.';
let score, selected, wholePage = false, undo = [], redo = [], noticeTimer;
let playingEvent = null, playbackView = null;
let practiceScoreId = null;
let practiceMeasures = '', saving = false;
const clockLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const player = new Player(view => {
  playbackView = view;
  $('#play').textContent = view.state === 'playing' ? 'Ⅱ 暂停' : view.state === 'paused' ? '▶ 继续' : '▶ 播放';
  $('#play-time').textContent = `${clockLabel(view.time)} / ${clockLabel(view.total)}`;
  updatePlayhead($('#tab-view'), view.event?.id, view.progress, view.state === 'playing' && playingEvent !== view.event?.id, view.graceNoteId);
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
  $('#play-status').textContent = !events.length ? '空小节：点击左侧弦线添加演奏位置，再填写品位。' : missing || unknown ? `${missing} 处节奏待设 · ${unknown} 处音符待确认。点击播放可定位首个问题。` : '已可播放 · 同一列的音符会同时响起。';
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

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}

function stash() {
  storeDraft(score).catch(()=>notify('多乐谱暂存失败，请及时保存到乐谱库'));
  try {
    localStorage.setItem(CACHE, JSON.stringify(score));
    if (score.originSample) localStorage.setItem(SAMPLE_CACHE + score.originSample, JSON.stringify(score));
    $('#save-status').textContent = isSaved(score) ? '✓ 已保存到乐谱库' : '● 有未保存修改 · 已在本机暂存';
  } catch {
    $('#save-status').textContent = '暂存空间不足，请保存文件';
  }
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

function displaySource(selection=selected) {
  const hasImage=renderSource($('#source-view'),score,selection,wholePage);
  const measure=score.measures.find(m=>m.id===selection?.measureId||m.events.some(e=>e.id===selection?.eventId));
  $('.side-column').classList.toggle('without-source',!score.sources.length);$('.source-panel').hidden=!score.sources.length;
  $('#source-enlarge').disabled=!hasImage;$('#source-toggle').disabled=!hasImage;
  $('#source-view').hidden=!hasImage;$('#source-empty').hidden=hasImage;
  $('#source-description').textContent=measure?.copiedFrom?'复制小节 · 原图仅作来源参考。':measure?.manualReference?'手动关联原图 · 仅供对照。':selection?.noteId&&!locate(score,selection.eventId,selection.noteId)?.note?.source?'手动新增的音 · 没有原图定位。':'选中音符，核对原来的位置。';
  $('#source-toggle').textContent=wholePage?'谱行':'整页';
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

function render() {
  if (!score) return;
  if (practiceScoreId !== score.id || practiceMeasures!==score.measures.map(m=>m.id).join('|')) resetPracticeRange();
  $('#score-title').value = score.title;
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
  if(multiple){$('#selection-count').textContent=`已选 ${selected.noteIds.length} 个音符 · ${selected.eventIds.length} 个位置`;$('#selection-scope').textContent=`时值将影响 ${selected.eventIds.length} 整列；力度和删除只影响所选音`;
    $('#selection-delete').disabled=!selected.noteIds.length;for(const button of document.querySelectorAll('[data-selection-dynamics]'))button.disabled=!selected.noteIds.length;}
  $('#range-status').textContent = `已选 ${range.length} 个位置 · Shift+点击可连续选段`;
  if (playbackView?.event) updatePlayhead($('#tab-view'), playbackView.event.id, playbackView.progress);
  $('#tempo').value = score.tempo ?? 80;
  $('#capo').value = score.capo ?? 0;
  $('#time-signature').value = score.timeSignature?.join('/') ?? '';
  $('#review-issues').replaceChildren();
  for (const issue of score.issues ?? []) {
    const item = document.createElement('p'); item.textContent = String(issue); $('#review-issues').append(item);
  }
  for (const measure of score.measures) {
    const issues = [...(measure.issues ?? []), ...(timingWarning(score, measure) ? [timingWarning(score, measure)] : []), ...measure.events.flatMap(e => e.issues ?? [])];
    if (!issues.length) continue;
    const button = document.createElement('button');
    button.className = 'text-button'; button.textContent = `第 ${measure.number} 小节：${issues.map(String).join('；')}`;
    button.addEventListener('click', () => {
      const event = measure.events.find(e => e.issues?.length || e.notes.some(n => n.fret === null)) ?? measure.events[0];
      if (event) choose(event.id, event.notes[0]?.id);
    });
    $('#review-issues').append(button);
  }
  $('#sustain').value = score.sustain ?? 'natural';
  $('#preview').disabled = !selected?.eventId||multiple;
  $('#play-selected').disabled=!selected?.eventId;
  if (player.state === 'stopped') readiness();
  displaySource();
  const measure=currentMeasure();
  for(const id of ['measure-before','measure-after','measure-copy','measure-delete'])$('#'+id).disabled=!measure;
  const found = selected ? locate(score, selected.eventId, selected.noteId) : null;
  renderVolume();
  const controls = ['#edit-string', '#edit-fret', '#apply-note', '#edit-duration', '#event-sustain', '#event-dynamics', '#note-dynamics', '#unify-dynamics', '#add-note', '#delete-note', '#note-technique', '#slide-ratio', '#grace-string', '#grace-fret', '#grace-articulation', '#grace-lead', '#apply-grace', '#remove-grace', '#bend-semitones', '#bend-reach', '#bend-release', '#add-position', '#add-position-before', '#delete-position', '#set-rest', '#merge-position', '#split-position', '#retry-measure', '#incomplete-measure'];
  for (const key of controls) $(key).disabled = !found;
  $('#chord-list').replaceChildren();
  $('#note-technique').value = '';
  $('#slide-controls').hidden = true;
  $('#technique-origin').textContent = '选中音符后设置技巧。';
  $('#grace-info').textContent = '先选中主音。';
  $('#bend-info').textContent = '先选中非空弦音符。';
  for (const button of document.querySelectorAll('[data-slide-ratio]')) button.disabled = true;
  if(multiple){for(const key of controls)$(key).disabled=true;$('#editor-title').textContent='批量选择';$('#editor-position').textContent='使用谱面上方的工具修改时值、力度或删除';$('#editor-badge').textContent=`${selected.noteIds.length} 个音`;return;}
  if (!found) {
    $('#editor-title').textContent = measure ? '编辑小节' : '选一个音符';
    $('#editor-badge').textContent='小节';$('#edit-duration').value='';
    $('#editor-position').textContent = measure ? `第 ${measure.number} 小节 · ${measure.events.length?`${measure.events.length} 个演奏位置`:'点击弦线添加第一个位置'}` : '点击左侧数字或空白弦线开始编辑。';
    $('#add-position').disabled=!measure;$('#add-position-before').disabled=!measure;
    $('#retry-measure').disabled=!measureSource(measure);
    $('#incomplete-measure').disabled=!measure;$('#incomplete-measure').checked=!!measure?.allowIncomplete;
    $('#edit-fret').value = '';
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
  $('#editor-position').textContent = `第 ${measure.number} 小节 · 第 ${measure.events.indexOf(event) + 1} 个位置`;
  $('#editor-badge').textContent = event.notes.length > 1 ? '同时弹' : '音符';
  $('#edit-string').value = note?.string ?? selected.string;
  $('#edit-fret').value = note ? (note.fret ?? '') : 0;
  $('#apply-note').textContent = note ? '应用修改' : '添加到这个位置';
  $('#edit-duration').value = event.duration ?? '';
  $('#event-sustain').value = event.sustain ?? 'inherit';
  $('#event-sustain').disabled = !event.notes.length;
  $('#event-dynamics').value = typeof event.dynamics==='number'?'custom':event.dynamics ?? 'normal';
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
  for (const item of event.notes) {
    const button = document.createElement('button');
    const strength = {soft: '轻', normal: '中', strong: '重'}[dynamicCategory(event, item)];
    button.textContent = `${item.string}弦 · ${item.fret === 0 ? '空弦' : `${item.fret ?? '?'}品`} · ${strength}`;
    button.className = item.id === note?.id ? 'active' : '';
    button.addEventListener('click', () => choose(event.id, item.id, item.string));
    $('#chord-list').append(button);
  }
}

function commit(action) {
  player.stop();
  const previous = clone(score), previousSelection = clone(selected);
  try {
    action();
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

function replace(document) {
  player.stop();
  score = document;
  resetPracticeRange();
  undo = [];
  redo = [];
  const first = score.measures.flatMap(m => m.events).find(e => e.notes.length) ?? score.measures[0]?.events[0];
  selected = first ? {eventId: first.id, noteId: first.notes[0]?.id ?? null, string: first.notes[0]?.string ?? 1} : score.measures[0] ? {measureId:score.measures[0].id,eventId:null,noteId:null,string:1}:null;
  wholePage = false;
  $('#sample-picker').value = document.originSample ?? '';
  stash();
  render();
}

async function loadSample(key) {
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

async function libraryRequest(path,value) {
  const response=await fetch('/api/library'+path,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  const data=await response.json();if(!response.ok)throw new Error(data.error ?? '乐谱库操作失败');return data;
}
async function save(document=score) {
  if(!document || saving)return;
  saving=true;$('#save-file').disabled=true;
  try {
    const snapshot=clone(document);await hydrate(snapshot);
    const data=await libraryRequest('/save',{score:portable(snapshot),recordId:snapshot.libraryRecord?.id,revision:snapshot.libraryRecord?.revision});
    snapshot.libraryRecord=data.record;rememberSaved(snapshot);
    if(score.id===snapshot.id) {
      score.libraryRecord=data.record;stash();
    }
    for(const entry of [...undo,...redo])if(entry.score.id===snapshot.id)entry.score.libraryRecord=clone(data.record);
    updateDraftRecord(snapshot.id,data.record).catch(()=>{});
    notify(`已保存到乐谱库：${data.record.filename}`);
    return data;
  } catch(error) {notify(`保存失败：${error.message}`);throw error;}
  finally {saving=false;$('#save-file').disabled=false;}
}

$('#new-score').addEventListener('click',()=>{$('#new-score-dialog').showModal();$('#new-score-title').select();});
$('#new-score-cancel').addEventListener('click',()=>$('#new-score-dialog').close());
$('#new-score-form').addEventListener('submit',event=>{
  event.preventDefault();const next=newScore($('#new-score-title').value.trim()||'未命名编曲');
  commit(()=>{score=next;chooseMeasure(score.measures[0]);wholePage=false;$('#sample-picker').value='';});
  selectEditorTab('note');$('#new-score-dialog').close();
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
      const selection=clone(selected);
      commit(()=>{score=next;score.libraryRecord=result.record;selected=selection;$('#sample-picker').value='';});
      rememberSaved(score);stash();
    }
    $('#save-as-dialog').close();
  }catch(error){$('#save-as-error').textContent=error.message;}
  finally{$('#save-as-confirm').disabled=false;}
});
$('#export-file').addEventListener('click',exportFile);
$('#library-close').addEventListener('click',()=>$('#library-dialog').close());
$('#open-library').addEventListener('click',async()=>{
  $('#library-dialog').showModal();$('#library-status').textContent='正在读取…';$('#library-list').replaceChildren();
  try {
    const data=await libraryRequest('');$('#library-directory').textContent=data.directory;
    $('#library-status').textContent=data.records.length?`${data.records.length} 份乐谱`:'乐谱库还没有文件。写谱后点击“保存”。';
    for(const record of data.records) {
      const row=document.createElement('div');row.className='library-row';
      const button=document.createElement('button');button.className='library-item';
      button.textContent=`${record.title} · ${record.measures} 小节 · ${record.notes} 个音符 · ${new Date(record.modifiedAt).toLocaleString()}`;
      button.dataset.libraryId=record.id;
      button.addEventListener('click',async()=>{
        try {
          const opened=await libraryRequest('/'+record.id),document=await hydrate(importScore(opened.score));
          document.libraryRecord=opened.record;rememberSaved(document);replace(document);stash();
          $('#library-dialog').close();notify('已从乐谱库打开');
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
          try{await removeDraft(deleted.scoreId);}catch{draftError=true;}
          forgetSaved(deleted.scoreId);
          try{for(const key of Object.keys(localStorage))if(key.startsWith(SAMPLE_CACHE)){
            try{if(JSON.parse(localStorage.getItem(key))?.id===deleted.scoreId)localStorage.removeItem(key);}catch{}
          }}catch{}
          if(score.id===deleted.scoreId){replace(newScore('未命名乐谱'));selectEditorTab('note');}
          row.remove();
          $('#library-list').querySelector(`[data-draft-id="${CSS.escape(deleted.scoreId)}"]`)?.remove();
          $('#library-status').textContent=`已移至回收站：${deleted.trash}${draftError?'；本机暂存清理失败':''}`;
        }catch(error){$('#library-status').textContent=error.message;}
        finally{remove.disabled=false;}
      });
      row.append(button,remove);$('#library-list').append(row);
    }
    const drafts=(await listDrafts()).filter(document=>!isSaved(document));
    if(drafts.length){
      const caption=document.createElement('p');caption.textContent='本机自动暂存（尚未保存的修改，可从这里找回）';$('#library-list').append(caption);
      for(const draft of drafts.sort((a,b)=>(b.modifiedAt??'').localeCompare(a.modifiedAt??''))){
        const button=document.createElement('button');button.className='library-item';button.dataset.draftId=draft.id;
        button.textContent=`暂存 · ${draft.title}`;button.addEventListener('click',()=>{replace(importScore(draft));$('#library-dialog').close();notify('已恢复暂存的修改');});$('#library-list').append(button);
      }
    }
  }catch(error){$('#library-status').textContent=error.message;}
});

for(const [id,operation] of [['measure-before','before'],['measure-after','after'],['measure-copy','copy'],['measure-delete','delete']]) {
  $('#'+id).addEventListener('click',()=>{
    const current=currentMeasure();if(!current)return;
    commit(()=>{const next=operation==='delete'?removeMeasure(score,current.id):insertMeasure(score,current.id,operation==='before'?'before':'after',operation==='copy');chooseMeasure(next);});
  });
}

$('#tab-view').addEventListener('click', event => {
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
  commit(() => setEventDynamics(score, [selected.eventId], value));
});
$('#unify-dynamics').addEventListener('click', () => {
  if (!selected) return;
  commit(() => setEventDynamics(score, [selected.eventId], locate(score,selected.eventId).event.dynamics??'normal'));
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

const openRecognition = recognitionDialog(async (candidate, target) => {
  await hydrate(candidate);
  if (target && score.id !== target.scoreId) throw new Error('当前已切换到另一份乐谱，不能局部替换；可作为新谱打开');
  // Validate against the latest score before committing, so conflicts reach the dialog.
  const next = acceptRecognition(score, candidate, target?.measureId, target?.expected);
  commit(() => {
    score = next;
    const measure = target ? score.measures.find(m => m.id === target.measureId) : score.measures[0];
    const event = measure?.events[0];
    selected = event ? {eventId:event.id, noteId:event.notes[0]?.id ?? null, string:event.notes[0]?.string ?? 1} : null;
    wholePage = false; $('#sample-picker').value = score.originSample ?? '';
  });
  notify(target ? '已替换这个小节，其他修改保留，可撤销' : '识别候选已打开，请对照原图检查，可撤销');
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
    await player.preview(midi, event.notes.map(note => note.string), event.sustain ?? score.sustain ?? 'natural', event.notes.map(note => dynamicLevel(event, note)), {score, event, bpm: Number($('#tempo').value) * Number($('#speed').value)});
  } catch (error) { notify(error.message); }
});
$('#score-title').addEventListener('change', event => {
  const value = event.target.value.trim() || '未命名乐谱';
  commit(() => { score.title = value; });
});
$('#undo').addEventListener('click', () => history('undo'));
$('#redo').addEventListener('click', () => history('redo'));
$('#source-toggle').addEventListener('click', () => { wholePage = !wholePage; render(); });
$('#sample-picker').addEventListener('change', event => { loadSample(event.target.value).catch(error => notify(error.message)); });
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
    replace(await hydrate(document));
    notify('乐谱已打开');
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
  picker.hidden=!samples.length;
  document.querySelector('label[for="sample-picker"]').hidden=!samples.length;
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
    const cached=localStorage.getItem(CACHE);
    if(cached){
      try{replace(await hydrate(importScore(JSON.parse(cached))));return;}
      catch{localStorage.removeItem(CACHE);}
    }
    const sample=samples.find(item=>item.id==='duvet')??samples[0];
    if(sample){
      try{await loadSample(sample.id);return;}
      catch{notify('本机谱例不可读取，已打开空白乐谱');}
    }
    replace(newScore('未命名乐谱'));
  }catch(error){
    $('#save-status').textContent='打开失败';
    notify(error.message);
  }
}
const directEditing=setupDirectEditing({getScore:()=>score,getSelection:()=>selected,commit,choose,chooseMeasure,render,notify});
setupMultiSelection({getScore:()=>score,getSelection:()=>selected,setSelection:value=>{selected=value;},chooseMeasure,commit,render,notify});
const refreshMeasureOverview=setupMeasureOrder({getScore:()=>score,getSelection:()=>selected,commit,chooseMeasure,render,notify});
start();
