import {validateTechniques} from './techniques.js';
import {validateOrnaments} from './ornaments.js';
// Stable, portable score data. All views edit this model, never the picture.
export const SCHEMA = 'tablens.score';
export const clone = value => structuredClone(value);
const id = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
export const DYNAMIC_GAIN = {soft: 0.55, normal: 1, strong: 1.35};
export const dynamicLevel = (event, note) => note?.dynamics ?? event.dynamics ?? 'normal';
export const dynamicVolume = value => typeof value==='number'?value:({soft:40,normal:70,strong:100}[value??'normal']);
export const dynamicCategory = (event,note) => {const value=dynamicVolume(dynamicLevel(event,note));return value<55?'soft':value>85?'strong':'normal';};
export function dynamicGain(value){
  if(typeof value!=='number')return DYNAMIC_GAIN[value??'normal']??1;
  return value<=40?value/40*0.55:value<=70?0.55+(value-40)/30*0.45:1+(value-70)/30*0.35;
}
export const checkDynamics = value => { if (value !== undefined && !(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100) && !Object.hasOwn(DYNAMIC_GAIN, value)) throw new Error('力度须为0–100，或轻、中、重'); };

export function eventRange(score, startId, endId = startId) {
  const events = score.measures.flatMap(measure => measure.events);
  const first = events.findIndex(event => event.id === startId), last = events.findIndex(event => event.id === endId);
  if (first < 0 || last < 0) return [];
  return events.slice(Math.min(first, last), Math.max(first, last) + 1);
}

export function setEventDynamics(score, eventIds, value) {
  checkDynamics(value);
  const ids = new Set(eventIds), events = score.measures.flatMap(m => m.events).filter(e => ids.has(e.id));
  if (events.length !== ids.size) throw new Error('演奏位置不存在');
  for (const event of events) {
    if (!event.notes.length) continue;
    event.dynamics = value;
    for (const note of event.notes) delete note.dynamics;
  }
}

export function fraction(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d+(?:\/\d+)?$/.test(value)) throw new Error('时值格式无效');
  const [a, b = '1'] = value.split('/').map(Number);
  if (!a || !b || !Number.isSafeInteger(a) || !Number.isSafeInteger(Number(b))) throw new Error('时值必须大于零');
  return a / Number(b);
}

export function validate(score) {
  if (!score || score.schema !== SCHEMA || score.version !== 1 || !Array.isArray(score.measures)) throw new Error('不是可打开的 TabLens 乐谱');
  if (typeof score.title !== 'string' || !Array.isArray(score.sources)) throw new Error('乐谱信息不完整');
  if (score.sustain !== undefined && !['natural', 'timed'].includes(score.sustain)) throw new Error('全谱延音设置无效');
  const seen = new Set();
  for (const measure of score.measures) {
    if (!Array.isArray(measure.events)) throw new Error('小节数据不完整');
    for (const event of measure.events) {
      if (!event.id || seen.has(event.id)) throw new Error('音符位置编号重复');
      seen.add(event.id);
      fraction(event.duration);
      checkDynamics(event.dynamics);
      if (event.sustain !== undefined && !['natural', 'timed'].includes(event.sustain)) throw new Error('音符延音设置无效');
      if (!Array.isArray(event.notes)) throw new Error('音符列表无效');
      const strings = new Set();
      for (const note of event.notes) {
        checkDynamics(note.dynamics);
        if (!note.id || seen.has(note.id)) throw new Error('音符编号重复');
        seen.add(note.id);
        if (note.graceBefore) {
          if (!note.graceBefore.id || seen.has(note.graceBefore.id)) throw new Error('倚音编号重复');
          seen.add(note.graceBefore.id);
        }
        if (!Number.isInteger(note.string) || note.string < 1 || note.string > 6) throw new Error('弦号必须为1到6');
        if (strings.has(note.string)) throw new Error('同一个位置，一根弦只能有一个音');
        strings.add(note.string);
        if (note.fret !== null && (!Number.isInteger(note.fret) || note.fret < 0 || note.fret > 36)) throw new Error('品位必须为0到36');
      }
    }
  }
  validateTechniques(score);
  validateOrnaments(score);
  return score;
}

export function importScore(raw) {
  if (raw?.schema === SCHEMA) {const score=validate(clone(raw));renumberMeasures(score);return score;}
  if (!Array.isArray(raw?.measures)) throw new Error('文件中没有乐谱数据');
  const meta = raw.metadata ?? {};
  const source = raw.preview_source;
  const crop = source?.cropBox ?? raw.source_crop_box;
  const pageId = source?.id ?? 'page-1';
  const score = {schema: SCHEMA, version: 1, id: id('score'),
    title: raw.preview_title ?? meta.title ?? '未命名乐谱',
    tempo: meta.tempo_bpm ?? null, timeSignature: meta.time_signature ?? null,
    capo: meta.capo ?? null, tuningMidi: [64, 59, 55, 50, 45, 40], tuningOrigin: 'standard-default',
    sources: source ? [clone(source)] : [], measures: []};
  for (const [mi, measure] of raw.measures.entries()) {
    if (!Array.isArray(measure.events)) throw new Error('请打开包含音符位置的识别结果');
    const number = measure.number ?? mi + 1;
    const normalized = {id: `measure-${mi + 1}`, number, issues: measure.uncertain_items ?? [], events: []};
    for (const [ei, event] of measure.events.entries()) {
      const eventId = `m${mi + 1}-e${ei + 1}`;
      const item = {id: eventId, kind: event.kind ?? (event.notes?.length ? 'notes' : 'unknown'),
        duration: event.duration ?? null, issues: event.uncertain_items ?? [], notes: []};
      for (const [ni, note] of (event.notes ?? []).entries()) {
        const box = note.source_box_in_row ?? note.source?.cell_source_box;
        const mapped = box && crop ? [box[0] + crop[0], box[1] + crop[1], box[2] + crop[0], box[3] + crop[1]] : null;
        // Preserve unknown fret, rather than turning it into an open string.
        item.notes.push({id: `${eventId}-n${ni + 1}`, string: note.string, fret: note.fret ?? null,
          source: mapped ? {pageId, box: mapped} : null});
      }
      normalized.events.push(item);
    }
    score.measures.push(normalized);
  }
  renumberMeasures(score);
  return validate(score);
}

export function locate(score, eventId, noteId) {
  for (const measure of score.measures) {
    const event = measure.events.find(e => e.id === eventId);
    if (event) return {measure, event, note: event.notes.find(n => n.id === noteId) ?? null};
  }
  return null;
}

export function setNote(score, eventId, noteId, string, fret) {
  const found = locate(score, eventId, noteId);
  if (!found) throw new Error('未找到这个音符位置');
  if (!Number.isInteger(string) || string < 1 || string > 6 || !Number.isInteger(fret) || fret < 0 || fret > 36) throw new Error('请选择1–6弦，品位填0–36');
  if (found.event.notes.some(n => n.string === string && n.id !== noteId)) throw new Error('这个位置的该弦已有音符，请先选中已有音符修改');
  let note = found.note;
  if (!note) {
    note = {id: id('note'), string, fret, source: null};
    found.event.notes.push(note);
  } else {
    note.string = string;
    note.fret = fret;
  }
  found.event.kind = 'notes';
  found.event.notes.sort((a, b) => a.string - b.string);
  return note.id;
}

export function removeNote(score, eventId, noteId) {
  const found = locate(score, eventId, noteId);
  if (!found?.note) throw new Error('先选中要删除的音符');
  found.event.notes = found.event.notes.filter(n => n.id !== noteId);
  if (!found.event.notes.length) found.event.kind = 'unknown';
}

export function addPosition(score, measureId, afterEventId, placement = 'after') {
  const measure = score.measures.find(m => m.id === measureId);
  if (!measure) throw new Error('小节不存在');
  const anchor = afterEventId ? measure.events.findIndex(e => e.id === afterEventId) : -1;
  if (afterEventId && anchor < 0) throw new Error('演奏位置不存在');
  const index = afterEventId ? anchor + (placement === 'before' ? 0 : 1) : measure.events.length;
  const event = {id: id('event'), kind: 'unknown', duration: null, issues: [], notes: []};
  measure.events.splice(index, 0, event);
  return event.id;
}

export function removePosition(score, eventId) {
  const found = locate(score, eventId);
  if (!found) throw new Error('先选中要删除的演奏位置');
  const index = found.measure.events.findIndex(event => event.id === eventId);
  found.measure.events.splice(index, 1);
  // Select the next position, or the previous one when deleting the last.
  return found.measure.events[index] ?? found.measure.events[index - 1]
    ?? score.measures.flatMap(measure => measure.events)[0] ?? null;
}

export function newScore(title = '未命名编曲') {
  const score={schema:SCHEMA,version:1,id:id('score'),title,tempo:80,timeSignature:[4,4],capo:0,
    tuningMidi:[64,59,55,50,45,40],tuningOrigin:'standard-default',sources:[],measures:[]};
  insertMeasure(score);
  return score;
}

export function insertMeasure(score, anchorId = null, placement = 'after', copy = false) {
  const index=anchorId ? score.measures.findIndex(m=>m.id===anchorId) : score.measures.length-1;
  if (anchorId && index<0) throw new Error('小节不存在');
  const measure=copy ? clone(score.measures[index]) : {events:[],issues:[],authored:true};
  measure.id=id('measure');
  if(copy) {
    measure.copiedFrom=anchorId;delete measure.recognition;
    const copiedNoteIds = new Map();
    for(const event of measure.events) {
      event.id=id('event');
      for(const note of event.notes) {
        const originalId = note.id;
        note.id=id('note');
        if (note.graceBefore) note.graceBefore.id=id('grace');
        copiedNoteIds.set(originalId, note.id);
      }
    }
    for(const event of measure.events) for(const note of event.notes) {
      if(note.technique && copiedNoteIds.has(note.technique.fromNoteId))
        note.technique.fromNoteId = copiedNoteIds.get(note.technique.fromNoteId);
      else delete note.technique;
    }
  }
  const at=Math.max(0,index+(placement==='before'?0:1));
  score.measures.splice(at,0,measure);
  renumberMeasures(score);
  return measure;
}

export function renumberMeasures(score) {
  score.measures.forEach((m,index)=>{if(!m.authored&&m.originalNumber===undefined)m.originalNumber=m.number;m.number=index+1;});
}

export function moveMeasure(score,measureId,targetNumber) {
  const from=score.measures.findIndex(measure=>measure.id===measureId);
  if(from<0)throw new Error('小节不存在');
  if(!Number.isInteger(targetNumber)||targetNumber<1||targetNumber>score.measures.length)throw new Error('目标小节编号无效');
  if(from===targetNumber-1)return score.measures[from];
  const [measure]=score.measures.splice(from,1);
  score.measures.splice(targetNumber-1,0,measure);
  renumberMeasures(score);
  return measure;
}

export function removeMeasure(score,measureId) {
  const index=score.measures.findIndex(m=>m.id===measureId);
  if(index<0)throw new Error('小节不存在');
  score.measures.splice(index,1);
  if(!score.measures.length)return insertMeasure(score);
  renumberMeasures(score);
  return score.measures[Math.min(index,score.measures.length-1)];
}

function rational(value, divisor = 1, other = undefined) {
  if (value == null || other === null) return null;
  const [a, b = 1] = value.split('/').map(Number);
  let numerator = a, denominator = b * divisor;
  if (other !== undefined) {
    const [c, d = 1] = other.split('/').map(Number);
    numerator = a * d + c * b; denominator = b * d;
  }
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) throw new Error('时值过大，无法合并');
  let x = numerator, y = denominator;
  while (y) [x, y] = [y, x % y];
  return denominator / x === 1 ? String(numerator / x) : `${numerator / x}/${denominator / x}`;
}

export function mergePosition(score, eventId) {
  const found = locate(score, eventId);
  if (!found) throw new Error('先选择一个演奏位置');
  const index = found.measure.events.indexOf(found.event), next = found.measure.events[index + 1];
  if (!next) throw new Error('当前小节没有后一个位置');
  if (!found.event.notes.length || !next.notes.length) throw new Error('只能合并两个有音符的位置');
  if (next.notes.some(note => found.event.notes.some(n => n.string === note.string))) throw new Error('两位置包含同一根弦，不能合并为同时弹；请先修改弦号或删除重复音');
  const duration = rational(found.event.duration, 1, next.duration);
  for (const note of next.notes) note.dynamics = dynamicLevel(next, note);
  found.event.notes.push(...next.notes);
  found.event.notes.sort((a, b) => a.string - b.string);
  found.event.duration = duration;
  found.event.issues = [...(found.event.issues ?? []), ...(next.issues ?? [])];
  if (found.event.sustain !== next.sustain) found.event.issues.push('合并前延音设置不同，请核对；当前采用前一个位置的设置');
  found.measure.events.splice(index + 1, 1);
  return found.event.id;
}

export function splitPosition(score, eventId, noteId) {
  const found = locate(score, eventId, noteId);
  if (!found?.note || found.event.notes.length < 2) throw new Error('先选中同时弹组合里要拆到下一位置的音');
  const duration = found.event.duration === null ? null : rational(found.event.duration, 2);
  const next = {...clone(found.event), id: id('event'), duration, notes: [found.note]};
  found.event.notes = found.event.notes.filter(note => note.id !== noteId);
  found.event.duration = duration;
  found.measure.events.splice(found.measure.events.indexOf(found.event) + 1, 0, next);
  return next.id;
}

export function timingWarning(score, measure) {
  if (measure.events.some(event => event.duration === null)) return '节奏待设置';
  if (!score.timeSignature) return '';
  const [beats, unit] = score.timeSignature;
  const total = measure.events.reduce((sum, event) => sum + fraction(event.duration), 0);
  if (measure.allowIncomplete && total <= beats / unit + 1e-8) return '';
  return Math.abs(total - beats / unit) > 1e-8 ? `时值合计 ${Number((total * unit).toFixed(3))} / ${beats} 拍，请检查（不自动补齐）` : '';
}

export function acceptRecognition(score, candidate, targetId = null, expected = null) {
  validate(candidate);
  if (!targetId) return clone(candidate);
  const index = score.measures.findIndex(measure => measure.id === targetId);
  if (index < 0 || JSON.stringify(score.measures[index]) !== expected) throw new Error('此小节在识别期间已经修改，不能覆盖；可将候选结果作为新谱打开');
  if (candidate.measures.length !== 1) throw new Error('局部替换需要恰好一个小节的候选结果');
  const result = clone(score), original = result.measures[index];
  result.measures[index] = {...clone(candidate.measures[0]), id: original.id, number: original.number};
  for (const source of candidate.sources) {
    const existing = result.sources.findIndex(page => page.id === source.id);
    if (existing < 0) result.sources.push(clone(source));
    else result.sources[existing] = clone(source);
  }
  return validate(result);
}

export function measureTiming(measure) {
  // Missing rhythm stays missing. Editors never rewrite fret or groups to fill a bar.
  let onset = 0;
  return measure.events.map(event => {
    const duration = fraction(event.duration);
    const timing = {eventId: event.id, onset, duration};
    onset = onset === null || duration === null ? null : onset + duration;
    return timing;
  });
}

export function portable(score) {
  const value = validate(clone(score));
  delete value.libraryRecord;
  for (const source of value.sources) {
    if (source.dataUrl) delete source.url;
  }
  return value;
}
