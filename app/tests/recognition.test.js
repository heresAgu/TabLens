import test from 'node:test';
import assert from 'node:assert/strict';
import {importScore, clone, mergePosition, splitPosition, acceptRecognition, appendRecognition, newScore, timingWarning} from '../web/core.js';
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

test('PDF page candidates append in order without rewriting earlier edits',()=>{
  const first=score();first.sources=[{id:'pdf-page-1',name:'score.pdf · 第 1 页',dataUrl:'data:image/png;base64,AA=='}];
  first.measures[0].events[0].notes[0].fret=7;first.tempo=93;
  const page=score();page.sources=[{id:'pdf-page-2',name:'score.pdf · 第 2 页',dataUrl:'data:image/png;base64,AA=='}];
  page.measures[0].id='second-measure';page.measures[0].number=1;
  page.measures[0].events.forEach((event,index)=>{event.id='second-event-'+index;event.notes.forEach((note,i)=>note.id=`second-note-${index}-${i}`);
    event.notes.forEach(note=>note.source={pageId:'pdf-page-2',box:[10,20,30,40]});});
  const result=appendRecognition(first,page);
  assert.equal(result.measures.length,2);assert.equal(result.measures[1].number,2);
  assert.equal(result.measures[1].originalNumber,1);
  assert.equal(result.measures[0].events[0].notes[0].fret,7);assert.equal(result.tempo,93);
  assert.equal(result.sources[1].id,'pdf-page-2');assert.equal(first.measures.length,1);
  assert.throws(()=>appendRecognition(result,page),/原图页编号重复/);
});

test('appending the first recognized PDF page replaces only the starter blank measure',()=>{
  const empty=newScore('未命名乐谱'),candidate=score();
  const result=appendRecognition(empty,candidate);
  assert.equal(result.measures.length,1);
  assert.equal(result.measures[0].events.length,2);
});
