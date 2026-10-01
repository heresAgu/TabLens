import test from 'node:test';
import assert from 'node:assert/strict';
import {importScore, clone, mergePosition, splitPosition, acceptRecognition, timingWarning} from '../web/core.js';
const score = () => importScore({metadata:{title:'练习',time_signature:[4,4]},measures:[{number:1,events:[
  {duration:'1/8',notes:[{string:1,fret:0}]},{duration:'3/16',notes:[{string:2,fret:12}]}
]}]});
test('merging preserves fret, source, dynamics and rational timing; splitting reverses grouping',()=>{
  const s=score(),[first,second]=s.measures[0].events;
  second.dynamics='soft';second.notes[0].source={pageId:'p',box:[1,2,3,4]};
  const noteId=second.notes[0].id;
  mergePosition(s,first.id);
  assert.equal(first.duration,'5/16');assert.equal(first.notes[1].dynamics,'soft');
  const next=splitPosition(s,first.id,noteId);
  assert.equal(s.measures[0].events[1].id,next);
  assert.deepEqual(s.measures[0].events.map(e=>e.duration),['5/32','5/32']);
  assert.deepEqual(s.measures[0].events[1].notes[0].source,{pageId:'p',box:[1,2,3,4]});
});
test('merge refuses same-string conflicts without changing either position',()=>{
  const s=score();s.measures[0].events[1].notes[0].string=1;const before=clone(s);
  assert.throws(()=>mergePosition(s,s.measures[0].events[0].id),/同一根弦/);
  assert.deepEqual(s,before);
});
test('unknown rhythm remains unknown when positions are merged or split',()=>{
  const s=score();s.measures[0].events[1].duration=null;const first=s.measures[0].events[0];
  mergePosition(s,first.id);splitPosition(s,first.id,first.notes[0].id);
  assert.deepEqual(s.measures[0].events.map(e=>e.duration),[null,null]);
});
test('local candidate cannot overwrite edits made while recognition runs',()=>{
  const s=score(),candidate=score(),m=s.measures[0],expected=JSON.stringify(m);
  m.events[0].notes[0].fret=9;
  assert.throws(()=>acceptRecognition(s,candidate,m.id,expected),/已经修改/);
  assert.equal(m.events[0].notes[0].fret,9);
});
test('local replacement preserves other bars and settings',()=>{
  const s=score();s.measures.push({...clone(s.measures[0]),id:'other',events:[]});s.tempo=73;
  const m=s.measures[0],candidate=score();candidate.measures[0].events.forEach((e,i)=>{e.id=`new-${i}`;e.notes.forEach(n=>n.id='new-'+n.id);});
  const result=acceptRecognition(s,candidate,m.id,JSON.stringify(m));
  assert.deepEqual(result.measures[1],s.measures[1]);assert.equal(result.tempo,73);
  assert.equal(result.measures[0].id,m.id);assert.equal(s.measures[0].events[0].id,m.events[0].id);
});
test('measure warnings do not fill missing timing and allow incomplete excerpts',()=>{
  const s=score(),m=s.measures[0],before=clone(m);
  assert.match(timingWarning(s,m),/不自动补齐/);assert.deepEqual(m,before);
  m.allowIncomplete=true;assert.equal(timingWarning(s,m),'');
  m.events[0].duration=null;assert.equal(timingWarning(s,m),'节奏待设置');
});
