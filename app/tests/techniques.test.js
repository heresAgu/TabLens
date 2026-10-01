import test from 'node:test';
import assert from 'node:assert/strict';
import {newScore, insertMeasure, validate, clone} from '../web/core.js';
import {setNoteTechnique, pruneTechniques} from '../web/techniques.js';
import {timeline, voicePlan} from '../web/playback.js';

function scoreWithChords() {
  const score = newScore('技巧测试');
  const first = score.measures[0];
  first.events.push(
    {id:'a',kind:'notes',duration:'1/4',notes:[{id:'a1',string:1,fret:5},{id:'a2',string:2,fret:7}]},
    {id:'b',kind:'notes',duration:'1/4',notes:[{id:'b1',string:1,fret:7},{id:'b3',string:3,fret:4}]}
  );
  const second = insertMeasure(score, first.id);
  second.events.push({id:'c',kind:'notes',duration:'1/4',notes:[{id:'c1',string:1,fret:5},{id:'c2',string:2,fret:9}]});
  return score;
}

test('techniques link to the previous note on the same string across chords and measures', () => {
  const score = scoreWithChords();
  setNoteTechnique(score,'b','b1','hammer');
  setNoteTechnique(score,'c','c1','pull');
  setNoteTechnique(score,'c','c2','slide',0.7);
  validate(score);
  assert.deepEqual(score.measures[0].events[1].notes[0].technique,{type:'hammer',fromNoteId:'a1'});
  assert.deepEqual(score.measures[1].events[0].notes[1].technique,{type:'slide',fromNoteId:'a2',ratio:0.7});
  const plan = voicePlan(timeline(score,80),{sustain:'natural'},()=>3);
  const first = plan.find(voice=>voice.noteId==='a1');
  assert.deepEqual(first.transitions.map(t=>t.type),['hammer','pull']);
  assert.deepEqual(first.transitions.map(t=>t.midi),[71,69]);
  assert.equal(plan.some(voice=>voice.noteId==='b1'||voice.noteId==='c1'),false);
  assert.equal(plan.find(voice=>voice.noteId==='a2').transitions[0].at,1.5);
  assert.equal(plan.find(voice=>voice.noteId==='a2').transitions[0].ratio,0.7);
});

test('invalid direction and slide timing are rejected; editing a source removes stale links', () => {
  const score = scoreWithChords();
  assert.throws(()=>setNoteTechnique(score,'b','b1','pull'),/更低/);
  assert.throws(()=>setNoteTechnique(score,'b','b1','slide',0.05),/10%/);
  setNoteTechnique(score,'b','b1','hammer');
  const copy=clone(score);
  copy.measures[0].events[0].notes[0].fret=8;
  assert.throws(()=>validate(copy),/更高/);
  assert.equal(pruneTechniques(copy),1);
  validate(copy);
  assert.equal(copy.measures[0].events[1].notes[0].technique,undefined);
});

test('a practice excerpt begins with a fresh pluck when its source note is outside the range', () => {
  const score=scoreWithChords();
  setNoteTechnique(score,'c','c1','pull');
  const data=timeline(score,80,{from:1,to:1});
  const plan=voicePlan(data,{sustain:'natural'},()=>3);
  assert.equal(plan.length,2);
  assert.equal(plan.find(voice=>voice.noteId==='c1').transitions.length,0);
});

test('tempo scales linked onset times while preserving simultaneous notes', () => {
  const score=scoreWithChords();
  setNoteTechnique(score,'b','b1','hammer');
  const fast=voicePlan(timeline(score,120),{sustain:'natural'},()=>3);
  const slow=voicePlan(timeline(score,60),{sustain:'natural'},()=>3);
  assert.equal(slow.find(voice=>voice.noteId==='a1').transitions[0].at,
    fast.find(voice=>voice.noteId==='a1').transitions[0].at*2);
  assert.equal(timeline(score,120).events[0].midi.length,2);
});



test('copying a measure preserves internal technique links with independent note IDs',()=>{
  const score=scoreWithChords();
  setNoteTechnique(score,'b','b1','hammer');
  const original=score.measures[0];
  const copied=insertMeasure(score,original.id,'after',true);
  validate(score);
  const source=copied.events[0].notes.find(note=>note.string===1);
  const target=copied.events[1].notes.find(note=>note.string===1);
  assert.notEqual(source.id,'a1');
  assert.equal(target.technique.fromNoteId,source.id);
});

test('new slides default to a fast final-fifth transition without changing saved ratios',()=>{
  const score=scoreWithChords();
  setNoteTechnique(score,'b','b1','slide');
  assert.equal(score.measures[0].events[1].notes[0].technique.ratio,0.2);
  validate(score);
  setNoteTechnique(score,'b','b1','slide',0.85);
  assert.equal(score.measures[0].events[1].notes[0].technique.ratio,0.85);
});
