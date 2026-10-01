import test from 'node:test';
import assert from 'node:assert/strict';
import {importScore, setNote, removeNote, addPosition, removePosition, portable, measureTiming, clone,newScore,insertMeasure,removeMeasure,moveMeasure} from '../web/core.js';

test('moving a measure keeps its notes, source mapping and stable IDs while renumbering',()=>{
  const score=importScore({measures:[1,2,3].map((number)=>({number,events:[{duration:'1/4',notes:[{string:number,fret:number}]}]}))});
  const ids=score.measures.map(m=>m.id),eventId=score.measures[0].events[0].id;
  score.measures[0].events[0].notes[0].source={pageId:'p',box:[1,2,3,4]};
  moveMeasure(score,ids[0],3);
  assert.deepEqual(score.measures.map(m=>m.id),[ids[1],ids[2],ids[0]]);
  assert.deepEqual(score.measures.map(m=>m.number),[1,2,3]);
  assert.equal(score.measures[2].events[0].id,eventId);
  assert.deepEqual(score.measures[2].events[0].notes[0].source,{pageId:'p',box:[1,2,3,4]});
  assert.equal(score.measures[2].originalNumber,1);
  moveMeasure(score,ids[0],1);assert.deepEqual(score.measures.map(m=>m.id),ids);
  assert.throws(()=>moveMeasure(score,ids[0],4),/目标小节/);
  assert.deepEqual(score.measures.map(m=>m.id),ids);
});

test('blank composition and last-bar deletion keep an editable measure',()=>{
  const score=newScore();assert.equal(score.sources.length,0);assert.deepEqual(score.timeSignature,[4,4]);
  const bar=score.measures[0];const event=addPosition(score,bar.id,null);setNote(score,event,null,6,0);
  assert.equal(score.measures[0].events[0].notes[0].fret,0);
  removeMeasure(score,bar.id);assert.equal(score.measures.length,1);assert.equal(score.measures[0].events.length,0);
});
test('measure copies preserve chords, durations and sources with independent IDs',()=>{
  const score=importScore(raw()), original=clone(score.measures[0]);
  original.events[0].notes[0].source={pageId:'p',box:[1,2,3,4]};score.measures[0]=original;
  const copied=insertMeasure(score,original.id,'after',true);
  assert.equal(original.originalNumber,2);assert.equal(copied.originalNumber,2);
  assert.deepEqual(score.measures.map(m=>m.number),[1,2]);
  assert.notEqual(copied.events[0].id,original.events[0].id);assert.notEqual(copied.events[0].notes[0].id,original.events[0].notes[0].id);
  assert.deepEqual(copied.events[0].notes[0].source,original.events[0].notes[0].source);
  copied.events[0].notes[0].fret=9;assert.equal(original.events[0].notes[0].fret,0);
  insertMeasure(score,original.id,'before');assert.deepEqual(score.measures.map(m=>m.number),[1,2,3]);
  removeMeasure(score,original.id);assert.deepEqual(score.measures.map(m=>m.number),[1,2]);
  score.libraryRecord={revision:'local'};assert.equal(portable(score).libraryRecord,undefined);
});

const raw = () => ({metadata: {title: 'Test', capo: 6}, measures: [{number: 2, events: [
  {duration: '1/8', notes: [{string: 2, fret: 0}, {string: 5, fret: 2}]},
  {duration: null, notes: [{string: 3, fret: 4}]},
  {duration: '1/4', notes: [{string: 1, fret: 10}]}]}]});

test('remove an inserted position while preserving neighbouring notes and IDs', () => {
  const score = importScore(raw()), measure = score.measures[0], before = clone(measure.events);
  const inserted = addPosition(score, measure.id, measure.events[0].id);
  const next = removePosition(score, inserted);
  assert.equal(next.id, before[1].id);
  assert.deepEqual(measure.events, before);
});
test('insert before the first chord without changing notes or ordering of existing positions', () => {
  const score = importScore(raw()), measure = score.measures[0], before = clone(measure.events);
  const inserted = addPosition(score, measure.id, before[0].id, 'before');
  assert.equal(measure.events[0].id, inserted);
  assert.deepEqual(measure.events.slice(1), before);
  removePosition(score, inserted);
  assert.deepEqual(measure.events, before);
});

test('removing the final position leaves a valid empty measure', () => {
  const score = importScore(raw());
  while (score.measures[0].events.length) {
    removePosition(score, score.measures[0].events[0].id);
  }
  assert.equal(score.measures.length, 1);
  assert.deepEqual(score.measures[0].events, []);
});

test('editing string/fret keeps simultaneous group and following positions', () => {
  const score = importScore(raw()), [event, next] = score.measures[0].events;
  const noteId = event.notes[0].id;
  setNote(score, event.id, noteId, 1, 12);
  assert.equal(event.notes.length, 2);
  assert.equal(event.notes[0].id, noteId);
  assert.deepEqual(event.notes.map(n => [n.string, n.fret]), [[1, 12], [5, 2]]);
  assert.equal(next.notes[0].fret, 4);
});

test('same-string collision is rejected before modifying the score', () => {
  const score = importScore(raw()), event = score.measures[0].events[0], before = clone(score);
  assert.throws(() => setNote(score, event.id, event.notes[0].id, 5, 7), /已有音符/);
  assert.deepEqual(score, before);
});

test('adding a chord note does not add an extra position', () => {
  const score = importScore(raw()), event = score.measures[0].events[0];
  const added = setNote(score, event.id, null, 6, 3);
  assert.equal(event.notes.length, 3);
  assert.equal(score.measures[0].events.length, 3);
  removeNote(score, event.id, added);
  assert.equal(event.notes.length, 2);
});

test('unknown rhythm propagates into later starts without inventing durations', () => {
  const score = importScore(raw());
  assert.deepEqual(measureTiming(score.measures[0]).map(t => t.onset), [0, 0.125, null]);
  score.measures[0].events[1].duration = '1/16';
  assert.deepEqual(measureTiming(score.measures[0]).map(t => t.onset), [0, 0.125, 0.1875]);
});

test('saved project round trip preserves open string, null rhythm and chord IDs', () => {
  const score = importScore(raw());
  score.sources = [{id: 'page-1', url: '/api/images/test', dataUrl: 'data:image/png;base64,AA=='}];
  const exported = portable(score), reopened = importScore(JSON.parse(JSON.stringify(exported)));
  assert.equal(exported.sources[0].url, undefined);
  assert.equal(reopened.measures[0].events[0].notes[0].fret, 0);
  assert.equal(reopened.measures[0].events[1].duration, null);
  assert.deepEqual(reopened.measures, score.measures);
});

test('source coordinates map to original page while note edits retain their source', () => {
  const source = raw();
  source.preview_source = {id: 'page-1', cropBox: [115, 230, 980, 370]};
  source.measures[0].events[0].notes[0].source_box_in_row = [12, 6, 26, 31];
  const score = importScore(source), event = score.measures[0].events[0], note = event.notes[0];
  assert.deepEqual(note.source.box, [127, 236, 141, 261]);
  setNote(score, event.id, note.id, 1, 3);
  assert.deepEqual(note.source.box, [127, 236, 141, 261]);
});
