import test from 'node:test';
import assert from 'node:assert/strict';
import {importScore,clone} from '../web/core.js';
import {noteSelection,editNotes} from '../web/selection.js';
import {timeline} from '../web/playback.js';
const sample=()=>importScore({measures:[{number:1,events:[{duration:null,notes:[{string:1,fret:null}]},{duration:'1/8',notes:[{string:1,fret:3},{string:6,fret:0}]}]},{number:2,events:[{duration:'1/4',notes:[{string:2,fret:5}]}]}]});
test('selected note dynamics leave chord partners unchanged; rhythm changes shared positions',()=>{
  const score=sample(),a=score.measures[0].events[1],b=score.measures[1].events[0],other=clone(a.notes[1]);
  const selection=noteSelection(score,[a.notes[0].id,b.notes[0].id,a.notes[0].id]);
  assert.equal(selection.noteIds.length,2);assert.equal(selection.eventIds.length,2);
  editNotes(score,selection,{dynamics:'soft',duration:'1/16'});
  assert.deepEqual(a.notes[1],other);assert.equal(a.notes[0].dynamics,'soft');assert.equal(b.duration,'1/16');assert.equal(a.duration,'1/16');
  const before=clone(score);assert.throws(()=>editNotes(score,selection,{duration:'0',dynamics:'strong'}));assert.deepEqual(score,before);
});
test('batch deletion keeps empty positions, durations and unselected notes',()=>{
  const score=sample(),a=score.measures[0].events[1],b=score.measures[1].events[0];
  editNotes(score,noteSelection(score,[a.notes[0].id,b.notes[0].id]),{remove:true});
  assert.equal(a.notes.length,1);assert.equal(a.notes[0].string,6);assert.equal(b.notes.length,0);assert.equal(b.kind,'unknown');assert.equal(b.duration,'1/4');assert.equal(score.measures[1].events.length,1);
});
test('starting inside a measure ignores earlier unknown timing and preserves original position labels',()=>{
  const score=sample(),data=timeline(score,80,{from:0,to:1,startEventId:'m1-e2'});
  assert.equal(data.events[0].id,'m1-e2');assert.equal(data.events[0].index,2);assert.equal(data.events[0].start,0);assert.equal(data.events[0].midi.length,2);assert.equal(data.total,1.125);
  assert.throws(()=>timeline(score,80,{from:1,to:1,startEventId:'m1-e2'}),/不在练习范围/);
  assert.throws(()=>timeline(score,80,{from:0,to:1,startEventId:'m1-e1'}),/节奏/);
});
